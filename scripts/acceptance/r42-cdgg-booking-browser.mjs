#!/usr/bin/env node
/**
 * R42 (DEC-R42-01/02/03, R42-A03/A04/A06/A07/A08) — the ten CDGG Conseil acceptance scenarios in a REAL browser (system Chrome), LAB only.
 *
 *   node scripts/acceptance/r42-cdgg-booking-browser.mjs http://127.0.0.1:5173 --credentials <file from seed-cdgg-conseil.mjs> --out <evidence dir> [--only S1,S2] [--mailer test|noop]
 *
 * The LAB server (scripts/lab-server.mjs) serves the beta build with the appointments, accounts and pro surfaces open, ADA_PUBLIC_CONTENT_MODE=lab,
 * PRO_MFA_REQUIRED=true and MAILER_PROVIDER=test (the verification link is read from the LAB outbox /__lab/outbox); S9 runs against the same server
 * restarted with MAILER_PROVIDER=noop (--mailer noop --only S9). The fixture is scripts/lab/seed-cdgg-conseil.mjs (seed, then enrol). Optional
 * DATABASE_URL (local only) adds the database checks (assignment, audit rows, capacity). Nothing is sent outside 127.0.0.1; no real e-mail.
 *
 * S1 first contact · S2 existing relationship · S3 wrong structure · S4 no availability · S5 absence / exception · S6 two citizens, one slot ·
 * S7 unauthorized access + anonymous POST on every booking route · S8 390 px in six languages (ar RTL), axe, no horizontal scroll, keyboard ·
 * S9 no mail provider · S10 Mode B request, accept, reschedule (back to REQUESTED), cancel, capacity, audit; plus: the optional message never in a URL,
 * a console line or a GET answer to a non-staff session; a Mode B request is shown as a « demande », never « confirmé ».
 * Results: <out>/r42-cdgg-acceptance[-noop].json and a few screenshots (no secret, no password, no token in them).
 */
import fs from 'node:fs';
import path from 'node:path';

const base = (process.argv.find((a) => /^https?:\/\//.test(a)) || 'http://127.0.0.1:5173').replace(/\/$/, '');
const opt = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const baseUrl = new URL(base);
if (!['127.0.0.1', 'localhost'].includes(baseUrl.hostname) || baseUrl.port === '3000') { console.error('refusing: the LAB server must be local and never on port 3000'); process.exit(3); }
const cred = JSON.parse(fs.readFileSync(opt('credentials') || '', 'utf8'));
const outDir = opt('out') || '.'; fs.mkdirSync(outDir, { recursive: true });
const mailer = opt('mailer', 'test');
// The API's Origin gate (SEC-03, api/index.js — not changed here) admits the LAB browser origin only on port 5173, which belongs to the QA launcher. This
// stream runs on another port (5194): the harness presents the admitted LAB origin on the /api requests of its browser contexts. Everything else stays
// enforced (CSRF double-submit cookie, session, roles, beta gate).
const GATE_ORIGIN = opt('gate-origin', 'http://127.0.0.1:5173');
const only = new Set(String(opt('only', 'S1,S2,S3,S4,S5,S6,S7,S8,S10')).split(','));
const STAMP = Date.now();
const MSG = `Motif fictif R42 ${STAMP} : aide pour un dossier de recherche d’emploi`;

/** @type {Array<{ scenario: string, step: string, pass: boolean, detail: string }>} */
const rows = [];
let current = 'setup';
const check = (step, ok, detail = '') => { rows.push({ scenario: current, step, pass: Boolean(ok), detail: String(detail).slice(0, 400) }); console.log(`${ok ? 'PASS' : 'FAIL'} [${current}] ${step}${ok ? '' : ` — ${String(detail).slice(0, 300)}`}`); };
const shots = [];
const shot = async (page, name) => { const f = path.join(outDir, `${name}.png`); await page.screenshot({ path: f, fullPage: false }); shots.push(path.basename(f)); };

// optional database checks (local only)
let pgc = null;
if (process.env.DATABASE_URL) {
  const u = new URL(process.env.DATABASE_URL);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname)) { console.error('refusing: DATABASE_URL is not local'); process.exit(3); }
  const pg = (await import('pg')).default; pgc = new pg.Client({ connectionString: process.env.DATABASE_URL }); await pgc.connect();
}
const dbq = async (q, p = []) => (pgc ? (await pgc.query(q, p)).rows : null);

const { chromium } = await import('playwright');
const AxeBuilder = (await import('@axe-core/playwright')).default;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });

/** every citizen context records its URLs, console lines and GET answers (the message must never appear there) */
const leakLog = { urls: [], console: [], getBodies: [] };
async function citizenContext({ width = 1280, height = 900, lang = 'fr', storageState } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: lang, storageState, serviceWorkers: 'block' });
  await ctx.addInitScript((l) => { try { localStorage.setItem('ada_lang', l); localStorage.setItem('ada_onboarding_done', '1'); } catch { /* storage refused */ } }, lang);
  ctx.on('request', (r) => leakLog.urls.push(r.url()));
  await ctx.route(`${base}/api/**`, async (route) => { const h = await route.request().allHeaders(); if (!h.origin) return route.continue(); try { await route.fulfill({ response: await route.fetch({ headers: { ...h, origin: GATE_ORIGIN } }) }); } catch { await route.abort().catch(() => {}); } });
  ctx.on('response', async (r) => {
    if (r.request().method() !== 'GET' || !r.url().includes('/api/')) return;
    try { leakLog.getBodies.push((await r.text()).slice(0, 200_000)); } catch { /* body gone */ }
  });
  ctx.on('page', (p) => { p.on('console', (m) => leakLog.console.push(m.text())); p.on('framenavigated', (f) => { if (f === p.mainFrame()) leakLog.urls.push(f.url()); }); });
  return ctx;
}
/** the citizen API through the browser's own cookies (session + CSRF double-submit pair), as the page does */
async function capi(ctx, method, p, body) {
  const cookies = await ctx.cookies(base);
  const csrf = cookies.find((c) => c.name === '__csrf')?.value || '';
  const r = await ctx.request.fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', origin: GATE_ORIGIN, ...(csrf ? { 'x-csrf-token': csrf } : {}) }, data: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status(), json };
}
const audit = async (page, step) => {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  check(`${step}: axe WCAG 2.1 A/AA — 0 serious/critical`, bad.length === 0, bad.map((v) => `${v.id} ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' ; ')}`).join(' | '));
  return r.violations.length;
};
const outbox = async (to) => (await (await fetch(`${base}/__lab/outbox?to=${encodeURIComponent(to)}`)).json());
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const parisDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso));
const parisHM = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const weekday = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const plusDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const svcA = cred.services.direct.id; const svcB = cred.services.approval.id; const slug = cred.structure.slug;

