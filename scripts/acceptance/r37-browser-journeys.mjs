#!/usr/bin/env node
/**
 * R37 — REAL BROWSER journeys (Playwright, real clicks and typing in the built frontend) across the protected surfaces, on an ISOLATED local LAB server
 * (synthetic accounts of scripts/acceptance/r31-lab-seed.mjs + the R35 extra seed). The HTTP twin is scripts/acceptance/r35-journeys.mjs.
 *   node scripts/acceptance/r37-browser-journeys.mjs <accounts.json> [http://127.0.0.1:5173] [--beta http://127.0.0.1:5174] [--out result.json] [--shots <dir>]
 *     [--only 1,2,5]   (iteration aid: run only these journeys; journey 3 needs 2's sign-in, 6 needs 5's)
 * Journeys: 1 citizen, 2 professional (password + second factor, case access), 3 structure management (services, hours, booking page), 4 institution,
 * 5 administration + guide publication life cycle, 6 operations / error pages, 7 restricted beta server (--beta, ADA_PUBLIC_BETA_RESTRICTED=1,
 * ADA_BETA_OPEN_SURFACES=appointments). Every check is {journey, step, pass, detail}; every main screen also records its axe violations, page errors and
 * console errors. Exit 1 on any failed check.
 * The server must run with PRO_MFA_REQUIRED=true and MAILER_PROVIDER=test. Never against production: refuses any base that is not 127.0.0.1 / localhost.
 * Writes synthetic data only (a guide « R37 test », a service, opening hours). Never prints a credential: every detail is scrubbed of the account file's
 * secrets. The professionals' second factor is enrolled here on first use; its seed is written back into the SAME accounts file (mode 600) so a later run
 * can sign in again — it is never written anywhere else.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { generateCode } from '../../api/lib/totp.js';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const optValues = new Set(['--beta', '--out', '--shots', '--only'].map(opt).filter(Boolean));
const [accFile] = args.filter((a) => !a.startsWith('--') && !a.startsWith('http') && !optValues.has(a));
const base = (args.find((a) => a.startsWith('http') && !optValues.has(a)) || 'http://127.0.0.1:5173').replace(/\/$/, '');
const betaBase = opt('--beta') ? opt('--beta').replace(/\/$/, '') : null;
const out = opt('--out');
const shots = opt('--shots');
const only = opt('--only') ? new Set(opt('--only').split(',').map((x) => x.trim())) : null;
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
for (const b of [base, betaBase].filter(Boolean)) if (!LOCAL.test(b)) { console.error(`refusing: ${b} is not a local LAB server (127.0.0.1 / localhost only)`); process.exit(3); }
if (!accFile) { console.error('usage: r37-browser-journeys.mjs <accounts.json> [base] [--beta b] [--out f] [--shots dir] [--only 1,2]'); process.exit(2); }
const acc = JSON.parse(fs.readFileSync(accFile, 'utf8'));
if (shots) fs.mkdirSync(shots, { recursive: true });
const run = (n) => !only || only.has(String(n));

// ───────── secrets never leave the process: every detail is scrubbed of every secret value of the account file (and of any seed enrolled here)
const secrets = new Set();
const collect = (v) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (/password|totp|secret|token/i.test(k) && typeof x === 'string' && x.length >= 4) secrets.add(x); else collect(x); } };
collect(acc);
const scrub = (s) => { let t = String(s ?? ''); for (const x of secrets) t = t.split(x).join('<redacted>'); return t; };
const saveAccounts = () => fs.writeFileSync(accFile, `${JSON.stringify(acc, null, 2)}\n`, { mode: 0o600 });

// ───────── results
const rows = [];
const screens = [];
function check(journey, step, pass, detail = '') {
  const row = { journey, step, pass: Boolean(pass), detail: scrub(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) };
  rows.push(row);
  console.log(`${row.pass ? 'PASS' : 'FAIL'} [${journey}] ${step}${row.detail ? ` — ${row.detail}` : ''}`);
  return row.pass;
}
const J1 = '1 Citizen', J2 = '2 Professional', J3 = '3 Structure', J4 = '4 Institution', J5 = '5 Administration', J6 = '6 Operations', J7 = '7 Beta';
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const stamp = new Date().toISOString().replace(/\D/g, '').slice(4, 12);

// ───────── TOTP: one code per 30-second step and per secret (the server refuses a step it already accepted)
const usedStep = new Map();
async function freshCode(secret) {
  let step = Math.floor(Date.now() / 30000);
  const left = (step + 1) * 30000 - Date.now();
  if ((usedStep.get(secret) ?? -1) >= step || left < 4000) { await sleep(left + 600); step = Math.floor(Date.now() / 30000); }
  usedStep.set(secret, step);
  return generateCode(secret, step);
}

// ───────── browser actors: one context each (own cookies + localStorage)
const axeSrc = fs.readFileSync(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });
const actors = [];
async function actor(label, b = base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-FR', reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { try { localStorage.setItem('ada_onboarding_done', '1'); } catch { /* storage refused */ } });
  const page = await ctx.newPage();
  const a = { label, base: b, ctx, page, pageErrors: [], consoleErrors: [], mark: { p: 0, c: 0 } };
  page.on('pageerror', (e) => a.pageErrors.push(scrub(`${page.url().replace(b, '')}: ${String(e.message)}`).slice(0, 240)));
  page.on('console', (m) => { if (m.type() === 'error') a.consoleErrors.push(scrub(`${page.url().replace(b, '')}: ${m.text()}`).slice(0, 240)); });
  page.on('dialog', (d) => { d.accept().catch(() => {}); });
  actors.push(a);
  return a;
}
async function settle(page) { await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {}); await page.waitForTimeout(300); }
async function closeCookieBanner(page) {
  const btn = page.getByRole('region', { name: 'Information sur les cookies' }).getByRole('button', { name: 'Fermer' });
  if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {});
}
async function go(a, p) {
  const r = await a.page.goto(a.base + p, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => ({ status: () => 0, err: e }));
  await settle(a.page); await closeCookieBanner(a.page);
  return r;
}
const urlPath = (a) => { const u = new URL(a.page.url()); return u.pathname + u.search; };
const bodyText = (a) => a.page.locator('body').innerText().catch(() => '');
/** perform `action` and wait for the first response whose URL contains `fragment` (and method, if given) */
async function withResponse(a, fragment, action, { method, timeout = 15000 } = {}) {
  const wait = a.page.waitForResponse((r) => r.url().includes(fragment) && (!method || r.request().method() === method), { timeout }).catch(() => null);
  await action();
  const r = await wait;
  let json = null; if (r) { try { json = await r.json(); } catch { /* not json */ } }
  return { status: r ? r.status() : 0, json };
}
async function audit(a, journey, screen) {
  let violations = null;
  try {
    await a.page.evaluate(axeSrc);
    violations = await a.page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] })).violations.map((x) => `${x.impact}:${x.id}(${x.nodes.length})`));
  } catch (e) { violations = [`axe-not-run: ${String(e.message).slice(0, 80)}`]; }
  const s = { journey, screen, url: urlPath(a), axeViolations: violations.length, axe: violations, pageErrors: a.pageErrors.slice(a.mark.p), consoleErrors: a.consoleErrors.slice(a.mark.c) };
  a.mark = { p: a.pageErrors.length, c: a.consoleErrors.length };
  screens.push(s);
  console.log(`  screen [${journey}] ${screen} ${s.url} — axe ${s.axeViolations}${s.axeViolations ? ` (${violations.slice(0, 4).join(' ')})` : ''}, page errors ${s.pageErrors.length}, console errors ${s.consoleErrors.length}`);
  return s;
}
async function shot(a, name) {
  if (!shots) return;
  // never a screenshot of a field holding a secret: password fields are masked by the browser; the MFA set-up screens are never captured
  if (await a.page.locator('[data-testid="pro-mfa-secret"], #verify-code, #mfa-code').count().catch(() => 0)) return;
  await a.page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: false }).catch(() => {});
}
function noPageErrors(journey, list) {
  const errs = list.flatMap((a) => a.pageErrors);
  check(journey, 'no uncaught JavaScript error on any page of the journey', errs.length === 0, errs.length ? errs.slice(0, 4).join(' | ') : `${list.map((a) => a.label).join(', ')}: 0 page errors`);
}
/** a journey that throws (a control missing, a timeout) is a failed check, never a crash of the whole run */
async function guard(journey, fn) {
  try { await fn(); } catch (e) { check(journey, 'journey completed without an unexpected interruption', false, String(e.message).split('\n').slice(0, 3).join(' ').slice(0, 400)); }
}
const signInButton = (p) => p.locator('form').getByRole('button', { name: 'Se connecter', exact: true });
const anonRequest = async (b, p, init = {}) => {
  const r = await fetch(b + p, { redirect: 'manual', ...init });
  let json = null; const text = await r.text(); try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text, type: r.headers.get('content-type') || '' };
};

