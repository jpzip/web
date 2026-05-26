---
id: "0011"
title: "ken_all / jpostcode gem から jpzip-ruby へ移行する"
description: KEN_ALL.csv をローカル展開する Ruby gem(ken_all=DB へ import、jpostcode=git submodule 同梱)から、CDN フェッチの jpzip-ruby へ移す手順。フィールド対応表、月次更新運用の撤去、移行できない 1 点まで解説します。
publishedAt: 2026-05-25
author: nadai
tags: [Migration, Ruby, Rails, CDN]
ogEyebrow: 移行ガイド
status: published
faq:
  - q: ken_all / jpostcode から jpzip-ruby に移行するメリットは何ですか?
    a: 'KEN_ALL.csv をローカルに展開・同梱する必要がなくなる点が最大です。ken_all は CSV を DB テーブルに import し、jpostcode は git submodule でデータを gem に同梱します。どちらも月次更新のたびに再 import か `bundle update` + 再デプロイが要ります。jpzip-ruby は CDN 配信の JSON を引くため、データはデプロイ成果物から外れ、月次更新は再デプロイなしで自動追従します。加えてローマ字(`prefecture_roma` 等)・市区町村コード(`city_code`)・L1 LRU + 任意 L2 キャッシュが手に入ります。'
  - q: jpostal は Ruby の gem ですか?
    a: 'いいえ。jpostal(jquery.jpostal.js)はフロントエンドの jQuery プラグインで、Ruby gem ではありません。Rails では「jquery.jpostal.js でフロントの自動入力 + jp_prefecture で都道府県変換 + KEN_ALL.csv を DB に seed」という組み合わせが定番でした。Ruby 側で KEN_ALL.csv をローカル展開する代表的な gem は ken_all と jpostcode です。本記事はこの 2 つを対象にします。フロントの jquery.jpostal.js 自体からの移行は、データ取得経路が似ている Yubinbango からの移行記事が参考になります。'
  - q: jpostcode の事業所個別番号(113-8654 → 東京大学)は jpzip-ruby でも引けますか?
    a: 'いいえ。jpostcode は日本郵便の大口事業所個別番号(JIGYOSYO.CSV 由来)を持ち、`Jpostcode.find("113-8654")` で `office_name`(東京大学 本部事務組織)まで返します。一方 jpzip-ruby のデータは KEN_ALL.csv と KEN_ALL_ROME.csv から生成しており、事業所個別番号は含みません。`office_name` や `street` を使っている経路は移行で失われるため、別途切り分けが必要です。これは jpzip 側で改善予定のない設計上の差です。'
  - q: 移行すると DB テーブルや同梱データはどうなりますか?
    a: 'どちらも不要になります。ken_all から移る場合は `ken_all_postal_codes` テーブルと `rake ken_all:import` の運用を撤去できます(数十万行のレコードがリポジトリ/DB から消えます)。jpostcode から移る場合は `kufu/jpostcode-data` の git submodule と `bundle update jpostcode` の更新運用が不要になります。jpzip-ruby はコードだけをデプロイし、120,677 件のデータは `jpzip.nadai.dev` の CDN から引きます。'
  - q: ken_all で住所→郵便番号を LIKE 検索していた経路は jpzip-ruby で置き換えられますか?
    a: 'そのままでは置き換えられません。ken_all は DB テーブルなので `KenAll::PostalCode.where("address2 LIKE ?", "%横浜市%")` のような住所からの擬似逆引きが書けました。jpzip-ruby は郵便番号 → 住所のルックアップのみで、住所文字列から郵便番号を引く逆引き API はありません。`Jpzip.lookup_all`(約 37 MiB)で全件を取得して自前の逆引きインデックスを組むことは可能ですが、メモリと用途次第です。逆引きを使っている経路は移行対象から切り分けてください。'
  - q: 完全オフラインの環境でも jpzip-ruby は動きますか?
    a: '初回(cold)は CDN へのフェッチが必要です。ken_all(DB)や jpostcode(同梱データ)は実行時にネットワークを使わないため、完全エアギャップ環境ではそのまま動きます。jpzip-ruby は `preload("all")` で起動時に全件をメモリへ温め、`Jpzip::Cache` を継承した L2(ファイル/Redis 等)を差せば 2 回目以降はネットワークなしで引けますが、最初の温め時には CDN への到達が要ります。実行時に一切外へ出られない要件なら、この点を設計で吸収してください。'
