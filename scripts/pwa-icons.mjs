#!/usr/bin/env node
/**
 * PKG-9 / M01 — install icons rasterized from public/logo.svg (the existing brand mark; no new artwork): icon-192.png and icon-512.png (purpose « any ») and
 * icon-maskable-512.png (the mark inside the 80 % safe zone on the logo's own background, purpose « maskable »). Re-run after a logo change: node scripts/pwa-icons.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public/logo.svg');
const OUT = path.join(ROOT, 'public/icons');
const BG = '#FDFEFD';   // the logo's own background rectangle

for (const size of [192, 512]) {
  await sharp(SRC, { density: 300 }).resize(size, size, { fit: 'contain', background: BG }).flatten({ background: BG }).png({ compressionLevel: 9 }).toFile(path.join(OUT, `icon-${size}.png`));
}
const inner = Math.round(512 * 0.8);
const mark = await sharp(SRC, { density: 300 }).resize(inner, inner, { fit: 'contain', background: BG }).flatten({ background: BG }).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 3, background: BG } }).composite([{ input: mark, gravity: 'centre' }]).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'icon-maskable-512.png'));
process.stdout.write('public/icons written\n');