// ───────── sign-in helpers (real typing + clicks)
async function citizenLogin(a, who = 'citizen') {
  await go(a, '/auth/login?next=%2Fcompte');
  await a.page.locator('#auth-email').fill(acc[who].email);
  await a.page.locator('#auth-password').fill(acc[who].password);
  const r = await withResponse(a, '/api/auth/login', () => signInButton(a.page).click(), { method: 'POST' });
  await a.page.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 15000 }).catch(() => {});
  await settle(a.page);
  return r;
}
async function proPassword(a, who) {
  await a.page.locator('#email').fill(acc[who].email);
  await a.page.locator('#password').fill(acc[who].password);
  return withResponse(a, '/api/pro/auth/login', () => a.page.locator('form button[type="submit"]').first().click(), { method: 'POST' });
}
/** password, then the second factor: the code step when enrolled, else the enrolment screen the layout sends to (secret read from the set-up answer) */
async function proSignIn(a, who, journey) {
  await go(a, '/pro/login');
  const lo = await proPassword(a, who);
  const ok = check(journey, `${who}: password accepted on /pro/login`, lo.status === 200, `POST /api/pro/auth/login → ${lo.status}${lo.json?.mfa_required ? ', second factor asked' : ''}`);
  if (!ok) return false;
  if (lo.json?.mfa_required) {
    if (!acc[who].totp) return check(journey, `${who}: second factor code`, false, 'the account has the second factor on but the accounts file holds no seed for it (enrolled outside this script)');
    await a.page.locator('#mfa-code').waitFor({ timeout: 10000 });
    await a.page.locator('#mfa-code').fill(await freshCode(acc[who].totp));
    const mv = await withResponse(a, '/api/pro/auth/mfa-verify', () => a.page.locator('form button[type="submit"]').first().click(), { method: 'POST' });
    await a.page.waitForURL((u) => !u.pathname.startsWith('/pro/login'), { timeout: 15000 }).catch(() => {});
    await settle(a.page);
    return check(journey, `${who}: TOTP code accepted (MFA verify step)`, mv.status === 200 && !urlPath(a).startsWith('/pro/login'), `mfa-verify → ${mv.status}; now on ${urlPath(a)}`);
  }
  // not enrolled yet: PRO_MFA_REQUIRED sends the session to the enrolment screen
  await a.page.waitForURL((u) => u.pathname === '/pro/mfa-settings', { timeout: 15000 }).catch(() => {});
  await settle(a.page);
  const sent = check(journey, `${who}: without a second factor the session is sent to the enrolment screen`, urlPath(a).startsWith('/pro/mfa-settings'), `now on ${urlPath(a)}`);
  if (!sent) return false;
  const st = await withResponse(a, '/api/pro/mfa-setup', () => a.page.getByRole('button', { name: /activer|configurer/i }).first().click(), { method: 'GET' });
  const secret = st.json?.secret;
  if (!check(journey, `${who}: enrolment started (a seed is shown to copy)`, st.status === 200 && secret, `GET /api/pro/mfa-setup → ${st.status}`)) return false;
  secrets.add(secret);
  await a.page.getByRole('button', { name: /J.ai ajouté le secret/ }).click();
  await a.page.locator('#verify-code').fill(await freshCode(secret));
  const en = await withResponse(a, '/api/pro/mfa-setup', () => a.page.getByRole('button', { name: /vérifier|activer|valider/i }).last().click(), { method: 'POST' });
  if (en.status === 200) { acc[who].totp = secret; saveAccounts(); }
  await settle(a.page);
  const okEn = check(journey, `${who}: enrolment confirmed with a TOTP code`, en.status === 200 && (await a.page.locator('#verify-code').count()) === 0, `POST /api/pro/mfa-setup → ${en.status}${en.status === 200 ? ' (seed kept in the accounts file only)' : ''}`);
  return okEn;
}
async function adminSignIn(a, journey) {
  await go(a, '/admin/login');
  await a.page.locator('#email').fill(acc.admin.email);
  await a.page.locator('#password').fill(acc.admin.password);
  const lo = await withResponse(a, '/api/admin/login', () => signInButton(a.page).click(), { method: 'POST' });
  if (!check(journey, 'administrator password accepted, MFA step shown', lo.status === 200 && await a.page.locator('#mfa-code').isVisible({ timeout: 8000 }).catch(() => false), `POST /api/admin/login → ${lo.status}`)) return false;
  await a.page.locator('#mfa-code').fill(await freshCode(acc.admin.totp));
  const mv = await withResponse(a, '/api/admin/mfa-verify', () => a.page.getByRole('button', { name: 'Valider' }).click(), { method: 'POST' });
  await a.page.waitForURL((u) => u.pathname.startsWith('/admin') && u.pathname !== '/admin/login', { timeout: 15000 }).catch(() => {});
  await settle(a.page);
  return check(journey, 'administrator TOTP accepted, dashboard reached', mv.status === 200 && /^\/admin\/dashboard/.test(urlPath(a)), `mfa-verify → ${mv.status}; now on ${urlPath(a)}`);
}

