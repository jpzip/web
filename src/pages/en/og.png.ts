// サイト全体のデフォルト OGP (英語版)。/en/og.png として配信される。

import type { APIRoute } from 'astro';
import { renderDefaultOg } from '../../lib/og';

export const GET: APIRoute = async () => {
  const png = await renderDefaultOg('en');
  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png' },
  });
};