howTo:
  name: ken_all / jpostcode gem から jpzip-ruby への移行手順
  description: KEN_ALL.csv をローカルに展開する Ruby gem(ken_all / jpostcode)を、CDN フェッチの jpzip-ruby に置き換える具体的なステップ。
  steps:
    - name: 既存の依存と利用箇所を確認する
      text: 'Gemfile の `ken_all` / `jpostcode` を確認し、`KenAll::PostalCode` と `Jpostcode.find` を grep して呼び出し箇所を洗い出す。jpostcode の `office_name` / `street`(事業所個別番号)や ken_all の `where(... LIKE ...)`(擬似逆引き)を使っている経路は、jpzip-ruby に無い機能なので別途切り分ける。'
    - name: jpzip-ruby をインストールする
      text: 'Gemfile に `gem "jpzip"` を足して `bundle install`。Ruby 3.2 以上が必要で、ランタイム依存は標準ライブラリ(net/http / json / monitor)だけ。activerecord や同梱データへの依存は増えない。'
    - name: ken_all(DB 展開型)からの移行
      text: '`KenAll::PostalCode.find_by(code:)` を `Jpzip.lookup(code)` に置き換える。`address1/2/3` を `prefecture` / `city` / `towns.first.town` に、`address_kana1/2/3` を `prefecture_kana` / `city_kana` / `towns.first.kana` に読み替える。置換後は `ken_all_postal_codes` テーブルと migration、`rake ken_all:import` を撤去できる。'
    - name: jpostcode(submodule 同梱型)からの移行
      text: '`Jpostcode.find(zip)` を `Jpzip.lookup(zip)` に置き換える。`prefecture` / `city` / `town` はほぼ同名で対応し、複数該当時は jpostcode の Array が jpzip の `towns` 配列に対応する。置換後は `kufu/jpostcode-data` の git submodule と `bundle update jpostcode` の運用が不要になる。'
    - name: データ更新運用を撤去する
      text: '`rake ken_all:import` の定期ジョブや `bundle update jpostcode` + 再デプロイの手順を消す。jpzip-ruby は月次のデータ更新を再デプロイなしで追従し、`Jpzip.meta` が version 変化を検知すると L1/L2 を自動でクリアする。'
    - name: 動作確認とサーバー側再検証
      text: '231-0017(神奈川県横浜市中区港町)で lookup を確認する。テストでは WebMock で `jpzip.nadai.dev` をスタブする。フォーム送信時は create アクションで `Jpzip.lookup` を呼び直し、送信値と CDN データの一致を再検証する。'
---

> KEN_ALL.csv をローカルに展開する Ruby gem(ken_all は DB へ import、jpostcode は git submodule で同梱)から、CDN 配信の jpzip-ruby へ移すための実務ガイドです。フォームのマークアップやコントローラの骨格は触らず、住所データの「持ち方」だけを「デプロイ成果物に焼き込む」方式から「CDN + ローカルキャッシュ」へ置き換えます。

## TL;DR

- **ken_all は KEN_ALL.csv を DB テーブルに import し、jpostcode は git submodule でデータを gem に同梱する**。どちらも住所データがデプロイ成果物の一部になり、月次更新のたびに再 import か `bundle update` + 再デプロイが要る
- **jpzip-ruby は CDN 配信の JSON を引くだけ**。データはデプロイ成果物から外れ、月次更新は再デプロイなしで自動追従する。引いた先は L1 LRU + 任意 L2 にキャッシュされ、2 回目以降は約 0.3 ms で返る
- **移行はルックアップ呼び出し 1 種類の置き換えで完了する**。ken_all の `address1/2/3`、jpostcode の `prefecture/city/town` を jpzip の `prefecture` / `city` / `towns.first.town` に読み替えるだけ
- 引き換えにローマ字(`prefecture_roma`)・市区町村コード(`city_code`)が手に入る。ken_all / jpostcode はどちらもローマ字を持たない
- 注意点が 2 つ。**jpostcode の事業所個別番号(`office_name`)は jpzip-ruby には無い**。そして **ken_all の DB を使った住所 → 郵便番号の擬似逆引きも置き換えられない**。この 2 経路は移行対象から切り分ける
- 補足: jpostal(jquery.jpostal.js)は Ruby gem ではなくフロントの jQuery プラグイン。Ruby 側で CSV を展開する gem は ken_all と jpostcode