let proA = null; let adminA = null;

// ═════════ 1 Citizen
if (run(1)) await guard(J1, async () => {
  const a = await actor('citizen');
  const p = a.page;
  await go(a, '/auth/login?next=%2Fcompte');
  await p.locator('#auth-email').fill(acc.citizen.email);
  await p.locator('#auth-password').fill('wrong-password-R37!');
  const bad = await withResponse(a, '/api/auth/login', () => signInButton(p).click(), { method: 'POST' });
  await p.waitForTimeout(600);
  const alert = await p.getByRole('alert').filter({ hasText: /incorrect/i }).first().innerText().catch(() => '');
  check(J1, 'wrong password: error shown, no navigation', bad.status === 401 && alert && urlPath(a).startsWith('/auth/login'), `POST /api/auth/login → ${bad.status}; alert « ${alert.trim()} »; still on ${urlPath(a)}`);
  const me0 = await p.evaluate(() => fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.json()).catch(() => null));
  check(J1, 'wrong password: no session opened', me0?.session?.kind !== 'user', `auth/me session kind: ${me0?.session?.kind ?? 'none'}`);
  await audit(a, J1, 'citizen login');

  await p.locator('#auth-password').fill(acc.citizen.password);
  const good = await withResponse(a, '/api/auth/login', () => signInButton(p).click(), { method: 'POST' });
  await p.waitForURL((u) => u.pathname === '/compte', { timeout: 15000 }).catch(() => {});
  await settle(p);
  const h1 = await p.getByRole('heading', { level: 1 }).first().innerText().catch(() => '');
  check(J1, 'correct password: lands on /compte with the « Mon Espace » dashboard', good.status === 200 && urlPath(a) === '/compte' && /Mon Espace/.test(h1), `login → ${good.status}; on ${urlPath(a)}; h1 « ${h1} »`);
  const header = await p.getByRole('button', { name: new RegExp(acc.citizen.email.replace(/[.+]/g, '\\$&')) }).count();
  check(J1, 'header shows the signed-in account menu', header > 0, `${header} account button(s) naming the account`);
  await audit(a, J1, '/compte dashboard'); await shot(a, 'j1-compte-dashboard');

  // preference on /compte/parametres (Accès tab: high contrast switch) — save is immediate, reload must keep it
  await go(a, '/compte/parametres');
  check(J1, '/compte/parametres opens (« Paramètres »)', /Paramètres/.test(await p.getByRole('heading', { level: 1 }).first().innerText().catch(() => '')), `on ${urlPath(a)}`);
  await audit(a, J1, '/compte/parametres');
  await p.getByRole('tab', { name: /Accès/ }).click();
  const sw = p.locator('#sw-high-contrast');
  const before = await sw.getAttribute('aria-checked');
  await sw.click(); await p.waitForTimeout(300);
  const after = await sw.getAttribute('aria-checked');
  await p.reload({ waitUntil: 'domcontentloaded' }); await settle(p);
  await p.getByRole('tab', { name: /Accès/ }).click();
  const reloaded = await p.locator('#sw-high-contrast').getAttribute('aria-checked');
  check(J1, 'Paramètres › Accès: « Contraste élevé » switched, still switched after reload', before !== after && reloaded === after, `aria-checked ${before} → ${after}; after reload ${reloaded}`);
  await p.locator('#sw-high-contrast').click(); await p.waitForTimeout(200);   // back to how it was
  // server-side preference on /compte/profil: the displayed name, saved then read back after reload
  await go(a, '/compte/profil');
  const name = `Citoyen fictif R37 ${stamp}`;
  await p.locator('#pf-name').fill('');
  await p.locator('#pf-name').fill(name);
  const sv = await withResponse(a, '/api/citizen/profile', () => p.getByTestId('profil-save').click(), { method: 'PUT' });
  const msg = await p.getByTestId('profil-status').innerText().catch(() => '');
  await p.reload({ waitUntil: 'domcontentloaded' }); await settle(p);
  const kept = await p.locator('#pf-name').inputValue().catch(() => '');
  check(J1, 'Mon profil: displayed name saved (account preference) and persisted after reload', sv.status === 200 && kept === name, `PUT /api/citizen/profile → ${sv.status}; status « ${msg.trim()} »; after reload « ${kept} »`);
  await audit(a, J1, '/compte/profil');

  // logout from the header menu, then a protected page sends to the login
  await p.getByRole('button', { name: new RegExp(acc.citizen.email.replace(/[.+]/g, '\\$&')) }).first().click();
  const lo = await withResponse(a, '/api/auth/logout', () => p.getByRole('menuitem', { name: /Déconnexion/ }).click(), { method: 'POST' });
  await p.waitForTimeout(1500); await settle(p);
  const me1 = await p.evaluate(() => fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.json()).catch(() => null));
  check(J1, 'logout from the header menu ends the session', [200, 204].includes(lo.status) && me1?.session?.kind !== 'user', `logout → ${lo.status}; auth/me session kind ${me1?.session?.kind ?? 'none'}; on ${urlPath(a)}`);
  for (const target of ['/compte/parametres']) {
    await go(a, target);
    await p.waitForURL((u) => u.pathname.startsWith('/auth/login') || u.pathname === '/login', { timeout: 8000 }).catch(() => {});
    const t = await bodyText(a);
    check(J1, `after logout ${target} redirects to the login`, /^\/(auth\/)?login/.test(urlPath(a)) && !t.includes(name), `on ${urlPath(a)}`);
  }
  // /compte (Mon Espace) and /compte/profil do not redirect: they answer « Connectez-vous… » with a sign-in link and no account data (API 401)
  for (const [target, apiPath, errId, okId] of [['/compte', '/api/citizen/espace', 'mon-espace-error', 'mon-espace'], ['/compte/profil', '/api/citizen/profile', 'compte-profil-error', 'compte-profil']]) {
    const es = await withResponse(a, apiPath, () => go(a, target), { method: 'GET' });
    const te = await bodyText(a);
    const signIn = await p.getByTestId(errId).getByRole('link', { name: 'Se connecter' }).count();
    check(J1, `after logout ${target} is refused (API 401, sign-in prompt, no account data)`, es.status === 401 && signIn > 0 && /Connectez-vous/.test(te) && !(await p.getByTestId(okId).count()) && !te.includes(name) && !te.includes(acc.citizen.email),
      `GET ${apiPath} → ${es.status}; on ${urlPath(a)} (no redirect: refusal state with a « Se connecter » link ${signIn})`);
  }
  noPageErrors(J1, [a]);
});

