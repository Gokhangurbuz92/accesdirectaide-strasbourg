// @vitest-environment jsdom
/* global window, document, navigator, XMLHttpRequest, Storage */
/**
 * G4 (19/11/2026) — browser-only orientation (src/lib/orientationBrowserOnly.js): with VITE_ORIENTATION_BROWSER_ONLY=1 (exactly) the /orientation wizard
 * and its Plan d'action run entirely in the browser. Proven here: the flag and the beta guard; the result is the server's SIMULATION_MODE contract (no
 * amount, no eligibility, no validated right); a full run of the wizard makes NO request (fetch, XMLHttpRequest, sendBeacon, the directory client, the
 * recommendations client, csrfFetch) and writes NOTHING to localStorage / sessionStorage; « Effacer mes réponses » removes everything; every output string
 * passes the entitlement guards in the six languages; axe serious/critical = 0 in each language, RTL in Arabic. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ structure: 0, recos: 0, csrf: 0 }));
vi.mock('@/api/client', () => ({ client: { entities: { Structure: { filter: async () => { calls.structure += 1; return []; } } } } }));
vi.mock('@/lib/assistant/client', () => ({ postRecommendations: async () => { calls.recos += 1; return { items: [] }; } }));
vi.mock('@/lib/csrf', () => ({ csrfFetch: async () => { calls.csrf += 1; throw new Error('no request expected'); } }));
// the Production build: restricted beta, surfaces admin + accounts (documents closed ⇒ no « Partager »)
vi.mock('@/config/env', async (orig) => {
  const m = await orig();
  return { ...m, frontendEnv: { ...m.frontendEnv, flags: { ...m.frontendEnv.flags, publicBeta: true } } };
});

import Wizard from '../../src/components/assistant/Wizard.jsx';
import BrowserOrientationTopics from '../../src/components/assistant/BrowserOrientationTopics.jsx';
import WizardPrivacyNotice from '../../src/components/assistant/WizardPrivacyNotice.jsx';
import DiagnosticOutcome from '../../src/components/diagnostic/DiagnosticOutcome.jsx';
import { BROWSER_ONLY_FLAG_VALUE, NEED_TOPICS, OPTION_TOPICS, orientationBrowserOnly, orientationTopics, runBrowserOrientation } from '../../src/lib/orientationBrowserOnly.js';
import { isBetaRestrictedPath } from '../../src/lib/publicBeta.js';
import { NEEDS } from '../../src/lib/rightsPublicView.js';
import { runLocalSimulation } from '../../api/lib/LocalRulesEngine.js';
import { simulationResponse } from '../../api/lib/diagnosticAssessment.js';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';
import { ENTITLEMENT_CLAIMS } from '../../scripts/i18n-check.mjs';
import { setLanguage } from '../../src/i18n/index.js';

const SUB = { accountsScope: 'booking', proSelfRegistration: false };
const ANSWERS = { need: 'logement', territory: '67000', situation: 'famille', statut: 'chomage', urgency: 'today', options: ['handicap'],
  birthDate: '1987-04-12', householdSize: '3', salary: '1234', unemployment: '567', rent: '789', charges: '45', housingStatus: 'tenant' };
/** what must never leave the page: the answers' values */
const SECRETS = ['67000', '1987-04-12', '1234', '567', '789', 'handicap', 'logement', 'famille', 'chomage', 'tenant'];
const AMOUNT = /\d\s?€|€\s?\d|\beuros?\b|montant estim|estimated amount/i;
const lang = async (code) => { await act(async () => { await setLanguage(code, { persist: false }); }); };

