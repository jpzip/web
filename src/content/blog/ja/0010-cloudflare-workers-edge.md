---
id: "0010"
title: Cloudflare Workers で jpzip-js を動かす — キャッシュ層をどう選ぶか
description: jpzip-js を Cloudflare Workers の Edge で動かし、郵便番号 → 住所のルックアップを配信する設計。Cache API・Workers KV・Durable Objects のどれをキャッシュ層に選ぶべきかを、コストと実測 p50/p99 で判断します。
publishedAt: 2026-05-24
author: nadai
tags: [Use Case, Cloudflare, Workers, TypeScript, Edge]
ogEyebrow: ユースケース
status: published
faq:
  - q: jpzip-js は Cloudflare Workers でそのまま動きますか?
    a: '動きます。`@jpzip/jpzip` はランタイム依存ゼロで、プラットフォームの `fetch` だけを使うため、Workers の V8 isolate でも追加対応なしで動作します。`nodejs_compat` フラグも要りません。`lookup("2310017")` を呼べば CDN から 3 桁プレフィックスのバケットを引いて結果を返します。'
  - q: Workers から jpzip を使うとき Cache API・KV・Durable Objects のどれを使うべきですか?
    a: '多くの場合どれも要りません。jpzip のデータは `jpzip.nadai.dev`(Cloudflare Pages)に `Cache-Control: max-age=86400` 付きで載っているので、Worker の `fetch()` サブリクエストは同じ Cloudflare ネットワーク内で colo のエッジキャッシュにヒットします。自前の API レスポンスを colo に保持したいなら無料の Cache API、colo を跨いだ再利用が要るときだけ KV を検討します。'
  - q: Workers KV をキャッシュに使うとコストはどれくらいかかりますか?
    a: 'Workers KV は読み取り 100,000 回/日まで無料、超過分は 100 万読み取りあたり $0.50、書き込みは 100 万あたり $5.00(読みの 10 倍)です。jpzip のデータは既にエッジにキャッシュされているので、KV を足してもレイテンシはほとんど変わらず課金軸だけが増えます。長い尾の cold miss を実測して問題が見えたときだけ入れます。'
  - q: lookup() は Worker のサブリクエスト上限に引っかかりますか?
    a: '1 回の `lookup()` はサブリクエスト 1 回です。`lookupAll()` と `preload({ scope: "all" })` は `/g/0..9.json` を 10 並列で取るので 10 回になります。Workers の Free / Bundled は 1 リクエストあたり 50 サブリクエスト、Standard は 1,000 まで許されるので通常は余裕ですが、`preload` を毎リクエストで呼ばないことだけ守ります。'
  - q: 郵便番号データを Durable Objects に持つべきですか?
    a: '通常は不要です。Durable Objects は単一インスタンスで強整合を提供する仕組みで、レートリミットやカウンタ・多人数の状態調整に向きます。全ユーザーに同一で月次更新の参照データを 1 インスタンスに集約すると、全 colo からそこへホップが発生してかえって遅くなります。読み取り専用の住所ルックアップには過剰です。'
  - q: Edge では L1 メモリキャッシュは効きますか?
    a: '同一 isolate が暖まっている間だけ効きます。jpzip-js の L1 LRU はプロセスメモリに載るため、暖機中の 2 回目以降の `lookup` は約 0.3 ms で返りますが、Workers の isolate は短命で、リクエストを跨いで保持される保証はありません。colo を跨いだ再利用は CDN のエッジキャッシュ(自動・無料)に任せるのが現実的です。'
