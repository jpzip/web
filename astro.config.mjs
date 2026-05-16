import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import sitemap from '@astrojs/sitemap';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeSlug from 'rehype-slug';

export default defineConfig({
  site: 'https://jpzip.nadai.dev',
  i18n: {
    defaultLocale: 'ja',
    locales: ['ja', 'en'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  integrations: [
    vue(),
    sitemap({
      // feed.xml は RSS 用 (Astro エンドポイント) なので sitemap からは除外
      filter: (page) => !page.endsWith('/feed.xml'),
      lastmod: new Date(),
      i18n: {
        defaultLocale: 'ja',
        locales: { ja: 'ja-JP', en: 'en-US' },
      },
    }),
  ],
  markdown: {
    // rehype-slug で h1-h6 に id を付与し、autolink-headings で
    // 見出し横に anchor リンクを挿入。AIO で節単位の引用 URL を返せるようにする。
    rehypePlugins: [
      rehypeSlug,
      [
        rehypeAutolinkHeadings,
        {
          behavior: 'prepend',
          properties: {
            className: ['heading-anchor'],
            ariaLabel: 'Permalink to this section',
          },
          content: { type: 'text', value: '#' },
        },
      ],
    ],
  },
  output: 'static',
  build: {
    inlineStylesheets: 'auto',
  },
});
