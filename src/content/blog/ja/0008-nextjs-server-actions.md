---
id: "0008"
title: "Next.js App Router の Server Actions で住所自動入力フォームを作る"
description: Next.js 16 App Router の Server Actions で、郵便番号から都道府県・市区町村を引いて自動入力するフォームの作り方。JS 無効でも動く Progressive Enhancement、Edge Runtime での実行、use cache ディレクティブとの組み合わせまで解説します。
publishedAt: 2026-05-21
author: nadai
tags: [Framework Integration, Next.js, TypeScript, Forms, Edge]
ogEyebrow: フレームワーク統合
status: published
faq:
  - q: Server Actions と、クライアント側 onBlur での lookup はどう使い分けますか?
    a: 'Server Actions は lookup をサーバーで実行するので、JavaScript 無効でも動き(Progressive Enhancement)、クライアントの JS バンドルに jpzip-js が乗りません。一方クライアント側 onBlur は入力中の即時フィードバックが速く、サーバーへの往復が要りません。フォーム送信時にまとめて住所を引く設計なら Server Actions、1 文字単位の体験を磨くなら onBlur が向きます。'
  - q: useActionState を使ったフォームは本当に JavaScript 無効でも動きますか?
    a: '動きます。`<form action={formAction}>` は React がネイティブの form 送信に対応させるので、JS 未ロード時はブラウザが通常の POST を送り、サーバーが Server Action を実行して新しい state でページを再描画します。`pending` によるボタン無効化など JS 前提の演出は、JS が無い間は単に効かないだけで、フォーム自体は壊れません。'
  - q: jpzip-js は Next.js の Edge Runtime で動きますか?
    a: '動きます。`@jpzip/jpzip` はランタイム依存ゼロで、プラットフォームの `fetch` だけを使うため、`export const runtime = "edge"` を付けた Route でもそのまま動作します。ただし L1 メモリキャッシュは Edge/サーバーレスのインスタンスを跨いで保持されないので、跨いだ再利用は CDN の HTTP キャッシュ(L3)か、`PersistentCache` を KV に差した L2 に任せます。'
  - q: Next.js 16 では lookup のキャッシュに use cache と unstable_cache のどちらを使うべきですか?
    a: 'Next.js 16 では `use cache` ディレクティブが推奨です。`unstable_cache` も今は動きますが、16 で `use cache`(Cache Components)に置き換えられました。lookup を `async function getAddress(zip) { "use cache"; cacheLife("weeks"); cacheTag("jpzip"); return lookup(zip); }` のようにラップし、`next.config.ts` で `cacheComponents: true` を有効にします。zipcode は引数なのでキャッシュキーに含まれます。'
  - q: Server Action の中で jpzip.lookup を直接呼んでよいですか? 信頼境界はどうなりますか?
    a: '呼んで構いません。Server Action はサーバーで実行されるので、lookup の結果はクライアントを経由せずに得られ、住所解決そのものが信頼境界の内側に入ります。ただし最終的な登録時には、ユーザーが町域や番地を手で書き換えている可能性があるため、再度 `lookup(zipcode)` を呼んで送信された都道府県・市区町村との一致を確認します。'
  - q: 複数町域が返る郵便番号はどう扱いますか?
    a: '`entry.towns` が複数要素を持つ郵便番号(大口事業所向けや一部地域)では、先頭の `towns[0]` を採用するか、`towns` を `<select>` でユーザーに選ばせるかを要件で分けます。EC の配送先入力なら先頭採用で実害は出にくいですが、行政手続きのように正確さが要る場面では選択 UI を出すのが安全です。'