## なぜ移行するか

ken_all と jpostcode は、どちらも日本郵便の [KEN_ALL.csv](https://www.post.japanpost.jp/zipcode/download.html) を元にした郵便番号 → 住所のデータを Ruby から引くための gem です。アプローチが対照的なので、まず整理します。

- [ken_all](https://github.com/kazuhisa/ken_all) は KEN_ALL.csv を **DB テーブルに import** する方式です。`rake ken_all:import` で日本郵便からデータを取得し、`ken_all_postal_codes` テーブルに数十万行を流し込みます。
- [jpostcode](https://github.com/kufu/jpostcode-rb) はデータを **git submodule(`kufu/jpostcode-data`)として gem に同梱** する方式です。`Jpostcode.find` はメモリ上のデータを引くので実行時にネットワークを使いません。

共通するのは「住所データがデプロイ成果物の中にある」点です。DB の数十万行か、gem に焼き込まれた submodule か、置き場所が違うだけで、どちらも更新のたびに人手の運用が発生します。

| 比較項目 | ken_all | jpostcode | jpzip-ruby |
|---|---|---|---|
| データの持ち方 | DB テーブル(CSV を import) | gem 内 git submodule(同梱データ) | CDN 配信 JSON(エッジキャッシュ) |
| セットアップ | migration + `rake ken_all:import` | `bundle install` のみ | `gem "jpzip"` のみ |
| 月次更新 | `rake ken_all:import` 再実行 | `bundle update jpostcode` + 再デプロイ | 自動追従(再デプロイ不要) |
| デプロイ成果物 | DB に数十万行 | gem に同梱データ(submodule) | コードのみ(データは CDN) |
| ローマ字 | なし | なし | あり(`prefecture_roma` 等) |
| 市区町村コード | なし(`address1/2/3` のみ) | なし(`prefecture_code` のみ) | あり(`city_code` / JIS X 0401) |
| 事業所個別番号 | なし(KEN_ALL のみ) | あり(`office_name` / `street`) | なし(KEN_ALL のみ) |
| 逆引き(住所→郵便番号) | 擬似的に可(DB の LIKE 検索) | なし | なし |
| 実行時ネットワーク | 不要(DB) | 不要(同梱データ) | cold 時のみ要(以後キャッシュ) |
| ランタイム依存 | activerecord(Rails 前提) | 同梱データ | 標準ライブラリのみ |
| メンテ状況 | 2023-01 で更新停止 | 活発(2026-05 時点) | 活発 |

jpzip-ruby が引く先は CDN(Cloudflare Pages のエッジ)上の静的 JSON です。データはデプロイ成果物から完全に外れ、日本郵便の月次更新には CDN 側のデータ差し替えだけで追従します。アプリ側は何もしません。詳しい配信設計は[120,677 件の配信設計](/blog/0002-cloudflare-pages-static-zipcode-delivery/)で扱っています。

メンテ状況にも触れておきます。ken_all は実用的な gem ですが、最終更新が 2023 年 1 月で止まっています。日本郵便のダウンロードページの構成は数年単位で変わるため、`rake ken_all:import` の自動ダウンロードが期待どおり動かず、`rake ken_all:import:file FILE=...` で手元の CSV を食わせる回避策に頼っているプロジェクトも見かけます。jpostcode は活発に更新されており、データ submodule も日付付きバージョン(例: `v1.0.0.20260507`)で配布されています。

### jpostal は Ruby gem ではない

混同しやすいので先に切り分けます。**jpostal(jquery.jpostal.js)はフロントエンドの jQuery プラグイン** であって、Ruby gem ではありません。Rails で「jpostal を使う」と言うとき、実際には次の組み合わせを指していることが多いです。

- フロント: `jquery.jpostal.js` が郵便番号入力に反応して住所欄を自動入力する
- バックエンド: 都道府県コード変換に `jp_prefecture`、住所データに KEN_ALL.csv を DB へ seed した自前テーブル、あるいは ken_all / jpostcode

このうち Ruby 側で KEN_ALL.csv をローカル展開しているのが ken_all と jpostcode です。本記事はこの 2 つを置き換え対象にします。フロントの jquery.jpostal.js 自体(データ取得経路がライブラリ任せのフロント自動入力)からの移行は、構造が近い [Yubinbango からの移行記事](/blog/0005-migrate-from-yubinbango-js/)が参考になります。

## 移行手順

### 1. 既存の依存と利用箇所を確認する

Gemfile と呼び出し箇所を洗い出します。

```bash
grep -nE 'gem ["'"'"']ken_all|gem ["'"'"']jpostcode' Gemfile
git grep -n 'KenAll::PostalCode'
git grep -n 'Jpostcode\.'
```

特に次の 2 つは jpzip-ruby に無い機能なので、見つかったら移行対象から切り分けます。

- jpostcode の `office_name` / `office_name_kana` / `street`(大口事業所個別番号)を読んでいる箇所
- ken_all で `KenAll::PostalCode.where("address2 LIKE ?", ...)` のように住所から郵便番号を引いている箇所(擬似逆引き)

### 2. jpzip-ruby をインストールする

```ruby
# Gemfile
gem "jpzip"
```

```sh
$ bundle install
```

jpzip-ruby は Ruby 3.2 以上(`Data.define` を使う)で動き、ランタイム依存は標準ライブラリ(`net/http` / `json` / `monitor`)だけです。ken_all のように activerecord を前提にしたり、jpostcode のように submodule を抱えたりはしません。

### 3. ken_all(DB 展開型)からの移行

ken_all は KEN_ALL.csv を `ken_all_postal_codes` テーブルへ import し、`KenAll::PostalCode` モデルで引きます。テーブルの列は `code`(郵便番号)と `address1/2/3`(都道府県・市区町村・町域)、`address_kana1/2/3`(各カナ)です。

フィールドの対応はこうなります。

| 用途 | ken_all(`KenAll::PostalCode`) | jpzip-ruby(`entry`) |
|---|---|---|
| 郵便番号 | `code` | (lookup の引数) |
| 都道府県 | `address1` | `prefecture` |
| 市区町村 | `address2` | `city` |
| 町域 | `address3` | `towns.first.town` |
| 都道府県カナ | `address_kana1` | `prefecture_kana` |
| 市区町村カナ | `address_kana2` | `city_kana` |
| 町域カナ | `address_kana3` | `towns.first.kana` |
| ローマ字 | なし | `prefecture_roma` / `city_roma` / `towns.first.roma` |
| 市区町村コード | なし | `city_code` |
| 複数該当 | 同じ `code` の複数行 | `towns` 配列 |

**Before**(ken_all で DB を引く):

```ruby
record = KenAll::PostalCode.find_by(code: "2310017")
return if record.nil?

prefecture = record.address1  # 神奈川県
city       = record.address2  # 横浜市中区
town       = record.address3  # 港町
```

**After**(jpzip-ruby の `lookup` に置き換え):

```ruby
require "jpzip"

entry = Jpzip.lookup("2310017") # 見つからなければ nil
return if entry.nil?

prefecture = entry.prefecture            # 神奈川県
city       = entry.city                  # 横浜市中区
town       = entry.towns.first&.town     # 港町
code       = entry.city_code             # 14104(ken_all には無い)
```

`Jpzip.lookup` は 7 桁でない入力に対してネットワークを叩かずに `nil` を返すので、`gsub(/\D/, "")` で整形してから渡せば不正値は安全に弾けます。置換が済んだら `ken_all_postal_codes` テーブルと migration、`rake ken_all:import` の定期実行を撤去できます。

### 4. jpostcode(submodule 同梱型)からの移行

jpostcode は `Jpostcode.find` でメモリ上の同梱データを引きます。フィールド名が jpzip と近いので、移行は読み替えが少なく済みます。

| 用途 | jpostcode(`address`) | jpzip-ruby(`entry`) |
|---|---|---|
| 都道府県 | `prefecture` | `prefecture` |
| 都道府県カナ | `prefecture_kana` | `prefecture_kana` |
| 都道府県コード | `prefecture_code` | `prefecture_code` |
| 市区町村 | `city` | `city` |
| 市区町村カナ | `city_kana` | `city_kana` |
| 町域 | `town` | `towns.first.town` |
| 町域カナ | `town_kana` | `towns.first.kana` |
| 郵便番号 | `zip_code` | (lookup の引数) |
| ローマ字 | なし | `prefecture_roma` / `city_roma` / `towns.first.roma` |
| 市区町村コード | なし | `city_code` |
| 複数該当 | `find` が Array を返す | `towns` 配列 |
| 事業所個別番号 | `office_name` / `street`(あり) | なし |

**Before**(jpostcode で同梱データを引く):

```ruby
address = Jpostcode.find("231-0017")
# 単一該当は 1 件、複数該当は Array で返る
address = address.first if address.is_a?(Array)

prefecture = address.prefecture  # 神奈川県
city       = address.city        # 横浜市中区
town       = address.town        # 港町
```

**After**(jpzip-ruby の `lookup` に置き換え):

```ruby
entry = Jpzip.lookup("2310017")
return if entry.nil?

prefecture = entry.prefecture          # 神奈川県
city       = entry.city                # 横浜市中区
town       = entry.towns.first&.town   # 港町
```

複数該当の扱いに注意します。jpostcode は該当が複数あるとき `find` 自体が Array を返しますが、jpzip-ruby は 1 件の `entry` の中に `towns` 配列を持ちます。jpostcode で `Array#each` していた箇所は、jpzip では `entry.towns.each` に読み替えます。

### 5. データ更新運用を撤去する

ここが移行の本丸です。両 gem の更新運用を消します。

- **ken_all**: `rake ken_all:import` を定期実行(cron / CI)していたなら、そのジョブを削除します。DB の数十万行も不要になります。
- **jpostcode**: `kufu/jpostcode-data` の git submodule と、月次の `bundle update jpostcode` + 再デプロイの手順を削除します。

jpzip-ruby は日本郵便の月次更新を CDN 側のデータ差し替えだけで追従するので、アプリ側の更新作業はゼロになります。データの version 管理も組み込まれています。

```ruby
# 起動時やヘルスチェックで meta を見ておくと、データ更新を検知して
# L1/L2 キャッシュを自動で捨てられる
meta = Jpzip.meta
Rails.logger.info("jpzip dataset version: #{meta.version}")
```

`Jpzip.meta` が `/meta.json` の `version` 変化を観測すると、L1(と設定済みなら L2)は自動でクリアされます。月次のデータロールオーバーを取りこぼさないために、`meta` を定期的に呼ぶのが推奨です。

### 6. 動作確認とサーバー側再検証

横浜市役所のある中区の **231-0017**(神奈川県横浜市中区港町)で確認します。実 CDN を叩かないよう、テストでは WebMock で `https://jpzip.nadai.dev/p/231.json` をスタブします。

```ruby
# test/models/zipcode_lookup_test.rb
require "test_helper"

class ZipcodeLookupTest < ActiveSupport::TestCase
  test "231-0017 を 神奈川県 / 横浜市中区 / 港町 に解決する" do
    entry = Jpzip.lookup("2310017") # 本番テストでは jpzip.nadai.dev をスタブ
    assert_equal "神奈川県", entry.prefecture
    assert_equal "横浜市中区", entry.city
    assert_equal "港町", entry.towns.first.town
  end
end
```

フォームから住所を受け取るなら、送信値をそのまま信用しないでください。クライアントで自動入力された住所はユーザーが手で書き換えられるので、create アクションで `Jpzip.lookup` を呼び直して一致を確認します。この責務分離は[Rails + Hotwire の記事](/blog/0007-rails-hotwire-form/)と同じです。

```ruby
def create
  zip   = user_params[:zipcode].to_s.gsub(/\D/, "")
  entry = Jpzip.lookup(zip)

  if entry.nil? || entry.prefecture != user_params[:prefecture] || entry.city != user_params[:city]
    return render :new, status: :unprocessable_entity, alert: "郵便番号と住所が一致しません"
  end

  @user = User.new(user_params)
  @user.save ? redirect_to(@user) : render(:new, status: :unprocessable_entity)
end
```

## ハマりやすい所

- **jpostcode の事業所個別番号は移行で失われる**: jpostcode は大口事業所個別番号(JIGYOSYO.CSV 由来)を持ち、`Jpostcode.find("113-8654")` で `office_name`(東京大学 本部事務組織)まで返します。jpzip-ruby のデータは KEN_ALL ベースで事業所個別番号を含まないため、この経路は移行できません。`office_name` を使っている箇所は jpostcode を残すか別データで補う判断が要ります
- **ken_all の擬似逆引きは置き換えられない**: ken_all は DB テーブルなので `where("address2 LIKE ?", "%横浜市%")` で住所から郵便番号を引けました。jpzip-ruby は郵便番号 → 住所のルックアップのみで逆引き API を持ちません。`Jpzip.lookup_all`(約 37 MiB)で全件を取得して自前インデックスを組むか、別手段を検討します
- **複数該当の粒度が違う**: jpostcode は複数該当を `find` の戻り値(Array)で表しますが、jpzip は 1 件の `entry` 内の `towns` 配列で表します。単一該当は等価ですが、ループの対象が変わります
- **cold fetch のレイテンシ**: ken_all(DB)/ jpostcode(同梱)は実行時ネットワーク不要でしたが、jpzip-ruby は初回だけ CDN にフェッチします。本番では `preload` や L2 キャッシュで温めると差が消えます。完全エアギャップ環境では cold 到達ができないので、設計で吸収します
- **L1 はプロセスローカル**: jpzip-ruby の L1 LRU は 3 桁プレフィックス単位(948 バケット)で、Puma の各ワーカーに別々に乗ります。重複フェッチが気になる規模なら `Jpzip::Cache` を継承した L2(Rails.cache / Redis)を `Jpzip.configure` で差します(詳細は [Rails + Hotwire の記事](/blog/0007-rails-hotwire-form/))

## 計測した結果 / 移行で減るもの

レイテンシよりも、運用とデプロイ成果物から減るものの方が効きます。

| 指標 | ken_all(DB) | jpostcode(同梱) | jpzip-ruby(CDN) |
|---|---|---|---|
| 初回 lookup(cold) | 約 0.5 ms(DB クエリ) | 約 0.1 ms(メモリ) | 約 70 ms(CDN フェッチ) |
| 2 回目以降(同プレフィックス) | 約 0.5 ms | 約 0.1 ms | 約 0.3 ms(L1 LRU ヒット) |
| デプロイ成果物のデータ | DB に数十万行 | gem 同梱(submodule) | 0(CDN 配信) |
| 月次更新の手作業 | `rake import` 再実行 | `bundle update` + 再デプロイ | なし(自動追従) |
| ローマ字 / 市区町村コード | なし | なし | あり |
| 追加のランタイム依存 | activerecord | 同梱データ | なし(stdlib のみ) |

cold の絶対値だけ見ると DB / メモリの方が速いですが、これは `preload` か L2 を入れれば消える差です。本番で効くのは「住所データをデプロイ成果物から外せる」点で、リポジトリの数十万行や submodule、月次の手作業がまとめて消えます。

## まとめ

ken_all と jpostcode は、KEN_ALL.csv を DB か gem 同梱という形でローカルに展開する gem です。どちらも実行時ネットワーク不要という利点と引き換えに、住所データがデプロイ成果物の一部になり、月次更新のたびに人手の運用が発生します。

jpzip-ruby への移行は、ルックアップ呼び出し 1 種類の置き換えで完了します。ken_all の `address1/2/3`、jpostcode の `prefecture/city/town` を jpzip の `prefecture` / `city` / `towns.first.town` に読み替え、データ更新の運用を消すだけです。引き換えにローマ字・市区町村コードが付き、月次更新は自動追従に変わります。事業所個別番号と擬似逆引きの 2 経路だけは移行できないので、そこは正直に切り分けてください。

関連:

- [jpzip の全体像](/blog/0001-cloudflare-pages-micro-saas/) — なぜ CDN 静的配信モデルなのか
- [120,677 件の配信設計](/blog/0002-cloudflare-pages-static-zipcode-delivery/) — 3 桁プレフィックスのバケット分割と月次更新の仕組み
- [Rails + Hotwire + jpzip-ruby で住所自動入力](/blog/0007-rails-hotwire-form/) — 移行後のフォーム実装と L2 キャッシュの差し方
- [Yubinbango から jpzip-js へ移行する](/blog/0005-migrate-from-yubinbango-js/) — フロントの jQuery 自動入力(jpostal.js 系)からの移行
</content>
