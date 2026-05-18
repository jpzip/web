// ビルド時に 1200×630 の OGP PNG を satori + resvg で焼く。
// レイアウトは 2 種類:
//   - renderDefaultOg(locale): サイト全体のデフォルト OGP (top / docs / blog index 等)
//   - renderArticleOg({ title, eyebrow, locale }): 記事ごとの OGP
//
// フォントは src/assets/fonts/ に同梱 (Anton, NotoSansJP-Black) しているので、
// build 環境のシステムフォントには依存しない。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

export type Locale = 'ja' | 'en';

// build 中の cwd は web/。endpoint のバンドル後パスを起点にすると壊れるので cwd 固定。
const FONTS_DIR = path.resolve(process.cwd(), 'src/assets/fonts');

// 生成済み PNG のキャッシュ。git 追跡 (web/og-cache/) にすることで、
// CI / 新 clone / npm キャッシュ削除後でも常に warm を維持する。
// レイアウト/フォントサイズ/フォントを変えたら DESIGN_VERSION を bump → 全再生成。
// 古い PNG は孤立するので `rm og-cache/*.png && npm run build` で焼き直す。
const CACHE_DIR = path.resolve(process.cwd(), 'og-cache');
const DESIGN_VERSION = 1;

function readCache(key: string): Uint8Array | null {
  try {
    return fs.readFileSync(path.join(CACHE_DIR, `${key}.png`));
  } catch {
    return null;
  }
}

function writeCache(key: string, png: Uint8Array): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const dest = path.join(CACHE_DIR, `${key}.png`);
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, png);
  fs.renameSync(tmp, dest);
}

// 起動時に 1 回だけ読み込んでメモ化 (getStaticPaths のループで毎回読まない)。
let cachedFonts: { anton: Buffer; notoJp: Buffer } | null = null;
function loadFonts() {
  if (cachedFonts) return cachedFonts;
  cachedFonts = {
    anton: fs.readFileSync(path.join(FONTS_DIR, 'Anton-Regular.ttf')),
    notoJp: fs.readFileSync(path.join(FONTS_DIR, 'NotoSansJP-Black.otf')),
  };
  return cachedFonts;
}

// 任意の object tree を satori が受け取れる形に揃える小ヘルパー。
// JSX を使わないのは .ts のままで完結させるため (Astro endpoint の都合)。
type Node = { type: string; props: { style?: Record<string, unknown>; children?: unknown } };
const div = (style: Record<string, unknown>, children?: unknown): Node => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children },
});

// 1200px 幅の上下バーを 24px × 50 個の交互色矩形で表現 (郵便配達の紅白縞風)。
const STRIPE_NAVY = '#2c3e50';
const STRIPE_RED = '#c0392b';
function stripeBand(): Node {
  const segments: Node[] = [];
  const count = 50;
  for (let i = 0; i < count; i++) {
    segments.push(
      div({
        flex: 1,
        backgroundColor: i % 2 === 0 ? STRIPE_NAVY : STRIPE_RED,
      }),
    );
  }
  return div({ width: '100%', height: 16, flexDirection: 'row' }, segments);
}

// 共通のフォント設定。Anton は Latin 専用、Noto Sans JP は和欧両対応。
const SATORI_FONTS = () => {
  const { anton, notoJp } = loadFonts();
  return [
    { name: 'Anton', data: anton, weight: 400 as const, style: 'normal' as const },
    { name: 'NotoSansJP', data: notoJp, weight: 900 as const, style: 'normal' as const },
  ];
};

// ---------------------------- default OGP -----------------------------------

const DEFAULT_COPY = {
  ja: {
    tagline1: '日本の郵便番号を、',
    tagline2: 'CDN から配るデータセット。',
    pill: '登録不要 · 無料 · MIT',
    stats: '120,677 zipcodes · 15+ SDKs · since 2026',
  },
  en: {
    tagline1: 'Japan zipcodes,',
    tagline2: 'served from a CDN.',
    pill: 'No signup · Free · MIT',
    stats: '120,677 zipcodes · 15+ SDKs · since 2026',
  },
} as const;

function buildDefaultElement(locale: Locale) {
  const t = DEFAULT_COPY[locale];

  return div(
    {
      width: 1200,
      height: 630,
      // satori は単純な linearGradient を backgroundImage で受け付ける
      backgroundColor: '#fbf8f1',
      backgroundImage: 'linear-gradient(135deg, #fbf8f1 0%, #f3ece0 100%)',
      color: '#1a1a1a',
      flexDirection: 'column',
      fontFamily: 'NotoSansJP',
    },
    [
      stripeBand(),

      // 中身は上下バーの間で padding を取る
      div(
        {
          flex: 1,
          flexDirection: 'column',
          padding: '72px 96px',
          justifyContent: 'space-between',
        },
        [
          // 上段: 郵 + jpzip + jpzip.nadai.dev
          div({ alignItems: 'flex-start', gap: '24px' }, [
            div(
              {
                width: 120,
                height: 120,
                borderRadius: 22,
                backgroundColor: '#2c3e50',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'NotoSansJP',
                fontSize: 70,
                color: '#fbf8f1',
              },
              '郵',
            ),
            div({ flexDirection: 'column', marginTop: 6 }, [
              div(
                {
                  fontFamily: 'NotoSansJP',
                  fontSize: 96,
                  lineHeight: 1,
                  color: '#1a1a1a',
                },
                'jpzip',
              ),
              div(
                {
                  fontFamily: 'Anton',
                  fontSize: 22,
                  letterSpacing: '0.04em',
                  marginTop: 12,
                  color: '#6b6b6b',
                },
                'jpzip.nadai.dev',
              ),
            ]),
          ]),

          // 中段: tagline (2 行)
          div({ flexDirection: 'column', gap: '12px' }, [
            div(
              {
                fontFamily: 'NotoSansJP',
                fontSize: 64,
                lineHeight: 1.2,
                color: '#1a1a1a',
              },
              t.tagline1,
            ),
            div(
              {
                fontFamily: 'NotoSansJP',
                fontSize: 64,
                lineHeight: 1.2,
                // グラデーション色のテキストは satori で安定しないので赤系単色に倒す
                color: '#c0392b',
              },
              t.tagline2,
            ),
          ]),

          // 下段: pill + stats
          div({ alignItems: 'center', gap: '24px' }, [
            div(
              {
                paddingTop: 10,
                paddingBottom: 10,
                paddingLeft: 22,
                paddingRight: 22,
                borderRadius: 22,
                backgroundColor: '#2c3e50',
                color: '#fbf8f1',
                fontFamily: 'NotoSansJP',
                fontSize: 18,
              },
              t.pill,
            ),
            div(
              {
                fontFamily: 'Anton',
                fontSize: 22,
                letterSpacing: '0.04em',
                color: '#6b6b6b',
              },
              t.stats,
            ),
          ]),
        ],
      ),

      stripeBand(),
    ],
  );
}