howTo:
  name: Next.js App Router の Server Actions で住所自動入力フォームを実装する
  description: jpzip-js を Server Action から呼び、郵便番号で都道府県・市区町村を自動入力するフォームを Progressive Enhancement・Edge Runtime・use cache 込みで実装する手順。
  steps:
    - name: jpzip-js を入れて前提を整える
      text: '`npm install @jpzip/jpzip` で導入する。ランタイム依存ゼロで、Node・Edge・Workers のいずれでも動く。Next.js 16 の App Router プロジェクトを前提にする。'
    - name: 住所解決の Server Action を書く
      text: 'ファイル先頭に `"use server"` を置き、`resolveAddress(prevState, formData)` を定義する。`formData.get("zipcode")` を 7 桁に整形し、`isValidZipcode` で構文チェックしてから `lookup` を呼び、都道府県・市区町村・町域を含む state を返す。'
    - name: form に配線して Progressive Enhancement を効かせる
      text: 'クライアントコンポーネントで `useActionState(resolveAddress, emptyAddress)` を呼び、返り値の `formAction` を `<form action={formAction}>` に渡す。住所欄は state を反映する読み取り専用フィールドにする。JS 無効時もネイティブ POST で動く。'
    - name: useActionState で pending とエラーを出す
      text: '`useActionState` が返す `pending` で submit ボタンを無効化し、`aria-busy` を立てる。`state.message` を `aria-live="polite"` の output に出して、取得成功・失敗をスクリーンリーダーに伝える。'
    - name: Edge Runtime とキャッシュを設定する
      text: 'Edge で動かすなら Route に `export const runtime = "edge"` を付ける。lookup のキャッシュは `next.config.ts` で `cacheComponents: true` を有効にし、`getAddress` を `"use cache"` + `cacheLife` + `cacheTag` でラップする。Edge では in-memory が跨がないので、跨いだ再利用は CDN(L3)か KV を差した L2 に任せる。'
    - name: 登録 submit でサーバー側に再検証する
      text: '登録の Server Action で再度 `lookup(zipcode)` を呼び、送信された都道府県・市区町村が CDN データと一致しなければ弾く。クライアント表示の自動入力結果を鵜呑みにしない。'
---

> Next.js 16 App Router の Server Actions で、郵便番号から都道府県・市区町村を引いて自動入力するフォームを作ります。lookup をサーバーで実行することで、JavaScript 無効でも動く Progressive Enhancement と、信頼境界がサーバー側に揃う設計が同時に手に入ります。Edge Runtime での実行と use cache ディレクティブとの組み合わせまで含めて、production に置ける形で書きます。

## TL;DR

- **lookup をサーバーで実行する**のが Server Actions 構成の核。クライアントの JS バンドルに `@jpzip/jpzip` が乗らず、住所解決そのものが信頼境界の内側に入る
- `<form action={formAction}>` は React がネイティブ form 送信に対応させるので、**JavaScript 無効でも動く**(Progressive Enhancement)。`useActionState` を使っても PE は壊れない
- 住所欄は `state` を反映する**読み取り専用フィールド**にし、ユーザーが書く番地は別 input に分ける。`defaultValue` と `value` の混在事故を避けられる
- `@jpzip/jpzip` はランタイム依存ゼロで `fetch` だけを使うので、`export const runtime = "edge"` でもそのまま動く。ただし L1 メモリキャッシュは Edge インスタンスを跨がない
- キャッシュは **Next.js 16 の `use cache` ディレクティブ**でラップする。`unstable_cache` は今も動くが 16 で置き換えられた
- **登録 submit ではサーバー側で再 lookup** する。Server Action でも、ユーザーが手で住所を書き換えた可能性は残る

## なぜ Server Actions か

「Next.js 郵便番号 住所自動入力」で出てくる実装は、クライアントの `onChange` / `onBlur` から外部 API や jpzip を直接叩くものが多数です。動きはしますが、lookup の実行がブラウザに固定されます。Server Actions は同じ住所解決をサーバーへ移し、フォームの送信境界とサーバーの信頼境界を一致させます。

設計を決める前に、クライアント側 onBlur(別記事の React Hook Form 構成)と並べて比較します。

| 観点 | クライアント onBlur(RHF) | Server Actions |
|---|---|---|
| lookup の実行場所 | ブラウザ | サーバー |
| JavaScript 無効時 | 動かない | 動く(Progressive Enhancement) |
| クライアント JS バンドル | jpzip-js が乗る | ほぼ乗らない(action は参照だけ) |
| 入力中の即時フィードバック | 速い(往復なし) | 送信時にまとめて解決 |
| キャッシュの主体 | ブラウザ(L1 はタブ単位) | サーバー(use cache / KV で跨げる) |
| 信頼境界 | 別途サーバー再検証が必要 | lookup 自体がサーバー側で完結 |

