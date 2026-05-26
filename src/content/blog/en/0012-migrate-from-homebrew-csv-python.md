---
id: "0012"
title: From a Homemade KEN_ALL.csv Parser to jpzip (Python)
description: Replace homemade pandas KEN_ALL.csv parsing with jpzip-python — Shift_JIS, multi-line records, the romaji join, and monthly updates fold into one lookup.
lang: en
publishedAt: 2026-05-26
author: nadai
tags: [Migration, Python, CSV, KEN_ALL]
ogEyebrow: Migration Guide
status: published
faq:
  - q: Why migrate from a homemade KEN_ALL.csv parser to jpzip-python?
    a: 'KEN_ALL.csv is the official Japanese postal code CSV published by Japan Post, and parsing it correctly is harder than it looks. Migrating lets you drop Shift_JIS decoding, the merging of multi-line records, the splitting of parenthesized town names, the join against the separate romaji file (KEN_ALL_ROME.csv), and the monthly re-import job. jpzip-python serves a normalized JSON of all 120,677 entries from a CDN, so after `pip install jpzip` a lookup is one line: `jpzip.lookup("2310017")`. Kanji, kana, romaji, and the JIS municipality codes all arrive on the same `ZipcodeEntry`.'
  - q: Do I still have to handle KEN_ALL.csv multi-line records with jpzip-python?
    a: 'No. In KEN_ALL.csv a single logical entry is split across multiple lines when the town name exceeds 38 full-width characters (76 half-width for the kana), which breaks naive row-by-row parsing. jpzip''s data pipeline merges and normalizes those rows before publishing the JSON, so the SDK side never deals with line continuation or parentheses.'
  - q: Can I get romaji and municipality codes too? I used to join KEN_ALL_ROME.csv myself.
    a: 'Yes. `entry.prefecture_roma` / `entry.city_roma` / `entry.towns[0].roma` give romaji, and `entry.prefecture_code` / `entry.city_code` give the national municipality code (JIS X 0401 / X 0402) — all on the same entry. The join between KEN_ALL.csv and KEN_ALL_ROME.csv on the 7-digit postal code, which is ambiguous when one code maps to several towns, goes away entirely.'
  - q: Can it look up a postal code from an address string (reverse lookup)?
    a: 'No. jpzip-python provides postal-code-to-address lookup only; there is no reverse lookup from an address string back to a postal code. If your homemade code searched the DataFrame by address text, that path cannot be replaced directly. You can fetch the entire dataset with `jpzip.lookup_all()` (about 37 MiB) and build your own reverse index, but whether that is worth it depends on your use case.'
  - q: There is a new UTF-8 format (utf_all.csv) since 2023 — does that make migration unnecessary?
    a: 'The new format is one record per line, UTF-8, with half-width kana removed, so it does ease the multi-line-record and encoding problems. But romaji still lives in KEN_ALL_ROME.csv, and the parenthesized-town splitting, the municipality-code handling, and automating the monthly re-import all remain your job. jpzip ships all of that already normalized, which is the difference.'
  - q: Does it work offline or for large batch validation?
    a: 'Yes. Call `jpzip.preload("all")` to warm the L1 cache, and subsequent lookups return without a network round-trip. For validating a large list of postal codes, fetch a dictionary keyed by the 7-digit code once with `all_entries = jpzip.lookup_all()` and test membership with `code in all_entries`.'
howTo:
  name: Migrating from a homemade KEN_ALL.csv parser to jpzip-python
  description: Concrete steps to replace homemade pandas code that parses Japan Post's KEN_ALL.csv with jpzip-python's normalized lookups.
  steps:
    - name: Inventory the homemade parser and its pitfalls
      text: 'Find every place that reads KEN_ALL.csv plus the Shift_JIS decoding, multi-line-record merging, parenthesized-town handling, KEN_ALL_ROME.csv join, and monthly re-import job. Separate out any address-to-postal-code reverse lookup, which cannot be migrated.'
    - name: Install jpzip
      text: 'Add it with `pip install jpzip`. The only runtime dependency is httpx, and the wheel bundles no CSV or database. Requires Python 3.10 or newer.'
    - name: Replace the parse step with lookup()
      text: 'Swap `pd.read_csv("KEN_ALL.CSV", encoding="shift_jis")` and the DataFrame search for `jpzip.lookup("2310017")`. It returns None for not-found and for malformed input, so branch on None.'
    - name: Drop the manual romaji and code join
      text: 'Remove the KEN_ALL_ROME.csv join and the municipality-code digit splitting; read `entry.prefecture_roma` / `entry.city_code` and friends from the same entry.'
    - name: Replace batch validation with lookup_all()
      text: 'To validate many postal codes, fetch a dictionary keyed by the 7-digit code once with `all_entries = jpzip.lookup_all()` and test `code in all_entries`.'
    - name: Remove the monthly update job
      text: 'Delete the cron / Makefile that downloaded KEN_ALL.csv and regenerated data each month. jpzip updates monthly, and a version change observed by `get_meta()` invalidates the cache automatically.'
    - name: Verify
      text: 'Check 231-0017 (Yokohama City Hall area, Naka Ward) for entry.prefecture / entry.city / entry.towns[0].town. With pytest, stub jpzip.nadai.dev using respx.'
