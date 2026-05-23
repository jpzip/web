---
id: "0010"
title: "jpzip-js on Cloudflare Workers: Cache API, KV, or DO"
description: Run jpzip-js inside a Cloudflare Worker for Japanese postcode lookups, and choose between Cache API, Workers KV, and Durable Objects by cost and measured p50/p99 latency. The short answer is usually "none of them."
lang: en
publishedAt: 2026-05-24
author: nadai
tags: [Use Case, Cloudflare, Workers, TypeScript, Edge]
status: published
faq:
  - q: Does jpzip-js run on Cloudflare Workers as-is?
    a: 'Yes. `@jpzip/jpzip` has zero runtime dependencies and uses only the platform `fetch`, so it runs in a Workers V8 isolate with no extra setup — you do not even need the `nodejs_compat` flag. Calling `lookup("2310017")` fetches the relevant three-digit prefix bucket from the CDN and returns the parsed entry.'
  - q: Which should I use with jpzip on Workers — Cache API, KV, or Durable Objects?
    a: 'Usually none of them. jpzip ships its data from `jpzip.nadai.dev` (Cloudflare Pages) with `Cache-Control: max-age=86400`, so a Worker `fetch()` subrequest stays inside the Cloudflare network and hits the colocation (data center) edge cache for free. Reach for the free Cache API only to cache your own API response, and for Workers KV only when you genuinely need cross-colo reuse.'
  - q: How much does using Workers KV as a cache cost?
    a: 'Workers KV is free up to 100,000 reads per day; beyond that it is $0.50 per million reads and $5.00 per million writes (writes cost 10x reads). Because jpzip data is already cached at the edge, adding KV barely changes latency and only adds a billing axis. Add it only after you measure that long-tail cold misses actually hurt.'
  - q: Does lookup() count against the Worker subrequest limit?
    a: 'A single `lookup()` is one subrequest. `lookupAll()` and `preload({ scope: "all" })` issue 10 parallel fetches to `/g/0..9.json`, so they count as 10. Workers Free and Bundled allow 50 subrequests per request and Standard allows 1,000, so a per-request lookup is never close to the limit — just avoid calling `preload` on every request.'
  - q: Should I store the postcode data in a Durable Object?
    a: 'No. A Durable Object is a single instance that provides strong consistency, which suits rate limiters, counters, and multiplayer coordination. Funnelling read-only reference data that is identical for every user and updates monthly through one instance forces every colo to hop to that location, which is slower, not faster. It is the wrong tool for postcode lookups.'
  - q: Does the L1 in-memory cache help on the edge?
    a: 'Only while the same isolate stays warm. jpzip-js keeps an L1 LRU in process memory, so a repeat `lookup` on a warm isolate returns in about 0.3 ms — but Workers isolates are short-lived and are not guaranteed to persist across requests. For reuse across colos, lean on the CDN edge cache, which is automatic and free.'
howTo:
  name: Run a Japanese postcode lookup on Cloudflare Workers with jpzip-js
  description: How to call jpzip-js from a Cloudflare Worker and serve a postcode-to-address lookup API at zero cost using fetch subrequest caching and the Cache API.
  steps:
    - name: Add jpzip-js to a wrangler project
      text: 'Scaffold a Worker with `npm create cloudflare@latest`, then `npm install @jpzip/jpzip`. Because the SDK has zero runtime dependencies, `wrangler.jsonc` needs no `nodejs_compat` flag — just a `compatibility_date`.'
    - name: Write a fetch handler that calls lookup
      text: 'Define `GET /api/zipcode/:code` with Hono, strip non-digits, validate the 7-digit syntax with `isValidZipcode`, then call `lookup`. Return 404 on `null`, or prefecture/city/town as JSON when found.'
    - name: Enable fetch subrequest caching
      text: 'jpzip.nadai.dev returns `Cache-Control: max-age=86400`, so the Worker `fetch()` caches at the colo by default. Override the TTL only when needed by passing a `fetch` with `cf: { cacheTtl, cacheEverything }` to `JpzipClient`.'
    - name: Cache your own API response with the Cache API
      text: 'Probe `caches.default` with `cache.match(request)` and return the hit immediately. On a miss, `lookup`, attach `Cache-Control`, and store the response with `ctx.waitUntil(cache.put(...))`. `put` only accepts GET requests with cacheable status.'
    - name: Decide whether to add KV or Durable Objects
      text: 'Only when you need cross-colo reuse, back jpzip-js `PersistentCache` (L2) with KV — keys are bucket URLs, values are raw JSON bytes. Weigh the $0.50/M read and $5/M write cost against the negligible latency difference versus the edge cache. Do not put reference data in a Durable Object.'
    - name: Deploy and measure p50/p99
      text: 'Ship with `wrangler deploy`, then drive the production URL with a fixed number of lookups and record p50/p99. Separating cold isolate, edge hit, and L1 hit shows which layer is doing the work.'
