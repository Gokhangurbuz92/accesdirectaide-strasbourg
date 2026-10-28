/**
 * DTA S2A — A5 "account-free plan d'action" (PRODUCT_FLOW_CONTRACT A5, N11, N13, N16; NORMATIVE_RECONCILIATION C2/C3).
 * Built ONLY from the assessment states (never creates or changes a state), no persistence, no account, no deadline, no reminder, no URL/phone/address that is not an internal ADA route,
 * documents: none invented ("liste à confirmer auprès de l'organisme").  Named "Plan d'action", never "Mon Parcours".
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAssessment } from '../../api/lib/assessmentContract.js';
import { UNSUPPORTED_RIGHTS } from '../../api/lib/diagnosticAssessment.js';
import { PLAN_CONTRACT, buildActionPlan, planTextLines } from '../../src/lib/actionPlan.js';
import { findProhibitedDecisionWording } from '../helpers/decision-wording.js';

const results = (answers, extra = {}) => ({ assessment: buildAssessment({ answers, unsupportedRights: UNSUPPORTED_RIGHTS, ...extra }) });
const A = { birthDate: '1992-03-10', householdSize: 1, territory: '67000', income: { unemployment: 700 }, housing: { status: 'tenant', rent: 480 } };
const strings = (o, out = []) => { if (typeof o === 'string') out.push(o); else if (Array.isArray(o)) o.forEach((x) => strings(x, out)); else if (o && typeof o === 'object') Object.values(o).forEach((x) => strings(x, out)); return out; };
const ALL = (plan) => strings(plan).join('\n');
const FORBIDDEN = /€|\beuros?\b|\/ ?mois|éligible|eligible|vous avez droit|avez droit à|non applicables?|estimation totale|certifié|openfisca|règles? de calcul officielles?/i;

describe('structure and invariants', () => {
  const plan = buildActionPlan(results(A));
  it('contract id, non-authoritative, never persisted, ordered numbered steps', () => {
    expect(plan.contract).toBe(PLAN_CONTRACT); expect(PLAN_CONTRACT).toBe('ADA_ACTION_PLAN_V1');
    expect(plan.authoritative).toBe(false); expect(plan.persisted).toBe(false); expect(plan.dataStatusBanner).toBe('Données en cours de vérification.');
    expect(plan.steps.map((s) => s.order)).toEqual(plan.steps.map((_, i) => i + 1));
    expect(plan.steps.length).toBeGreaterThanOrEqual(4);
  });
  it('N16: every step has deadline:null and reminder:null, and no other deadline/reminder field exists', () => {
    for (const s of plan.steps) { expect(s.deadline).toBeNull(); expect(s.reminder).toBeNull(); }
    expect(Object.keys(plan)).not.toContain('deadline'); expect(Object.keys(plan)).not.toContain('reminder');
    expect(ALL(plan)).not.toMatch(/avant le \d|dans les? \d+ (jours?|mois)|date limite|rappel/i);
  });
  it('N11: no external URL, e-mail, phone number or street address; links are internal ADA routes or in-page anchors only', () => {
    const text = ALL(plan);
    expect(text).not.toMatch(/https?:|www\.|@|\b0\d([ .]?\d{2}){4}\b|\b\d{2}([ .]\d{2}){4}\b|\b\d{1,3},? (rue|avenue|boulevard|place|chemin)\b/i);
    for (const s of plan.steps) for (const l of (s.links || [])) expect(l.to).toMatch(/^(\/[a-z0-9\-/?=&]*|#[a-z0-9\-]+)$/i);
  });
  it('no amount, eligibility, refusal, inapplicability or official-verification claim anywhere; "ni un refus"-style negations only', () => {
    const text = ALL(plan);
    expect(text).not.toMatch(FORBIDDEN); expect(findProhibitedDecisionWording(text)).toEqual([]);
    expect(text).not.toMatch(/Mon Parcours/i);
  });
  it('documents are NEVER invented: an empty list and an explicit "to be confirmed with the organization" note', () => {
    const prep = plan.steps.find((s) => s.kind === 'prepare');
    expect(prep.documents).toEqual([]); expect(prep.detail).toMatch(/à confirmer auprès de l'organisme/i);
  });
  it('N13: deterministic — identical output on repeat, independent of locale and clock', () => {
    const a = JSON.stringify(buildActionPlan(results(A)));
    const realNow = Date.now; Date.now = () => 1; try { expect(JSON.stringify(buildActionPlan(results(A)))).toBe(a); } finally { Date.now = realNow; }
  });
  it('the module is pure: no I/O, clock, randomness, storage, network or environment', () => {
    const src = readFileSync('src/lib/actionPlan.js', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/Date\.now|new Date|Math\.random|fetch\(|localStorage|sessionStorage|document\.|window\.|process\.env|crypto/);
  });
});

describe('the plan follows the states and never invents one', () => {
  it('every step item refers to an item that exists in the assessment; labels come from it', () => {
    const r = results(A); const codes = new Set(r.assessment.items.map((i) => i.code));
    for (const s of buildActionPlan(r).steps) for (const c of (s.itemCodes || [])) expect(codes.has(c), c).toBe(true);
  });
  it('MISSING_INFORMATION => a "complete" step first, naming the missing facts', () => {
    const r = results({ birthDate: '1992-03-10', householdSize: 1, territory: '', housing: { status: 'tenant', rent: 480 } });   // no income, no territory
    const plan = buildActionPlan(r); const first = plan.steps[0];
    expect(first.kind).toBe('complete'); expect(first.detail).toMatch(/revenus/); expect(first.detail).toMatch(/commune ou code postal/);
    expect(first.links[0].to).toBe('#diag-birthdate');
  });
  it('CHECK_REQUIRED items => ONE "verify" step per organism type with the internal information pages, then "prepare"', () => {
    const plan = buildActionPlan(results(A)); const verify = plan.steps.filter((s) => s.kind === 'verify');
    expect(verify.map((s) => s.who).sort()).toEqual(["un professionnel (travailleur social ou structure d'accompagnement)", 'votre CAF']);
    const caf = verify.find((s) => s.who === 'votre CAF'); expect(caf.itemCodes.sort()).toEqual(['apl', 'rsa']);
    // S3A: each verify step also offers the structure directory (the citizen must be able to find who verifies); information pages stay one per aide.
    expect(caf.links.map((l) => l.to).sort()).toEqual(['/aides/apl', '/aides/rsa', '/structures']);
    expect(caf.links.find((l) => l.to === '/structures').label).toMatch(/données en cours de vérification/);
    expect(plan.steps.findIndex((s) => s.kind === 'verify')).toBeLessThan(plan.steps.findIndex((s) => s.kind === 'prepare'));
  });
  it('UNSUPPORTED items (ARE, APA, rent arrears, or a territory outside the declared scope) => an "accompany" step to the structure directory, saying ADA cannot evaluate them', () => {
    const plan = buildActionPlan(results({ ...A, territory: '75001' })); const acc = plan.steps.find((s) => s.kind === 'accompany');
    expect(acc.itemCodes).toEqual(expect.arrayContaining(['are', 'apa', 'impayes-loyer', 'faj-strasbourg']));
    expect(acc.links[0].to).toBe('/structures'); expect(acc.detail).toMatch(/ne sait pas encore/i);
    // S2B: the plain-language sentence that is VISIBLE without opening the details names the aides concerned (native run 95f97e: the generic sentence hid which aides need advice)
    for (const label of ['ARE (France Travail)', 'APA (Département)', "FAJ'EMS"]) expect(acc.titleFalc, label).toContain(label);
  });
  it('always ends with the optional sharing step and the urgent-resources step; sharing is described as optional and RC5-bound', () => {
    const plan = buildActionPlan(results(A)); const last2 = plan.steps.slice(-2);
    expect(last2.map((s) => s.kind)).toEqual(['share', 'urgent']);
    expect(last2[0].detail).toMatch(/facultatif/i); expect(last2[0].detail).toMatch(/structure que vous choisissez/i); expect(last2[1].links[0].to).toBe('/ressources?emergency=1');
  });
  it('no usable assessment (absent, empty, forged authoritative item) => no plan steps (nothing invented)', () => {
    expect(buildActionPlan(null).steps).toEqual([]); expect(buildActionPlan({}).steps).toEqual([]);
    const forged = results(A); forged.assessment.items[0] = { ...forged.assessment.items[0], state: 'ELIGIBLE_WHERE_AUTHORITY_VERIFIED', authoritative: true };
    const plan = buildActionPlan(forged); expect(ALL(plan)).not.toContain(forged.assessment.items[0].label + ' (');   // the forged item is dropped by readAssessment
    expect(plan.steps.flatMap((s) => s.itemCodes || [])).not.toContain(forged.assessment.items[0].code);
  });
  it('each step has a plain-language (FALC) sentence of at most ~20 words, and the FALC text contains no figure', () => {
    for (const s of buildActionPlan(results(A)).steps) { expect(s.titleFalc.split(/\s+/).length).toBeLessThanOrEqual(24); expect(s.titleFalc).not.toMatch(/\d{3,}/); }
  });
  it('the three Strasbourg journeys (J-A, J-B, J-C) produce coherent plans', () => {
    const JA = A, JB = { birthDate: '1997-05-02', householdSize: 1, territory: '67200', income: { salary: 1450 }, housing: { status: 'tenant', rent: 720 } };
    const JC = { birthDate: '1948-01-20', householdSize: 1, territory: '67000', income: { salary: 0, unemployment: 0 }, housing: { status: 'owner', rent: 0 } };
    for (const j of [JA, JB, JC]) { const plan = buildActionPlan(results(j)); expect(plan.steps.length).toBeGreaterThanOrEqual(4); expect(ALL(plan)).not.toMatch(FORBIDDEN); }
    expect(buildActionPlan(results(JC)).steps.some((s) => s.kind === 'accompany' && s.itemCodes.includes('apa'))).toBe(true);
  });
});

describe('planTextLines (PDF / print)', () => {
  it('returns the plan as plain lines in step order with no amount and no forbidden wording', () => {
    const lines = planTextLines(results(A)); expect(lines.length).toBeGreaterThan(4);
    expect(lines.join('\n')).not.toMatch(FORBIDDEN); expect(lines[0]).toMatch(/^1\./);
  });
});
