// @vitest-environment jsdom
/**
 * DTA S1 stage 2b (UI side) — U1–U10 of DTA_S1_STAGE2B_PLAN.md: negative tests that failed on the RC6 stage-2a page and must pass after the correction.
 * jsdom + React Testing Library + axe-core.  jsdom has no layout engine: colour contrast, focus visuals and real screen-reader behaviour are NOT proven here
 * (axe `color-contrast` is disabled; manual SR audit stays NEEDS_HUMAN).  No JSX in the test body: the repo ESLint config does not parse JSX in tests/.
 */
/* global document, window */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import DiagnosticPage from '../../src/pages/DiagnosticPage.jsx';
import SharedDiagnostic from '../../src/pages/SharedDiagnostic.jsx';
import AssessmentView from '../../src/components/diagnostic/AssessmentView.jsx';
import { readAssessment, shareableResults } from '../../src/lib/assessmentLabels.js';
import { letterAssessmentLines, passportAssessmentLines, PASSPORT_TEXT } from '../../src/lib/passportContent.js';
import { PRIVACY_TEXT } from '../../src/components/diagnostic/PrivacyNotice.jsx';

const read = (p) => readFileSync(p, 'utf8');
const SURFACES = ['src/pages/DiagnosticPage.jsx', 'src/components/diagnostic/DiagnosticOutcome.jsx', 'src/components/diagnostic/AssessmentView.jsx', 'src/components/diagnostic/PrivacyNotice.jsx', 'src/pages/SharedDiagnostic.jsx', 'src/pages/pro/SharedDossier.jsx', 'src/lib/pdf-generator.js', 'src/lib/passportContent.js', 'src/lib/assessmentLabels.js'];

const prov = { source: null, verifiedAt: null, territory: null, rule: null, uncertainty: 'ORIENTATION_NON_OFFICIELLE', display: {
  source: 'Source : aucune — simulation locale, pas une source officielle', verifiedAt: 'Vérifié le : non vérifié', territory: 'Territoire : non précisé',
  rule: 'Règle : aucune règle officielle appliquée (repère indicatif local)', uncertainty: 'Incertitude : ORIENTATION_NON_OFFICIELLE' } };
const item = (code, label, state, extra = {}) => ({ code, label, state, authoritative: false, amount: null, amountStatus: 'NOT_PROVIDED_NO_AUTHORITY', missingFacts: [], whoToAsk: 'votre CAF',
  explanation: 'Ceci est une pré-orientation indicative : ce n\'est ni une réponse ni un refus. Faites vérifier votre situation auprès de votre CAF.', explanationFalc: 'Ce résultat n\'est pas une décision. Demandez à votre CAF de regarder votre situation.', provenance: prov, ...extra });
const ASSESSMENT = { contract: 'ADA_ASSESSMENT_CONTRACT_V1', authoritative: false, leadsEnabled: false, dataStatus: 'UNVERIFIED', referenceDate: '2026-09-01', totals: null, items: [
  item('rsa', 'RSA', 'CHECK_REQUIRED'), item('apl', 'APL', 'MISSING_INFORMATION', { missingFacts: ['housing.rent'], whoToAsk: null, explanation: 'Il manque des informations pour orienter votre demande.', explanationFalc: 'Il manque des informations.' }),
  item('apa', 'APA (Département)', 'UNSUPPORTED', { whoToAsk: null, explanation: 'ADA ne dispose pas encore de règle vérifiée pour ce dispositif. Rien n\'est affirmé à son sujet.', explanationFalc: 'ADA ne sait pas encore vous répondre pour cette aide.' }),
] };
// a response in the OLD shape (what the stage-2a API returned): eligible flags + amounts + a legacy-looking extra; must never reach the screen
const LEGACY_RIGHTS = [{ code: 'rsa', label: 'RSA', eligible: true, amount: 500.5 }, { code: 'apl', label: 'APL', eligible: false, amount: 0 }];
const RESPONSE = { assessment: ASSESSMENT, provenance: { source: 'local-rules-engine', engineVersion: 'v1', referenceDate: '2026-09-01', authoritative: false, dataStatus: 'UNVERIFIED' }, period: '2026-09', rights: LEGACY_RIGHTS, totalMonthly: 500.5, meta: { requestId: 'r1', duration_ms: 3 } };