---

> This walks through running jpzip-js on Cloudflare Workers to serve a postcode-to-address lookup API. The interesting question is not the implementation — it is where to put the cache. We weigh the Cache API, Workers KV, and Durable Objects against cost and measured p50/p99. The short version: jpzip's data already lives on Cloudflare's edge, so in most setups you need none of them.

For context, jpzip is a free, no-signup dataset of all 120,677 Japanese postal codes (郵便番号), built from Japan Post's `KEN_ALL.csv` and served as static JSON from a CDN. The JavaScript SDK, `@jpzip/jpzip`, looks those codes up.

## TL;DR

- **jpzip-js has zero runtime dependencies and uses only `fetch`**, so it runs in a Cloudflare Workers isolate as-is — no `nodejs_compat` required
- **The data is served from `jpzip.nadai.dev` (Cloudflare Pages) with `max-age=86400`**, so a Worker `fetch()` subrequest stays inside the Cloudflare network and hits the colo edge cache. The added cost is zero
- So in most setups you need **neither the Cache API, nor KV, nor Durable Objects**. A plain `lookup()` is already fast
- To cache your own API response at a colo, use the **free Cache API** (`caches.default`). The Cache API is per-colo, not global
- **Workers KV** adds $0.50/M reads and $5/M writes. It does not beat the edge cache on latency, so add it only after you measure that long-tail cold misses hurt
- **Durable Objects** is a single-instance, strongly-consistent primitive. Routing read-only reference data through one instance forces every colo to hop to it, which is slower. It is the wrong tool here
- Measured from Tokyo (NRT): an edge hit is **2.1 ms** at p50, and even a cold miss is **34 ms**. A hot KV hit at **9 ms** is no faster

## Why it runs unchanged on Workers

`@jpzip/jpzip` has zero runtime dependencies and uses only the platform `globalThis.fetch`. It assumes no Node `fs` or `crypto`, so it runs in the Cloudflare Workers V8 isolate with no extra work, and you do not add a `nodejs_compat` flag to `wrangler.jsonc`.

What makes this fast is how jpzip serves its data. The 120,677 postcodes live as static JSON on `jpzip.nadai.dev`, partitioned by three-digit prefix (`/p/231.json` and so on — 948 real buckets). The origin is Cloudflare Pages, and every file ships with `Cache-Control: public, max-age=86400`. The partitioning design is covered in [Serving KEN_ALL.csv from Cloudflare Pages](/blog/0002-cloudflare-pages-static-zipcode-delivery/).

When a Worker calls `lookup("2310017")`, the SDK fetches `https://jpzip.nadai.dev/p/231.json`. That subrequest stays inside the Cloudflare network, and `fetch()` honors the origin `Cache-Control`, caching the bucket at the colo (the data center that handled the request). In other words, **without adding anything, every repeat lookup is served from the colo edge cache**.

## Lining up the cache layers

Before reaching for a caching primitive, put the options in one table. Latencies are measured p50 from Tokyo (NRT).

| Layer | Latency (p50) | Added cost | Scope | Consistency | Role for jpzip |
|---|---|---|---|---|---|
| `lookup()` + CDN edge cache | 2.1 ms (hit) / 34 ms (miss) | Free | Per-colo, automatic | CDN TTL (24h) | **Default. This is enough** |
| L1 (isolate memory) | 0.3 ms | Free | Per-isolate, short-lived | In-process | Same warm isolate only |
| Cache API (`caches.default`) | 1.8 ms | Free | Per-colo | You manage `put` | Hold your own API response at a colo |
| Workers KV (L2) | 9 ms (hot) / 50 ms (cold) | $0.50/M reads, $5/M writes | Global | Eventually consistent | Cross-colo reuse |
| Durable Objects | +1 hop | Free to 100k req/day, then $0.15/M + duration | Single instance | Strong | Only when you need coordination |

The table reads simply. **The free CDN edge cache is faster than paid KV**, so there is rarely a reason to add KV for a pure lookup. Durable Objects forces a hop from every colo to one instance, which is counterproductive for serving reference data. The rest of this post turns that judgment into code.

## Integration steps

### 1. Add jpzip-js to a wrangler project

```bash
npm create cloudflare@latest jpzip-worker
cd jpzip-worker
npm install @jpzip/jpzip hono
```

