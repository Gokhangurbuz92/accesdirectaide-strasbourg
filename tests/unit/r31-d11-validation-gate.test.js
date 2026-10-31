/**
 * R31 — D11 → D20 → P13: the expert-validation gate (api/lib/validatedRules.js), the review form (scripts/d11-review.mjs) and the diagnostic chain
 * input → validation → rule reading → classification → explanation → official source → next step. Today no right is validated, so results are unchanged;
 * the synthetic reviews below exist only in this test (the committed register stays RESEARCHED_UNVALIDATED, pinned by pkg6-d11-rules-draft).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { validatedReadings, validatedRight, factsFromAnswers } from '../../api/lib/validatedRules.js';
import { applyForm, evaluateForm, parseCsv, renderForm } from '../../scripts/d11-review.mjs';
import { simulationResponse } from '../../api/lib/diagnosticAssessment.js';
import { assertAssessmentItem, buildAssessment, STATES } from '../../api/lib/assessmentContract.js';
import { pageVerifiedOn } from '../../scripts/d11-source-check.mjs';

const reg = JSON.parse(fs.readFileSync('data/rules/rights-rules.v1.json', 'utf8'));
const proposed = JSON.parse(fs.readFileSync('data/rules/reference-cases.proposed.v1.json', 'utf8'));
const blank = () => parseCsv(renderForm(reg, proposed));
const reviewer = { reviewer_name: 'Experte fictive (test)', reviewer_role: 'juriste en droit social (fictif)', review_date: '2026-11-15' };
/** a synthetic review that accepts everything of one right */
const acceptAll = (right) => blank().map((r) => (r.right !== right ? r : { ...r, ...reviewer, decision: r.item_type === 'ambiguity' ? 'DECIDED' : 'ACCEPT', correction_or_decision: r.item_type === 'ambiguity' ? 'tranché (test)' : '' }));
const FULL = { birthDate: '1990-01-01', householdSize: 2, income: { salary: 900 }, housing: { status: 'tenant', rent: 512 }, territory: '67000' };

describe('D11 gate — today', () => {
  it('no right passes: no reading reaches a result, and the diagnostic answer is unchanged', () => {
    for (const r of reg.rights) expect(validatedRight(reg, r.id)).toBeNull();
    expect(validatedReadings(reg, FULL)).toEqual({});
    const sim = { mode: 'SIMULATION_MODE', rights: [], meta: {} };
    expect(simulationResponse(sim, FULL, {}, validatedReadings(reg, FULL))).toEqual(simulationResponse(sim, FULL, {}));
  });
  it('the committed blank form matches the register (re-run: node scripts/d11-review.mjs form > docs/rules/D11_REVIEW_FORM.csv)', () => {
    expect(fs.readFileSync('docs/rules/D11_REVIEW_FORM.csv', 'utf8')).toBe(renderForm(reg, proposed));
    const rows = blank();
    expect(rows.filter((r) => r.item_type === 'case')).toHaveLength(proposed.cases.length);
    expect(rows.filter((r) => r.item_type === 'condition')).toHaveLength(reg.rights.reduce((n, r) => n + r.conditions.length, 0));
  });
  it('a blank form validates nothing and changes nothing', () => {
    const res = evaluateForm(reg, proposed, blank());
    expect(res.every((r) => !r.validated)).toBe(true);
    expect(applyForm(reg, res)).toEqual(reg);
  });
});

describe('D11 gate — what a review must contain', () => {
  it('a complete acceptance by one named reviewer validates the right, and the product’s own gate agrees', () => {
    const res = evaluateForm(reg, proposed, acceptAll('apl'));
    const apl = res.find((r) => r.right === 'apl');
    expect(apl.open).toEqual([]);
    const next = applyForm(reg, res);
    expect(next.rights.find((r) => r.id === 'apl')).toMatchObject({ status: 'EXPERT_VALIDATED', expertReview: { name: reviewer.reviewer_name, date: '2026-11-15' } });
    expect(validatedRight(next, 'apl')).not.toBeNull();
    expect(next.rights.filter((r) => r.status === 'EXPERT_VALIDATED').map((r) => r.id)).toEqual(['apl']);
  });
  it('one condition to correct, an undecided ambiguity, two reviewers or no accepted case: nothing is validated', () => {
    const corrected = acceptAll('apl').map((r) => (r.right === 'apl' && r.item_type === 'condition' ? { ...r, decision: 'CORRECT', correction_or_decision: 'préciser la sous-location' } : r));
    expect(evaluateForm(reg, proposed, corrected).find((r) => r.right === 'apl').open.join(' ')).toContain('à corriger');
    const undecided = acceptAll('apl').map((r) => (r.item_type === 'ambiguity' ? { ...r, decision: '' } : r));
    expect(evaluateForm(reg, proposed, undecided).find((r) => r.right === 'apl').validated).toBe(false);
    let first = true;
    const two = acceptAll('apl').map((r) => { if (r.right !== 'apl') return r; const o = first ? { ...r, reviewer_name: 'Autre personne' } : r; first = false; return o; });
    expect(evaluateForm(reg, proposed, two).find((r) => r.right === 'apl').open.join(' ')).toContain('plusieurs relecteurs');
    const noCase = acceptAll('apl').map((r) => (r.item_type === 'case' ? { ...r, decision: 'REJECT' } : r));
    expect(evaluateForm(reg, proposed, noCase).find((r) => r.right === 'apl').open).toContain('aucun cas de référence accepté');
  });
  it('a later edit of a condition that breaks an accepted case closes the gate again', () => {
    const next = applyForm(reg, evaluateForm(reg, proposed, acceptAll('rsa')));
    expect(validatedRight(next, 'rsa')).not.toBeNull();
    const tampered = JSON.parse(JSON.stringify(next));
    tampered.rights.find((r) => r.id === 'rsa').conditions.find((c) => c.fact === 'age').draftCheck.min = 30;
    expect(validatedRight(tampered, 'rsa')).toBeNull();
  });
});