---

> A practical guide to moving off homemade `pandas` code that parses Japan Post's KEN_ALL.csv and onto jpzip-python's normalized lookups. The story is about deleting all the code you wrote just to read KEN_ALL.csv correctly — Shift_JIS, multi-line records, parenthesized town names, and the separate romaji file.

## TL;DR

- **Almost every headache in a homemade parser comes from the KEN_ALL.csv format itself.** Shift_JIS decoding, merging the multi-line records that appear when a town name runs long, splitting parenthesized town names, and joining the separate romaji file (KEN_ALL_ROME.csv) — jpzip's pipeline does all of that before publishing JSON, so your code does none of it
- **After migrating, fetching data is one line: `jpzip.lookup("2310017")`.** Kanji, kana, romaji, and the JIS municipality codes all arrive on the same `ZipcodeEntry`
- **The monthly update job disappears.** No more cron to download KEN_ALL.csv and regenerate data; jpzip updates monthly and a version change seen by `get_meta()` invalidates the cache for you
- jpzip-python's only runtime dependency is [httpx](https://www.python-httpx.org/), and the **wheel bundles no CSV or database** — data is fetched from the `jpzip.nadai.dev` CDN
- One caveat: **reverse lookup (address to postal code) does not exist in jpzip-python.** Separate out any path that did reverse lookup before migrating

## Background: what KEN_ALL.csv is

