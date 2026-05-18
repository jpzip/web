// サイト全体のデフォルト OGP (日本語版)。/og.png として配信される。
// 実装は src/lib/og.ts の renderDefaultOg('ja')。

import type { APIRoute } from 'astro';
import { renderDefaultOg } from '../lib/og';

export const GET: APIRoute = async () => {
  const png = await renderDefaultOg('ja');
  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png' },
  });
};