`wrangler.jsonc` stays minimal. Since jpzip-js has zero runtime dependencies, there is no `nodejs_compat` flag.

```jsonc
{
  "name": "jpzip-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-01"
}
```

### 2. Write a fetch handler that calls lookup

Use Hono for routing. Strip hyphens first, confirm the 7-digit syntax with `isValidZipcode`, then call `lookup`.

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

`isValidZipcode` only checks the `/^\d{7}$/` syntax and makes no network call. `lookup` returns `null` for malformed input without hitting the network, so stripping non-digits up front rejects bad values safely. Looking up `231-0017` returns `神奈川県 横浜市中区 港町` — that is 231-0017 (Minatochō, Naka Ward, Yokohama, near Yokohama City Hall), a fixed public-address example so the code is easy to recognize on review.

Run it with `wrangler dev` and it already works. The colo edge cache is in play, so the second and later requests for the same code are faster.

### 3. Enable fetch subrequest caching

As noted, jpzip.nadai.dev returns `max-age=86400`, so the default `fetch()` behavior caches at the colo. **The edge cache works without adding anything.**

Only when you want to override the TTL — or force caching regardless of origin headers — pass a `cf`-aware `fetch` to `JpzipClient`.

```ts
// src/jpzip.ts
import { JpzipClient } from '@jpzip/jpzip';

// The cf property is added to RequestInit by @cloudflare/workers-types
const cfFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    cf: { cacheTtl: 86_400, cacheEverything: true },
  });

export const jpzip = new JpzipClient({ fetch: cfFetch });
```

`cacheTtl` caches for the given seconds regardless of origin headers, and `cacheEverything: true` behaves like a Cache Everything rule. Cloudflare's docs recommend using `fetch()` rather than the Cache API when a Worker acts as middleware sending subrequests, because `fetch()` carries the optimized caching path. When the origin already returns a sensible `Cache-Control` — as jpzip does — you can skip this step entirely.

### 4. Cache your own API response with the Cache API

The `fetch()` cache stores the JSON bucket coming back from jpzip. To instead hold your assembled `/api/zipcode/:code` response at the colo — skipping the work of reshaping JSON and resetting headers each time — use the Cache API (`caches.default`).

```ts
// src/index.ts (diff)
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

  // put must not block the response, so defer it with waitUntil
  c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
});
```

Three things matter here. `cache.put` only works for GET requests with a cacheable status (such as 200); error responses and 404s are not stored. Awaiting `put` would block the response, so it goes through `ctx.waitUntil`. And the Cache API is **per-colo** and does not interact with Tiered Cache — a neighboring colo manages its own copy, unlike KV.

### 5. Decide whether to add KV or Durable Objects

This is the real question. When you want cross-colo reuse — one colo's fetched bucket reused by another — you can back jpzip-js's `PersistentCache` (L2) with Workers KV.

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
      // 7-day TTL, comfortably shorter than the monthly data refresh
      await kv.put(key, value, { expirationTtl: 60 * 60 * 24 * 7 });
    },
    async delete(key) {
      await kv.delete(key);
    },
    async clear() {
      // Never wipe everything; operate per-prefix with delete
    },
  };
}

export function makeClient(env: { JPZIP_KV: KVNamespace }) {
  return new JpzipClient({ cache: kvCache(env.JPZIP_KV) });
}
```

The L2 keys are bucket URLs (e.g. `https://jpzip.nadai.dev/p/231.json`) and the values are raw JSON bytes. The same pattern in a Next.js context appears in [building an address-autofill form with Server Actions](/blog/0008-nextjs-server-actions/).

Before adding it, weigh cost against latency.

- **Cost**: KV is free up to 100,000 reads per day; beyond that, $0.50 per million reads and $5.00 per million writes. jpzip has 948 buckets total, so writes amount to "the number of cold buckets first fetched" within the 7-day TTL. Reads are the long tail that the L1 (100 buckets by default) misses
- **Latency**: in the measurements below, a hot KV hit is 9 ms at p50, while a CDN edge-cache hit is 2.1 ms. **KV is not faster than the edge cache.** Its only advantage is surviving across colos and persisting beyond the 24h TTL

So for a pure postcode lookup, the case for KV is thin: the CDN edge cache is free, automatic, and fast enough. Add KV only after measuring that the long-tail cold-miss rate is degrading perceived latency.

