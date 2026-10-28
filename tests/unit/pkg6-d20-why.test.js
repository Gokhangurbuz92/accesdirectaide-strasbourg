import { describe, expect, it } from 'vitest';
import { buildAssessment, engineUnavailableAssessment, STATES } from '../../api/lib/assessmentContract.js';
import { MISSING_FACT_LABELS, shareableResults } from '../../src/lib/assessmentLabels.js';

const FULL = { birthDate: '1990-01-01', householdSize: 2, income: { salary: 900 }, housing: { status: 'locataire', rent: 512 }, territory: '67000' };
const all = (a) => a.items;

describe('PKG-6 / D20 — « why this result » for every state, standard and FALC, with rule and source status', () => {
  it('every item of every state carries whyFr + whyFalc that state the rule and the source status (none validated / none official while D11 is open)', () => {
    const items = [...all(buildAssessment({ answers: FULL })), ...all(buildAssessment({ answers: {} })), ...all(buildAssessment({ answers: { ...FULL, territory: '75001' } })),
      ...all(buildAssessment({ answers: FULL, unsupportedRights: [{ code: 'apa', label: 'APA' }] })), ...all(engineUnavailableAssessment())];
    const states = new Set(items.map((i) => i.state));
    for (const s of [STATES.CHECK_REQUIRED, STATES.MISSING_INFORMATION, STATES.UNSUPPORTED, STATES.ENGINE_UNAVAILABLE]) expect(states.has(s), s).toBe(true);
    for (const i of items) {
      expect(typeof i.whyFr === 'string' && i.whyFr.length > 20, i.code).toBe(true);
      expect(typeof i.whyFalc === 'string' && i.whyFalc.length > 15, i.code).toBe(true);
      if (i.state !== STATES.ENGINE_UNAVAILABLE) { expect(i.whyFr).toMatch(/source officielle/); expect(i.whyFalc).toMatch(/source officielle/); }
      if (i.state === STATES.CHECK_REQUIRED) { expect(i.whyFr).toMatch(/Aucune règle validée/); expect(i.whyFalc).toMatch(/règle validée/); }
    }
  });

  it('the answers used are named by label only: no value of the person ever appears in the explanation', () => {
    const a = buildAssessment({ answers: FULL });
    const rsa = a.items.find((i) => i.code === 'rsa');
    expect(rsa.basisFacts).toEqual(['birthDate', 'householdSize', 'income']);
    expect(rsa.whyFr).toContain('composition du foyer'); expect(rsa.whyFalc).toContain('revenus');
    const text = JSON.stringify(a.items.map((i) => [i.whyFr, i.whyFalc]));
    for (const v of ['1990', '900', '512', '67000', 'locataire']) expect(text).not.toContain(v);
  });

  it('missing information names what is missing; the facts already given are listed as used', () => {
    const a = buildAssessment({ answers: { birthDate: '1990-01-01' } });
    const rsa = a.items.find((i) => i.code === 'rsa');
    expect(rsa.state).toBe(STATES.MISSING_INFORMATION);
    expect(rsa.basisFacts).toEqual(['birthDate']);
    expect(rsa.whyFalc).toContain('composition du foyer, revenus');
  });

  it('the contract labels equal the UI labels (the contract module cannot import them)', () => {
    const a = buildAssessment({ answers: {} });
    for (const [k, label] of Object.entries(MISSING_FACT_LABELS)) {
      const it = a.items.find((i) => i.missingFacts.includes(k));
      if (it) expect(it.whyFr).toContain(label);
    }
  });

  it('the explanations travel with a shared result (PDF / share link)', () => {
    const r = shareableResults({ assessment: buildAssessment({ answers: FULL }) });
    const rsa = r.assessment.items.find((i) => i.code === 'rsa');
    expect(rsa.whyFalc).toMatch(/ADA a lu vos réponses/); expect(rsa.basisFacts).toEqual(['birthDate', 'householdSize', 'income']);
  });
});

describe('PKG-6 / D20 — stored shares keep the explanation under the same rules as the rest of the item', async () => {
  const { sanitizeResultsForStorage } = await import('../../api/lib/shareResults.js');
  it('a current payload keeps whyFr / whyFalc / basisFacts; unknown fact keys are dropped; a pre-D20 payload gets the texts recomputed; forbidden wording is refused', () => {
    const a = buildAssessment({ answers: FULL });
    const ok = sanitizeResultsForStorage({ assessment: { ...a, items: a.items.map((i) => ({ ...i, basisFacts: [...i.basisFacts, 'iban'] })) } });
    expect(ok.ok).toBe(true);
    const rsa = ok.value.assessment.items.find((i) => i.code === 'rsa');
    expect(rsa.basisFacts).toEqual(['birthDate', 'householdSize', 'income']); expect(rsa.whyFalc).toBe(a.items.find((i) => i.code === 'rsa').whyFalc);
    const old = sanitizeResultsForStorage({ assessment: { ...a, items: a.items.map(({ whyFr, whyFalc, basisFacts, ...rest }) => rest) } });
    expect(old.ok).toBe(true); expect(old.value.assessment.items[0].whyFalc).toMatch(/source officielle/);
    const bad = sanitizeResultsForStorage({ assessment: { ...a, items: a.items.map((i) => ({ ...i, whyFalc: 'Vous avez droit au RSA.' })) } });
    expect(bad).toEqual({ ok: false, reason: 'invalid_assessment' });
  });
});