// ═════════ 2 Professional
let proB = null;
if (run(2) || run(3)) proA = await actor('pro (org A admin)');
if (run(2)) await guard(J2, async () => {
  const p = proA.page;
  await go(proA, '/pro/login');
  await audit(proA, J2, '/pro/login');
  await p.locator('#email').fill(acc.pro.email);
  await p.locator('#password').fill('wrong-password-R37!');
  const w = await withResponse(proA, '/api/pro/auth/login', () => p.locator('form button[type="submit"]').first().click(), { method: 'POST' });
  const err = await p.locator('[role="alert"]').first().innerText().catch(() => '');
  check(J2, 'wrong password on /pro/login: error shown, stays on the login', w.status === 401 && /incorrect/i.test(err) && urlPath(proA).startsWith('/pro/login'), `→ ${w.status}; « ${err.trim()} »`);
});
if (run(2) || run(3)) await guard(J2, async () => {
  const signed = await proSignIn(proA, 'pro', J2);
  if (signed) {
    await go(proA, '/pro/dashboard');
    const h1 = await proA.page.getByRole('heading', { level: 1 }).first().innerText().catch(() => '');
    const q = await proA.page.getByTestId('pro-dashboard-queue').isVisible().catch(() => false);
    check(J2, 'pro dashboard visible after the second factor', urlPath(proA) === '/pro/dashboard' && q, `on ${urlPath(proA)}; h1 « ${h1.trim()} »; queue panel ${q}`);
    await audit(proA, J2, '/pro/dashboard'); await shot(proA, 'j2-pro-dashboard');
  }
});
if (run(2)) await guard(J2, async () => {
  const p = proA.page;
  await p.getByRole('link', { name: /Dossiers suivis/ }).first().click();
  await p.waitForURL((u) => u.pathname === '/pro/dossiers', { timeout: 10000 }).catch(() => {}); await settle(p);
  await p.getByTestId('pro-cases-tab-all').click().catch(() => {}); await settle(p);
  const items = await p.getByTestId('pro-case-item').allInnerTexts().catch(() => []);
  check(J2, 'dossiers list (« Dossiers suivis ») opened from the navigation shows the seeded case', urlPath(proA).startsWith('/pro/dossiers') && items.some((t) => t.includes('r31-doss')), `on ${urlPath(proA)}; ${items.length} item(s)`);
  await audit(proA, J2, '/pro/dossiers'); await shot(proA, 'j2-pro-dossiers');
  const open = p.getByTestId('pro-case-item').filter({ hasText: 'r31-doss' }).getByTestId('pro-case-open');
  if (await open.count()) {
    const cr = await withResponse(proA, '/api/pro/cases', () => open.first().click(), { method: 'GET' });
    await settle(p);
    const h = await p.getByRole('heading', { level: 1 }).first().innerText().catch(() => '');
    check(J2, 'open the seeded case: detail with its status and assignee', urlPath(proA) === '/pro/dossiers/r31-case' && /Dossier r31-doss/.test(h) && await p.getByTestId('pro-case-assignee').isVisible().catch(() => false), `GET case → ${cr.status}; h1 « ${h.trim()} »`);
    await audit(proA, J2, '/pro/dossiers/r31-case');
  } else check(J2, 'open the seeded case', false, 'no « Ouvrir » link for r31-case');

  // another organization (org B) opens org A's case and dossier by URL
  proB = await actor('other (org B)');
  if (await proSignIn(proB, 'other', J2)) {
    const pb = proB.page;
    const r = await withResponse(proB, '/api/pro/cases', () => go(proB, '/pro/dossiers/r31-case'), { method: 'GET' });
    const t = await bodyText(proB);
    const errShown = await pb.getByTestId('pro-case-error').isVisible().catch(() => false);
    check(J2, 'org B opening org A\'s case /pro/dossiers/r31-case by URL is refused, no data shown', [403, 404].includes(r.status) && errShown && !(await pb.getByTestId('pro-case-assignee').count()) && !t.includes(acc.pro.email),
      `GET /api/pro/cases?id=r31-case → ${r.status}; error block ${errShown}; assignee shown ${await pb.getByTestId('pro-case-assignee').count()}`);
    await audit(proB, J2, 'org B: foreign case'); await shot(proB, 'j2-orgB-foreign-case-refused');
    const d = await withResponse(proB, '/api/pro/dossier', () => go(proB, '/pro/dossier/r31-dossier'), { method: 'GET' });
    const td = await pb.locator("main").first().innerText().catch(() => bodyText(proB));
    check(J2, 'org B opening org A\'s shared dossier /pro/dossier/r31-dossier is refused', [403, 404].includes(d.status) && !td.includes('Citoyen fictif') && !td.includes(acc.citizen.email), `GET /api/pro/dossier → ${d.status}; page says « ${td.replace(/\s+/g, ' ').slice(0, 140)} »`);
  }
  noPageErrors(J2, [proA, ...(proB ? [proB] : [])]);
});

