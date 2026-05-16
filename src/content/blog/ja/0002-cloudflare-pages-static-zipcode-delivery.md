---
id: "0002"
title: KEN_ALL.csv を Cloudflare Pages から 120,677 件配信する設計
description: 日本郵便 KEN_ALL.csv を Cloudflare Pages 上の静的 JSON ファイル群として配信する設計の話。ファイル分割戦略、ETL、Worker/R2/KV を使わない理由まで。
lang: ja
publishedAt: 2026-05-17
author: nadai
tags: [Cloudflare, CDN, ETL, Go]
series:
  name: jpzip
  part: 2
status: published
---

> 個人プロジェクト [jpzip](https://jpzip.nadai.dev/) のデータ配信側の話です。シリーズ 2 本目。1 本目は [Cloudflare Pages の無料枠だけで micro-SaaS データセットを作った話](https://jpzip.nadai.dev/blog/cloudflare-pages-micro-saas/) をどうぞ。

- 配信元: <https://jpzip.nadai.dev>
- ETL リポジトリ: <https://github.com/jpzip/data>
- プロトコル仕様: <https://github.com/jpzip/spec>

## TL;DR

- 日本郵便の **KEN_ALL.csv（120,677 件）** を、API ではなく **CDN 上の静的 JSON ファイル群**として配信
- ファイル数を **約 1,010 個に固定**し、Cloudflare Pages の制約に収める
- **`/all.json` は意図的に廃止**（25 MiB 単一ファイル上限を超えるため）
- **1 桁プレフィックス × 10 ファイル + 3 桁プレフィックス × 約 1,000 ファイル**で「全件 preload」と「ピンポイント lookup」両方をカバー
- ETL は Go + GitHub Actions、**毎月 1 日と 15 日に自動更新**
- Worker / R2 / KV を一切使わない → 課金軸そのものを消す

## 設計の出発点

API として運用したくなかったので、こう決めました。

> 「公開する成果物は **静的 JSON ファイル群** に限る」

API サーバを建てない以上、検索ロジックはクライアント側に分散させます。そうなると最初の問い:

> **どう分割すれば、ファイル数も帯域もクライアントの計算量も丁度よくなるか？**

これが KEN_ALL 配信設計の中心命題でした。

## Cloudflare Pages の制約を読む

最初に Pages の制限を整理しました。

| 制約 | 値 | 影響 |
|---|---|---|
| 単一ファイルサイズ | **25 MiB** | 「全件 1 ファイル」案は不可能 |
| 1 デプロイあたりのファイル数 | **20,000** | 数千ファイル分割でも余裕 |
| ストレージ容量 | 実質無制限 | 気にしなくてよい |
| 帯域 | 無制限 | 気にしなくてよい |
| デプロイ回数 | 500 回/月 | 月 1-2 デプロイなので問題なし |

ここでまず最初の設計決定が出ます。

### 決定 1: `/all.json` は作らない

最初は「全件入り `/all.json` を出して、ピンポイント検索用に小分けファイルも出す」という二段構えを考えていました。

ところが、120,677 件分の正規化済み JSON は **gzip 前で 25 MiB 超**になりました。Pages の単一ファイル上限を踏みます。

選択肢は二つ:

1. R2 に置く → **課金軸が増える**（DoW のリスク）
2. 全件ファイルをやめる → SDK 側で分割ファイルを並列 fetch して再構成

迷わず 2 を選びました。SDK の `preload({ scope: "all" })` は内部で **`/g/0.json` ～ `/g/9.json` を並列で取る**実装にして、外から見れば「1 関数呼ぶだけで全件キャッシュ」を保ちました。

> ファイルが大きすぎたら、R2 を足すのではなく **API を変えて分割を吸収する**。これが「課金軸を増やさない設計」の根っこです。

## ファイル分割戦略

最終的にこういうレイアウトに落ち着きました。

| パス | 内容 | サイズ目安 | ファイル数 |
|---|---|---|---|
| `/meta.json` | バージョン・件数・都道府県別件数 | < 1 KB | 1 |
| `/g/{0..9}.json` | 1 桁プレフィックスで分割した辞書 | ~1 MB（gzip 後 200–300 KB） | 10 |
| `/p/{000..999}.json` | 3 桁プレフィックスで分割した辞書 | ~10 KB（gzip 後 ~3 KB） | 約 1,000 |

合計 **約 1,010 ファイル**（Pages の 20,000 上限の 5%）。

### 1 桁分割（`/g/`）の使いどころ

「**オフライン対応したいとき**」用です。10 ファイル並列 fetch で全件取れるサイズ感に揃えてあります。CI / 電車内 Web アプリ / インストーラなど、ネットワークなしで動かしたい場面で `preload({ scope: 'all' })` を呼ぶと、SDK が裏でこの 10 個を取りに行きます。

### 3 桁分割（`/p/`）の使いどころ

「**ピンポイント検索したいとき**」用です。`lookup("2310017")` を呼ぶと、SDK は zipcode の頭 3 桁から `/p/231.json` を 1 ファイルだけ取りに行きます。1 リクエスト・~3 KB・常に Edge キャッシュヒット。日常的なユースケースはこちら。

実在する 3 桁 prefix のみ生成しているので、`/p/000.json` のような実在しないファイルは出しません（404 が「該当なし」のシグナル）。

### なぜ 1 桁と 3 桁の二本立てなのか

「2 桁単位（`/00..99`）にすればよかったのでは？」と聞かれそうなので説明します。

- 1 桁: **全件 preload 用**。10 ファイルなら HTTP/2 多重化で実用的に並列 fetch できる
- 3 桁: **ピンポイント lookup 用**。1 ファイルが 10 KB 程度なので、1 件引くために取るデータ量が最小化される
- 2 桁: どっちつかず。preload には粒度が中途半端、lookup には大きすぎる

結果として、SDK 側に「2 桁プレフィックス」を扱うパターンも残しています（`/p/{prefix1}{prefix2}*.json` を 10 並列 fetch する）が、Edge オリジンに置く実ファイルは 1 桁と 3 桁の二段だけです。

## ETL: KEN_ALL.csv から JSON への一方通行

データ生成は Go で書いて、GitHub Actions のみで動かしています。ローカル実行サポートは意図的にやめました（再現性は fixture テストで担保）。

```
[GitHub Actions cron: 月 1 日 & 15 日 03:00 JST]
       ↓
日本郵便から ZIP を取得
  - KEN_ALL.zip（Shift-JIS, 漢字 + カナ）
  - KEN_ALL_ROME.zip（ローマ字）
       ↓ source.Fetch()
       ↓ ZIP 解凍 → CSV
parse.KenAll(reader) → []KenAllRecord
parse.Rome(reader)   → []RomeRecord
       ↓
merge.Merge() → []MergedRecord（zipcode で結合）
       ↓
normalize.Entry() → ZipcodeEntry
  - 複数行レコード結合（括弧書きが次行継続）
  - 括弧書きの note 抽出
  - 京都通り名統合
  - カナ全角化、ローマ字頭文字大文字化
       ↓
output.Write() → dist/{g,p,meta}.json
       ↓
validate.PreDeploy() → 前回比 ±N% チェック
       ↓ pass
wrangler pages deploy dist --project-name=jpzip
       ↓ fail
GitHub Issue を自動作成
```

cron は `0 18 1,15 * *`（UTC 18:00 = JST 03:00、毎月 1 日と 15 日）。**月 2 回叩く**のは、たまに日本郵便の更新タイミングがずれるからです。

### 出力コードの心臓部

実際の `output.Write()` はこんな感じです。素朴で良い:

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

ファイルにソート済みで書き出しているのは、**差分が小さくなる**ようにするためです。Pages 側がうまく扱ってくれて、デプロイが速くなります。

### 未知パターンを検出して fail する

KEN_ALL は時々、注釈付きの新しい町域表記が現れます。たとえば括弧書きの継続行、ローマ字の表記揺れなど。

ここで「とりあえず黙って通す」を選ぶと、データが静かに壊れて気づかなくなります。なので逆の振る舞いを選びました。

```go
var ErrUnknownPattern = errors.New("unknown town pattern")

func Town(raw string) (TownResult, error) {
    switch raw {
    case "以下に掲載がない場合":
        return TownResult{Town: "", Note: raw}, nil
    // ... 既知パターン
    }
    if hasParens(raw) { return parseParens(raw) }
    if isSafeTownName(raw) { ... }

    return TownResult{}, ErrUnknownPattern
}
```

未知パターンを踏んだ瞬間 ETL は失敗し、GitHub Actions の `if: failure()` ステップが自動で Issue を作ります。**月 1 回のジョブだから、失敗を未来の自分にちゃんと伝える**運用にしました。

### デプロイ前バリデーション

新しいビルドが既存のデータに対して大きくずれていたら、デプロイをブロックします。閾値はこの 3 つ:

- **全件: ±5%**
- **3 桁 prefix の数: ±5%**
- **都道府県別件数: ±10%**

`validate.PreDeploy()` は `https://jpzip.nadai.dev/meta.json` から「現在公開中のメタ」を取得し、新ビルドの `meta.json` と比較します。万一 KEN_ALL の取得 URL が変わって空ファイルが落ちてきても、デプロイには至りません。

### HTTP ヘッダは `_headers` で

Cloudflare Pages の `_headers` ファイルで以下を指定しています。

```
/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=86400
```

CORS は全開放（SDK だけでなくブラウザ直アクセスも想定）、`Cache-Control` は 24 時間 TTL。`/p/*.json` は内容が 1 ヶ月変わらないので、Edge にがっちりキャッシュされます。

## 「Worker なし / R2 なし / KV なし」の意味

この設計でいちばん大事なのは、**消した要素**です。

| 要素 | 採用？ | 理由 |
|---|---|---|
| Cloudflare Pages | ✅ | 静的ホスティング無料・帯域無料 |
| Cloudflare CDN | ✅ | 自動・無料 |
| **Cloudflare Worker** | ❌ | 100k req/day 無料上限 → 構造的な課金リスク |
| **Cloudflare R2** | ❌ | egress 制約 → DoW（Denial of Wallet）攻撃の対象になる |
| **Cloudflare KV** | ❌ | 読み取り課金 → トラフィック増で月額が上がる |
| **Transform Rules** | ❌ | 動的 URL 書き換えは不要 |

たとえアクセスが何億あっても、**料金が発生する仕組みが構造的に存在しない**形に持ち込みました。これは「個人で永続的に動かす」という目的に対する設計の最適解だと思っています。

## DoW（Denial of Wallet）に対する強さ

R2 を使う案だと、「悪意のあるユーザーに egress を消費されて課金額が爆発する」という攻撃ベクトル（DoW）が成り立ちます。本案ではこれが**構造的に成立しません**:

- 公開ファイルは約 1,010 個・合計 ~10 MB に固定
- Cloudflare Pages の帯域は無制限・無料
- アクセス数が増えるほど Edge キャッシュヒット率が上がる → オリジン側の負荷は下がる

「個人プロジェクトを Twitter / X で晒して、悪意ある誰かに焼かれる」というシナリオに対して、**そもそも焼ける材料がない**設計になっています。

## 振り返り

設計の核は「データ層 / プロトコル層 / クライアント層の分離」と「課金軸を 1 本ずつ消す」の 2 点でした。

- データ層: GitHub Actions + Go + 静的 JSON
- プロトコル層: 文書化された `spec/v1/protocol.md`（JSON Schema 付き）
- クライアント層: 8 言語の薄い SDK

プロトコル層を文章で固めたことが、次の記事につながります。

## このシリーズで書く 4 本

1. [Cloudflare Pages の無料枠だけで micro-SaaS データセットを作った話](https://jpzip.nadai.dev/blog/cloudflare-pages-micro-saas/) （シリーズ全体のハブ）
2. **本記事**: KEN_ALL.csv を Cloudflare Pages から 120,677 件配信する設計
3. [MCP サーバーを書いて Claude が郵便番号を扱えるようにした](https://jpzip.nadai.dev/blog/mcp-server-japanese-postcode/)
4. [Claude Code 1 人開発で 6 時間で 8 言語 SDK を実装した話](https://jpzip.nadai.dev/blog/claude-code-8-sdks-6-hours/)

## 使ってみてください

- サービス: <https://jpzip.nadai.dev/>
- GitHub: <https://github.com/jpzip>
- ETL: <https://github.com/jpzip/data>
- プロトコル仕様: <https://github.com/jpzip/spec>

データ生成側の Go コードは全部 OSS にしてあります。同じ手で他のオープンデータを Cloudflare Pages に載せたい人の参考になれば。