let calls;
const fetchWith = (diagnostic, share) => vi.fn(async (url, init) => {
  calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
  if (url === '/api/diagnostic') return { ok: diagnostic.status === 200, status: diagnostic.status, json: async () => diagnostic.body };
  if (url === '/api/share/create') return { ok: true, status: 200, json: async () => share || { shareId: 's1', shareUrl: '/share/s1#capability=abc', ownerSecret: 'o', passportUrl: '/passport/s1#owner=o', expiresAt: '2030-01-01T00:00:00Z' } };
  return { ok: false, status: 404, json: async () => ({}) };
});
const wrap = (el) => createElement(HelmetProvider, null, createElement(MemoryRouter, null, el));
const fill = () => {
  fireEvent.change(document.getElementById('diag-birthdate'), { target: { value: '1992-03-10' } });
  fireEvent.click(screen.getByRole('radio', { name: 'Locataire' }));
};
const run = async (diagnostic) => {
  vi.stubGlobal('fetch', fetchWith(diagnostic));
  const view = render(wrap(createElement(DiagnosticPage)));
  fill();
  fireEvent.click(document.getElementById('diag-calculate-btn'));
  return view;
};

// DTA S1C: SharedDiagnostic now bootstraps the __csrf cookie itself on a first visit (covered in dta-s1c-csrf-bootstrap.test.jsx); these S1B rendering tests model a visitor who already has it.
beforeEach(() => { calls = []; window.localStorage.clear(); document.cookie = '__csrf=ui-test-token; path=/'; Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.cookie = '__csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'; });

describe('U1 — the false claims are gone from every surface (source level)', () => {
  it('no "règles de calcul officielles", "stockées localement", "Estimation totale", "non applicables", eligible-wording, totals, euro formatting or "Certifié OpenFisca"', () => {
    const banned = [/règles? de calcul officielle/i, /stockées localement/i, /restent stockées/i, /Estimation totale/i, /non applicables?/i, /pourriez prétendre/i, /totalMonthly/, /toLocaleString\('fr-FR'\)\s*\}?\s*€/, /Certifié OpenFisca/i, /Moteur OpenFisca/, /Éligibilités? Estimées/i, /\beligibleRights\b/, /\bÉligible\b/, /right\.amount/];
    for (const f of SURFACES) for (const b of banned) expect(read(f), `${f} ${b}`).not.toMatch(b);
  });
  it('the pinned strings of the earlier UI contract are still present (badge, disclaimer, roles)', () => {
    const p = read('src/pages/DiagnosticPage.jsx');
    expect(p).toContain('Simulation locale — indicative et non-opposable');
    expect(p).toContain('data-testid="simulation-mode-badge"');
  });
});

describe('U2 — no amount, total or entitlement wording reaches the DOM, even if the response still carries legacy fields', () => {
  it('renders the contract states only', async () => {
    await run({ status: 200, body: RESPONSE });
    await screen.findByTestId('assessment-region');
    const text = screen.getByTestId('diagnostic-results').textContent;                       // the result area (the form labels legitimately contain "€/mois")
    expect(text).not.toMatch(/€|\/ mois|par mois|500|éligible|vous avez droit|droit à|total/i);
    expect(screen.getByRole('button', { name: /Obtenir mes pistes d.orientation/ })).toBeInTheDocument();   // the action no longer promises "droits"
    expect(screen.getByTestId('assessment-state-rsa')).toHaveTextContent('À faire vérifier');
    expect(screen.getByTestId('assessment-state-apl')).toHaveTextContent('Informations manquantes');
    expect(screen.getByTestId('assessment-state-apa')).toHaveTextContent('Pas encore évalué par ADA');
  });
  it('a response in the OLD shape (no assessment) shows "Résultat indisponible", never a result', async () => {
    await run({ status: 200, body: { rights: LEGACY_RIGHTS, period: '2026-09', meta: { requestId: 'x', duration_ms: 1 } } });
    await screen.findByTestId('assessment-unavailable');
    expect(document.body.textContent).not.toMatch(/500|éligible|RSA/);
  });
});

