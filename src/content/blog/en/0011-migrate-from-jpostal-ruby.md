---
id: "0011"
title: "Migrating from ken_all / jpostcode to jpzip-ruby"
description: "Migrate off ken_all (KEN_ALL.csv in a database) and jpostcode (submodule-bundled data) to jpzip-ruby's CDN lookup: field mapping, no monthly imports, and the one feature you lose."
lang: en
publishedAt: 2026-05-25
author: nadai
tags: [Migration, Ruby, Rails, CDN]
ogEyebrow: Migration Guide
status: published
faq:
  - q: Why migrate from ken_all or jpostcode to jpzip-ruby?
    a: 'The biggest win is that you no longer carry KEN_ALL.csv inside your deploy artifact. ken_all imports the CSV into a database table; jpostcode bundles the data as a git submodule baked into the gem. Both require a re-import or a `bundle update` plus redeploy every time Japan Post publishes a monthly update. jpzip-ruby fetches JSON from a CDN, so the data leaves your artifact entirely and monthly updates are picked up with no redeploy. You also gain romaji (`prefecture_roma`), the municipality code (`city_code`), and an L1 LRU plus optional L2 cache.'
  - q: Is jpostal a Ruby gem?
    a: 'No. jpostal (jquery.jpostal.js) is a front-end jQuery plugin, not a Ruby gem. In Rails apps the common stack was "jquery.jpostal.js for front-end autofill + jp_prefecture for prefecture-code conversion + KEN_ALL.csv seeded into a database table." On the Ruby side, the gems that actually expand KEN_ALL.csv locally are ken_all and jpostcode, and those are what this guide migrates. If you are moving off the front-end jquery.jpostal.js itself, the Yubinbango migration guide is the closer reference because the data-fetch path is similar.'
  - q: Can jpzip-ruby look up office postcodes like 113-8654 (University of Tokyo)?
    a: 'No. jpostcode ships Japan Post''s large-volume office postcodes (from JIGYOSYO.CSV) and `Jpostcode.find("113-8654")` returns an `office_name` (the University of Tokyo administrative office). jpzip-ruby''s dataset is built from KEN_ALL.csv and KEN_ALL_ROME.csv only, so office postcodes are not included. Any code path that reads `office_name` or `street` is lost in the migration and must be handled separately. This is a deliberate design boundary, not a gap jpzip plans to close.'
  - q: What happens to the database table or bundled data after migrating?
    a: 'Both disappear. Coming from ken_all, you can drop the `ken_all_postal_codes` table and the `rake ken_all:import` job — hundreds of thousands of rows leave your database. Coming from jpostcode, the `kufu/jpostcode-data` git submodule and the `bundle update jpostcode` chore go away. jpzip-ruby deploys code only; the 120,677 entries are served from the `jpzip.nadai.dev` CDN.'
  - q: "Can jpzip-ruby replace ken_all's LIKE-based reverse lookup (address to postcode)?"
    a: 'Not directly. Because ken_all stores rows in a database, you could write `KenAll::PostalCode.where("address2 LIKE ?", "%Yokohama%")` to search from an address back to a postcode. jpzip-ruby only does postcode-to-address lookup; there is no API that takes an address string and returns a postcode. You can call `Jpzip.lookup_all` (about 37 MiB) and build your own reverse index in memory, but whether that is worth it depends on your use case. Split any reverse-lookup path out of the migration.'
  - q: Does jpzip-ruby work in a fully offline environment?
    a: 'The first (cold) lookup needs a CDN fetch. ken_all (database) and jpostcode (bundled data) use no network at runtime, so they run as-is in a fully air-gapped environment. jpzip-ruby can warm the entire dataset at boot with `preload("all")` and serve subsequent lookups without the network once you attach an L2 cache (a `Jpzip::Cache` subclass backed by a file or Redis), but the initial warm-up still has to reach the CDN. If runtime traffic can never leave the box, account for this in your design.'
