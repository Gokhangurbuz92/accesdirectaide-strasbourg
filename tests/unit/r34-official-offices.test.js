/**
 * R34 / D16 — the offices an official Service-Public sheet says to go to (OuSAdresser / PivotLocal) are offered by the search when the best guide's title
 * matches the query. The mapping file is generated from the DILA archive, never written by hand.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { PIVOT_TYPES, guideOffices } from '../../api/lib/official-offices.js';
import { OFFICIAL_GUIDES } from '../../scripts/official-guides.mjs';

const file = JSON.parse(fs.readFileSync('data/reference/guide-offices.v1.json', 'utf8'));
describe('official offices per guide', () => {
  it('the file is generated from the archive: every entry is a curated sheet, every type comes from the pivot mapping of its pivots', () => {
    expect(file.schema).toBe('ada-guide-offices/1');
    expect(file.archiveBuiltAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const curated = new Set(OFFICIAL_GUIDES.map((g) => g.id));
    for (const [id, v] of Object.entries(file.sheets)) {
      expect(curated.has(id), id).toBe(true);
      expect(v.types).toEqual([...new Set(v.pivots.flatMap((p) => PIVOT_TYPES[p] || []))]);
    }
    expect(file.sheets.F2094.types).toContain('Point-justice (accès au droit)');   // curatelle → the justice access points the sheet names
  });
  it('the runtime reader returns the sheets, and an unreadable file means none (no crash)', () => {
    expect(guideOffices().F12544.types).toContain('CIDFF (droits des femmes et des familles)');
  });
  it('the search uses it only behind the title match, never against a named office type or a victim-office danger signal', () => {
    const src = fs.readFileSync('api/_handlers/search.js', 'utf8');
    expect(src).toMatch(/Number\(top\.title_hits\) > 0 && !structureTypeHint\(payload\.query\) && !\(safety && safety\.structureTypes\.length\)/);
  });
});