describe('U3 — nothing is shown as verified without authority and provenance', () => {
  it('forged authoritative / incomplete items are dropped; with none valid the page says "Résultat indisponible"', () => {
    const forged = item('rsa', 'RSA', 'ELIGIBLE_WHERE_AUTHORITY_VERIFIED', { authoritative: true });
    const incomplete = item('apl', 'APL', 'CHECK_REQUIRED', { provenance: { ...prov, display: { source: 'x' } } });
    const withAmount = item('faj', 'FAJ', 'CHECK_REQUIRED', { amount: 120 });
    expect(readAssessment({ assessment: { items: [forged, incomplete, withAmount] } })).toMatchObject({ usable: false, rejected: 3 });
    render(wrap(createElement(AssessmentView, { results: { assessment: { items: [forged, incomplete, withAmount] } } })));
    expect(screen.getByTestId('assessment-unavailable')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/éligible|vérifié par|confirmé/i);
  });
  it('a mixed list keeps the valid item and drops the forged one', () => {
    const forged = item('apl', 'APL', 'NOT_APPLICABLE_WHERE_PROVEN', { authoritative: true });
    render(wrap(createElement(AssessmentView, { results: { assessment: { items: [item('rsa', 'RSA', 'CHECK_REQUIRED'), forged] } } })));
    expect(screen.getByTestId('assessment-item-rsa')).toBeInTheDocument();
    expect(screen.queryByTestId('assessment-item-apl')).toBeNull();
  });
});

describe('U4 — the data-status banner never says verified', () => {
  it('"Données en cours de vérification." is shown; no "vérifié"/"à jour" status claim', async () => {
    await run({ status: 200, body: RESPONSE });
    expect(await screen.findByTestId('data-status-banner')).toHaveTextContent('Données en cours de vérification.');
    const text = screen.getByTestId('diagnostic-results').textContent.replace(/non vérifié/gi, '').replace(/Vérifié le/gi, '').replace(/pas encore de règle vérifiée/gi, '');   // honest negatives are allowed
    expect(text).not.toMatch(/vérifié|à jour/i);
  });
});

describe('U5 — a "to be verified" item is neither an answer nor a refusal', () => {
  it('says so, and never "non applicable" / "pas de droit"', async () => {
    await run({ status: 200, body: RESPONSE });
    const rsa = await screen.findByTestId('assessment-item-rsa');
    expect(rsa.textContent).toMatch(/ni une réponse ni un refus|n.est pas une décision/);
    expect(document.body.textContent).not.toMatch(/non applicable|pas de droit|aucun droit|pas éligible/i);
    expect(document.querySelector('[data-testid="assessment-region"] svg.lucide-circle-x, [data-testid="assessment-region"] svg.lucide-x-circle')).toBeNull();
  });
});

describe('U6 — every rendered state carries the five provenance lines (missing => explicit "non disponible / non vérifié")', () => {
  it('source, verifiedAt, territory, rule, uncertainty for each item', async () => {
    await run({ status: 200, body: RESPONSE });
    await screen.findByTestId('assessment-region');
    for (const code of ['rsa', 'apl', 'apa']) for (const k of ['source', 'verifiedAt', 'territory', 'rule', 'uncertainty']) {
      expect(screen.getByTestId(`provenance-${code}-${k}`).textContent.length).toBeGreaterThan(5);
    }
    expect(screen.getByTestId('provenance-rsa-verifiedAt')).toHaveTextContent('non vérifié');
  });
});