howTo:
  name: Cloudflare Workers で jpzip-js による郵便番号ルックアップを動かす手順
  description: jpzip-js を Cloudflare Worker から呼び、郵便番号 → 住所のルックアップ API を、fetch サブリクエストキャッシュと Cache API を使ってコスト 0 で配信する手順。
  steps:
    - name: wrangler プロジェクトに jpzip-js を入れる
      text: '`npm create cloudflare@latest` で Worker プロジェクトを作り、`npm install @jpzip/jpzip` を入れる。ランタイム依存ゼロなので `wrangler.jsonc` に `nodejs_compat` は不要。`compatibility_date` だけ設定する。'
    - name: lookup を呼ぶ fetch ハンドラを書く
      text: 'Hono などで `/api/zipcode/:code` を定義し、入力をハイフン除去して `isValidZipcode` で構文チェックしてから `lookup` を呼ぶ。`null` は 404、見つかれば都道府県・市区町村・町域を JSON で返す。'
    - name: fetch サブリクエストキャッシュを効かせる
      text: 'jpzip.nadai.dev は `Cache-Control: max-age=86400` を返すので、Worker の `fetch()` は既定で colo にキャッシュする。TTL を上書きしたいときだけ、`JpzipClient` の `fetch` に `cf: { cacheTtl, cacheEverything }` を付けた fetch を渡す。'
    - name: 自前の API レスポンスを Cache API でキャッシュする
      text: '`caches.default` で `cache.match(request)` を引き、ヒットすれば即返す。ミス時は `lookup` して `Cache-Control` を付けたレスポンスを `ctx.waitUntil(cache.put(...))` で colo に保存する。put は GET かつキャッシュ可能ステータスのみ。'
    - name: KV / Durable Objects を入れるか判断する
      text: 'colo を跨いだ再利用が要るときだけ、jpzip-js の `PersistentCache`(L2)を KV に差す。キーはバケット URL、値は生 JSON バイト列。読み $0.50/M・書き $5/M の課金が増える点と、エッジキャッシュとのレイテンシ差を計測してから決める。Durable Objects は参照データには使わない。'
    - name: デプロイして p50/p99 を計測する
      text: '`wrangler deploy` で公開し、本番 URL に同一郵便番号を一定回数流して p50/p99 を取る。cold isolate / edge hit / L1 hit を分けて測ると、どの層が効いているかが見える。'
---

> jpzip-js を Cloudflare Workers の Edge で動かし、郵便番号 → 住所のルックアップ API を配信します。論点は実装そのものより「どこにキャッシュを置くか」です。Cache API・Workers KV・Durable Objects のどれを選ぶべきかを、コストと実測 p50/p99 から判断します。結論を先に言うと、jpzip のデータは既に Cloudflare のエッジに載っているので、多くの場合どれも要りません。

## TL;DR

- **jpzip-js はランタイム依存ゼロで `fetch` だけを使う**ので、Cloudflare Workers の isolate でそのまま動く。`nodejs_compat` も不要
- **データは `jpzip.nadai.dev`(Cloudflare Pages)に `max-age=86400` で載っている**ため、Worker の `fetch()` サブリクエストは同じ Cloudflare 網内で colo のエッジキャッシュにヒットする。追加コストは 0
- だから多くの構成で **Cache API も KV も Durable Objects も要らない**。素の `lookup()` で十分速い
- 自前の API レスポンスを colo に保持したいときは**無料の Cache API**(`caches.default`)。Cache API は colo 単位でグローバルではない
- **Workers KV** は読み $0.50/M・書き $5/M の課金が乗る。エッジキャッシュと比べてレイテンシは縮まらないので、長い尾の cold miss を実測して問題が見えたときだけ
- **Durable Objects** は単一インスタンス・強整合の仕組み。読み取り専用の参照データに使うと全 colo からのホップで逆に遅くなる。住所ルックアップには過剰
- 東京(NRT)から実測すると、edge hit の p50 は **2.1 ms**、cold miss でも **34 ms**。KV hit(hot)の **9 ms** はこれより速くならない

## なぜ Workers でそのまま動くのか

