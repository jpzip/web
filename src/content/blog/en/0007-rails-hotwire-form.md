---
id: "0007"
title: "Build a Postal-Code Address Autofill Form with Rails, Hotwire, and jpzip-ruby"
description: Autofill a Japanese address from a postal code in Rails with Turbo Frame or a Stimulus fetch controller, plus an L2 cache that stops Puma workers from re-fetching the same CDN bucket.
lang: en
publishedAt: 2026-05-21
author: nadai
tags: [Framework Integration, Ruby, Rails, Hotwire, Forms]
ogEyebrow: Framework Integration
status: draft
faq:
  - q: Should I use Turbo Frame or a Stimulus fetch controller?
    a: 'Use Turbo Frame when you want progressive enhancement with almost no JavaScript: the server renders the address fields and a plain submit button still works with JS disabled. Use a Stimulus fetch controller when you want fine-grained client-side control — fetching JSON and writing input values in JavaScript makes it easier to add a town picker, an in-progress preview, or other richer UX.'
  - q: How do I avoid re-fetching the same data from the CDN on every request?
    a: 'jpzip-ruby partitions the dataset into 948 three-digit-prefix buckets and keeps fetched buckets in an L1 LRU cache. Within one process, repeated lookups return without a network call, so resolving many addresses on one page collapses to one fetch per bucket. To share buckets across processes, plug a Rails.cache-backed L2 in through Jpzip.configure.'
  - q: Is the L1 cache shared across Puma workers?
    a: 'No. L1 is process-local, so each Puma worker performs its own cold fetch the first time it touches a bucket. If those duplicate cold fetches matter at your scale, subclass Jpzip::Cache to delegate to an L2 store (Rails.cache, Solid Cache, or Redis) and register it with Jpzip.configure so the first worker''s fetch is reused by the rest.'
  - q: Should I call preload("all") in production?
    a: 'Usually not. preload("all") loads the entire dataset (about 37 MiB of JSON) into that process''s memory, so you pay roughly 37 MiB times the number of Puma workers, resident. Sporadic address-form lookups are served fine by L1 plus L2; reserve preload (with a specific prefix) for batch jobs that hammer a known region.'
  - q: Can I trust the address that was autofilled on the client?
    a: 'No. With either pattern the user can edit the address fields by hand, and a form can be POSTed directly. Re-run Jpzip.lookup(zipcode) on the server after submit and confirm the submitted prefecture and city match the CDN data. Client-side autofill is an input aid, not part of the trust boundary.'
  - q: What is KEN_ALL and where does jpzip get its data?
    a: 'KEN_ALL.csv is the official postal-code file Japan Post distributes, updated monthly. jpzip normalizes KEN_ALL.csv and KEN_ALL_ROME.csv into JSON (120,677 entries with kanji, kana, romaji, and government codes) and serves them from a CDN. jpzip-ruby fetches that JSON, so there is no API key and no rate limit.'
howTo:
  name: Add postal-code address autofill to a Rails form with Hotwire and jpzip-ruby
  description: Wire jpzip-ruby into Rails, autofill an address from a postal code using either Turbo Frame or a Stimulus fetch controller, and re-validate on the server.
  steps:
    - name: Add the gems and configure an initializer
      text: 'Add jpzip, turbo-rails, and stimulus-rails to the Gemfile, then call Jpzip.configure in config/initializers/jpzip.rb to set the L1 size and (later) an L2 cache.'
    - name: Build the lookup endpoint
      text: 'Add get "/zipcode" to routes and call Jpzip.lookup in ZipcodesController#show. Use respond_to so the same action returns HTML for Turbo Frame and JSON for Stimulus.'
    - name: Pattern A — swap the address fields with a Turbo Frame
      text: 'Give the postal-code GET form data: { turbo_frame: "address_fields" } and wrap the address fields in turbo_frame_tag "address_fields". The controller returns the address partial and Turbo replaces only the matching frame. A submit button keeps it working with JS disabled.'
    - name: Pattern B — fetch from a Stimulus controller
      text: 'In zipcode_controller.js, handle blur on the postal-code field, fetch("/zipcode?code=...", { headers: { Accept: "application/json" } }), and write prefecture / city / town input values. Add aria-busy and duplicate-lookup suppression.'
    - name: Add an L2 cache to stop duplicate CDN fetches
      text: 'Subclass Jpzip::Cache to delegate get/set/delete/clear to Rails.cache and register it with Jpzip.configure(cache:). This stops each Puma worker from re-fetching the same prefix bucket.'
    - name: Re-validate on the server at submit time
      text: 'In the create action, call Jpzip.lookup(zipcode) again and reject with 422 if the submitted prefecture or city does not match. Never trust the client-side autofill result.'
