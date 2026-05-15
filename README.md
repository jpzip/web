# jpzip/web

`jpzip.nadai.dev` のランディング & docs サイト。Astro + Vue で構築した静的サイト。

## 構成

| ファイル | 内容 |
|---|---|
| `src/pages/index.astro` | トップページ (Hero / Playground / Stats / SDK / Features) |
| `src/pages/docs.astro` | プロトコル仕様と SDK の使い方 |
| `src/layouts/Base.astro` | 共通ヘッダー・フッター・テーマトグル読み込み |
| `src/components/Playground.vue` | jpzip CDN を直接叩く Vue コンポーネント |
| `src/components/CodeBlock.vue` | TS/Go/Python/Rust のタブ付きコードサンプル |
| `src/components/ThemeToggle.vue` | ライト/ダーク切替 (localStorage 永続化) |
| `src/lib/jpzip.ts` | CDN クライアント (fetch + オフライン fallback) |
| `src/styles/global.css` | デザインシステム (paper / airmail / postal) |
| `public/favicon.svg` | 「郵」マーク |

## 開発

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # → dist/
```

## デプロイ

`npm run build` の出力 `dist/` をそのまま Cloudflare Pages の `jpzip` プロジェクトに重ねる。データ層 (`jpzip/data` の Actions) と同じ Pages プロジェクトを共有しているため、ファイル名衝突を避けて配置されている (`g/`, `p/`, `meta.json` はデータ層、それ以外がランディング)。

## ライセンス

MIT
