// @vitest-environment jsdom
/* global document, window */
/**
 * R39 — the diagnostic screens (DiagnosticPage, AssessmentView, SharedDiagnostic) in the six languages (namespace `diagnostic`), and their accessibility:
 * French stays the exact former text; in Arabic the page is right to left, the frame is Arabic and what the server wrote stays French (lang="fr");
 * the legal notice « non-opposable / valeur légale » stays French in every language with a plain summary; never an entitlement claim in any
 * language; focus on the result / error heading after a submit; the disabled button says why; arrow keys in the housing radio group.
 * jsdom: no layout (contrast, 320 px reflow and real screen readers are checked in a browser). No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DiagnosticPage from '../../src/pages/DiagnosticPage.jsx';
import SharedDiagnostic from '../../src/pages/SharedDiagnostic.jsx';
import { setLanguage } from '../../src/i18n/index.js';
import { ENTITLEMENT_CLAIMS } from '../../scripts/i18n-check.mjs';

const prov = { source: null, verifiedAt: null, territory: null, rule: null, uncertainty: 'ORIENTATION_NON_OFFICIELLE', display: {
  source: 'Source : aucune — simulation locale, pas une source officielle', verifiedAt: 'Vérifié le : non vérifié', territory: 'Territoire : non précisé',
  rule: 'Règle : aucune règle officielle appliquée (repère indicatif local)', uncertainty: 'Incertitude : ORIENTATION_NON_OFFICIELLE' } };
const item = (code, label, state, extra = {}) => ({ code, label, state, authoritative: false, amount: null, amountStatus: 'NOT_PROVIDED_NO_AUTHORITY', missingFacts: [], whoToAsk: 'votre CAF',
  explanation: 'Ceci est une pré-orientation indicative : ce n\'est ni une réponse ni un refus.', explanationFalc: 'Ce résultat n\'est pas une décision.', provenance: prov, ...extra });
const ASSESSMENT = { contract: 'ADA_ASSESSMENT_CONTRACT_V1', authoritative: false, leadsEnabled: false, dataStatus: 'UNVERIFIED', referenceDate: '2026-09-01', totals: null, items: [
  item('rsa', 'RSA', 'CHECK_REQUIRED', { basisFacts: ['income'] }), item('apl', 'APL', 'MISSING_INFORMATION', { missingFacts: ['housing.rent'], whoToAsk: null }),
] };
const wrap = (el, entries = ['/diagnostic']) => h(HelmetProvider, null, h(MemoryRouter, { initialEntries: entries }, el));
const reply = (status, body) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status === 200, status, json: async () => body })));
const fill = (housingName) => {
  fireEvent.change(document.getElementById('diag-birthdate'), { target: { value: '1992-03-10' } });
  fireEvent.click(screen.getByRole('radio', { name: housingName }));
};
const noClaim = (lang, text) => expect(ENTITLEMENT_CLAIMS[lang]?.test(text) ?? false, `${lang}: ${text.slice(0, 120)}`).toBe(false);

beforeEach(() => { window.localStorage.clear(); document.cookie = '__csrf=t; path=/'; });
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await act(async () => { await setLanguage('fr', { persist: false }); }); });

describe('French: the former text, exactly', () => {
  it('the page, the form and the result keep their French wording; the legal notice has no summary in French', async () => {
    render(wrap(h(DiagnosticPage)));
    for (const s of ['Simulateur de Droits Sociaux', 'Obtenez des pistes d\'orientation, non officielles, vers certaines aides sociales.', 'Simulation locale — indicative et non-opposable',
      'Choisissez une tranche d\'âge si vous ne souhaitez pas donner votre date de naissance. Un seul des deux suffit.', 'Hébergé(e) gratuitement', 'Sans emploi / Recherche',
      'Cette simulation est indicative et non-opposable. Seule une instruction officielle par l\'organisme compétent (CAF, CPAM, Département) a valeur légale.',
      'Complétez les informations à gauche pour obtenir des pistes d\'orientation (RSA, APL, FAJ\'EMS…). Ce n\'est pas une décision.']) expect(document.body.textContent).toContain(s);
    expect(screen.queryByTestId('diag-legal-summary')).toBeNull();
    expect([...document.getElementById('diag-ageband').options].map((o) => o.textContent)).toEqual(['Non précisée', 'Moins de 18 ans', '18 à 24 ans', '25 à 59 ans', '60 ans et plus']);
    reply(200, { assessment: ASSESSMENT });
    fill('Locataire'); fireEvent.click(document.getElementById('diag-calculate-btn'));
    await screen.findByTestId('assessment-region');
    expect(screen.getByTestId('assessment-item-apl')).toHaveTextContent('À préciser : loyer.');
    expect(screen.getByTestId('assessment-item-rsa')).toHaveTextContent('À demander à : votre CAF.');
    expect(screen.getByTestId('why-basis-rsa')).toHaveTextContent('Réponses utilisées : revenus.');
  });
});

describe('Arabic (right to left)', () => {
  beforeEach(async () => { await act(async () => { await setLanguage('ar', { persist: false }); }); });

  it('the frame is Arabic, the legal notice stays French (lang="fr", ltr) with an Arabic summary, no entitlement claim; axe clean', async () => {
    const { container } = render(wrap(h(DiagnosticPage)));
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('محاكي الحقوق الاجتماعية');
    const notice = screen.getByTestId('diag-legal-notice').querySelector('[lang="fr"]');
    expect(notice).toHaveAttribute('dir', 'ltr'); expect(notice).toHaveTextContent('a valeur légale');
    expect(screen.getByTestId('diag-legal-summary')).toHaveTextContent('الجهة المختصة وحدها');
    expect(screen.getByRole('radio', { name: 'مستأجر' })).toBeInTheDocument();
    expect([...document.getElementById('diag-ageband').options].map((o) => o.textContent)[1]).not.toBe('Moins de 18 ans');   // the shared age-band labels
    noClaim('ar', document.body.textContent);
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
  });

  it('the result frame is Arabic; what the server wrote and the official names stay French inside lang="fr"', async () => {
    const { container } = render(wrap(h(DiagnosticPage)));
    reply(200, { assessment: ASSESSMENT });
    fill('مستأجر'); fireEvent.click(document.getElementById('diag-calculate-btn'));
    const title = await screen.findByRole('heading', { name: 'مسارات التوجيه' });
    await waitFor(() => expect(document.activeElement).toBe(title));                           // focus on the result heading
    const rsa = screen.getByTestId('assessment-item-rsa');
    expect(rsa).toHaveTextContent('الجهة التي تُسأل:');
    for (const s of ['RSA', 'Ce résultat n\'est pas une décision.', 'votre CAF']) {
      const el = [...rsa.querySelectorAll('[lang="fr"]')].find((e) => e.textContent === s);
      expect(el, s).toBeTruthy();
    }
    expect(screen.getByTestId('provenance-rsa-source').closest('[lang="fr"]')).not.toBeNull();
    const legal = screen.getByTestId('legal-texts-rsa');
    expect(legal).toHaveTextContent('النصوص الرسمية (Légifrance)');
    expect(legal.querySelector('[data-testid="legal-reference-toggle"] [lang="fr"]')).toHaveTextContent(/^CASF/);
    noClaim('ar', screen.getByTestId('diagnostic-results').textContent);
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
  });

  it('in RTL the left arrow moves to the NEXT housing option, the right arrow to the previous one', () => {
    render(wrap(h(DiagnosticPage)));
    const first = screen.getByRole('radio', { name: 'مستأجر' });
    fireEvent.click(first);
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(screen.getByRole('radio', { name: 'مستأجر في سكن اجتماعي (HLM)' })).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'مستأجر في سكن اجتماعي (HLM)' }));
    fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' });
    expect(first).toHaveAttribute('aria-checked', 'true');
  });
});

describe('the form says why the button is unavailable, and the focus follows an error', () => {
  it('the disabled button is described by the hint; arrow keys choose the housing status (LTR)', () => {
    render(wrap(h(DiagnosticPage)));
    const btn = document.getElementById('diag-calculate-btn');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-describedby', 'diag-calculate-hint');
    expect(document.getElementById('diag-calculate-hint')).toHaveTextContent(/date de naissance ou une tranche d'âge, et votre statut d'occupation/);
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-required', 'true');
    const tenant = screen.getByRole('radio', { name: 'Locataire' });
    tenant.focus(); fireEvent.keyDown(tenant, { key: 'ArrowDown' });
    expect(screen.getByRole('radio', { name: 'Locataire HLM' })).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Locataire HLM' }));
    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' }); fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' });   // wraps around
    expect(screen.getByRole('radio', { name: 'Sans domicile fixe' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(document.getElementById('diag-birthdate'), { target: { value: '1992-03-10' } });
    expect(btn).not.toBeDisabled(); expect(btn).not.toHaveAttribute('aria-describedby');
  });
  it('after a failed submit the focus is on the error heading and « Réessayer » is described by the error text', async () => {
    render(wrap(h(DiagnosticPage)));
    reply(503, { error: 'OPENFISCA_UNAVAILABLE' });
    fill('Locataire'); fireEvent.click(document.getElementById('diag-calculate-btn'));
    const title = await screen.findByRole('heading', { name: /n’ont pas pu être obtenues/ });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(screen.getByRole('button', { name: /Réessayer/ })).toHaveAttribute('aria-describedby', 'diag-error-text');
    expect(document.getElementById('diag-error-text')).toHaveTextContent(/Aucun résultat de remplacement/);
  });
});

describe('the shared passport in English and Arabic', () => {
  const mount = (data) => {
    window.history.replaceState(null, '', '/share/s1#capability=abc');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data }) })));
    return render(wrap(h(Routes, null, h(Route, { path: '/share/:id', element: h(SharedDiagnostic) })), ['/share/s1']));
  };
  const data = (viewCount) => ({ createdAt: '2026-10-01T08:00:00Z', expiresAt: '2026-10-08T08:00:00Z', viewCount, situation: { ageBand: '25-59', housingStatus: 'tenant_hlm', employmentStatus: 'retraité', householdSize: 2 }, results: { assessment: ASSESSMENT } });

  it('English: frame, declared answers, plural, one h1 then h2s; no entitlement claim', async () => {
    await act(async () => { await setLanguage('en', { persist: false }); });
    mount(data(1));
    await screen.findByTestId('assessment-item-rsa');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('SHARED PASSPORT');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    for (const s of ['Declared profile', 'Social housing tenant (HLM)', 'Retired', 'Age range:', '1 view of this file', 'It is neither a decision, nor a promise, nor a refusal.']) expect(document.body.textContent).toContain(s);
    noClaim('en', document.body.textContent);
    cleanup(); mount(data(3)); await screen.findByTestId('assessment-item-rsa');
    expect(document.body.textContent).toContain('3 views of this file');
  });
  it('Arabic: the dual plural form, RTL, and the not-found error in Arabic', async () => {
    await act(async () => { await setLanguage('ar', { persist: false }); });
    mount(data(2));
    await screen.findByTestId('assessment-item-rsa');
    expect(document.body.textContent).toContain('عُرض هذا الملف مرتين');
    noClaim('ar', document.body.textContent);
    cleanup();
    window.history.replaceState(null, '', '/share/s1#capability=abc');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ message: 'ATTACKER' }) })));
    render(wrap(h(Routes, null, h(Route, { path: '/share/:id', element: h(SharedDiagnostic) })), ['/share/s1']));
    expect(await screen.findByText('الملف غير موجود أو انتهت صلاحيته.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/ATTACKER/);
    expect(screen.getByRole('link', { name: /العودة إلى الصفحة الرئيسية/ }).closest('button')).toBeNull();   // a link, not a button inside a link
  });
});
