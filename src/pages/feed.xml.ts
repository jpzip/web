import type { APIRoute } from 'astro';

// jpzip のデータリリース通知用 RSS。
// 現状の /meta.json は最新版のみを返すため、ビルド時の単発 fetch で 1 item の
// フィードを生成する。将来 data 層が /meta.json に version_history[] を持たせる、
// または独自に /feed.xml を生成して上書きデプロイすることで、複数 item に拡張可能。

type Meta = {
  spec_version?: string;
  version: string;
  total_zipcodes: number;
  prefix_count?: number;
  released_at?: string;
  version_history?: Array<{
    version: string;
    total_zipcodes?: number;
    released_at?: string;
    note?: string;
  }>;
};

const SITE = 'https://jpzip.nadai.dev';

async function fetchMeta(): Promise<Meta> {
  try {
    const res = await fetch(`${SITE}/meta.json`);
    if (res.ok) return (await res.json()) as Meta;
  } catch {
    // ビルドホストからネットが通らない環境ではフォールバック
  }
  return { version: '2026-05', total_zipcodes: 120677 };
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function versionToDate(version: string, fallback: Date): Date {
  // "2026-05" → 2026-05-01, "2026-05-15" → 2026-05-15
  const m = version.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) return fallback;
  const [, y, mo, d] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d ?? '01')));
}

type Item = {
  version: string;
  total_zipcodes?: number;
  pubDate: Date;
  note?: string;
};

export const GET: APIRoute = async () => {
  const meta = await fetchMeta();
  const now = new Date();

  const items: Item[] = (
    meta.version_history && meta.version_history.length > 0
      ? meta.version_history.map((v) => ({
          version: v.version,
          total_zipcodes: v.total_zipcodes,
          pubDate: v.released_at
            ? new Date(v.released_at)
            : versionToDate(v.version, now),
          note: v.note,
        }))
      : [
          {
            version: meta.version,
            total_zipcodes: meta.total_zipcodes,
            pubDate: meta.released_at
              ? new Date(meta.released_at)
              : versionToDate(meta.version, now),
          },
        ]
  ).sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  const lastBuildDate = items[0]?.pubDate ?? now;

  const itemsXml = items
    .map((item) => {
      const title = `jpzip data ${item.version}`;
      const description =
        (item.note ? `${item.note} / ` : '') +
        (item.total_zipcodes != null
          ? `${item.total_zipcodes.toLocaleString('en-US')} zipcodes`
          : '日本郵便 KEN_ALL.csv の月次取り込み');
      const link = `${SITE}/meta.json`;
      const guid = `${SITE}/#data-${item.version}`;
      return `    <item>
      <title>${escape(title)}</title>
      <link>${escape(link)}</link>
      <guid isPermaLink="false">${escape(guid)}</guid>
      <pubDate>${item.pubDate.toUTCString()}</pubDate>
      <description>${escape(description)}</description>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>jpzip data releases</title>
    <link>${SITE}</link>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml" />
    <description>jpzip 郵便番号データセットの月次リリース通知 (毎月 1 日・15 日更新)</description>
    <language>ja</language>
    <lastBuildDate>${lastBuildDate.toUTCString()}</lastBuildDate>
${itemsXml}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
