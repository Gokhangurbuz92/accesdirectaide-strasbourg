/**
 * WS2: structures proven closed by an official source must never be launch-eligible.
 * France Travail press release (file date 2026-02-16): the Strasbourg "Seyboth" agency closed on 2026-03-03
 * (activity moved to Lingolsheim and Pont Matthis). Evidence: docs/release/ws2/WS2_OFFICIAL_EVIDENCE_FINDINGS.md.
 * Un-quarantining requires a newer official source, not a test edit.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CLOSED_SLUGS = ['agence-france-travail-strasbourg-seyboth-a71a98da'];

describe('WS2 closed-agency quarantine', () => {
  const lines = readFileSync('data/structures-alsace.csv', 'utf8').split('\n').filter(Boolean);
  for (const slug of CLOSED_SLUGS) {
    it(`${slug} is present but neither verifiedCurrent nor launchEligible`, () => {
      const row = lines.find((l) => l.includes(`,${slug},`));
      expect(row, 'row kept for audit, not deleted').toBeTruthy();
      expect(row.endsWith(',false,false')).toBe(true);
    });
  }
});
