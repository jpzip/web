---
id: "0009"
title: "Migrating from zipcoda to jpzip-js: live API to static CDN"
description: Move from the zipcoda.net runtime postcode API to jpzip-js's static CDN model — response field mapping, JSONP and CSP cleanup, dropping rate-limit workarounds, and measured latency and cache wins.
lang: en
publishedAt: 2026-05-22
author: nadai
tags: [Migration, JavaScript, TypeScript, CDN]
ogEyebrow: Migration guide
status: published
faq:
  - q: What do I actually gain by migrating from zipcoda to jpzip-js?
    a: 'The main win is removing a runtime dependency on a third-party API server (zipcoda.net). jpzip-js only fetches JSON from a static CDN, so the server''s availability, rate limiting ("過度なアクセスは固くお断りします" — excessive access is refused), and outages no longer decide whether your form fills addresses. You also gain bundled TypeScript types, an L1 LRU plus optional L2 cache, support for Node / Cloudflare Workers / Vercel Edge, and romaji and government codes on every entry.'
  - q: Does zipcoda require JSONP?
    a: 'No. zipcoda now supports CORS, and its own documentation marks JSONP (the callback parameter) as deprecated. But plenty of sites still run the `<script>`-injection code written during the JSONP era, and those sites usually allow `zipcoda.net` in their CSP `script-src`. This guide covers migrating from both the JSONP and the fetch-based integrations.'
  - q: Can jpzip-js replace zipcoda''s reverse lookup (address to postcode)?
    a: 'No. jpzip-js does postcode-to-address lookup only; it has no API for going from an address string back to a postcode. If you use zipcoda''s `address` parameter for reverse lookup, that path has no direct equivalent. You can fetch the whole dataset with `lookupAll()` (~37 MiB JSON) and build your own reverse index, but whether that is worth it depends on your use case.'
  - q: How do zipcoda''s pref / address / components map to jpzip fields?
    a: 'zipcoda''s `items[0].pref` (神奈川県 / Kanagawa) maps to jpzip''s `entry.prefecture`; `components[1]` (横浜市中区 / Yokohama Naka Ward) maps to `entry.city`; and `components[2]` (港町 / Minatocho) maps to `entry.towns[0].town`. zipcoda''s `address` field is the city-and-town string with the prefecture stripped; rebuild it in jpzip with `entry.city + entry.towns[0].town`. jpzip additionally returns `prefecture_code`, `city_code`, and romaji fields.'
  - q: Will postcodes for large buildings like government offices resolve?
    a: 'A postcode such as 163-8001 (the Tokyo Metropolitan Government building) is a business postcode (大口事業所個別番号) and is not part of Japan Post''s KEN_ALL.csv. Because both jpzip and zipcoda are built from KEN_ALL, neither resolves it — this is a shared limitation, not something the migration changes. Ordinary town-level postcodes (for example 231-0017 → 神奈川県 横浜市中区 港町) resolve correctly in both.'
  - q: How does rate limiting change after migrating?
    a: 'zipcoda throttles repeated requests from the same IP, so a busy production form — or several users behind one NAT — can quietly fail to autofill. jpzip-js reads from a static CDN (Cloudflare Pages) with no stated rate limit. Any debounce or retry-suppression you added to protect the zipcoda server can be removed, or repurposed purely for UX (such as waiting for all seven digits before looking up).'
