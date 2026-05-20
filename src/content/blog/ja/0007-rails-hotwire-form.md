---
id: "0007"
title: "Rails + Hotwire + jpzip-ruby で住所自動入力フォームを作る"
description: Turbo Frame と Stimulus の 2 パターンで、郵便番号から都道府県・市区町村を自動入力する Rails フォームを作る手順。jpzip-ruby の L1/L2 キャッシュで Puma プロセスをまたいだ CDN への重複フェッチを潰す構成まで含めて解説します。
publishedAt: 2026-05-21
author: nadai
tags: [Framework Integration, Ruby, Rails, Hotwire, Forms]
ogEyebrow: フレームワーク統合
status: draft
faq:
  - q: Turbo Frame と Stimulus + fetch、どちらのパターンを選ぶべきですか?
    a: 'JS を極力書かずに段階的拡張(Progressive Enhancement)を効かせたいなら Turbo Frame、クライアント側で住所欄の埋め方を細かく制御したいなら Stimulus + fetch です。Turbo Frame は submit ボタンさえ置けば JS 無効でも動き、サーバー側で住所欄の HTML を組み立てます。Stimulus + fetch は JSON を引いて JS で input の value を書き込むので、複数町域の選択 UI や入力中プレビューなど凝った UX を足しやすいです。'
  - q: jpzip-ruby を Rails で使うとき、リクエストごとに CDN を叩く重複フェッチはどう防ぎますか?
    a: 'jpzip-ruby は 3 桁プレフィックス単位(948 バケット)でデータを取得し、L1 LRU キャッシュにバケットを保持します。同じプロセス内では 2 回目以降の lookup がネットワークを介さず返るので、1 ページで複数住所を引いても CDN フェッチはバケット数ぶんに収束します。プロセスをまたいだ重複は、Rails.cache を L2 として差し込めば共有できます。'
  - q: Puma のマルチワーカー環境で L1 キャッシュは共有されますか?
    a: '共有されません。L1 はプロセスローカルなので、Puma の各ワーカーが初回アクセス時にそれぞれ CDN を叩きます。ワーカー数 ぶんの cold fetch が走るのが気になる場合は、`Jpzip::Cache` を継承した L2(Rails.cache / Solid Cache / Redis)を `Jpzip.configure` で差し込み、最初に引いたワーカーの結果を他ワーカーが再利用できるようにします。'
  - q: preload("all") は本番環境で使うべきですか?
    a: 'むやみには使わないほうが良いです。`preload("all")` は全データ(約 37 MiB の JSON)をそのプロセスのメモリに載せるので、Puma ワーカー数 × 37 MiB が常駐します。住所入力のような散発的な lookup では L1 + L2 で十分で、preload は「特定地域の郵便番号を高頻度で引くバッチ」など用途が絞れる場合に prefix 指定で使うのが現実的です。'
  - q: クライアント側で自動入力された住所をそのまま信用してよいですか?
    a: 'いけません。Turbo Frame でも Stimulus + fetch でも、住所欄はユーザーが手で書き換えられます。submit 後のサーバー側で改めて `Jpzip.lookup(zipcode)` を呼び、送信された都道府県・市区町村が CDN データと一致するかを最終確認します。クライアント側の自動入力はあくまで入力補助で、信頼境界の内側ではありません。'
  - q: 複数町域が返る郵便番号はどう扱えばよいですか?
    a: '`entry.towns` が複数要素を持つ郵便番号(大口事業所向けや一部地域)では、先頭の `towns.first` を採用するか、`towns` を `<select>` でユーザーに選ばせるかを要件で分けます。EC の配送先入力なら先頭採用で実害は出にくいですが、行政手続きのように正確さが要る場面では選択 UI を出すのが安全です。'
