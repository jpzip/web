// blog 記事ページ向けの SEO/AIO ヘルパ群。
// JSON-LD 構築、reading time 算出、TOC 整形などを一箇所に集める。

import type { MarkdownHeading } from 'astro';

export interface AuthorLike {
  name: string;
  url?: string;
  sameAs?: string[];
}

export interface PostLike {
  id: string;
  data: {
    title: string;
    description: string;
    publishedAt: Date;
    updatedAt?: Date;
    tags: string[];
    series?: { name: string; part: number };
    ogImage?: string;
    faq: Array<{ q: string; a: string }>;
    howTo?: {
      name: string;
      description?: string;
      steps: Array<{ name: string; text: string; url?: string }>;
    };
  };
  body?: string;
}

// 日本語/英語混在の文字数を雑に分けて読了時間を算出する。
// CJK は 1 分 600 文字、欧文は 1 分 230 単語 (日本語ブログ + 英訳両対応)。
export function readingTime(body: string, lang: 'ja' | 'en'): number {
  // コードブロック・URL・記号系を軽く落としてから数える
  const cleaned = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~\-]/g, '');

  if (lang === 'ja') {
    const cjk = (cleaned.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? []).length;
    const ascii = (cleaned.match(/[A-Za-z0-9]+/g) ?? []).length;
    const minutes = cjk / 600 + ascii / 230;
    return Math.max(1, Math.round(minutes));
  }
  const words = (cleaned.match(/\S+/g) ?? []).length;
  return Math.max(1, Math.round(words / 230));
}

// JSON-LD 用に総 "語数" (CJK は 1 文字 = 1 語扱い) を出す。
export function wordCount(body: string): number {
  const cleaned = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  const cjk = (cleaned.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? []).length;
  const ascii = (cleaned.match(/[A-Za-z0-9]+/g) ?? []).length;
  return cjk + ascii;
}

// h2 / h3 のみを TOC として残す。h1 は記事タイトルと重複するので除外。
export function tocHeadings(headings: MarkdownHeading[]): MarkdownHeading[] {
  return headings.filter((h) => h.depth >= 2 && h.depth <= 3);
}

// FAQPage JSON-LD を組み立てる。faq が空なら undefined を返す。
export function faqLd(faq: PostLike['data']['faq']) {
  if (!faq || faq.length === 0) return undefined;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };
}

// HowTo JSON-LD を組み立てる。howTo が未設定なら undefined。
export function howToLd(howTo: PostLike['data']['howTo'], inLanguage: 'ja' | 'en') {
  if (!howTo) return undefined;
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: howTo.name,
    description: howTo.description,
    inLanguage,
    step: howTo.steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.name,
      text: s.text,
      url: s.url,
    })),
  };
}

// 著者の sameAs を Person JSON-LD 用に整形する。重複と空配列を排除。
export function personLd(author: AuthorLike | null | undefined, fallbackName = 'nadai') {
  const sameAs = Array.from(new Set(author?.sameAs ?? [])).filter(Boolean);
  return {
    '@type': 'Person' as const,
    name: author?.name ?? fallbackName,
    url: author?.url,
    sameAs: sameAs.length > 0 ? sameAs : undefined,
  };
}

// BlogPosting.image を絶対 URL に正規化する。
export function resolveImage(siteUrl: string, ogImage: string | undefined, fallback = '/og.png'): string {
  const img = ogImage ?? fallback;
  if (/^https?:\/\//.test(img)) return img;
  return `${siteUrl}${img.startsWith('/') ? '' : '/'}${img}`;
}

// articleSection は「シリーズ名 > 主タグ」を優先する。
export function articleSection(series: { name: string } | undefined, tags: string[]): string | undefined {
  return series?.name ?? tags[0];
}
