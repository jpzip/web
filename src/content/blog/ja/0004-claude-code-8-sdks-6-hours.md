---
id: "0004"
title: Claude Code 1 人開発で 6 時間で 8 言語 SDK を実装した話
description: jpzip の TypeScript / Go / Python / Rust / Ruby / Dart / PHP / Swift SDK を Claude Code と 6 時間で実装した話。プロトコル先行設計、翻訳タスクとしての多言語移植、言語固有の落とし穴。
lang: ja
publishedAt: 2026-05-17
author: nadai
tags: [Claude Code, AI, SDK, 多言語, OSS]
series:
  name: jpzip
  part: 4
status: published
---

> シリーズ最終回。[jpzip](https://jpzip.nadai.dev/) の SDK 8 言語版（TypeScript / Go / Python / Rust / Ruby / Dart / PHP / Swift）を、Claude Code を相棒に 6 時間で書いた話です。先に[1 本目](https://jpzip.nadai.dev/blog/cloudflare-pages-micro-saas/)・[2 本目](https://jpzip.nadai.dev/blog/cloudflare-pages-static-zipcode-delivery/)・[3 本目](https://jpzip.nadai.dev/blog/mcp-server-japanese-postcode/)を読むとこの記事の数字が腑に落ちます。

## TL;DR

- AI 駆動開発（Claude Code）で、**8 言語の SDK を 6 時間で実装**しました
- 公開先: npm / Go / PyPI / crates.io / RubyGems / pub.dev / Packagist / Swift Package Index
- すべての SDK が **同じ API シグネチャ・同じキャッシュ設計・同じリトライ設計**を持つ
- 鍵は **「先にプロトコルを文章で固める」**こと。実装は AI に任せられる粒度まで落とす
- 言語固有の落とし穴は確実にあるので、**「言語ごとの慣習に翻訳してもらう」プロンプトに切り替える**

## 「8 言語 6 時間」の正体

最初に正直に書いておきます。「6 時間で 8 言語の SDK を書いた」という言い方は、**SDK 実装そのものに費やした正味の時間**を指しています。8 言語の SDK を作る前に、こうした準備が積み上がっていました:

- データセット（120,677 件の JSON）が CDN に公開済み（[第 2 回参照](https://jpzip.nadai.dev/blog/cloudflare-pages-static-zipcode-delivery/)）
- プロトコル仕様 `spec/v1/protocol.md` が JSON Schema 込みで固定済み
- TypeScript SDK の参照実装が 1 本完成済み

つまり「**仕様と参照実装と CDN が揃った状態から、残り 7 言語を一気に展開した**」のが 6 時間です。これは AI 駆動開発でできた、というより、**AI 駆動開発のためにできる前提を全部揃えてから始めた**結果です。

## 全体の流れ

ざっくりこういう順番でした。

1. **プロトコルを文書で固める**（数時間）
2. **TS SDK を 1 つだけきっちり書く**（数時間）
3. **TS SDK を参照実装として、残り 7 言語に展開**（6 時間 ← ここの話）

3 つ目のフェーズは、ほぼ「Claude Code に翻訳してもらう」作業でした。

## 仕様の固め方

8 言語の SDK が同じ挙動になる条件は、結局「**全員が同じ仕様を読んでいる**」ことです。これを文書として完成させる:

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
        └── protocol.md           # プロトコル本文
```

`protocol.md` には:

- エンドポイント一覧と各レスポンス例
- JSON Schema（型は機械可読、説明は人間可読）
- CORS / Cache-Control の規約
- バージョニング規約（マイナーは後方互換）

…が書いてあります。これを **Claude に読ませてから「Go で実装して」と頼める** ところまで持っていくのが目標でした。

## 各 SDK に共通させた API

`lookup` / `lookupGroup` / `lookupAll` / `preload` / `getMeta` の 5 関数だけ。これを言語の慣習で命名し直しました。

| 言語 | パッケージ | 単発検索 |
|---|---|---|
| TypeScript | `@jpzip/jpzip` | `await lookup("2310017")` |
| Go | `github.com/jpzip/go` | `jpzip.Lookup(ctx, "2310017")` |
| Python | `jpzip` | `lookup("2310017")` / `await client.lookup(...)` |
| Rust | `jpzip` | `jpzip::lookup("2310017").await?` |
| Ruby | `jpzip` | `Jpzip.lookup("2310017")` |
| Dart | `jpzip` | `await lookup("2310017")` |
| PHP | `jpzip/jpzip` | `lookup("2310017")` |
| Swift | `Jpzip` | `try await lookup("2310017")` |

「動詞 + 名詞」の構造を変えない、**戻り値の null 表現を言語固有のものに合わせる**（`null` / `nil` / `Option` / `?ZipcodeEntry`）、これだけは厳守してもらいました。

## 共通の挙動

API シグネチャだけでなく、内部挙動も全 SDK 共通です:

- **HTTP リトライ**: 5xx / ネットワークエラーで 3 回まで指数バックオフ
- **L1 キャッシュ**: メモリ上の LRU（プレフィックスファイル単位 + エントリ単位）
- **L2 キャッシュ**: 任意の永続キャッシュ（インタフェースを切ってあるので、ファイル / Redis / SQLite 何でも差し込める）
- **L3 キャッシュ**: HTTP の `Cache-Control` を尊重（Pages 側で 24h TTL）
- **lookupAll**: `/g/0..9.json` を並列 fetch して in-memory dict にマージ

L2 キャッシュは「interface を切る」だけで、デフォルト実装は提供していません。各言語で実装は数十行。

## 6 時間の中身

実際に 7 言語を実装した 6 時間で、Claude Code への指示は **「翻訳タスク」として組み立てる**のが効きました。

### プロンプトの基本形

```
ここに TypeScript の参照実装がある。
これを Ruby の慣習に従って書き直してほしい。

絶対に守ること:
- 公開 API は { Jpzip.lookup, Jpzip.lookup_group, ... } の名前
- 戻り値は frozen Data オブジェクト（Ruby 3.2+ の Data.define）
- HTTP は net/http のみ（外部 gem 禁止）
- リトライは 3 回・指数バックオフ
- L2 キャッシュは Module で interface を切ってあり、デフォルト実装は無し

避けること:
- Active Support 系の拡張
- スレッドセーフでない実装（Monitor を使うこと）
- メソッド名のキャメルケース化
```

「TypeScript の API を **そのまま移植**」だと変なコードが上がってきます。逆に「Ruby の慣習に従って **翻訳**」と頼むと、L1 LRU が `Hash` ベースに置き換わったり、retry が `rescue retry` の構造になったり、**ちゃんと言語のスタイルになる**。

### 「動かしてから直す」を 1 言語ずつ

各言語で:

1. テストスイートを TS から翻訳してもらう（fixture と期待値は同じ）
2. 実装を翻訳してもらう
3. テスト実行
4. 落ちた箇所を Claude に投げて直してもらう

これを 8 言語ぶんやりました。実装より **「言語固有の落とし穴を Claude に教える」プロンプト** に時間を使った印象です。

### 出てきた言語別の癖

実装中に「ああ、この言語こうなんだ」と気づいた点をいくつか:

- **Rust**: `openssl-sys` を避けて `rustls` を強制した（C toolchain なしで build できる方が SDK は嬉しい）
- **Python**: 同じ実装を sync (`httpx.Client`) と async (`httpx.AsyncClient`) で書き分けるのではなく、**インタフェースを共有させて 2 つのバックエンドが差し込まれる**形に整理
- **Ruby**: スレッドセーフ性を `Monitor` で素直に書く（`Mutex` より文脈に合う）
- **Dart**: Flutter / CLI / Server / Flutter Web の 4 ターゲットで同じコードが動くように、`dart:io` ではなく `package:http` 経由のみ
- **PHP**: 8.2+ の `readonly class` で値オブジェクトを表現、HTTP は Guzzle 7
- **Swift**: `async/await` を素直に使う（コールバック地獄を避ける）

これらは AI に「Rust だけど C toolchain なしで作って」「Dart は Flutter Web でも動かないとダメ」と **制約を 1 行ずつ追加**していくと、AI が勝手にこういう設計に落としてくれます。

## どこが効いて、どこが効かなかったか

### 効いたこと

- **プロトコル先行**: 全 SDK の挙動を文章で先に決めた。これが Claude に渡せる「正解の定義」になった
- **参照実装**: TS SDK が動いている状態から始めた。Claude が「この挙動と同じにして」と参照できる
- **テスト先行翻訳**: テストを最初に翻訳すると、実装の正解判定が自動化される
- **言語の慣習をプロンプトで指定**: 「Pythonic に」「Idiomatic Go で」と書くだけで品質が変わる
- **CI を GitHub Actions で揃える**: 8 言語ぶんの publish ワークフローを Claude にコピペで作らせた

### 効かなかったこと

- **「全部一気にやって」と頼む**: コンテキストが膨らみすぎてミスが増える。**1 言語ずつ完結させる**ほうが結局速い
- **テストなしで実装だけ翻訳**: そこそこ動くけど微妙な挙動差が残る。テスト翻訳とセットで頼むべき
- **エラーメッセージを言語横断で揃えようとする**: 言語固有の例外哲学があるので無理に統一しない方がよかった

## 「8 言語 SDK」は誰のためのものか

「そんなに使われる言語あるの？」と聞かれそうですが、これは **「Claude が 8 言語のうちどれを選んでも使える」** ことに本当の意味があると思っています。

普段 Go を書いている開発者の Rust プロトタイプで、`@jpzip/jpzip` ではなく `jpzip` クレートが使える。これは「言語選択の自由」を保つうえで地味に効きます。実際、SDK 公開後にいただいた反応は「**ちょうど書いてる言語にあって助かった**」が多かったです。

## AI 駆動開発の何が変わるのか

8 言語 SDK プロジェクトを通じて変わった肌感覚:

1. **「実装するモノ」と「生成するモノ」の境界線が動いた**
   - プロトコルを文章にすれば、SDK は「書く対象」から「生成する対象」になる
2. **設計の比重が前倒しになる**
   - 仕様 / 参照実装 / テストを先に作る時間が増える代わりに、実装ループが短くなる
3. **「言語の壁」が薄くなる**
   - 「自分が書いたことのない言語の SDK」を、その言語の慣習に従って出せる
4. **品質の天井は AI ではなく、プロトコルの完成度で決まる**
   - 仕様がブレていれば 8 言語ぶんブレる。仕様が綺麗なら 8 言語ぶん綺麗に出る

## このシリーズで書いた 4 本

1. [Cloudflare Pages 無料枠だけで micro-SaaS データセットを作った話](https://jpzip.nadai.dev/blog/cloudflare-pages-micro-saas/)
2. [KEN_ALL.csv を Cloudflare Pages から 120,677 件配信する設計](https://jpzip.nadai.dev/blog/cloudflare-pages-static-zipcode-delivery/)
3. [MCP サーバーを書いて Claude が郵便番号を扱えるようにした](https://jpzip.nadai.dev/blog/mcp-server-japanese-postcode/)
4. **本記事**: Claude Code 1 人開発で 6 時間で 8 言語 SDK を実装した話

このシリーズを通して見えたのは、「**個人開発の射程は、AI と組むことで一段広がっている**」ということでした。データ層・プロトコル層・クライアント層の分離設計があると、AI 駆動開発と相性がいい。逆にいえば、AI 駆動開発を前提に置くと、設計の優先順位も少し変わります。

## 使ってみてください

| 言語 | インストール |
|---|---|
| TypeScript | `npm i @jpzip/jpzip` |
| Go | `go get github.com/jpzip/go` |
| Python | `pip install jpzip` |
| Rust | `cargo add jpzip` |
| Ruby | `gem install jpzip` |
| Dart | `dart pub add jpzip` |
| PHP | `composer require jpzip/jpzip` |
| Swift | Swift Package Manager で `Jpzip` を追加 |

GitHub: <https://github.com/jpzip>
サイト: <https://jpzip.nadai.dev/>

普段使っている言語があれば、3 行で動きます。AI 駆動でこういう「複数言語にまたがる小さなライブラリ群」を作るのは、想像以上に楽しい体験でした。