describe('G4: the build flag and the beta screen guard', () => {
  it('only the exact value « 1 » switches the mode on', () => {
    expect(BROWSER_ONLY_FLAG_VALUE).toBe('1');
    expect(orientationBrowserOnly('1')).toBe(true);
    for (const v of [undefined, '', '0', 'true', 'yes', ' 1', '1 ', 1, true]) expect(orientationBrowserOnly(v), String(v)).toBe(false);
  });
  it('flag on: /orientation is no longer behind the beta notice; /diagnostic, /assistant and the accounts stay where they were', () => {
    const open = ['admin', 'accounts'];
    expect(isBetaRestrictedPath('/orientation', open, SUB, false)).toBe(true);
    expect(isBetaRestrictedPath('/orientation', open, SUB, true)).toBe(false);
    expect(isBetaRestrictedPath('/orientation/', open, SUB, true)).toBe(false);
    for (const p of ['/diagnostic', '/assistant', '/mon-assistant', '/compte/parcours', '/share/x']) expect(isBetaRestrictedPath(p, open, SUB, true), p).toBe(true);
  });
  it('the guard reads VITE_ORIENTATION_BROWSER_ONLY of the build (exact « 1 »)', () => {
    vi.stubEnv('VITE_ORIENTATION_BROWSER_ONLY', 'true');
    expect(isBetaRestrictedPath('/orientation', [], SUB)).toBe(true);
    vi.stubEnv('VITE_ORIENTATION_BROWSER_ONLY', '1');
    expect(isBetaRestrictedPath('/orientation', [], SUB)).toBe(false);
    expect(orientationBrowserOnly()).toBe(true);
    vi.unstubAllEnvs();
    expect(orientationBrowserOnly()).toBe(false);
  });
});

describe('G4: the result is the SIMULATION_MODE contract, computed here', () => {
  it('same assessment as the server chain for the same answers, without request id; no amount, no eligibility, no validated right', () => {
    const { result } = runBrowserOrientation(ANSWERS);
    expect(result.authoritative).toBe(false);
    expect(result.provenance).toMatchObject({ source: 'local-rules-engine', authoritative: false, dataStatus: 'UNVERIFIED' });
    expect(result.meta.requestId).toBeUndefined();
    expect(result).not.toHaveProperty('rights');
    const answers = { birthDate: '1987-04-12', householdSize: 3, territory: '67000', statut: 'sans_emploi', income: { salary: 1234, unemployment: 567 }, housing: { rent: 789, charges: 45, status: 'tenant' } };
    expect(result.assessment).toEqual(simulationResponse(runLocalSimulation(answers), answers, {}).assessment);
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/"eligible"|ELIGIBLE_WHERE_AUTHORITY_VERIFIED|estimatedAmount|montant/i);
    for (const item of result.assessment.items) { expect(item.amount ?? null).toBeNull(); expect(item.amountStatus ?? 'NOT_PROVIDED_NO_AUTHORITY').toBe('NOT_PROVIDED_NO_AUTHORITY'); }
    expect(claimsEntitlement(json)).toBe(false);
    for (const item of result.assessment.items) expect(['MISSING_INFORMATION', 'CHECK_REQUIRED', 'UNSUPPORTED', 'NOT_APPLICABLE_WHERE_PROVEN']).toContain(item.state);
  });
  it('unreadable answers (no date, no band) fail with the server\'s code, never a result', () => {
    expect(() => runBrowserOrientation({ need: 'logement', housingStatus: 'tenant' })).toThrow(expect.objectContaining({ code: 'validation_error' }));
  });
  it('topics: each choice points to existing Rights Graph needs; « handicap » is a topic only; urgent first, each once', () => {
    const ids = new Set(NEEDS.map((n) => n.id));
    for (const list of [...Object.values(NEED_TOPICS), ...Object.values(OPTION_TOPICS)]) for (const id of list) expect(ids.has(id), id).toBe(true);
    const topics = orientationTopics(ANSWERS).map((n) => n.id);
    expect(topics).toEqual([...new Set(topics)]);
    expect(topics).toEqual(expect.arrayContaining(['aides-logement', 'mdph-droits', 'prestations-familiales', 'recherche-emploi']));
    const prio = orientationTopics(ANSWERS).map((n) => n.priority);
    expect(prio).toEqual([...prio].sort((a, b) => a - b));
    expect(orientationTopics({ need: '__proto__', options: ['constructor'] })).toEqual([]);
  });
});

