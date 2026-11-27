import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { buildAbsoluteImageUrl } from '@/lib/seo';

// 27/11: the link preview (LinkedIn, Facebook, messaging apps) showed the retired sun/road mark.
// Crawlers read the static index.html without JavaScript, need an absolute URL and handle webp poorly.
describe('R8 link preview image', () => {
  const html = readFileSync('index.html', 'utf8');

  it('static og:image and twitter:image are the absolute PNG', () => {
    expect(html).toContain('<meta property="og:image" content="https://www.accesdirectaide.fr/og-image.png" />');
    expect(html).toContain('<meta name="twitter:image" content="https://www.accesdirectaide.fr/og-image.png" />');
    expect(html).toMatch(/og:image:width" content="1200"/);
    expect(html).toMatch(/og:image:height" content="630"/);
    expect(html).toMatch(/og:image:alt" content="[^"]+"/);
    expect(html).not.toMatch(/content="\/og-[a-z-]+\.webp"/);
  });

  it('the PNG exists with 1200×630 dimensions', () => {
    expect(existsSync('public/og-image.png')).toBe(true);
    const b = readFileSync('public/og-image.png');
    expect(b.readUInt32BE(16)).toBe(1200);
    expect(b.readUInt32BE(20)).toBe(630);
  });

  it('page-level default image is the same PNG', () => {
    expect(buildAbsoluteImageUrl()).toMatch(/\/og-image\.png$/);
    expect(readFileSync('src/components/SEO.jsx', 'utf8')).toContain("const DEFAULT_IMAGE = '/og-image.png';");
  });
});
