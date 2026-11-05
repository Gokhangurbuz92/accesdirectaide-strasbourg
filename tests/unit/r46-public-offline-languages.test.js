/**
 * R46 / M01 — the static offline page says its message in the six interface languages (it loads nothing, so it cannot know the chosen one):
 * French first (the page language), then en tr ar de uk, each marked with its lang (Arabic right to left), with the same five emergency numbers.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('R46 M01 offline page languages', () => {
  const html = fs.readFileSync('public/offline.html', 'utf8');
  it('marks each other language and keeps the page static', () => {
    for (const l of ['en', 'tr', 'de', 'uk']) expect(html).toMatch(new RegExp(`<div lang="${l}"><h2>`));
    expect(html).toMatch(/<div lang="ar" dir="rtl"><h2>/);
    expect(html).not.toMatch(/<script|src=|@import|https?:\/\//i);
  });
  it('every language names the same five numbers', () => {
    const blocks = [...html.matchAll(/<div lang="([a-z]{2})"[^>]*>([\s\S]*?)<\/div>/g)];
    expect(blocks.map((b) => b[1])).toEqual(['en', 'tr', 'ar', 'de', 'uk']);
    for (const [, , body] of blocks) for (const n of ['112', '15', '17', '18', '115']) expect(body).toContain(n);
  });
});
