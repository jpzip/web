---
id: "0005"
title: "Migrating from Yubinbango to jpzip-js: drop JSONP, gain types"
description: A step-by-step migration from JSONP-based Yubinbango to jpzip-js. Keep your microformats h-adr forms intact, switch to fetch-only data loading, and tighten your CSP.
lang: en
publishedAt: 2026-05-19
author: nadai
tags: [Migration, JavaScript, TypeScript, Forms]
ogEyebrow: Migration guide
status: draft
faq:
  - q: What do I actually gain by migrating from Yubinbango to jpzip-js?
    a: 'Five things: bundled TypeScript types, fetch-only data loading (no JSONP, no global callback pollution), proper ESM and CJS exports, support for Node / Cloudflare Workers / Vercel Edge in addition to browsers, and a `towns` array that surfaces multi-town entries that Yubinbango silently collapsed.'
  - q: Can I keep my existing `class="h-adr"` markup and microformats fields?
    a: 'Yes. jpzip-js itself never touches the DOM, so all you replace is the DOM-scanning glue layer that Yubinbango shipped. A 30-line shim that listens on `.p-postal-code` and writes back to `.p-region` / `.p-locality` / `.p-street-address` is enough to keep your HTML untouched.'
  - q: Yubinbango is not actually jQuery-dependent, so why bother migrating?
    a: 'Correct — Yubinbango uses plain DOM APIs, not jQuery. The reasons to migrate are different: the browser bundle is not published to npm, there are no TypeScript types, the JSONP data fetch forces you to relax your CSP `script-src`, and the core code has not changed since 2017-02-18.'
  - q: What is microformats h-adr and why does this article keep mentioning it?
    a: '`h-adr` is the [microformats2](https://microformats.org/wiki/h-adr) class-based markup convention for postal addresses (e.g. `.p-postal-code`, `.p-region`, `.p-locality`). Yubinbango piggybacks on it: any form with `class="h-adr"` and a `.p-postal-code` input becomes a candidate for auto-fill. The shim in this article reuses the same convention so your existing HTML keeps working.'
  - q: How are multi-town postcodes handled?
    a: 'Some Japanese postcodes — especially business postcodes (大口事業所個別番号) and split rural areas — map to several town names. jpzip-js returns them as a `towns` array. The compatibility shim uses `towns[0]` for Yubinbango parity, but you can expose all entries to your UI if disambiguation matters.'
  - q: Is the data still being updated for both libraries?
    a: 'Yubinbango’s data repository (`yubinbango-data`) is still auto-updated via GitHub Actions — the last push was 2026-05-01. jpzip refreshes its CDN dataset on the 1st and 15th of every month. Neither side is data-stale; the migration is about the library code and distribution model.'
howTo:
  name: Migrate a Yubinbango-driven form to jpzip-js
  description: Replace Yubinbango’s JSONP-based auto-fill with a fetch-based jpzip-js shim while keeping the microformats h-adr markup untouched.
  steps:
    - name: Inventory existing usage
      text: 'Grep for `yubinbango`, `YubinBango.Core`, and `h-adr` / `p-postal-code` across HTML and component files. The HTML stays; the JS references will be replaced.'
    - name: Install jpzip-js
      text: 'Run `npm install @jpzip/jpzip`. It has zero runtime dependencies and gzips to about 4 KiB when only `lookup` is imported.'
    - name: Write the compatibility shim
      text: 'Create `yubinbango-shim.ts`. It listens for `input` events on `.p-postal-code` inside any `.h-adr` form, calls `lookup(zipcode)`, and writes back to `.p-region` / `.p-locality` / `.p-street-address`. The full code is in the article body.'
    - name: Swap the <script> tag for an ESM import
      text: 'Remove the `<script src="https://yubinbango.github.io/yubinbango/yubinbango.js">` tag from your HTML. Import and call `initYubinbangoShim()` from your entry point instead.'
    - name: Tighten your CSP
      text: 'Drop `https://yubinbango.github.io` from `script-src`. Add `https://jpzip.nadai.dev` to `connect-src` if you maintain a strict CSP. `script-src` can stay at `''self''`.'
    - name: Verify against real postcodes
      text: 'Test with Yokohama City Hall (231-0017) and Tokyo Metropolitan Government (163-8001). Mock the network with MSW or a Vitest spy if your test suite is hermetic.'
---

> A practical migration guide from JSONP-based Yubinbango to jpzip-js. The HTML stays untouched. A 30-line shim handles the rest.

## TL;DR

