import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import sitemap from '@astrojs/sitemap';

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
  output: 'static',
  build: {
    inlineStylesheets: 'auto',
  },
});