async function renderTo(element: Node): Promise<Uint8Array> {
  const svg = await satori(element as unknown as Parameters<typeof satori>[0], {
    width: 1200,
    height: 630,
    fonts: SATORI_FONTS(),
  });
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}

export async function renderDefaultOg(locale: Locale): Promise<Uint8Array> {
  const h = crypto.createHash('sha1');
  h.update(`v${DESIGN_VERSION}\0default\0${locale}`);
  const key = h.digest('hex');
  const hit = readCache(key);
  if (hit) return hit;
  const png = await renderTo(buildDefaultElement(locale));
  writeCache(key, png);
  return png;
}

// ---------------------------- article OGP -----------------------------------

export interface ArticleOgInput {
  title: string;
  eyebrow: string;
  locale: Locale;
}

// 文字数からおおざっぱにフォントサイズを決める。短いほど大きく、長いほど縮める。
function articleTitleFontSize(title: string, locale: Locale): number {
  const len = title.length;
  if (locale === 'ja') {
    if (len <= 14) return 88;
    if (len <= 22) return 72;
    if (len <= 30) return 60;
    return 52;
  }
  if (len <= 20) return 96;
  if (len <= 32) return 80;
  if (len <= 48) return 64;
  return 54;
}

function buildArticleElement({ title, eyebrow, locale }: ArticleOgInput) {
  const titleSize = articleTitleFontSize(title, locale);
  // 日本語混じりは NotoSansJP に倒す (Anton は Latin only)
  const hasJapanese = /[　-ヿ㐀-䶿一-鿿＀-￯]/.test(title);
  const titleFamily = hasJapanese || locale === 'ja' ? 'NotoSansJP' : 'Anton';

  return div(
    {
      width: 1200,
      height: 630,
      backgroundColor: '#fbf8f1',
      backgroundImage: 'linear-gradient(135deg, #fbf8f1 0%, #f3ece0 100%)',
      color: '#1a1a1a',
      flexDirection: 'column',
      fontFamily: 'NotoSansJP',
    },
    [
      stripeBand(),

      div(
        {
          flex: 1,
          flexDirection: 'column',
          padding: '72px 96px',
          justifyContent: 'space-between',
        },
        [
          // 上段: ヘアライン + eyebrow (tag)
          div(
            {
              alignItems: 'center',
              gap: '24px',
              fontFamily: 'Anton',
              fontSize: 28,
              letterSpacing: '0.18em',
              color: '#c0392b',
            },
            [
              div({ width: 56, height: 2, backgroundColor: '#c0392b' }),
              div({}, eyebrow.toUpperCase()),
            ],
          ),

          // 中段: タイトル (3 行で打ち切り)
          div(
            {
              fontFamily: titleFamily,
              fontSize: titleSize,
              lineHeight: 1.22,
              letterSpacing: hasJapanese ? '-0.01em' : '0',
              color: '#1a1a1a',
              maxWidth: 1008,
              display: 'block',
              // @ts-expect-error satori 拡張
              lineClamp: 3,
            },
            title,
          ),

          // 下段: 郵 jpzip wordmark — jpzip.nadai.dev
          div(
            {
              alignItems: 'center',
              justifyContent: 'space-between',
            },
            [
              div({ alignItems: 'center', gap: '16px' }, [
                div(
                  {
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    backgroundColor: '#2c3e50',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'NotoSansJP',
                    fontSize: 26,
                    color: '#fbf8f1',
                  },
                  '郵',
                ),
                div(
                  {
                    fontFamily: 'NotoSansJP',
                    fontSize: 38,
                    color: '#1a1a1a',
                  },
                  'jpzip',
                ),
              ]),
              div(
                {
                  fontFamily: 'Anton',
                  fontSize: 22,
                  letterSpacing: '0.04em',
                  color: '#6b6b6b',
                },
                locale === 'ja' ? 'jpzip.nadai.dev/blog' : 'jpzip.nadai.dev/en/blog',
              ),
            ],
          ),
        ],
      ),

      stripeBand(),
    ],
  );
}

export async function renderArticleOg(input: ArticleOgInput): Promise<Uint8Array> {
  const h = crypto.createHash('sha1');
  h.update(`v${DESIGN_VERSION}\0article\0${input.locale}\0${input.eyebrow}\0${input.title}`);
  const key = h.digest('hex');
  const hit = readCache(key);
  if (hit) return hit;
  const png = await renderTo(buildArticleElement(input));
  writeCache(key, png);
  return png;
}