// ═════════ 3 Structure management (org A administrator)
if (run(3) && proA) await guard(J3, async () => {
  const a = proA; const p = a.page;
  for (const [route, test, label] of [['/pro/rdv/services', 'pro-rdv-settings-card', 'services + booking settings'], ['/pro/rdv/disponibilites', 'availability-screen', 'opening hours'], ['/pro/rdv/absences', null, 'closures / time off'], ['/pro/structure', null, 'structure record']]) {
    await go(a, route);
    const visible = test ? await p.getByTestId(test).isVisible({ timeout: 8000 }).catch(() => false) : (await p.getByRole('heading').count()) > 0;
    const err = await p.locator('[role="alert"]').allInnerTexts().catch(() => []);
    check(J3, `${route} (${label}) loads`, urlPath(a).startsWith(route) && visible && !err.some((x) => /impossible|erreur/i.test(x)), `on ${urlPath(a)}; ${test || 'heading'} visible ${visible}; alerts ${JSON.stringify(err).slice(0, 160)}`);
    await audit(a, J3, route);
  }
  // service: empty name refused by the form, then a valid save visible after reload
  await go(a, '/pro/rdv/services');
  const svcName = `Accueil fictif R37 ${stamp}`;
  await p.getByRole('button', { name: /Nouveau service/ }).first().click();
  await p.locator('#service-name').waitFor({ timeout: 8000 });
  let posted = 0; const onReq = (r) => { if (r.url().includes('/api/pro/services') && r.method() === 'POST') posted += 1; };
  p.on('request', onReq);
  await p.locator('#service-name').fill('');
  await p.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click();
  await p.waitForTimeout(600);
  const vErr = await p.getByText('Le nom du service est requis.').isVisible().catch(() => false);
  check(J3, 'service form: empty name refused with « Le nom du service est requis. », nothing sent', vErr && posted === 0, `message visible ${vErr}; POST sent ${posted}`);
  p.off('request', onReq);
  if (!(await p.locator('#service-name').isVisible().catch(() => false))) await p.getByRole('button', { name: /Nouveau service/ }).first().click();
  await p.locator('#service-name').fill(svcName);
  const cs = await withResponse(a, '/api/pro/services', () => p.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click(), { method: 'POST' });
  await settle(p);
  await p.reload({ waitUntil: 'domcontentloaded' }); await settle(p);
  const listed = await p.getByText(svcName).isVisible().catch(() => false);
  check(J3, 'service created through the dialog and listed after reload', cs.status === 201 && listed, `POST /api/pro/services → ${cs.status}; « ${svcName} » listed after reload ${listed}`);
  await shot(a, 'j3-services');

  // opening hours: an inverted range refused, then a valid range saved and read back after reload
  await go(a, '/pro/rdv/disponibilites');
  const monday = p.getByRole('textbox', { name: /^Lundi, plage 1/ });
  if (!(await monday.count())) await p.getByRole('button', { name: 'Ajouter une plage le lundi' }).click();
  let put = 0; const onPut = (r) => { if (r.url().includes('/api/pro/availability') && r.method() === 'PUT') put += 1; };
  p.on('request', onPut);
  await monday.fill('17:00-09:00');
  await p.getByTestId('availability-save').click(); await p.waitForTimeout(600);
  const aErr = await p.getByTestId('availability-error').innerText().catch(() => '');
  check(J3, 'opening hours: an inverted range (17:00-09:00) is refused with a message, nothing sent', aErr.trim().length > 0 && put === 0, `error « ${aErr.trim()} »; PUT sent ${put}`);
  p.off('request', onPut);
  const range = `09:00-1${stamp.slice(-1) > '4' ? '6' : '7'}:00`;
  await monday.fill(range);
  for (const day of ['mardi', 'mercredi', 'jeudi', 'vendredi']) {
    if (!(await p.getByRole('textbox', { name: new RegExp(`^${day[0].toUpperCase()}${day.slice(1)}, plage 1`) }).count())) await p.getByRole('button', { name: `Ajouter une plage le ${day}` }).click();
  }
  const sa = await withResponse(a, '/api/pro/availability', () => p.getByTestId('availability-save').click(), { method: 'PUT' });
  await settle(p);
  await p.reload({ waitUntil: 'domcontentloaded' }); await settle(p);
  const back = await p.getByRole('textbox', { name: /^Lundi, plage 1/ }).inputValue().catch(() => '');
  check(J3, `opening hours: Monday ${range} saved and shown after reload`, sa.status === 200 && back === range, `PUT /api/pro/availability → ${sa.status}; after reload « ${back} »`);
  await shot(a, 'j3-opening-hours');

  // booking settings: publish the public booking page (needs a service and hours), read back after reload
  await go(a, '/pro/rdv/services');
  const card = p.getByTestId('pro-rdv-settings-card');
  const box = card.getByRole('checkbox').first();
  const wasPublished = await box.isChecked().catch(() => false);
  if (!wasPublished) await box.check().catch(() => {});
  const ss = await withResponse(a, '/api/pro/rdv/settings', () => card.getByRole('button', { name: /Enregistrer les param/ }).click(), { method: 'PUT' });
  await p.reload({ waitUntil: 'domcontentloaded' }); await settle(p);
  const nowPublished = await p.getByTestId('pro-rdv-settings-card').getByRole('checkbox').first().isChecked().catch(() => false);
  check(J3, 'booking page published from the settings card, still published after reload', ss.status === 200 && nowPublished, `PUT /api/pro/rdv/settings → ${ss.status}; checkbox before ${wasPublished}, after reload ${nowPublished}`);
  noPageErrors(J3, [a]);
});

// ═════════ 4 Institution
if (run(4)) await guard(J4, async () => {
  const a = await actor('institution'); const p = a.page;
  await go(a, '/institution');
  await p.locator('#inst-email').fill(acc.institution.email);
  await p.locator('#inst-pass').fill('wrong-password-R37!');
  const w = await withResponse(a, '/api/institution/login', () => signInButton(p).click(), { method: 'POST' });
  const prob = await p.getByTestId('institution-problem').innerText().catch(() => '');
  check(J4, 'wrong password: refused with a message, no space opened', w.status === 401 && prob.trim() && !(await p.getByTestId('institution-me').count()), `→ ${w.status}; « ${prob.trim()} »`);
  await audit(a, J4, '/institution login');
  await p.locator('#inst-pass').fill(acc.institution.password);
  const lo = await withResponse(a, '/api/institution/login', () => signInButton(p).click(), { method: 'POST' });
  await settle(p);
  const meText = await p.getByTestId('institution-me').innerText().catch(() => '');
  check(J4, 'institution login: organisation and territory shown', lo.status === 200 && /67/.test(meText), `→ ${lo.status}; « ${meText.trim()} »`);
  const obs = await p.getByRole('heading', { name: /Observatoire des besoins non couverts/ }).isVisible().catch(() => false);
  const temp = await p.getByTestId('institution-temporary').isVisible().catch(() => false);
  check(J4, 'dashboard shows the aggregate observatory (by need, methodology)', obs && await p.getByTestId('institution-by-need').isVisible().catch(() => false), `observatory heading ${obs}; temporary-password screen ${temp}`);
  const t = await bodyText(a);
  const emails = (t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).filter((e) => e !== acc.institution.email);
  const seeded = [acc.citizen.email, acc.throwaway.email, acc.pro.email, acc.pro2.email, acc.other.email, 'r35-citizen', 'r31-dossier', 'r31-case', 'Citoyen fictif', 'Orientation fictive'].filter((x) => t.includes(x));
  check(J4, 'no personal data of individuals on the institution screen', emails.length === 0 && seeded.length === 0, `${emails.length} e-mail address(es) of others, ${seeded.length} seeded personal value(s)${seeded.length ? `: ${seeded.join(', ')}` : ''}`);
  await audit(a, J4, '/institution space'); await shot(a, 'j4-institution');
  noPageErrors(J4, [a]);
});

