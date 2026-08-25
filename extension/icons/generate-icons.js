#!/usr/bin/env node
/**
 * Regenerates extension/icons/icon{16,48,128}.png from icon.svg.
 *
 * Requires the "sharp" devDependency (see repo package.json):
 *   npm install
 *   node extension/icons/generate-icons.js
 *
 * The PNGs committed to this repo are the direct, reproducible output of this
 * script — re-run it any time icon.svg changes instead of hand-editing PNGs.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch (err) {
  console.error(
    'Missing dependency "sharp". Run `npm install` from the repo root first.'
  );
  process.exit(1);
}

const SIZES = [16, 48, 128];
const SVG_PATH = path.join(__dirname, 'icon.svg');
const svgBuffer = fs.readFileSync(SVG_PATH);

for (const size of SIZES) {
  const outPath = path.join(__dirname, `icon${size}.png`);
  // density controls the rasterization resolution the SVG is sampled at
  // before resizing down to `size`, so edges stay clean instead of
  // aliasing straight from a tiny intermediate raster.
  await sharp(svgBuffer, { density: 384 }).resize(size, size).png().toFile(outPath);
  console.log(`wrote ${outPath}`);
}