howTo:
  name: Migrating from ken_all / jpostcode to jpzip-ruby
  description: Concrete steps to replace Ruby gems that expand KEN_ALL.csv locally (ken_all / jpostcode) with jpzip-ruby's CDN lookup.
  steps:
    - name: Audit existing dependencies and call sites
      text: 'Check Gemfile for `ken_all` / `jpostcode`, then grep for `KenAll::PostalCode` and `Jpostcode.find`. Split out paths that use jpostcode''s `office_name` / `street` (office postcodes) or ken_all''s `where(... LIKE ...)` (pseudo reverse lookup), since jpzip-ruby has neither.'
    - name: Install jpzip-ruby
      text: 'Add `gem "jpzip"` to the Gemfile and run `bundle install`. It requires Ruby 3.2+ and its only runtime dependencies are the standard library (net/http / json / monitor) — no activerecord, no bundled data.'
    - name: Migrate from ken_all (database-backed)
      text: 'Replace `KenAll::PostalCode.find_by(code:)` with `Jpzip.lookup(code)`. Map `address1/2/3` to `prefecture` / `city` / `towns.first.town`, and `address_kana1/2/3` to `prefecture_kana` / `city_kana` / `towns.first.kana`. Then drop the `ken_all_postal_codes` table, its migration, and `rake ken_all:import`.'
    - name: Migrate from jpostcode (submodule-bundled)
      text: 'Replace `Jpostcode.find(zip)` with `Jpzip.lookup(zip)`. `prefecture` / `city` / `town` map almost directly; jpostcode''s Array of multiple matches maps to jpzip''s `towns` array. Then remove the `kufu/jpostcode-data` git submodule and the `bundle update jpostcode` chore.'
    - name: Remove the data-update workflow
      text: 'Delete the scheduled `rake ken_all:import` job, or the `bundle update jpostcode` + redeploy procedure. jpzip-ruby follows monthly dataset updates with no redeploy, and `Jpzip.meta` clears L1/L2 automatically when it detects a version change.'
    - name: Verify and re-validate server-side
      text: 'Confirm a lookup for 231-0017 (Yokohama City Hall area, Naka Ward, Yokohama). Stub `jpzip.nadai.dev` with WebMock in tests. On form submit, call `Jpzip.lookup` again in the create action and re-check the submitted values against the CDN data.'
---

> A practical guide to moving off Ruby gems that expand KEN_ALL.csv locally — ken_all imports it into a database, jpostcode bundles it as a git submodule — and onto jpzip-ruby's CDN-served lookup. You leave the form markup and controller shape untouched and only change how address data is *stored*: from "baked into the deploy artifact" to "CDN plus a local cache."

KEN_ALL.csv is the canonical postal-code file Japan Post publishes monthly: roughly 120,677 entries mapping a 7-digit postcode to prefecture, city, and town, in kanji and katakana. Every Ruby postcode library is, at bottom, a way to read this file — the question is only where the file lives at runtime.

## TL;DR

- **ken_all imports KEN_ALL.csv into a database table; jpostcode bundles the data as a git submodule inside the gem.** Either way the address data becomes part of your deploy artifact, and each monthly update means a re-import or a `bundle update` plus redeploy
- **jpzip-ruby just fetches JSON from a CDN.** The data leaves your artifact, monthly updates need no redeploy, and lookups land in an L1 LRU plus optional L2 cache so repeat reads return in about 0.3 ms
- **The migration is a one-call swap.** Map ken_all's `address1/2/3` and jpostcode's `prefecture/city/town` onto jpzip's `prefecture` / `city` / `towns.first.town`
- In exchange you gain romaji (`prefecture_roma`) and the municipality code (`city_code`). Neither ken_all nor jpostcode carries romaji
- Two caveats. **jpostcode's office postcodes (`office_name`) do not exist in jpzip-ruby**, and **ken_all's database-backed reverse lookup (address to postcode) cannot be replaced.** Split both paths out of the migration
- Note: jpostal (jquery.jpostal.js) is a front-end jQuery plugin, not a Ruby gem. The gems that expand the CSV on the Ruby side are ken_all and jpostcode

## Why migrate

ken_all and jpostcode both read Japan Post's [KEN_ALL.csv](https://www.post.japanpost.jp/zipcode/download.html) to resolve a postcode to an address from Ruby. Their approaches are opposites, so it helps to separate them first.