howTo:
  name: Migrate a zipcoda-driven form to jpzip-js
  description: Replace runtime calls to the zipcoda.net postcode API with jpzip-js's static CDN lookups.
  steps:
    - name: Inventory existing zipcoda usage
      text: 'Grep for `zipcoda.net`, `callback=`, and `&zipcode=` to find both the JSONP `<script>` injections and the fetch calls. If any code uses the `address=` parameter for reverse lookup, separate it out — jpzip-js cannot replace reverse lookup.'
    - name: Install jpzip-js
      text: 'Run `npm install @jpzip/jpzip`. It has zero runtime dependencies and gzips to about 4 KiB when only `lookup` is imported.'
    - name: Map the response and swap to lookup()
      text: 'Read zipcoda''s `items[0].pref` / `components` / `address` into jpzip''s `entry.prefecture` / `entry.city` / `entry.towns[0].town`. `lookup` returns `null` for not-found postcodes and malformed input, so always branch on it.'
    - name: Remove the JSONP script injection if present
      text: 'Delete the global callback function and the dynamic `<script src="https://zipcoda.net/api?...&callback=...">` injection. If you were already using a fetch-based zipcoda integration, skip this step.'
    - name: Tighten the CSP and revisit rate-limit workarounds
      text: 'Drop `zipcoda.net` from the CSP (`script-src` for JSONP, `connect-src` for fetch) and allow `connect-src https://jpzip.nadai.dev`. Remove server-protection debounce/retry code, or repurpose it for UX.'
    - name: Verify against a real postcode
      text: 'Manually test with 231-0017 (神奈川県 横浜市中区 港町 — Naka Ward, Yokohama). In Vitest, stub jpzip.nadai.dev with MSW and assert the input-to-field path.'
---

> A practical guide for moving from the zipcoda.net postcode API to jpzip-js's static CDN lookups. Your form markup stays put; only the data-fetch path changes — from a round trip to a third-party API into a CDN fetch backed by a local cache.

## TL;DR

- **zipcoda depends on a third-party API server (`https://zipcoda.net/api`) at runtime.** That server's availability, rate limiting, and outages become your form's address-autofill reliability
- **jpzip-js only fetches JSON from a static CDN.** It reads from a Cloudflare Pages edge with no stated rate limit, and an L1 LRU (plus optional L2) makes repeat lookups effectively zero-latency
- **The migration is a one-function swap.** Read `pref` / `components` / `address` into `prefecture` / `city` / `towns[0].town`
- zipcoda now **supports CORS and marks JSONP as deprecated**. If you still inject `<script>` tags, you can drop both the injection and the CSP `script-src` allowance at once
- One caveat: **zipcoda's reverse lookup (address to postcode) has no equivalent in jpzip-js.** Carve any reverse-lookup path out of the migration

## Background: what are zipcoda and KEN_ALL?

