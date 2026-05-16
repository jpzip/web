import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://jpzip.nadai.dev',
  integrations: [
    vue(),
    sitemap({
      // feed.xml は RSS 用 (Astro エンドポイント) なので sitemap からは除外
      filter: (page) => !page.endsWith('/feed.xml'),
      lastmod: new Date(),
    }),
  ],
  output: 'static',
  build: {
    inlineStylesheets: 'auto',
  },
});
