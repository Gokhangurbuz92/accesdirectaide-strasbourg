/**
 * G12: every admin menu label goes through navLabel (otherwise it stays French in en/de/tr/ar/uk) — « Rédaction des actualités » had no entry.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('src/pages/admin/AdminLayout.jsx', 'utf8');
const labels = [...src.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
const body = src.slice(src.indexOf('function navLabel'));
const mapped = new Set([...body.matchAll(/^\s+'([^']+)': t\('/gm)].map((m) => m[1]));

describe('G12: admin menu fully translated', () => {
  it('every menu and section label has a navLabel entry', () => {
    expect(labels.length).toBeGreaterThan(20);
    expect(labels.filter((l) => !mapped.has(l))).toEqual([]);
  });
});