入力中に 1 文字単位で住所欄を埋めたいなら onBlur が向きます。一方、JS 無効環境を切り捨てたくない、クライアントへ jpzip-js を配りたくない、住所解決をサーバーに集約したい、という要件では Server Actions が噛み合います。本記事は後者を組みます。

## 統合手順

### 1. jpzip-js を入れて前提を整える

```bash
npm install @jpzip/jpzip
```

`@jpzip/jpzip` はランタイム依存ゼロで、プラットフォームの `fetch` だけを使います。Node 18 以上、Bun、Deno、Cloudflare Workers、Vercel Edge のいずれでも同じコードが動きます。前提は Next.js 16 の App Router プロジェクト、React 19 です。

データは `jpzip.nadai.dev` の CDN に静的 JSON(120,677 件)として置かれ、3 桁プレフィックス単位(`/p/231.json` など)で配信されます。SDK はそれを引いて 7 桁の zipcode で索きます。

### 2. 住所解決の Server Action を書く

ファイル先頭に `'use server'` を置き、`useActionState` から呼ぶ前提のシグネチャ(第 1 引数が直前の state、第 2 引数が `FormData`)で書きます。

```ts
// app/actions.ts
'use server';

import { lookup, isValidZipcode } from '@jpzip/jpzip';

export type AddressState = {
  ok: boolean;
  message: string;
  zipcode: string;
  prefecture: string;
  city: string;
  town: string;
};

export const emptyAddress: AddressState = {
  ok: false,
  message: '',
  zipcode: '',
  prefecture: '',
  city: '',
  town: '',
};

export async function resolveAddress(
  _prev: AddressState,
  formData: FormData,
): Promise<AddressState> {
  const zipcode = String(formData.get('zipcode') ?? '').replace(/\D/g, '');

  if (!isValidZipcode(zipcode)) {
    return { ...emptyAddress, zipcode, message: '7 桁の数字で入力してください' };
  }

  const entry = await lookup(zipcode); // ステップ 6 で use cache 版に差し替える
  if (!entry) {
    return { ...emptyAddress, zipcode, message: '該当する郵便番号が見つかりません' };
  }

  return {
    ok: true,
    message: '住所を取得しました',
    zipcode,
    prefecture: entry.prefecture,
    city: entry.city,
    town: entry.towns[0]?.town ?? '',
  };
}
```

`isValidZipcode` は jpzip-js が同梱するヘルパで、`/^\d{7}$/` の構文チェックだけを行います。実在性チェックは `lookup` の戻りが `null` かどうかで判断します。`lookup` は 7 桁でない入力に対してはネットワークを叩かず `null` を返すので、`replace(/\D/g, '')` でハイフンを落としておけば不正値は安全に弾けます。

### 3. form に配線して Progressive Enhancement を効かせる

`useActionState` はクライアントコンポーネントで使います。返り値の `formAction` を `<form action={...}>` に渡すと、React がこの form をネイティブ送信に対応させます。

```tsx
// app/address-form.tsx
'use client';

import { useActionState } from 'react';
import { resolveAddress, emptyAddress } from './actions';

export function AddressForm() {
  const [state, formAction] = useActionState(resolveAddress, emptyAddress);

  return (
    <form action={formAction} className="h-adr">
      <label>
        郵便番号
        <input
          name="zipcode"
          defaultValue={state.zipcode}
          inputMode="numeric"
          maxLength={8}
          required
        />
      </label>
      <button type="submit">住所を検索</button>

      <output role="status" aria-live="polite">{state.message}</output>

      {/* 自動入力する 3 欄は state を反映する読み取り専用フィールド */}
      <label>
        都道府県
        <input name="prefecture" value={state.prefecture} readOnly />
      </label>
      <label>
        市区町村
        <input name="city" value={state.city} readOnly />
      </label>
      <label>
        町域
        <input name="town" value={state.town} readOnly />
      </label>

      {/* 番地・建物名はユーザーが書く独立した input */}
      <label>
        番地・建物名
        <input name="addressLine" />
      </label>
    </form>
  );
}
```

