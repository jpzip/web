---
id: "0001"
title: "I built a postcode-data micro-SaaS on Cloudflare Pages' free tier (and it costs me $0)"
description: The story behind jpzip, a one-person side project, and why it stays free forever — not by luck, but by design. 120,677 Japanese postcodes served from Cloudflare Pages alone.
lang: en
publishedAt: 2026-05-17
author: nadai
tags: [Cloudflare, OSS, indie, micro-SaaS]
series:
  name: jpzip
  part: 1
status: published
faq:
  - q: What is jpzip?
    a: "A signup-free, free-of-charge, unlimited Japanese postcode dataset. It normalizes Japan Post's KEN_ALL.csv and KEN_ALL_ROME and serves them as static JSON from `https://jpzip.nadai.dev`. SDKs are provided in 8+ languages."
  - q: Is commercial use allowed? Is attribution required?
    a: 'Yes to commercial use. The spec, SDKs, and ETL are MIT-licensed; the data is effectively public domain. Redistribution and modification are all free, and attribution is not required (but welcome).'
  - q: Why not use Japan Post's official API?
    a: "That's also fine. jpzip exists as a complement for situations where the official API's application process or usage limits make it hard to use from indie or OSS projects."
  - q: Are there any monthly fees?
    a: "No — zero on both sides. The project runs entirely on Cloudflare Pages' free tier."
---

> The story behind **jpzip**, a one-person side project, and why it stays free forever — not by luck, but by design.

- Site: <https://jpzip.nadai.dev/>
- GitHub org: <https://github.com/jpzip>
- License: MIT (code) / Public-Domain-equivalent (data)
- Cost so far: **$0 lifetime**

## TL;DR

- **jpzip** ships all **120,677 Japanese postcodes** to client apps using **Cloudflare Pages' free tier — nothing else**.
- It's not an API server. It's a **set of static JSON files on a CDN**, with thin SDKs on top.
- **8 official SDKs**: TypeScript / Go / Python / Rust / Ruby / Dart / PHP / Swift, all with the same signature.
- No signup, no auth, MIT, works fully offline via `preload`.
- Infra cost is **$0 cumulative**, monthly updates run on GitHub Actions.
- This post is **part 1 of a 4-part series** — the design overview. The next posts dive into the data pipeline, the MCP server, and how Claude Code built all 8 SDKs in 6 hours.

## Why I built it

Whenever I worked on a hobby project in Japan and needed postcode data, the existing options always felt off:

| Option | Hobby-friendly? | What's annoying |
|---|---|---|
| Japan Post official API | △ | Requires a business account; individuals can't really use it |
| Paid postcode APIs | △ | Built for commercial use; pricing doesn't fit side projects |
| zipcloud (community API) | ✓ | Friendly, but no SLA — can disappear at any time |
| Bundle KEN_ALL.csv yourself | ✓ | You're now in the data-pipeline business |

> What's missing: a no-signup, offline-capable postcode dataset for indie developers and OSS, that I trust to be there in five years.

So I started there. But I deliberately didn't want to run "yet another API." APIs come with request billing, database hosting, and on-call. To make this project **sustainably free**, I had to ship it as a **dataset**, not a service.

## The architecture

```
Client App
  ↓
jpzip SDK (8 languages, identical API surface)
  ↓ HTTPS GET
jpzip.nadai.dev (Cloudflare Pages + Custom Domain)
  ↓
[Cloudflare CDN cache]
  ↓
~1,010 static JSON files
  ↑
[GitHub Actions, monthly]
  KEN_ALL.csv → normalize → JSON → wrangler pages deploy
```

The JSON layout:

| Path | Contents | Size | File count |
|---|---|---|---|
| `/meta.json` | Version info | < 1 KB | 1 |
| `/g/{1-digit}.json` | All postcodes starting with that digit | ~1 MB (200–300 KB gzipped) | 10 |
| `/p/{3-digit}.json` | All postcodes starting with that 3-digit prefix | ~10 KB (~3 KB gzipped) | ~1,000 |