- **Yubinbango’s code has been effectively frozen since 2017** (`yubinbango-core` 0.6.3 / 2016-06-30, `yubinbango` proper’s last code change is 2017-02-18). Only the **data** repo still ships monthly updates
- **JSONP** — injecting a `<script>` for each 3-digit prefix that calls `window.$yubin(...)` — forces your Content-Security-Policy to allow `script-src https://yubinbango.github.io`
- **jpzip-js is fetch-only**, so `script-src 'self'` and an allow-listed `connect-src https://jpzip.nadai.dev` are enough
- **Keep your `h-adr` markup as is.** A 30-line shim reproduces Yubinbango’s `.p-postal-code` → `.p-region`/`.p-locality`/`.p-street-address` auto-fill
- You also gain **TypeScript types, ESM + CJS dual builds, runtime support for Node / Bun / Deno / Cloudflare Workers / Vercel Edge, and proper handling of multi-town postcodes** via a `towns` array

## Background: what is Yubinbango (and h-adr)?

[Yubinbango](https://yubinbango.github.io/) is the de-facto Japanese postal-code auto-fill library on the web. Drop a `<script>` tag in your page, mark a form with `class="h-adr"`, and any 7-digit postcode typed into `.p-postal-code` triggers Yubinbango to fill `.p-region` (都道府県), `.p-locality` (市区町村), and `.p-street-address` (町域).

The `h-adr` and `p-*` class names come from the [microformats2 address vocabulary](https://microformats.org/wiki/h-adr). Yubinbango piggybacks on this vocabulary so the same markup can be machine-read for other purposes.

The underlying data is Japan Post’s [`KEN_ALL.csv`](https://www.post.japanpost.jp/zipcode/dl/kogaki-zip.html) — the official monthly export of all 120,677 Japanese postcode entries. Both Yubinbango and jpzip normalize this CSV to JSON, but they distribute it very differently (see the table below).

## Why migrate

| Concern | Yubinbango | jpzip-js |
|---|---|---|
| Package distribution | Browser bundle not on npm (loaded from `yubinbango.github.io`). `yubinbango-core` is on npm but last published 2016-06-30 | `@jpzip/jpzip` on npm, current |
| Data fetch mechanism | JSONP (`<script>` injection + `window.$yubin(...)` callback) | `fetch` for JSON |
| TypeScript types | None shipped | Bundled `.d.ts` |
| Module format | Global `window.YubinBango` | ESM + CJS dual |
| Runtime support | Browser only | Node 18+, Bun, Deno, browser, Cloudflare Workers, Vercel Edge |
| CSP impact | Requires `script-src https://yubinbango.github.io` | `connect-src https://jpzip.nadai.dev` only |
| Multi-town entries | Returns one entry only | Returns `towns` array |
| Romaji + government codes | Not exposed | `prefecture_roma`, `city_code` included |
| Data refresh cadence | Auto-updated via `yubinbango-data` GitHub Actions (last push 2026-05-01) | Auto-updated 1st and 15th of every month |

**Note that Yubinbango itself does not depend on jQuery** — a common misconception. `yubinbango.js` uses `document.querySelectorAll` and `addEventListener` directly. The reasons to migrate are the distribution model, missing types, CSP friction, and the inability to run anywhere outside the browser — not jQuery.

## Migration steps

### 1. Inventory existing usage

```bash
git grep -n 'yubinbango' -- '*.html' '*.tsx' '*.ts' '*.js' '*.vue' '*.astro'
git grep -n 'YubinBango' -- '*.ts' '*.tsx' '*.js' '*.vue'
git grep -n 'p-postal-code\|h-adr' -- '*.html' '*.tsx' '*.vue' '*.astro'
```

Three things to find:

- `<script>` tags loading `yubinbango.js`
- Direct calls to `new YubinBango.Core(...)`
- HTML using `class="h-adr"` and `class="p-postal-code"`

The HTML stays put. Only the first two are rewritten.

### 2. Install jpzip-js

```bash
npm install @jpzip/jpzip
```

Zero runtime dependencies. When only `lookup` is imported, the gzipped bundle delta is about 4 KiB (measured in the section below).

### 3. Write the compatibility shim

Add `yubinbango-shim.ts` to your project. It listens on `.p-postal-code` inputs inside `.h-adr` forms, calls `jpzip.lookup`, and writes the result back to the address fields — about 30 lines.

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
  // Yubinbango parity: pick the first town when several share a postcode
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

Key points:

- **Only these 30 lines touch the DOM.** `@jpzip/jpzip` itself is DOM-free, so if you later move to React / Vue / Svelte, you replace the shim with a hook calling `lookup` directly
- `lookup` returns `null` for not-found postcodes and malformed input — always branch on it
- `towns[0]` matches Yubinbango behavior. If you want to expose disambiguation UI for multi-town postcodes, surface `entry.towns` to your form layer

### 4. Swap the `<script>` tag for an ESM import

Delete the `<script>` tag from your HTML:

```diff
- <script src="https://yubinbango.github.io/yubinbango/yubinbango.js" charset="UTF-8"></script>
```

Initialize the shim from your entry point:

```ts
import { initYubinbangoShim } from './yubinbango-shim';
initYubinbangoShim();
```

If you were calling `new YubinBango.Core(...)` directly, replace it with a `lookup` call:

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

Yubinbango’s `region_id` (the JIS prefecture number) maps to `entry.prefecture_code` in jpzip.

### 5. Tighten your CSP

A site using Yubinbango had to allow JSONP fetches:

```diff
- Content-Security-Policy: script-src 'self' https://yubinbango.github.io;
+ Content-Security-Policy: script-src 'self'; connect-src 'self' https://jpzip.nadai.dev;
```

The `<script>` injection is gone, so `script-src` can drop down to `'self'`. Data flows through `fetch`, which is governed by `connect-src`.

### 6. Verify against real postcodes

Manual test with Yokohama City Hall (**231-0017**, 神奈川県横浜市中区本町) and Tokyo Metropolitan Government Building (**163-8001**, 東京都新宿区西新宿). Both are public landmarks with stable postcodes — useful for regression tests.

A Vitest spec:

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

  it('fills address fields when a valid postcode is typed', async () => {
    const user = userEvent.setup();
    const zip = document.querySelector('.p-postal-code') as HTMLInputElement;
    await user.type(zip, '2310017');
    // Mock the network with MSW or vi.mock against @jpzip/jpzip
    await vi.waitFor(() => {
      const region = document.querySelector('.p-region') as HTMLInputElement;
      expect(region.value).toBe('神奈川県');
    });
  });
});
```

## Common pitfalls

- **Firing on every keystroke**: if you only want one `lookup` when 7 digits are present, gate with `raw.length === 7` or debounce the handler
- **IME composition events**: Japanese forms with IME-enabled inputs can fire `input` mid-composition; handle `compositionstart` / `compositionend` if you observe stray triggers (rare for postcode fields, but possible on paste-from-clipboard)
- **Multi-town entries**: business postcodes and some rural splits return `towns.length > 1`. Decide whether `towns[0]` is acceptable or whether you need a selection UI
- **SSR-rendered forms**: in Next.js or Astro, don’t run `lookup` against the server-side HTML. Defer `initYubinbangoShim()` to `useEffect` / `client:load`
- **Tests against real network**: `lookup` hits the CDN. Use MSW (Mock Service Worker) or a `vi.mock` against `@jpzip/jpzip` in your test environment

## Measured results

Numbers from an internal Vite + TypeScript sample app with three h-adr forms:

| Metric | Yubinbango | jpzip-js |
|---|---|---|
| First lookup latency (p50, Tokyo → Cloudflare edge) | ~180 ms | ~70 ms |
| Repeat lookups (cache hit) | ~180 ms (each JSONP refetches) | ~0.3 ms (L1 LRU) |
| Bundle size delta (gzip) | 0 (external `<script>`) | ~4 KiB (`lookup` only) |
| Required CSP `script-src` addition | `https://yubinbango.github.io` | none |
| TypeScript types | declaration file must be hand-rolled | bundled |

**The cache-hit gap is the big one.** Yubinbango re-injects a `<script>` for every lookup (browser cache is the only mitigation), while jpzip-js short-circuits repeat lookups through its in-memory L1 LRU.

## Summary

Yubinbango’s core code is effectively frozen but its data is current and the library still works. Its limitations — JSONP-driven CSP relaxation, no TypeScript types, no non-browser runtime — show up gradually as your front-end stack modernizes.

The migration to jpzip-js is small in scope: keep the `class="h-adr"` markup, swap a `<script>` tag for a 30-line shim, and tighten one CSP directive. The side effects are a stricter CSP, free Node / Workers / Edge support, and a less brittle data refresh cadence.

Related reading:

- [The jpzip project overview](/blog/0001-cloudflare-pages-micro-saas/) — why this is delivered as a static dataset on Cloudflare Pages
- [Serving 120,677 entries from static JSON](/blog/0002-cloudflare-pages-static-zipcode-delivery/) — chunking strategy and the L1 / L2 cache layout
- [MCP server for Japanese postcodes](/blog/0003-mcp-server-japanese-postcode/) — using jpzip from Claude / Cursor through MCP
