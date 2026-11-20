/**
 * G12 / M03 « now » step: the iOS home-screen icon exists (180×180 PNG, opaque) and index.html links it.
 */
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

describe('G12: apple-touch-icon', () => {
  it('index.html links a 180×180 opaque PNG that exists in public/', async () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />');
    const meta = await sharp('public/icons/apple-touch-icon.png').metadata();
    expect([meta.format, meta.width, meta.height, meta.hasAlpha]).toEqual(['png', 180, 180, false]);
  });
});