describe('U7 — privacy wording: transmitted to the server, technical info recorded, sharing separate; no browser-only / nothing-stored claim', () => {
  it('shows the owner-supplied provisional wording once, the sharing sentence apart, and links to the existing privacy page', () => {
    render(wrap(createElement(DiagnosticPage)));
    const box = screen.getAllByTestId('privacy-notice');
    expect(box).toHaveLength(1);
    expect(box[0]).toHaveTextContent('Pour réaliser ce diagnostic, vos réponses sont transmises à notre serveur. Des informations techniques sur le traitement sont enregistrées.');
    expect(screen.getByTestId('privacy-sharing-sentence')).toHaveTextContent('Si vous choisissez de partager votre diagnostic avec une structure, des informations relatives à ce partage peuvent également être enregistrées, selon les autorisations que vous accordez.');
    expect(screen.getByTestId('privacy-browser-sentence')).toHaveTextContent('Réinitialiser tout');
    const link = within(box[0]).getByRole('link', { name: /politique de confidentialité/i });
    expect(link).toHaveAttribute('href', '/politique-confidentialite');
    expect(read('src/pages/index.jsx')).toContain('path="/politique-confidentialite"');   // the URL is a real route, not invented
    const all = document.body.textContent;
    for (const bad of [/reste(nt)? (uniquement |seulement )?(stocké|enregistré|dans votre navigateur|sur votre navigateur)/i, /rien n.est (stocké|conservé|enregistré)/i, /aucune donnée/i, /en toute confidentialité/i, /conforme au RGPD|100 ?% RGPD/i, /validé juridiquement/i]) expect(all).not.toMatch(bad);
    expect([PRIVACY_TEXT.p1, PRIVACY_TEXT.p2, ...PRIVACY_TEXT.falc].join(' ')).not.toMatch(/localement|navigateur uniquement|rien n/i);
  });
  it('a FALC equivalent exists (keyboard-operable <details>) and keeps the meaning (server, technical info, optional sharing)', () => {
    render(wrap(createElement(DiagnosticPage)));
    const falc = screen.getByText('En mots simples');
    expect(falc.tagName).toBe('SUMMARY');
    expect(PRIVACY_TEXT.falc.join(' ')).toMatch(/envoy.es à notre serveur/);
    expect(PRIVACY_TEXT.falc.join(' ')).toMatch(/informations techniques/);
    expect(PRIVACY_TEXT.falc.join(' ')).toMatch(/partage/);
  });
});

describe('U8 — sharing and PDF carry the contract only', () => {
  it('the share request body has the assessment and no rights[], amounts, totals', async () => {
    await run({ status: 200, body: RESPONSE });
    fireEvent.click(await screen.findByRole('button', { name: /Partager le dossier/ }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/share/create')).toBe(true));
    const body = calls.find((c) => c.url === '/api/share/create').body;
    expect(body.results.rights).toBeUndefined();
    expect(JSON.stringify(body.results)).not.toMatch(/500|totalMonthly|"eligible"/);
    expect(body.results.assessment.items.map((i) => i.state)).toEqual(['CHECK_REQUIRED', 'MISSING_INFORMATION', 'UNSUPPORTED']);
    expect(body.results.assessment.dataStatus).toBe('UNVERIFIED');
  });
  it('shareableResults / passport lines / letter lines contain no euro, amount, total or eligibility', () => {
    const out = shareableResults(RESPONSE);
    expect(JSON.stringify(out)).not.toMatch(/500|totalMonthly|rights|"eligible"/);
    const text = [...passportAssessmentLines(out).map((l) => `${l.title} ${l.status} ${l.detail}`), ...letterAssessmentLines(out), PASSPORT_TEXT.disclaimer, ...PASSPORT_TEXT.steps, PASSPORT_TEXT.subtitle, PASSPORT_TEXT.banner].join('\n');
    expect(text).not.toMatch(/€|\/ mois|éligible|TOTAL|OpenFisca|règles? de calcul officielle|droits? sociaux? estim/i);
    expect(text).toMatch(/RSA/);
  });
  it('the shared page renders an old stored share (legacy rights only) without amounts or eligibility, and a new one with states', async () => {
    const shared = (results) => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { id: 's1', createdAt: '2026-10-01T00:00:00Z', expiresAt: '2026-10-08T00:00:00Z', viewCount: 1, situation: { zipCode: '67000' }, results } }) }));
    window.history.replaceState(null, '', '/share/s1#capability=abc');
    const mount = () => render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: ['/share/s1'] }, createElement(Routes, null, createElement(Route, { path: '/share/:id', element: createElement(SharedDiagnostic) })))));
    vi.stubGlobal('fetch', shared({ legacyRightsOmitted: true, period: '2026-09' }));
    mount();
    expect(await screen.findByTestId('legacy-results-note')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/€ ?\/ mois|Estimation totale|éligible|non applicable|OpenFisca|Certifié/i);
    cleanup();
    vi.stubGlobal('fetch', shared({ assessment: ASSESSMENT }));
    window.history.replaceState(null, '', '/share/s1#capability=abc');
    mount();
    expect(await screen.findByTestId('assessment-item-rsa')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Estimation totale|éligible|OpenFisca|Certifié/i);
  });
});

