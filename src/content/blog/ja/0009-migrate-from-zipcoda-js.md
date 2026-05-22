---
id: "0009"
title: "zipcoda から jpzip-js へ移行する: 外部 API 依存を切る"
description: zipcoda.net の郵便番号 API を実行時に叩く構成から、jpzip-js の静的 CDN 配信へ移行する手順。レスポンスのフィールドマッピング、JSONP/CSP の整理、レート制限対策の撤去、実測レイテンシまでを Before/After のコードで具体的に解説します。
publishedAt: 2026-05-22
author: nadai
tags: [Migration, JavaScript, TypeScript, CDN]
ogEyebrow: 移行ガイド
status: published
faq:
  - q: zipcoda から jpzip-js に移行するメリットは何ですか?
    a: '実行時に外部 API サーバー(zipcoda.net)へ依存しなくなる点が最大です。jpzip-js は静的 CDN 上の JSON を fetch するだけなので、サーバー側の可用性・レート制限(「過度なアクセスは固くお断りします」)・障害がフォームの動作を左右しません。加えて TypeScript 型の同梱、L1 LRU + 任意 L2 キャッシュ、Node / Cloudflare Workers / Vercel Edge での実行、ローマ字・JIS コードの同梱が手に入ります。'
  - q: zipcoda は JSONP が必須ですか?
    a: 'いいえ。zipcoda は現在 CORS に対応しており、公式ドキュメントでも JSONP(callback パラメータ)は非推奨と明記されています。ただし JSONP 時代に書かれた `<script>` 注入コードが残っているサイトは多く、その場合は CSP の `script-src` に `zipcoda.net` を許可している可能性があります。本記事では JSONP 実装と fetch 実装の両方からの移行を扱います。'
  - q: zipcoda の住所→郵便番号の逆引きは jpzip-js で置き換えられますか?
    a: 'いいえ。jpzip-js は郵便番号 → 住所のルックアップのみを提供しており、住所文字列から郵便番号を引く逆引き API はありません。zipcoda の `address` パラメータ(逆引き)を使っている場合、その経路は jpzip-js では直接置き換えられません。`lookupAll()` で全件を取得して自前で逆引きインデックスを組むことは可能ですが、約 37 MiB の JSON を抱えることになるため用途次第です。'
  - q: zipcoda のレスポンスの pref / address / components は jpzip のどのフィールドに対応しますか?
    a: 'zipcoda の `items[0].pref`(神奈川県)が jpzip の `entry.prefecture`、`components[1]`(横浜市中区)が `entry.city`、`components[2]`(港町)が `entry.towns[0].town` に対応します。zipcoda の `address`(横浜市中区港町)は都道府県を除いた結合済み文字列で、jpzip では `entry.city + entry.towns[0].town` で再構成できます。jpzip は加えて `prefecture_code` / `city_code` / `*_roma` を返します。'
  - q: 横浜市役所や東京都庁のような大きな建物の郵便番号はヒットしますか?
    a: '163-8001(東京都庁)のような事業所個別郵便番号(大口事業所個別番号)は日本郵便の KEN_ALL.csv に含まれません。jpzip も zipcoda も KEN_ALL ベースのため、こうした番号はどちらでもヒットしません。これは移行で改善する差ではなく、両者に共通する制約です。一般の町域番号(例: 231-0017 → 神奈川県横浜市中区港町)は両者とも正しく返します。'
  - q: レート制限の扱いはどう変わりますか?
    a: 'zipcoda は同一 IP からの過度なアクセスを一時的に制限する throttling を実装しています。本番フォームでこれに当たると住所自動入力が無言で失敗します。jpzip-js が引く先は静的 CDN(Cloudflare Pages)で、明示的なレート制限はありません。サーバー保護のために入れていたデバウンスやリトライ抑制は、撤去するか UX 目的に役割を変えられます。'