---

> This guide wires jpzip-ruby into a Rails 7/8 form to autofill the prefecture and city from a Japanese postal code. It shows two patterns — Turbo Frame and a Stimulus fetch controller — and a cache layer that stops Puma workers from re-fetching the same CDN bucket, all in a shape you can ship to production.

Two pieces of context for readers outside the Rails or Japan-address world. **Hotwire** is Rails' default front-end stack: **Turbo** drives partial page updates over HTML, and **Stimulus** is a small controller framework for sprinkling JavaScript onto server-rendered markup. **jpzip** serves Japan Post's `KEN_ALL.csv` — the official, monthly-updated postal-code file — as normalized CDN JSON (120,677 entries), and `jpzip-ruby` is the Ruby gem that looks those entries up with no API key and no rate limit.

## TL;DR

- **There are two implementation patterns.** Turbo Frame renders the address fields server-side with almost no JavaScript. A Stimulus fetch controller pulls JSON and fills the inputs client-side.
- **Separation of concerns mirrors the React setup.** Syntax checks (seven digits) belong to the model/form; the address autofill (postcode → address lookup) belongs to jpzip-ruby.
- **Client-side autofill sits outside the trust boundary.** After submit, always re-call `Jpzip.lookup` on the server and confirm the prefecture and city match.
- jpzip-ruby fetches data in **948 three-digit-prefix buckets** and keeps them in an L1 LRU cache. A repeated lookup in the same process returns in about 0.3 ms without a network call.
- L1 is **process-local**, so under multi-worker Puma you plug a **Rails.cache-backed L2** (a `Jpzip::Cache` subclass) to share buckets across workers.
- `preload("all")` keeps roughly 37 MiB resident per worker — skip it for address forms. L1 plus L2 is enough.

## Why this setup

Most "Rails postal code autofill" examples call an external API (such as zipcloud) straight from JavaScript. They work, but they inherit that API's availability, rate limits, and CSP constraints. jpzip-ruby reads CDN-hosted static JSON from the Ruby side, so your Rails process owns the cache and there is no rate-limit axis at all.

With Hotwire, decide which pattern to build first.

| Concern | Turbo Frame | Stimulus + fetch |
|---|---|---|
| JavaScript | almost none (3 lines for auto-submit) | one controller (~40 lines) |
| With JS disabled | works via submit button | does not work (no PE) |
| Builds the fields | server-side (ERB partial) | client-side (input.value) |
| Rich UX (town picker, preview) | needs a server round-trip | done on the client |
| Response format | HTML fragment | JSON |
| Testing | system tests | controller test + system test |

Turbo Frame is the "server is the source of truth" Rails approach, and progressive enhancement falls out naturally. Stimulus + fetch suits an SPA-like feel. This article implements both and closes with a shared server-side check.

## Integration steps

### 1. Add the gems and configure an initializer

```ruby
# Gemfile
gem "jpzip"
gem "turbo-rails"
gem "stimulus-rails"
```

```ruby
# config/initializers/jpzip.rb
require "jpzip"

Jpzip.configure(
  memory_cache_size: 256, # L1: number of prefix buckets to keep (default 100)
)
```

`memory_cache_size` is how many three-digit-prefix buckets L1 keeps. The whole dataset splits into 948 buckets, so 256 is a reasonable "don't evict the busy urban buckets" figure. The L2 cache comes in step 5.

