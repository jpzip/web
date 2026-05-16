---
id: "0001"
title: Cloudflare Pages の無料枠だけで郵便番号データセット配信サービスを作った話
description: jpzip という個人プロジェクトの全体像と、なぜそれが「課金軸ゼロ」で成立しているのかを書きます。Cloudflare Pages の無料枠だけで 120,677 件の郵便番号データを配信する設計。
lang: ja
publishedAt: 2026-05-17
author: nadai
tags: [Cloudflare, OSS, 個人開発, micro-SaaS]
series:
  name: jpzip
  part: 1
status: published
faq:
  - q: jpzip は何ですか？
    a: '日本郵便 KEN_ALL.csv / KEN_ALL_ROME を正規化して `https://jpzip.nadai.dev` から静的 JSON で配信する、登録不要・無料・無制限の郵便番号データセットです。SDK は 8 言語以上を提供しています。'
  - q: 商用利用やアトリビューションは必要ですか？
    a: '仕様書・SDK・ETL は MIT、配信データは Public Domain 相当。商用利用・再配布・改変いずれも自由で、アトリビューションは不要 (歓迎) です。'
  - q: 日本郵便の公式 API ではダメなのですか？
    a: 'ダメではありません。ただ公式 API は申請・利用制限などがあり個人開発や OSS から使いにくい場面があるため、その補完選択肢として位置づけています。'
  - q: 月額費用や課金はかかりますか？
    a: '提供側 (作者) の運用コストも、利用側のコストもゼロです。Cloudflare Pages 無料枠だけで運用しています。'
---

> jpzip という個人プロジェクトの全体像と、なぜそれが「課金軸ゼロ」で成立しているのかを書きます。

- サービス: <https://jpzip.nadai.dev/>
- GitHub org: <https://github.com/jpzip>
- ライセンス: コード MIT / データ Public Domain 相当
- 価格: **無料（累計コスト 0 円）**

## TL;DR

- **jpzip** は、日本の郵便番号 **120,677 件** を **Cloudflare Pages の無料枠だけで配信する個人プロジェクト**です
- API サーバではなく「**CDN 上に置かれた静的 JSON ファイル群**」として設計しています
- 公開 SDK は 8 言語: **TypeScript / Go / Python / Rust / Ruby / Dart / PHP / Swift**
- 登録不要・認証不要・MIT・オフライン対応（全件 preload 可）
- インフラ費は **累計 0 円**、月次更新は **GitHub Actions** で完結
- このシリーズでは、設計の経緯と実装の中身を 4 本に分けて書きます。本記事はその **1 本目（ハブ）** です

## なぜ作ったか

個人開発で日本の郵便番号データを扱うとき、いつも選択肢にモヤモヤしていました。

| サービス | 個人開発で使えるか | 何が困るか |
|---|---|---|
| 日本郵便公式 API | △ | ゆうID + Biz アカウント必須（法人/個人事業主のみ） |
| PostcodeJP API | △ | 有料、商用前提 |
| zipcloud | ○ | 「善意の API」依存、SLA なし、いつ止まってもおかしくない |
| 自前で KEN_ALL.csv | ○ | 配布・更新・正規化を自分で運用する必要あり |

> 「公式 API を使えない / 使いたくない個人開発者のための、登録不要・オフライン対応の郵便番号データセットがほしい」

これが出発点でした。

ただし、API として運用すると「リクエスト課金」「DB ホスティング」「障害対応」が一生ついて回ります。個人プロジェクトに **持続可能なゼロ円運用** を持ち込むには、API ではなく **データセット**として配布するのが筋がいいと判断しました。

## アーキテクチャ全体像

```
Client App
  ↓
jpzip SDK（8 言語、全部同じ API）
  ↓ HTTPS GET
jpzip.nadai.dev（Cloudflare Pages + Custom Domain）
  ↓
[Cloudflare CDN cache]
  ↓
静的 JSON ファイル群（約 1,010 ファイル）
  ↑
[GitHub Actions / 月 1 回]
  KEN_ALL.csv → 正規化 → JSON 出力 → wrangler pages deploy
```

JSON ファイルは以下のレイアウトで配置しています:

| パス | 内容 | サイズ目安 | ファイル数 |
|---|---|---|---|
| `/meta.json` | バージョン情報 | < 1 KB | 1 |
| `/g/{1桁}.json` | 1 桁プレフィックスで分割した辞書 | ~1 MB（gzip 後 200-300 KB） | 10 |
| `/p/{3桁}.json` | 3 桁プレフィックスで分割した辞書 | ~10 KB（gzip 後 ~3 KB） | 約 1,000 |

3 桁単位のファイルはピンポイント検索用、1 桁単位のファイルは全件 preload 用、と役割を分けています。

ポイントは、**Cloudflare Worker も R2 も使っていない**ということです。