howTo:
  name: zipcoda から jpzip-js への移行手順
  description: zipcoda.net の郵便番号 API を実行時に叩く実装を、jpzip-js の静的 CDN ルックアップへ置き換える具体的なステップ。
  steps:
    - name: 既存の zipcoda 呼び出しを洗い出す
      text: '`zipcoda.net` / `callback=` / `&zipcode=` を grep し、JSONP の `<script>` 注入と fetch 呼び出しの両方を洗い出す。`address=` を使った逆引きがあれば、jpzip-js では置き換えられないため別途切り分ける。'
    - name: jpzip-js のインストール
      text: '`npm install @jpzip/jpzip` で追加する。zero runtime deps で、`lookup` のみ使う場合の gzip 増分は実測 4 KiB 程度。'
    - name: レスポンスを lookup() にマッピングして置き換える
      text: 'zipcoda の `items[0].pref` / `components` / `address` を、jpzip の `entry.prefecture` / `entry.city` / `entry.towns[0].town` に読み替える。`lookup` は該当なし・不正入力で `null` を返すので必ず分岐する。'
    - name: JSONP を使っていた場合は script 注入を撤去
      text: 'JSONP で `<script src="https://zipcoda.net/api?...&callback=...">` を動的注入していた箇所と、グローバルなコールバック関数を削除する。fetch ベースの zipcoda 実装の場合はこのステップは不要。'
    - name: CSP とレート制限対策を見直す
      text: 'CSP から `zipcoda.net`(JSONP なら `script-src`、fetch なら `connect-src`)を外し、`connect-src https://jpzip.nadai.dev` を許可する。throttling 回避のためのデバウンス/リトライ抑制は撤去するか UX 目的に変える。'
    - name: 動作確認
      text: '231-0017(神奈川県横浜市中区港町)で手動入力テストを行う。Vitest なら MSW で `jpzip.nadai.dev` をスタブし、入力 → フィールド反映の経路を再現できる。'
---

> zipcoda.net の郵便番号 API を実行時に叩く構成から、jpzip-js の静的 CDN ルックアップへ移すための実務ガイドです。フォーム側のマークアップは触らず、データ取得経路だけを「外部 API への往復」から「CDN + ローカルキャッシュ」へ置き換えます。

## TL;DR

- **zipcoda は実行時に外部 API サーバー(`https://zipcoda.net/api`)へ依存する**。サーバーの可用性・レート制限・障害がそのままフォームの住所自動入力の信頼性になる
- **jpzip-js は静的 CDN 上の JSON を fetch するだけ**。引く先は Cloudflare Pages のエッジで、明示的なレート制限がなく、L1 LRU + 任意の L2 キャッシュで 2 回目以降は実質ゼロレイテンシ
- **移行はデータ取得関数 1 つの置き換えで完了する**。`pref` / `components` / `address` を `prefecture` / `city` / `towns[0].town` に読み替えるだけ
- zipcoda は現在 **CORS 対応済みで JSONP は公式に非推奨**。JSONP 実装が残っているなら `<script>` 注入と CSP `script-src` の許可を同時に撤去できる
- 注意点として、**zipcoda の住所 → 郵便番号の逆引きは jpzip-js には無い**。逆引きを使っている経路は移行対象から切り分ける

## なぜ移行するか

zipcoda(`zipcoda.net`)は郵便番号 ⇔ 住所を相互変換できる無料の API で、API キー不要・JSONP/CORS 対応という手軽さから住所入力フォームで広く使われてきました。

一方で、フォームの住所自動入力が **実行時に第三者の API サーバーへ往復する** という構造そのものが、本番運用ではリスクになります。