jpzip-ruby requires Ruby 3.2+ (it uses `Data.define`) and has zero runtime dependencies beyond the standard library (`net/http`, `json`, `monitor`).

### 2. Build the lookup endpoint

Serve both the Turbo Frame HTML and the Stimulus JSON from one action.

```ruby
# config/routes.rb
get "/zipcode", to: "zipcodes#show", as: :zipcode
```

```ruby
# app/controllers/zipcodes_controller.rb
class ZipcodesController < ApplicationController
  # GET /zipcode?code=2310017
  def show
    code = params[:code].to_s.gsub(/\D/, "") # strip hyphens etc. down to 7 digits
    @entry = Jpzip.lookup(code)              # nil when not found

    respond_to do |format|
      # Pattern A: return the address-fields partial (a turbo-frame)
      format.html { render partial: "zipcodes/address_fields", locals: { entry: @entry } }

      # Pattern B: return JSON
      format.json do
        return head :not_found if @entry.nil?
        render json: {
          prefecture: @entry.prefecture,
          city:       @entry.city,
          town:       @entry.towns.first&.town,
        }
      end
    end
  end
end
```

`Jpzip.lookup` returns `nil` for non-seven-digit input without touching the network, so normalizing with `gsub(/\D/, "")` safely rejects malformed values.

### 3. Pattern A — swap the address fields with a Turbo Frame

Extract the address fields into a partial and wrap that partial itself in `turbo_frame_tag`. The frame exists exactly once on the page, and the controller returns the same partial, so the response always contains a matching turbo-frame.

```erb
<%# app/views/zipcodes/_address_fields.html.erb %>
<%= turbo_frame_tag "address_fields" do %>
  <%= label_tag "user[prefecture]", "Prefecture" %>
  <%= text_field_tag "user[prefecture]", entry&.prefecture %>

  <%= label_tag "user[city]", "City" %>
  <%= text_field_tag "user[city]", entry&.city %>

  <%= label_tag "user[town]", "Town" %>
  <%= text_field_tag "user[town]", entry&.towns&.first&.town %>

  <output role="status" aria-live="polite">
    <%= "Address filled in" if entry %>
  </output>
<% end %>
```

```erb
<%# app/views/users/new.html.erb %>
<%# Postal-code GET form. It replaces the address turbo-frame. %>
<%= form_with url: zipcode_path, method: :get, data: { turbo_frame: "address_fields" } do %>
  <%= label_tag :code, "Postal code" %>
  <%= text_field_tag :code, params[:code], inputmode: "numeric", maxlength: 8 %>
  <%= submit_tag "Look up address" %> <%# works even with JS disabled %>
<% end %>

<%# Main form. The address fields (turbo-frame) live inside it. %>
<%= form_with model: @user do |f| %>
  <%= render "zipcodes/address_fields", entry: nil %>
  <%= f.submit "Register" %>
<% end %>
```

Looking up `code=2310017` returns:

```ruby
entry = Jpzip.lookup("2310017")
"#{entry.prefecture} #{entry.city} #{entry.towns.first.town}"
# => 神奈川県 横浜市中区 港町
# (231-0017 — Naka Ward, Yokohama)
```

Pinning the example to `231-0017` in Naka Ward, Yokohama keeps it recognizable when you revisit the code.

To auto-submit on blur (instead of clicking the button) when JavaScript is on, add a three-line Stimulus controller.

```js
// app/javascript/controllers/autosubmit_controller.js
import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  submit() { this.element.requestSubmit() }
}
```

Put `data-controller="autosubmit"` on the GET form and `data-action="blur->autosubmit#submit"` on the postal-code field, and the frame swaps the moment focus leaves. Hide the submit button only when JS is on, and the form still works without it.

### 4. Pattern B — fetch from a Stimulus controller

This pulls JSON and writes the input values client-side. Write one `@hotwired/stimulus` controller.