describe('U9 — error texts are fixed, never server-supplied', () => {
  it('a hostile message/error field is not displayed', async () => {
    await run({ status: 500, body: { error: 'x', message: 'ATTACKER_TEXT <img src=x> 1234567.891' } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/ATTACKER|1234567|<img/);
    expect(alert.textContent).toMatch(/indisponible/i);
  });
  it('the 400 invalid_json / validation case maps to a fixed hint, the 503 case says that no replacement result is shown', async () => {
    await run({ status: 400, body: { error: 'invalid_json', message: 'Unexpected token S, ..."SENTINEL_S"' } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/Vérifiez les informations saisies/);
    expect(document.body.textContent).not.toMatch(/SENTINEL/);
    cleanup();
    await run({ status: 503, body: { error: 'OPENFISCA_UNAVAILABLE', assessment: { items: [] } } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/Aucun résultat de remplacement/);
  });
});

describe('U10 — accessibility (jsdom-level): names, roles, headings, axe serious/critical = 0', () => {
  it('result view: labelled region, headings in order, all controls named, state = text + icon, ≥44px classes on targets, no axe serious/critical', async () => {
    const { container } = await run({ status: 200, body: RESPONSE });
    await screen.findByTestId('assessment-region');
    expect(screen.getByRole('region', { name: /Pistes d.orientation/ })).toBeInTheDocument();
    const levels = [...container.querySelectorAll('h1,h2,h3,h4')].map((h) => Number(h.tagName[1]));
    levels.forEach((l, i) => { if (i > 0) expect(l - levels[i - 1]).toBeLessThanOrEqual(1); });     // no skipped heading level
    for (const el of container.querySelectorAll('button, a[href], summary, input, select')) {
      const name = el.getAttribute('aria-label') || el.textContent || (el.id && container.querySelector(`label[for="${el.id}"]`)?.textContent) || el.getAttribute('aria-labelledby');
      expect(String(name).trim().length, el.outerHTML.slice(0, 80)).toBeGreaterThan(0);
    }
    expect(screen.getByTestId('assessment-state-rsa').querySelector('svg')).not.toBeNull();            // icon
    expect(screen.getByTestId('assessment-state-rsa').textContent.trim().length).toBeGreaterThan(3);   // and text
    expect(screen.getByRole('link', { name: /fiche d.information/ }).className).toMatch(/min-h-11/);
    expect(screen.getByRole('button', { name: /Partager le dossier/ }).className).toMatch(/min-h-11/);
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(res.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
  it('keyboard: the explanation/provenance and FALC disclosures are native <details>/<summary> (focusable, Enter/Space operable) and links/buttons are in the tab order', async () => {
    const { container } = await run({ status: 200, body: RESPONSE });
    await screen.findByTestId('assessment-region');
    const summaries = container.querySelectorAll('summary');
    expect(summaries.length).toBeGreaterThanOrEqual(4);
    for (const el of container.querySelectorAll('button, a[href], summary')) expect(el.getAttribute('tabindex')).not.toBe('-1');
    expect(container.querySelector('[tabindex]:not([tabindex="0"])')).toBeNull();
  });
  it('assisted access (J-C): the page states that acting remotely for another person is not supported', async () => {
    await run({ status: 200, body: RESPONSE });
    expect(await screen.findByTestId('assisted-note')).toHaveTextContent(/ne permet pas d.agir à distance à la place d.une autre personne/);
  });
});
