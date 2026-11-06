/**
 * R47 journey 2 — PROFESSIONAL, on the built app with the REAL API (run-lab.mjs). Mocks: the LAB test outbox and the local Microsoft authority + Graph only.
 * the structure administrator invites a new member in /pro/team → the invitation e-mail (test outbox) → set password → MFA enrolment bound to the invitation
 * (TOTP; one code per 30 s step) → sign-out → sign-in with password + code → membership and booking rules (the administrator) → own hours and an absence →
 * Outlook free/busy through the mock → a citizen's request arrives → refuse with a reason / accept in the agenda → the citizen moves it (back to a request)
 * → stale decision refused, new decision → the structure cancels → the citizen is notified (notice rows + in-app item; e-mail at the minimal level while
 * the service is not verified ordinary) → the administrator ends the membership → the open session is refused and the sign-in too.
 */
import { test, expect } from '@playwright/test';
import {
  BASE, GRAPH, CREDS, SLUG, SVC_DIRECT, SVC_APPROVAL, STAMP, HAS_0045, db, person, citizenSignIn, proSignIn, outbox, linkIn, axe, allSlots, pickSlot, book,
  expectNotice, papi, bearer, totp, parisHM, auditWithoutPersonalData, forgetPro, lastStep,
} from './lib.mjs';

test.describe.configure({ mode: 'serial' });
const N = { email: `r47-pro-${STAMP}@cdgg-conseil.example.test`, password: `Lab${STAMP}Pro9` };
const S = { since: new Date() };
let admin; let pro; let client;

test.afterAll(async () => {
  // the booking rules of the fixture are given back as they were (the next journeys use them)
  if (S.settingsBefore) await papi('admin', 'PUT', '/api/pro/rdv/settings', { team: S.settingsBefore.team, serviceConfirmation: S.settingsBefore.serviceConfirmation });
  for (const c of [admin, pro, client]) await c?.context.close();
});

test('E03 R01 fr: the administrator invites a member in « Équipe » → e-mail in the test outbox → password chosen → MFA enrolled through the invitation (wrong code refused, one code per step) → link spent', async ({ browser }) => {
  admin = await person(browser);
  const ap = await admin.context.newPage();
  await proSignIn(ap, 'admin', { next: '/pro/team' });
  await ap.getByRole('button', { name: 'Inviter un collaborateur' }).click();
  await ap.locator('#invite-email').fill(N.email);
  await ap.locator('#invite-role').click();   // the role list (keyboard-operable listbox)
  await ap.getByRole('option').first().click();
  await axe(ap, 'invite dialog');
  await ap.getByRole('button', { name: 'Inviter', exact: true }).click();
  await expect.poll(async () => (await outbox(N.email)).length, { timeout: 20000 }).toBeGreaterThanOrEqual(1);
  const link = linkIn(await outbox(N.email), /(https?:\/\/[^\s]+\/pro\/register-invite\?token=[^\s]+)/);
  expect(link).not.toBeNull();
  const inv = new URL(link[1]);
  expect((await admin.api('GET', `/api/pro/auth/register-invite?token=bad${STAMP}`)).status).toBe(404);
  pro = await person(browser);
  const pp = await pro.context.newPage();
  await pp.goto(`${BASE}${inv.pathname}${inv.search}`);
  await pp.locator('#reg-password').fill(N.password); await pp.locator('#reg-confirm').fill(`${N.password}x`);
  await pp.getByRole('button', { name: 'Créer mon accès' }).click();
  await expect(pp.getByText('Les mots de passe ne correspondent pas.')).toBeVisible();
  await pp.locator('#reg-confirm').fill(N.password);
  await axe(pp, 'set password');
  await pp.getByRole('button', { name: 'Créer mon accès' }).click();
  await pp.waitForURL('**/pro/mfa-settings**', { timeout: 30000 });
  const [setup] = await Promise.all([pp.waitForResponse((r) => new URL(r.url()).pathname === '/api/pro/mfa-setup' && r.request().method() === 'GET'), pp.getByRole('button', { name: 'Configurer le MFA' }).click()]);
  expect(setup.status()).toBe(200);
  N.secret = (await setup.json()).secret;
  await expect(pp.getByText(N.secret, { exact: true })).toBeVisible();
  await pp.getByRole('button', { name: /J.ai ajouté le secret/ }).click();
  await pp.locator('#verify-code').fill('000000');
  await pp.getByRole('button', { name: 'Activer le MFA' }).click();
  await expect(pp.getByText(/Code de vérification incorrect/)).toBeVisible();
  await pp.locator('#verify-code').fill(await totp(N.secret, 'newpro'));
  await pp.getByRole('button', { name: 'Activer le MFA' }).click();
  await expect(pp.getByText('Votre compte est protégé par la double authentification.')).toBeVisible();
  await axe(pp, 'MFA enabled');
  const row = (await db(`SELECT id, role, status, mfa_enabled, "structureId" FROM "ProUser" WHERE email = $1`, [N.email]))[0];
  expect(row).toMatchObject({ role: 'PRO', status: 'active', mfa_enabled: true, structureId: CREDS.structure.id });
  N.id = row.id;
  // the invitation is spent: a second use is refused
  expect((await pro.api('GET', `/api/pro/auth/register-invite${inv.search}`)).status).toBe(410);
  const audit = (await db(`SELECT action FROM "AuditLog" WHERE actor_id = $1 ORDER BY "timestamp"`, [N.id])).map((r) => r.action);
  expect(audit).toEqual(expect.arrayContaining(['REGISTER_VIA_INVITE', 'MFA_ENABLED']));
  expect(admin.serverErrors).toEqual([]); expect(pro.serverErrors).toEqual([]);
});

