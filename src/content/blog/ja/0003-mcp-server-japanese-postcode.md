---
id: "0003"
title: MCP サーバーを書いて Claude が日本の郵便番号を扱えるようにした
description: stateless な MCP サーバーで Claude が日本の郵便番号を引けるようにした話。Tool 設計、キャッシュ寿命の分離、漢字/カナ/ローマ字の 3 言語横断検索。
lang: ja
publishedAt: 2026-05-17
author: nadai
tags: [MCP, Claude, TypeScript, AI]
series:
  name: jpzip
  part: 3
status: published
faq:
  - q: jpzip の MCP サーバーをインストールする方法は？
    a: 'Claude Code であれば `claude mcp add jpzip -- npx -y @jpzip/mcp-server-jpzip` の 1 行で完了します。Claude Desktop など他の MCP クライアントは `mcp.json` に `command: npx` / `args: ["-y", "@jpzip/mcp-server-jpzip"]` を追記してください。'
  - q: 利用に登録やアカウントは必要ですか？
    a: '不要です。MCP サーバー自体に認証はなく、背後の jpzip CDN (`https://jpzip.nadai.dev`) も登録なしで誰でも使えます。'
  - q: 駅名や事業所の郵便番号は引けますか？
    a: '引けません。日本郵便 KEN_ALL.csv が出典なので、住所⇄郵便番号 (漢字 / カナ / ローマ字) のみ対応します。'
  - q: ローマ字混じりの自由文で検索できますか？
    a: '1 表記内 (漢字のみ・カナのみ・ローマ字のみ) の連続部分一致のみマッチします。「Yokohama Honcho」のような中区を飛ばすローマ字混在クエリには対応していません。'
  - q: 提供される MCP tool は何ですか？
    a: '`lookup_zipcode` / `search_by_address` / `list_cities_in_prefecture` / `get_metadata` の 4 つです。'
howTo:
  name: Claude Code に jpzip MCP サーバーをインストールする
  description: Claude Code から日本の郵便番号 (住所⇄郵便番号 + 都道府県の市区町村一覧) を引けるようにするまでの手順。
  steps:
    - name: Node.js 18+ を用意する
      text: ローカル環境に Node.js 18 以上をインストールしておく。`npx` が呼べる状態であれば追加準備は不要。
    - name: Claude Code に MCP サーバーを追加する
      text: ターミナルで `claude mcp add jpzip -- npx -y @jpzip/mcp-server-jpzip` を実行する。`-y` は npm の初回確認をスキップする指定。
    - name: 動作確認する
      text: Claude Code を再起動してから「2310017 ってどこ？」のように郵便番号を聞き、Claude が `lookup_zipcode` ツールを使って住所を返せば成功。
      url: https://github.com/jpzip/mcp
---