```js
// app/javascript/controllers/zipcode_controller.js
import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["code", "prefecture", "city", "town", "status"]
  static values = { url: String }

  #lastLookedUp = ""

  async lookup() {
    const code = this.codeTarget.value.replace(/\D/g, "")
    if (code.length !== 7) return
    if (code === this.#lastLookedUp) return // skip the duplicate lookup
    this.#lastLookedUp = code

    this.codeTarget.setAttribute("aria-busy", "true")
    try {
      const res = await fetch(`${this.urlValue}?code=${code}`, {
        headers: { Accept: "application/json" },
      })
      if (!res.ok) {
        this.statusTarget.textContent = "No address found for that postal code"
        return
      }
      const a = await res.json()
      this.prefectureTarget.value = a.prefecture
      this.cityTarget.value = a.city
      this.townTarget.value = a.town ?? ""
      this.statusTarget.textContent = "Address filled in"
    } finally {
      this.codeTarget.removeAttribute("aria-busy")
    }
  }
}
```

```erb
<%# app/views/users/new.html.erb (Pattern B) %>
<%= form_with model: @user, data: { controller: "zipcode", zipcode_url_value: zipcode_path } do |f| %>
  <%= f.label :zipcode, "Postal code" %>
  <%= f.text_field :zipcode, inputmode: "numeric", maxlength: 8,
        data: { zipcode_target: "code", action: "blur->zipcode#lookup" } %>

  <%= f.label :prefecture, "Prefecture" %>
  <%= f.text_field :prefecture, data: { zipcode_target: "prefecture" } %>

  <%= f.label :city, "City" %>
  <%= f.text_field :city, data: { zipcode_target: "city" } %>

  <%= f.label :town, "Town" %>
  <%= f.text_field :town, data: { zipcode_target: "town" } %>

  <output role="status" aria-live="polite" data-zipcode-target="status"></output>
  <%= f.submit "Register" %>
<% end %>
```

`#lastLookedUp` remembers the last successful postal code and skips a duplicate lookup for the same value. L1 makes the second lookup cheap anyway, but the real reason is UX: if the user edits the town by hand and then blurs the postal-code field again, an unconditional re-fill would clobber that edit. The `aria-busy` and `aria-live="polite"` pairing tells a screen reader "loading" and "done," exactly as in the React article.

### 5. Add an L2 cache to stop duplicate CDN fetches

Through step 1, L1 is process-local. Run Puma with four workers and the first lookup of a given prefix bucket triggers four CDN fetches, one per worker. To collapse that to one, subclass `Jpzip::Cache` and delegate to `Rails.cache`.

```ruby
# config/initializers/jpzip.rb
require "jpzip"

# Keys are the full prefix-bucket URL (e.g. https://jpzip.nadai.dev/p/231.json);
# values are raw JSON bytes. Store them in Rails.cache (Solid Cache / Redis / etc.).
class RailsJpzipCache < Jpzip::Cache
  def get(key)        = Rails.cache.read(key)
  def set(key, value) = Rails.cache.write(key, value, expires_in: 7.days)
  def delete(key)     = Rails.cache.delete(key)
  def clear           = nil # do not wipe all of Rails.cache (it is shared)
end

Jpzip.configure(
  memory_cache_size: 256,
  cache:             RailsJpzipCache.new,
)
```

Now the first worker to fetch a bucket writes the JSON into Rails.cache, and the rest hit L2 instead of the CDN. Even an admin page resolving 50 addresses at once touches only a handful of prefix buckets, so network round-trips top out at the bucket count. `expires_in: 7.days` stays well under the monthly data-update cycle, and L1/L2 are cleared automatically when `Jpzip.meta` detects a version change.

Leaving `clear` as a no-op matters. Rails.cache normally holds other things too, so wiping all of it on `refresh` would be a collateral-damage bug. To purge a specific bucket, use `delete` with the key.

### 6. Re-validate on the server at submit time

Client-side autofill is an input aid, not trusted input. The user may have edited the address before submitting, so re-run the lookup in the create action.