- [ken_all](https://github.com/kazuhisa/ken_all) **imports KEN_ALL.csv into a database table.** `rake ken_all:import` downloads the data from Japan Post and loads hundreds of thousands of rows into a `ken_all_postal_codes` table.
- [jpostcode](https://github.com/kufu/jpostcode-rb) **bundles the data as a git submodule (`kufu/jpostcode-data`) inside the gem.** `Jpostcode.find` reads in-memory data and never touches the network at runtime.

What they share is that the address data lives inside the deploy artifact. Whether it is rows in a database or a submodule frozen into the gem, both demand manual work on every update.

| Dimension | ken_all | jpostcode | jpzip-ruby |
|---|---|---|---|
| Where data lives | Database table (CSV imported) | Git submodule in the gem | CDN-served JSON (edge cache) |
| Setup | migration + `rake ken_all:import` | `bundle install` only | `gem "jpzip"` only |
| Monthly update | re-run `rake ken_all:import` | `bundle update jpostcode` + redeploy | automatic (no redeploy) |
| Deploy artifact | rows in the database | bundled data (submodule) | code only (data on CDN) |
| Romaji | none | none | yes (`prefecture_roma`, etc.) |
| Municipality code | none (`address1/2/3` only) | none (`prefecture_code` only) | yes (`city_code` / JIS X 0401) |
| Office postcodes | none (KEN_ALL only) | yes (`office_name` / `street`) | none (KEN_ALL only) |
| Reverse lookup | pseudo (DB LIKE query) | none | none |
| Network at runtime | none (DB) | none (bundled) | cold fetch only, then cached |
| Runtime dependencies | activerecord (Rails) | bundled data | standard library only |
| Maintenance | last updated 2023-01 | active (as of 2026-05) | active |

jpzip-ruby reads static JSON from a CDN (Cloudflare Pages' edge). The data leaves the deploy artifact completely, and Japan Post's monthly update is absorbed by swapping the data on the CDN side — your app does nothing. The delivery design is covered in [Serving 120,677 entries](/blog/0002-cloudflare-pages-static-zipcode-delivery/).

Maintenance is worth a word. ken_all is a practical gem, but its last update was January 2023. Japan Post reshapes its download page every few years, so the automatic download in `rake ken_all:import` does not always work today; some projects fall back to `rake ken_all:import:file FILE=...` to feed a CSV by hand. jpostcode is actively maintained and ships its data submodule under date-stamped versions (for example `v1.0.0.20260507`).

### jpostal is not a Ruby gem

This is an easy confusion, so let's settle it up front. **jpostal (jquery.jpostal.js) is a front-end jQuery plugin**, not a Ruby gem. When a Rails app says it "uses jpostal," it usually means this combination:

- Front end: `jquery.jpostal.js` reacts to a postcode field and fills the address fields
- Back end: `jp_prefecture` for prefecture-code conversion, plus address data from a hand-seeded table built from KEN_ALL.csv, or from ken_all / jpostcode

The gems expanding KEN_ALL.csv on the Ruby side are ken_all and jpostcode, and those are what this guide replaces. If you are migrating off the front-end jquery.jpostal.js itself — a JS-driven autofill whose data fetch is owned by the library — the [Yubinbango migration guide](/blog/0005-migrate-from-yubinbango-js/) is the closer reference, since the structure matches.

## Migration steps

### 1. Audit existing dependencies and call sites

Find the gems and the call sites.

```bash
grep -nE 'gem ["'"'"']ken_all|gem ["'"'"']jpostcode' Gemfile
git grep -n 'KenAll::PostalCode'
git grep -n 'Jpostcode\.'
```

Two of these have no equivalent in jpzip-ruby. If you find them, split them out of the migration:

- jpostcode's `office_name` / `office_name_kana` / `street` (large-volume office postcodes)
- ken_all's `KenAll::PostalCode.where("address2 LIKE ?", ...)` (pseudo reverse lookup from an address)

### 2. Install jpzip-ruby

```ruby
# Gemfile
gem "jpzip"
```

```sh
$ bundle install
```

jpzip-ruby requires Ruby 3.2+ (it uses `Data.define`) and its only runtime dependencies are the standard library (`net/http` / `json` / `monitor`). It does not assume activerecord the way ken_all does, nor does it carry a submodule the way jpostcode does.

### 3. Migrate from ken_all (database-backed)

ken_all imports KEN_ALL.csv into a `ken_all_postal_codes` table and reads it through the `KenAll::PostalCode` model. The columns are `code` (the postcode), `address1/2/3` (prefecture, city, town), and `address_kana1/2/3` (each in katakana).

The field mapping:

| Purpose | ken_all (`KenAll::PostalCode`) | jpzip-ruby (`entry`) |
|---|---|---|
| Postcode | `code` | (lookup argument) |
| Prefecture | `address1` | `prefecture` |
| City | `address2` | `city` |
| Town | `address3` | `towns.first.town` |
| Prefecture kana | `address_kana1` | `prefecture_kana` |
| City kana | `address_kana2` | `city_kana` |
| Town kana | `address_kana3` | `towns.first.kana` |
| Romaji | none | `prefecture_roma` / `city_roma` / `towns.first.roma` |
| Municipality code | none | `city_code` |
| Multiple matches | multiple rows with the same `code` | `towns` array |

**Before** (ken_all reading the database):

```ruby
record = KenAll::PostalCode.find_by(code: "2310017")
return if record.nil?

prefecture = record.address1  # 神奈川県 (Kanagawa)
city       = record.address2  # 横浜市中区 (Naka Ward, Yokohama)
town       = record.address3  # 港町 (Minatocho)
```

**After** (swapped for jpzip-ruby's `lookup`):

```ruby
require "jpzip"

entry = Jpzip.lookup("2310017") # nil when not found
return if entry.nil?

prefecture = entry.prefecture            # 神奈川県
city       = entry.city                  # 横浜市中区
town       = entry.towns.first&.town     # 港町
code       = entry.city_code             # 14104 (ken_all has no equivalent)
```

`Jpzip.lookup` returns `nil` for malformed input without making a network call, so normalizing with `gsub(/\D/, "")` before the call safely rejects bad values. Once the swap is done, you can drop the `ken_all_postal_codes` table, its migration, and the scheduled `rake ken_all:import`.

### 4. Migrate from jpostcode (submodule-bundled)

jpostcode reads its bundled in-memory data through `Jpostcode.find`. Its field names are close to jpzip's, so the migration is light on renaming.

| Purpose | jpostcode (`address`) | jpzip-ruby (`entry`) |
|---|---|---|
| Prefecture | `prefecture` | `prefecture` |
| Prefecture kana | `prefecture_kana` | `prefecture_kana` |
| Prefecture code | `prefecture_code` | `prefecture_code` |
| City | `city` | `city` |
| City kana | `city_kana` | `city_kana` |
| Town | `town` | `towns.first.town` |
| Town kana | `town_kana` | `towns.first.kana` |
| Postcode | `zip_code` | (lookup argument) |
| Romaji | none | `prefecture_roma` / `city_roma` / `towns.first.roma` |
| Municipality code | none | `city_code` |
| Multiple matches | `find` returns an Array | `towns` array |
| Office postcodes | `office_name` / `street` (present) | none |

**Before** (jpostcode reading bundled data):

```ruby
address = Jpostcode.find("231-0017")
# a single match is one object; multiple matches return an Array
address = address.first if address.is_a?(Array)

prefecture = address.prefecture  # 神奈川県
city       = address.city        # 横浜市中区
town       = address.town        # 港町
```

**After** (swapped for jpzip-ruby's `lookup`):

```ruby
entry = Jpzip.lookup("2310017")
return if entry.nil?

prefecture = entry.prefecture          # 神奈川県
city       = entry.city                # 横浜市中区
town       = entry.towns.first&.town   # 港町
```

Mind the difference in how multiple matches are shaped. jpostcode returns an Array from `find` itself when a postcode covers several towns, whereas jpzip-ruby keeps a `towns` array inside a single `entry`. Code that did `Array#each` over jpostcode results becomes `entry.towns.each` in jpzip.

### 5. Remove the data-update workflow

This is the heart of the migration: delete the update chores from both gems.

- **ken_all**: if `rake ken_all:import` ran on a schedule (cron / CI), delete that job. The hundreds of thousands of database rows go with it.
- **jpostcode**: remove the `kufu/jpostcode-data` git submodule and the monthly `bundle update jpostcode` + redeploy step.

jpzip-ruby follows Japan Post's monthly update through a CDN-side data swap, so the app-side update work drops to zero. Version tracking is built in.

```ruby
# Checking meta at boot or in a health check lets the SDK detect a
# dataset update and discard the L1/L2 cache on its own
meta = Jpzip.meta
Rails.logger.info("jpzip dataset version: #{meta.version}")
```

When `Jpzip.meta` observes that `/meta.json`'s `version` has changed, L1 (and L2 when configured) is cleared automatically. Calling `meta` periodically is the recommended way not to miss a monthly rollover.

### 6. Verify and re-validate server-side

Confirm a lookup for **231-0017** (Yokohama City Hall area, Naka Ward, Yokohama — 神奈川県横浜市中区港町). To avoid hitting the real CDN, stub `https://jpzip.nadai.dev/p/231.json` with WebMock in tests.

```ruby
# test/models/zipcode_lookup_test.rb
require "test_helper"

class ZipcodeLookupTest < ActiveSupport::TestCase
  test "resolves 231-0017 to Kanagawa / Naka Ward, Yokohama / Minatocho" do
    entry = Jpzip.lookup("2310017") # stub jpzip.nadai.dev in real test runs
    assert_equal "神奈川県", entry.prefecture
    assert_equal "横浜市中区", entry.city
    assert_equal "港町", entry.towns.first.town
  end
end
```

If a form feeds you an address, do not trust the submitted values. A client-side autofilled address can be edited by the user, so call `Jpzip.lookup` again in the create action and confirm the match. This separation of concerns matches the [Rails + Hotwire guide](/blog/0007-rails-hotwire-form/).

```ruby
def create
  zip   = user_params[:zipcode].to_s.gsub(/\D/, "")
  entry = Jpzip.lookup(zip)

  if entry.nil? || entry.prefecture != user_params[:prefecture] || entry.city != user_params[:city]
    return render :new, status: :unprocessable_entity, alert: "Postcode and address do not match"
  end

  @user = User.new(user_params)
  @user.save ? redirect_to(@user) : render(:new, status: :unprocessable_entity)
end
```

## Pitfalls

- **jpostcode's office postcodes are lost in the migration.** jpostcode carries large-volume office postcodes (from JIGYOSYO.CSV) and `Jpostcode.find("113-8654")` returns an `office_name` (the University of Tokyo administrative office). jpzip-ruby's KEN_ALL-based data has no office postcodes, so this path cannot migrate. Keep jpostcode for it, or fill it from another source
- **ken_all's pseudo reverse lookup cannot be replaced.** Because ken_all is a database table, `where("address2 LIKE ?", "%Yokohama%")` could search from an address back to a postcode. jpzip-ruby is postcode-to-address only. Build your own index from `Jpzip.lookup_all` (about 37 MiB) or keep a separate mechanism
- **Multiple matches are shaped differently.** jpostcode expresses multiple matches in the return value of `find` (an Array); jpzip expresses them in the `towns` array of one `entry`. A single match is equivalent, but the loop target changes
- **Cold-fetch latency.** ken_all (DB) and jpostcode (bundled) needed no network at runtime, but jpzip-ruby fetches from the CDN on the first call. In production, warming with `preload` or an L2 cache erases the gap. A fully air-gapped environment cannot reach the cold fetch, so absorb it in your design
- **L1 is process-local.** jpzip-ruby's L1 LRU works in 3-digit prefix buckets (948 of them) and sits separately in each Puma worker. If duplicate fetches matter at your scale, attach an L2 (Rails.cache / Redis) via a `Jpzip::Cache` subclass through `Jpzip.configure` (details in the [Rails + Hotwire guide](/blog/0007-rails-hotwire-form/))

## What you measure / what shrinks

The operational and artifact savings matter more than raw latency.

| Metric | ken_all (DB) | jpostcode (bundled) | jpzip-ruby (CDN) |
|---|---|---|---|
| First lookup (cold) | ~0.5 ms (DB query) | ~0.1 ms (memory) | ~70 ms (CDN fetch) |
| Repeat (same prefix) | ~0.5 ms | ~0.1 ms | ~0.3 ms (L1 LRU hit) |
| Data in deploy artifact | rows in the DB | bundled in the gem (submodule) | 0 (CDN-served) |
| Manual work per monthly update | re-run `rake import` | `bundle update` + redeploy | none (automatic) |
| Romaji / municipality code | none | none | yes |
| Extra runtime dependency | activerecord | bundled data | none (stdlib only) |

In absolute cold numbers the database and in-memory approaches win, but that gap vanishes once you add `preload` or an L2. What pays off in production is taking the address data out of the deploy artifact: the database rows, the submodule, and the monthly manual chore all disappear at once.

## Wrap-up

ken_all and jpostcode expand KEN_ALL.csv locally — as database rows or as a bundled submodule. Both buy you no runtime network at the cost of making address data part of the deploy artifact, with manual work on every monthly update.

Migrating to jpzip-ruby is a one-call swap. Map ken_all's `address1/2/3` and jpostcode's `prefecture/city/town` onto jpzip's `prefecture` / `city` / `towns.first.town`, then delete the update workflow. You gain romaji and the municipality code, and monthly updates become automatic. The only two paths you cannot migrate — office postcodes and the pseudo reverse lookup — should be split out honestly.

Related:

- [The jpzip overview](/blog/0001-cloudflare-pages-micro-saas/) — why a CDN static-delivery model
- [Serving 120,677 entries](/blog/0002-cloudflare-pages-static-zipcode-delivery/) — 3-digit prefix bucketing and how monthly updates work
- [Rails + Hotwire + jpzip-ruby address autofill](/blog/0007-rails-hotwire-form/) — the post-migration form and how to attach an L2 cache
- [Migrating from Yubinbango to jpzip-js](/blog/0005-migrate-from-yubinbango-js/) — moving off front-end jQuery autofill (the jpostal.js family)
</content>