async function citizenLogin(ctx, who, next = `/rdv/${slug}/booking`) {
  const page = await ctx.newPage();
  await page.goto(`${base}/auth/login?next=${encodeURIComponent(next)}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#auth-email').fill(who.email);
  await page.locator('#auth-password').fill(who.password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/auth/'), { timeout: 20000 });
  return page;
}

// professional sessions over HTTP (password + TOTP from the fixture's enrolment): few sign-ins (5 per 15 minutes per address — the real limit)
const { generateCode } = await import('../../api/lib/totp.js');
const proTokens = new Map();
async function proLogin(k) {
  if (proTokens.has(k)) return proTokens.get(k);
  const p = cred.pros[k];
  const first = await fetch(`${base}/api/health/live`); const csrf = (/__csrf=([^;]+)/.exec(first.headers.get('set-cookie') || '') || [])[1] || '';
  const h = { 'content-type': 'application/json', cookie: `__csrf=${csrf}`, 'x-csrf-token': csrf };
  const r = await (await fetch(`${base}/api/pro/auth/login`, { method: 'POST', headers: h, body: JSON.stringify({ email: p.email, password: p.password }) })).json();
  let token = r.token;
  if (r.mfa_required) {
    // a code is accepted once per 30-second step (claimProStep): the fixture's enrolment may just have used this one — wait for the next step
    const s0 = Math.floor(Date.now() / 30_000); while (Math.floor(Date.now() / 30_000) === s0) await new Promise((res) => setTimeout(res, 500));
    const v = await (await fetch(`${base}/api/pro/auth/mfa-verify`, { method: 'POST', headers: h, body: JSON.stringify({ mfa_token: r.mfa_token, code: generateCode(p.totpSecret, Math.floor(Date.now() / 30_000)) }) })).json();
    token = v.token;
  }
  if (!token) throw new Error(`pro sign-in failed for ${k}`);
  proTokens.set(k, token);
  return token;
}
async function papi(k, method, p, body) {
  const r = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${await proLogin(k)}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
}
const slotsApi = async (ctx, serviceId, professional, from = plusDays(1), to = plusDays(13)) => capi(ctx, 'GET', `/api/rdv/structures/${slug}/slots?serviceId=${serviceId}&from=${from}&to=${to}${professional ? `&professional=${encodeURIComponent(professional)}` : ''}`);
const teamApi = async (ctx, serviceId) => capi(ctx, 'GET', `/api/rdv/structures/${slug}/team?serviceId=${serviceId}`);
const book = async (ctx, serviceId, startAt, extra = {}) => capi(ctx, 'POST', '/api/rdv/appointments', { structureSlug: slug, serviceId, startAt, idempotencyKey: `cdgg-${STAMP}-${Math.random()}`, ...extra });
/** the person's list: { appointments: [...] } */
const listOf = (j) => (Array.isArray(j) ? j : j?.appointments || j?.items || []);
const handleOf = (team, name) => team.professionals.find((p) => p.displayName === name)?.id;

/** shared state between scenarios */
const S = { visitor: null, visitorAppt: null, clientCtx: null, secondCtx: null, visitorCtx: null };

async function ensureClient() { if (!S.clientCtx) { S.clientCtx = await citizenContext(); (await citizenLogin(S.clientCtx, cred.citizens.client)).close(); } return S.clientCtx; }
async function ensureSecond() { if (!S.secondCtx) { S.secondCtx = await citizenContext(); (await citizenLogin(S.secondCtx, cred.citizens.second)).close(); } return S.secondCtx; }

async function scenario(id, fn) {
  if (!only.has(id)) return;
  current = id;
  try { await fn(); } catch (e) { check('scenario ran to the end', false, e?.stack || e); }
}

try {
  await scenario('S1', async () => {
    const ctx = await citizenContext(); S.visitorCtx = ctx;
    const page = await ctx.newPage();
    await page.goto(`${base}/recherche?q=${encodeURIComponent('démarches administratives emploi')}`, { waitUntil: 'domcontentloaded' });
    const hit = page.getByRole('link', { name: /CDGG Conseil/ }).first();
    check('the search « démarches administratives emploi » finds CDGG Conseil (LAB mode)', await hit.waitFor({ timeout: 20000 }).then(() => true, () => false));
    await hit.click();
    await page.waitForURL(`**/structures/${slug}`, { timeout: 20000 });
    await page.getByText('Provenance et fraîcheur').waitFor({ timeout: 20000 });
    const body = await page.locator('main').innerText();
    check('the profile states « Structure fictive de démonstration — environnement LAB uniquement »', body.includes('Structure fictive de démonstration — environnement LAB uniquement'));
    check('the profile is labelled as unverified demonstration content (never « vérifié »)', /Contenu de démonstration : cette fiche n’a pas été vérifiée/.test(body), body.slice(0, 200));
    check('no phone, no real address (« Adresse fictive »)', /Adresse fictive/.test(body) && !/(\+33|0[1-9])([ .-]?\d{2}){4}/.test(body));
    check('the profile says an account is required and that listing is no partnership', /Un compte particulier est nécessaire/.test(body) && /ne signifie pas un partenariat/.test(body));
    await audit(page, 'structure profile');
    await shot(page, 's1-structure-profile');
    await page.getByRole('link', { name: 'Voir les créneaux disponibles' }).click();
    await page.waitForURL('**/auth/login**', { timeout: 20000 });
    check('booking without an account leads to sign-in (no anonymous booking)', page.url().includes('/auth/login?next='), new URL(page.url()).pathname);
    await page.getByRole('link', { name: 'Je n\'ai pas de compte' }).click();
    await page.waitForURL('**/auth/signup**', { timeout: 20000 });
    S.visitor = { email: `visiteur.${STAMP}@${cred.visitorDomain}`, password: `Lab-${STAMP}-Visiteur!a1` };
    await page.locator('#auth-adult').waitFor({ timeout: 20000 });
    const adult = page.locator('#auth-adult');
    check('the adult declaration is never pre-ticked', (await adult.count()) === 1 && !(await adult.isChecked()));
    await page.locator('#auth-email').fill(S.visitor.email);
    await page.locator('#auth-password').fill(S.visitor.password);
    await page.locator('#auth-password-confirm').fill(S.visitor.password);
    const submit = page.locator('form button[type="submit"]').first();
    await submit.click();
    const summary = page.getByTestId('auth-error-summary');
    check('without « J’ai 18 ans ou plus » the sign-up is refused with an error summary (no account created)', await summary.waitFor({ timeout: 10000 }).then(() => true, () => false) && page.url().includes('/auth/signup'), (await summary.innerText().catch(() => '')).slice(0, 120));
    await adult.check();
    await audit(page, 'sign-up form');
    await submit.click();
    await page.waitForURL('**/auth/verify-email**', { timeout: 20000 });
    const mails = await outbox(S.visitor.email);
    const link = (/(https?:\/\/[^\s]+\/auth\/verify-email\?[^\s]+)/.exec(mails.map((m) => m.text).join('\n')) || [])[1];
    check('a verification link is in the LAB test outbox (nothing sent outside)', Boolean(link), `${mails.length} message(s)`);
    const vurl = new URL(link); await page.goto(`${base}${vurl.pathname}${vurl.search}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.goto(`${base}/auth/login?next=${encodeURIComponent(`/rdv/${slug}/booking`)}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#auth-email').fill(S.visitor.email); await page.locator('#auth-password').fill(S.visitor.password);
    await page.locator('form button[type="submit"]').first().click();
    await page.waitForURL(`**/rdv/${slug}/booking**`, { timeout: 20000 });
    check('after sign-in the person returns to the booking of this structure', page.url().includes(`/rdv/${slug}/booking`));
    await page.getByTestId('booking-suitability').waitFor({ timeout: 20000 });
    await page.getByTestId('booking-suitability').getByLabel('Oui').check();
    check('the suitability step asks no health question', /Aucune question sur votre santé/.test(await page.getByTestId('booking-suitability').innerText()));
    await audit(page, 'suitability + services');
    await page.getByTestId(`booking-service-${svcA}`).click();
    const choice = page.getByTestId('booking-professional-choice');
    await choice.waitFor({ timeout: 20000 });
    const choiceText = await choice.innerText();
    check('team choice: « pas de préférence » and the publicly selectable professionals only', /Pas de préférence/.test(choiceText) && choiceText.includes(cred.pros.p1.name) && choiceText.includes(cred.pros.p2.name) && !choiceText.includes(cred.pros.p3.name), choiceText.slice(0, 300));
    check('no « previous professional » for a first-time visitor', (await page.getByTestId('booking-professional-PREVIOUS').count()) === 0);
    check('no professional e-mail is shown', !/@/.test(choiceText));
    await audit(page, 'professional choice');
    await choice.getByLabel(new RegExp(cred.pros.p1.name)).check();
    await page.getByTestId('booking-professional-continue').click();
    const slot = page.getByTestId('booking-slot').first();
    await slot.waitFor({ timeout: 20000 });
    // the slots offered for P1 follow P1's own hours (Mon–Wed + the extra Thursday afternoon, never the exception day)
    const team = (await teamApi(ctx, svcA)).json; const h1 = handleOf(team, cred.pros.p1.name);
    const p1 = (await slotsApi(ctx, svcA, h1)).json.slots;
    const okHours = p1.every((s) => { const d = parisDay(s.startAt); const wd = weekday(d); return d !== cred.dates.p1UnavailableDay && ([1, 2, 3].includes(wd) || (d === cred.dates.p1ExtraAvailableDay && parisHM(s.startAt) >= '14:00' && parisHM(s.startAt) < '16:00')); });
    check('P1\'s slots follow their weekly hours, extra availability and exception (R42-CDGG)', p1.length > 0 && okHours, `${p1.length} slots; ${p1.slice(0, 4).map((s) => `${parisDay(s.startAt)} ${parisHM(s.startAt)}`).join(', ')}`);
    await slot.click();
    await page.getByTestId('booking-message').waitFor({ timeout: 20000 });
    await page.getByTestId('booking-message').locator('textarea').fill(MSG);
    const recap = await page.locator('main').innerText();
    check('the owner wording of the optional message and its notice', recap.includes('Précisez brièvement le motif de votre rendez-vous (facultatif)') && recap.includes('Ne transmettez pas de diagnostic ni de document médical dans ce champ.'));
    await audit(page, 'recap with the message');
    const [resp] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/rdv/appointments') && r.request().method() === 'POST', { timeout: 30000 }), page.getByTestId('booking-confirm').click()]);
    const created = await resp.json().catch(() => ({}));
    S.visitorAppt = created;
    await page.getByTestId('booking-success').waitFor({ timeout: 20000 });
    const state = await page.getByTestId('booking-state').getAttribute('data-state');
    check('Mode A: the state is CONFIRMED (server) and shown as confirmed', resp.status() === 201 && created.state === 'CONFIRMED' && state === 'CONFIRMED', `${resp.status()} ${created.state} ${state}`);
    const outcome = await page.getByTestId('rdv-mail-outcome').getAttribute('data-outcome');
    check('the e-mail outcome is the real one (TEST_RECORDED with the LAB test provider)', outcome === 'TEST_RECORDED' && created.notification?.email === 'TEST_RECORDED', `${outcome} / ${created.notification?.email}`);
    await audit(page, 'booking result');
    await shot(page, 's1-booking-confirmed');
    const mine = await capi(ctx, 'GET', '/api/rdv/appointments');
    check('« Mes rendez-vous » lists it with the server state', mine.status === 200 && listOf(mine.json).some((a) => a.id === created.id && a.state === 'CONFIRMED'));
    check('the person\'s own appointment JSON does not echo the message', !JSON.stringify(mine.json).includes(MSG));
    if (pgc) {
      const row = (await dbq(`SELECT "createdByProUserId" AS pro, notes FROM "ProAppointment" WHERE id = $1`, [created.id]))[0];
      check('assigned to P1; the message is sealed at rest (no plaintext in the row)', row?.pro === cred.pros.p1.id && typeof row.notes === 'string' && row.notes.startsWith('v1:') && !row.notes.includes(STAMP), row ? `${row.pro} ${String(row.notes).slice(0, 4)}` : 'no row');
    }
    const staff = await papi('admin', 'GET', '/api/pro/appointments');
    const item = (staff.json?.items || staff.json || []).find((a) => a.id === created.id);
    check('the structure (staff) reads the message', item?.citizenMessage === MSG, item ? 'present' : `${staff.status}`);
  });

  await scenario('S2', async () => {
    const ctx = await ensureClient();
    const page = await ctx.newPage();
    await page.goto(`${base}/rdv/${slug}/booking`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('booking-suitability').waitFor({ timeout: 20000 });
    await page.getByTestId('booking-suitability').getByLabel('Non, je l’ai déjà rencontrée').check();
    await page.getByTestId('booking-suitability-same-person').locator('input').check();
    await page.getByTestId(`booking-service-${svcA}`).click();
    const prev = page.getByTestId('booking-professional-PREVIOUS');
    check('the existing client is offered « la même personne que lors de mon précédent rendez-vous »', await prev.waitFor({ timeout: 20000 }).then(() => true, () => false));
    check('it is preselected after « revoir la même personne »', await prev.isChecked().catch(() => false));
    const text = await page.getByTestId('booking-professional-choice').innerText();
    check('the previous professional is not named (P3 is not publicly selectable)', !text.includes(cred.pros.p3.name), text.slice(0, 200));
    await audit(page, 'previous professional');
    const other = (await teamApi(S.visitorCtx || (await ensureSecond()), svcA)).json;
    check('another citizen does not get this relationship (previous.available false)', other.previous?.available === false && other.previous?.displayName === null, JSON.stringify(other.previous));
    await page.getByTestId('booking-professional-continue').click();
    const slot = page.getByTestId('booking-slot').first();
    await slot.waitFor({ timeout: 20000 });
    await slot.click();
    const [resp] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/rdv/appointments') && r.request().method() === 'POST', { timeout: 30000 }), page.getByTestId('booking-confirm').click()]);
    const created = await resp.json().catch(() => ({}));
    check('booked with « PREVIOUS »', resp.status() === 201 && created.state === 'CONFIRMED', `${resp.status()} ${created.error || ''}`);
    if (pgc) check('assigned to the previous professional (P3)', (await dbq(`SELECT "createdByProUserId" AS pro FROM "ProAppointment" WHERE id = $1`, [created.id]))[0]?.pro === cred.pros.p3.id);
    const second = await ensureSecond();
    const r = await slotsApi(second, svcA, 'PREVIOUS');
    const u = await slotsApi(second, svcA, 'p_unknownunknownunknown0');
    check('for another citizen, PREVIOUS and an unknown handle give the same refusal', r.status === 409 && JSON.stringify(r) === JSON.stringify(u), `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
    S.clientAppt = created;
    await page.close();
  });

  await scenario('S3', async () => {
    const ctx = await ensureSecond();
    const page = await ctx.newPage();
    const posts = []; page.on('request', (rq) => { if (rq.method() === 'POST' && rq.url().includes('/api/rdv/appointments')) posts.push(rq.url()); });
    const before = pgc ? (await dbq(`SELECT count(*)::int n FROM "ProAppointment" WHERE "citizenUserId" = $1`, [cred.citizens.second.id]))[0].n : null;
    await page.goto(`${base}/rdv/${slug}/booking`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('booking-not-listed').click();
    const box = page.getByTestId('booking-wrong-structure');
    check('« Mon besoin ne figure pas dans cette liste » shows alternatives', await box.waitFor({ timeout: 20000 }).then(() => true, () => false));
    const links = await box.locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    check('alternatives: the directory, orientation and the structure page', links.includes('/structures') && links.some((h) => /orientation|besoins/.test(h || '')) && links.some((h) => (h || '').includes(`/structures/${slug}`)), links.join(' '));
    await audit(page, 'wrong structure');
    check('no booking request was pushed', posts.length === 0, posts.join(' '));
    if (pgc) check('no appointment row written', (await dbq(`SELECT count(*)::int n FROM "ProAppointment" WHERE "citizenUserId" = $1`, [cred.citizens.second.id]))[0].n === before);
    await page.close();
  });

  await scenario('S4', async () => {
    // the unrelated structure closes for 15 days (a structure closure, by its own administrator): no slot in the 14-day window
    const t = new Date(); const from = new Date(t.getTime() - 3600_000); const to = new Date(t.getTime() + 16 * 86_400_000);
    const close = await papi('temoinAdmin', 'POST', '/api/pro/timeoff', { startAt: from.toISOString(), endAt: to.toISOString(), scope: 'structure', reason: 'Fermeture fictive de test' });
    check('the unrelated structure records a closure', close.status === 201, `${close.status}`);
    const prof = await (await fetch(`${base}/api/rdv/structures/${cred.temoin.slug}/profile`)).json();
    check('the public profile says there is no next available day (no invented availability)', prof.nextAvailableDay === null, JSON.stringify(prof.nextAvailableDay));
    const ctx = await ensureSecond();
    const page = await ctx.newPage();
    await page.goto(`${base}/rdv/${cred.temoin.slug}/booking`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId(`booking-service-${cred.services.temoin.id}`).click({ timeout: 20000 });
    const empty = page.getByTestId('booking-slots-empty');
    check('the slot step says « Aucun créneau disponible sur les 14 prochains jours » (not an error)', await empty.waitFor({ timeout: 20000 }).then(() => true, () => false) && (await page.getByTestId('booking-slots-error').count()) === 0);
    check('alternatives are offered (another service, the structure, the directory)', /Choisissez un autre service ou contactez la structure/.test(await empty.innerText()));
    await audit(page, 'no availability');
    await page.close();
    if (close.json?.item?.id) await papi('temoinAdmin', 'DELETE', `/api/pro/timeoff?id=${close.json.item.id}`);
  });

  await scenario('S5', async () => {
    const ctx = S.visitorCtx || (await ensureSecond());
    const team = (await teamApi(ctx, svcA)).json; const h1 = handleOf(team, cred.pros.p1.name); const h2 = handleOf(team, cred.pros.p2.name);
    const p1 = (await slotsApi(ctx, svcA, h1)).json.slots; const p2 = (await slotsApi(ctx, svcA, h2)).json.slots;
    check('the seeded P1 date exception removes all of P1\'s slots that day', !p1.some((s) => parisDay(s.startAt) === cred.dates.p1UnavailableDay));
    check('the seeded P2 absence removes P2\'s morning that day', !p2.some((s) => parisDay(s.startAt) === cred.dates.p2AbsenceDay && parisHM(s.startAt) < '12:00'));
    check('the extra availability adds P1 on a Thursday afternoon, inside the opening hours only', p1.filter((s) => parisDay(s.startAt) === cred.dates.p1ExtraAvailableDay).map((s) => parisHM(s.startAt)).join(',') === '14:00,15:00',
      p1.filter((s) => parisDay(s.startAt) === cred.dates.p1ExtraAvailableDay).map((s) => parisHM(s.startAt)).join(','));
    // P1 changes their own schedule: unavailable on the day of the S1 appointment → that appointment is kept and listed (policy), the slots disappear
    const apptDay = S.visitorAppt?.startsAt ? parisDay(S.visitorAppt.startsAt) : null;
    const mineNow = await papi('p1', 'GET', '/api/pro/rdv/hours');
    const own = mineNow.json?.members?.find((m) => m.mine)?.hours;
    check('a professional reads only their own hours', mineNow.status === 200 && mineNow.json.canManageOthers === false && mineNow.json.members.length === 1);
    if (own && apptDay) {
      const put = await papi('p1', 'PUT', '/api/pro/rdv/hours', { weekly: own.weekly, exceptions: [...own.exceptions.map((e) => ({ kind: e.kind, from: e.from, to: e.to, startTime: e.startTime, endTime: e.endTime })), { kind: 'UNAVAILABLE', from: apptDay, to: apptDay }] });
      check('P1 records an unavailability; the appointment already booked that day is kept and listed for the team', put.status === 200 && put.json.appointmentsOutsideHours.some((a) => a.id === S.visitorAppt.id), `${put.status} ${JSON.stringify(put.json?.appointmentsOutsideHours || put.json).slice(0, 160)}`);
      const after = (await slotsApi(ctx, svcA, h1)).json.slots;
      check('P1 has no slot left that day', !after.some((s) => parisDay(s.startAt) === apptDay));
      const mine = await capi(S.visitorCtx, 'GET', '/api/rdv/appointments');
      check('the person\'s appointment stays CONFIRMED (never cancelled silently)', listOf(mine.json).find((a) => a.id === S.visitorAppt.id)?.state === 'CONFIRMED');
    }
    const cross = await papi('temoinPro', 'PUT', '/api/pro/rdv/hours', { memberId: cred.pros.p1.id, weekly: [], exceptions: [] });
    const unknown = await papi('temoinPro', 'PUT', '/api/pro/rdv/hours', { memberId: 'lab-nobody', weekly: [], exceptions: [] });
    check('another structure\'s professional cannot change P1\'s hours (same answer as an unknown member)', cross.status === unknown.status && JSON.stringify(cross.json) === JSON.stringify(unknown.json) && [403, 404].includes(cross.status), `${cross.status}/${unknown.status}`);
    // the professional's screen (the Disponibilités page), as P1, in the browser
    const pctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr' });
    const tok = await proLogin('p1');
    await pctx.addInitScript((t) => { try { localStorage.setItem('pro_token', t); localStorage.setItem('ada_lang', 'fr'); localStorage.setItem('ada_onboarding_done', '1'); } catch { /* */ } }, tok);
    const pp = await pctx.newPage();
    await pp.goto(`${base}/pro/rdv/disponibilites`, { waitUntil: 'domcontentloaded' });
    const panel = pp.getByTestId('pro-member-hours');
    check('the professional\'s « Horaires de travail par professionnel » panel opens', await panel.waitFor({ timeout: 25000 }).then(() => true, () => false));
    check('the panel shows P1\'s exceptions', (await pp.getByTestId('pro-member-hours-exception').count()) >= 2);
    await panel.scrollIntoViewIfNeeded();
    await audit(pp, 'pro hours panel');
    await shot(pp, 's5-pro-hours-panel');
    await pctx.close();
  });

  await scenario('S6', async () => {
    const a = await ensureClient(); const b = await ensureSecond();
    const team = (await teamApi(a, svcA)).json; const h2 = handleOf(team, cred.pros.p2.name);
    const slots = (await slotsApi(a, svcA, h2)).json.slots;
    const target = slots[slots.length - 1];
    const [x, y] = await Promise.all([book(a, svcA, target.startAt, { professional: h2 }), book(b, svcA, target.startAt, { professional: h2 })]);
    check('two citizens on the same slot of the same professional at once: exactly one wins', [x.status, y.status].sort().join(',') === '201,409', `${x.status} ${y.status}`);
    const after = (await slotsApi(b, svcA, h2)).json.slots;
    check('the slot is no longer offered for that professional', !after.some((s) => s.startAt === target.startAt));
    if (pgc) check('one active row for that professional and start', (await dbq(`SELECT count(*)::int n FROM "ProAppointment" WHERE "structureId" = $1 AND "createdByProUserId" = $2 AND "startAt" = $3 AND status IN ('confirmed','booked','requested','locked')`, [cred.structure.id, cred.pros.p2.id, target.startAt]))[0].n === 1);
    S.raceWinner = x.status === 201 ? { ctx: a, appt: x.json } : { ctx: b, appt: y.json };
  });

  await scenario('S7', async () => {
    const victim = S.visitorAppt?.id || S.clientAppt?.id;
    const b = await ensureSecond();
    const g = await capi(b, 'GET', `/api/rdv/appointments/${victim}`);
    const gu = await capi(b, 'GET', '/api/rdv/appointments/lab-unknown-appointment');
    const c = await capi(b, 'POST', `/api/rdv/appointments/${victim}/cancel`, {});
    const cu = await capi(b, 'POST', '/api/rdv/appointments/lab-unknown-appointment/cancel', {});
    const r = await capi(b, 'POST', `/api/rdv/appointments/${victim}/reschedule`, { startAt: new Date(Date.now() + 5 * 86_400_000).toISOString() });
    check('another citizen: GET / cancel / reschedule of someone\'s appointment → 404, identical to an unknown id', g.status === 404 && c.status === 404 && r.status === 404 && JSON.stringify(g) === JSON.stringify(gu) && JSON.stringify(c) === JSON.stringify(cu), `${g.status} ${c.status} ${r.status}`);
    const list = await capi(b, 'GET', '/api/rdv/appointments');
    check('…and it is not in their list', !JSON.stringify(list.json).includes(victim));
    const pl = await papi('temoinPro', 'GET', '/api/pro/appointments');
    check('a professional of another structure does not see CDGG appointments', pl.status === 200 && !JSON.stringify(pl.json).includes(victim) && !JSON.stringify(pl.json).includes(MSG));
    const dec = await papi('temoinPro', 'PATCH', `/api/pro/appointments?id=${encodeURIComponent(victim)}`, { decision: 'ACCEPT' });
    const decU = await papi('temoinPro', 'PATCH', '/api/pro/appointments?id=lab-unknown-appointment', { decision: 'ACCEPT' });
    check('…and cannot act on one (same answer as an unknown id)', dec.status === decU.status && dec.status >= 400 && JSON.stringify(dec.json) === JSON.stringify(decU.json), `${dec.status}/${decU.status}`);
    const team = await papi('temoinPro', 'GET', '/api/pro/rdv/hours');
    check('another structure\'s hours screen holds nothing of CDGG', team.status === 200 && !JSON.stringify(team.json).includes('cdgg'));
    // anonymous: every booking route refused (with a valid CSRF pair, so that the refusal is the authentication's, not the CSRF check's)
    const anon = await citizenContext(); const ap = await anon.newPage(); await ap.goto(`${base}/structures/${slug}`, { waitUntil: 'networkidle' });
    check('the anonymous browser holds a CSRF pair (the refusals below are the authentication\'s)', (await anon.cookies(base)).some((c) => c.name === '__csrf'));
    const routes = [['POST', '/api/rdv/appointments'], ['POST', `/api/rdv/appointments/${victim}/cancel`], ['POST', `/api/rdv/appointments/${victim}/reschedule`], ['GET', '/api/rdv/appointments'],
      ['GET', `/api/rdv/appointments/${victim}`], ['GET', `/api/rdv/structures/${slug}/slots?serviceId=${svcA}`], ['GET', `/api/rdv/structures/${slug}/team?serviceId=${svcA}`], ['POST', '/api/citizen/age-declaration'],
      ['POST', '/api/rdv/guest/hold'], ['POST', '/api/rdv/guest/confirm'], ['POST', '/api/rdv/guest/manage/cancel'], ['POST', '/api/rdv/guest/manage/reschedule'], ['POST', '/api/public/appointments/create'], ['PATCH', `/api/pro/appointments?id=${victim}`], ['PUT', '/api/pro/rdv/hours']];
    const answers = [];
    for (const [m, p] of routes) { const x = await capi(anon, m, p, m === 'GET' ? undefined : { structureSlug: slug, serviceId: svcA, startAt: new Date().toISOString(), idempotencyKey: 'anon', adult: true }); answers.push(`${m} ${p.split('?')[0]} → ${x.status}${x.status === 403 ? ` ${x.json?.message || x.json?.error || ''}` : ''}`); }
    // 401 no session, 410 retired guest route; the legacy adapter public/appointments/create belongs to no open beta surface (503 before it even runs)
    const okAnswer = (a) => / → (401|410)$/.test(a) || /public\/appointments\/create → 503$/.test(a);
    check('anonymous: every booking route is refused (401 / 410 / beta-closed 503), nothing accepted', answers.every(okAnswer), answers.filter((a) => !okAnswer(a)).join(' | ') || answers.join(' | '));
    if (pgc) check('no row written by the anonymous calls', (await dbq(`SELECT count(*)::int n FROM "ProAppointment" WHERE "idempotencyKey" = 'anon'`))[0].n === 0);
    const profile = await (await fetch(`${base}/api/rdv/structures/${slug}/profile`)).json();
    check('the public profile carries no team member, no hours, no internal configuration', !/rdvMemberHours|rdvBooking|weekly|Fictif|Fictive|@/.test(JSON.stringify(profile)), JSON.stringify(profile).slice(0, 160));
    await anon.close();
  });

  await scenario('S8', async () => {
    const client = await ensureClient();
    const storage = await client.storageState();
    for (const lang of ['fr', 'en', 'tr', 'ar', 'de', 'uk']) {
      const ctx = await citizenContext({ width: 390, height: 844, lang, storageState: storage });
      const page = await ctx.newPage();
      for (const p of [`/structures/${slug}`, `/rdv/${slug}/booking`]) {
        await page.goto(`${base}${p}`, { waitUntil: 'domcontentloaded' });
        await page.locator(p.includes('booking') ? '[data-testid="booking-suitability"]' : 'h1').first().waitFor({ timeout: 20000 });
        await page.waitForFunction((l) => document.documentElement.lang.startsWith(l), lang, { timeout: 10000 }).catch(() => {});
        await page.waitForLoadState('networkidle').catch(() => {});
        const v = await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }));
        check(`${lang} ${p}: html lang/dir`, v.lang.startsWith(lang) && (lang === 'ar' ? v.dir === 'rtl' : v.dir !== 'rtl'), JSON.stringify(v));
        check(`${lang} ${p}: no horizontal scroll at 390 px`, await noHScroll(page));
        await audit(page, `${lang} ${p} (390 px)`);
      }
      if (lang === 'fr' || lang === 'ar') {
        // keyboard only: Tab to the first service, Enter → the professional step; Tab to « continue », Enter → the slots
        await page.goto(`${base}/rdv/${slug}/booking`, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('booking-suitability').waitFor({ timeout: 20000 });
        let reached = false;
        for (let i = 0; i < 60 && !reached; i += 1) { await page.keyboard.press('Tab'); reached = await page.evaluate((id) => document.activeElement?.getAttribute('data-testid') === id, `booking-service-${svcA}`); }
        if (reached) await page.keyboard.press('Enter');
        const choice = await page.getByTestId('booking-professional-choice').waitFor({ timeout: 15000 }).then(() => true, () => false);
        let cont = false;
        for (let i = 0; i < 30 && choice && !cont; i += 1) { await page.keyboard.press('Tab'); cont = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'booking-professional-continue'); }
        if (cont) await page.keyboard.press('Enter');
        const slots = await page.getByTestId('booking-slot').first().waitFor({ timeout: 20000 }).then(() => true, () => false);
        check(`${lang}: keyboard path service → professional → slots`, reached && choice && cont && slots, `service ${reached}, choice ${choice}, continue ${cont}, slots ${slots}`);
        if (lang === 'ar') await shot(page, 's8-ar-390-slots');
      }
      await ctx.close();
    }
  });

  await scenario('S9', async () => {
    const ctx = await ensureSecond();
    const page = await ctx.newPage();
    await page.goto(`${base}/rdv/${slug}/booking`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId(`booking-service-${svcA}`).click({ timeout: 20000 });
    await page.getByTestId('booking-professional-continue').click({ timeout: 20000 });
    const slots = page.getByTestId('booking-slot');
    await slots.first().waitFor({ timeout: 20000 });
    await slots.nth(Math.min(3, (await slots.count()) - 1)).click();
    const [resp] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/rdv/appointments') && r.request().method() === 'POST', { timeout: 30000 }), page.getByTestId('booking-confirm').click()]);
    const created = await resp.json().catch(() => ({}));
    await page.getByTestId('booking-success').waitFor({ timeout: 20000 });
    const note = page.getByTestId('rdv-mail-outcome');
    const text = await note.innerText();
    check('no provider: the answer says NO_PROVIDER', created.notification?.email === 'NO_PROVIDER', JSON.stringify(created.notification));
    check('the screen says no e-mail was sent (never « envoyé » as done)', (await note.getAttribute('data-outcome')) === 'NO_PROVIDER' && /Aucun e-mail n’a été envoyé/.test(text) && !/e-mail (de confirmation )?(a été )?envoyé(?! )/.test(text.replace('Aucun e-mail n’a été envoyé', '')), text);
    await audit(page, 'booking result without a mail provider');
    await shot(page, 's9-no-provider');
    await capi(ctx, 'POST', `/api/rdv/appointments/${created.id}/cancel`, {});
    await page.close();
  });

  await scenario('S10', async () => {
    const ctx = await ensureClient();
    const page = await ctx.newPage();
    await page.goto(`${base}/rdv/${slug}/booking`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId(`booking-service-${svcB}`).click({ timeout: 20000 });
    await page.getByTestId('booking-professional-ANY').check({ timeout: 20000 });
    await page.getByTestId('booking-professional-continue').click();
    const slots = page.getByTestId('booking-slot'); await slots.first().waitFor({ timeout: 20000 });
    await slots.last().click();   // the furthest slot: a booking can be moved online only well before it (24 h rule)
    check('Mode B: the recap warns that the structure validates each request', await page.getByTestId('booking-approval-notice').isVisible());
    check('Mode B: the button says « Envoyer la demande de rendez-vous »', /Envoyer la demande de rendez-vous/.test(await page.getByTestId('booking-confirm').innerText()));
    const [resp] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/rdv/appointments') && r.request().method() === 'POST', { timeout: 30000 }), page.getByTestId('booking-confirm').click()]);
    const req = await resp.json().catch(() => ({}));
    await page.getByTestId('booking-success').waitFor({ timeout: 20000 });
    const success = await page.getByTestId('booking-success').innerText();
    check('a Mode B request is REQUESTED, shown as a « demande », never as confirmed, no calendar file', req.state === 'REQUESTED' && req.awaitingApproval === true && !req.calendar
      && /Demande envoyée/.test(success) && /pas encore confirmé/.test(success) && !/C’est confirmé/.test(success) && (await page.getByTestId('booking-download-ics').count()) === 0, success.slice(0, 200));
    await audit(page, 'Mode B request sent');
    await shot(page, 's10-request-sent');
    const startA = req.startsAt;
    const anyNow = (await slotsApi(ctx, svcB, 'ANY')).json.slots.map((s) => s.startAt);
    const accept = await papi('admin', 'PATCH', `/api/pro/appointments?id=${encodeURIComponent(req.id)}`, { decision: 'ACCEPT' });
    check('the structure accepts → CONFIRMED for the person', accept.status === 200 && (await capi(ctx, 'GET', `/api/rdv/appointments/${req.id}`)).json?.state === 'CONFIRMED', `${accept.status}`);
    // reschedule from « Mes rendez-vous » (Mode B: back to REQUESTED)
    await page.goto(`${base}/compte/rendez-vous`, { waitUntil: 'domcontentloaded' });
    const item = page.getByTestId('rdv-item').filter({ has: page.getByTestId('rdv-move') }).first();
    check('« Mes rendez-vous » offers « Déplacer » on the accepted request', await item.waitFor({ timeout: 20000 }).then(() => true, () => false));
    await audit(page, 'Mes rendez-vous');
    const targetNew = anyNow.find((s) => s !== startA && new Date(s).getTime() > Date.now() + 3 * 86_400_000);
    const moved = await capi(ctx, 'POST', `/api/rdv/appointments/${req.id}/reschedule`, { startAt: targetNew, idempotencyKey: `mv-${STAMP}` });
    check('Mode B reschedule returns the appointment to REQUESTED', moved.status === 200 && moved.json.state === 'REQUESTED' && moved.json.rescheduled === true, `${moved.status} ${moved.json?.state} ${moved.json?.error || ''}`);
    const after = (await slotsApi(ctx, svcB, 'ANY')).json.slots.map((s) => s.startAt);
    if (pgc) {
      const free = (await dbq(`SELECT count(*)::int n FROM "ProAppointment" WHERE "structureId" = $1 AND "startAt" = $2 AND status IN ('confirmed','booked','requested','locked')`, [cred.structure.id, startA]))[0].n;
      check('capacity: the old slot holds no active row any more; the new one holds exactly one', free === 0 && (await dbq(`SELECT count(*)::int n FROM "ProAppointment" WHERE id = $1 AND "startAt" = $2 AND status = 'requested'`, [req.id, targetNew]))[0].n === 1);
    }
    check('capacity seen by the person: the old start is offered again', after.includes(startA));
    // cancel from the page
    await page.reload({ waitUntil: 'domcontentloaded' });
    const it = page.getByTestId('rdv-item').filter({ hasText: /attente|Demand/ }).first();
    await it.waitFor({ timeout: 20000 });
    check('« Mes rendez-vous » shows the moved request as awaiting the structure', /Demande en attente de validation par la structure/.test(await it.innerText()));
    await it.getByTestId('rdv-cancel').click();
    await page.getByTestId('rdv-cancel-confirm').click();
    await page.getByTestId('rdv-status').getByText('Rendez-vous annulé.').waitFor({ timeout: 20000 });
    const final = (await capi(ctx, 'GET', `/api/rdv/appointments/${req.id}`)).json;
    check('cancelled from the page → CANCELLED; the slot is free again', final?.state === 'CANCELLED' && (await slotsApi(ctx, svcB, 'ANY')).json.slots.some((s) => s.startAt === targetNew), final?.state);
    if (pgc) {
      const actions = (await dbq(`SELECT action FROM "AuditLog" WHERE details->>'structureId' = $1 AND "timestamp" > now() - interval '2 hours' ORDER BY "timestamp"`, [cred.structure.id])).map((r) => r.action);
      check('audit rows: the request decision and the hours change are journaled', actions.includes('RDV_REQUEST_ACCEPTED') && actions.includes('RDV_MEMBER_HOURS_UPDATED'), [...new Set(actions)].join(','));
      const dump = JSON.stringify(await dbq(`SELECT details FROM "AuditLog" WHERE details->>'structureId' = $1`, [cred.structure.id]));
      check('audit rows carry no message, no e-mail address, no token', !dump.includes(MSG) && !/@[a-z-]+\.example\.test/.test(dump) && !/sha256:|eyJ[A-Za-z0-9_-]{10,}/.test(dump));
    }
    await page.close();
  });

  // the optional message never appears in a URL, a console line or a GET answer to a non-staff session
  current = 'MESSAGE';
  if (only.has('S1')) {
    check('message absent from every URL of the citizen sessions', !leakLog.urls.some((u) => u.includes(String(STAMP)) || decodeURIComponent(u).includes(MSG)), `${leakLog.urls.length} URLs`);
    check('message absent from every console line', !leakLog.console.some((l) => l.includes(String(STAMP))), `${leakLog.console.length} lines`);
    check('message absent from every GET answer to a citizen session', !leakLog.getBodies.some((b) => b.includes(MSG) || b.includes(`Motif fictif R42 ${STAMP}`)), `${leakLog.getBodies.length} answers`);
  }
} finally {
  await browser.close();
  if (pgc) await pgc.end();
  const summary = {};
  for (const r of rows) { summary[r.scenario] = summary[r.scenario] || { pass: 0, fail: 0 }; summary[r.scenario][r.pass ? 'pass' : 'fail'] += 1; }
  const file = path.join(outDir, `r42-cdgg-acceptance${mailer === 'noop' ? '-noop' : ''}.json`);
  fs.writeFileSync(file, `${JSON.stringify({ base: `${baseUrl.protocol}//${baseUrl.host}`, mailer, ranAt: new Date().toISOString(), browser: `system Chrome (channel ${process.env.PW_CHANNEL || 'chrome'})`, summary, screenshots: shots, checks: rows }, null, 2)}\n`);
  const failed = rows.filter((r) => !r.pass).length;
  console.log(`\n${rows.length - failed}/${rows.length} checks pass — ${Object.entries(summary).map(([k, v]) => `${k} ${v.fail ? 'FAIL' : 'PASS'} (${v.pass}/${v.pass + v.fail})`).join(' · ')}`);
  process.exitCode = failed ? 1 : 0;
}
