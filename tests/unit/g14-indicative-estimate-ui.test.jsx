// @vitest-environment jsdom
/* global document, window */
/**
 * G14 (23/11/2026) — /diagnostic with the self-hosted OpenFisca engine (mocked server):
 *  - not offered (no engine, capability closed, …): exactly the former page — one POST in SIMULATION_MODE, no estimate panel (DTA-B1/B2/B3/B11 unchanged);
 *  - offered: one POST in AUTHORITATIVE_MODE with the questionnaire's answers only, the « Estimation indicative » panel (amount only when the server gave
 *    one, « Seul l'organisme … décide de vos droits », the legislation date, official links, « À vérifier auprès de l'organisme compétent »), and the same
 *    orientation computed in the browser (no SIMULATION_MODE request);
 *  - quota reached / engine unavailable: the former behaviour plus a fixed notice;
 *  - six languages without an entitlement claim; axe (serious/critical) clean; focus on the estimate heading. jsdom: no layout (320 px reflow is a browser check).
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DiagnosticPage from '../../src/pages/DiagnosticPage.jsx';
import { setLanguage } from '../../src/i18n/index.js';
import { ENTITLEMENT_CLAIMS } from '../../scripts/i18n-check.mjs';
import { ENTITLEMENT_CLAIM } from '../../api/lib/entitlementWording.js';

const prov = { source: null, verifiedAt: null, territory: null, rule: null, uncertainty: 'ORIENTATION_NON_OFFICIELLE', display: { source: 's', verifiedAt: 'v', territory: 't', rule: 'r', uncertainty: 'u' } };
const ASSESSMENT = { contract: 'ADA_ASSESSMENT_CONTRACT_V1', authoritative: false, leadsEnabled: false, dataStatus: 'UNVERIFIED', referenceDate: '2026-11-01', totals: null, items: [
  { code: 'rsa', label: 'RSA', state: 'CHECK_REQUIRED', authoritative: false, amount: null, amountStatus: 'NOT_PROVIDED_NO_AUTHORITY', missingFacts: [], whoToAsk: 'votre CAF', explanation: 'x', explanationFalc: 'x', provenance: prov },
] };
const CITIZEN = { contract: 'ADA_CITIZEN_ESTIMATE_V1', kind: 'ESTIMATION_INDICATIVE', authoritative: false, period: '2026-11', engine: { name: 'openfisca-france', version: '176.1.6' },
  decidesNotice: 'x', verifyNotice: 'x', assumptions: ['Les revenus déclarés pour le mois sont supposés identiques.'], items: [
    { code: 'prime_activite', label: 'Prime d’activité', status: 'INDICATIVE_ESTIMATE', monthlyAmount: 190, amountWithheld: null, legislation: { inForceFrom: '2026-04-01', label: 'x' }, organisme: 'Caf (ou MSA)',
      officialLinks: [{ kind: 'fiche', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2882' }, { kind: 'simulator', url: 'https://www.caf.fr/allocataires/mes-services-en-ligne/estimer-vos-droits' }],
      ruleValidation: 'NOT_EXPERT_VALIDATED', verifyWithOrganism: true, missing: [] },
    { code: 'apl', label: 'APL', status: 'INSUFFICIENT_INFORMATION', monthlyAmount: null, amountWithheld: 'MISSING_INPUTS', legislation: null, organisme: 'Caf (ou MSA)',
      officialLinks: [{ kind: 'fiche', url: 'https://evil.example.com/phish' }], ruleValidation: 'NOT_EXPERT_VALIDATED', verifyWithOrganism: true, missing: ['commune'] },
  ] };

const wrap = (el) => h(HelmetProvider, null, h(MemoryRouter, { initialEntries: ['/diagnostic'] }, el));
/** a server: availability answer, authoritative answer, simulation answer; records every request */
function server({ availability, authoritative, simulation = { status: 200, body: { assessment: ASSESSMENT } } }) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const u = String(url); const body = init.body ? JSON.parse(init.body) : null; calls.push({ u, method: init.method || 'GET', body });
    const res = (status, b) => ({ ok: status === 200, status, json: async () => b, headers: { get: () => null } });
    if (u.endsWith('/api/diagnostic/estimate-availability')) return availability ? res(availability.status, availability.body) : res(503, { error: 'CAPABILITY_CLOSED' });
    if (u.endsWith('/api/diagnostic') && body?.mode === 'AUTHORITATIVE_MODE') return res(authoritative.status, authoritative.body);
    if (u.endsWith('/api/diagnostic')) return res(simulation.status, simulation.body);
    return res(200, {});
  }));
  return calls;
}
const fill = (housing = 'Locataire') => {
  fireEvent.change(document.getElementById('diag-birthdate'), { target: { value: '1990-04-12' } });
  fireEvent.click(screen.getByRole('radio', { name: housing }));
  fireEvent.change(document.getElementById('diag-salary'), { target: { value: '1100' } });
};
const submit = () => fireEvent.click(document.getElementById('diag-calculate-btn'));
const posts = (calls) => calls.filter((c) => c.method === 'POST' && c.u.endsWith('/api/diagnostic'));
const axeBad = async (el) => (await axe.run(el, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })).violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id);