```ruby
# app/controllers/users_controller.rb
def create
  zip   = user_params[:zipcode].to_s.gsub(/\D/, "")
  entry = Jpzip.lookup(zip)

  if entry.nil?
    return render :new, status: :unprocessable_entity,
                  alert: "Invalid postal code"
  end
  if entry.prefecture != user_params[:prefecture] || entry.city != user_params[:city]
    return render :new, status: :unprocessable_entity,
                  alert: "Postal code and address do not match"
  end

  @user = User.new(user_params)
  @user.save ? redirect_to(@user) : render(:new, status: :unprocessable_entity)
end
```

Checking the prefecture and city catches a tampered direct POST. Do not require an exact town match — users append a street address there, so equality is too strict.

## Pitfalls

- **Nesting the lookup form inside the main form.** HTML forbids nested forms. Keep the postal-code GET form and the main POST form separate, and put the address turbo-frame in the main form. Frame swaps cross form boundaries fine.
- **Declaring `turbo_frame_tag` twice.** Define the frame once, in the partial; both the view and the controller render that same partial. Wrapping it again nests frames and the swap stops working.
- **No matching frame in the response.** Turbo finds the turbo-frame with the same id in the response and swaps only its contents. If the controller returns a full layout instead of the address partial, the frame is missing and Turbo errors.
- **Assuming L1 is shared.** L1 is per-worker. If duplicate fetches matter at your scale, always add L2. Conversely, a single-process dev environment makes it easy to misjudge the behavior.
- **Calling `preload("all")` at boot.** That keeps ~37 MiB resident per worker. It is overkill for sporadic address lookups and wastes boot time and memory; reserve a prefix-scoped preload for high-frequency batches.
- **Forgetting to decide on multiple towns.** Taking `towns.first` for a postal code with `towns.length > 1` (bulk-mail or some areas) can mis-fill. Take the first for e-commerce; show a `<select>` for government forms — decide by requirement.

## Verifying it works

Use a Capybara system test for the blur → fields-filled path. To avoid hitting the real CDN, stub `Jpzip.lookup` or stub `https://jpzip.nadai.dev/p/231.json` with WebMock.

```ruby
# test/system/address_form_test.rb
require "application_system_test_case"

class AddressFormTest < ApplicationSystemTestCase
  test "blur on the postal code autofills the address" do
    visit new_user_path
    fill_in "Postal code", with: "231-0017"
    find_field("Postal code").native.send_keys(:tab) # fire blur

    assert_field "Prefecture", with: "神奈川県"
    assert_field "City", with: "横浜市中区"
    assert_text "Address filled in"
  end
end
```

Test the endpoint on its own with a controller test.

```ruby
# test/controllers/zipcodes_controller_test.rb
require "test_helper"

class ZipcodesControllerTest < ActionDispatch::IntegrationTest
  test "returns the address as JSON" do
    get zipcode_path(code: "2310017"), as: :json
    assert_response :success
    body = JSON.parse(response.body)
    assert_equal "神奈川県", body["prefecture"]
    assert_equal "横浜市中区", body["city"]
  end

  test "unknown postal code is 404" do
    get zipcode_path(code: "0000000"), as: :json
    assert_response :not_found
  end
end
```

Once L2 is in place, looking up the same prefix twice and asserting no second HTTP call fires (WebMock's `assert_requested` count) proves the cache is working.

## Wrap-up

For postal-code autofill on Rails + Hotwire, first decide between Turbo Frame and a Stimulus fetch controller. Pick Turbo Frame when the server is the source of truth and you want progressive enhancement; pick Stimulus + fetch when you want richer client-side UX.

Either way, the split stays the same: syntax checks on the form, address autofill via jpzip-ruby, final validation on the server. Just remember that L1 is process-local under multi-worker Puma — drop in a `Jpzip::Cache` L2 and you can ship it without hammering the CDN.

Related:

- [What jpzip is](/blog/0001-cloudflare-pages-micro-saas/) — why a CDN static-delivery model
- [Delivering 120,677 entries](/blog/0002-cloudflare-pages-static-zipcode-delivery/) — the three-digit-prefix bucketing and L1 LRU design
- [React Hook Form + Zod + jpzip](/blog/0006-react-hook-form-zod/) — the same lookup pattern in React
</content>
