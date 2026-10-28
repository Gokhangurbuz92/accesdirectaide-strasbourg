/**
 * DTA S2A — A6 "territory is data, not a regex" (PRODUCT_FLOW_CONTRACT A6, N8, N17; gap D4).
 * Before: the FAJ'EMS rule was an untagged `/^67\d{3}$/` in LocalRulesEngine (whole département) while the label said "Strasbourg", the FALC text "Bas-Rhin" and the catalogue says
 * "Eurométropole de Strasbourg"; the assessment showed the same "à faire vérifier" FAJ card to a citizen living in Paris.
 * Now: the territory scope is DATA (api/lib/territoryScopes.js, taken from the project catalogue data/aides-alsace.csv and declared UNVERIFIED), used by BOTH the engine and the assessment:
 *   unknown / unreadable territory => MISSING_INFORMATION; inside the declared département => CHECK_REQUIRED ("la commune concernée est à vérifier"); outside => UNSUPPORTED (never POSSIBLE, never NOT_APPLICABLE:
 *   no authority proves anything, and absence of a rule is not a refusal).  Nothing official is claimed: the Eurométropole commune list is not verified, so a 67xxx code is never "inside the Eurométropole".
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAssessment, assertAssessmentItem } from '../../api/lib/assessmentContract.js';
import { TERRITORY_SCOPES, territoryStatus } from '../../api/lib/territoryScopes.js';
import { runLocalSimulation } from '../../api/lib/LocalRulesEngine.js';
import { findProhibitedDecisionWording } from '../helpers/decision-wording.js';

const answers = (territory, extra = {}) => ({ birthDate: '2003-05-02', householdSize: 1, territory, income: { salary: 300 }, housing: { status: 'tenant', rent: 300 }, ...extra });
const faj = (territory, opts = {}) => buildAssessment({ answers: answers(territory), ...opts }).items.find((i) => i.code === 'faj-strasbourg');

describe('territoryStatus (data-driven)', () => {
  it.each([['67000', 'DECLARED_AREA'], ['67200', 'DECLARED_AREA'], ['67400', 'DECLARED_AREA'], ['67', 'DECLARED_AREA'],
    ['75001', 'OUTSIDE'], ['68000', 'OUTSIDE'], ['13001', 'OUTSIDE'],
    ['', 'UNKNOWN'], [undefined, 'UNKNOWN'], [null, 'UNKNOWN'], ['abc', 'UNKNOWN'], ['6700', 'UNKNOWN'], ['670000', 'UNKNOWN'], ['  ', 'UNKNOWN']])('%s => %s', (t, s) => {
    expect(territoryStatus('faj-strasbourg', t)).toBe(s);
  });
  it('the scope is declared data with its source and an explicit UNVERIFIED status; an unknown right has no scope', () => {
    const s = TERRITORY_SCOPES['faj-strasbourg'];
    expect(s.territory_scope).toBe('Eurométropole de Strasbourg'); expect(s.departmentPrefixes).toEqual(['67']);
    expect(s.source).toMatch(/aides-alsace\.csv/); expect(s.status).toBe('UNVERIFIED'); expect(s.communeList).toBe('NOT_VERIFIED');
    expect(territoryStatus('rsa', '75001')).toBe('NO_SCOPE');
  });
});

describe('assessment of FAJ\'EMS by territory', () => {
  it('inside the declared département: CHECK_REQUIRED, the provenance names the declared scope and says it is unverified, and the commune is still "to be verified"', () => {
    const it_ = faj('67000'); assertAssessmentItem(it_);
    expect(it_.state).toBe('CHECK_REQUIRED');
    expect(it_.provenance.display.territory).toMatch(/Eurométropole de Strasbourg/); expect(it_.provenance.display.territory).toMatch(/non vérifi/i);
    expect(it_.explanation + it_.explanationFalc).toMatch(/commune/i);
  });
  it('outside the département (Paris, Haut-Rhin): UNSUPPORTED — never POSSIBLE, never NOT_APPLICABLE, no refusal wording, the declared scope is named', () => {
    for (const t of ['75001', '68000']) {
      const it_ = faj(t); assertAssessmentItem(it_);
      expect(it_.state, t).toBe('UNSUPPORTED');
      expect(['POSSIBLE', 'NOT_APPLICABLE_WHERE_PROVEN', 'ELIGIBLE_WHERE_AUTHORITY_VERIFIED']).not.toContain(it_.state);
      const text = `${it_.explanation} ${it_.explanationFalc} ${it_.provenance.display.rule} ${it_.provenance.display.territory}`;
      expect(text).toMatch(/Eurométropole de Strasbourg/); expect(findProhibitedDecisionWording(text)).toEqual([]);
      expect(text).not.toMatch(/éligible|vous avez droit|non applicable|refus(é|ée)|€/i);
      expect(it_.amount).toBeNull();
    }
  });
  it('unknown or unreadable territory: MISSING_INFORMATION listing the territory', () => {
    for (const t of ['', undefined, 'abc', '6700']) {
      const it_ = faj(t); expect(it_.state, String(t)).toBe('MISSING_INFORMATION'); expect(it_.missingFacts).toContain('territory');
    }
  });
  it('even with the local heuristic leads ENABLED an outside territory is never a lead (N8)', () => {
    const sim = runLocalSimulation(answers('75001'));
    const it_ = buildAssessment({ simulation: sim, answers: answers('75001'), leadsEnabled: true }).items.find((i) => i.code === 'faj-strasbourg');
    expect(it_.state).toBe('UNSUPPORTED');
  });
  it('RSA and APL are not territory-gated by this change', () => {
    const items = buildAssessment({ answers: answers('75001') }).items;
    expect(items.find((i) => i.code === 'rsa').state).toBe('CHECK_REQUIRED'); expect(items.find((i) => i.code === 'apl').state).toBe('CHECK_REQUIRED');
  });
  it('deterministic (N13): same input, same output, repeated', () => {
    const a = JSON.stringify(buildAssessment({ answers: answers('67000') })); expect(JSON.stringify(buildAssessment({ answers: answers('67000') }))).toBe(a);
  });
});

describe('N17 — no untagged Strasbourg regex; the engine uses the same scope data and its label/text match it', () => {
  const src = readFileSync('api/lib/LocalRulesEngine.js', 'utf8');
  it('the engine has no hard-coded /^67…/ territory regex and imports the scope data', () => {
    expect(src).not.toMatch(/\/\^67/); expect(src).toContain("from './territoryScopes.js'");
  });
  it('the engine FAJ lead follows the scope data (inside 67 yes for a 16–25 y low-resource profile, outside never) and its text names the declared scope, not the département', () => {
    const inside = runLocalSimulation(answers('67000')).rights.find((r) => r.code === 'faj-strasbourg');
    const outside = runLocalSimulation(answers('75001')).rights.find((r) => r.code === 'faj-strasbourg');
    expect(inside.eligible).toBe(true); expect(outside.eligible).toBe(false);
    expect(src).not.toMatch(/Bas-Rhin/); expect(inside.explainFalc || inside.explain_falc || JSON.stringify(inside)).toMatch(/Eurométropole de Strasbourg/);
  });
});