test('R01 fr: sign-out, then sign-in with password + code of the next step; a replayed code is refused', async () => {
  const pp = await pro.context.newPage();
  await pp.goto(`${BASE}/pro/dashboard`);
  await pp.getByRole('button', { name: 'Déconnexion' }).first().click();
  await pp.waitForURL((u) => u.pathname === '/pro/login');
  expect(await pp.evaluate(() => localStorage.getItem('pro_token'))).toBeNull();
  // the same 30 s step as the enrolment code is refused (monotonic claim)
  const first = await fetch(`${BASE}/api/pro/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': pro.ip }, body: JSON.stringify({ email: N.email, password: N.password }) });
  const j = await first.json(); expect(j.mfa_required).toBe(true);
  const { generateCode } = await import('../../api/lib/totp.js');
  const replay = await pro.api('POST', '/api/pro/auth/mfa-verify', { mfa_token: j.mfa_token, code: generateCode(N.secret, lastStep('newpro')) });   // the enrolment's own step
  expect(replay.status).toBe(401);
  await proSignIn(pp, 'newpro', { email: N.email, password: N.password, secret: N.secret });
  await expect(pp.getByRole('main')).toBeVisible();
  await axe(pp, 'dashboard');
  N.token = await pp.evaluate(() => localStorage.getItem('pro_token'));
  expect(N.token).toBeTruthy();
  await pp.close();
});

test('E03 B12 B11 B10 fr: membership and booking rules → own hours (a member cannot edit a colleague) → an absence in the screen → Outlook busy (mock Graph) removes slots', async () => {
  const before = await papi('admin', 'GET', '/api/pro/rdv/settings');
  S.settingsBefore = { team: before.json.booking.team, serviceConfirmation: before.json.booking.serviceConfirmation };
  const members = { ...(before.json.booking.team.members || {}) };
  for (const k of ['p1', 'p2', 'p3']) members[CREDS.pros[k].id] = { ...(members[CREDS.pros[k].id] || { bookable: true, selectable: k !== 'p3' }), serviceIds: [SVC_DIRECT] };
  members[N.id] = { bookable: true, selectable: false, serviceIds: [SVC_APPROVAL] };   // the new member answers the approval-required service alone
  const put = await papi('admin', 'PUT', '/api/pro/rdv/settings', { team: { enabled: true, members }, serviceConfirmation: { [SVC_APPROVAL]: 'APPROVAL' } });
  expect(put.status).toBe(200);
  // a plain member cannot change the rules
  expect((await bearer(N.token, 'PUT', '/api/pro/rdv/settings', { confirmation: 'DIRECT' }, { ip: pro.ip })).status).toBe(403);
  // own hours: Monday to Friday mornings
  const weekly = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '12:00' }));
  const hours = await bearer(N.token, 'PUT', '/api/pro/rdv/hours', { weekly, exceptions: [] }, { ip: pro.ip });
  expect(hours.status).toBe(200);
  expect((await bearer(N.token, 'PUT', '/api/pro/rdv/hours', { memberId: CREDS.pros.p1.id, weekly: [], exceptions: [] }, { ip: pro.ip })).json.code).toBe('SCHEDULE_MANAGERS_ONLY');
  // the citizen side now offers this member's mornings for the approval service
  client = await person(browser_());
  const cp = await client.context.newPage();
  await citizenSignIn(cp, CREDS.citizens.client, '/compte');
  await cp.close();
  const slots = await allSlots(client, SVC_APPROVAL, { windows: 2 });
  expect(slots.length).toBeGreaterThan(0);
  expect(slots.every((s) => parisHM(s.startAt) >= '09:00' && parisHM(s.startAt) < '12:00'), 'mornings only').toBe(true);
  // an absence entered in the screen (/pro/rdv/absences) removes the slots of that morning
  const victim = pickSlot(slots, { nth: 1 });
  const pp = await pro.context.newPage();
  await pp.goto(`${BASE}/pro/rdv/absences`);
  const local = (iso, add = 0) => { const d = new Date(Date.parse(iso) + add); const p = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d); return p.replace(' ', 'T'); };
  await pp.locator('#timeoff-target').selectOption('self').catch(() => {});
  await pp.getByLabel('Début').fill(local(victim.startAt));
  await pp.getByLabel('Fin').fill(local(victim.startAt, 3600_000));
  await pp.locator('#timeoff-reason').fill('Absence fictive R47');
  await axe(pp, 'absence form');
  const [created] = await Promise.all([pp.waitForResponse((r) => new URL(r.url()).pathname === '/api/pro/timeoff' && r.request().method() === 'POST'), pp.getByRole('button', { name: 'Ajouter' }).click()]);
  expect(created.status()).toBe(201);
  const after = await allSlots(client, SVC_APPROVAL, { windows: 2 });
  expect(after.some((s) => s.startAt === victim.startAt), 'the absence removes the slot').toBe(false);
  // Outlook: the member connects their calendar through the (mock) Microsoft authority; a busy hour there is not offered
  const busy = pickSlot(after, { nth: 2 });
  await fetch(`${GRAPH}/__busy`, { method: 'POST', body: JSON.stringify({ windows: [{ start: busy.startAt, end: busy.endAt }] }) });
  const auth = await pro.context.request.get(`${BASE}/api/pro/outlook?action=authorize`, { headers: { authorization: `Bearer ${N.token}` } });
  const authUrl = (await auth.json()).authUrl;
  expect(new URL(authUrl).origin).toBe(GRAPH);
  await pp.goto(authUrl);
  await pp.waitForURL((u) => u.pathname === '/pro/dashboard' && u.searchParams.get('outlook') === 'connected', { timeout: 30000 });
  const st = await bearer(N.token, 'GET', '/api/pro/outlook?action=status', undefined, { ip: pro.ip });
  expect(st.json.status).toBe('connected');
  const withOutlook = await allSlots(client, SVC_APPROVAL, { windows: 2 });
  expect(withOutlook.some((s) => s.startAt === busy.startAt), 'the Outlook busy hour is not offered').toBe(false);
  expect(withOutlook.length).toBeGreaterThan(0);
  expect((await (await fetch(`${GRAPH}/__calls`)).json()).getSchedule).toBeGreaterThan(0);
  S.free = withOutlook;
  await pp.close();
});

/** @type {import('@playwright/test').Browser} */ let BROWSER;
test.beforeAll(async ({ browser }) => { BROWSER = browser; });
const browser_ = () => BROWSER;

const agendaCard = (page, id) => page.getByTestId('pro-agenda-detail').and(page.locator(`[href="/pro/appointments/${encodeURIComponent(id)}"]`)).locator('xpath=ancestor::div[contains(@class,"md:justify-between")][1]');

test('B09 R03 N03 fr: two requests reach the new member — one refused with a reason, one accepted in the agenda; the person sees both outcomes', async () => {
  const a = await book(client, SVC_APPROVAL, pickSlot(S.free, { nth: 0 }).startAt);
  const b = await book(client, SVC_APPROVAL, pickSlot(S.free, { nth: 3 }).startAt);
  expect(a.status).toBe(201); expect(b.status).toBe(201); expect(a.json.state).toBe('REQUESTED');
  S.refused = a.json.id; S.accepted = b.json.id;
  expect((await db(`SELECT "createdByProUserId" p FROM "ProAppointment" WHERE id = ANY($1)`, [[a.json.id, b.json.id]])).every((r) => r.p === N.id), 'assigned to the new member').toBe(true);
  const pp = await pro.context.newPage();
  await pp.goto(`${BASE}/pro/rdv/agenda`);
  const ca = agendaCard(pp, S.refused); const cb = agendaCard(pp, S.accepted);
  await expect(ca).toBeVisible(); await expect(cb).toBeVisible();
  await axe(pp, 'agenda with requests');
  await ca.getByTestId('pro-agenda-refuse').click();
  await expect(pp.getByTestId('pro-agenda-refusal-panel')).toBeVisible();
  await pp.getByTestId('pro-agenda-refusal-reason-NO_CAPACITY').check();
  await axe(pp, 'refusal panel');
  await pp.getByTestId('pro-agenda-refusal-confirm').click();
  await expect(pp.getByTestId('pro-agenda-decision-status')).toBeVisible();
  await cb.getByTestId('pro-agenda-accept').click();
  await expect.poll(async () => (await db(`SELECT status FROM "ProAppointment" WHERE id = $1`, [S.accepted]))[0].status).toBe('confirmed');
  expect((await db(`SELECT status FROM "ProAppointment" WHERE id = $1`, [S.refused]))[0].status).toBe('refused');
  await expectNotice(S.refused, 'REQUEST_REFUSED', 'citizen');
  await expectNotice(S.accepted, 'REQUEST_ACCEPTED', 'citizen');
  const aud = await db(`SELECT action, details FROM "AuditLog" WHERE action IN ('RDV_REQUEST_REFUSED', 'RDV_REQUEST_ACCEPTED') AND "timestamp" >= $1`, [S.since]);
  expect(aud.find((r) => r.action === 'RDV_REQUEST_REFUSED' && r.details.appointmentId === S.refused)?.details.reasonCode).toBe('NO_CAPACITY');
  // a decision on a request that is no longer pending
  const again = await bearer(N.token, 'PATCH', `/api/pro/appointments?id=${encodeURIComponent(S.refused)}`, { decision: 'ACCEPT' }, { ip: pro.ip });
  expect(again.status).toBe(409);
  // the person's side
  const cp = await client.context.newPage();
  await cp.goto(`${BASE}/compte/rendez-vous`);
  const items = cp.getByTestId('rdv-item');
  await expect(items.filter({ hasText: 'Demande refusée par la structure' })).toHaveCount(1);
  await expect(items.filter({ hasText: 'Demande refusée par la structure' }).getByTestId('rdv-refusal-reason')).toBeVisible();
  await axe(cp, 'Mes rendez-vous with a refused request');
  const mail = (await outbox(CREDS.citizens.client.email)).at(-1);
  expect(mail.subject, 'minimal level: the approval service is not verified ordinary').toContain('nouvelle information dans votre espace');
  if (HAS_0045) {
    await cp.goto(`${BASE}/compte`);
    await expect(cp.getByTestId('notification-center').getByText('Votre demande de rendez-vous n’a pas pu être acceptée.')).toBeVisible();
  }
  await cp.close(); await pp.close();
});

test('B05 B09 N03 fr: the person moves the accepted appointment → back to a request (approval service) → a decision for the old time is refused → accepted for the new time; the structure cancels → the person is notified in the account', async () => {
  const target = pickSlot(S.free, { nth: 6 });
  const before = (await db(`SELECT "startAt" FROM "ProAppointment" WHERE id = $1`, [S.accepted]))[0].startAt;
  const mv = await client.api('POST', `/api/rdv/appointments/${S.accepted}/reschedule`, { startAt: target.startAt });
  expect(mv.status).toBe(200); expect(mv.json.state).toBe('REQUESTED');
  await expectNotice(S.accepted, 'RESCHEDULED', 'citizen'); await expectNotice(S.accepted, 'RESCHEDULED', 'structure');
  const pp = await pro.context.newPage();
  await pp.goto(`${BASE}/pro/rdv/agenda`);
  const card = agendaCard(pp, S.accepted);
  await expect(card.getByTestId('pro-agenda-rescheduled')).toBeVisible();
  const stale = await bearer(N.token, 'PATCH', `/api/pro/appointments?id=${encodeURIComponent(S.accepted)}`, { decision: 'ACCEPT', expectedStartAt: new Date(before).toISOString() }, { ip: pro.ip });
  expect(stale.status).toBe(409); expect(stale.json.code || stale.json.error).toBe('APPOINTMENT_CHANGED');
  await card.getByTestId('pro-agenda-accept').click();
  await expect.poll(async () => (await db(`SELECT status FROM "ProAppointment" WHERE id = $1`, [S.accepted]))[0].status).toBe('confirmed');
  // the structure cancels it (the agenda's own client call)
  const cancel = await bearer(N.token, 'POST', '/api/pro/appointments/cancel', { id: S.accepted }, { ip: pro.ip });
  expect(cancel.status).toBe(200);
  await expectNotice(S.accepted, 'CANCELLED_BY_STRUCTURE', 'citizen');
  expect((await db(`SELECT "cancelledBy" FROM "ProAppointment" WHERE id = $1`, [S.accepted]))[0].cancelledBy).toBe('PRO');
  const cp = await client.context.newPage();
  await cp.goto(`${BASE}/compte`);
  const center = cp.getByTestId('notification-center');
  await expect(center.getByText('Une structure a annulé un rendez-vous.')).toBeVisible();
  await expect(center.getByText('Un rendez-vous a été déplacé.')).toBeVisible();
  await expect(center).not.toContainText(CREDS.services.approval.name);   // no content in a notification
  await cp.goto(`${BASE}/compte/rendez-vous`);
  await expect(cp.getByTestId('rdv-item').filter({ hasText: 'Annulé' }).first()).toBeVisible();
  await cp.close(); await pp.close();
});

test('E03 R12 negative fr: the administrator ends the membership in « Équipe » → the member\'s open session is refused at once, the sign-in too; no personal data in the audit trail', async () => {
  // one more confirmed appointment of the member, to see what the departure does with it
  const c = await book(client, SVC_APPROVAL, pickSlot(S.free, { nth: 8 }).startAt);
  await papi('admin', 'PATCH', `/api/pro/appointments?id=${encodeURIComponent(c.json.id)}`, { decision: 'ACCEPT', expectedStartAt: c.json.startsAt });
  S.open = c.json.id;
  const ap = await admin.context.newPage();
  await ap.goto(`${BASE}/pro/team`);
  const rowOf = ap.getByTestId(`team-role-${N.id}`).locator('xpath=ancestor::div[.//button[normalize-space()="Désactiver"]][1]');
  await rowOf.getByRole('button', { name: 'Désactiver' }).click();
  await expect(ap.getByTestId('team-successor')).toBeVisible();
  await ap.getByTestId('team-successor').selectOption(CREDS.pros.p1.id).catch(() => {});
  await axe(ap, 'departure confirmation');
  await ap.getByRole('button', { name: 'Confirmer la désactivation' }).click();
  await expect.poll(async () => (await db(`SELECT status FROM "ProUser" WHERE id = $1`, [N.id]))[0].status).toBe('disabled');
  // the open browser session of the member: the next screen sends them to the sign-in with the explanation
  const pp = await pro.context.newPage();
  await pp.goto(`${BASE}/pro/rdv/agenda`);
  await pp.waitForURL((u) => u.pathname === '/pro/login', { timeout: 30000 });
  await expect(pp.getByTestId('pro-session-ended')).toBeVisible();
  const old = await bearer(N.token, 'GET', '/api/pro/appointments', undefined, { ip: pro.ip });
  expect(old.status).toBe(401); expect(old.json.code).toBe('SESSION_REVOKED');
  const login = await fetch(`${BASE}/api/pro/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': pro.ip }, body: JSON.stringify({ email: N.email, password: N.password }) });
  expect(login.status).toBe(403);
  // R12 « no orphans »: the member's future appointment is handed over (successor or team) — never left on a disabled account
  const owner = (await db(`SELECT a.status, u.status AS "ownerStatus" FROM "ProAppointment" a LEFT JOIN "ProUser" u ON u.id = a."createdByProUserId" WHERE a.id = $1`, [S.open]))[0];
  expect(owner.status).toBe('confirmed');
  expect(owner.ownerStatus, 'the confirmed appointment is not left assigned to the departed member').not.toBe('disabled');
  const { leaks } = await auditWithoutPersonalData(S.since, [N.email]);
  expect(leaks, 'AuditLog rows of this journey carry no e-mail address or name').toEqual([]);
  forgetPro('newpro');
  await ap.close(); await pp.close();
});