beforeEach(() => { window.localStorage.clear(); document.cookie = '__csrf=t; path=/'; });
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await act(async () => { await setLanguage('fr', { persist: false }); }); });

describe('not offered: the former page, unchanged', () => {
  it('availability refused (capability closed) or false: one POST in SIMULATION_MODE, no estimate panel, no notice', async () => {
    for (const availability of [null, { status: 200, body: { available: false, reason: 'OPENFISCA_NOT_CONFIGURED' } }]) {
      const calls = server({ availability, authoritative: { status: 500, body: {} } });
      render(wrap(h(DiagnosticPage))); fill(); submit();
      await screen.findByTestId('assessment-region');
      expect(posts(calls).map((c) => c.body.mode)).toEqual(['SIMULATION_MODE']);
      expect(screen.queryByTestId('indicative-estimate')).toBeNull(); expect(screen.queryByTestId('estimate-unavailable')).toBeNull();
      cleanup();
    }
  });
});

describe('offered: the indicative estimate', () => {
  it('one POST in AUTHORITATIVE_MODE with the questionnaire answers only; the panel says who decides, the legislation date, the links, « À vérifier »; the orientation is computed locally', async () => {
    const calls = server({ availability: { status: 200, body: { available: true, reason: null } }, authoritative: { status: 200, body: { citizen: CITIZEN } } });
    const { container } = render(wrap(h(DiagnosticPage))); fill(); submit();
    const panel = await screen.findByTestId('indicative-estimate');
    expect(posts(calls).map((c) => c.body.mode)).toEqual(['AUTHORITATIVE_MODE']);
    expect(Object.keys(posts(calls)[0].body.answers).sort()).toEqual(['birthDate', 'householdSize', 'housing', 'income', 'statut', 'territory']);
    expect(screen.getByRole('heading', { name: 'Estimation indicative' })).toBeInTheDocument();
    expect(screen.getByTestId('estimate-decides')).toHaveTextContent('Seul l’organisme (CAF, CPAM, Département…) décide de vos droits.');
    const ppa = screen.getByTestId('estimate-item-prime_activite');
    expect(ppa.querySelector('[data-testid="estimate-amount"]').textContent).toMatch(/Montant estimé : environ 190\s?€ par mois\./);
    expect(ppa.querySelector('[data-testid="estimate-legislation"]')).toHaveTextContent(/^Règles en vigueur au 1(er)? avril 2026\.$/);
    expect(ppa).toHaveTextContent('À vérifier auprès de l’organisme compétent.');
    expect(ppa.querySelectorAll('a[target="_blank"][rel~="noopener"]')).toHaveLength(2);
    const apl = screen.getByTestId('estimate-item-apl');
    expect(apl.querySelector('[data-testid="estimate-amount"]')).toBeNull();
    expect(apl).toHaveTextContent('Pas de montant : il manque des informations.'); expect(apl).toHaveTextContent('votre commune (question « Commune »)');
    expect(apl.querySelectorAll('a')).toHaveLength(0);   // a link that is not an official domain is never rendered
    expect(apl.querySelector('[lang="fr"]')).toHaveTextContent('APL');
    expect(await screen.findByTestId('assessment-region')).toBeInTheDocument();   // the orientation, computed in the browser
    await waitFor(() => expect(document.activeElement?.id).toBe('estimate-title'));
    expect(ENTITLEMENT_CLAIM.test(panel.textContent)).toBe(false);
    expect(await axeBad(container)).toEqual([]);
  });

  it('quota reached (at availability or at the call): the former SIMULATION_MODE result plus the fixed notice', async () => {
    for (const [availability, authoritative] of [
      [{ status: 200, body: { available: false, reason: 'OPENFISCA_QUOTA_REACHED' } }, { status: 500, body: {} }],
      [{ status: 200, body: { available: true, reason: null } }, { status: 503, body: { error: 'OPENFISCA_QUOTA_REACHED' } }],
    ]) {
      const calls = server({ availability, authoritative });
      render(wrap(h(DiagnosticPage))); fill(); submit();
      await screen.findByTestId('assessment-region');
      expect(posts(calls).at(-1).body.mode).toBe('SIMULATION_MODE');
      expect(screen.getByTestId('estimate-unavailable')).toHaveTextContent('Le calcul indicatif est suspendu jusqu’au début du mois prochain');
      expect(screen.queryByTestId('indicative-estimate')).toBeNull();
      cleanup();
    }
  });

  it('engine unavailable or a network error: the former result plus the « momentanément indisponible » notice', async () => {
    server({ availability: { status: 200, body: { available: true } }, authoritative: { status: 503, body: { error: 'OPENFISCA_UNAVAILABLE' } } });
    render(wrap(h(DiagnosticPage))); fill(); submit();
    await screen.findByTestId('assessment-region');
    expect(screen.getByTestId('estimate-unavailable')).toHaveTextContent('momentanément indisponible');
  });
});

