---
id: "0005"
title: "Yubinbango から jpzip-js へ移行する: JSONP 脱却と型安全化"
description: jQuery を使わない古典的な Yubinbango から jpzip-js への移行ガイド。JSONP・CSP 制約・TypeScript 型欠如を解消し、microformats h-adr のフォームを薄い互換層で再利用する具体的な手順。
publishedAt: 2026-05-19
author: nadai
tags: [Migration, JavaScript, TypeScript, Forms]
ogEyebrow: 移行ガイド
status: published
faq:
  - q: Yubinbango から jpzip-js に移行するメリットは何ですか?
    a: 'TypeScript 型が同梱される、JSONP を使わずに fetch だけで動くので CSP を緩める必要がない、ESM/CJS の両方をサポート、Node や Cloudflare Workers でもそのまま動く、複数町域(同じ郵便番号で町名が分岐するケース)を `towns` 配列で素直に扱える、の 5 点です。'
  - q: 既存の class="h-adr" / p-postal-code 構成は使い続けられますか?
    a: 'はい。jpzip-js 自体は DOM に触れないので、Yubinbango が行っていた DOM スキャン → 値書き込みの部分だけを 30 行ほどの互換シムに置き換えれば、HTML 側は無修正で動きます。本文後半に互換シムのフルコードを載せています。'
  - q: Yubinbango は jQuery には依存していないと思いますが、それでも書き換える理由は?
    a: 'Yubinbango 本体は jQuery 非依存ですが、ブラウザ向け配布物が npm にない・TypeScript 型がない・JSONP のため CSP `script-src` を yubinbango.github.io に開ける必要がある、という別の問題があります。コードが 2017 年以降ほぼ凍結されている点も合わせて、移行候補としては十分な理由になります。'
  - q: 同じ郵便番号に複数の町域がある場合(towns 配列)はどう扱いますか?
    a: 'jpzip-js は `towns` を配列で返します。多くのフォームは先頭 1 件で十分なので互換シムは `entry.towns[0]` を使えば等価動作になりますが、確定申告などで町名分岐が重要な場合はユーザーに選択させる UI を追加できます。Yubinbango では取れなかった機能です。'
  - q: ライセンスやデータ更新頻度に違いはありますか?
    a: 'Yubinbango のデータ更新は yubinbango-data リポジトリの GitHub Actions で続いており、2026 年 5 月時点でも動いています。jpzip のデータは毎月 1 日と 15 日に自動更新されます。ライセンスは Yubinbango が MIT 相当 (一部リポジトリで LICENSE 不明瞭の指摘あり)、jpzip はコード MIT・データ Public Domain 相当です。'
howTo:
  name: Yubinbango から jpzip-js への移行手順
  description: microformats h-adr 形式の Yubinbango フォームを残したまま、自動入力ロジックだけを jpzip-js に差し替える具体的なステップ。
  steps:
    - name: 既存依存の棚卸し
      text: '`<script src="https://yubinbango.github.io/yubinbango/yubinbango.js">` を読み込んでいる箇所と、`new YubinBango.Core(...)` を直接呼んでいる箇所を grep で洗い出す。h-adr フォームが何箇所あるかを把握する。'
    - name: jpzip-js のインストール
      text: '`npm install @jpzip/jpzip` で `@jpzip/jpzip` を追加する。zero runtime deps なので package.json の dependencies に 1 行増えるだけ。'
    - name: 互換シムを書く
      text: '`yubinbango-shim.ts` を作り、h-adr フォーム上の `.p-postal-code` の input イベントを購読して `jpzip.lookup(zipcode)` を呼び、結果を `.p-region` / `.p-locality` / `.p-street-address` に書き込む。本文中のコードをそのままコピーで動く。'
    - name: <script> タグから ESM import に切り替え
      text: 'HTML から `<script src="https://yubinbango.github.io/yubinbango/yubinbango.js">` を削除し、エントリポイントで `import { initYubinbangoShim } from "./yubinbango-shim"; initYubinbangoShim();` を呼ぶ。'
    - name: CSP を引き締める
      text: 'これまで `script-src` に必要だった `https://yubinbango.github.io` を削除する。jpzip は `connect-src https://jpzip.nadai.dev` だけで動くので、CSP の `script-src` が `self` だけで完結する。'
    - name: 動作確認
      text: '横浜市庁舎 (231-0017) や東京都庁 (163-8001) で手動入力テストを行う。Vitest なら `@testing-library/user-event` と jsdom で互換シムの input → setValue 経路を再現できる。'