describe('P13 — the whole chain once a right is validated (synthetic review)', () => {
  const validated = applyForm(reg, evaluateForm(reg, proposed, acceptAll('rsa')));
  it('input → reading → classification → explanation → official source → next step; never a decision, never a value of the person', () => {
    const readings = validatedReadings(validated, FULL, '2026-11-20');
    expect(Object.keys(readings)).toEqual(['rsa']);
    const a = buildAssessment({ answers: FULL, ruleReadings: readings });
    const rsa = a.items.find((i) => i.code === 'rsa');
    assertAssessmentItem(rsa);
    expect(rsa.state).toBe(STATES.CHECK_REQUIRED);                       // residence, resources, nationality… cannot be read from the answers
    expect(rsa.authoritative).toBe(false);
    expect(rsa.amount).toBeNull();
    expect(rsa.explanation).toContain('Vos réponses ne permettent pas de vérifier');
    expect(rsa.provenance.rule).toContain('relue par juriste en droit social (fictif) le 15/11/2026');
    expect(rsa.provenance.source).toContain('https://www.service-public.gouv.fr/particuliers/vosdroits/F19778 (page vérifiée le 01/04/2026)');
    expect(rsa.whyFr).toContain('Repère utilisé : règle « RSA');
    expect(rsa.whyFr).toContain('Source : https://www.service-public.gouv.fr/');
    expect(rsa.whoToAsk).toBe('votre CAF');
    for (const v of ['1990', '900', '512', '67000']) expect(JSON.stringify(rsa)).not.toContain(v);
    // the other rights are untouched
    expect(a.items.find((i) => i.code === 'apl').provenance.source).toBeNull();
  });
  it('an unmet condition stays a check, not a refusal; missing answers still ask for the answers first', () => {
    const young = validatedReadings(validated, { ...FULL, birthDate: '2010-01-01' }, '2026-11-20');
    const rsa = buildAssessment({ answers: { ...FULL, birthDate: '2010-01-01' }, ruleReadings: young }).items.find((i) => i.code === 'rsa');
    expect(rsa.state).toBe(STATES.CHECK_REQUIRED);
    expect(rsa.explanation).not.toMatch(/éligible|non applicable|avez droit/i);
    const missing = buildAssessment({ answers: { birthDate: '1990-01-01' }, ruleReadings: validatedReadings(validated, { birthDate: '1990-01-01' }) }).items.find((i) => i.code === 'rsa');
    expect(missing.state).toBe(STATES.MISSING_INFORMATION);
  });
  it('facts are derived from the answers (exact age or age band)', () => {
    expect(factsFromAnswers({ birthDate: '2000-06-15' }, '2026-06-14').ageRange).toEqual([25, 25]);
    expect(factsFromAnswers({ birthDate: '2000-06-15' }, '2026-06-15').ageRange).toEqual([26, 26]);
    expect(factsFromAnswers({ ageBand: '18-24' }).ageRange).toEqual([18, 24]);
  });
});

describe('form and source tooling', () => {
  it('the CSV reader handles quotes, commas and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, ""y""",2\r\n')).toEqual([{ a: 'x, "y"', b: '2' }]);
  });
  it('reads a Service-Public page date', () => {
    expect(pageVerifiedOn('<p>Vérifié le 01 avril 2026 - Direction de l’information légale</p>')).toBe('2026-04-01');
    expect(pageVerifiedOn('<p>Vérifié le 14&nbsp;septembre 2026</p>')).toBe('2026-09-14');
    expect(pageVerifiedOn('<p>rien</p>')).toBeNull();
  });
});