| 比較項目 | zipcoda | jpzip-js |
|---|---|---|
| データ取得モデル | 動的 API(`zipcoda.net` サーバーが応答) | 静的 CDN 配信 JSON(エッジキャッシュ) |
| 配信元 | 単一 API サーバー | Cloudflare Pages のエッジ |
| クライアント | npm パッケージなし(自前で fetch / JSONP) | `@jpzip/jpzip` を npm から取得 |
| レート制限 | あり(「過度なアクセスは固くお断りします」+ IP 単位の throttling) | 明示なし(静的配信) |
| 取得方式 | fetch(CORS)。旧来は JSONP(現在は非推奨) | fetch のみ |
| TypeScript 型 | なし | 同梱(`.d.ts`) |
| キャッシュ | ブラウザ任せ | L1 LRU + 任意の L2(`preload` で全件温め可) |
| ローマ字・JIS コード | なし | `prefecture_roma` / `city_code` などを同梱 |
| 逆引き(住所→郵便番号) | あり(`address` パラメータ) | なし(郵便番号 → 住所のみ) |
| ランタイム対応 | ブラウザ中心 | Node 18+ / Bun / Deno / ブラウザ / Cloudflare Workers / Vercel Edge |
| データ更新頻度 | 不明 | 月次自動(`/blog/0002-cloudflare-pages-static-zipcode-delivery/` 参照) |

zipcoda 公式ドキュメントは「過度なアクセスは固くお断りします」と明記し、同一 IP からの連続アクセスに throttling をかけます。開発中は気づきませんが、本番でアクセスが集中したり、複数ユーザーが同一 NAT 配下にいたりすると、住所自動入力が **無言で失敗** します。jpzip-js が引く先は静的 CDN なので、この軸自体が消えます。

両者は同じ日本郵便の [KEN_ALL.csv](https://www.post.japanpost.jp/zipcode/download.html)(全 120,677 件)を正規化したデータを使っています。違いは「データの中身」ではなく「配信の仕方」です。

### 移行できない 1 点: 逆引き

先に明確にしておきます。zipcoda は `address` パラメータで **住所文字列から郵便番号を引く逆引き** ができますが、jpzip-js は **郵便番号 → 住所のルックアップのみ** で逆引き API を持ちません。逆引きを使っている経路は、`lookupAll()` で全件(約 37 MiB)を取得して自前インデックスを組むか、別手段を検討する必要があります。本記事が扱うのは郵便番号 → 住所の経路です。

## 移行手順

### 1. 既存の zipcoda 呼び出しを洗い出す

```bash
git grep -n 'zipcoda.net' -- '*.html' '*.tsx' '*.ts' '*.js' '*.vue' '*.astro'
git grep -n 'callback=' -- '*.ts' '*.tsx' '*.js'
git grep -n 'address=' -- '*.ts' '*.tsx' '*.js'
```

見るのは 3 つです。

- JSONP で `<script src="https://zipcoda.net/api?...&callback=...">` を動的注入している箇所
- `fetch('https://zipcoda.net/api?zipcode=...')` で直接叩いている箇所
- `address=` を使った逆引き(あれば移行対象から切り分ける)

### 2. jpzip-js のインストール

```bash
npm install @jpzip/jpzip
```

zero runtime deps なので `package.json` の `dependencies` に 1 行増えるだけです。tree-shaking が効くため、`lookup` だけ使う場合の gzip 増分は実測で 4 KiB 程度です(後述の計測セクション)。

### 3. レスポンスを lookup() にマッピングして置き換える

まず zipcoda が実際に返す JSON を確認します。`https://zipcoda.net/api?zipcode=2310017` のレスポンスは次の形です。

```json
{
  "status": 200,
  "length": 1,
  "items": [
    {
      "zipcode": "2310017",
      "pref": "神奈川県",
      "components": ["神奈川県", "横浜市中区", "港町"],
      "address": "横浜市中区港町"
    }
  ]
}
```

対して jpzip-js の `lookup('2310017')` は次の `entry` を返します。

```json
{
  "prefecture": "神奈川県",
  "prefecture_roma": "Kanagawa Ken",
  "prefecture_code": "14",
  "city": "横浜市中区",
  "city_roma": "Yokohama Shi Naka Ku",
  "city_code": "14104",
  "towns": [{ "town": "港町", "kana": "ミナトチョウ", "roma": "Minatocho" }]
}
```

フィールドの対応はこうなります。

| 用途 | zipcoda(`items[0]`) | jpzip-js(`entry`) |
|---|---|---|
| 都道府県 | `pref` / `components[0]` | `prefecture` |
| 市区町村 | `components[1]` | `city` |
| 町域 | `components[2]` | `towns[0].town` |
| 結合住所(都道府県以下) | `address` | `city + towns[0].town` で生成 |
| 都道府県コード | なし | `prefecture_code` |
| 市区町村コード | なし | `city_code` |
| ローマ字 | なし | `prefecture_roma` / `city_roma` / `towns[0].roma` |
| 同番号の複数該当 | `items`(配列) | `towns`(配列) |

**Before**(zipcoda を fetch で叩く実装):

```ts
type ZipcodaItem = { zipcode: string; pref: string; components: string[]; address: string };
type ZipcodaResponse = { status: number; length: number; items: ZipcodaItem[] };

async function fillFromZipcoda(zip: string, form: HTMLFormElement) {
  const res = await fetch(`https://zipcoda.net/api?zipcode=${zip}`);
  const data = (await res.json()) as ZipcodaResponse;
  if (data.length === 0) return;
  const item = data.items[0];
  form.pref.value = item.pref;            // 神奈川県
  form.city.value = item.address;         // 横浜市中区港町(市区町村+町域がまとめて入る)
}
```

**After**(jpzip-js の `lookup` に置き換え):

```ts
import { lookup } from '@jpzip/jpzip';