describe('the commune question (closed list of the Eurométropole)', () => {
  it('lists the 33 communes of the directory reference plus « Autre commune »; the INSEE code goes only in the AUTHORITATIVE request', async () => {
    const calls = server({ availability: { status: 200, body: { available: true } }, authoritative: { status: 200, body: { citizen: CITIZEN } } });
    render(wrap(h(DiagnosticPage)));
    const select = document.getElementById('diag-commune');
    expect(document.querySelector('label[for="diag-commune"]')).toHaveTextContent('Commune (facultatif)');
    const values = [...select.options].map((o) => o.value);
    expect(values[0]).toBe(''); expect(values.at(-1)).toBe('AUTRE'); expect(values).toHaveLength(35);
    expect(values).toContain('67482'); expect(values.slice(1, -1).every((v) => /^67\d{3}$/.test(v))).toBe(true);
    fill(); fireEvent.change(select, { target: { value: '67218' } }); submit();
    await screen.findByTestId('indicative-estimate');
    expect(posts(calls)[0].body.answers.depcom).toBe('67218');
  });
  it('« Autre commune … hors Eurométropole »: no code is sent and the housing aid says why there is no amount', async () => {
    const calls = server({ availability: { status: 200, body: { available: true } }, authoritative: { status: 200, body: { citizen: CITIZEN } } });
    render(wrap(h(DiagnosticPage)));
    fill(); fireEvent.change(document.getElementById('diag-commune'), { target: { value: 'AUTRE' } }); submit();
    await screen.findByTestId('indicative-estimate');
    expect(posts(calls)[0].body.answers.depcom).toBeUndefined();
    const apl = screen.getByTestId('estimate-item-apl');
    expect(apl.querySelector('[data-testid="estimate-commune-outside"]')).toHaveTextContent('que pour les communes de l’Eurométropole de Strasbourg');
    expect(apl).not.toHaveTextContent('Il faudrait connaître');
  });
  it('the SIMULATION_MODE request never carries the commune', async () => {
    const calls = server({ availability: { status: 200, body: { available: false } }, authoritative: { status: 500, body: {} } });
    render(wrap(h(DiagnosticPage)));
    fill(); fireEvent.change(document.getElementById('diag-commune'), { target: { value: '67482' } }); submit();
    await screen.findByTestId('assessment-region');
    expect(posts(calls)[0].body.mode).toBe('SIMULATION_MODE'); expect(JSON.stringify(posts(calls)[0].body)).not.toContain('67482');
  });
});

describe('six languages: the frame is translated, the aide names stay French, never an entitlement claim; axe clean in Arabic', () => {
  for (const lang of ['en', 'tr', 'ar', 'de', 'uk']) {
    it(lang, async () => {
      await act(async () => { await setLanguage(lang, { persist: false }); });
      server({ availability: { status: 200, body: { available: true } }, authoritative: { status: 200, body: { citizen: CITIZEN } } });
      const { container } = render(wrap(h(DiagnosticPage)));
      fireEvent.change(document.getElementById('diag-birthdate'), { target: { value: '1990-04-12' } });
      fireEvent.click(screen.getAllByRole('radio')[0]);
      submit();
      const panel = await screen.findByTestId('indicative-estimate');
      expect(panel.textContent).not.toContain('Estimation indicative');
      expect(panel.textContent).not.toContain('À vérifier auprès');
      expect(ENTITLEMENT_CLAIMS[lang].test(panel.textContent)).toBe(false);
      expect(screen.getByTestId('estimate-item-prime_activite').querySelector('[lang="fr"]')).toHaveTextContent('Prime d’activité');
      if (lang === 'ar') expect(await axeBad(container)).toEqual([]);
    });
  }
});
