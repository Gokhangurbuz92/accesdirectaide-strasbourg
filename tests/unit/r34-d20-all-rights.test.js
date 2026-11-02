/**
 * R34 — D20 code gap closed: once a right of the register passes the expert gate, the result shows its reading — for each of the 8 rights, not only RSA,
 * APL and FAJ. The review is SYNTHETIC and exists only in this test; the committed register stays RESEARCHED_UNVALIDATED.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { validatedReadings } from '../../api/lib/validatedRules.js';
import { applyForm, evaluateForm, parseCsv, renderForm } from '../../scripts/d11-review.mjs';
import { assessSimulation, UNSUPPORTED_RIGHTS } from '../../api/lib/diagnosticAssessment.js';
import { assertAssessmentItem, STATES } from '../../api/lib/assessmentContract.js';

const reg = JSON.parse(fs.readFileSync('data/rules/rights-rules.v1.json', 'utf8'));
const proposed = JSON.parse(fs.readFileSync('data/rules/reference-cases.proposed.v1.json', 'utf8'));
const reviewer = { reviewer_name: 'Experte fictive (test)', reviewer_role: 'juriste en droit social (fictif)', review_date: '2026-11-15' };
const acceptEverything = () => parseCsv(renderForm(reg, proposed)).map((r) => ({ ...r, ...reviewer, decision: r.item_type === 'ambiguity' ? 'DECIDED' : 'ACCEPT', correction_or_decision: r.item_type === 'ambiguity' ? 'tranché (test)' : '' }));
const FULL = { birthDate: '1990-01-01', householdSize: 2, income: { salary: 900 }, housing: { status: 'tenant', rent: 512 }, territory: '67000' };
const ALL = reg.rights.map((r) => r.id);

describe('D20 — every validated right shows its rule', () => {
  const validated = applyForm(reg, evaluateForm(reg, proposed, acceptEverything()));
  const readings = validatedReadings(validated, FULL, '2026-11-20');
  const result = assessSimulation({ mode: 'SIMULATION_MODE', rights: [], meta: {} }, FULL, readings);

  it('the synthetic review validates the 8 rights of the register', () => {
    expect(ALL).toHaveLength(8);
    expect(Object.keys(readings).sort()).toEqual([...ALL].sort());
  });
  it('each of them has exactly one item, built from its validated reading, with its rule, official page and review date', () => {
    for (const code of ALL) {
      const items = result.items.filter((i) => i.code === code);
      expect(items, code).toHaveLength(1);
      expect(items[0].provenance.uncertainty, code).toBe('ORIENTATION_REGLE_RELUE');
      expect(items[0].provenance.rule, code).toMatch(/relue par juriste en droit social \(fictif\) le 15\/11\/2026/);
      expect(items[0].provenance.source, code).toMatch(/^https:\/\//);
      expect([STATES.POSSIBLE, STATES.CHECK_REQUIRED]).toContain(items[0].state);   // never a decision
      expect(items[0].whyFr && items[0].whyFalc, code).toBeTruthy();
      expect(items[0].whoToAsk, code).toBeTruthy();
      assertAssessmentItem(items[0]);
    }
  });
  it('no right that has a validated reading still says « Aucune règle vérifiée »', () => {
    for (const u of UNSUPPORTED_RIGHTS.filter((x) => readings[x.code])) {
      expect(result.items.some((i) => i.code === u.code && i.state === STATES.UNSUPPORTED)).toBe(false);
    }
    expect(JSON.stringify(result.items.filter((i) => readings[i.code]))).not.toMatch(/Aucune règle vérifiée/);
  });
  it('without validation nothing changes: the five other rights produce no item and ARE / APA stay unsupported', () => {
    const today = assessSimulation({ mode: 'SIMULATION_MODE', rights: [], meta: {} }, FULL, validatedReadings(reg, FULL));
    expect(today.items.map((i) => i.code)).toEqual(['rsa', 'apl', 'faj-strasbourg', 'are', 'apa', 'impayes-loyer']);
    expect(today.items.filter((i) => i.code === 'are' || i.code === 'apa').every((i) => i.state === STATES.UNSUPPORTED)).toBe(true);
  });
});
