// public/og.svg を 1200x630 PNG にラスタライズして public/og.png に書き出す。
// 一部 SNS (X / Slack の一部プレビューなど) は SVG OGP を表示しないので、PNG を正本にする。

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const svgPath = resolve(root, 'public/og.svg');
const pngPath = resolve(root, 'public/og.png');

const svg = readFileSync(svgPath, 'utf-8');
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1200 },
  font: { loadSystemFonts: true },
});
const png = resvg.render().asPng();
writeFileSync(pngPath, png);

console.log(`✓ wrote ${pngPath} (${png.byteLength.toLocaleString()} bytes)`);
