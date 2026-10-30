// @vitest-environment jsdom
/**
 * DTA S1D — the dual CSRF cookie issuance race (native run 20261017T234555Z-9b18da: in 3 of 4 cold visits BOTH the SPA's GET /api/auth/me and the bootstrap GET /api/health
 * issued a DIFFERENT `__csrf` token; the later Set-Cookie replaces the earlier one).  A response can therefore replace the cookie between the script's cookie read and the moment the
 * protected request's Cookie header is attached => 403 "CSRF token mismatch".  Fix (client only, protection untouched): `csrfFetch` sends the protected request with the freshly read
 * header and, ONLY if the server refused it for a CSRF reason (the refusal happens before any handler runs, so a retry has no side effect) AND the cookie has meanwhile changed, retries exactly once
 * with the current cookie.  Never retried: origin refusals (SEC-03), authorization refusals, an unchanged cookie, a second refusal.  Server CSRF enforcement and cookie properties are unchanged
 * (api/_utils/csrf.js hash-pinned).  jsdom + a server stand-in that behaves like csrfCheck.
 */
/* global document, window */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CsrfBootstrapError, csrfFetch, ensureCsrfHeaders } from '../../src/lib/csrf.ts';
import SharedDiagnostic from '../../src/pages/SharedDiagnostic.jsx';
import DiagnosticPage from '../../src/pages/DiagnosticPage.jsx';

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const setCookie = (v) => { document.cookie = `__csrf=${v}; path=/`; };
const clearCookie = () => { document.cookie = '__csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'; };
const cookieNow = () => (document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/) || [])[1];
const MISMATCH = { error: 'Forbidden', message: 'CSRF token mismatch.', requestId: 'r' };
const MISSING = { error: 'Forbidden', message: 'Missing CSRF token. Include x-csrf-token header matching __csrf cookie.', requestId: 'r' };
const ORIGIN = { error: 'Forbidden', message: 'Origin not allowed (CSRF protection — SEC-03)', requestId: 'r' };
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, clone() { return res(status, body); } });
let posts;
beforeEach(() => { posts = []; clearCookie(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearCookie(); });

/** Stand-in for api/_utils/csrf.js: the double-submit check; `onHealth`/`beforePost` let a test replace the cookie like a concurrent first response would. */
const server = ({ onHealth, beforePost, refusal } = {}) => vi.fn(async (url, init = {}) => {
  if (url === '/api/health') { if (onHealth) onHealth(); return res(200, {}); }
  const sent = (init.headers || {})['x-csrf-token'];
  posts.push({ url, sent, cookieAtSend: undefined });
  if (beforePost) beforePost(posts.length);                       // a concurrent response lands between the script's read and the request being sent
  posts[posts.length - 1].cookieAtSend = cookieNow();
  if (refusal) return res(403, refusal);
  if (!sent || sent !== cookieNow()) return res(403, sent ? MISMATCH : MISSING);
  return res(200, { ok: true });
});

describe('csrfFetch — the race', () => {
  it('cold start: bootstrap, then the protected request carries the cookie value', async () => {
    vi.stubGlobal('fetch', server({ onHealth: () => setCookie('H') }));
    const r = await csrfFetch('/api/x', { method: 'POST', body: '{}' });
    expect(r.status).toBe(200); expect(posts).toHaveLength(1); expect(posts[0].sent).toBe('H');
  });
  it('the cookie is replaced between the read and the send => server 403 mismatch => ONE retry with the CURRENT cookie => 200', async () => {
    vi.stubGlobal('fetch', server({ onHealth: () => setCookie('H'), beforePost: (n) => { if (n === 1) setCookie('A'); } }));   // the SPA's auth/me Set-Cookie (token A) lands after the bootstrap read (H)
    const r = await csrfFetch('/api/x', { method: 'POST', body: '{}' });
    expect(r.status).toBe(200);
    expect(posts.map((p) => p.sent)).toEqual(['H', 'A']);          // exactly two attempts, the second with the current cookie
    expect(posts[1].sent).toBe(posts[1].cookieAtSend);
  });
  it('retries at most ONCE even if the cookie keeps changing', async () => {
    vi.stubGlobal('fetch', server({ onHealth: () => setCookie('H'), beforePost: (n) => setCookie('T' + n) }));
    const r = await csrfFetch('/api/x', { method: 'POST', body: '{}' });
    expect(r.status).toBe(403); expect(posts).toHaveLength(2);
  });
});

describe('csrfFetch — what is never retried (protection is not weakened)', () => {
  it('an Origin refusal (SEC-03) mentions CSRF but is NOT a token refusal: single attempt', async () => {
    setCookie('H'); vi.stubGlobal('fetch', server({ refusal: ORIGIN }));
    expect((await csrfFetch('/api/x', { method: 'POST' })).status).toBe(403); expect(posts).toHaveLength(1);
  });
  it('a genuine mismatch with an UNCHANGED cookie is not retried (the retry could not help)', async () => {
    setCookie('H'); vi.stubGlobal('fetch', server({ refusal: MISMATCH }));
    expect((await csrfFetch('/api/x', { method: 'POST' })).status).toBe(403); expect(posts).toHaveLength(1);
  });
  it('an authorization 403 is not retried', async () => {
    setCookie('H'); vi.stubGlobal('fetch', server({ refusal: { error: 'Forbidden', message: 'AI_CONSENT_REQUIRED' } }));
    expect((await csrfFetch('/api/x', { method: 'POST' })).status).toBe(403); expect(posts).toHaveLength(1);
  });
  it('no cookie can be obtained => CsrfBootstrapError and NO protected request', async () => {
    vi.stubGlobal('fetch', server());                              // health answers 200 but issues nothing
    await expect(csrfFetch('/api/x', { method: 'POST' })).rejects.toBeInstanceOf(CsrfBootstrapError);
    expect(posts).toHaveLength(0);
  });
  it('a missing-token refusal while the cookie is absent in the request stays a refusal (the header is never forged)', async () => {
    setCookie('H'); vi.stubGlobal('fetch', server({ refusal: MISSING }));
    expect((await csrfFetch('/api/x', { method: 'POST' })).status).toBe(403); expect(posts).toHaveLength(1);
  });
  it('ensureCsrfHeaders is unchanged for the happy path', async () => {
    setCookie('Z'); expect(await ensureCsrfHeaders()).toEqual({ 'x-csrf-token': 'Z' });
  });
});

describe('pages use it', () => {
  const wrap = (el, entry = '/') => createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [entry] }, el));
  it('SharedDiagnostic opened cold when the cookie is replaced between read and POST still shows the dossier (one retry), and never the CSRF text', async () => {
    const DATA = { id: 's1', createdAt: '2026-10-01T00:00:00Z', expiresAt: '2030-10-08T00:00:00Z', viewCount: 1, situation: {}, results: { legacyRightsOmitted: true } };
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      if (url === '/api/health') { setCookie('H'); return res(200, {}); }
      n += 1; if (n === 1) setCookie('A');
      const sent = (init.headers || {})['x-csrf-token'];
      return sent === cookieNow() ? res(200, { data: DATA }) : res(403, MISMATCH);
    }));
    window.history.replaceState(null, '', '/share/s1#capability=cap');
    render(wrap(createElement(Routes, null, createElement(Route, { path: '/share/:id', element: createElement(SharedDiagnostic) })), '/share/s1'));
    expect(await screen.findByTestId('legacy-results-note')).toBeInTheDocument();
    expect(n).toBe(2); expect(document.body.textContent).not.toMatch(/CSRF|Dossier introuvable/);
  });
  it('DiagnosticPage: a network failure shows the fixed text, never the raw "Failed to fetch"', async () => {
    setCookie('H');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    render(wrap(createElement(DiagnosticPage)));
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(document.getElementById('diag-birthdate'), { target: { value: '1992-03-10' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Locataire' }));
    fireEvent.click(document.getElementById('diag-calculate-btn'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/Failed to fetch|TypeError/); expect(alert.textContent).toMatch(/indisponible/i);
  });
});

// Public-beta export (owner directive 29/10/2026): api/index.js differs from the frozen canonical file only by the CORS origin list (the deleted
// legacy Vercel project removed, APP_BASE_URL origin added) the restricted-beta allowlist gate and record-page routing; see tests/unit/public-beta-cors.test.js and public-beta.test.jsx. The pin below is that export's file.
describe('scope guard', () => {
  it.each([['api/_utils/csrf.js', 'a4ae049f458a6c233bfe6768ad0a96c6a9a69d0884ae7bc06bcd627d83cc7337'], ['api/index.js', '7c7ea713467d7dc255042e5d55e573eb27829175bccb4a2db7db78fb24170534']])('%s (server CSRF enforcement and cookie issuance) is byte-identical to S1C', (p, h) => { expect(sha(p)).toBe(h); });
  it('the citizen first-POST call sites go through csrfFetch', () => {
    for (const f of ['src/pages/SharedDiagnostic.jsx', 'src/pages/DiagnosticPage.jsx', 'src/components/diagnostic/DiagnosticOutcome.jsx']) expect(readFileSync(f, 'utf8'), f).toContain('csrfFetch');
  });
});