howTo:
  name: Rails + Hotwire + jpzip-ruby で住所自動入力フォームを実装する
  description: jpzip-ruby を Rails に組み込み、Turbo Frame または Stimulus + fetch で郵便番号から住所を自動入力し、サーバー側で再検証するまでの手順。
  steps:
    - name: gem を入れて initializer で設定する
      text: 'Gemfile に jpzip / turbo-rails / stimulus-rails を追加し、`config/initializers/jpzip.rb` で `Jpzip.configure` を呼んで L1 サイズと L2 キャッシュを設定する。'
    - name: 郵便番号 lookup のエンドポイントを作る
      text: 'routes に `get "/zipcode"` を足し、ZipcodesController#show で `Jpzip.lookup` を呼ぶ。respond_to で Turbo Frame 用の HTML と Stimulus 用の JSON の両方を返せるようにする。'
    - name: パターン A — Turbo Frame で住所欄だけ差し替える
      text: '郵便番号の GET フォームに `data: { turbo_frame: "address_fields" }` を付け、住所欄を `turbo_frame_tag "address_fields"` で囲む。コントローラは住所欄の partial を返し、Turbo が一致するフレームだけを差し替える。submit ボタンを置けば JS 無効でも動く。'
    - name: パターン B — Stimulus controller から fetch する
      text: 'zipcode_controller.js で郵便番号フィールドの blur を拾い、`fetch("/zipcode?code=...", { headers: { Accept: "application/json" } })` で JSON を引いて prefecture / city / town の input に value を書き込む。aria-busy と二重 lookup 抑制を入れる。'
    - name: L2 キャッシュで CDN への重複フェッチを潰す
      text: '`Jpzip::Cache` を継承して get/set/delete/clear を Rails.cache に委譲したクラスを作り、`Jpzip.configure(cache:)` で差し込む。Puma の各ワーカーが同じ prefix バケットを再フェッチするのを防ぐ。'
    - name: submit 時にサーバー側で再検証する
      text: 'フォーム送信後の create アクションで再度 `Jpzip.lookup(zipcode)` を呼び、送信された都道府県・市区町村が一致しなければ 422 で弾く。クライアント側の自動入力結果を鵜呑みにしない。'
---

> Rails 7/8 のフォームに jpzip-ruby を組み込み、郵便番号から都道府県・市区町村を自動入力する典型構成を作ります。Turbo Frame と Stimulus + fetch の 2 パターンを示し、Puma のマルチワーカーで CDN への重複フェッチを潰すキャッシュ層まで、そのまま production に置ける形で書きます。

## TL;DR

- **2 つの実装パターンがある**。Turbo Frame は JS をほぼ書かずサーバー側で住所欄の HTML を組み立てる。Stimulus + fetch は JSON を引いてクライアントで input を埋める
- **責務分離**は React の構成と同じ。構文チェック(7 桁数字)はモデル/フォーム側、住所の自動入力(zipcode → 住所のルックアップ)は jpzip-ruby に任せる
- **クライアント側の自動入力は信頼境界の外**。submit 後にサーバー側で必ず `Jpzip.lookup` を呼び直して都道府県・市区町村の一致を確認する
- jpzip-ruby は **3 桁プレフィックス単位(948 バケット)** でデータを引き、L1 LRU にバケットを保持する。同一プロセス内の 2 回目以降の lookup はネットワークを介さず約 0.3 ms で返る
- Puma のマルチワーカーでは L1 がプロセスローカルなので、**`Jpzip::Cache` を継承した L2(Rails.cache)** を差し込んでワーカー間で共有する
- `preload("all")` は約 37 MiB をメモリ常駐させるので、住所入力用途では使わない。L1 + L2 で十分

## なぜこの構成か

「Rails 郵便番号 住所自動入力」で出てくる実装は、外部 API(zipcloud など)を JavaScript から直接叩くものが多数です。動きはしますが、外部 API の可用性・レート制限・CSP の制約をそのまま抱え込みます。jpzip-ruby は CDN 配信の静的 JSON を Ruby 側から引くので、Rails のサーバープロセスがキャッシュの主体になり、レート制限の概念自体がありません。

Hotwire を使う場合、どちらのパターンで組むかを最初に決めます。

| 観点 | Turbo Frame | Stimulus + fetch |
|---|---|---|
| JavaScript 量 | ほぼゼロ(自動送信だけ 3 行) | controller 1 本(40 行程度) |
| JS 無効時 | submit ボタンで動く | 動かない(PE なし) |
| 住所欄の組み立て | サーバー側(ERB partial) | クライアント側(input.value) |
| 凝った UX(町域選択・プレビュー) | サーバー往復が要る | クライアントで完結 |
| レスポンス形式 | HTML フラグメント | JSON |
| テスト | system test 中心 | controller test + system test |

Turbo Frame は「サーバーが正」の Rails らしい組み方で、段階的拡張が自然に効きます。Stimulus + fetch は SPA に近い操作感を作りたいときに向きます。本記事は両方を実装し、最後に共通のサーバー側検証で締めます。

## 統合手順

