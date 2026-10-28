// Public-beta export (owner directive 29/10/2026): api/index.js differs from the frozen canonical file only by the CORS origin list (the deleted
// legacy Vercel project removed, APP_BASE_URL origin added) and the restricted-beta allowlist gate; see tests/unit/public-beta-cors.test.js and public-beta.test.jsx. The pin below is that export's file.
// @vitest-environment jsdom
/**
 * DTA S1C — regression for browser run 20261017T230707Z-1fa2c0 (DTA-B5 / DTA-B7 symptom): a recipient opening a shared diagnostic link in a FRESH browser has no `__csrf` cookie,
 * so the first protected POST (/api/share/get) carried no x-csrf-token and the server answered 403 "Missing CSRF token…", which the page then showed as "Dossier introuvable".
 * Verified contract (read from source, not assumed): api/index.js calls ensureCsrfCookie() on EVERY /api response that passes csrfCheck, including the exempt GET /api/health
 * (also proven natively by RC5 test R1g1); the cookie is not HttpOnly (csrf-cookie-readable.test.js).  The fix is client-side only: bootstrap with GET /api/health, then POST with the header.
 * The fetch mock below behaves like the real server: it only sets the cookie on /api/health and answers 403 to a POST without a matching header.
 * jsdom: this proves the client sequencing and the rendering, not the real browser (cookie jar, service worker) — that needs the native browser run.
 */
/* global document, window */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import SharedDiagnostic from '../../src/pages/SharedDiagnostic.jsx';
import { ensureCsrfHeaders, getCsrfHeaders } from '../../src/lib/csrf.ts';

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const prov = { source: null, verifiedAt: null, territory: null, rule: null, uncertainty: 'ORIENTATION_NON_OFFICIELLE', display: { source: 'Source : aucune', verifiedAt: 'Vérifié le : non vérifié', territory: 'Territoire : non précisé', rule: 'Règle : aucune', uncertainty: 'Incertitude : ORIENTATION_NON_OFFICIELLE' } };
const ASSESSMENT = { contract: 'ADA_ASSESSMENT_CONTRACT_V1', authoritative: false, leadsEnabled: false, dataStatus: 'UNVERIFIED', referenceDate: null, totals: null, items: [
  { code: 'rsa', label: 'RSA', state: 'CHECK_REQUIRED', authoritative: false, amount: null, amountStatus: 'NOT_PROVIDED_NO_AUTHORITY', missingFacts: [], whoToAsk: 'votre CAF', explanation: 'Pré-orientation indicative.', explanationFalc: 'Ce résultat n\'est pas une décision.', provenance: prov }] };
const DATA = { id: 's1', createdAt: '2026-10-01T00:00:00Z', expiresAt: '2030-10-08T00:00:00Z', viewCount: 1, situation: { zipCode: '67000' }, results: { assessment: ASSESSMENT } };
const TOKEN = 'srv-issued-token-123';
const clearCookie = () => { document.cookie = '__csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'; };

let calls;
/** A server stand-in: /api/health issues the cookie (as api/index.js does); POST /api/share/get is refused without a matching header (as csrfCheck does). */
const server = ({ issue = true, healthOk = true, shareStatus = 200, shareBody = { data: DATA } } = {}) => vi.fn(async (url, init = {}) => {
  const method = (init.method || 'GET').toUpperCase();
  const headers = init.headers || {};
  calls.push({ url, method, headers: { ...headers }, body: init.body ? JSON.parse(init.body) : null, init });
  if (url === '/api/health') { if (issue) document.cookie = `__csrf=${TOKEN}; path=/`; return { ok: healthOk, status: healthOk ? 200 : 500, json: async () => ({}) }; }
  if (url === '/api/share/get') {
    const cookie = (document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/) || [])[1];
    if (!cookie || headers['x-csrf-token'] !== cookie) return { ok: false, status: 403, json: async () => ({ error: 'csrf', message: 'Missing CSRF token. Include x-csrf-token header matching __csrf cookie.' }) };
    return { ok: shareStatus === 200, status: shareStatus, json: async () => shareBody };
  }
  return { ok: false, status: 404, json: async () => ({}) };
});
const open = (hash = '#capability=cap-abc') => {
  window.history.replaceState(null, '', `/share/s1${hash}`);
  return render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: ['/share/s1'] }, createElement(Routes, null, createElement(Route, { path: '/share/:id', element: createElement(SharedDiagnostic) })))));
};
const posts = () => calls.filter((c) => c.method === 'POST');

