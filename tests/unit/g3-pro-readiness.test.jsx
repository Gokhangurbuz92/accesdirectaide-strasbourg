// @vitest-environment jsdom
/**
 * G3 (19/11/2026) — readiness of a partial ADA Pro opening (SD Track 2/3 gaps A(a), A(b)):
 *   - the server tells the console which modules it serves (api/_utils/pro-modules.js: the same surface + capability gates as the router);
 *   - the console shows a closed module as « pas encore ouvert » (menu, deep link, dashboard) and does not request it — never « indisponible »;
 *   - the professional terms are in force only when the owner's approval names them (Production), drafts elsewhere; nothing here approves them.
 * No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProLayout from '../../src/pages/pro/ProLayout.jsx';
import ProDashboard from '../../src/pages/pro/Dashboard.jsx';
import { moduleOfScreen, moduleOpen, isNotOpenRefusal } from '../../src/lib/proModules.js';
import { PRO_MODULE_ROUTES, proModuleStates } from '../../api/_utils/pro-modules.js';
import { proTermsInForce, proTermsReference, proTermsDocumentsFor } from '../../api/_utils/pro-terms.js';
import { LEGAL_DRAFTS_V6, LEGAL_DRAFTS_V7, LEGAL_DRAFTS_V8, LEGAL_DRAFTS_V9_PRO, LEGAL_DRAFT_DOCUMENTS, LEGAL_DRAFT_STATUS } from '../../src/config/legal-drafts.js';

vi.mock('@/components/NotificationCenter', () => ({ default: () => null }));
vi.mock('@/components/OnboardingTour', () => ({ default: () => null }));

const LAB_HDS = `HDS1:lab-synthetic:G3-SYNTHETIC:2099-12-31:${'0'.repeat(64)}`;
const PRO_ONLY = { ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'admin,accounts,pro', VERCEL_ENV: 'production' };
const CLOSED = { cases: false, referrals: false, selections: false, dossiers: false, agenda: false, outlook: false, video: false, messages: false, team: true, structure: true, reports: true, regional: true, audit: true, employment: false, assist: false };   // X05: the job board needs its own surface and capability; G14-AID: the helper code needs citizen.assisted_mode (out of the AIPD)

describe('G3 server: the module states follow the router gates', () => {
  it('pro opened alone: only account / structure-administration modules', () => {
    expect(proModuleStates(PRO_ONLY)).toEqual(CLOSED);
  });
  it('Production today (admin, accounts): nothing of pro (the console is not reachable anyway); LAB without enforcement: everything', () => {
    expect(Object.values(proModuleStates({ ...PRO_ONLY, ADA_BETA_OPEN_SURFACES: 'admin,accounts' })).every((v) => v === false)).toBe(true);
    expect(Object.values(proModuleStates({ VERCEL_ENV: 'development' })).every((v) => v === true)).toBe(true);
  });
  it('a module opens only with its own gates: agenda with « appointments », cases also with its capability AND the HDS attestation', () => {
    expect(proModuleStates({ ...PRO_ONLY, ADA_BETA_OPEN_SURFACES: 'admin,accounts,pro,appointments' }).agenda).toBe(true);
    expect(proModuleStates({ ...PRO_ONLY, ADA_CAPABILITIES_OPEN: 'pro.case_management' }).cases).toBe(false);
    expect(proModuleStates({ ...PRO_ONLY, ADA_CAPABILITIES_OPEN: 'pro.case_management', ADA_HDS_CERTIFIED_HOSTING: LAB_HDS }).cases).toBe(true);
    expect(proModuleStates({ ...PRO_ONLY, ADA_CAPABILITIES_OPEN: 'citizen.shared_dossier', ADA_HDS_CERTIFIED_HOSTING: LAB_HDS }).dossiers, 'documents surface still closed').toBe(false);
  });
  it('booleans only — no value of the environment leaves the server', () => {
    const s = proModuleStates({ ...PRO_ONLY, ADA_HDS_CERTIFIED_HOSTING: LAB_HDS, ADA_CAPABILITIES_OPEN: 'pro.referrals' });
    expect(Object.keys(s)).toEqual(Object.keys(PRO_MODULE_ROUTES));
    expect(Object.values(s).every((v) => typeof v === 'boolean')).toBe(true);
  });
});

describe('G3 client helpers', () => {
  it('maps the console screens to modules (longest prefix; « /pro/dossier » is not « /pro/dossiers »)', () => {
    expect(moduleOfScreen('/pro/dossiers/12')).toBe('cases');
    expect(moduleOfScreen('/pro/dossier/abc')).toBe('dossiers');
    expect(moduleOfScreen('/pro/rdv/agenda')).toBe('agenda');
    expect(moduleOfScreen('/pro/dashboard')).toBeNull();
    expect(moduleOfScreen('/pro/mfa-settings')).toBeNull();
  });
  it('unknown modules (an older server) count as open; a refusal of a closed function is not an outage', () => {
    expect(moduleOpen(null, 'cases')).toBe(true); expect(moduleOpen({ cases: false }, 'cases')).toBe(false); expect(moduleOpen({ cases: false }, null)).toBe(true);
    expect(isNotOpenRefusal({ status: 503, payload: { error: 'CAPABILITY_NOT_OPEN' } })).toBe(true);
    expect(isNotOpenRefusal({ status: 503, payload: { error: 'PUBLIC_BETA_RESTRICTED' } })).toBe(true);
    expect(isNotOpenRefusal({ status: 503, payload: { error: 'DB_DOWN' } })).toBe(false);
    expect(isNotOpenRefusal({ status: 500 })).toBe(false);
  });
});

describe('G3 console with modules closed', () => {
  let calls;
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  beforeEach(() => {
    calls = [];
    globalThis.localStorage.setItem('pro_token', 't'); globalThis.localStorage.setItem('ada_onboarding_done', '1');
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(String(url));
      if (String(url).startsWith('/api/pro/me')) return { ok: true, status: 200, json: async () => ({ user: { id: 'u', email: 'a@example.test', role: 'STRUCTURE_ADMIN' }, session: { mfa: true, mfaRequired: true }, modules: CLOSED }) };
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ users: [], structure: null }), text: async () => '{}' };
    }));
  });
  const pro = (path) => render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [path] },
    createElement(Routes, null, createElement(Route, { path: '/pro', element: createElement(ProLayout) },
      createElement(Route, { path: 'dashboard', element: createElement(ProDashboard) }), createElement(Route, { path: 'dossiers', element: createElement('p', null, 'Dossiers page') }))))));

  it('the menu marks closed modules « pas encore ouvert » (no link) and leaves out the agenda sub-entries; open ones stay links', async () => {
    pro('/pro/dashboard');
    await screen.findByTestId('pro-dashboard-queue');
    const nav = screen.getAllByRole('navigation')[0];
    const closed = [...nav.querySelectorAll('[data-testid="pro-nav-closed"]')].map((x) => x.textContent);
    expect(closed).toEqual(['Dossiers suivispas encore ouvert', 'Sélections d’orientationpas encore ouvert', 'Orientationspas encore ouvert', 'Agenda RDVpas encore ouvert', 'Messagespas encore ouvert']);
    expect(nav.querySelector('a[href="/pro/dossiers"]')).toBeNull();
    expect(nav.querySelector('a[href="/pro/rdv/new"]')).toBeNull();
    for (const href of ['/pro/team', '/pro/structure', '/pro/regional', '/pro/parametres']) expect(nav.querySelector(`a[href="${href}"]`), href).not.toBeNull();
  });

  it('the dashboard says « pas encore ouverts » — not « indisponible » — and never requests the closed modules', async () => {
    pro('/pro/dashboard');
    expect(await screen.findByTestId('pro-queue-not-open')).toHaveTextContent('pas encore ouverts');
    expect(screen.getByTestId('pro-dashboard-agenda-not-open')).toBeInTheDocument();
    expect(screen.getByTestId('pro-dashboard-messages')).toHaveTextContent('pas encore ouvert');
    expect(screen.queryByText(/indisponible/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Nouveau rendez-vous/ })).toBeNull();
    await waitFor(() => expect(calls.some((u) => u.startsWith('/api/pro/team'))).toBe(true));
    expect(calls.filter((u) => /\/api\/pro\/(cases|referrals|appointments|outlook|messages)/.test(u))).toEqual([]);
  });

  it('a deep link to a closed module shows the « pas encore ouvert » notice instead of the screen', async () => {
    pro('/pro/dossiers');
    expect(await screen.findByTestId('pro-module-not-open')).toHaveTextContent('Pas encore ouvert');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Pas encore ouvert');
    expect(screen.queryByText('Dossiers page')).toBeNull();
  });
});

describe('G3 professional terms', () => {
  it('the drafts stay drafts (nothing approves them here)', () => {
    for (const id of ['cgu-professionnel', 'conditions-structures']) expect(LEGAL_DRAFT_DOCUMENTS.find((d) => d.id === id).status).toBe(LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL);
  });
  it('Production: in force only when the approval names every professional document; outside Production the drafts are accepted', () => {
    const prod = (approved) => proTermsInForce({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: approved });
    expect(prod(undefined)).toBe(false);
    expect(prod(`cgu-citoyen@${LEGAL_DRAFTS_V6},notice-confidentialite@${LEGAL_DRAFTS_V6}`)).toBe(false);
    expect(prod(`cgu-professionnel@${LEGAL_DRAFTS_V7},conditions-structures@${LEGAL_DRAFTS_V7}`)).toBe(false);
    expect(prod(`cgu-professionnel@${LEGAL_DRAFTS_V7},conditions-structures@${LEGAL_DRAFTS_V7},notice-confidentialite@${LEGAL_DRAFTS_V6}`)).toBe(true);
    expect(proTermsInForce({ VERCEL_ENV: 'preview' })).toBe(true);
  });
  it('records the approved version in Production, the newest draft elsewhere; an administrator also accepts the structure conditions', () => {
    expect(proTermsReference('cgu-professionnel', { VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: `cgu-professionnel@${LEGAL_DRAFTS_V6}` })).toBe(`cgu-professionnel@${LEGAL_DRAFTS_V6}`);
    // G4 (19/11/2026): the newest draft of THAT document (v8), not the shared citizen / notice version (v7)
    // G14 (22/11/2026): cgu-professionnel's newest draft is v9-2026-11-22; conditions-structures stays v8
    expect(proTermsReference('cgu-professionnel', { VERCEL_ENV: 'development' })).toBe(`cgu-professionnel@${LEGAL_DRAFTS_V9_PRO}`);
    expect(proTermsReference('conditions-structures', { VERCEL_ENV: 'development' })).toBe(`conditions-structures@${LEGAL_DRAFTS_V8}`);
    expect(proTermsDocumentsFor('STRUCTURE_ADMIN')).toEqual(['cgu-professionnel', 'conditions-structures']);
    expect(proTermsDocumentsFor('PRO')).toEqual(['cgu-professionnel']);
  });
});