async function fillFromJpzip(zip: string, form: HTMLFormElement) {
  const entry = await lookup(zip);        // 該当なし・不正入力は null
  if (entry === null) return;
  const town = entry.towns[0]?.town ?? '';
  form.pref.value = entry.prefecture;     // 神奈川県
  form.city.value = entry.city;           // 横浜市中区
  form.town.value = town;                 // 港町
}
```

zipcoda の `address` は「市区町村 + 町域」をまとめた 1 フィールドだったため、市区町村と町域を別フィールドに分けたい場合はこの移行が好機です。jpzip-js は `city` と `towns[0].town` を最初から分離して返します。

### 4. JSONP を使っていた場合は script 注入を撤去

JSONP 時代に書かれた実装は、コールバック関数をグローバルに置き、`<script>` を動的注入していたはずです。

```diff
- function $zipcoda(res) {
-   if (res.length === 0) return;
-   document.querySelector('#pref').value = res.items[0].pref;
-   document.querySelector('#city').value = res.items[0].address;
- }
- function lookupZipcoda(zip) {
-   const s = document.createElement('script');
-   s.src = `https://zipcoda.net/api?zipcode=${zip}&callback=$zipcoda`;
-   document.body.appendChild(s);
- }
```

これを丸ごと削除し、ステップ 3 の `lookup` 呼び出しに置き換えます。グローバルコールバックも `<script>` 注入も消えるので、CSP を一段引き締められます(次のステップ)。fetch ベースの zipcoda 実装を使っていた場合、このステップは不要です。

### 5. CSP とレート制限対策を見直す

zipcoda を使っていたサイトの CSP は、JSONP なら `script-src`、fetch なら `connect-src` に `zipcoda.net` を許可していたはずです。

```diff
- Content-Security-Policy: script-src 'self' https://zipcoda.net; connect-src 'self' https://zipcoda.net;
+ Content-Security-Policy: script-src 'self'; connect-src 'self' https://jpzip.nadai.dev;
```

JSONP の `<script>` 注入が消えるので `script-src` は `'self'` に絞れます。データ取得は fetch なので `connect-src` に `https://jpzip.nadai.dev` を許可します。

throttling を避けるために入れていたデバウンスやリトライ抑制があれば、役割を見直します。jpzip-js は 5xx / ネットワーク失敗に対して最大 3 回(初回 + 2 リトライ、400ms・800ms のバックオフ)の自動リトライを内蔵しているため、サーバー保護目的のコードは不要です。デバウンスを残すなら、目的は「サーバー保護」から「7 桁入力完了まで引かない UX 制御」へ変わります。

### 6. 動作確認

横浜市役所のある中区の **231-0017**(神奈川県横浜市中区港町)で手動入力テストを行います。Vitest なら次のように書けます。

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { lookup } from '@jpzip/jpzip';

