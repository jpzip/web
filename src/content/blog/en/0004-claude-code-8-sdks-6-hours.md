---
id: "0004"
title: How Claude Code shipped 8 language SDKs in 6 hours
description: How I shipped TypeScript / Go / Python / Rust / Ruby / Dart / PHP / Swift SDKs for jpzip in 6 hours using Claude Code — spec-first design, translation-not-transpilation prompting, and per-language gotchas.
lang: en
publishedAt: 2026-05-17
author: nadai
tags: [Claude Code, AI, SDK, multi-language, OSS]
series:
  name: jpzip
  part: 4
status: published
---

> Final post in the [jpzip](https://jpzip.nadai.dev/) series. I built SDKs in **TypeScript, Go, Python, Rust, Ruby, Dart, PHP, and Swift** in 6 hours of focused work with Claude Code. Read [part 1](https://jpzip.nadai.dev/en/blog/cloudflare-pages-micro-saas/), [part 2](https://jpzip.nadai.dev/en/blog/cloudflare-pages-static-zipcode-delivery/), and [part 3](https://jpzip.nadai.dev/en/blog/mcp-server-japanese-postcode/) first if you want the surrounding context.

## TL;DR

- 8 SDKs shipped in 6 hours of work, with the help of Claude Code.
- Published to npm / Go / PyPI / crates.io / RubyGems / pub.dev / Packagist / Swift Package Index.
- Every SDK has the **same API surface, the same cache design, the same retry behavior**.
- The unlock was **pinning the protocol in prose first**, then dropping implementation to a level Claude can finish.
- Language-specific gotchas absolutely exist — handle them by **asking Claude to translate, not transpile**.

## What "8 SDKs in 6 hours" really means

To be honest about the headline: the 6 hours is the **actual implementation time for the 8 SDKs**, but a lot was already in place before the timer started:

- The dataset (120,677 records of JSON) was already on the CDN ([part 2](https://jpzip.nadai.dev/en/blog/cloudflare-pages-static-zipcode-delivery/)).
- The protocol spec (`spec/v1/protocol.md`) was already pinned, with JSON Schema.
- The TypeScript SDK existed as a working reference implementation.

So the honest framing is: **with the spec, the reference implementation, and the CDN all in place, the remaining 7 languages rolled out in 6 hours.** That's not "AI made it possible." That's "I lined up everything AI-driven dev needs *before* starting, and the 6 hours was the payoff."

## The overall flow

The work happened in three phases:

1. **Pin the protocol in prose** (hours).
2. **Build the TypeScript SDK carefully** (hours).
3. **Use the TypeScript SDK as a reference and roll out the other 7 languages** (the 6 hours).

Phase 3 was essentially "ask Claude Code to translate, language by language."

## Locking down the spec

For 8 SDKs to behave the same way, all 8 have to be reading the same document. The repo I put together:

```
spec/
├── README.md
├── CHANGELOG.md
├── LICENSE
├── schema/
│   └── v1/
│       ├── zipcode-entry.json   # JSON Schema
│       └── meta.json             # JSON Schema
└── spec/
    └── v1/
        └── protocol.md           # the human-readable spec
```

`protocol.md` contains:

- Every endpoint and a complete example response.
- JSON Schema for every payload (types are machine-readable, prose is for humans).
- CORS and `Cache-Control` rules.
- Versioning policy (minor versions are backwards-compatible).

The bar I aimed for: **I can hand this document to Claude and say "implement this in Go,"** and Claude can finish.

## The shared API surface

Five functions: `lookup`, `lookupGroup`, `lookupAll`, `preload`, `getMeta`. Each language's idiomatic naming:

| Language | Package | Single lookup |
|---|---|---|
| TypeScript | `@jpzip/jpzip` | `await lookup("2310017")` |
| Go | `github.com/jpzip/go` | `jpzip.Lookup(ctx, "2310017")` |
| Python | `jpzip` | `lookup("2310017")` / `await client.lookup(...)` |
| Rust | `jpzip` | `jpzip::lookup("2310017").await?` |
| Ruby | `jpzip` | `Jpzip.lookup("2310017")` |
| Dart | `jpzip` | `await lookup("2310017")` |
| PHP | `jpzip/jpzip` | `lookup("2310017")` |
| Swift | `Jpzip` | `try await lookup("2310017")` |

Same verb-noun structure across all 8. The "null" representation follows each language's conventions (`null` / `nil` / `Option` / `?ZipcodeEntry`) — that was the one rigid rule.

## Shared behavior, not just shape

The SDKs agree on internal behavior too:

- **HTTP retry**: up to 3 attempts with exponential backoff on 5xx / network errors.
- **L1 cache**: in-memory LRU (both at per-prefix-shard and per-entry granularity).
- **L2 cache**: pluggable persistent cache (interface only; default is "none"). File / Redis / SQLite all valid implementations.
- **L3 cache**: HTTP `Cache-Control` (Pages serves 24h TTL).
- **lookupAll**: parallel fetch of `/g/0..9.json`, merged into an in-memory dict.

L2 is just an interface in each language — implementations are 20–30 lines and out of scope for the SDK to provide.

## Inside the 6 hours

The thing that made the 6 hours actually work was reframing every prompt as a **translation task**, not a transpilation task.

### The template

```
Here's the TypeScript reference implementation.
Reimplement it in idiomatic Ruby.

Must hold:
- Public API: { Jpzip.lookup, Jpzip.lookup_group, ... }
- Return values are frozen Data objects (Ruby 3.2+ Data.define)
- HTTP via net/http only (no external gems)
- 3-attempt retry with exponential backoff
- L2 cache is a Module-defined interface, no default implementation

Avoid:
- Active-Support-style extensions
- Non-thread-safe code (use Monitor)
- camelCase method names
```

"Port the TypeScript API verbatim" produces strange code. "Re-express it in idiomatic Ruby" produces Ruby that happens to honor the same contract — L1 LRU rendered as a Hash, retries done as `rescue ... retry`, the whole thing reading like a Ruby gem someone would actually write.

### "Build, then fix" — one language at a time

Per language:

1. Have Claude translate the test suite from TypeScript (same fixtures, same expectations).
2. Have Claude translate the implementation.
3. Run the tests.
4. Feed failures back to Claude, fix.

Eight times. The time wasn't going into implementation prose; it was going into **teaching Claude the language-specific traps**.

### Per-language gotchas that surfaced

A few things I learned while doing this:

- **Rust**: Force `rustls` over `openssl-sys`. SDKs that build without a C toolchain are dramatically nicer to consume.
- **Python**: Don't write sync and async as two parallel implementations. Make them share interfaces and swap backends (`httpx.Client` vs `httpx.AsyncClient`).
- **Ruby**: Reach for `Monitor`, not `Mutex` — it's the more natural fit for "reentrant + thread-safe."
- **Dart**: To support Flutter / CLI / server / Flutter Web with one codebase, avoid `dart:io`. Go through `package:http`.
- **PHP**: 8.2+ `readonly` classes for value objects. Guzzle 7 for HTTP.
- **Swift**: Lean on `async/await` directly. Don't fall back to closure-based callbacks.

Most of these surfaced when I told Claude "this has to work without a C toolchain" or "this has to compile on Flutter Web." **One constraint added to the prompt → Claude restructured the design accordingly.**

## What worked, what didn't

### Worked

- **Spec-first.** Behavior decided in prose before any code. That document became Claude's source of truth.
- **A working reference.** Starting with one finished SDK gave Claude a concrete "match this behavior" target.
- **Translate the tests first.** Once the tests are in the new language, correctness becomes automatable.
- **Specify idiom in the prompt.** "Pythonic," "idiomatic Go" — these words change output quality measurably.
- **Reuse CI templates.** Eight publish-to-package-manager workflows on GitHub Actions, copy-edited per language.

### Didn't

- **"Do all 8 at once."** Context bloats, errors multiply. **One language at a time** is faster end-to-end.
- **Translate impl without tests.** You get "kinda works." Always translate tests in the same step.
- **Forcing identical error messages across languages.** Each language has its own exception philosophy. Trying to unify them was wasted effort.

## Who's an 8-SDK library for?

A reasonable question is: "Are 8 languages even worth it?" My honest answer is that the value is less about which languages humans choose, and more about **giving Claude (or any AI assistant) a path in whichever language it lands in**.

If someone's prototyping in Rust, they want `cargo add jpzip`, not `npm i`. If they're in Dart Flutter Web, they want `dart pub add jpzip`. Each install command being one line in each language keeps the option open. The user feedback I got after shipping was mostly "I happened to be writing in [language X], and it was nice to have."

## What changes when AI is in the loop

A few shifts in how I think about projects now:

1. **The line between "things I write" and "things I generate" has moved.**
   Once the protocol is in prose, SDKs become generated artifacts, not authored ones.
2. **Design happens earlier.** More time on spec + reference + tests, less time per implementation pass.
3. **Language walls get thinner.** I can publish a polished SDK in a language I've never written professionally.
4. **The quality ceiling is set by the spec, not the AI.** A messy spec produces 8 messy SDKs. A clean spec produces 8 clean SDKs.

## The series

1. [I built a postcode-data micro-SaaS on Cloudflare Pages' free tier](https://jpzip.nadai.dev/en/blog/cloudflare-pages-micro-saas/)
2. [Serving 120,677 records from Cloudflare Pages](https://jpzip.nadai.dev/en/blog/cloudflare-pages-static-zipcode-delivery/)
3. [Writing an MCP server so Claude can look up postcodes](https://jpzip.nadai.dev/en/blog/mcp-server-japanese-postcode/)
4. **This post** — How Claude Code shipped 8 SDKs in 6 hours

The throughline across all four: a single-developer scope has gotten meaningfully bigger when paired with an AI assistant — *if* the underlying architecture (layered data / protocol / client separation) plays well with that workflow. Designing for AI-driven development is its own design constraint, and worth taking seriously.

## Try one

| Language | Install |
|---|---|
| TypeScript | `npm i @jpzip/jpzip` |
| Go | `go get github.com/jpzip/go` |
| Python | `pip install jpzip` |
| Rust | `cargo add jpzip` |
| Ruby | `gem install jpzip` |
| Dart | `dart pub add jpzip` |
| PHP | `composer require jpzip/jpzip` |
| Swift | Add `Jpzip` via Swift Package Manager |

GitHub: <https://github.com/jpzip>
Site: <https://jpzip.nadai.dev/>

Whichever language you're in, you can have a working postcode lookup in three lines. Building "a small library that exists in every language" turned out to be one of the most fun things I've done with AI-assisted development.
