/**
 * FA-D6 (18/11/2026) — DEFECT: the « trêve hivernale » rule of the orientation (api/lib/multi-need.js) was read on the UTC month. The period is
 * « du 1er novembre au 31 mars (inclus) de l'année suivante » (F34736, F20055, DILA archive of 17/11/2026), a French calendar period: between 00:00 and
 * 01:00 (winter time) / 02:00 (summer time) Paris, the UTC day is still the previous one, so the first hour of 1 November showed the rule as not in force
 * and the first two hours of 1 April showed it as still in force.
 */
import { describe, expect, it } from 'vitest';
import { analyseNeeds } from '../../api/lib/multi-need.js';

const inForce = (iso) => analyseNeeds(['loyers impayés, risque d’expulsion'], { now: new Date(iso) }).needs.find((n) => n.id === 'expulsion-impayes').rules[0].inForceNow;

describe('trêve hivernale — Paris calendar boundaries', () => {
  it('1 November 00:30 Paris (31 October 23:30 UTC) is inside the period', () => {
    expect(inForce('2026-10-31T23:30:00Z')).toBe(true);
  });
  it('31 October 23:30 Paris (22:30 UTC) is outside', () => {
    expect(inForce('2026-10-31T22:30:00Z')).toBe(false);
  });
  it('31 March 23:59 Paris (21:59 UTC, summer time) is inside — « 31 mars (inclus) »', () => {
    expect(inForce('2027-03-31T21:59:00Z')).toBe(true);
  });
  it('1 April 00:30 Paris (31 March 22:30 UTC, summer time) is outside', () => {
    expect(inForce('2027-03-31T22:30:00Z')).toBe(false);
  });
});