ここが Progressive Enhancement の肝です。JavaScript が無効、あるいはまだロードされていない状態で「住所を検索」を押すと、ブラウザは通常の POST を送ります。サーバーは `resolveAddress` を実行し、新しい `state` を反映したページを返すので、住所欄が埋まった状態で再描画されます。JS が有効なら、React は同じ action を `fetch` で呼び、ページ全体をリロードせずに `state` を更新します。

住所の 3 欄を `value={state.xxx}` の**読み取り専用フィールド**にしているのは意図的です。`defaultValue` はマウント後に `state` が変わっても値が追従しないので、自動入力で書き換わる欄には controlled な `value` を使います。逆に、ユーザーが番地を打つ欄は lookup と無関係なので、`addressLine` という独立した input に分けています。

`231-0017` を引くと、CDN データから次が返ります。

```ts
const entry = await lookup('2310017');
`${entry.prefecture} ${entry.city} ${entry.towns[0].town}`;
// => 神奈川県 横浜市中区 港町
```

例の郵便番号は横浜市中区の `231-0017`(港町)に固定しておくと、見直し時に「これはどこの番号だっけ」と迷いません。

### 4. useActionState で pending とエラーを出す

`useActionState` は 3 つ目の戻り値として `pending` を返します。これで送信中の UI を作ります。

```tsx
'use client';

import { useActionState } from 'react';
import { resolveAddress, emptyAddress } from './actions';

export function AddressForm() {
  const [state, formAction, pending] = useActionState(resolveAddress, emptyAddress);

  return (
    <form action={formAction} className="h-adr">
      <label>
        郵便番号
        <input
          name="zipcode"
          defaultValue={state.zipcode}
          inputMode="numeric"
          maxLength={8}
          aria-busy={pending}
          required
        />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? '検索中…' : '住所を検索'}
      </button>
      <output role="status" aria-live="polite">{state.message}</output>
      {/* 住所欄(ステップ 3 と同じ) */}
    </form>
  );
}
```

`aria-busy={pending}` で補助技術に取得中を伝え、`<output role="status" aria-live="polite">` で「住所を取得しました」「該当する郵便番号が見つかりません」を読み上げさせます。`disabled={pending}` は二重送信の抑制です。

`pending` は JS が無い間は常に `false` のままなので、`disabled={pending}` を付けても Progressive Enhancement は壊れません。JS 未ロードの状態ではボタンが有効なままで、ネイティブ送信がそのまま通ります。

### 5. Edge Runtime で動かす

Route を Edge Runtime に載せるなら、Route セグメント設定を 1 行足すだけです。

```ts
// app/page.tsx
export const runtime = 'edge';
```

`@jpzip/jpzip` はランタイム依存ゼロで `globalThis.fetch` だけを使うので、Edge でも追加対応なく動きます。ただし注意点があります。jpzip-js の L1 LRU キャッシュはプロセスのメモリに載るため、Edge やサーバーレスのようにインスタンスが短命だと、リクエストを跨いで再利用されません。同一インスタンスが暖まっている間の 2 回目以降の lookup は約 0.3 ms で返りますが、cold instance では毎回 CDN を引きに行きます。

跨いだ再利用が欲しい場合は、jpzip-js の `PersistentCache`(L2)を KV に差します。キーは prefix バケットの URL、値は生の JSON バイト列です。

```ts
// app/jpzip.ts
import { JpzipClient, type PersistentCache } from '@jpzip/jpzip';

// Cloudflare KV / Vercel KV などを L2 に。KV はプラットフォームのバインディングを使う。
const kvCache: PersistentCache = {
  async get(key) {
    const buf = await KV.get(key, 'arrayBuffer');
    return buf ? new Uint8Array(buf) : null;
  },
  async set(key, value) {
    await KV.put(key, value, { expirationTtl: 60 * 60 * 24 * 7 });
  },
  async delete(key) {
    await KV.delete(key);
  },
  async clear() {
    // 全消しはしない。prefix 単位の delete で運用する
  },
};

export const jpzip = new JpzipClient({ cache: kvCache });
```

