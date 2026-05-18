// ブログ記事ごとの OGP PNG を build 時に静的書き出しする endpoint。
// 結果は dist/og/<locale>/<slug>.png として置かれ、blog/[slug].astro (および
// en/blog/[slug].astro) から /og/<locale>/<slug>.png として参照される。

import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { renderArticleOg, type Locale } from '../../../lib/og';

export const getStaticPaths: GetStaticPaths = async () => {
  const [ja, en] = await Promise.all([
    getCollection('blog-ja', ({ data }) => data.status === 'published'),
    getCollection('blog-en', ({ data }) => data.status === 'published'),
  ]);

  const entries = [
    ...ja.map((p) => ({ locale: 'ja' as Locale, post: p })),
    ...en.map((p) => ({ locale: 'en' as Locale, post: p })),
  ];

  return entries.map(({ locale, post }) => ({
    params: { locale, slug: post.id },
    props: {
      title: post.data.title,
      // eyebrow は ogEyebrow があればそれを優先 (記事ごとに OGP のラベルだけ
      // 別表現にしたいケース)。無ければ tags[0] にフォールバック。
      // 「BENCH-PRESS」より「BENCH PRESS」が読みやすいので - は空白に正規化。
      eyebrow: (post.data.ogEyebrow ?? post.data.tags[0] ?? 'blog').replace(/-/g, ' '),
      locale,
    },
  }));
};

export const GET: APIRoute = async ({ props }) => {
  const { title, eyebrow, locale } = props as {
    title: string;
    eyebrow: string;
    locale: Locale;
  };
  const png = await renderArticleOg({ title, eyebrow, locale });
  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png' },
  });
};
