---
id: "0002"
title: "How I serve 120,677 Japanese postcodes from Cloudflare Pages (no Worker, no R2)"
description: The data-delivery design behind jpzip — shard layout, ETL pipeline, and why I deliberately use no Worker, no R2, no KV.
lang: en
publishedAt: 2026-05-17
author: nadai
tags: [Cloudflare, CDN, ETL, Go]
series:
  name: jpzip
  part: 2
status: published
---

> The data-delivery side of [jpzip](https://jpzip.nadai.dev/), my $0-lifetime hobby project. This is part 2 of a 4-part series. Part 1 covers the overall architecture: [I built a postcode-data micro-SaaS on Cloudflare Pages' free tier](https://jpzip.nadai.dev/en/blog/cloudflare-pages-micro-saas/).

- Site: <https://jpzip.nadai.dev>
- ETL: <https://github.com/jpzip/data>
- Spec: <https://github.com/jpzip/spec>

## TL;DR

- I ship the full Japan Post **KEN_ALL.csv (120,677 entries)** as a **set of static JSON files on a CDN**, not as an API.
- File count is **fixed at ~1,010** to stay well inside Cloudflare Pages' limits.
- **`/all.json` is deliberately not produced** — it would blow past Pages' 25 MiB per-file limit.
- The layout is **10 one-digit shard files + ~1,000 three-digit shard files + 1 meta file**, covering both "preload everything" and "single lookup."
- ETL runs in **Go on GitHub Actions, twice a month** (day 1 and day 15).
- No Worker, no R2, no KV — **the architecture removes every axis along which a bill could appear**.

## Where the design starts

I committed early to a single constraint:

> The only thing I ship is **static JSON files**. No API server.

Once I'd said that, the lookup logic had to live in the client SDKs. Which immediately raised the central design question:

> **How do I split the data so that file count, bandwidth, and client-side compute are all reasonable?**

The rest of the post is the answer.

## Reading the Cloudflare Pages limits

Step one was tabulating the constraints.

| Limit | Value | Implication |
|---|---|---|
| Single file size | **25 MiB** | "One big file" is off the table |
| Files per deployment | **20,000** | Thousands of small shards is fine |
| Storage | Effectively unlimited | Ignore |
| Bandwidth | Unlimited | Ignore |
| Deploys per month | 500 | I deploy 1–2× / month, no problem |

This already forces the first decision.

### Decision 1: kill `/all.json`

I originally wanted a two-tier layout: one big `/all.json` for "give me everything," plus small per-prefix files for single lookups.

But the normalized JSON for 120,677 entries comes out to **just over 25 MiB**. That breaks Pages' single-file ceiling.

Two ways out:

1. Put the big file in **R2** — but that adds a new billing axis (and exposes you to DoW attacks).
2. Drop the big file entirely — let the SDK fan out across smaller shards.

I went with option 2 without hesitation. The SDK's `preload({ scope: "all" })` now fetches **`/g/0.json` through `/g/9.json` in parallel** and stitches them together internally. From the caller's perspective, it's still "one function call, everything cached."

> If a file's too big, don't add R2. **Change the API so the split is invisible.** That's the whole "don't add billing axes" philosophy in one line.

## The shard layout

After all the trade-offs, this is what shipped:

| Path | Contents | Size | File count |
|---|---|---|---|
| `/meta.json` | Version, totals, per-prefecture counts | < 1 KB | 1 |
| `/g/{0..9}.json` | All postcodes grouped by 1-digit prefix | ~1 MB (200–300 KB gzipped) | 10 |
| `/p/{000..999}.json` | All postcodes grouped by 3-digit prefix | ~10 KB (~3 KB gzipped) | ~1,000 |

About **1,010 files total** — 5% of Pages' 20,000-file budget.

### What `/g/` is for: preload

The 10 one-digit shards exist for offline mode. They're sized so that 10 parallel HTTP/2 requests land all the data in a reasonable time. CI jobs, in-flight web apps, installers — anything that wants to disconnect — calls `preload({ scope: 'all' })` and the SDK quietly fetches these 10 in parallel.

### What `/p/` is for: single lookup

The ~1,000 three-digit shards exist for `lookup("2310017")`. The SDK takes the first 3 digits, fetches `/p/231.json` (and only that), and pulls the entry out. One request, ~3 KB, always cache-hits at the edge. This is the day-to-day code path.

I only generate shards for **prefixes that actually exist**, so `/p/000.json` simply isn't there — a 404 is the "no such postcode" signal.

### Why both 1-digit and 3-digit, and not 2-digit?

A 2-digit layout would have been "what's wrong with `/00.json` through `/99.json`?" The answer:

- **1-digit** is right for full preload: 10 parallel fetches play well with HTTP/2 multiplexing.
- **3-digit** is right for point lookups: a ~10 KB file means minimum data per single query.
- **2-digit** is between the two: too coarse to preload nicely, too fat for a point lookup.

The SDKs do also accept 2-digit "scope" preloads (which expand internally into 10 parallel `/p/` fetches), but I don't ship 2-digit shards as actual files on the origin.

## The ETL: KEN_ALL.csv → JSON, one direction only

The data generator is Go, and it only runs on GitHub Actions. I dropped local-execution support on purpose — fixture tests cover reproducibility, and removing local runs eliminates a class of "but it worked on my laptop" failures.

```
[GitHub Actions cron: day 1 and 15 at 03:00 JST]
       ↓
Download ZIPs from Japan Post
  - KEN_ALL.zip   (Shift-JIS, kanji + katakana)
  - KEN_ALL_ROME.zip (romaji)
       ↓ source.Fetch()
       ↓ unzip → CSV reader
parse.KenAll(reader) → []KenAllRecord
parse.Rome(reader)   → []RomeRecord
       ↓
merge.Merge() → []MergedRecord  (joined by zipcode)
       ↓
normalize.Entry() → ZipcodeEntry
  - join multi-row records (parens-continuation rows)
  - extract notes from parens
  - merge Kyoto-style "通り名" entries
  - normalize katakana to full-width, romaji to title case
       ↓
output.Write() → dist/{g,p,meta}.json
       ↓
validate.PreDeploy() → check ±N% vs last month
       ↓ pass
wrangler pages deploy dist --project-name=jpzip
       ↓ fail
auto-create GitHub Issue
```

The cron is `0 18 1,15 * *` — UTC 18:00, which is 03:00 JST, on the 1st and 15th. Twice a month, because Japan Post sometimes posts the update a few days off-schedule and I'd rather catch it on the second swing.

### The core of the writer

The actual `output.Write()` is delightfully boring:

```go
// Bucket by 1-digit and 3-digit prefixes.
byG := make(map[string]map[string]types.ZipcodeEntry, 10)
byP := make(map[string]map[string]types.ZipcodeEntry, 1000)

for zip, e := range entries {
    g := zip[:1]
    p := zip[:3]
    if byG[g] == nil { byG[g] = make(map[string]types.ZipcodeEntry) }
    if byP[p] == nil { byP[p] = make(map[string]types.ZipcodeEntry) }
    byG[g][zip] = e
    byP[p][zip] = e
}

for g, dict := range byG {
    writeJSONSorted(filepath.Join(dst, "g", g+".json"), dict)
}
for p, dict := range byP {
    writeJSONSorted(filepath.Join(dst, "p", p+".json"), dict)
}
```

I sort the keys before writing so **diffs are small** between months. Pages picks this up and deploys faster.

### Fail loudly on unknown patterns

KEN_ALL occasionally introduces new annotation styles — continuation rows, romanization edge cases, weird parenthetical notes. The cheap thing is "let it through quietly." That silently corrupts data.

I went the other way:

```go
var ErrUnknownPattern = errors.New("unknown town pattern")

func Town(raw string) (TownResult, error) {
    switch raw {
    case "以下に掲載がない場合":
        return TownResult{Town: "", Note: raw}, nil
    // ... known patterns
    }
    if hasParens(raw) { return parseParens(raw) }
    if isSafeTownName(raw) { ... }

    return TownResult{}, ErrUnknownPattern
}
```

If the normalizer hits a pattern it doesn't recognize, the ETL fails. The GitHub Actions `if: failure()` step then opens a GitHub Issue automatically. The job runs twice a month, so **the only reliable way to handle "future me, look at this"** is to make future-me a ticket.

### Pre-deploy validation

A finished build also has to pass a similarity check against what's currently live, or the deploy gets blocked. Thresholds:

- **Total count: ±5%**
- **3-digit prefix count: ±5%**
- **Per-prefecture counts: ±10%**

`validate.PreDeploy()` fetches the live `meta.json` from `https://jpzip.nadai.dev/meta.json` and compares it against the freshly-built one. If Japan Post's URL ever silently goes 404 and we get an empty file, the bad build never ships.

### HTTP headers via `_headers`

Cloudflare Pages reads a `_headers` file in the build output:

```
/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=86400
```

Wide-open CORS (the SDKs are one access pattern; raw fetches from a browser are another), and a 24-hour TTL. Since `/p/*.json` content doesn't change within a month, edge cache hit rate is essentially 100%.

## The point of "no Worker, no R2, no KV"

The most important part of this design is what I **didn't use**.

| Component | Used? | Why |
|---|---|---|
| Cloudflare Pages | ✅ | Free static hosting + unmetered bandwidth |
| Cloudflare CDN | ✅ | Free, automatic |
| **Cloudflare Worker** | ❌ | 100k req/day free cap = a structural billing axis |
| **Cloudflare R2** | ❌ | Egress-based pricing = exposure to DoW |
| **Cloudflare KV** | ❌ | Read-billed = monthly bill scales with traffic |
| **Transform Rules** | ❌ | I don't need URL rewriting |

No matter what traffic does, **there is no metric on which my Cloudflare bill could grow**. For a "run it forever for free" hobby project, that's the right optimization target.

## DoW (Denial of Wallet) resistance

The R2 variant would have created a real attack vector: a malicious user just pulls big files in a loop and runs up your egress bill. In this design that attack doesn't compose:

- The public surface is ~1,010 files totaling ~10 MB.
- Pages' bandwidth is unmetered and free.
- More traffic just raises edge cache hit rate, which **reduces** origin load.

If someone tweets the URL hoping to torch it, there's nothing flammable. That's the whole point.

## Looking back

Two ideas did most of the work:

- Separating **data / protocol / client** layers so each can evolve independently.
- Subtracting billing axes until none remain.

Pinning the protocol layer in prose (the spec doc) is also what made the next post possible — generating SDKs in 8 languages on top of a frozen contract.

## The 4-part series

1. [I built a postcode-data micro-SaaS on Cloudflare Pages' free tier](https://jpzip.nadai.dev/en/blog/cloudflare-pages-micro-saas/) (series hub)
2. **This post** — Serving 120,677 records from Cloudflare Pages
3. [Writing an MCP server so Claude can look up postcodes](https://jpzip.nadai.dev/en/blog/mcp-server-japanese-postcode/)
4. [Building 8 SDKs in 6 hours with Claude Code](https://jpzip.nadai.dev/en/blog/claude-code-8-sdks-6-hours/)

## Try it

- Site: <https://jpzip.nadai.dev/>
- GitHub org: <https://github.com/jpzip>
- ETL: <https://github.com/jpzip/data>
- Spec: <https://github.com/jpzip/spec>

The whole data-generation pipeline is open source under MIT. If you want to ship another open dataset on Cloudflare Pages with similar constraints, this should be a useful template to crib from.
