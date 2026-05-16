---
id: "0003"
title: I wrote an MCP server so Claude can natively look up Japanese postcodes
description: A tiny stateless MCP server that lets Claude resolve Japanese postcodes — tool design, cache lifetimes, cross-script (kanji/katakana/romaji) search.
lang: en
publishedAt: 2026-05-17
author: nadai
tags: [MCP, Claude, TypeScript, AI]
series:
  name: jpzip
  part: 3
status: published
faq:
  - q: How do I install the jpzip MCP server?
    a: 'For Claude Code, run `claude mcp add jpzip -- npx -y @jpzip/mcp-server-jpzip`. For Claude Desktop or other MCP clients, add `command: npx` with `args: ["-y", "@jpzip/mcp-server-jpzip"]` to your `mcp.json`.'
  - q: Do I need to sign up or get an API key?
    a: 'No. The MCP server has no auth, and the backing jpzip CDN (`https://jpzip.nadai.dev`) is also signup-free for everyone.'
  - q: Can it resolve train stations or business postcodes?
    a: "No. The data source is Japan Post's KEN_ALL.csv, so only address ⇄ postcode lookups (in kanji, katakana, and romaji) are supported."
  - q: Can I search with mixed romaji/kanji queries?
    a: 'Substring matching is contiguous within a single script (kanji-only, kana-only, or romaji-only). Queries like "Yokohama Honcho" that skip the ward in romaji are not supported.'
  - q: What tools does the MCP server expose?
    a: 'Four — `lookup_zipcode`, `search_by_address`, `list_cities_in_prefecture`, and `get_metadata`.'
howTo:
  name: Install the jpzip MCP server in Claude Code
  description: Steps to let Claude Code resolve Japanese postcodes (address ⇄ postcode, plus per-prefecture city listings) end to end.
  steps:
    - name: Have Node.js 18+ available
      text: Make sure Node.js 18 or later is installed locally so that `npx` can run packages on demand. No other setup is required.
    - name: Register the MCP server with Claude Code
      text: Run `claude mcp add jpzip -- npx -y @jpzip/mcp-server-jpzip` in a terminal. The `-y` flag skips npm's interactive confirmation prompt.
    - name: Verify it works
      text: Restart Claude Code, then ask something like "what's at 2310017?". If Claude calls the `lookup_zipcode` tool and returns the address, you're done.
      url: https://github.com/jpzip/mcp
---