describe('G4: a full run of the wizard sends nothing and stores nothing', () => {
  /** @type {any} */ let fetchSpy; /** @type {any} */ let xhrOpen; /** @type {any} */ let beacon; /** @type {any} */ let setItem;
  beforeEach(() => {
    vi.stubEnv('VITE_ORIENTATION_BROWSER_ONLY', '1');
    vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', 'admin,accounts');
    calls.structure = 0; calls.recos = 0; calls.csrf = 0;
    window.localStorage.clear(); window.sessionStorage.clear();
    fetchSpy = vi.fn(async () => { throw new Error('no fetch expected'); });
    vi.stubGlobal('fetch', fetchSpy);
    xhrOpen = vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => { throw new Error('no XHR expected'); });
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    setItem = vi.spyOn(Storage.prototype, 'setItem');
  });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const runWizard = () => {
    const view = render(h(MemoryRouter, null, h(Wizard)));
    expect(screen.getByTestId('wizard-privacy-notice')).toHaveAttribute('data-mode', 'browser-only');
    expect(screen.getByTestId('wizard-privacy-local')).toHaveTextContent('ne sont envoyées à aucun serveur');
    fireEvent.click(screen.getByRole('button', { name: 'Logement' }));
    fireEvent.change(screen.getByLabelText('Ville ou code postal'), { target: { value: '67000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Avec enfant(s)' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Sans emploi' }));
    expect(screen.getByText(/ne sont ni envoyées ni enregistrées/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    fireEvent.click(screen.getByRole('radio', { name: "Aujourd'hui" }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Situation de handicap' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(screen.getByText(/Le calcul se fait dans votre navigateur/)).toBeInTheDocument();
    fireEvent.change(document.getElementById('diag-birthdate'), { target: { value: '1987-04-12' } });
    fireEvent.change(document.getElementById('diag-household'), { target: { value: '3' } });
    fireEvent.change(document.getElementById('diag-salary'), { target: { value: '1234' } });
    fireEvent.change(document.getElementById('diag-unemployment'), { target: { value: '567' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Locataire' }));
    fireEvent.change(document.getElementById('diag-rent'), { target: { value: '789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Voir les pistes à vérifier' }));
    return view;
  };
  const nothingLeft = () => {
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(calls).toEqual({ structure: 0, recos: 0, csrf: 0 });
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  };

  it('needs → fiches / bodies / places, then the assessment and the Plan d\'action — no request, no storage, no « Partager », no assistant', async () => {
    runWizard();
    const results = await screen.findByTestId('wizard-diagnostic-results');
    expect(results).toHaveAttribute('data-mode', 'browser-only');
    const topics = screen.getAllByTestId('local-topic').map((x) => x.getAttribute('data-need'));
    expect(topics).toEqual(expect.arrayContaining(['aides-logement', 'mdph-droits', 'prestations-familiales', 'recherche-emploi']));
    expect(screen.getAllByTestId('local-topic-fiches').length).toBeGreaterThan(0);
    expect(screen.getByTestId('action-plan')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-step-share')).toBeNull();
    expect(screen.queryByRole('button', { name: /Partager le dossier/ })).toBeNull();
    expect(screen.queryByTestId('diagnostic-ask-assistant')).toBeNull();
    expect(screen.queryByTestId('plan-structures')).toBeNull();
    expect(screen.queryByTestId('need-recommendations')).toBeNull();
    expect(document.body.textContent).not.toMatch(/ID : /);
    expect(claimsEntitlement(results.textContent)).toBe(false);
    expect(results.textContent).not.toMatch(AMOUNT);
    nothingLeft();
  });

  it('« Effacer mes réponses » removes the answers and the result, says so, and puts the focus back on the questionnaire', async () => {
    runWizard();
    await screen.findByTestId('wizard-diagnostic-results');
    fireEvent.click(screen.getAllByTestId('wizard-erase')[0]);
    expect(screen.queryByTestId('wizard-diagnostic-results')).toBeNull();
    expect(screen.getByTestId('wizard-erased')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('heading', { name: 'Quel est votre besoin principal ?' })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('region', { name: /Questionnaire d.orientation/ }));
    for (const s of SECRETS.filter((x) => /\d/.test(x))) expect(document.body.textContent, s).not.toContain(s);
    nothingLeft();
  });

  it('a copy left in the tab by the server mode is deleted, never read', () => {
    window.sessionStorage.setItem('ada_wizard_state', JSON.stringify({ data: { step: 3, data: { need: 'sante', territory: '67000' } }, timestamp: Date.now() }));
    setItem.mockClear();
    render(h(MemoryRouter, null, h(Wizard)));
    expect(screen.getByRole('heading', { name: 'Quel est votre besoin principal ?' })).toBeInTheDocument();
    expect(window.sessionStorage.getItem('ada_wizard_state')).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe('G4: every output string in the six languages — entitlement guards, no amount, axe, RTL', () => {
  const OUTCOMES = [ANSWERS, { need: 'urgence', statut: 'hebergement', ageBand: '18-24', housingStatus: 'homeless' }, { need: 'papiers', ageBand: '60-et-plus', housingStatus: 'owner', options: ['langue', 'numerique'] }]
    .map((a) => runBrowserOrientation(a));
  beforeAll(() => { vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', 'admin,accounts'); });
  afterAll(async () => { vi.unstubAllEnvs(); await lang('fr'); });
  afterEach(() => cleanup());

  it.each(['fr', 'en', 'de', 'tr', 'ar', 'uk'])('%s', async (code) => {
    await lang(code);
    expect(document.documentElement.getAttribute('dir')).toBe(code === 'ar' ? 'rtl' : 'ltr');
    const { container } = render(h(MemoryRouter, null,
      h('main', null,
        h('h1', null, 'Orientation'),
        h(WizardPrivacyNotice, { local: true }),
        h(BrowserOrientationTopics, { topics: NEEDS }),   // every topic the wizard can show
        ...OUTCOMES.map((o, i) => h('div', { key: i }, h(DiagnosticOutcome, { results: o.result, situation: o.situation, local: true }))))));
    const text = container.textContent;
    expect(claimsEntitlement(text)).toBe(false);
    if (code !== 'fr') expect(ENTITLEMENT_CLAIMS[code].test(text)).toBe(false);
    expect(text).not.toMatch(AMOUNT);
    expect(text).not.toMatch(/éligible|eligible|vous avez droit/i);
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false }, 'duplicate-id': { enabled: false }, 'duplicate-id-aria': { enabled: false }, 'landmark-unique': { enabled: false } } });
    expect(res.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  it('the new interface strings themselves (6 languages) never claim a right', async () => {
    const fs = await import('node:fs');
    for (const code of ['en', 'de', 'tr', 'ar', 'uk']) {
      const loc = JSON.parse(fs.readFileSync(`src/i18n/locales/${code}/diagnostic.json`, 'utf8'));
      const mine = Object.entries(loc).filter(([k]) => k.startsWith('wizard.local.'));
      expect(mine.length).toBe(14);
      for (const [k, v] of mine) { expect(ENTITLEMENT_CLAIMS[code].test(v), k).toBe(false); expect(claimsEntitlement(v), k).toBe(false); }
    }
    const src = ['src/components/assistant/Wizard.jsx', 'src/components/assistant/WizardPrivacyNotice.jsx', 'src/components/assistant/BrowserOrientationTopics.jsx',
      'src/components/assistant/StepDiagnostic.jsx', 'src/components/assistant/StepProfile.jsx'].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    expect(claimsEntitlement(src)).toBe(false);
  });
});
