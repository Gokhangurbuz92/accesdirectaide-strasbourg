/**
 * Extension R32 — integrity of the social-sector reference (data/reference/social-domains.v1.json) and of its measured coverage: stable unique
 * ids, every mapping points to an EXISTING classification of the product (public categories, home situations, ADA Pro orientation needs, seed
 * needs, search-lexicon concepts), emergency numbers only from the verified list, and a coverage file that matches the reference version.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SITUATIONS } from '../../src/config/situations.js';
import * as orientation from '../../src/config/orientationNeeds.js';

const ref = JSON.parse(fs.readFileSync('data/reference/social-domains.v1.json', 'utf8'));
const cov = JSON.parse(fs.readFileSync('data/reference/social-coverage.v1.json', 'utf8'));
const taxonomy = JSON.parse(fs.readFileSync('api/data/taxonomy.json', 'utf8')).map((x) => x.slug || x.id);
const seed = fs.readFileSync('scripts/seed-taxonomy.ts', 'utf8');
const lexicon = JSON.parse(fs.readFileSync('data/i18n/search-lexicon.json', 'utf8')).concepts.map((c) => c.id);
const orientationCodes = JSON.stringify(orientation);

describe('social-sector reference', () => {
  const subs = ref.domains.flatMap((d) => d.subdomains);
  it('has stable, unique, slug-shaped ids and the domains A to T', () => {
    const ids = [...ref.domains.map((d) => d.id), ...subs.map((s) => s.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(ref.domains.map((d) => d.letter).join('')).toBe('ABCDEFGHIJKLMNOPQRST');
    expect(ref.version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
  it('maps every domain to classifications that exist in the product (backward compatibility, no invented code)', () => {
    for (const d of ref.domains) {
      for (const t of d.legacy.taxonomy) expect(taxonomy, `${d.id} taxonomy ${t}`).toContain(t);
      for (const s of d.legacy.situation) expect(SITUATIONS.map(([label]) => label), `${d.id} situation ${s}`).toContain(s);
      for (const o of d.legacy.orientation) expect(orientationCodes, `${d.id} orientation ${o}`).toContain(`"${o}"`);
      for (const n of d.legacy.need) expect(seed, `${d.id} need ${n}`).toContain(`slug: '${n}'`);
      for (const c of d.lexicon) expect(lexicon, `${d.id} lexicon ${c}`).toContain(c);
    }
  });
  it('every subdomain has search words, and emergency numbers only from the verified list (3977 is replaced by 3133)', () => {
    for (const s of subs) {
      expect(s.keywords.length, s.id).toBeGreaterThan(0);
      for (const n of s.emergency) expect(Object.keys(ref.emergency), `${s.id} ${n}`).toContain(n);
      for (const c of s.casf) expect(c).toBeGreaterThanOrEqual(1), expect(c).toBeLessThanOrEqual(18);
    }
    expect(Object.keys(ref.emergency)).not.toContain('3977');
  });
  it('the measured coverage matches this reference and uses only explicit statuses', () => {
    expect(cov.reference).toBe(ref.version);
    expect(cov.rows.map((r) => r.subdomain).sort()).toEqual(subs.map((s) => s.id).sort());
    for (const r of cov.rows) expect(['COVERED_VERIFIED', 'PARTIALLY_COVERED', 'TAXONOMY_ONLY']).toContain(r.status);
    expect(cov.totals.subdomains).toBe(subs.length);
  });
});