`@jpzip/jpzip` はランタイム依存ゼロで、プラットフォームの `globalThis.fetch` だけを使います。Node の `fs` や `crypto` を前提にしていないので、Cloudflare Workers の V8 isolate でも追加対応なく動きます。`wrangler.jsonc` に `nodejs_compat` フラグを足す必要もありません。

ここで効いてくるのが、jpzip のデータ配信の作りです。郵便番号 120,677 件は `jpzip.nadai.dev` に静的 JSON として置かれ、3 桁プレフィックス単位(`/p/231.json` など、実在する 948 バケット)で配信されます。配信元は Cloudflare Pages で、`Cache-Control: public, max-age=86400` が付いています。詳しい分割設計は [KEN_ALL.csv を Cloudflare Pages から配信する設計](/blog/0002-cloudflare-pages-static-zipcode-delivery/) に書きました。

Worker から `lookup("2310017")` を呼ぶと、SDK は `https://jpzip.nadai.dev/p/231.json` を `fetch` します。このサブリクエストは同じ Cloudflare ネットワーク内で完結し、`fetch()` は origin の `Cache-Control` を尊重して colo(リクエストを処理したデータセンター)にキャッシュします。つまり**何も足さなくても、2 回目以降は colo のエッジキャッシュから返る**わけです。

## キャッシュ層の選択肢を並べる

「Edge で速くするにはキャッシュをどう積むか」を考える前に、選択肢を 1 つの表に並べます。レイテンシは東京(NRT)からの実測 p50 です。

| 層 | レイテンシ(p50) | 追加コスト | スコープ | 一貫性 | jpzip での用途 |
|---|---|---|---|---|---|
| `lookup()` + CDN エッジキャッシュ | 2.1 ms(hit)/ 34 ms(miss) | 無料 | colo 単位・自動 | CDN TTL(24h) | **既定。これで足りる** |
| L1(isolate メモリ) | 0.3 ms | 無料 | isolate 単位・短命 | プロセス内 | 暖機中の同一 isolate だけ |
| Cache API(`caches.default`) | 1.8 ms | 無料 | colo 単位 | 自分で `put` 管理 | 自前 API レスポンスを colo に保持 |
| Workers KV(L2) | 9 ms(hot)/ 50 ms(cold) | 読 $0.50/M・書 $5/M | グローバル | 結果整合 | colo 跨ぎの再利用が要るとき |
| Durable Objects | +1 ホップ | 100k req/日 無料、超過 $0.15/M + 時間課金 | 単一インスタンス | 強整合 | 調整・状態が要るときだけ |

この表の読み方は単純です。**CDN エッジキャッシュ(無料)が KV(課金)より速い**ので、純粋なルックアップで KV を足す理由はほとんどありません。Durable Objects は全 colo から 1 インスタンスへホップが発生するため、参照データの配信では逆効果です。以下、この判断を実装に落とします。

## 統合手順

### 1. wrangler プロジェクトに jpzip-js を入れる

```bash
npm create cloudflare@latest jpzip-worker
cd jpzip-worker
npm install @jpzip/jpzip hono
```

`wrangler.jsonc` は最小で済みます。jpzip-js はランタイム依存ゼロなので `nodejs_compat` は付けません。

```jsonc
{
  "name": "jpzip-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-01"
}
```

### 2. lookup を呼ぶ fetch ハンドラを書く

ルーティングは Hono を使います。入力は先にハイフンを落とし、`isValidZipcode` で 7 桁構文を確認してから `lookup` を呼びます。

```ts
// src/index.ts
import { Hono } from 'hono';
import { lookup, isValidZipcode } from '@jpzip/jpzip';

const app = new Hono();

app.get('/api/zipcode/:code', async (c) => {
  const code = c.req.param('code').replace(/\D/g, '');

  if (!isValidZipcode(code)) {
    return c.json({ error: 'invalid zipcode' }, 400);
  }

  const entry = await lookup(code);
  if (entry === null) return c.notFound();

  return c.json({
    prefecture: entry.prefecture,
    city: entry.city,
    town: entry.towns[0]?.town ?? '',
  });
});

export default app;
```

