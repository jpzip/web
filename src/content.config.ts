import { defineCollection, z, reference } from 'astro:content';
import { glob } from 'astro/loaders';

// author 定義 — frontmatter からは author: 'nadai' のように slug 参照
const authors = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/authors' }),
  schema: z.object({
    name: z.string(),
    url: z.string().url().optional(),
    bio: z.record(z.string(), z.string()).optional(), // { ja, en }
    avatar: z.string().optional(),
    // 外部識別 URL (Person.sameAs に出力。E-E-A-T)
    sameAs: z.array(z.string().url()).default([]),
  }),
});

const syndication = z.object({
  platform: z.enum(['qiita', 'devto', 'zenn', 'medium', 'hashnode', 'note', 'hatena']),
  url: z.string().url(),
});

// FAQPage 構造化データ用 (Q&A 配列)
const faqItem = z.object({
  q: z.string(),
  a: z.string(),
});

// HowTo 構造化データ用 (手順)
const howTo = z.object({
  name: z.string(),
  description: z.string().optional(),
  steps: z
    .array(
      z.object({
        name: z.string(),
        text: z.string(),
        url: z.string().url().optional(),
      }),
    )
    .min(2),
});

const blogBase = z.object({
  id: z.string().regex(/^\d{4}$/), // 4 桁採番
  title: z.string(),
  description: z.string(),
  publishedAt: z.coerce.date(),
  updatedAt: z.coerce.date().optional(),
  author: reference('authors').default('nadai'),
  tags: z.array(z.string()).default([]),
  series: z
    .object({
      name: z.string(),
      part: z.number().int().positive(),
    })
    .optional(),
  ogImage: z.string().optional(),
  // OGP の eyebrow (タグ風ラベル) を明示指定したいときに使う。未指定なら tags[0]。
  // 例えば「Claude Code」タグは付けたいが、OGP では「AI 駆動開発」と出したい場合に。
  ogEyebrow: z.string().optional(),
  syndications: z.array(syndication).default([]),
  faq: z.array(faqItem).default([]),
  howTo: howTo.optional(),
  status: z.enum(['draft', 'published']).default('published'),
});

const blogJa = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog/ja' }),
  schema: blogBase.extend({ lang: z.literal('ja').default('ja') }),
});

const blogEn = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog/en' }),
  schema: blogBase.extend({ lang: z.literal('en').default('en') }),
});

export const collections = {
  authors,
  'blog-ja': blogJa,
  'blog-en': blogEn,
};
