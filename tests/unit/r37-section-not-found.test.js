/**
 * R37 — browser journeys (scripts/acceptance/r37-browser-journeys.mjs, journey 6): an unknown /admin/… or /pro/… page rendered an empty screen, with or
 * without a session; the public block already had a catch-all. Each section's Routes now ends with the friendly 404.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('unknown pages in the admin and pro sections', () => {
  it('every <Routes> block of the app ends with a catch-all 404', () => {
    const src = readFileSync('src/pages/index.jsx', 'utf8');
    const blocks = src.split(/<Routes[^>]*>/).slice(1).map((b) => b.split('</Routes>')[0]);
    const big = blocks.filter((b) => (b.match(/<Route /g) || []).length > 5);
    expect(big.length).toBeGreaterThanOrEqual(3);
    for (const b of big) expect(b.trimEnd()).toMatch(/<Route path="\*" element=\{<ServiceError code=\{404\} \/>\} \/>$/);
  });
});