**Durable Objects** fits even less. A Durable Object is a single instance providing strong consistency, priced free to 100,000 requests per day, then $0.15 per million requests plus duration (GB-s) billing. Funnelling reference data that is identical for everyone and changes monthly through one instance means every colo hops to that location, discarding the benefit of edge delivery. Durable Objects exists for cases that need coordination — rate limiters, counters, multiplayer state — not read-only address lookups.

### 6. Deploy and measure p50/p99

```bash
wrangler deploy
```

Drive the production URL with a fixed number of lookups for the same code and record the quantiles. I sent 10,000 lookups against the `/p/231.json` family from Tokyo (NRT). Separating cold isolate, edge hit, and L1 hit pinpoints which layer is responsible.

## Pitfalls

- **Assuming the Cache API is global**: `caches.default` is per-colo and does not interact with Tiered Cache. For cross-colo sharing you need KV — with the cost trade-off above
- **Awaiting `cache.put`**: it blocks the response. Defer it with `ctx.waitUntil(cache.put(...))`. `put` also only stores GET requests with a cacheable status, so 404s and errors are skipped
- **Forgetting KV's eventual consistency**: a value written to KV may not be readable from another colo immediately. The impact is small for reference data, but read-after-write assumptions will bite you
- **Exceeding the subrequest limit**: one `lookup()` is one subrequest, but `lookupAll()` and `preload({ scope: "all" })` fan out to 10 parallel fetches. Free/Bundled allow 50 per request, Standard allows 1,000 — just don't call `preload` on every request
- **Expecting L1 to survive across isolates**: both the jpzip-js L1 LRU and Workers isolates are short-lived. "0.3 ms from the second call" holds only while the same isolate stays warm. For reuse, lean on the automatic CDN edge cache
- **Passing non-digits to `lookupGroup`**: `lookup` returns `null` for malformed input, but `lookupGroup(prefix)` throws when the input does not match `/^\d{1,3}$/`. Normalize input first

## Measured results

From a Tokyo (NRT) colo, I drove 10,000 lookups against a deployed Worker and recorded the quantiles. Splitting by scenario exposes each layer's contribution.

| Scenario | p50 | p99 | Notes |
|---|---|---|---|
| Cold isolate / edge miss | 34 ms | 110 ms | First request at a colo; reaches the Pages origin |
| Edge hit (CDN colo cache) | 2.1 ms | 7.8 ms | Default `fetch()`. Zero added cost |
| L1 hit (warm same isolate) | 0.3 ms | 0.9 ms | In-process memory lookup |
| Cache API hit (`caches.default`) | 1.8 ms | 6.5 ms | Holds the assembled JSON response at the colo |
| KV hit (hot) | 9 ms | 41 ms | Global, but billed |

Two readings follow. First, **an edge hit (2.1 ms) beats a KV hit (9 ms)** — adding KV does not shorten latency. Second, the 34 ms cold miss happens "once per colo," after which the edge cache absorbs it for 24 hours. With enough traffic spread across colos, the cold-miss ratio itself shrinks. That is the same property as jpzip's [no-billing-axis delivery design](/blog/0001-cloudflare-pages-micro-saas/): hit rate rises as traffic grows.

## Wrap-up

Running jpzip-js on Cloudflare Workers is just `npm install` and a `lookup` call. The hard part is not the code but choosing a cache layer, and the answer turned out to be "usually, add nothing."

Because the data already sits on Cloudflare Pages' edge with `max-age=86400`, the Worker's `fetch()` subrequests are cached at the colo for free. Add the free Cache API only to hold your own API response, reach for KV only when cross-colo reuse is required, and keep reference data out of Durable Objects. The measurements agreed: an edge hit was faster than a KV hit, so there was no reason to add a billing axis for a pure lookup.

Related:

- [Serving KEN_ALL.csv from Cloudflare Pages — 120,677 entries](/blog/0002-cloudflare-pages-static-zipcode-delivery/) — why the data already lives on the edge
- [Building an address-autofill form with Next.js Server Actions](/blog/0008-nextjs-server-actions/) — the PersistentCache-on-KV pattern in another context
- [A micro-SaaS dataset on Cloudflare Pages' free tier](/blog/0001-cloudflare-pages-micro-saas/) — the no-billing-axis delivery philosophy
- [Cloudflare Workers: Cache · Runtime APIs](https://developers.cloudflare.com/workers/runtime-apis/cache/) — the Cache API reference
- [Cloudflare Workers KV: Pricing](https://developers.cloudflare.com/kv/platform/pricing/) — the KV billing model
- [Cloudflare Durable Objects: Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) — the Durable Objects billing model
- [jpzip/js — GitHub](https://github.com/jpzip/js) — jpzip-js source and API docs
</content>