---

> jQuery 非依存・JSONP 配信の Yubinbango から、ESM + TypeScript + fetch の jpzip-js に移すための実務ガイドです。HTML 側の `class="h-adr"` 構成は無修正のまま、自動入力ロジックだけを 30 行のシムに差し替えます。

## TL;DR

- **Yubinbango のコードは 2017 年でほぼ凍結**(`yubinbango-core` 0.6.3 / 2016-06-30、`yubinbango` 本体の最後のコード変更は 2017-02-18)。データだけ毎月更新されている
- **JSONP** で 3 桁プレフィックスの `.js` を `<script>` 注入して読む方式は、**CSP `script-src` を緩める** ことを強要する
- **jpzip-js は fetch だけで完結**。`connect-src https://jpzip.nadai.dev` を許可すれば `script-src 'self'` のまま動く
- **HTML 側の `h-adr` フォームは無修正**。30 行の互換シムで `.p-postal-code` → `.p-region`/`.p-locality`/`.p-street-address` の自動入力を再現できる
- 副次効果として **TypeScript 型・ESM/CJS デュアル配布・Node / Cloudflare Workers でも動く・複数町域 (towns 配列) を扱える** が手に入る

## なぜ移行するか

Yubinbango は 10 年以上前から日本語の住所自動入力フォームの de-facto で、現在も多くのサイトで動いています。一方で配布形態の制約から、現代のフロントエンド構成と相性が悪い場面が増えています。

| 比較項目 | Yubinbango | jpzip-js |
|---|---|---|
| パッケージ配布 | 本体は npm 未公開(`yubinbango.github.io` 直リンク)。`yubinbango-core` は npm にあるが最終更新 2016-06-30 | `@jpzip/jpzip` を npm から取得 |
| データ取得 | JSONP (`<script>` 注入 + `window.$yubin(...)` コールバック) | `fetch` で JSON を取得 |
| TypeScript 型 | なし | 同梱 (`.d.ts`) |
| モジュール形式 | グローバル `window.YubinBango` | ESM + CJS のデュアル |
| ランタイム対応 | ブラウザのみ | Node 18+ / Bun / Deno / ブラウザ / Cloudflare Workers / Vercel Edge |
| CSP 影響 | `script-src` に `https://yubinbango.github.io` を許可する必要 | `connect-src https://jpzip.nadai.dev` のみ |
| 複数町域への対応 | 1 件のみ返す | `towns` 配列で全件返す |
| ローマ字・JIS コード | なし | `prefecture_roma` / `city_code` などを同梱 |
| データ更新頻度 | yubinbango-data リポジトリで継続(2026-05-01 が直近) | 月次自動 (`/blog/0002-cloudflare-pages-static-zipcode-delivery/` 参照) |

Yubinbango 自体は **jQuery に依存していません**。これは古い記事でしばしば誤解されている点で、`yubinbango.js` は `document.querySelectorAll` と `addEventListener` を直接使っており、jQuery がなくても動きます。それでも書き換えたい理由は、上の表で挙げた **配布形態・型・CSP・ランタイム互換性**であって、jQuery 依存ではありません。

## 移行手順

### 1. 既存依存の棚卸し

```bash
git grep -n 'yubinbango' -- '*.html' '*.tsx' '*.ts' '*.js' '*.vue' '*.astro'
git grep -n 'YubinBango' -- '*.ts' '*.tsx' '*.js' '*.vue'
git grep -n 'p-postal-code\|h-adr' -- '*.html' '*.tsx' '*.vue' '*.astro'
```

3 つを見ます。

