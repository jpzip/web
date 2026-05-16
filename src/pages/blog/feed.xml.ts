import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

const SITE = 'https://jpzip.nadai.dev';
const TITLE = 'jpzip blog (ja)';
const DESC = 'jpzip 開発の裏側・Cloudflare Pages 設計・MCP server・AI 駆動開発の記事';

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const GET: APIRoute = async () => {
  const posts = (await getCollection('blog-ja', ({ data }) => data.status === 'published')).sort(
    (a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime(),
  );

  const lastBuildDate = posts[0]?.data.publishedAt ?? new Date();

  const itemsXml = posts
    .map((p) => {
      const link = `${SITE}/blog/${p.id}/`;
      return `    <item>
      <title>${escape(p.data.title)}</title>
      <link>${escape(link)}</link>
      <guid isPermaLink="true">${escape(link)}</guid>
      <pubDate>${p.data.publishedAt.toUTCString()}</pubDate>
      <description>${escape(p.data.description)}</description>
${p.data.tags.map((t) => `      <category>${escape(t)}</category>`).join('\n')}
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escape(TITLE)}</title>
    <link>${SITE}/blog/</link>
    <atom:link href="${SITE}/blog/feed.xml" rel="self" type="application/rss+xml" />
    <description>${escape(DESC)}</description>
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