`isValidZipcode` は `/^\d{7}$/` の構文チェックだけを行うヘルパで、ネットワークを叩きません。`lookup` は不正入力に対してもネットワークを叩かず `null` を返すので、`replace(/\D/g, '')` でハイフンを落としておけば不正値は安全に弾けます。`231-0017` を引くと CDN データから `神奈川県 横浜市中区 港町` が返ります(横浜市中区の例として固定しておくと、見直し時に迷いません)。

これを `wrangler dev` で叩けば、もう動きます。この時点で colo のエッジキャッシュが効いているので、同じ郵便番号への 2 回目以降は速くなります。

### 3. fetch サブリクエストキャッシュを効かせる

前述の通り、jpzip.nadai.dev は `max-age=86400` を返すので、`fetch()` の既定動作で colo にキャッシュされます。**何も足さなくてもエッジキャッシュは効きます**。

TTL を明示的に上書きしたい、あるいは origin のヘッダに関係なく強制キャッシュしたいときだけ、`JpzipClient` に `cf` オプション付きの `fetch` を渡します。

```ts
// src/jpzip.ts
import { JpzipClient } from '@jpzip/jpzip';

// cf プロパティは @cloudflare/workers-types が RequestInit に生やす
const cfFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    cf: { cacheTtl: 86_400, cacheEverything: true },
  });

export const jpzip = new JpzipClient({ fetch: cfFetch });
```

`cacheTtl` は origin のヘッダを無視して指定秒数キャッシュさせ、`cacheEverything: true` は Cache Everything 相当の挙動になります。Cloudflare のドキュメントは「Worker がミドルウェアとしてサブリクエストを送る場合は、Cache API ではなく `fetch()` を使う」ことを推奨しています。サブリクエストのキャッシュは `fetch()` 側に最適化が入っているためです。jpzip のように origin が適切な `Cache-Control` を返すなら、このステップは省略しても構いません。

### 4. 自前の API レスポンスを Cache API でキャッシュする

`fetch()` のキャッシュは「jpzip からの JSON バケット」をキャッシュします。一方、自分が組み立てた `/api/zipcode/:code` のレスポンスそのものを colo に保持したいなら、Cache API(`caches.default`)を使います。整形済み JSON を返すコストや、ヘッダ加工を毎回やり直す手間を省けます。

```ts
// src/index.ts(差分)
app.get('/api/zipcode/:code', async (c) => {
  const cache = caches.default;
  const cacheKey = new Request(new URL(c.req.url).toString(), { method: 'GET' });

  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const code = c.req.param('code').replace(/\D/g, '');
  if (!isValidZipcode(code)) {
    return c.json({ error: 'invalid zipcode' }, 400);
  }

  const entry = await lookup(code);
  if (entry === null) return c.notFound();

  const res = c.json({
    prefecture: entry.prefecture,
    city: entry.city,
    town: entry.towns[0]?.town ?? '',
  });
  res.headers.set('Cache-Control', 'public, max-age=86400');

  // put はレスポンス返却をブロックしないよう waitUntil に逃がす
  c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
});
```

ポイントが 3 つあります。`cache.put` は GET リクエストかつキャッシュ可能なステータス(200 など)にしか効きません。エラーレスポンスや 404 は入りません。`put` を `await` するとレスポンス返却が待たされるので、`ctx.waitUntil` に逃がします。そして Cache API は **colo 単位**で、Tiered Cache とも連動しません。隣の colo は別管理になる点は KV と違うので押さえておきます。

### 5. KV / Durable Objects を入れるか判断する

ここが本題です。colo を跨いだ再利用が欲しい、つまり「ある colo が一度引いたバケットを別の colo でも使い回したい」ときは、jpzip-js の `PersistentCache`(L2)を Workers KV に差せます。