beforeEach(() => { calls = []; clearCookie(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearCookie(); });

describe('first visit, no __csrf cookie (the failing browser case)', () => {
  it('bootstraps with GET /api/health BEFORE the first protected POST, then sends the matching header and renders the contract', async () => {
    expect(document.cookie).not.toContain('__csrf');
    vi.stubGlobal('fetch', server());
    open();
    expect(await screen.findByTestId('assessment-item-rsa')).toBeInTheDocument();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /api/health', 'POST /api/share/get']);
    expect(posts()[0].headers['x-csrf-token']).toBe(TOKEN);                                   // header == cookie value
    expect(document.cookie).toContain(`__csrf=${TOKEN}`);
    expect(posts()[0].body).toEqual({ id: 's1', capability: 'cap-abc' });                      // capability still only in the POST body
    expect(calls[0].init.body).toBeUndefined();                                                // the bootstrap GET carries nothing
    expect(JSON.stringify(calls[0])).not.toContain('cap-abc');
    expect(window.location.hash).toBe('');                                                     // fragment scrubbed as before
    expect(document.body.textContent).not.toMatch(/Dossier introuvable|CSRF/);
  });

  it('the bootstrap is a plain same-origin GET with no body, no capability and no extra headers', async () => {
    vi.stubGlobal('fetch', server());
    open();
    await screen.findByTestId('assessment-item-rsa');
    const b = calls[0];
    expect(b.method).toBe('GET'); expect(b.url).toBe('/api/health');
    expect(Object.keys(b.headers)).toEqual([]);
    expect(b.init.credentials === undefined || b.init.credentials === 'same-origin').toBe(true);
    expect(b.init.cache).toBe('no-store');
  });

  it('with the cookie already present there is no extra request: the header is simply attached', async () => {
    document.cookie = `__csrf=${TOKEN}; path=/`;
    vi.stubGlobal('fetch', server());
    open();
    await screen.findByTestId('assessment-item-rsa');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/share/get']);
    expect(posts()[0].headers['x-csrf-token']).toBe(TOKEN);
  });
});

describe('failed or useless bootstrap: safe error, and NO unprotected POST', () => {
  it.each([
    ['the health request is rejected (network)', () => vi.fn(async (url, init = {}) => { calls.push({ url, method: (init.method || 'GET').toUpperCase() }); throw new TypeError('Failed to fetch'); })],
    ['the health request answers 200 but no cookie is issued (cookies blocked)', () => server({ issue: false })],
    ['the health request answers 500', () => server({ issue: false, healthOk: false })],
  ])('%s', async (_n, make) => {
    vi.stubGlobal('fetch', make());
    open();
    expect(await screen.findByText(/Dossier introuvable/i)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);                              // never sends the protected POST without the header
    expect(document.body.textContent).toMatch(/Impossible de sécuriser la connexion|Réessayez/);
    expect(document.body.textContent).not.toMatch(/CSRF|x-csrf|__csrf|cookie|TypeError|Failed to fetch/i);
    expect(screen.queryByTestId('assessment-region')).toBeNull();
  });

  it('no capability in the link: nothing is requested at all (no bootstrap, no POST)', async () => {
    vi.stubGlobal('fetch', server());
    open('');
    expect(await screen.findByText(/Lien de partage invalide ou incomplet/i)).toBeInTheDocument();
    expect(calls).toEqual([]);
  });
});

describe('server answers are never shown verbatim; authorization outcomes are unchanged', () => {
  it('a 403 "Missing CSRF token…" from the server is replaced by a fixed text (no internal instruction for the citizen)', async () => {
    document.cookie = `__csrf=${TOKEN}; path=/`;
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => { calls.push({ url, method: (init.method || 'GET').toUpperCase() }); return { ok: false, status: 403, json: async () => ({ error: 'csrf', message: 'Missing CSRF token. Include x-csrf-token header matching __csrf cookie.' }) }; }));
    open();
    expect(await screen.findByText(/Dossier introuvable/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Missing CSRF|x-csrf-token|__csrf/i);
    expect(document.body.textContent).toMatch(/Réessayez|Impossible de sécuriser/);
  });
  it('a hostile server message is not displayed; an unknown or wrong capability (404) keeps the uniform "introuvable ou expiré" text', async () => {
    vi.stubGlobal('fetch', server({ shareStatus: 404, shareBody: { error: 'not_found', message: 'ATTACKER_TEXT <img src=x>' } }));
    open('#capability=wrong');
    expect(await screen.findByText(/Dossier introuvable ou expiré/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/ATTACKER|<img/);
    expect(posts()).toHaveLength(1);                                                           // the capability check is still the server's job: the page does not skip or cache anything
    expect(screen.queryByTestId('assessment-region')).toBeNull();
  });
  it('410 expired and 429 rate limit have fixed, distinct texts', async () => {
    vi.stubGlobal('fetch', server({ shareStatus: 410, shareBody: { message: 'raw' } })); open();
    expect(await screen.findByText(/Dossier introuvable ou expiré/i)).toBeInTheDocument(); cleanup(); clearCookie(); calls = [];
    vi.stubGlobal('fetch', server({ shareStatus: 429, shareBody: { message: 'raw' } })); open();
    expect(await screen.findByText(/Trop de demandes/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\braw\b/);
  });
});

describe('ensureCsrfHeaders (library)', () => {
  it('concurrent first calls share ONE bootstrap request; a later call with the cookie makes none', async () => {
    const f = server(); vi.stubGlobal('fetch', f);
    const [a, b] = await Promise.all([ensureCsrfHeaders(), ensureCsrfHeaders()]);
    expect(a).toEqual({ 'x-csrf-token': TOKEN }); expect(b).toEqual(a);
    expect(f).toHaveBeenCalledTimes(1);
    expect(await ensureCsrfHeaders()).toEqual({ 'x-csrf-token': TOKEN }); expect(f).toHaveBeenCalledTimes(1);
  });
  it('returns null (never an empty header set) when no cookie can be obtained, and the synchronous helper is unchanged', async () => {
    vi.stubGlobal('fetch', server({ issue: false }));
    expect(await ensureCsrfHeaders()).toBeNull();
    expect(getCsrfHeaders()).toEqual({});
    document.cookie = `__csrf=${TOKEN}; path=/`; expect(getCsrfHeaders()).toEqual({ 'x-csrf-token': TOKEN });
  });
});

// PKG-1 re-pin (deliberate): api/index.js gained the 'citizen/' public prefix (session-authenticated account routes, CSRF unchanged); share/create.js attaches the citizen session as owner. csrf.js and share/get.js are still the S1B bytes.
describe('scope guard: the server CSRF / sharing / authorization code is byte-identical to the verified S1B baseline', () => {
  it.each([
    ['api/_utils/csrf.js', 'a4ae049f458a6c233bfe6768ad0a96c6a9a69d0884ae7bc06bcd627d83cc7337'],
    ['api/index.js', '29fd8ca92ab32e9d7ab315d186c184a70ee7e63bdce86794fdc14eb6c145875a'],
    ['api/_handlers/share/get.js', '6855c0833f4fdae60fdf354cdddffa3292850aaeaeec9604a7f84970ee9fa4d2'],
    ['api/_handlers/share/create.js', '94e7520add34528b7853bbdd1e0a5d7a92e0845f10a9006211d36d46283b4f5e'],
  ])('%s unchanged', (p, h) => { expect(sha(p)).toBe(h); });
  it('the page no longer renders a server-supplied message', () => {
    expect(readFileSync('src/pages/SharedDiagnostic.jsx', 'utf8')).not.toMatch(/body\.message|err\.message\}/);
  });
});

describe('the server contract the fix relies on (CSRF stays enforced)', () => {
  it('csrfCheck still refuses a POST without the header and accepts the pair; /health is exempt and the cookie is issued on it', async () => {
    const { csrfCheck, ensureCsrfCookie } = await import('../../api/_utils/csrf.js');
    const res = { setHeader: vi.fn() };
    expect(csrfCheck({ method: 'POST', url: '/api/share/get', headers: { cookie: '__csrf=t' } }, res).ok).toBe(false);
    expect(csrfCheck({ method: 'POST', url: '/api/share/get', headers: {} }, res).ok).toBe(false);
    expect(csrfCheck({ method: 'POST', url: '/api/share/get', headers: { cookie: '__csrf=t', 'x-csrf-token': 't' } }, res).ok).toBe(true);
    expect(csrfCheck({ method: 'GET', url: '/api/health', headers: {} }, res).ok).toBe(true);
    ensureCsrfCookie({ headers: {} }, res);
    expect(res.setHeader.mock.calls.at(-1)[1][0]).toMatch(/^__csrf=/);
    await waitFor(() => {});
  });
});
