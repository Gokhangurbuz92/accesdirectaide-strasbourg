// @vitest-environment jsdom
/**
 * DTA S2A (A5) — the Plan d'action on the result page (jsdom + Testing Library + axe-core).  jsdom has no layout engine: colour contrast, print rendering and screen-reader behaviour are NOT proven here
 * (axe `color-contrast` disabled; real-Chrome axe + manual SR audit are separate).  No JSX in the test body.
 */
/* global document, window */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DiagnosticOutcome from '../../src/components/diagnostic/DiagnosticOutcome.jsx';
import ActionPlan from '../../src/components/diagnostic/ActionPlan.jsx';
import { buildAssessment } from '../../api/lib/assessmentContract.js';
import { UNSUPPORTED_RIGHTS } from '../../api/lib/diagnosticAssessment.js';
import { findProhibitedDecisionWording } from '../helpers/decision-wording.js';

afterEach(cleanup);
const ANSWERS = { birthDate: '1992-03-10', householdSize: 1, territory: '67000', income: { unemployment: 700 }, housing: { status: 'tenant', rent: 480 } };
const results = (a = ANSWERS) => ({ assessment: buildAssessment({ answers: a, unsupportedRights: UNSUPPORTED_RIGHTS }), period: '2026-09', meta: { requestId: 'r', duration_ms: 1 } });
const open = (r = results()) => render(createElement(MemoryRouter, null, createElement(DiagnosticOutcome, { results: r, situation: {} })));

describe('the plan on the result page', () => {
  it('is a labelled region with a heading, an ordered list of numbered steps (FALC sentence first) and a statement that it is not saved and decides nothing', () => {
    open();
    const region = screen.getByTestId('action-plan');
    expect(region).toHaveAccessibleName(/Plan d.action/i);
    expect(within(region).getByRole('heading', { level: 2, name: /Plan d.action/i })).toBeInTheDocument();
    const steps = within(region).getByTestId('action-plan-steps'); expect(steps.tagName).toBe('OL');
    const kinds = [...steps.querySelectorAll('li[data-step-kind]')].map((l) => l.getAttribute('data-step-kind'));
    expect(kinds).toEqual(expect.arrayContaining(['verify', 'prepare', 'accompany', 'share', 'urgent']));
    expect(region.textContent).toMatch(/n.est pas enregistré/i); expect(region.textContent).toMatch(/ne décide rien/i); expect(region.textContent).toMatch(/Données en cours de vérification\./);
    expect(region.textContent).toMatch(/Demandez à votre CAF/);
  });
  it('the fuller text sits in <details> ("Plus d\'explications"), keyboard operable', () => {
    open(); const first = screen.getByTestId('action-plan').querySelector('details > summary'); expect(first).toHaveTextContent(/Plus d.explications/i);
    first.focus(); expect(document.activeElement).toBe(first);
  });
  it('links: internal information pages, the structure directory, an in-page anchor to the sharing buttons that exists, and the emergency resources', () => {
    open(); const region = screen.getByTestId('action-plan');
    const hrefs = [...region.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/aides/rsa', '/aides/apl', '/structures', '#share-actions', '/ressources?emergency=1', ]));
    for (const h of hrefs) expect(h).toMatch(/^(\/|#)/);
    expect(document.getElementById('share-actions')).not.toBeNull();
    for (const a of region.querySelectorAll('a')) expect(a.className).toMatch(/min-h-11/);
  });
  it('the print button calls window.print (the plan is not stored anywhere) and has a touch-size class', () => {
    const spy = vi.spyOn(window, 'print').mockImplementation(() => {});
    open(); const b = screen.getByTestId('action-plan-print'); expect(b.className).toMatch(/min-h-11/); fireEvent.click(b); expect(spy).toHaveBeenCalledTimes(1);
    expect(window.localStorage.length).toBe(0); spy.mockRestore();
  });
  it('no money, eligibility, refusal or official-verification claim in the plan; no external URL / phone / e-mail', () => {
    open(); const t = screen.getByTestId('action-plan').textContent;
    expect(t).not.toMatch(/€|\beuros?\b|éligible|vous avez droit|non applicable|certifié|openfisca/i); expect(findProhibitedDecisionWording(t)).toEqual([]);
    expect(t).not.toMatch(/https?:|www\.|@|\b0\d([ .]?\d{2}){4}\b/);
  });
  it('a missing-information result shows the "complete" step first with an anchor to the form', () => {
    open(results({ ...ANSWERS, income: {}, territory: '' }));
    const first = screen.getByTestId('action-plan-steps').querySelector('li'); expect(first.getAttribute('data-step-kind')).toBe('complete');
    expect(first.querySelector('a').getAttribute('href')).toBe('#diag-birthdate');
  });
  it('no usable assessment => no plan at all', () => {
    open({ assessment: { items: [] } }); expect(screen.queryByTestId('action-plan')).toBeNull();
    expect(screen.getByTestId('assessment-unavailable')).toBeInTheDocument();
  });
  it('axe (jsdom, colour contrast excluded): no serious or critical violation on the result page with the plan', async () => {
    open(); const res = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
  });
});

describe('professional (read-only) view of the same plan', () => {
  const pro = () => render(createElement(MemoryRouter, null, createElement(ActionPlan, { results: results(), audience: 'pro' })));
  it('shows the plan that was proposed to the person, without the citizen-only actions (print, sharing, emergency, form anchors) and with a read-only title', () => {
    pro(); const region = screen.getByTestId('action-plan');
    expect(within(region).getByRole('heading', { level: 2 })).toHaveTextContent(/Plan d.action proposé à la personne/i);
    expect(screen.queryByTestId('action-plan-print')).toBeNull();
    const kinds = [...region.querySelectorAll('li[data-step-kind]')].map((l) => l.getAttribute('data-step-kind'));
    expect(kinds).toEqual(expect.arrayContaining(['verify', 'prepare', 'accompany'])); expect(kinds).not.toContain('share'); expect(kinds).not.toContain('urgent'); expect(kinds).not.toContain('complete');
    for (const a of region.querySelectorAll('a')) expect(a.getAttribute('href')).not.toMatch(/^#/);
    expect(region.textContent).not.toMatch(/Imprimer|partager votre diagnostic/i);
  });
});
