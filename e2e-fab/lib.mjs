/**
 * FA-CAP browser suite — shared helpers on top of e2e-fa1/lib.mjs (reused: person(), citizenSignIn(), outbox(), db(), finalResponse()…). Three LAB servers
 * (e2e-fab/run-lab.mjs): OPEN (every surface + capability open, SYNTHETIC HDS attestation), PROD (today's Production configuration: restricted beta, only
 * « admin » open) and TWIN (a second instance of OPEN on the same database). Each test file draws its synthetic client addresses from its OWN slice of the
 * RFC 5737 documentation range, so the real per-address limits apply per person even with files running in parallel.
 */
import fs from 'node:fs';
import { expect } from '@playwright/test';
import { BASE, BASE_CLOSED, TOKENS, person } from '../e2e-fa1/lib.mjs';

export { BASE, BASE_CLOSED, CREDS, TOKENS, db, closeDb, citizenSignIn, outbox, finalResponse, settle } from '../e2e-fa1/lib.mjs';
export const OPEN = BASE;
export const PROD = BASE_CLOSED;
export const TWIN = process.env.FAB_BASE_TWIN || 'http://127.0.0.1:5213';
for (const u of [TWIN]) { const h = new URL(u); if (h.hostname !== '127.0.0.1' || h.port === '3000') throw new Error('loopback LAB only, never :3000'); }

/** a per-file address allocator in 192.0.2.<from..to> @param {number} from @param {number} to */
export function ips(from, to) {
  let n = from - 1;
  return () => { n += 1; if (n > to) n = from; return `192.0.2.${n}`; };
}

/**
 * A synthetic person (citizen or anonymous visitor) with their own browser context — e2e-fa1 person(), with this file's address.
 * @param {import('@playwright/test').Browser} browser @param {() => string} nextIp @param {Record<string, any>} [opts]
 */
export const visitor = (browser, nextIp, opts = {}) => person(browser, { ip: nextIp(), ...opts });

/** a bearer call through the real API entry (organisation / institution / administrator sessions signed with this run's secrets) */
export async function bearer(tokenName, method, p, body, { ip, base = OPEN, headers = {} } = {}) {
  const r = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', ...(tokenName ? { authorization: `Bearer ${TOKENS[tokenName]}` } : {}), 'x-forwarded-for': ip || '192.0.2.250', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text, headers: r.headers };
}

/** an anonymous call (no session) through the real API entry; a write carries a valid CSRF double-submit pair, as a browser page would */
export async function anon(method, p, body, { ip = '192.0.2.251', base = OPEN } = {}) {
  const csrf = 'fabcsrf0123456789abcdef0123456789';
  const r = await fetch(`${base}${p}`, { method, redirect: 'manual',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(method === 'GET' ? {} : { origin: base, 'x-csrf-token': csrf, cookie: `__csrf=${csrf}` }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text, headers: r.headers };
}

/**
 * A console page (administration, organisation, institution) in its own browser context, with the session the console itself would have stored after
 * its sign-in (sign-in screens are covered by e2e-r46 / e2e-r47): administration = sessionStorage access_token; organisation = localStorage pro_token
 * (+ access_token for the shared client); institution = sessionStorage institution_token.
 * @param {import('@playwright/test').Browser} browser @param {'admin' | 'pro' | 'institution'} kind @param {string} tokenName
 */
export async function consoleContext(browser, kind, tokenName, { ip = '192.0.2.252', base = OPEN } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  const token = TOKENS[tokenName];
  await context.addInitScript(([k, t]) => {
    try {
      localStorage.setItem('ada_lang', 'fr'); localStorage.setItem('ada_onboarding_done', '1');
      localStorage.setItem('ada_cookie_consent', JSON.stringify({ necessary: true, analytics: false, date: new Date().toISOString() }));
      if (k === 'admin') sessionStorage.setItem('access_token', t);
      if (k === 'pro') { localStorage.setItem('pro_token', t); sessionStorage.setItem('access_token', t); }
      if (k === 'institution') sessionStorage.setItem('institution_token', t);
    } catch { /* storage refused */ }
  }, [kind, token]);
  const serverErrors = [];
  context.on('response', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/') && r.status() >= 500 && r.status() !== 503) serverErrors.push(`${r.status()} ${u.pathname}`); });
  const page = await context.newPage();
  return { context, page, serverErrors, base };
}

/** the designed refusal of a closed surface or capability (Production configuration): 503 with the beta / capability code, nothing read or written */
export function expectClosed(res, label) {
  expect(res.status, `${label}: closed in Production → 503`).toBe(503);
  const code = res.json?.code || res.json?.error;
  expect(['PUBLIC_BETA_RESTRICTED', 'CAPABILITY_NOT_OPEN', 'SERVICE_UNAVAILABLE', 'BETA_CLOSED'].some((c) => String(code).includes(c)) || /bêta|pas encore ouverte/i.test(JSON.stringify(res.json || {})), `${label}: designed refusal code, got ${JSON.stringify(res.json)?.slice(0, 200)}`).toBe(true);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