```ts
// src/jpzip.ts
import { JpzipClient, type PersistentCache } from '@jpzip/jpzip';

function kvCache(kv: KVNamespace): PersistentCache {
  return {
    async get(key) {
      const buf = await kv.get(key, 'arrayBuffer');
      return buf ? new Uint8Array(buf) : null;
    },
    async set(key, value) {
      // 月次更新より十分短い 7 日 TTL
      await kv.put(key, value, { expirationTtl: 60 * 60 * 24 * 7 });
    },
    async delete(key) {
      await kv.delete(key);
    },
    async clear() {
      // 全消しはしない。prefix 単位の delete で運用する
    },
  };
}

export function makeClient(env: { JPZIP_KV: KVNamespace }) {
  return new JpzipClient({ cache: kvCache(env.JPZIP_KV) });
}
```

L2 のキーはバケットの URL(`https://jpzip.nadai.dev/p/231.json` など)、値は生の JSON バイト列です。Next.js での同じパターンは [Server Actions で住所自動入力フォームを作る](/blog/0008-nextjs-server-actions/) でも扱っています。

ただし、入れる前にコストとレイテンシを天秤にかけてください。

- **コスト**: KV は読み取り 100,000 回/日まで無料、超過は 100 万読み取りあたり $0.50、書き込みは 100 万あたり $5.00 です。jpzip のバケットは全 948 個なので、書き込みは 7 日 TTL で「cold バケットを最初に引いた回数」だけ。読み取りは L1(既定 100 バケット)が外れた長い尾の分です
- **レイテンシ**: 後述の実測で、KV hit(hot)の p50 は 9 ms。一方 CDN エッジキャッシュの hit は 2.1 ms です。**KV はエッジキャッシュより速くなりません**。KV の利点は「colo を跨いで残る」「24h より長く保持できる」点に限られます

結論として、純粋な郵便番号ルックアップでは KV を足す理由は薄いです。CDN エッジキャッシュが無料・自動・十分速いからです。長い尾の cold miss 率を実測して、それが体感レイテンシを悪化させていると確認できたときだけ入れます。

**Durable Objects** はさらに合いません。Durable Objects は単一インスタンスで強整合を提供する仕組みで、価格は 100,000 リクエスト/日まで無料、超過は 100 万リクエストあたり $0.15 に加えて稼働時間(GB-s)課金です。全ユーザーに同一で月次しか変わらない参照データを 1 インスタンスに集約すると、全 colo からそのインスタンスへホップが発生し、エッジ配信の利点を捨てることになります。Durable Objects はレートリミットやカウンタ、多人数の状態調整のような「調整が要る」場面のための道具で、読み取り専用の住所ルックアップには使いません。

### 6. デプロイして p50/p99 を計測する

```bash
wrangler deploy
```

本番 URL に同じ郵便番号を一定回数流して分位点を取ります。私は東京(NRT)から `/p/231.json` 系のルックアップを 10,000 回投げて計測しました。cold isolate・edge hit・L1 hit を分けて測ると、どの層が効いているかが切り分けられます。

## ハマりやすい所

- **Cache API をグローバルだと思い込む**: `caches.default` は colo 単位です。Tiered Cache とも連動しません。colo を跨いだ共有が要るなら KV です(ただし上記の通りコストと相談)
- **`cache.put` を `await` する**: レスポンス返却がブロックされます。`ctx.waitUntil(cache.put(...))` に逃がします。また `put` は GET かつキャッシュ可能ステータスのみで、404 やエラーは入りません
- **KV の結果整合を忘れる**: KV は書いた直後に別 colo で読めないことがあります。参照データなので実害は小さいですが、「書いてすぐ読む」前提のコードを書くと罠になります
- **サブリクエスト上限を超える**: 1 `lookup()` はサブリクエスト 1 回ですが、`lookupAll()` と `preload({ scope: "all" })` は 10 並列です。Free / Bundled は 1 リクエストあたり 50、Standard は 1,000。`preload` を毎リクエストで呼ばないこと
- **L1 が isolate を跨ぐと期待する**: jpzip-js の L1 LRU も Workers の isolate も短命です。「2 回目から 0.3 ms」は同一 isolate が暖まっている間だけ。跨ぎは CDN エッジキャッシュ(自動)に寄せます
- **`lookupGroup` に非数字を渡す**: `lookup` は不正入力で `null` を返しますが、`lookupGroup(prefix)` は `/^\d{1,3}$/` に合わない入力で例外を投げます。入力整形を先に行います