// ═════════ 5 Administration + guide publication life cycle
if (run(5) || run(6)) await guard(J5, async () => {
  adminA = await actor('admin');
  await adminSignIn(adminA, J5);
  await audit(adminA, J5, '/admin/dashboard'); await shot(adminA, 'j5-admin-dashboard');
});
if (run(5)) await guard(J5, async () => {
  const a = adminA; const p = a.page; const anon = await actor('anonymous visitor');
  for (const [route, kind] of [['/admin/guides', 'guide'], ['/admin/aides', 'aide']]) {
    await go(a, route);
    const n = await p.getByTestId('admin-catalogue-row').count().catch(() => 0);
    check(J5, `editorial list ${route} loads with records`, await p.getByTestId(`admin-catalogue-${kind}`).isVisible().catch(() => false) && n > 0 && !(await p.getByTestId('admin-catalogue-load-error').count()), `${n} rows`);
    await audit(a, J5, route);
  }
  // create a draft through the editor (required title refused first)
  const word = `zorbelix${crypto.randomBytes(3).toString('hex').replace(/\d/g, (d) => 'abcdefghij'[d])}`;
  const title = `Guide R37 test ${word}`;
  await go(a, '/admin/guides');
  await p.getByRole('link', { name: 'Créer un guide' }).click();
  await p.waitForURL((u) => u.pathname === '/admin/guides/new', { timeout: 8000 }).catch(() => {}); await settle(p);
  let created = 0; const onReq = (r) => { if (r.url().includes('/api/admin/content') && r.method() === 'POST') created += 1; };
  p.on('request', onReq);
  await p.getByRole('button', { name: 'Créer le brouillon' }).click(); await p.waitForTimeout(500);
  const missing = await p.locator('#f-titre').evaluate((el) => el.validity.valueMissing).catch(() => false);
  check(J5, 'new guide: empty required title blocks the creation (nothing sent)', missing && created === 0 && urlPath(a) === '/admin/guides/new', `title valueMissing ${missing}; POST sent ${created}`);
  p.off('request', onReq);
  await p.locator('#f-titre').fill(title);
  await p.locator('#f-resume_falc').fill(`Résumé fictif pour le test R37 (${word}).`);
  await p.getByRole('button', { name: 'Ajouter une étape' }).click();
  await p.locator('#f-contenu_json-0-titre').fill('Première étape fictive');
  await p.locator('#f-contenu_json-0-texte').fill(`Texte fictif de l’étape, mot repère ${word}.`);
  await p.locator('#f-mots_cles').fill(word);
  const cr = await withResponse(a, '/api/admin/content', () => p.getByRole('button', { name: 'Créer le brouillon' }).click(), { method: 'POST' });
  const id = cr.json?.item?.id; const slug = cr.json?.item?.slug;
  await p.waitForURL((u) => /^\/admin\/guides\/[^n]/.test(u.pathname), { timeout: 10000 }).catch(() => {}); await settle(p);
  const meta = await p.getByTestId('admin-editor-meta').innerText().catch(() => '');
  check(J5, 'guide draft created through the admin editor', cr.status === 201 && id && slug && urlPath(a) === `/admin/guides/${id}` && /brouillon/.test(meta), `POST /api/admin/content → ${cr.status}; slug ${slug}; « ${meta.trim()} »`);
  await audit(a, J5, '/admin/guides/:id editor');

  const publicGone = async (stepLabel) => {
    const api = await anonRequest(base, `/api/guides?slug=${encodeURIComponent(slug)}`);
    await go(anon, `/bonnes-pratiques/${slug}`);
    const nf = await anon.page.getByText('Guide introuvable').first().isVisible().catch(() => false);
    const leaked = (await bodyText(anon)).includes(word);
    check(J5, stepLabel, api.status === 404 && nf && !leaked, `public /api/guides?slug → ${api.status}; /bonnes-pratiques/<slug> « Guide introuvable » ${nf}; unique word on the page ${leaked}`);
  };
  if (slug) {
    await publicGone('draft NOT public (API 404, page « Guide introuvable »)');
    await audit(anon, J5, '/bonnes-pratiques/<draft> not found');

    // publish from the list
    const findRow = async () => {
      await go(a, '/admin/guides');
      await p.locator('#admin-catalogue-q-guide').fill(word);
      await p.getByRole('button', { name: 'Rechercher' }).click(); await settle(p);
      return p.locator(`[data-testid="admin-catalogue-row"][data-id="${id}"]`);
    };
    let row = await findRow();
    const pub = await withResponse(a, '/api/admin/content', () => row.getByRole('button', { name: 'Publier' }).click(), { method: 'PUT' });
    await settle(p);
    const st = await p.getByTestId('admin-catalogue-status').innerText().catch(() => '');
    const badge = (await row.getByTestId('admin-catalogue-state').textContent().catch(() => '') || '').trim();
    check(J5, 'guide published from the list (« Publier »)', pub.status === 200 && /publiée/.test(st) && badge === 'Publié', `PUT → ${pub.status}; « ${st.trim()} »; badge ${badge}`);
    await shot(a, 'j5-admin-guide-published');
    const api = await anonRequest(base, `/api/guides?slug=${encodeURIComponent(slug)}`);
    await go(anon, `/bonnes-pratiques/${slug}`);
    const h1 = await anon.page.getByRole('heading', { level: 1 }).first().innerText().catch(() => '');
    check(J5, 'published guide visible on /bonnes-pratiques/<slug>', api.status === 200 && await anon.page.getByTestId('guide-detail').isVisible().catch(() => false) && h1.includes(word), `API → ${api.status}; h1 « ${h1.trim()} »`);
    await audit(anon, J5, '/bonnes-pratiques/<published>'); await shot(anon, 'j5-public-guide');
    const sr = await withResponse(anon, '/api/search', () => go(anon, `/recherche?q=${word}`), { method: 'POST', timeout: 25000 });
    await anon.page.waitForTimeout(800);
    const link = await anon.page.locator(`a[href="/bonnes-pratiques/${slug}"]`).count();
    check(J5, 'public search /recherche?q=<unique word> finds the published guide', link > 0, `POST /api/search → ${sr.status}; ${(sr.json?.guides || []).length} guide(s) in the answer; link to the guide on the page ${link}`);
    await audit(anon, J5, '/recherche'); await shot(anon, 'j5-public-search');

    // edit: new title, version history in the editor, public page follows
    await go(a, `/admin/guides/${id}`);
    const h0 = await p.getByTestId('entity-history-item').count().catch(() => 0);
    await p.locator('#f-titre').fill(`${title} modifié`);
    const ed = await withResponse(a, `/api/admin/content`, () => p.getByRole('button', { name: 'Enregistrer' }).click(), { method: 'PUT' });
    await settle(p);
    const est = await p.getByTestId('admin-editor-status').innerText().catch(() => '');
    const h1n = await p.getByTestId('entity-history-item').count().catch(() => 0);
    check(J5, 'guide edited in the editor (« Enregistré. »)', ed.status === 200 && /Enregistré/.test(est), `PUT → ${ed.status}; « ${est.trim()} »`);
    check(J5, 'change history: a version entry is added by the edit', await p.getByTestId('entity-history').isVisible().catch(() => false) && h1n > h0, `history entries ${h0} → ${h1n}`);
    await go(anon, `/bonnes-pratiques/${slug}`);
    const h1e = await anon.page.getByRole('heading', { level: 1 }).first().innerText().catch(() => '');
    check(J5, 'public page shows the edited title', /modifié/.test(h1e), `h1 « ${h1e.trim()} »`);

    // archive from the list (confirmation dialog accepted), then gone publicly
    row = await findRow();
    const ar = await withResponse(a, '/api/admin/content', () => row.getByRole('button', { name: 'Archiver' }).click(), { method: 'DELETE' });
    await settle(p);
    const ast = await p.getByTestId('admin-catalogue-status').innerText().catch(() => '');
    check(J5, 'guide archived from the list (« Archiver », confirmed)', ar.status === 200 && /archivée/.test(ast), `DELETE → ${ar.status}; « ${ast.trim()} »`);
    await publicGone('archived guide gone publicly (API 404, page « Guide introuvable »)');
    const sr2 = await withResponse(anon, '/api/search', () => go(anon, `/recherche?q=${word}`), { method: 'POST', timeout: 25000 });
    await anon.page.waitForTimeout(800);
    const link2 = await anon.page.locator(`a[href="/bonnes-pratiques/${slug}"]`).count();
    check(J5, 'archived guide no longer found by the public search', sr2.status === 200 && link2 === 0 && !(sr2.json?.guides || []).some((g) => g.slug === slug), `POST /api/search → ${sr2.status}; link on the page ${link2}`);
  }

  // unauthorised: a citizen session opening /admin
  const cit = await actor('citizen (admin probe)');
  const lo = await citizenLogin(cit);
  if (check(J5, 'citizen signed in (for the unauthorised probe)', lo.status === 200, `login → ${lo.status}`)) {
    await go(cit, '/admin/dashboard');
    await cit.page.waitForURL((u) => u.pathname === '/admin/login', { timeout: 8000 }).catch(() => {});
    const tasks = await cit.page.getByTestId('admin-task').count();
    const apiC = await cit.page.evaluate(() => fetch('/api/admin/content?kind=guide', { credentials: 'include' }).then((r) => r.status).catch(() => 0));
    check(J5, 'citizen session opening /admin is refused (sent to the admin login, no admin data)', urlPath(cit) === '/admin/login' && tasks === 0 && [401, 403].includes(apiC), `on ${urlPath(cit)}; dashboard tasks ${tasks}; /api/admin/content with the citizen cookies → ${apiC}`);
    await shot(cit, 'j5-citizen-admin-refused');
  }
  noPageErrors(J5, [a, anon, cit]);
});

