/**
 * R15 (D10 / D20 / P13; owner directive 27/10/2026 § 4) — a real engine value is not an entitlement. These checks hold the line the R14 real-engine runs drew:
 * the form does not describe a spouse, children's ages, pensions, the MDPH rate, the unemployment history, the other parent or the tax reference income, and
 * buildTestCase fills those with defaults — so no amount may come out of them. Pure units on api/lib/openfiscaEstimate.js.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { missingInputs, qualifyEstimates, traceQualification, ESTIMATE_CONTRACT } from '../../api/lib/openfiscaEstimate.js';
import { RIGHTS_CATALOG } from '../../api/lib/openfiscaRightsCatalog.js';

const ONE = { birthDate: '1985-02-01', statut: 'salarié', householdSize: 1, income: { salary: 1200 }, housing: { status: 'tenant', rent: 520 }, depcom: '67482' };
const rights = (amounts) => RIGHTS_CATALOG.map((r) => ({ code: r.code, label: r.label, category: r.category, amount: amounts[r.code] ?? 0 }));
const by = (est) => Object.fromEntries(est.items.map((i) => [i.code, i]));

describe('R15: OpenFisca output is qualified, never asserted', () => {
  it('every catalogue right gets a status; the response has no « eligible » flag nor exact amount', () => {
    const est = qualifyEstimates(rights({ rsa: 123.45, apl: 287.6 }), ONE, { period: '2026-10', engineVersion: '176.1.6' });
    expect(est).toMatchObject({ contract: ESTIMATE_CONTRACT, authoritative: false, period: '2026-10', engine: { name: 'openfisca-france', version: '176.1.6' } });
    expect(est.items).toHaveLength(RIGHTS_CATALOG.length);
    expect(JSON.stringify(est)).not.toMatch(/"eligible"|"amount"|123\.45|287\.6|vous avez droit/i);
    expect(by(est).apl).toMatchObject({ status: 'INDICATIVE_ESTIMATE', monthlyOrderOfMagnitude: 290 });
    expect(by(est).rsa).toMatchObject({ status: 'INDICATIVE_ESTIMATE', monthlyOrderOfMagnitude: 120 });
  });

  it('a couple, or children without ages, is never computed from defaults: household rights are INSUFFICIENT_INFORMATION', () => {
    for (const answers of [{ ...ONE, householdSize: 2 }, { ...ONE, situation_familiale: 'couple' }, { ...ONE, householdSize: 3, nombre_enfants: 2 }, { ...ONE, householdSize: undefined }]) {
      const m = missingInputs(answers);
      for (const code of ['rsa', 'prime_activite', 'apl', 'aide_logement', 'css', 'af', 'cf']) expect(m[code], `${code} ${JSON.stringify(answers)}`).toContain('household');
    }
    // children with known ages and a matching household size are described
    expect(missingInputs({ ...ONE, householdSize: 3, nombre_enfants: 2, enfants: [{ age: 4 }, { date_naissance: '2012-05-01' }] }).af).toEqual([]);
  });

  it('a retired person is never estimated without the pension amount (the form does not ask for it): ASPA and the means-tested rights are withheld', () => {
    const m = missingInputs({ ...ONE, statut: 'retraité' });
    for (const code of ['aspa', 'rsa', 'prime_activite', 'apl', 'aide_logement', 'css']) expect(m[code], code).toContain('pension');
    expect(missingInputs(ONE).aspa).toContain('pension');   // ASPA always needs it
  });

  it('rights whose decisive input the form never asks are always withheld, whatever the engine says', () => {
    const est = by(qualifyEstimates(rights({ aah: 1033.32, ass: 545, asf: 199.19, bourse_college: 50 }), ONE, { period: '2026-10' }));
    expect(est.aah.missing.map((x) => x.key)).toEqual(['disabilityRate']);
    expect(est.ass.missing.map((x) => x.key)).toEqual(['unemploymentHistory']);
    expect(est.asf.missing.map((x) => x.key)).toEqual(['otherParent']);
    expect(est.bourse_college.missing.map((x) => x.key)).toEqual(['taxReference']);
    for (const c of ['aah', 'ass', 'asf', 'bourse_college']) expect(est[c]).toMatchObject({ status: 'INSUFFICIENT_INFORMATION', monthlyOrderOfMagnitude: null });
  });

  it('housing aid needs a tenancy with a rent and an INSEE commune; an unknown statut or a blank income is missing, an explicit 0 is known', () => {
    expect(missingInputs({ ...ONE, depcom: undefined }).apl).toEqual(['commune']);
    expect(missingInputs({ ...ONE, depcom: '67000x' }).apl).toEqual(['commune']);
    expect(missingInputs({ ...ONE, housing: { status: 'owner', rent: 0 } }).aide_logement).toEqual(['housing']);
    expect(missingInputs({ ...ONE, statut: 'chomeur' }).rsa).toEqual(['statut']);
    expect(missingInputs({ ...ONE, income: {} }).rsa).toEqual(['income']);
    expect(missingInputs({ ...ONE, income: { salary: 0 } }).rsa).toEqual([]);
  });

  it('a zero under complete inputs is « not indicated », never « not eligible »; a small positive value is never rounded to 0', () => {
    const est = by(qualifyEstimates(rights({ rsa: 0, prime_activite: 3 }), ONE, { period: '2026-10' }));
    expect(est.rsa).toMatchObject({ status: 'NOT_INDICATED_UNDER_ASSUMPTIONS', monthlyOrderOfMagnitude: null });
    expect(est.prime_activite).toMatchObject({ status: 'INDICATIVE_ESTIMATE', monthlyOrderOfMagnitude: 10 });
  });

  it('assumptions, date of calculation and an undeclared engine version are explicit', () => {
    const est = qualifyEstimates(rights({}), ONE, { period: '2026-10', computedAt: '2026-10-27T10:00:00.000Z' });
    expect(est.engine.version).toBeNull();
    expect(est.computedAt).toBe('2026-10-27T10:00:00.000Z');
    expect(est.assumptions.join(' ')).toMatch(/24 mois/);
    expect(est.assumptions.join(' ')).toMatch(/borne basse/);
    expect(est.disclaimer).toMatch(/ni une décision ni une promesse/);
  });

  it('the pro trace is marked as a technical trace computed on defaults, with the missing inputs per right', () => {
    const t = traceQualification({ ...ONE, householdSize: 2 }, { period: '2026-10', engineVersion: null });
    expect(t).toMatchObject({ contract: ESTIMATE_CONTRACT, authoritative: false, technicalTraceOnly: true, engine: { version: null } });
    expect(t.missingByRight.rsa).toContain('household');
    expect(t.notice).toMatch(/valeurs par défaut/);
    expect(readFileSync('api/_handlers/diagnostic.js', 'utf8')).toMatch(/\.\.\.traceQualification\(answers/);
  });
});