- `yubinbango.js` の `<script>` 読み込み箇所
- `new YubinBango.Core(...)` を直接呼んでいる箇所
- `class="h-adr"` と `class="p-postal-code"` を含む HTML

最後の HTML はそのまま使い続けるので、書き換え対象は最初の 2 つです。

### 2. jpzip-js のインストール

```bash
npm install @jpzip/jpzip
```

zero runtime deps なので、`package.json` の `dependencies` に 1 行増えるだけです。tree-shaking が効くため、`lookup` だけ使う場合のバンドル増加は実測で 4 KiB 程度です(後述の計測セクション)。

### 3. 互換シムを書く

`yubinbango-shim.ts` をプロジェクトに追加します。h-adr フォーム上の `.p-postal-code` の input イベントを購読し、`jpzip.lookup` の結果を都道府県・市区町村・町域に書き込む 30 行ほどのコードです。

```ts
import { lookup } from '@jpzip/jpzip';

const ZIP_RE = /\d{7}/;

const setField = (form: HTMLElement, sel: string, value: string) => {
  const el = form.querySelector<HTMLInputElement>(sel);
  if (el) el.value = value;
};

const fillAddress = async (input: HTMLInputElement) => {
  const form = input.closest<HTMLElement>('.h-adr');
  if (!form) return;
  const raw = input.value.replace(/[^\d]/g, '');
  if (!ZIP_RE.test(raw)) return;
  const entry = await lookup(raw);
  if (!entry) return;
  // 複数町域が返る場合は先頭を採用 (Yubinbango 互換動作)
  const town = entry.towns[0];
  setField(form, '.p-region', entry.prefecture);
  setField(form, '.p-locality', entry.city);
  setField(form, '.p-street-address', town?.town ?? '');
};

export const initYubinbangoShim = () => {
  document.querySelectorAll<HTMLInputElement>('.h-adr .p-postal-code').forEach((input) => {
    input.addEventListener('input', () => {
      void fillAddress(input);
    });
  });
};
```

ポイント:

- **DOM に触れるのはこの 30 行だけ**。`@jpzip/jpzip` 自体は DOM API に依存しないので、別の枠組み(React / Vue / Svelte) に乗せたくなったら `lookup` だけ呼ぶフックに書き換えれば済みます
- `lookup` は `null` を返すケース(該当なし・入力不正)があるため必ず分岐する
- `towns[0]` は Yubinbango 互換動作。複数町域を UI に出したい場合は `towns` をそのまま渡す

### 4. `<script>` タグから ESM import に切り替え

HTML から既存の `<script>` 読み込みを削除します。

```diff
- <script src="https://yubinbango.github.io/yubinbango/yubinbango.js" charset="UTF-8"></script>
```

エントリポイント側で初期化します。

```ts
import { initYubinbangoShim } from './yubinbango-shim';
initYubinbangoShim();
```

`new YubinBango.Core(...)` を直接呼んでいた箇所は、jpzip-js の `lookup` を直接呼ぶ形に書き換えます。

```diff
- new YubinBango.Core(zipcode, (addr) => {
-   form.region.value = addr.region;
-   form.locality.value = addr.locality;
-   form.street.value = addr.street;
- });
+ const entry = await lookup(zipcode);
+ if (entry) {
+   form.region.value = entry.prefecture;
+   form.locality.value = entry.city;
+   form.street.value = entry.towns[0]?.town ?? '';
+ }
```

Yubinbango の `region_id` (JIS 都道府県番号) に相当するのは jpzip では `entry.prefecture_code` です。読み替えてください。

### 5. CSP を引き締める

Yubinbango を使っていたサイトの CSP は、JSONP のため `script-src` に外部オリジンを許可していたはずです。

```diff
- Content-Security-Policy: script-src 'self' https://yubinbango.github.io;
+ Content-Security-Policy: script-src 'self'; connect-src 'self' https://jpzip.nadai.dev;
```

`<script>` 注入が消えるので `script-src` を `'self'` まで絞れます。データ取得は `fetch` 経由なので `connect-src` を許可します。

### 6. 動作確認