### 1. gem を入れて initializer で設定する

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
  memory_cache_size: 256, # L1: 保持する prefix バケット数(default 100)
)
```

`memory_cache_size` は L1 に保持する 3 桁プレフィックスバケットの数です。データ全体は 948 バケットに分かれているので、256 は「よく使う都市部のバケットを取りこぼさない」あたりの目安です。L2 はステップ 5 で足します。

jpzip-ruby は Ruby 3.2 以上(`Data.define` を使う)で、ランタイム依存は標準ライブラリ(`net/http` / `json` / `monitor`)だけです。Gemfile に足す追加の依存はありません。

### 2. 郵便番号 lookup のエンドポイントを作る

Turbo Frame の HTML と Stimulus の JSON を 1 つのアクションで返せるようにします。

```ruby
# config/routes.rb
get "/zipcode", to: "zipcodes#show", as: :zipcode
```

```ruby
# app/controllers/zipcodes_controller.rb
class ZipcodesController < ApplicationController
  # GET /zipcode?code=2310017
  def show
    code = params[:code].to_s.gsub(/\D/, "") # ハイフン等を落として 7 桁に
    @entry = Jpzip.lookup(code)              # 見つからなければ nil

    respond_to do |format|
      # パターン A: 住所欄の partial(turbo-frame)を返す
      format.html { render partial: "zipcodes/address_fields", locals: { entry: @entry } }

      # パターン B: JSON を返す
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

`Jpzip.lookup` は 7 桁でない入力に対してネットワークを叩かずに `nil` を返すので、`gsub(/\D/, "")` で整形しておけば不正値は安全に弾けます。

### 3. パターン A — Turbo Frame で住所欄だけ差し替える

住所欄を partial に切り出し、その partial 自体を `turbo_frame_tag` で囲みます。フレームはページ上に 1 回だけ存在し、コントローラのレスポンスも同じ partial を返すので、レスポンスに「一致する turbo-frame」が必ず含まれます。

```erb
<%# app/views/zipcodes/_address_fields.html.erb %>
<%= turbo_frame_tag "address_fields" do %>
  <%= label_tag "user[prefecture]", "都道府県" %>
  <%= text_field_tag "user[prefecture]", entry&.prefecture %>

  <%= label_tag "user[city]", "市区町村" %>
  <%= text_field_tag "user[city]", entry&.city %>

  <%= label_tag "user[town]", "町域" %>
  <%= text_field_tag "user[town]", entry&.towns&.first&.town %>

  <output role="status" aria-live="polite">
    <%= "住所を取得しました" if entry %>
  </output>
<% end %>
```

```erb
<%# app/views/users/new.html.erb %>
<%# 郵便番号の GET フォーム。住所欄の turbo-frame を差し替える %>
<%= form_with url: zipcode_path, method: :get, data: { turbo_frame: "address_fields" } do %>
  <%= label_tag :code, "郵便番号" %>
  <%= text_field_tag :code, params[:code], inputmode: "numeric", maxlength: 8 %>
  <%= submit_tag "住所を検索" %> <%# JS 無効でもこのボタンで動く %>
<% end %>

<%# 本体フォーム。住所欄(turbo-frame)を内側に置く %>
<%= form_with model: @user do |f| %>
  <%= render "zipcodes/address_fields", entry: nil %>
  <%= f.submit "登録" %>
<% end %>
```

ここで `entry&.towns&.first&.town` のように住所欄を埋めます。例えば `code=2310017` を引くと次が返ります。

```ruby
entry = Jpzip.lookup("2310017")
"#{entry.prefecture} #{entry.city} #{entry.towns.first.town}"
# => 神奈川県 横浜市中区 港町
```

例の郵便番号は横浜市中区の `231-0017` に固定しておくと、見直し時に「これはどこの番号だっけ」と迷いません。

JS を有効にしたときに submit ボタンを押さず blur で自動送信したい場合は、3 行の Stimulus controller を足します。

```js
// app/javascript/controllers/autosubmit_controller.js
import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  submit() { this.element.requestSubmit() }
}
```

GET フォームに `data-controller="autosubmit"`、郵便番号フィールドに `data-action="blur->autosubmit#submit"` を付ければ、フォーカスが外れた瞬間にフレームが差し替わります。submit ボタンは JS 有効時だけ隠せば、JS 無効でも壊れません。

### 4. パターン B — Stimulus controller から fetch する

