// @vitest-environment jsdom
/**
 * DTA S1C — correction of the browser assertion of DTA-B2 (run 20261017T230707Z-1fa2c0): the broad /refus|pas droit|rejet/ matched the legitimate
 * disclaimer "… ni un refus." (it says that NO refusal was made).  Normative test change, explained: the detector now separates a positive decision
 * from an explanation that denies one.  Nothing is accepted that states entitlement, refusal, rejection or inapplicability.
 * jsdom: text-level proof only.
 */
/* global document */
import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { findProhibitedDecisionWording } from '../helpers/decision-wording.js';
import DiagnosticOutcome from '../../src/components/diagnostic/DiagnosticOutcome.jsx';

afterEach(cleanup);
const prov = { source: null, verifiedAt: null, territory: null, rule: null, uncertainty: 'ORIENTATION_NON_OFFICIELLE', display: { source: 'Source : aucune', verifiedAt: 'Vérifié le : non vérifié', territory: 'Territoire : non précisé', rule: 'Règle : aucune', uncertainty: 'Incertitude : ORIENTATION_NON_OFFICIELLE' } };
const it_ = (code, label, state, extra = {}) => ({ code, label, state, authoritative: false, amount: null, amountStatus: 'NOT_PROVIDED_NO_AUTHORITY', missingFacts: [], whoToAsk: 'votre CAF',
  explanation: 'Ceci est une pré-orientation indicative : ce n\'est ni une réponse ni un refus.', explanationFalc: 'Ce résultat n\'est pas une décision. Demandez à votre CAF de regarder votre situation.', provenance: prov, ...extra });
const RESULTS = { assessment: { contract: 'ADA_ASSESSMENT_CONTRACT_V1', authoritative: false, leadsEnabled: false, dataStatus: 'UNVERIFIED', referenceDate: null, totals: null, items: [
  it_('rsa', 'RSA', 'CHECK_REQUIRED'), it_('faj-strasbourg', 'FAJ\'EMS', 'MISSING_INFORMATION', { missingFacts: ['territory'], whoToAsk: null }), it_('are', 'ARE (France Travail)', 'UNSUPPORTED', { whoToAsk: null }) ] }, period: '2026-09', meta: { requestId: 'r', duration_ms: 1 } };

describe('the detector rejects a positive decision', () => {
  it.each([
    'Votre demande est refusée.', 'Vous n\'avez pas droit à l\'APL.', 'Dossier rejeté.', 'Refus probable pour le RSA.', 'Vous êtes non éligible.', 'Rejet de votre dossier.',
    'Vous n’avez pas droit au RSA.', 'Aucun droit ouvert pour vous.', 'Résultat : inéligible.',
  ])('flags: %s', (s) => { expect(findProhibitedDecisionWording(s)).toHaveLength(1); });
});

describe('the detector accepts only an explanation that denies a decision', () => {
  it.each([
    'Elles ne sont ni une décision, ni une promesse, ni un refus.',
    'Ceci est une pré-orientation indicative : ce n\'est ni une réponse ni un refus.',
    'Cela ne veut pas dire que vous n\'avez pas droit.',
    'Ce résultat ne signifie pas que vous n’avez pas droit à cette aide.',
  ])('allows: %s', (s) => { expect(findProhibitedDecisionWording(s)).toEqual([]); });
  it('a negation in ANOTHER sentence does not excuse a positive one', () => {
    expect(findProhibitedDecisionWording('Ceci n\'est pas une décision. Votre demande est refusée.')).toEqual(['Votre demande est refusée.']);
    expect(findProhibitedDecisionWording('Ni un doute. Vous n\'avez pas droit à cette aide.')).toHaveLength(1);
  });
});

describe('the real result area of the diagnostic page', () => {
  const text = () => { render(createElement(MemoryRouter, null, createElement(DiagnosticOutcome, { results: RESULTS, situation: {} }))); return document.body.textContent; };
  it('contains the legitimate disclaimer AND no positive refusal / non-entitlement wording', () => {
    const t = text();
    expect(t).toMatch(/ni un refus/);                                         // the sentence that the old broad regex wrongly rejected is still there
    expect(findProhibitedDecisionWording(t)).toEqual([]);
  });
  it('keeps the assessment-state and provenance structure that DTA-B2 asserts', () => {
    text();
    expect(document.querySelector('[data-testid="assessment-state-rsa"]')).toHaveTextContent(/À faire vérifier/);
    expect(document.querySelector('[data-testid="assessment-state-faj-strasbourg"]')).toHaveTextContent(/Informations manquantes/);
    expect(document.querySelector('[data-testid="assessment-item-faj-strasbourg"]')).toHaveTextContent(/À préciser/);
    for (const k of ['source', 'verifiedAt', 'territory', 'rule', 'uncertainty']) expect(document.querySelector(`[data-testid="provenance-rsa-${k}"]`)).not.toBeNull();
  });
  it('a source-level guard: the user-facing surfaces never contain a positive refusal sentence', () => {
    for (const f of ['src/components/diagnostic/DiagnosticOutcome.jsx', 'src/components/diagnostic/AssessmentView.jsx', 'src/lib/assessmentLabels.js', 'src/lib/passportContent.js', 'api/lib/diagnosticAssessment.js', 'api/lib/assessmentContract.js']) {
      const lines = readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      const quoted = (lines.match(/(['"`])((?:\\.|(?!\1).)*?)\1/g) || []).map((q) => q.slice(1, -1));
      expect(findProhibitedDecisionWording(quoted.join('\n')), f).toEqual([]);
    }
  });
});