そのうえで Server Action 内の `lookup` を `jpzip.lookup` に差し替えれば、最初に prefix バケットを引いたインスタンスが KV に書き、他インスタンスは L2 ヒットで CDN を叩かずに済みます。L2 を入れない場合でも、CDN の HTTP キャッシュ(L3)は全 POP で効くので、cold instance でも CDN エッジヒットで十分速く返ります。

### 6. use cache で lookup をキャッシュする

Next.js のサーバー側でも住所解決をキャッシュできます。Next.js 16 では `use cache` ディレクティブ(Cache Components)が推奨です。まず `next.config.ts` で有効にします。

```ts
// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  cacheComponents: true,
};

export default nextConfig;
```

lookup を `'use cache'` を付けた関数でラップします。

```ts
// app/address-cache.ts
import { lookup } from '@jpzip/jpzip';
import { cacheLife, cacheTag } from 'next/cache';
import type { ZipcodeEntry } from '@jpzip/jpzip';

export async function getAddress(zipcode: string): Promise<ZipcodeEntry | null> {
  'use cache';
  cacheLife('weeks'); // 月次更新サイクルより十分短い
  cacheTag('jpzip'); // データ更新時に revalidateTag('jpzip') で一括無効化
  return lookup(zipcode);
}
```

ステップ 2 の Server Action の `await lookup(zipcode)` を `await getAddress(zipcode)` に差し替えれば完成です。`zipcode` は引数なので、`use cache` のキャッシュキーに自動で含まれ、郵便番号ごとに別エントリになります。

`use cache` のスコープ内では `cookies()` や `headers()` を読めません。住所解決は zipcode しか要らないので制約に当たりませんが、リクエスト固有の値が必要なときは、スコープの外で読んで引数として渡すのが原則です。

旧来の `unstable_cache` も今は動きますが、Next.js 16 で `use cache` に置き換えられました。移行できない事情があるなら `unstable_cache(async (zip) => lookup(zip), ['jpzip'], { revalidate: 604800, tags: ['jpzip'] })` の形で当面は使えます。

注意として、`use cache` の in-memory ストレージはサーバーレス/Edge ではリクエストを跨いで保持されない場合があります。Node サーバーや self-host では跨いで効きます。Edge 中心の構成では、ステップ 5 の CDN(L3)や KV(L2)を主たるキャッシュ層に据えるほうが現実的です。

### 7. 登録 submit でサーバー側に再検証する

住所欄を自動入力した後でも、ユーザーは町域や番地を手で書き換えられます。Server Action はサーバーで動くとはいえ、表示済みの住所をそのまま信用してはいけません。登録の action で再度 lookup して一致を確認します。

```ts
// app/actions.ts(続き)
export async function register(_prev: unknown, formData: FormData) {
  const zipcode = String(formData.get('zipcode') ?? '').replace(/\D/g, '');
  const entry = await lookup(zipcode);

  if (!entry) {
    return { ok: false, message: '郵便番号が不正です' };
  }
  if (
    entry.prefecture !== formData.get('prefecture') ||
    entry.city !== formData.get('city')
  ) {
    return { ok: false, message: '郵便番号と住所が一致しません' };
  }

  // 永続化
  return { ok: true, message: '登録しました' };
}
```

都道府県・市区町村まで一致を見れば、フォームを直接 POST で叩く改ざんもここで弾けます。町域はユーザーが番地を足すため、厳密一致は要求しないのが現実的です。住所解決の `resolveAddress` と登録の `register` を 1 つの form に同居させたいときは、submit ボタンに `formAction` を渡して 2 つの action を出し分けられます(React の `<form>` ドキュメントの multiple submission types を参照)。

## ハマりやすい所