// ═════════ 6 Operations
if (run(6)) await guard(J6, async () => {
  const a = adminA; const p = a.page;
  if (a) {
    for (const [route, expect, testid] of [['/admin/operations', '/admin/operations', 'admin-operations'], ['/admin/observability', '/admin/observability', null], ['/admin/health', '/admin/observability', null], ['/admin/runs', '/admin/runs', null], ['/admin/audit', '/admin/audit', null], ['/admin/logs', '/admin/logs', null]]) {
      const before = a.pageErrors.length;
      await go(a, route);
      const ok = testid ? await p.getByTestId(testid).isVisible().catch(() => false) : (await p.getByRole('heading', { level: 1 }).count()) > 0;
      const alerts = (await p.locator('[role="alert"]').allInnerTexts().catch(() => [])).filter((x) => x.trim());
      const errs = a.pageErrors.slice(before);
      check(J6, `${route} loads without page error`, urlPath(a).startsWith(expect) && ok && errs.length === 0, `on ${urlPath(a)}; ${testid || 'h1'} ${ok}; page errors ${errs.length}${alerts.length ? `; alerts: ${alerts.join(' | ').slice(0, 200)}` : ''}`);
      await audit(a, J6, route);
      if (route === '/admin/operations') await shot(a, 'j6-admin-operations');
    }
  }
  const v = await actor('visitor (errors)'); const vp = v.page;
  const r = await go(v, '/cette-page-n-existe-pas-r37');
  const nf = await vp.getByTestId('page-not-found').isVisible().catch(() => false);
  const h = await vp.getByRole('heading', { level: 1 }).first().innerText().catch(() => '');
  check(J6, 'unknown page renders the friendly 404 page', nf && /404/.test(h) && (await vp.getByRole('link').count()) > 0, `HTTP ${r?.status?.()}; page-not-found ${nf}; h1 « ${h.trim()} »`);
  await audit(v, J6, 'unknown page 404'); await shot(v, 'j6-not-found');
  const ar = await withResponse(v, '/api/aides', () => go(v, '/aides/r37-aide-inexistante'), { method: 'GET' });
  const t = (await vp.locator('main').first().innerText().catch(() => bodyText(v))).replace(/\s+/g, ' ');
  check(J6, 'page whose API answers 404 (/aides/<unknown>) renders a friendly not-found state', ar.status === 404 && /introuvable|n’existe pas|n'existe pas|404/i.test(t) && t.length > 40, `GET /api/aides… → ${ar.status}; « ${t.slice(0, 160)} »`);
  await audit(v, J6, '/aides/<unknown>');
  const api = await anonRequest(base, '/api/r37-route-inexistante');
  check(J6, 'unknown /api route answers a JSON 404 (not the HTML application)', api.status === 404 && /json/.test(api.type), `→ ${api.status} ${api.type}`);
  // unknown pages under the two protected sections: never their content, and (expected) the friendly 404 or the section's login
  const sectionUnknown = async (who, route, label) => {
    await go(who, route);
    const main = (await who.page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const friendly = await who.page.getByTestId('page-not-found').isVisible().catch(() => false);
    const login = /^\/(admin|pro)\/login/.test(urlPath(who));
    const h1 = await who.page.getByRole('heading', { level: 1 }).count();
    check(J6, `${label}: unknown page ${route} renders the friendly 404 page (or the section login)`, friendly || login, `on ${urlPath(who)}; page-not-found ${friendly}; h1 count ${h1}; visible text « ${main.slice(0, 120)} »`);
    return { main, friendly, login };
  };
  const ua = await sectionUnknown(v, '/admin/route-inexistante-r37', 'no session');
  check(J6, 'no session: unknown /admin page shows no administration content', !/Tableau de bord|Gestion des guides|Opérations/.test(ua.main), `visible text « ${ua.main.slice(0, 120)} »`);
  await shot(v, 'j6-admin-unknown-no-session');
  await sectionUnknown(v, '/pro/route-inexistante-r37', 'no session');
  if (a) await sectionUnknown(a, '/admin/route-inexistante-r37', 'administrator session');
  noPageErrors(J6, [...(a ? [a] : []), v]);
});

// ═════════ 7 Beta server
if (run(7) && betaBase) await guard(J7, async () => {
  const a = await actor('beta visitor', betaBase); const p = a.page;
  await go(a, '/');
  const banner = await p.getByTestId('public-beta-banner').isVisible().catch(() => false);
  check(J7, 'home page loads with the beta notice', banner && (await p.getByRole('heading', { level: 1 }).count()) > 0, `beta banner ${banner}`);
  await audit(a, J7, 'beta /');
  const entries = await p.getByRole('button', { name: /Se connecter/ }).count() + await p.getByRole('link', { name: /Se connecter|Créer un compte|Espace pro/ }).count();
  check(J7, 'account entry points (« Se connecter », « Créer un compte ») hidden in the header', entries === 0, `${entries} entry point(s)`);
  await shot(a, 'j7-beta-home');
  await go(a, '/bonnes-pratiques');
  const cards = await p.locator('a[href^="/bonnes-pratiques/"]').count();
  check(J7, '/bonnes-pratiques lists guides', cards > 0, `${cards} guide link(s)`);
  await audit(a, J7, 'beta /bonnes-pratiques');
  if (cards) {
    await p.locator('a[href^="/bonnes-pratiques/"]').first().click();
    await settle(p);
    check(J7, 'a guide opens from the list (real click)', await p.getByTestId('guide-detail').isVisible().catch(() => false), `on ${urlPath(a)}`);
  }
  for (const target of ['/compte', '/pro/login', '/auth/login', '/admin/login', '/institution']) {
    await go(a, target);
    const closed = await p.getByTestId('public-beta-unavailable').isVisible().catch(() => false);
    const form = await p.locator('input[type="password"]').count();
    check(J7, `${target} blocked by the beta (closed notice, no sign-in form)`, closed && form === 0, `notice ${closed}; password fields ${form}; on ${urlPath(a)}`);
    if (target === '/compte') { await audit(a, J7, 'beta /compte closed'); await shot(a, 'j7-beta-compte-closed'); }
  }
  // server side: accounts and professional routes refused by the beta gate. The POST goes from Node with the CSRF double-submit cookie and the Origin of
  // the open LAB build (the API's local origin allowlist knows :5173, not the beta port :5174 — from the beta page itself every POST is refused 403 by SEC-03)
  const h = await fetch(`${betaBase}/api/health`);
  const csrf = ((h.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('__csrf=')) || '').slice(7);
  const post = await anonRequest(betaBase, '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: base, cookie: `__csrf=${csrf}`, 'x-csrf-token': csrf }, body: JSON.stringify({ email: 'beta.r37@lab.test', password: 'not-a-password-R37' }) });
  const prof = await anonRequest(betaBase, '/api/citizen/profile'); const pro = await anonRequest(betaBase, '/api/pro/me');
  check(J7, 'server side: /api/auth/login, /api/citizen/profile, /api/pro/me closed (503 PUBLIC_BETA_RESTRICTED)', post.status === 503 && post.json?.error === 'PUBLIC_BETA_RESTRICTED' && prof.status === 503 && pro.status === 503,
    `POST auth/login → ${post.status} ${post.json?.error || ''}; GET citizen/profile → ${prof.status}; GET pro/me → ${pro.status}`);
  // the open appointments surface: the public booking page of the seeded structure (published in journey 3 / by the R35 seed)
  const api = [];
  const onResp = (r) => { if (r.url().includes('/api/')) api.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); };
  p.on('response', onResp);
  await go(a, '/rdv/r31-s1');
  p.off('response', onResp);
  const closedRdv = await p.getByTestId('public-beta-unavailable').isVisible().catch(() => false);
  check(J7, 'public booking page /rdv/r31-s1 usable on the beta (appointments surface opened)', !closedRdv && !/^\/auth\/login/.test(urlPath(a)),
    `ended on ${urlPath(a)}; closed notice ${closedRdv}; API calls: ${api.join(', ')}`);
  await audit(a, J7, 'beta /rdv/r31-s1'); await shot(a, 'j7-beta-rdv');
  const rdvApi = await anonRequest(betaBase, '/api/rdv/structures/r31-s1/services');
  check(J7, 'server side: /api/rdv reachable (not the beta 503; 401 without a citizen session)', rdvApi.status === 401, `GET /api/rdv/structures/r31-s1/services → ${rdvApi.status}`);
  noPageErrors(J7, [a]);
});

await browser.close();
const journeys = [...new Set(rows.map((r) => r.journey))].map((j) => ({ journey: j, pass: rows.filter((r) => r.journey === j && r.pass).length, fail: rows.filter((r) => r.journey === j && !r.pass).length }));
const summary = { base, betaBase, at: new Date().toISOString(), total: rows.length, pass: rows.filter((r) => r.pass).length, fail: rows.filter((r) => !r.pass).length, journeys,
  screens: screens.length, axeViolations: screens.reduce((n, s) => n + s.axeViolations, 0), pageErrors: actors.reduce((n, a) => n + a.pageErrors.length, 0), consoleErrors: actors.reduce((n, a) => n + a.consoleErrors.length, 0) };
console.log(`R37_BROWSER_JOURNEYS ${JSON.stringify(summary)}`);
if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, `${JSON.stringify({ summary, rows, screens, consoleErrors: actors.map((a) => ({ actor: a.label, errors: a.consoleErrors })) }, null, 2)}\n`); }
process.exit(summary.fail ? 1 : 0);