3-digit files are for single-lookup queries; 1-digit files are for full preload (offline mode).

The thing I'm most proud of: **no Worker, no R2, no KV.**

- No Worker means no 100k req/day limit and no Worker billing.
- ~1,010 files comfortably fits Pages' 20,000-file limit (we use 5%).
- 24-hour CDN cache means the origin barely sees traffic.

Net result: **there is no axis along which a bill could ever be generated**. The architecture itself is the pricing strategy.

## What "$0 forever" actually means here

The numbers, after running the project:

- **Cumulative cost: $0** (excluding domain registration).
- Cloudflare Pages: free static hosting, free bandwidth, unmetered.
- Cloudflare CDN: free, automatic edge cache.
- GitHub Actions: unlimited minutes for public repos.
- Monthly build job finishes in minutes — nowhere near any quota.

For a project I want to keep alive for years without thinking about it, the trick wasn't to add features. The trick was to **subtract billing axes** until none were left.

## What it feels like to use

All 8 official SDKs expose the same shape. Three lines:

### TypeScript

```ts
import { lookup } from "@jpzip/jpzip";

const entry = await lookup("2310017");
// → { prefecture: "神奈川県", city: "横浜市中区", towns: [{ town: "本町", ... }], ... }
```

### Go

```go
import "github.com/jpzip/go"

entry, err := jpzip.Lookup(ctx, "2310017")
```

### Python

```python
from jpzip import lookup

entry = lookup("2310017")
```

The returned `ZipcodeEntry` carries the address in **kanji, full-width katakana, and romaji**, plus the **JIS X 0401 prefecture code** and the **MIC city code** — so it works for everything from form autofill to joining against official government datasets.

If you want offline mode, just `preload({ scope: "all" })`. After that, no network calls at all — same behavior in a metro tunnel, in CI, in a kiosk.

## What changed when I let Claude Code drive

I built jpzip solo with Claude Code, and a few things stood out:

- Locking down the protocol spec **first** (`spec/v1/protocol.md`) made the multi-language SDK rollout dramatically smoother.
- I implemented all **8 public SDKs in 6 hours** — full post on that one is coming.
- Separating **data / protocol / client** layers let Claude ship language after language without me retelling the design each time.

> Pin the spec in prose first, then ask the AI to implement against it.

The moment I started doing that, SDKs stopped being something I *wrote* and became something I *generated*.

## The rest of this series

This post is **part 1 of 4 — the hub.** Each of the next three drills into one slice:

1. **This post** — building a micro-SaaS dataset on Cloudflare Pages' free tier
2. [Serving 120,677 records from Cloudflare Pages](https://jpzip.nadai.dev/en/blog/cloudflare-pages-static-zipcode-delivery/) — file-splitting strategy, why 1,010 files, and the ETL design
3. [Writing an MCP server so Claude can look up Japanese postcodes](https://jpzip.nadai.dev/en/blog/mcp-server-japanese-postcode/) — `lookup_zipcode` / `search_by_address` design
4. [How Claude Code shipped 8 SDKs in 6 hours](https://jpzip.nadai.dev/en/blog/claude-code-8-sdks-6-hours/) — spec-first design, prompt structure, and language-specific gotchas

## Try it

If you're running anything in production where addresses matter, please use Japan Post's official API. jpzip is explicitly aimed at **indie devs, OSS, and side projects**.

- Site: <https://jpzip.nadai.dev/>
- GitHub: <https://github.com/jpzip>
- npm: `npm i @jpzip/jpzip`
- Go: `go get github.com/jpzip/go`
- pip: `pip install jpzip`

There's a playground on the site you can click through right now. Issues and PRs are very welcome.

If you've ever wondered whether "a hobby project that runs free forever" is actually achievable, this is one shape that answer can take. Hopefully it's useful as a reference.
