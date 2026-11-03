// @vitest-environment jsdom
/* global document, Node, NodeFilter */
/**
 * R40 — the result area (DiagnosticOutcome), the Plan d'action (ActionPlan + PlanStructures) and the privacy notice (PrivacyNotice) in the six languages
 * (namespace `diagnostic`): French is exactly the former text (the plan's French screen is the text of src/lib/actionPlan.js, which the PDF prints);
 * in Arabic / English / Ukrainian no French sentence is left outside a lang="fr" fragment (the aide labels and the organisms the server names);
 * the privacy notice quotes the reset button by its own label in every language; never an entitlement claim. jsdom: no layout. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import DiagnosticOutcome from '../../src/components/diagnostic/DiagnosticOutcome.jsx';
import ActionPlan from '../../src/components/diagnostic/ActionPlan.jsx';
import PrivacyNotice, { PRIVACY_TEXT } from '../../src/components/diagnostic/PrivacyNotice.jsx';
import { buildActionPlan } from '../../src/lib/actionPlan.js';
import { buildAssessment } from '../../api/lib/assessmentContract.js';
import { UNSUPPORTED_RIGHTS } from '../../api/lib/diagnosticAssessment.js';
import { setLanguage } from '../../src/i18n/index.js';
import { ENTITLEMENT_CLAIMS } from '../../scripts/i18n-check.mjs';

afterEach(async () => { cleanup(); await act(async () => { await setLanguage('fr', { persist: false }); }); });
const ANSWERS = { birthDate: '1992-03-10', householdSize: 1, territory: '67000', income: {}, housing: { status: 'tenant', rent: 480 } };
const results = (a = ANSWERS) => ({ assessment: buildAssessment({ answers: a, unsupportedRights: UNSUPPORTED_RIGHTS }), period: '2026-09', meta: { requestId: 'r', duration_ms: 1 } });
const CAF = [{ id: '1', slug: 'caf-67', nom: 'CAF du Bas-Rhin', ville: 'Strasbourg', is_pro_enabled: true }];
const open = (r = results()) => render(h(MemoryRouter, null, h(DiagnosticOutcome, { results: r, situation: {}, structureLoader: async () => CAF })));
const lang = async (code) => { await act(async () => { await setLanguage(code, { persist: false }); }); };

/** the text of a subtree that is NOT inside a lang="fr" fragment */
const outsideFrench = (root) => {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let out = ''; let n;
  while ((n = w.nextNode())) { if (n.nodeType === Node.TEXT_NODE && !n.parentElement.closest('[lang="fr"]')) out += ` ${n.textContent}`; }
  return out;
};
/** common French words that a translated screen must not show (the official acronyms CAF, MSA, RSA… stay French on purpose; « des » is German too) */
const FRENCH_WORDS = /\b(vous|votre|vos|les|une|pour|avec|aucune|partager|données|réessayez|structure d|aux)\b/i;

describe('French: the former text, exactly', () => {
  it('each plan step shows the French sentences of actionPlan.js (FALC title, title, detail)', async () => {
    const r = results();
    open(r);
    await screen.findAllByTestId('plan-structure-link');
    const shown = [...screen.getByTestId('action-plan-steps').children];
    const steps = buildActionPlan(r).steps;
    expect(shown).toHaveLength(steps.length);
    for (const [i, s] of steps.entries()) {
      const li = shown[i];
      expect(li.getAttribute('data-step-kind')).toBe(s.kind);
      expect(li.querySelector('p').textContent).toBe(`${s.order}.${s.titleFalc}`);
      expect(li.querySelector('[data-testid="plan-step-title"]').textContent).toBe(s.title);
      expect(li.querySelector('[data-testid="plan-step-detail"]').textContent).toBe(s.detail);
      const labels = [...li.querySelectorAll(':scope > ul a')].map((a) => a.textContent);
      expect(labels).toEqual(s.links.map((l) => l.label));
    }
  });
  it('the privacy notice is PRIVACY_TEXT, with « Réinitialiser tout »', () => {
    render(h(MemoryRouter, null, h(PrivacyNotice)));
    const box = screen.getByTestId('privacy-notice');
    for (const s of [PRIVACY_TEXT.title, PRIVACY_TEXT.p1, PRIVACY_TEXT.p2, PRIVACY_TEXT.p3, ...PRIVACY_TEXT.falc, PRIVACY_TEXT.link]) expect(box.textContent).toContain(s);
    expect(PRIVACY_TEXT.p3).toContain('« Réinitialiser tout »');
  });
});

describe.each([
  ['ar', 'rtl', 'خطة العمل', 'إعادة تعيين الكل'],
  ['en', 'ltr', 'Action plan', 'Reset everything'],
  ['uk', 'ltr', 'План дій', 'Скинути все'],
])('%s', (code, dir, planTitle, reset) => {
  it('the result area and the plan are translated; French is left only inside lang="fr" (labels, organisms, structure names); axe clean', async () => {
    await lang(code);
    const { container } = open();
    await screen.findAllByTestId('plan-structure-link');
    expect(document.documentElement.dir).toBe(dir);
    expect(screen.getByRole('heading', { level: 2, name: new RegExp(planTitle) })).toBeInTheDocument();
    const rest = outsideFrench(container);
    expect(rest).not.toMatch(FRENCH_WORDS);
    expect(ENTITLEMENT_CLAIMS[code]?.test(container.textContent) ?? false).toBe(false);
    const verify = screen.getAllByTestId('plan-step-verify')[0];
    expect(verify.querySelector('[lang="fr"]')).toHaveAttribute('dir', 'ltr');
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(res.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
  });
  it('the privacy notice is translated and quotes the reset button by its label in this language', async () => {
    await lang(code);
    render(h(MemoryRouter, null, h(PrivacyNotice)));
    const box = screen.getByTestId('privacy-notice');
    expect(outsideFrench(box)).not.toMatch(FRENCH_WORDS);
    expect(screen.getByTestId('privacy-browser-sentence')).toHaveTextContent(reset);
    expect(box.textContent).not.toContain('Réinitialiser tout');
  });
  it('the professional view of the plan is translated too', async () => {
    await lang(code);
    const { container } = render(h(MemoryRouter, null, h(ActionPlan, { results: results(), audience: 'pro' })));
    await waitFor(() => expect(screen.getByTestId('action-plan')).toBeInTheDocument());
    expect(outsideFrench(container)).not.toMatch(FRENCH_WORDS);
  });
});

describe('German', () => {
  it('the result area has no French outside lang="fr"', async () => {
    await lang('de');
    open();
    await screen.findAllByTestId('plan-structure-link');
    expect(outsideFrench(document.body)).not.toMatch(FRENCH_WORDS);
  });
});