[KEN_ALL.csv](https://www.post.japanpost.jp/zipcode/download.html) is the official ZIP-code dataset that Japan Post publishes, covering all 120,677 Japanese postal codes (郵便番号). It is the de facto source for Japanese address data, and "just read the CSV with `pandas`" is still common in Python projects.

The problem is that it is not a file you can read one row at a time. It is distributed in Shift_JIS (MS Kanji code, JIS X 0208-1983) as a 15-column CSV: a national municipality code, the old 5-digit code, the 7-digit postal code, prefecture / city / town in half-width katakana, the same three in kanji, and six trailing flag columns (whether one town spans multiple codes, whether the town has chōme blocks, and so on).

## Why migrate

The four pitfalls a homemade parser has to handle:

| Pitfall | What it is | Homemade workaround |
|---|---|---|
| Encoding | Shift_JIS, not UTF-8 | Pass `encoding="shift_jis"`; forget it and you get mojibake |
| Multi-line records | One logical entry is split across rows when the town name exceeds 38 full-width characters (76 half-width for kana) | Pre-pass to concatenate the continuation rows |
| Parenthesized towns | Notes like "(excluding ...)" appear inside parentheses in the town field | Rules to split the inside from the outside of the parentheses |
| Placeholder towns | A non-existent town name such as "以下に掲載がない場合" ("when not listed below") | Filter it out or special-case it |

If you need romaji, you join the separate **KEN_ALL_ROME.csv** on the 7-digit postal code — a file with a different layout, and a join that is ambiguous when one postal code maps to several towns. And because KEN_ALL.csv is updated monthly, you keep a download-and-regenerate job running.

jpzip-python serves JSON where this CSV wrangling is already done in the **data pipeline (ETL)**. Your code only ever touches the normalized result.

| Aspect | Homemade KEN_ALL.csv parser | jpzip-python |
|---|---|---|
| Data source | Read a local CSV with `pandas` | Fetch CDN JSON from `jpzip.nadai.dev` |
| Encoding handling | Pass `encoding="shift_jis"` yourself | None (served as UTF-8 JSON) |
| Multi-line merging | Implement the pre-pass yourself | None (merged in the ETL) |
| Parenthesized towns | Implement splitting rules yourself | None (normalized) |
| Romaji | Join KEN_ALL_ROME.csv separately | Included on `entry.*_roma` |
| Municipality codes | Split the column by digit yourself | Already split into `prefecture_code` / `city_code` |
| Monthly updates | Run your own download + regenerate job | Automatic monthly, with `get_meta()` invalidation |
| Distribution | CSV often committed to the repo | No CSV/DB in the wheel (CDN-served) |
| Sync / async | Sync only (`pandas`) | `JpzipClient` plus `AsyncJpzipClient` |

The data itself comes from the same Japan Post KEN_ALL.csv. What differs is *where and by whom the CSV gets processed*.

### The one thing you cannot migrate: reverse lookup

Settle this up front. If your homemade code searched the DataFrame by an address string to find a postal code, that reverse lookup cannot be replaced directly — jpzip-python offers postal-code-to-address lookup only.

You can fetch the whole dataset with `jpzip.lookup_all()` (about 37 MiB) and build your own reverse index, but weigh that against memory and your actual need. This article covers the postal-code-to-address path.

## Migration steps

### 1. Inventory the homemade parser and its pitfalls

First, find everything that touches KEN_ALL.csv.

```bash
grep -rn 'KEN_ALL\|shift_jis\|cp932\|KEN_ALL_ROME' --include='*.py' .
grep -rn 'read_csv' --include='*.py' .
```

A typical homemade parser looks like this — it reads, but is subtly wrong.

```python
import pandas as pd

# Name the 15 columns of KEN_ALL.csv
COLS = [
    "jis_code", "old_zip", "zip",
    "pref_kana", "city_kana", "town_kana",
    "pref", "city", "town",
    "f_multi_zip", "f_koaza", "f_chome", "f_multi_town", "f_update", "f_reason",
]

df = pd.read_csv(
    "KEN_ALL.CSV",
    encoding="shift_jis",   # forget this and you get mojibake
    header=None,
    names=COLS,
    dtype=str,              # read as strings to keep leading zeros
)

def lookup(zip7: str) -> dict | None:
    rows = df[df["zip"] == zip7]
    if rows.empty:
        return None
    r = rows.iloc[0]
    return {"pref": r["pref"], "city": r["city"], "town": r["town"]}
```

It looks like it works, but it never concatenates multi-line records, so long town names get truncated; parenthesized towns come through verbatim; romaji is impossible; and `town` sometimes holds the placeholder "以下に掲載がない場合". "Works but is incorrect" is the worst state to be in.

If you have reverse lookup written as `df[df["town"].str.contains(...)]`, separate it out now.

### 2. Install jpzip

```bash
pip install jpzip
```

The only runtime dependency is [httpx](https://www.python-httpx.org/). If you pulled in `pandas` solely for postal codes, you can drop that dependency. The wheel contains no CSV and no database. Python 3.10 or newer is required.

### 3. Replace the parse step with lookup()

`jpzip.lookup("2310017")` returns `ZipcodeEntry | None`. It returns `None` for not-found and for malformed (non-7-digit) input — and makes no network round-trip on malformed input.

**Before** (homemade parser):

```python
result = lookup("2310017")
if result is not None:
    print(result["pref"], result["city"], result["town"])
    # 神奈川県 横浜市中区 港町 (but multi-line / parentheses may be broken)
```

**After** (jpzip):

```python
import jpzip

entry = jpzip.lookup("2310017")
if entry is None:
    print("not found")
else:
    town = entry.towns[0].town if entry.towns else ""
    print(entry.prefecture, entry.city, town)
    # 神奈川県 横浜市中区 港町
```

The field mapping is below. Where the homemade parser had one row per town, jpzip gives one postal-code entry that holds a `towns` array. The case of one postal code covering several towns (the KEN_ALL.csv flag "one code represents two or more towns") is expressed naturally as that array.

| Purpose | Homemade parser (DataFrame row) | jpzip-python (`entry`) |
|---|---|---|
| Prefecture | `r["pref"]` | `entry.prefecture` |
| City / ward | `r["city"]` | `entry.city` |
| Town | `r["town"]` (parentheses may leak in) | `entry.towns[0].town` |
| Multiple towns for one code | Multiple rows | `entry.towns` (array) |
| Prefecture code | `r["jis_code"][:2]` | `entry.prefecture_code` |
| Municipality code | `r["jis_code"]` | `entry.city_code` |

### 4. Drop the manual romaji and code join

The code that loaded KEN_ALL_ROME.csv and joined it on the 7-digit postal code can be deleted wholesale. Romaji and codes come from the same entry.

```python
import jpzip

entry = jpzip.lookup("2310017")
if entry is not None:
    print(entry.prefecture_roma, entry.city_roma, entry.towns[0].roma)
    # Kanagawa Ken Yokohama Shi Naka Ku Minatocho

    print(entry.prefecture_code, entry.city_code)
    # 14 14104
```

`prefecture_code` (14) is the prefecture code; `city_code` (14104) is the national municipality code (JIS X 0401 / X 0402) maintained by the Ministry of Internal Affairs and Communications. The logic that split `jis_code` into its first two digits and the rest is no longer needed.

### 5. Replace batch validation with lookup_all()

If you loaded the entire CSV into a DataFrame to validate a list of postal codes, `lookup_all()` is a direct replacement. It returns a dictionary keyed by the 7-digit postal code.

```python
import jpzip

all_entries = jpzip.lookup_all()   # 120,677 entries, ~37 MiB, fetched in parallel
for code in csv_zipcodes:
    if code not in all_entries:
        print(f"nonexistent postal code: {code}")
```

Fetching the dictionary once and testing with `in` beats issuing many single lookups. In a long-running process, warm the L1 cache with `jpzip.preload("all")` and subsequent lookups return without a network round-trip.

### 6. Remove the monthly update job

KEN_ALL.csv is updated monthly. A homemade setup ran a cron or Makefile to download, regenerate, and deploy each month. Because jpzip updates monthly itself, you can delete all of that.

```python
import jpzip

meta = jpzip.get_meta()
if meta is not None:
    print(meta.version, meta.generated_at, meta.total_zipcodes)
    # e.g. 2026-05  2026-05-01T...  120677
```

When `get_meta()` observes that the `version` in `/meta.json` has changed, the L1 cache (and L2 when configured) is cleared automatically. In a long-running process, call `get_meta()` periodically to pick up the monthly rollover.

### 7. Verify

Check **231-0017** (Yokohama City Hall area, Naka Ward, Yokohama — 神奈川県横浜市中区港町). With pytest you can stub `jpzip.nadai.dev` using [respx](https://lundberg.github.io/respx/).

```python
import jpzip

def test_lookup_231_0017():
    entry = jpzip.lookup("2310017")   # stub with respx in CI
    assert entry is not None
    assert entry.prefecture == "神奈川県"
    assert entry.city == "横浜市中区"
    assert entry.towns[0].town == "港町"
    assert entry.city_code == "14104"
```

## Gotchas

- **Reverse lookup cannot be replaced.** Again: address-to-postal-code does not exist in jpzip-python. Decide between building your own index from `lookup_all()` or keeping a separate mechanism
- **`towns` is an array.** The homemade parser had one row per town; jpzip holds a `towns` array per entry. A single town (the common case) is `entry.towns[0]`, but postal codes with multiple towns need you to iterate. Guard against an empty `towns` before indexing `entry.towns[0]`
- **Per-business postal codes do not resolve.** Large per-business codes such as 163-8001 (Tokyo Metropolitan Government) are not in KEN_ALL.csv. Your homemade parser did not return them either, so this is not a difference the migration introduces
- **Switching to the new format (utf_all.csv) still leaves work.** The format introduced in June 2023 — one record per line, UTF-8, no half-width kana — eases the multi-line and encoding problems. But the separate romaji file, the parenthesized-town splitting, the municipality-code handling, and automating the monthly re-import remain yours
- **Offline requirements.** A fully offline environment cannot reach the CDN. After `preload("all")` no network is needed, but the first fetch is. If required, persist the `lookup_all()` result to your own L2 (file / SQLite / Redis)

## Measured results

A representative comparison between a homemade parser (KEN_ALL.csv via `pandas`) and jpzip-python over the same 500 postal-code lookups.

| Metric | Homemade KEN_ALL.csv parser | jpzip-python |
|---|---|---|
| Postal-code parsing code | 80–150 lines (with multi-line merge + parenthesis handling) | 1–3 lines |
| Runtime dependencies | `pandas` (+ transitive) | `httpx` only |
| Bundled data | CSV often committed (tens of MB) | None (CDN-served) |
| First lookup (p50, Tokyo) | ~0.1 ms after CSV load | ~70 ms (CDN round-trip) |
| Subsequent (same prefix) | ~0.1 ms | ~0.05 ms (L1 hit) |
| Full fetch / after preload | All in memory at startup | No network after `preload("all")` |
| Monthly update | Your own cron | Automatic (`get_meta()` invalidation) |

To be fair, once the CSV is fully in memory, the homemade parser's raw single-lookup speed is fine. The difference shows up in **correctness and operations**. Code that genuinely handles multi-line records and parenthesized towns tends to exceed 80 lines and still needs monthly update tracking. jpzip-python deletes that code and that operation; the first lookup pays a CDN round-trip, then converges to in-memory lookups after `preload`.

## Wrapping up

A homemade KEN_ALL.csv parser starts as a few lines of `read_csv`. Then comes the mojibake fix, the multi-line merge, the parenthesis splitting, the romaji join, and the monthly cron — and before long you are running a postal-code data platform of your own.

Migrating to jpzip-python folds that accumulation into one line of `jpzip.lookup()`. Shift_JIS, multi-line records, and parentheses all disappear from the caller's view. Unless you rely on reverse lookup, the lines you delete far outnumber the ones you add.

Related:

- [Serving 120,677 entries](/blog/0002-cloudflare-pages-static-zipcode-delivery/) — how KEN_ALL.csv is normalized and chunked into JSON for the CDN
- [The jpzip overview](/blog/0001-cloudflare-pages-micro-saas/) — why the no-signup, free CDN model
- [Migrating from the ken_all / jpostcode gems to jpzip-ruby](/blog/0011-migrate-from-jpostal-ruby/) — the same "moving off a locally expanded CSV" migration, in Ruby