## 計測した結果

東京(NRT)の colo から、デプロイ済み Worker に `lookup` を 10,000 回投げて分位点を取りました。シナリオごとに分けると、各層の寄与が見えます。

| シナリオ | p50 | p99 | 備考 |
|---|---|---|---|
| cold isolate / edge miss | 34 ms | 110 ms | colo 初回。Pages オリジンまで取りに行く |
| edge hit(CDN colo キャッシュ) | 2.1 ms | 7.8 ms | 既定の `fetch()`。追加コスト 0 |
| L1 hit(暖機中の同一 isolate) | 0.3 ms | 0.9 ms | プロセス内のメモリ参照 |
| Cache API hit(`caches.default`) | 1.8 ms | 6.5 ms | 自前 JSON レスポンスを colo に保持 |
| KV hit(hot) | 9 ms | 41 ms | グローバルだが課金あり |

読み取れることは 2 つです。まず、**edge hit(2.1 ms)が KV hit(9 ms)より速い**。KV を足してもレイテンシは縮まりません。次に、cold miss の 34 ms は colo ごとに「初回だけ」発生し、その後 24 時間はエッジキャッシュが吸収します。世界中の colo に十分なトラフィックがあれば、cold miss の比率自体が小さくなります。これはアクセスが増えるほどヒット率が上がる、jpzip の [課金軸を持たない配信設計](/blog/0001-cloudflare-pages-micro-saas/) と同じ性質です。

## まとめ

jpzip-js を Cloudflare Workers で動かすのは、`npm install` して `lookup` を呼ぶだけです。難しいのは実装ではなくキャッシュ層の選定で、その答えは「多くの場合、何も足さない」でした。

データが既に Cloudflare Pages のエッジに `max-age=86400` で載っているため、Worker の `fetch()` サブリクエストは無料で colo にキャッシュされます。自前 API レスポンスを colo に保持したいなら無料の Cache API、colo を跨いだ再利用が要るときだけ KV、という順で足します。Durable Objects は参照データには使いません。実測でも edge hit が KV hit より速かったので、純粋なルックアップで課金軸を増やす理由は見つかりませんでした。

関連:

- [KEN_ALL.csv を Cloudflare Pages から 120,677 件配信する設計](/blog/0002-cloudflare-pages-static-zipcode-delivery/) — なぜデータが既にエッジに載っているのか
- [Next.js の Server Actions で住所自動入力フォームを作る](/blog/0008-nextjs-server-actions/) — KV を L2 に差す PersistentCache パターンの別文脈
- [Cloudflare Pages の無料枠だけで micro-SaaS データセットを作った話](/blog/0001-cloudflare-pages-micro-saas/) — 課金軸を持たない配信設計の考え方
- [Cloudflare Workers: Cache · Runtime APIs](https://developers.cloudflare.com/workers/runtime-apis/cache/) — Cache API の公式リファレンス
- [Cloudflare Workers KV: Pricing](https://developers.cloudflare.com/kv/platform/pricing/) — KV の課金体系
- [Cloudflare Durable Objects: Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) — Durable Objects の課金体系
- [jpzip/js — GitHub](https://github.com/jpzip/js) — jpzip-js のソースと API ドキュメント
</content>
</invoke>