- Worker（100k req/day 制約）が要らない設計にすればリクエスト課金が消える
- ファイル数を約 1,010 に抑えれば Pages の 20,000 ファイル上限の 5% で収まる
- 24 時間 Edge キャッシュさせれば、オリジン側のデプロイ帯域もほぼ消費されない

結果として、**そもそも課金が発生しうる軸が一本もない構成**になりました。

## 「無料枠だけで成立する」根拠

実際に運用してみての数字は次のとおりです。

- **累計コスト: 0 円**（ドメイン代を除く）
- Cloudflare Pages: 静的ホスティング無料・帯域無料・無制限
- Cloudflare CDN: 帯域無料、Edge キャッシュ自動
- GitHub Actions: パブリックリポジトリは時間無制限
- 月次の更新ジョブは数分で完了し、Actions 無料枠も全く使い切らない

「Worker 無し / R2 無し / KV 無し」で組んでいるので、たとえトラフィックが伸びても、**料金が発生する仕組みが構造的に存在しない**のがいちばん気に入っています。

「永続的に無料で動き続ける個人プロジェクト」は、機能を増やすことよりも、**課金軸を一本ずつ削っていく**ことのほうが本質だと思います。

## 使い方サンプル

公開している 8 言語の SDK は、どれも同じ API シグネチャに揃えてあります。3 行で書けます。

### TypeScript

```ts
import { lookup } from "@jpzip/jpzip";

const entry = await lookup("2310017");
// → { prefecture: "神奈川県", city: "横浜市中区", towns: [{ town: "本町", ... }], ... }
```

### Go

```go
import "github.com/jpzip/go"

entry, err := jpzip.Lookup(ctx, "2310017")
```

### Python

```python
from jpzip import lookup

entry = lookup("2310017")
```

返ってくる `ZipcodeEntry` には、**漢字 / 全角カタカナ / ローマ字** に加えて、**JIS X 0401（都道府県コード）** と **総務省地方公共団体コード（市区町村コード）** が入っています。フォームのオートフィルから、行政データとの突合まで一本のデータで賄える形にしています。

オフライン化したいときは `preload({ scope: "all" })` を呼ぶだけで、以降はネットワーク不要で動きます。電車の中の Web アプリでも、CI の中でも同じ挙動です。

## 1 人 + AI 駆動で作ってみて

このプロジェクトは Claude Code 1 人で AI 駆動で作りました。特に印象的だったのは:

- プロトコル仕様（`spec/v1/protocol.md`）を **先に固定** したら、各言語の SDK 実装が驚くほどスムーズだったこと
- 主要 8 言語の SDK を **6 時間で実装** できたこと（これは別記事で詳しく書きます）
- 「データ層 / プロトコル層 / クライアント層」を分離しておけば、Claude が一気に多言語展開できること

> 仕様を文章で固める → AI に「この仕様の通りに実装して」と頼む

この順番にした瞬間、SDK は「書く対象」から「**生成する対象**」になりました。

## このシリーズで書く 4 本

本記事は **シリーズの 1 本目（ハブ記事）** です。残り 3 本でそれぞれの中身を掘ります。

1. **本記事**: Cloudflare Pages 無料枠だけで micro-SaaS データセットを作った話
2. [KEN_ALL.csv を Cloudflare Pages から 120,677 件配信する設計](https://jpzip.nadai.dev/blog/cloudflare-pages-static-zipcode-delivery/)
   - 静的ファイルの分割戦略、ファイル数を 1,010 に抑えた理由、ETL の作り
3. [MCP サーバーを書いて Claude が郵便番号を扱えるようにした](https://jpzip.nadai.dev/blog/mcp-server-japanese-postcode/)
   - `lookup_zipcode` / `search_by_address` の設計、Claude Desktop への導入
4. [Claude Code 1 人開発で 6 時間で 8 言語 SDK を実装した話](https://jpzip.nadai.dev/blog/claude-code-8-sdks-6-hours/)
   - プロトコル先行の設計、Claude への投げ方、各言語固有のハマりどころ

## 使ってみてください

「業務で正式に郵便番号を扱う」なら日本郵便公式 API を強く推します。jpzip はあくまでその補完選択肢で、**個人開発 / OSS / 趣味プロジェクト** を主なターゲットにしています。

- サービス: <https://jpzip.nadai.dev/>
- GitHub: <https://github.com/jpzip>
- npm: `npm i @jpzip/jpzip`
- Go: `go get github.com/jpzip/go`
- pip: `pip install jpzip`

サイト上の Playground で動作確認できます。フィードバック・Issue・PR 大歓迎です。

「無料で永続的に動く個人プロジェクト」って成立するのか？という問いに、自分なりの答えを出してみた一つの形として、参考になれば嬉しいです。