JSON を引いてクライアント側で input の value を書き込むパターンです。`@hotwired/stimulus` の controller を 1 本書きます。

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
    if (code === this.#lastLookedUp) return // 同じ値なら二重に引かない
    this.#lastLookedUp = code

    this.codeTarget.setAttribute("aria-busy", "true")
    try {
      const res = await fetch(`${this.urlValue}?code=${code}`, {
        headers: { Accept: "application/json" },
      })
      if (!res.ok) {
        this.statusTarget.textContent = "該当する郵便番号が見つかりません"
        return
      }
      const a = await res.json()
      this.prefectureTarget.value = a.prefecture
      this.cityTarget.value = a.city
      this.townTarget.value = a.town ?? ""
      this.statusTarget.textContent = "住所を取得しました"
    } finally {
      this.codeTarget.removeAttribute("aria-busy")
    }
  }
}
```

```erb
<%# app/views/users/new.html.erb (パターン B) %>
<%= form_with model: @user, data: { controller: "zipcode", zipcode_url_value: zipcode_path } do |f| %>
  <%= f.label :zipcode, "郵便番号" %>
  <%= f.text_field :zipcode, inputmode: "numeric", maxlength: 8,
        data: { zipcode_target: "code", action: "blur->zipcode#lookup" } %>

  <%= f.label :prefecture, "都道府県" %>
  <%= f.text_field :prefecture, data: { zipcode_target: "prefecture" } %>

  <%= f.label :city, "市区町村" %>
  <%= f.text_field :city, data: { zipcode_target: "city" } %>

  <%= f.label :town, "町域" %>
  <%= f.text_field :town, data: { zipcode_target: "town" } %>

  <output role="status" aria-live="polite" data-zipcode-target="status"></output>
  <%= f.submit "登録" %>
<% end %>
```

直近に成功した郵便番号を `#lastLookedUp` に覚えておき、同じ値での二重 lookup を抑えています。L1 が効くので 2 回目の lookup 自体は速いのですが、ユーザーが町域を手で書き換えた後に同じ郵便番号で blur が走ると書き換えが巻き戻るため、その UX 事故を防ぐ意味合いが大きいです。`aria-busy` と `aria-live="polite"` の組み合わせは React 版の記事と同じ理屈で、スクリーンリーダーに「取得中」「取得完了」を伝えます。

### 5. L2 キャッシュで CDN への重複フェッチを潰す

ステップ 1 までの構成だと、L1 はプロセスローカルです。Puma を 4 ワーカーで動かすと、ある prefix バケットを初めて引くとき 4 ワーカーがそれぞれ CDN を叩きます。これを 1 回に収束させるには、`Jpzip::Cache` を継承して Rails.cache に委譲する L2 を差し込みます。

```ruby
# config/initializers/jpzip.rb
require "jpzip"

# キーは prefix バケットの完全 URL(例: https://jpzip.nadai.dev/p/231.json)、
# 値は生の JSON バイト列。Rails.cache(Solid Cache / Redis 等)に保存する。
class RailsJpzipCache < Jpzip::Cache
  def get(key)        = Rails.cache.read(key)
  def set(key, value) = Rails.cache.write(key, value, expires_in: 7.days)
  def delete(key)     = Rails.cache.delete(key)
  def clear           = nil # Rails.cache 全体は消さない(他用途と同居しているため)
end

Jpzip.configure(
  memory_cache_size: 256,
  cache:             RailsJpzipCache.new,
)
```

これで、最初にバケットを引いたワーカーが Rails.cache に JSON を書き、他ワーカーは L2 ヒットで CDN を叩かずに済みます。1 ページで 50 件の住所を解決するような管理画面でも、関係する prefix バケットは数個に収まるので、ネットワーク往復はバケット数ぶんで頭打ちになります。`expires_in: 7.days` はデータの月次更新サイクルより十分短く、`Jpzip.meta` が version 変化を検知したときにも L1/L2 はクリアされます。

`clear` を Rails.cache 全消去にしないのは重要です。jpzip 以外のキャッシュと同居しているのが普通なので、`refresh` 時に巻き込み事故を起こさないよう no-op にしています。prefix 単位で確実に消したい場合は `delete` をキー指定で使います。

### 6. submit 時にサーバー側で再検証する

クライアント側の自動入力は入力補助であって、信頼できる入力ではありません。送信時にユーザーが住所を手で書き換えている可能性があるので、create アクションで再度 lookup して一致を確認します。

```ruby
# app/controllers/users_controller.rb
def create
  zip   = user_params[:zipcode].to_s.gsub(/\D/, "")
  entry = Jpzip.lookup(zip)

  if entry.nil?
    return render :new, status: :unprocessable_entity,
                  alert: "郵便番号が不正です"
  end
  if entry.prefecture != user_params[:prefecture] || entry.city != user_params[:city]
    return render :new, status: :unprocessable_entity,
                  alert: "郵便番号と住所が一致しません"
  end

  @user = User.new(user_params)
  @user.save ? redirect_to(@user) : render(:new, status: :unprocessable_entity)
end
```