- **action のシグネチャを間違える**: `useActionState` から呼ぶ action は第 1 引数が直前の `state`、第 2 引数が `FormData` です。`(formData) => ...` のまま渡すと、`formData` の位置に `state` が入って動きません
- **自動入力欄に `defaultValue` を使う**: `defaultValue` はマウント後に値が追従しません。lookup で書き換わる欄は controlled な `value`(読み取り専用なら `readOnly`)にします。ユーザーが打つ番地は逆に別 input に分けて干渉を避けます
- **自動入力欄を `disabled` にする**: `disabled` な input は送信されません。読み取り専用にしたいだけなら `readOnly` を使います。`readOnly` の値は POST に含まれます
- **`use cache` 内で `cookies()` / `headers()` を読む**: スコープ内では読めません。必要なら外で読んで引数で渡します。zipcode のように引数で渡した値はキャッシュキーに入ります
- **Edge で in-memory キャッシュが跨がる前提にする**: L1 も `use cache` の in-memory も、Edge/サーバーレスのインスタンスを跨いで保持されるとは限りません。跨ぎたいなら CDN(L3)か KV を差した L2 に寄せます
- **複数町域の扱いを決め忘れる**: `towns.length > 1` の郵便番号で `towns[0]` 採用すると、用途によっては誤入力になります。EC なら先頭採用、行政手続きなら `<select>` で選択、と要件で分けます

## 動作確認

`resolveAddress` は素の関数なので、`FormData` を組んで直接呼べばロジックを単体テストできます。実 CDN を叩きたくないので `@jpzip/jpzip` をモックします。

```ts
// app/actions.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@jpzip/jpzip', () => ({
  isValidZipcode: (z: string) => /^\d{7}$/.test(z),
  lookup: vi.fn(async (zip: string) =>
    zip === '2310017'
      ? { prefecture: '神奈川県', city: '横浜市中区', towns: [{ town: '港町' }] }
      : null,
  ),
}));

import { resolveAddress, emptyAddress } from './actions';

describe('resolveAddress', () => {
  it('有効な郵便番号で住所を返す', async () => {
    const fd = new FormData();
    fd.set('zipcode', '231-0017'); // ハイフン入りでも整形される
    const state = await resolveAddress(emptyAddress, fd);
    expect(state.prefecture).toBe('神奈川県');
    expect(state.city).toBe('横浜市中区');
    expect(state.town).toBe('港町');
    expect(state.message).toBe('住所を取得しました');
  });

  it('見つからない郵便番号はエラー state を返す', async () => {
    const fd = new FormData();
    fd.set('zipcode', '0000000');
    const state = await resolveAddress(emptyAddress, fd);
    expect(state.ok).toBe(false);
    expect(state.message).toBe('該当する郵便番号が見つかりません');
  });
});
```

`use cache` でラップした `getAddress` は Next.js のランタイム前提なので、単体テストではなく実際に起動したアプリで結合確認するのが手堅いです。Progressive Enhancement の検証は、ブラウザの開発者ツールで JavaScript を無効化し、フォーム送信で住所欄が埋まることを確認します。これが no-JS 経路の最終チェックです。

## まとめ

Next.js の Server Actions で住所自動入力を組むと、lookup の実行がサーバーに移り、Progressive Enhancement と信頼境界の一致が同時に手に入ります。`<form action={formAction}>` と `useActionState` の組み合わせは、JS 有効時は pending 付きの滑らかな UX、JS 無効時はネイティブ送信、という二段構えを 1 つのコンポーネントで満たします。

自動入力欄を controlled な読み取り専用フィールドにし、Edge では in-memory キャッシュを当てにせず CDN(L3)か KV(L2)に寄せ、Next.js 16 では `use cache` でラップする。最後に登録 submit でサーバー側 re-validation を入れれば、production フォームとしての品質に届きます。

関連:

- [React Hook Form + Zod + jpzip](/blog/0006-react-hook-form-zod/) — 同じ lookup をクライアント側 onBlur で組む場合
- [Rails + Hotwire + jpzip-ruby](/blog/0007-rails-hotwire-form/) — サーバー側で住所欄を組み立てる別フレームワークの例
- [jpzip の全体像](/blog/0001-cloudflare-pages-micro-saas/) — なぜ CDN 静的配信モデルなのか
- [Next.js: Server Actions でフォームを作る](https://nextjs.org/docs/app/guides/forms) — 公式の forms ガイド
- [Next.js: use cache ディレクティブ](https://nextjs.org/docs/app/api-reference/directives/use-cache) — Cache Components の公式リファレンス
</content>