> Part 3 of the [jpzip](https://jpzip.nadai.dev/) series. After this, Claude (or any MCP client) can answer "what's at 2310017?" and "what's the postcode for Yokohama-shi Naka-ku Honcho?" without leaving the chat. Part 1: [the Cloudflare Pages free-tier story](https://jpzip.nadai.dev/en/blog/cloudflare-pages-micro-saas/). Part 2: [serving 120,677 records](https://jpzip.nadai.dev/en/blog/cloudflare-pages-static-zipcode-delivery/).

- npm: `@jpzip/mcp-server-jpzip`
- GitHub: <https://github.com/jpzip/mcp>
- Backing data: <https://jpzip.nadai.dev> (Cloudflare Pages)

## TL;DR

- Tiny MCP server that lets Claude do **postcode → address** and **address → postcode** without writing tool code yourself.
- Four tools: `lookup_zipcode`, `search_by_address`, `list_cities_in_prefecture`, `get_metadata`.
- Implementation is **~250 lines** (index.ts + tools.ts).
- The CDN behind it is the existing jpzip static-JSON layout. The MCP server itself is **stateless stdio**.
- Install in one line: `claude mcp add jpzip -- npx -y @jpzip/mcp-server-jpzip`.
- The fun parts: cross-script search (kanji / katakana / romaji) and getting cache lifetimes right.

## Why MCP, not yet another API

jpzip until this point assumed humans calling SDKs. But once you start using Claude regularly, you start wanting things like:

```
"Where is 2310017?"
"What's the postcode for Yokohama Naka-ku Honcho?"
"List every municipality in Kanagawa."
```

You don't want to wire up an HTTP tool every time. That's exactly the gap MCP fills.

## Constraints I locked in up front

Three rules before writing any code:

1. **Stateless.** When Claude restarts, all caches die. No persistent storage.
2. **No auth.** Not on the MCP server, not on the CDN.
3. **Hit the CDN directly.** No proprietary API between MCP and `jpzip.nadai.dev`.

With those, the MCP server becomes "a thin translator between the existing CDN protocol and Claude's tool-calling vocabulary." It holds nothing, owns nothing, and any number of instances can run forever.

## The four tools

| Tool | What it does |
|---|---|
| `lookup_zipcode(zipcode)` | Postcode → full address (kanji + katakana + romaji + JIS + MIC codes) |
| `search_by_address(query, limit?)` | Free-text address → postcode candidates (cross-script, whitespace-insensitive) |
| `list_cities_in_prefecture(prefecture)` | Prefecture name → municipalities (with MIC city codes) |
| `get_metadata()` | Dataset version, total entries, generation timestamp |

Claude chooses which tool to call based on the `description` field, so writing those descriptions well is half the battle. The description for `search_by_address`:

```ts
description:
  'Search for postal codes by free-text address query. Matches against prefecture, city, and town in kanji, katakana, or romaji (case-insensitive substring match, whitespace ignored). First call in a session downloads the full dataset (~25MB) into memory; subsequent calls within the same session are instant.',
```

Spelling out "first call is ~25MB, subsequent calls instant" sets Claude's expectations correctly — it stops being surprised when the first search is slow. **Tool descriptions in MCP aren't human docs, they're prompts.** Optimize them as such.

## Two cache lifetimes, not one

This is where I spent the most design time.

`lookup_zipcode("2310017")` only needs one 3-digit shard (`/p/231.json`, ~10 KB). **First call is fast.**

`search_by_address("Yokohama Naka-ku")` needs the whole dataset in memory. That's 10 shards × ~1 MB ≈ ~25 MB on first call.

I had to decide whether these shared a cache or not. Final shape:

```ts
// Process-lifetime cache for the full merged dictionary.
let fullDatasetPromise: Promise<ZipcodeDict> | null = null;

function getFullDataset(client: JpzipClient): Promise<ZipcodeDict> {
  if (fullDatasetPromise === null) {
    fullDatasetPromise = client.lookupAll().catch((err) => {
      // Reset so the next call can retry.
      fullDatasetPromise = null;
      throw err;
    });
  }
  return fullDatasetPromise;
}
```

- `lookup_zipcode` uses the underlying jpzip SDK's L1 cache (per 3-digit shard). **One ~10 KB fetch.**
- `search_by_address` and `list_cities_in_prefecture` go through `getFullDataset()`. **First call ~25 MB, subsequent instant.**
- Both die with the process. Stateless.

Caching the `Promise` itself (not the resolved value) means that if a second call arrives mid-fetch, **it joins the in-flight request instead of starting a second one**.

## Cross-script search

Japanese addresses come in **three scripts**: kanji, full-width katakana, romaji. Claude will happily mix "ヨコハマ", "Yokohama", and "横浜" in one conversation.

The naive approach — concatenate all three into one big haystack — breaks the moment someone searches for "**Yokohama Honcho**". The intermediate "Shi Naka Ku" appears between "Yokohama" and "Honcho" in the romaji field, so a substring search misses.

So I keep three separate haystacks, one per script:

```ts
for (const town of entry.towns) {
  const kanjiHay = stripWS(`${entry.prefecture}${entry.city}${town.town}`);
  const kanaHay  = stripWS(`${entry.prefecture_kana}${entry.city_kana}${town.kana}`);
  const romaHay  = stripWS(`${entry.prefecture_roma}${entry.city_roma}${town.roma}`);

  if (kanjiHay.includes(needle) ||
      kanaHay.includes(needle) ||
      romaHay.includes(needle)) {
    hits.push({ ... });
  }
}
```

Romaji has a separate whitespace issue — Japan Post writes city names with spaces ("Yokohama Shi Naka Ku"). Strip whitespace on both sides of the comparison and "横浜市中区本町" and "YokohamaShiNakaKuHoncho" collapse to the same string.

> **Known limitation**: matches are contiguous **within one script**. "Yokohama Honcho" (skipping the ward in romaji) won't match. README is upfront about this; perfect semantic search is out of scope for the MCP layer.

## Input normalization

Claude will absolutely pass postcodes like `231-0017` or `231 0017`. Strip them:

```ts
function normalizeZipcode(input: string): string | null {
  const stripped = input.replace(/[-ー\s]/g, '');
  return /^\d{7}$/.test(stripped) ? stripped : null;
}
```

If you don't, users hit "I gave it the right number and it errored." MCP inputs need to accept **anything a human might say out loud**.

## The server skeleton

The whole `index.ts` is about as plain as it gets:

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { JpzipClient } from '@jpzip/jpzip';

const client = new JpzipClient();
const server = new Server(
  { name: 'mcp-server-jpzip', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  switch (name) {
    case 'lookup_zipcode': return toolResult(await lookupZipcode(client, ...));
    case 'search_by_address': return toolResult(await searchByAddress(client, ...));
    case 'list_cities_in_prefecture': return toolResult(await listCitiesInPrefecture(client, ...));
    case 'get_metadata': return toolResult(await client.getMeta());
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

All the CDN-fetching logic lives in the existing `@jpzip/jpzip` TypeScript SDK (the one I'd already shipped). The MCP server doesn't reimplement that — it imports it. **A stable SDK underneath collapses the MCP server to a few hundred lines.**

## Installation

Claude Code:

```sh
claude mcp add jpzip -- npx -y @jpzip/mcp-server-jpzip
```

Claude Desktop or any other MCP client, drop this into `mcp.json`:

```json
{
  "mcpServers": {
    "jpzip": {
      "command": "npx",
      "args": ["-y", "@jpzip/mcp-server-jpzip"]
    }
  }
}
```

That's it. Claude can now resolve any Japanese postcode.

## What it feels like in practice

After installing:

> **Me**: "Where is 2310017?"
> **Claude**: (internally calls `lookup_zipcode`) "横浜市中区本町, Kanagawa."

> **Me**: "List every postcode in Yokohama Honcho."
> **Claude**: (calls `search_by_address("Yokohama Honcho")`) "Here are the matching entries: …"

> **Me**: "Every municipality in Kanagawa."
> **Claude**: (calls `list_cities_in_prefecture("Kanagawa")`) "33 municipalities: …"

Watching Claude **pick the right tool, call it with the right shape, and summarize cleanly** is a useful feedback loop for tuning the descriptions. I iterated on them more than I iterated on the code.

## Architecturally, what changed?

Zero new infrastructure to enable "Claude can do postcodes":

- Data layer: same Cloudflare Pages static JSON.
- Protocol layer: same `spec/v1`.
- Client layer (TS SDK): same `@jpzip/jpzip`.
- **MCP server: new (~250 lines).**

The separation paid off — the MCP server ended up being the **thinnest adapter imaginable**. This is what "data / protocol / client" layering is supposed to feel like when you extend it.

## The 4-part series

1. [I built a postcode-data micro-SaaS on Cloudflare Pages' free tier](https://jpzip.nadai.dev/en/blog/cloudflare-pages-micro-saas/)
2. [Serving 120,677 records from Cloudflare Pages](https://jpzip.nadai.dev/en/blog/cloudflare-pages-static-zipcode-delivery/)
3. **This post** — Writing an MCP server so Claude can look up postcodes
4. [How Claude Code shipped 8 SDKs in 6 hours](https://jpzip.nadai.dev/en/blog/claude-code-8-sdks-6-hours/)

## Try it

- npm: <https://www.npmjs.com/package/@jpzip/mcp-server-jpzip>
- GitHub: <https://github.com/jpzip>
- Backing data: <https://jpzip.nadai.dev/>

If you use Claude and ever do address work in Japan, give `claude mcp add jpzip -- npx -y @jpzip/mcp-server-jpzip` a try. After that you just ask, and Claude does the rest.