横浜市庁舎の郵便番号 **231-0017** (神奈川県横浜市中区本町) と東京都庁の **163-8001** (東京都新宿区西新宿) で手動入力テストを行います。Vitest なら以下のように書けます。

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { initYubinbangoShim } from './yubinbango-shim';

describe('yubinbango-shim', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form class="h-adr">
        <input class="p-postal-code" />
        <input class="p-region" />
        <input class="p-locality" />
        <input class="p-street-address" />
      </form>
    `;
    initYubinbangoShim();
  });

  it('fills address fields when a valid zipcode is typed', async () => {
    const user = userEvent.setup();
    const zip = document.querySelector('.p-postal-code') as HTMLInputElement;
    await user.type(zip, '2310017');
    // jpzip.lookup は network call なので vi.mock しても、msw でモックしても OK
    await vi.waitFor(() => {
      const region = document.querySelector('.p-region') as HTMLInputElement;
      expect(region.value).toBe('神奈川県');
    });
  });
});
```

## ハマりやすい所

- **input イベントの発火頻度**: 7 桁すべて入力された瞬間にだけ `lookup` を呼びたい場合は、シム内で `ZIP_RE.test(raw)` の前にデバウンスを挟むか、`raw.length === 7` で gate する
- **IME 確定タイミング**: 日本語フォームでは `compositionstart` / `compositionend` を考慮していないと、変換確定時に余分な発火が起きる。郵便番号フィールドに IME を使うケースはまれだが、コピペ補完で起きうる
- **複数町域**: 同一郵便番号で町名が分岐するケース(企業向け郵便番号や一部の地域)では `towns.length > 1` になる。先頭採用で問題ないかは要件次第
- **SSR でのフォーム初期描画**: Next.js / Astro などで HTML を静的出力する場合、初期 DOM には `lookup` をかけない。`initYubinbangoShim()` を `useEffect` / `client:load` で遅延させる
- **テストでの実 lookup**: `lookup` は CDN に fetch するので、テストでは MSW (Mock Service Worker) などでスタブする

## 計測した結果

社内サンプルアプリ (Vite + TypeScript、フォーム 3 つ) で計測した実測値です。

| 指標 | Yubinbango | jpzip-js |
|---|---|---|
| 初回 lookup レイテンシ (p50, Tokyo → Cloudflare edge) | 約 180 ms | 約 70 ms |
| 2 回目以降 (キャッシュヒット) | 約 180 ms (毎回 JSONP) | 約 0.3 ms (L1) |
| バンドル増加 (gzip) | 0 (外部 `<script>`) | 約 4 KiB (`lookup` のみ) |
| 必要な CSP `script-src` 追加 | `https://yubinbango.github.io` | なし |
| TypeScript 型 | 自前で declaration file が必要 | 同梱 |

**キャッシュ挙動の差が一番大きい**: Yubinbango は `<script>` 注入のたびに新規 fetch になる(同一プレフィックスでもブラウザキャッシュに任せる以外の手段がない)のに対し、jpzip-js は L1 LRU を持っているので 2 回目以降のレイテンシが事実上ゼロになります。

## まとめ

Yubinbango のコード本体は実質凍結ですが、データ更新は続いていて壊れたわけではありません。とはいえ「JSONP で `script-src` を緩める」「TypeScript 型がない」「Node でも Workers でも動かない」という配布形態の限界は、現代の構成では地味に効いてきます。

jpzip-js への移行は、HTML 側の `class="h-adr"` 構成を残したまま、30 行のシムで完了します。CSP を一段引き締められる副次効果と、月次自動更新の安心感がついてきます。

関連:

- [jpzip の全体像](/blog/0001-cloudflare-pages-micro-saas/) — なぜ Cloudflare Pages の無料枠で配信しているのか
- [120,677 件の配信設計](/blog/0002-cloudflare-pages-static-zipcode-delivery/) — JSON のチャンク分割と L1/L2 キャッシュ戦略
- [Claude / Cursor から MCP 経由で使う](/blog/0003-mcp-server-japanese-postcode/) — MCP サーバーの作り方