都道府県・市区町村まで一致を見れば、フォームを直接 POST で叩く改ざんもここで弾けます。町域はユーザーが番地を足すため厳密一致を要求しないのが現実的です。

## ハマりやすい所

- **lookup フォームと本体フォームを入れ子にする**: HTML はフォームのネストを許しません。郵便番号の GET フォームと本体の POST フォームは別々に置き、住所欄の turbo-frame は本体フォーム側に入れます。フレームの差し替えはフォームの境界を越えて動きます
- **partial と view で turbo_frame_tag を二重に書く**: フレームは partial 側で 1 回だけ定義し、view とコントローラは同じ partial を render します。二重に囲むとフレームが入れ子になって差し替えが効きません
- **レスポンスに一致するフレームが無い**: Turbo は「同じ id の turbo-frame」をレスポンスから探して中身だけ差し替えます。コントローラが住所欄の partial を返さずレイアウト全体を返すと、フレームが見つからずエラーになります
- **L1 がプロセス共有だと思い込む**: L1 はワーカーごとに別物です。重複フェッチが気になる規模なら L2 を必ず差し込みます。逆に開発環境(単一プロセス)では L1 だけで挙動を誤解しがちです
- **`preload("all")` を本番初期化で呼ぶ**: 約 37 MiB がワーカー数ぶん常駐します。住所入力の散発 lookup には過剰で、ブート時間とメモリを浪費します。高頻度バッチで使うなら prefix 指定の preload に絞ります
- **複数町域の扱いを決め忘れる**: `towns.length > 1` の郵便番号で先頭採用すると、用途によっては誤入力になります。EC なら先頭採用、行政手続きなら `<select>` で選択、と要件で分けます

## 動作確認

Capybara の system test で blur → 住所欄が埋まる経路を確認します。実 CDN を叩かないよう、`Jpzip.lookup` をスタブするか WebMock で `https://jpzip.nadai.dev/p/231.json` をスタブします。

```ruby
# test/system/address_form_test.rb
require "application_system_test_case"

class AddressFormTest < ApplicationSystemTestCase
  test "郵便番号の blur で住所が自動入力される" do
    visit new_user_path
    fill_in "郵便番号", with: "231-0017"
    find_field("郵便番号").native.send_keys(:tab) # blur を発火

    assert_field "都道府県", with: "神奈川県"
    assert_field "市区町村", with: "横浜市中区"
    assert_text "住所を取得しました"
  end
end
```

エンドポイント単体は controller test で確認します。

```ruby
# test/controllers/zipcodes_controller_test.rb
require "test_helper"

class ZipcodesControllerTest < ActionDispatch::IntegrationTest
  test "JSON で住所を返す" do
    get zipcode_path(code: "2310017"), as: :json
    assert_response :success
    body = JSON.parse(response.body)
    assert_equal "神奈川県", body["prefecture"]
    assert_equal "横浜市中区", body["city"]
  end

  test "見つからない郵便番号は 404" do
    get zipcode_path(code: "0000000"), as: :json
    assert_response :not_found
  end
end
```

L2 を入れた後は、同じ prefix を 2 回引いて 2 回目に CDN への HTTP が飛ばないこと(WebMock の `assert_requested` の回数)を確認すると、キャッシュが効いている保証になります。

## まとめ

Rails + Hotwire で郵便番号自動入力を組むなら、まず Turbo Frame と Stimulus + fetch のどちらに寄せるかを決めます。サーバーが正で段階的拡張を効かせたいなら Turbo Frame、クライアントで凝った UX を作りたいなら Stimulus + fetch です。

どちらのパターンでも、構文チェックはフォーム側、住所の自動入力は jpzip-ruby、最終検証はサーバー側、という責務分離は変わりません。Puma マルチワーカーでは L1 がプロセスローカルである点だけ忘れずに、`Jpzip::Cache` の L2 を差し込めば、CDN への重複フェッチを潰したうえで production に置けます。

関連:

- [jpzip の全体像](/blog/0001-cloudflare-pages-micro-saas/) — なぜ CDN 静的配信モデルなのか
- [120,677 件の配信設計](/blog/0002-cloudflare-pages-static-zipcode-delivery/) — 3 桁プレフィックスのバケット分割と L1 LRU の設計
- [React Hook Form + Zod + jpzip](/blog/0006-react-hook-form-zod/) — 同じ lookup パターンを React で組む場合
</content>