[zipcoda](https://zipcoda.net/doc) is a free Japanese postcode service at `zipcoda.net`. It converts both directions — postcode to address and address to postcode — needs no API key, and supports both CORS and (deprecated) JSONP. Its convenience made it a common choice for address-autofill forms.

The data behind it, like jpzip's, comes from Japan Post's [`KEN_ALL.csv`](https://www.post.japanpost.jp/zipcode/download.html): the official monthly CSV export of all 120,677 Japanese postcode entries. Both projects normalize the same source CSV into JSON. The difference is not the data — it is how the data reaches the browser.

A request to zipcoda looks like this:

```bash
curl 'https://zipcoda.net/api?zipcode=2310017'
```

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

Every autofill is a live round trip to that server.

## Why migrate

Having your form reach a third-party API server **at runtime, on every lookup** is a structural risk in production, regardless of how reliable that server happens to be today.

| Concern | zipcoda | jpzip-js |
|---|---|---|
| Data-fetch model | Dynamic API (the `zipcoda.net` server responds) | Static CDN JSON (edge-cached) |
| Origin | A single API server | Cloudflare Pages edge |
| Client | No npm package (hand-rolled fetch / JSONP) | `@jpzip/jpzip` on npm |
| Rate limiting | Yes — refuses excessive access, throttles per IP | None stated (static delivery) |
| Transport | fetch (CORS); legacy JSONP, now deprecated | fetch only |
| TypeScript types | None | Bundled `.d.ts` |
| Caching | Left to the browser | L1 LRU + optional L2 (`preload` warms the whole set) |
| Romaji + government codes | Not exposed | `prefecture_roma`, `city_code`, and more included |
| Reverse lookup (address → postcode) | Yes (`address` parameter) | No (postcode → address only) |
| Runtime support | Browser-centric | Node 18+, Bun, Deno, browser, Cloudflare Workers, Vercel Edge |
| Data refresh cadence | Unstated | Auto-updated monthly (see [the delivery design](/blog/0002-cloudflare-pages-static-zipcode-delivery/)) |

zipcoda's documentation explicitly states "過度なアクセスは固くお断りします" ("excessive access is firmly refused") and throttles repeated requests from one IP. You will not notice this in development, but a traffic spike — or several users behind a single NAT — can make autofill **fail silently** in production. Because jpzip-js reads from a static CDN, that whole failure axis disappears.

### The one thing you cannot migrate: reverse lookup

State this up front. zipcoda's `address` parameter performs **reverse lookup** — an address string to a postcode. jpzip-js does **postcode-to-address lookup only** and has no reverse-lookup API. For any reverse-lookup path, you either fetch the full dataset with `lookupAll()` (~37 MiB) and build your own reverse index, or keep a separate service. This article covers the postcode-to-address direction.

## Migration steps

### 1. Inventory existing zipcoda usage

```bash
git grep -n 'zipcoda.net' -- '*.html' '*.tsx' '*.ts' '*.js' '*.vue' '*.astro'
git grep -n 'callback=' -- '*.ts' '*.tsx' '*.js'
git grep -n 'address=' -- '*.ts' '*.tsx' '*.js'
```

Three things to find:

- JSONP injections of `<script src="https://zipcoda.net/api?...&callback=...">`
- Direct `fetch('https://zipcoda.net/api?zipcode=...')` calls
- Any `address=` reverse lookup (carve it out of the migration)

### 2. Install jpzip-js

```bash
npm install @jpzip/jpzip
```

Zero runtime dependencies, so this adds one line to `dependencies`. With tree-shaking, importing only `lookup` adds about 4 KiB gzipped (measured in the section below).

### 3. Map the response and swap to `lookup()`

zipcoda returns the shape shown earlier. jpzip-js's `lookup('2310017')` returns this `entry`:

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

The field mapping:

| Purpose | zipcoda (`items[0]`) | jpzip-js (`entry`) |
|---|---|---|
| Prefecture | `pref` / `components[0]` | `prefecture` |
| City / ward | `components[1]` | `city` |
| Town | `components[2]` | `towns[0].town` |
| Joined address (below prefecture) | `address` | build from `city + towns[0].town` |
| Prefecture code | — | `prefecture_code` |
| City code | — | `city_code` |
| Romaji | — | `prefecture_roma` / `city_roma` / `towns[0].roma` |
| Multiple matches for one code | `items` (array) | `towns` (array) |

**Before** (calling zipcoda over fetch):

```ts
type ZipcodaItem = { zipcode: string; pref: string; components: string[]; address: string };
type ZipcodaResponse = { status: number; length: number; items: ZipcodaItem[] };

async function fillFromZipcoda(zip: string, form: HTMLFormElement) {
  const res = await fetch(`https://zipcoda.net/api?zipcode=${zip}`);
  const data = (await res.json()) as ZipcodaResponse;
  if (data.length === 0) return;
  const item = data.items[0];
  form.pref.value = item.pref;        // 神奈川県
  form.city.value = item.address;     // 横浜市中区港町 (city and town combined)
}
```

**After** (swapping in jpzip-js's `lookup`):

```ts
import { lookup } from '@jpzip/jpzip';

async function fillFromJpzip(zip: string, form: HTMLFormElement) {
  const entry = await lookup(zip);    // null for not-found or malformed input
  if (entry === null) return;
  const town = entry.towns[0]?.town ?? '';
  form.pref.value = entry.prefecture; // 神奈川県
  form.city.value = entry.city;       // 横浜市中区
  form.town.value = town;             // 港町
}
```

zipcoda's `address` packed the city and town into one field. If you want them separated, this migration is the moment to do it: jpzip-js returns `city` and `towns[0].town` already split.

### 4. Remove the JSONP script injection if present

Code from the JSONP era typically defined a global callback and injected a `<script>` for each lookup:

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

Delete the whole thing and replace it with the `lookup` call from step 3. With the global callback and `<script>` injection gone, you can tighten the CSP next. If you already used a fetch-based zipcoda integration, skip this step.

### 5. Tighten the CSP and revisit rate-limit workarounds

A site using zipcoda allowed `zipcoda.net` in its CSP — `script-src` for JSONP, `connect-src` for fetch:

```diff
- Content-Security-Policy: script-src 'self' https://zipcoda.net; connect-src 'self' https://zipcoda.net;
+ Content-Security-Policy: script-src 'self'; connect-src 'self' https://jpzip.nadai.dev;
```

With the `<script>` injection gone, `script-src` can drop to `'self'`. Data flows through fetch, governed by `connect-src https://jpzip.nadai.dev`.

If you added a debounce or retry suppression to avoid zipcoda's throttling, reconsider its purpose. jpzip-js already retries up to three attempts (initial plus two, with 400 ms and 800 ms backoff) on 5xx and network failures, so server-protection code is unnecessary. Keep a debounce only for UX — for example, holding off the lookup until all seven digits are typed.

### 6. Verify against a real postcode

Test with **231-0017** (神奈川県 横浜市中区 港町 — Minatocho, Naka Ward, Yokohama, near Yokohama City Hall):

```ts
import { describe, it, expect } from 'vitest';
import { lookup } from '@jpzip/jpzip';

describe('zipcode autofill', () => {
  it('maps 231-0017 to 神奈川県 / 横浜市中区 / 港町', async () => {
    const entry = await lookup('2310017');   // stub jpzip.nadai.dev with MSW in tests
    expect(entry?.prefecture).toBe('神奈川県');
    expect(entry?.city).toBe('横浜市中区');
    expect(entry?.towns[0]?.town).toBe('港町');
  });
});
```

## Common pitfalls

- **Reverse lookup has no replacement**: again, address-to-postcode via `address=` does not exist in jpzip-js. Decide between building your own index with `lookupAll()` and keeping a separate API
- **`items` and `towns` differ in granularity**: zipcoda returns matching addresses as an `items` array; jpzip holds a `towns` array inside one `entry`. Single matches (the common case) are equivalent, but when several towns share a postcode you map each zipcoda `item` to a jpzip `town`
- **Business postcodes resolve in neither**: 163-8001 (the Tokyo Metropolitan Government building) is a 大口事業所個別番号 and is absent from KEN_ALL.csv. Neither jpzip nor zipcoda returns it, so if you padded "no match" cases from another dataset, you still need that fallback
- **Splitting the `address` field**: zipcoda's `address` is a combined city-and-town string. If you fed it into a single input, decide whether to split it into `city` and `town` or re-join with `entry.city + entry.towns[0].town`
- **SSR-rendered forms**: in Next.js or Astro, don't call `lookup` against the server-side HTML — keep it input-event driven on the client

## Measured results

Trends observed in a Vite + TypeScript sample app with three address forms. zipcoda's numbers vary with its throttling state; these are from an off-peak window.

| Metric | zipcoda (dynamic API) | jpzip-js (static CDN) |
|---|---|---|
| First lookup latency (p50, Tokyo) | ~120 ms | ~70 ms |
| Repeat lookups (same prefix) | ~120 ms (round trip every time) | ~0.3 ms (L1 LRU hit) |
| Cache hit rate after `preload` | — (per request) | ~100% |
| Rate limiting | Yes (per-IP throttling) | None |
| Bundle size delta (gzip) | 0 (hand-rolled fetch) | ~4 KiB (`lookup` only) |
| TypeScript types | hand-rolled | bundled |

**The cache behavior is the biggest difference.** zipcoda makes a round trip even for a repeated postcode, while jpzip-js short-circuits repeat lookups through its L1 LRU. More than the absolute latency, it is the ability to *stop making round trips at all* that matters in production.

## Summary

zipcoda is convenient and works fine during development. But "round-trip to a third-party API server on every autofill, dependent on its availability and rate limits" is a quiet liability in production.

Migrating to jpzip-js is a one-function swap: read `pref` / `components` / `address` into `prefecture` / `city` / `towns[0].town`, and drop `zipcoda.net` from your CSP. Unless you rely on reverse lookup, the diff is surprisingly small — and in exchange, the runtime dependency on an external API, the rate limiting, and the missing types all go away together.

Related reading:

- [The jpzip project overview](/blog/0001-cloudflare-pages-micro-saas/) — why this is delivered as a static dataset on Cloudflare Pages
- [Serving 120,677 entries from static JSON](/blog/0002-cloudflare-pages-static-zipcode-delivery/) — the chunking strategy and the L1 / L2 cache layout
- [Migrating from Yubinbango to jpzip-js](/blog/0005-migrate-from-yubinbango-js/) — the other common address-autofill library, migrated
