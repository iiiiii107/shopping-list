/* App icons, rendered from the one SVG that defines the mark.

   `public/favicon.svg` is the source of truth: the browser tab uses it
   directly, and everything below is rasterised from it so the PNGs can never
   drift from the vector.

   An earlier version of this file drew the icon in pixel maths, computing a
   colour per sample. It worked, but curves had to be approximated by hand and
   the steam came out as zigzags — the SVG says what the shape *is*, and a
   rasteriser is much better at turning that into pixels than I am.

   Run with `npm run icons` after changing the mark. */

import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

/** A maskable icon is cropped to a circle by the launcher, so the mark is
    drawn smaller and the ground runs right to the edge with no corners. */
function maskable(svg) {
  return svg
    .replace(/<rect width="64" height="64" rx="12"/, '<rect width="64" height="64"')
    .replace(
      /(<rect width="64" height="64"[^>]*\/>)/,
      '$1<g transform="translate(32 33) scale(0.66) translate(-32 -32)">',
    )
    .replace('</svg>', '</g></svg>');
}

function render(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } })
    .render()
    .asPng();
}

const svg = readFileSync('public/favicon.svg', 'utf8');
mkdirSync('public/icons', { recursive: true });

for (const [name, size, source] of [
  ['icon-192.png', 192, svg],
  ['icon-512.png', 512, svg],
  ['icon-maskable-512.png', 512, maskable(svg)],
]) {
  const png = render(source, size);
  writeFileSync(`public/icons/${name}`, png);
  console.log(`public/icons/${name}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
