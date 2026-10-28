/**
 * Regression (native run 20261017T102222Z-7f2334, B2): the double-submit cookie `__csrf` was issued HttpOnly,
 * but the browser code (src/lib/csrf.ts, src/api/client.js) reads it from document.cookie.  An HttpOnly cookie
 * is invisible to scripts => no x-csrf-token header => every cookie-session browser mutation (the citizen
 * sharing panel: list / find_organizations / invite / revoke / erase) was refused with 403.
 * Mocked-backend tests never saw it; only a real browser against the real API entry did.
 */
import { describe, it, expect, vi } from 'vitest';
import { csrfCheck, ensureCsrfCookie, getCsrfCookieOptions } from '../../api/_utils/csrf.js';

const issue = () => {
  const res = { setHeader: vi.fn() };
  ensureCsrfCookie({ headers: {} }, res);
  expect(res.setHeader).toHaveBeenCalledTimes(1);
  return { res, cookie: res.setHeader.mock.calls[0][1][0] };
};

describe('__csrf cookie must be readable by the page script (double-submit)', () => {
  it('is not HttpOnly, is SameSite=Lax (never None), scoped to /', () => {
    const { cookie } = issue();
    expect(cookie).toMatch(/^__csrf=[^;]+;/);
    expect(cookie).not.toMatch(/HttpOnly/i);
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toMatch(/SameSite=(Strict|None)/);
    expect(cookie).toContain('Path=/');
    expect(getCsrfCookieOptions()).not.toMatch(/HttpOnly/i);
  });

  it('the value a script reads back from the cookie is accepted by csrfCheck (round trip)', () => {
    const { res, cookie } = issue();
    const token = cookie.match(/^__csrf=([^;]+)/)[1];
    const req = { method: 'POST', url: '/api/public/dossier-grants', headers: { cookie: `__csrf=${token}`, 'x-csrf-token': token } };
    expect(csrfCheck(req, res).ok).toBe(true);
  });

  it('negative controls stay closed: no header, wrong header, header without cookie', () => {
    const { res, cookie } = issue();
    const token = cookie.match(/^__csrf=([^;]+)/)[1];
    const post = (headers) => csrfCheck({ method: 'POST', url: '/api/public/dossier-grants', headers }, res).ok;
    expect(post({ cookie: `__csrf=${token}` })).toBe(false);
    expect(post({ cookie: `__csrf=${token}`, 'x-csrf-token': `${token}x` })).toBe(false);
    expect(post({ 'x-csrf-token': token })).toBe(false);
  });

  it('session cookies are untouched: they stay HttpOnly (only the CSRF token is script-readable)', async () => {
    const { getSecureCookieOptions } = await import('../../api/_utils/security.js');
    expect(getSecureCookieOptions()).toMatch(/HttpOnly/);
  });
});
