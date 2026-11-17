/**
 * C11 / D09 — the 173-row « API Particulier connector » as the owner narrowed it on 21/10/2026 (OWNER_SCOPE_REVISION_STRASBOURG_2026-10-21.md, module 18;
 * STRASBOURG_SCOPE_REVISION_2026-10-21.csv row D09):
 *   deferred : automatic personal-data retrieval from API Particulier, live connection, activation campaign;
 *   kept     : existing technical preparation; information collected through the secure forms; data minimisation and user control.
 * This guard makes the narrowed row checkable in code: (1) no API Particulier client or endpoint exists anywhere the product runs (a live connection needs a
 * habilitation, E-05, and a new owner decision); (2) the secure forms keep the minimisation evidence of the row (DTA-B11: an age band instead of a date of birth).
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { AGE_BAND_KEYS, ageFromBand } from '../../api/lib/ageBands.js';

describe('D09 (narrowed) — no API Particulier retrieval; the forms collect the minimum', () => {
  it('no API Particulier client, endpoint or credential name in api/, src/, scripts/, middleware or vercel.json', () => {
    let out = '';
    try {
      out = execFileSync('git', ['grep', '-n', '-i', '-E', 'particulier\\.api\\.gouv\\.fr|api[-_.]?particulier|API_PARTICULIER', '--', 'api', 'src', 'scripts', 'middleware.js', 'vercel.json', 'packages'], { encoding: 'utf8' });
    } catch (e) { if (/** @type {any} */ (e).status !== 1) throw e; }   // git grep exits 1 when nothing matches
    // the only allowed mention: the activation simulator's statement that there is nothing to activate
    const lines = out.split('\n').filter(Boolean).filter((l) => !l.startsWith('scripts/activation-simulator.mjs:'));
    expect(lines).toEqual([]);
  });
  it('the diagnostic accepts an age band from a closed vocabulary instead of a date of birth (DTA-B11 minimisation)', () => {
    expect(AGE_BAND_KEYS.length).toBeGreaterThan(0);
    for (const k of AGE_BAND_KEYS) expect(ageFromBand(k)).toEqual(expect.any(Number));
    for (const bad of ['1990-01-01', '42', '', null, undefined, '__proto__', 'toString']) expect(ageFromBand(bad)).toBeNull();
  });
});