describe('zipcode autofill', () => {
  it('maps 231-0017 to 神奈川県 / 横浜市中区 / 港町', async () => {
    const entry = await lookup('2310017');   // テストでは MSW で jpzip.nadai.dev をスタブ推奨
    expect(entry?.prefecture).toBe('神奈川県');
    expect(entry?.city).toBe('横浜市中区');
    expect(entry?.towns[0]?.town).toBe('港町');
  });
});
```

## ハマりやすい所

- **逆引きは置き換えられない**: 繰り返しますが、`address=` での住所 → 郵便番号は jpzip-js に無い機能です。`lookupAll()` で自前インデックスを組むか別 API を残すかの判断が要ります
- **`items` と `towns` は粒度が違う**: zipcoda は該当住所を `items` 配列で返し、jpzip は 1 件の `entry` 内に `towns` 配列を持ちます。単一該当(大半のケース)は等価ですが、複数該当時は zipcoda の各 `item` を jpzip の各 `town` に対応づける必要があります
- **事業所個別郵便番号は両者ともヒットしない**: 163-8001(東京都庁)のような大口事業所個別番号は KEN_ALL.csv に含まれません。jpzip も zipcoda もこの番号は返さないので、「ヒットしない番号」を別データで補っていた場合は移行後も同じ対応が要ります
- **`address` のフィールド分割**: zipcoda の `address` は市区町村 + 町域の結合文字列です。これを 1 つの入力欄に入れていたなら、jpzip 移行で `city` と `town` に分けるか、`entry.city + entry.towns[0].town` で従来どおり結合するかを決めます
- **SSR でのフォーム初期描画**: Next.js / Astro などで HTML を静的出力する場合、初期 DOM では `lookup` を呼ばない。入力イベント駆動に寄せる

## 計測した結果

Vite + TypeScript のサンプルアプリ(住所フォーム 3 つ)で観測した傾向です。zipcoda 側は throttling の状態でぶれるため、混雑していない時間帯の値です。

| 指標 | zipcoda(動的 API) | jpzip-js(静的 CDN) |
|---|---|---|
| 初回 lookup レイテンシ(p50, Tokyo) | 約 120 ms | 約 70 ms |
| 2 回目以降(同一プレフィックス) | 約 120 ms(毎回 API へ往復) | 約 0.3 ms(L1 LRU ヒット) |
| `preload` 後のキャッシュヒット | — (リクエスト都度) | ほぼ 100% |
| レート制限 | あり(IP 単位 throttling) | なし(静的配信) |
| バンドル増加(gzip) | 0(自前 fetch) | 約 4 KiB(`lookup` のみ) |
| TypeScript 型 | 自前で定義 | 同梱 |

**一番効くのはキャッシュ挙動の差です**。zipcoda は同じ郵便番号でも毎回 API へ往復しますが、jpzip-js は L1 LRU を持つので 2 回目以降のレイテンシが事実上ゼロになります。レイテンシの絶対値より、「往復をやめられる」点が本番では効いてきます。

## まとめ

zipcoda は手軽で、開発中は何の問題もなく動きます。とはいえ「住所自動入力のたびに第三者の API サーバーへ往復し、その可用性とレート制限に依存する」という構造は、本番では地味なリスクとして残ります。

jpzip-js への移行は、データ取得関数 1 つの置き換えで完了します。`pref` / `components` / `address` を `prefecture` / `city` / `towns[0].town` に読み替え、CSP から `zipcoda.net` を外すだけです。逆引きを使っていない限り、変更点は驚くほど小さく収まります。引き換えに、外部 API への実行時依存・レート制限・型欠如がまとめて消えます。

関連:

- [jpzip の全体像](/blog/0001-cloudflare-pages-micro-saas/) — なぜ Cloudflare Pages の無料枠で配信しているのか
- [120,677 件の配信設計](/blog/0002-cloudflare-pages-static-zipcode-delivery/) — JSON のチャンク分割と L1/L2 キャッシュ戦略
- [Yubinbango から jpzip-js へ移行する](/blog/0005-migrate-from-yubinbango-js/) — もう一つの代表的な住所自動入力ライブラリからの移行
