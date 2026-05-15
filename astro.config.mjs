import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';

export default defineConfig({
  site: 'https://jpzip.nadai.dev',
  integrations: [vue()],
  output: 'static',
  build: {
    inlineStylesheets: 'auto',
  },
});