> シリーズ 3 本目。Claude / 任意の MCP クライアントから「2310017 ってどこ？」「横浜市中区本町の郵便番号は？」と直接聞けるようにした話です。1 本目: [Cloudflare Pages 無料枠だけで micro-SaaS](https://jpzip.nadai.dev/blog/0001-cloudflare-pages-micro-saas/)、2 本目: [120,677 件配信の設計](https://jpzip.nadai.dev/blog/0002-cloudflare-pages-static-zipcode-delivery/)。

- npm: `@jpzip/mcp-server-jpzip`
- GitHub: <https://github.com/jpzip/mcp>
- 背景データ: <https://jpzip.nadai.dev>（Cloudflare Pages 配信）

## TL;DR

- Claude から「郵便番号 → 住所」「住所 → 郵便番号」が直接聞けるようになる MCP サーバーを書きました
- 提供ツールは 4 つ: `lookup_zipcode` / `search_by_address` / `list_cities_in_prefecture` / `get_metadata`
- 実装はわずか **~250 行（index.ts + tools.ts）**
- バックエンドの jpzip CDN は静的 JSON 配信。MCP サーバー自体は **stateless な stdio プロセス**
- インストールは `claude mcp add jpzip -- npx -y @jpzip/mcp-server-jpzip` の 1 行
- 工夫したのは「Claude が話す多言語（漢字 / カナ / ローマ字）すべてで検索できる」ところと「キャッシュの寿命設計」

## なぜ MCP にしたのか

これまでの jpzip は、人間が SDK を呼ぶことを前提にしていました。けれど Claude を使い始めると、<strong>「Claude にそのまま住所を聞きたい」</strong>という欲求が強くなります。

```
"2310017 って住所どこ？"
"横浜市中区本町の郵便番号教えて"
"神奈川県の市区町村全部出して"
```

これを Claude が「直接データを引いて」答えられるようになれば、わざわざ自前で API を叩くツールを書く必要がない。これが MCP（Model Context Protocol）の出番です。

## 設計の前提

設計に入る前に、自分に課した制約は 3 つ:

1. **Stateless**: Claude を再起動したら全部消える。永続キャッシュを持たない
2. **登録不要**: MCP サーバー自体の認証も不要。CDN 側も認証なし
3. **CDN を直叩き**: MCP サーバーから直接 `jpzip.nadai.dev` を叩く。自前の API は置かない

これにより、MCP サーバーは「**CDN とのプロトコルを Claude が話せる言葉に翻訳するだけのレイヤー**」になります。状態を持たないので、何台動いても、何回再起動しても、何も困らない。

## 提供する 4 つの Tool

| Tool | 用途 |
|---|---|
| `lookup_zipcode(zipcode)` | 郵便番号 → 住所（漢字 / カナ / ローマ字 + JIS/総務省コード） |
| `search_by_address(query, limit?)` | 住所文字列 → 郵便番号候補（言語横断、空白無視の部分一致） |
| `list_cities_in_prefecture(prefecture)` | 都道府県名 → 市区町村一覧（総務省コード付き） |
| `get_metadata()` | データバージョン・件数・生成時刻 |

各 tool の `description` を Claude が読んでツールを選ぶので、ここの書き方が体験を左右します。たとえば `search_by_address`:

```ts
description:
  'Search for postal codes by free-text address query. Matches against prefecture, city, and town in kanji, katakana, or romaji (case-insensitive substring match, whitespace ignored). First call in a session downloads the full dataset (~25MB) into memory; subsequent calls within the same session are instant.',
```

ここに「**初回は ~25 MB ダウンロード、以降は即時**」と書いておくと、Claude は「初回だけ遅い」ことを期待値として持ったうえで使ってくれます。**MCP の `description` は人間向けドキュメントではなく、Claude へのプロンプト**として書くと精度が上がります。

## キャッシュの寿命を 2 つに分ける

ここが MCP サーバー設計でいちばん悩んだ部分です。

`lookup_zipcode("2310017")` は対応する 3 桁 prefix（`/p/231.json`、~10 KB）を 1 ファイル取れば終わります。**初回も速い**。

一方、`search_by_address("横浜市中区")` は全件走査が必要なので、初回は全件（10 ファイル × ~1 MB ≒ ~25 MB）を fetch して、メモリに載せる必要があります。

この 2 つを **同じキャッシュで扱うか別キャッシュで扱うか** が問題でした。結論はこうしました:

```ts
// プロセス起動中だけ生きる「全件辞書」のキャッシュ
let fullDatasetPromise: Promise<ZipcodeDict> | null = null;

function getFullDataset(client: JpzipClient): Promise<ZipcodeDict> {
  if (fullDatasetPromise === null) {
    fullDatasetPromise = client.lookupAll().catch((err) => {
      // 失敗したら次の呼び出しでリトライさせる
      fullDatasetPromise = null;
      throw err;
    });
  }
  return fullDatasetPromise;
}
```

- `lookup_zipcode`: jpzip SDK の L1 キャッシュ（3 桁 prefix 単位）を使う。**取りに行くのは ~10 KB**
- `search_by_address` / `list_cities_in_prefecture`: 上記 `getFullDataset()` を経由。**初回 ~25 MB、以降即時**
- どちらも **プロセスが死ねば消える**（stateless）

ポイントは `Promise` 自体をキャッシュしていることです。これにより「初回呼び出し中に 2 回目が来ても、二重に fetch しない」が成立します。

## 3 言語横断検索の実装

日本の住所は **漢字 / 全角カタカナ / 半角ローマ字** の 3 表記を持ちます。Claude は会話の流れで「ヨコハマ」「Yokohama」「横浜」を混ぜて喋ってきます。

ナイーブに「3 表記を全部結合した文字列に部分一致させる」とこうなります:

```
needle = "中区本町"
haystack = "神奈川県カナガワケン横浜市中区ヨコハマシナカク本町ホンチョウ..."
→ matches!
```

…と思いきや、これだと「**Yokohama Hon**cho」のようなローマ字での問い合わせが「Yokohama」と「Honcho」の間に「Shi Naka Ku」を挟まれてマッチしない問題が起きます。

なので 3 言語を **別々の haystack** に分けました:

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

加えて、ローマ字の「Yokohama Shi Naka Ku」のスペース問題に対しては **両側から空白を除去**することで、「横浜市中区本町」も「YokohamaShiNakaKuHoncho」も同じ haystack に正規化されます。

> **既知の制約**: 1 表記内での連続部分一致のみ。「Yokohama Honcho」（ローマ字で中区を飛ばす）はマッチしません。これは README にも明記しています。完璧な意味検索は MCP サーバーの守備範囲外と割り切りました。

## 入力の正規化

Claude は「`231-0017`」のようにハイフン入りの郵便番号を投げてくることがよくあります。あと全角ハイフン「ー」とか、スペースとか。

```ts
function normalizeZipcode(input: string): string | null {
  const stripped = input.replace(/[-ー\s]/g, '');
  return /^\d{7}$/.test(stripped) ? stripped : null;
}
```

ここを甘くすると、「正しく郵便番号渡したのにエラーで返ってきた」という体験が起きます。MCP の入力は **人間が口頭で言うかもしれない表記すべて** を受け入れる前提で書くのが安全です。

## サーバーの骨格

`index.ts` の中身は素直です。

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

`@jpzip/jpzip`（1 本目で書いた TypeScript SDK）を内側で使っているので、CDN との通信ロジックは MCP サーバー側で書き直す必要がありません。**SDK が安定していれば MCP サーバーは数百行で済む**、というのが重要な学びでした。

## インストール

Claude Code:

```sh
claude mcp add jpzip -- npx -y @jpzip/mcp-server-jpzip
```

Claude Desktop / 他の MCP クライアントは `mcp.json` を直接編集:

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

これだけで Claude が日本の全郵便番号を引けるようになります。

## 使ってみるとどう動くか

導入後の Claude との会話はこんな感じです。

> **私**: 「2310017 ってどこ？」
> **Claude**: （`lookup_zipcode` を内部で呼ぶ）「神奈川県横浜市中区本町です」

> **私**: 「Yokohama の Honcho の郵便番号一覧出して」
> **Claude**: （`search_by_address("Yokohama Honcho")` を呼ぶ）「以下が該当します: …」

> **私**: 「神奈川県の市区町村全部」
> **Claude**: （`list_cities_in_prefecture("Kanagawa")` を呼ぶ）「33 市区町村あります: …」

Claude が tool を **どう選ぶか / どう呼ぶか / どう要約するか** を見るのが楽しいです。`description` を書き直すたびに挙動が変わるので、ここは何回かイテレートしました。

## 設計のおさらい

「Claude が郵便番号を扱える」という体験を成立させるのに、追加したインフラはゼロです。

- データ層: 既存の Cloudflare Pages 配信のまま
- プロトコル層: 既存の `spec/v1` のまま
- クライアント層（TS SDK）: 既存の `@jpzip/jpzip` のまま
- **MCP サーバー: 新規（~250 行）**

レイヤー分離が効いていて、**MCP サーバーは「最薄のアダプタ」になりました**。これは 1 本目で書いた「データ層 / プロトコル層 / クライアント層を分離」の設計が、こういう派生にも素直に乗ってくれることの一例です。

## このシリーズで書く 4 本

1. [Cloudflare Pages 無料枠だけで micro-SaaS データセットを作った話](https://jpzip.nadai.dev/blog/0001-cloudflare-pages-micro-saas/)
2. [KEN_ALL.csv を Cloudflare Pages から 120,677 件配信する設計](https://jpzip.nadai.dev/blog/0002-cloudflare-pages-static-zipcode-delivery/)
3. **本記事**: MCP サーバーを書いて Claude が郵便番号を扱えるようにした
4. [Claude Code 1 人開発で 6 時間で 8 言語 SDK を実装した話](https://jpzip.nadai.dev/blog/0004-claude-code-8-sdks-6-hours/)

## 使ってみてください

- npm: <https://www.npmjs.com/package/@jpzip/mcp-server-jpzip>
- GitHub: <https://github.com/jpzip>
- 背景データ: <https://jpzip.nadai.dev/>

Claude を使う開発者の方は、ぜひ `claude mcp add jpzip -- npx -y @jpzip/mcp-server-jpzip` を試してみてください。住所まわりの調べ物がぜんぶ Claude に丸投げできるようになります。
