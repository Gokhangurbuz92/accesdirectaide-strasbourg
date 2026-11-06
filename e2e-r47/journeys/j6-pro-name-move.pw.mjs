/**
 * R47 journey 6 — the two professional gaps the journeys found, closed, on the built app with the REAL API (run-lab.mjs):
 *   an INVITED professional (invitation → password → MFA bound to the invitation; no ProProfile row) sets their public display name in « Paramètres »
 *   (markup refused in the form) → the administrator sees it in « Équipe » and makes them bookable and selectable → a person picks that professional BY
 *   NAME in the booking screen and books → the professional moves the appointment from its detail page (free slots of their own agenda only) → the person
 *   sees the new time, « modifié par la structure » and the in-app notice (e-mail at the minimal level while the service is not verified ordinary) →
 *   the professional cancels → the journal has the rows (ids + a fixed reason code, no personal data) and the team is told.
 * Negative: a plain member cannot set a colleague's name; the witness structure's administrator gets the same 404 as an unknown id for the name and the move.
 */
import { test, expect } from '@playwright/test';
import {
  BASE, CREDS, SLUG, SVC_DIRECT, STAMP, db, person, citizenSignIn, proSignIn, outbox, linkIn, axe, allSlots, totp, papi, bearer, expectNotice, proNotices,
  auditWithoutPersonalData, parisHM, forgetPro,
} from './lib.mjs';

test.describe.configure({ mode: 'serial' });
const N = { email: `r47-nom-${STAMP}@cdgg-conseil.example.test`, password: `Lab${STAMP}Nom9`, name: 'Sacha Nommé-Fictif', job: 'Conseiller numérique (fictif)' };
const S = { since: new Date() };
let admin; let pro; let citizen;

test.afterAll(async () => {
  if (S.teamBefore) await papi('admin', 'PUT', '/api/pro/rdv/settings', { team: S.teamBefore });
  for (const c of [admin, pro, citizen]) await c?.context.close();
  forgetPro('newname');
});

test('E03 R01 fr: an invited member (invitation, password, MFA bound to the invitation) has no public name: never offered by name', async ({ browser }) => {
  admin = await person(browser); pro = await person(browser);
  const inv = await papi('admin', 'POST', '/api/pro/invite', { email: N.email, role: 'PRO' });
  expect([200, 201]).toContain(inv.status);
  await expect.poll(async () => (await outbox(N.email)).length, { timeout: 20000 }).toBeGreaterThanOrEqual(1);
  const link = new URL(linkIn(await outbox(N.email), /(https?:\/\/[^\s]+\/pro\/register-invite\?token=[^\s]+)/)[1]);
  const reg = await pro.api('POST', '/api/pro/auth/register-invite', { token: link.searchParams.get('token'), password: N.password });
  expect(reg.status, JSON.stringify(reg.json)).toBe(201);
  N.id = reg.json.user.id;
  const grant = reg.json.mfaEnrolment.token;
  const h = { 'content-type': 'application/json', authorization: `Bearer ${reg.json.token}`, 'x-forwarded-for': pro.ip, 'x-ada-mfa-enrolment': grant };
  const setup = await (await fetch(`${BASE}/api/pro/mfa-setup`, { headers: h })).json();
  N.secret = setup.secret; expect(N.secret).toBeTruthy();
  const on = await fetch(`${BASE}/api/pro/mfa-setup`, { method: 'POST', headers: h, body: JSON.stringify({ code: await totp(N.secret, 'newname'), enrolmentToken: grant }) });
  expect(on.status).toBe(200);
  expect((await db(`SELECT mfa_enabled, "structureId" FROM "ProUser" WHERE id = $1`, [N.id]))[0]).toEqual({ mfa_enabled: true, structureId: CREDS.structure.id });
  expect(await db(`SELECT 1 FROM "ProProfile" WHERE "proUserId" = $1`, [N.id])).toHaveLength(0);
  // made bookable and selectable by the administrator: still not offered (no public name; never by e-mail)
  const before = await papi('admin', 'GET', '/api/pro/rdv/settings');
  S.teamBefore = before.json.booking.team;
  // the configuration keeps only ACTIVE members (a member an earlier journey ended is refused by the server): the stored map is filtered the same way
  const active = new Set(before.json.booking.members.map((m) => m.id));
  const kept = Object.fromEntries(Object.entries(S.teamBefore.members || {}).filter(([id]) => active.has(id)));
  S.teamBefore = { ...S.teamBefore, members: kept };
  const members = { ...kept, [N.id]: { bookable: true, selectable: true, serviceIds: [SVC_DIRECT] } };
  const put = await papi('admin', 'PUT', '/api/pro/rdv/settings', { team: { enabled: true, members } });
  expect(put.status, JSON.stringify(put.json)).toBe(200);
  citizen = await person(browser);
  const cp = await citizen.context.newPage();
  await citizenSignIn(cp, CREDS.citizens.second, '/compte');
  await cp.close();
  const team = await citizen.api('GET', `/api/rdv/structures/${SLUG}/team?serviceId=${encodeURIComponent(SVC_DIRECT)}`);
  expect(team.status).toBe(200);
  expect(JSON.stringify(team.json)).not.toContain(N.email);
  expect(team.json.professionals.map((p) => p.displayName)).not.toContain(N.name);
});

test('fr: the member sets their public name in « Paramètres » (markup refused, accessible form) → the administrator sees it in « Équipe »; a plain member and another structure cannot change it', async () => {
  const pp = await pro.context.newPage();
  await proSignIn(pp, 'newname', { email: N.email, password: N.password, secret: N.secret, next: '/pro/parametres' });
  const card = pp.getByTestId('pro-public-profile');
  await expect(card.getByRole('heading', { name: 'Mon nom public' })).toBeVisible();
  const name = pp.getByLabel('Nom affiché aux personnes');
  await expect(name).toBeEnabled();
  let puts = 0; pp.on('request', (r) => { if (r.method() === 'PUT' && new URL(r.url()).pathname === '/api/pro/profile') puts += 1; });
  await name.fill('<b>Sacha</b>');
  await pp.getByTestId('pro-profile-save').click();
  await expect(pp.getByTestId('pro-profile-display-name-error')).toBeVisible();
  await expect(name).toBeFocused(); expect(await name.getAttribute('aria-invalid')).toBe('true'); expect(puts).toBe(0);
  await axe(pp, 'public name, error');
  await name.fill(N.name);
  await pp.getByLabel('Fonction (facultatif)').fill(N.job);
  const [saved] = await Promise.all([pp.waitForResponse((r) => new URL(r.url()).pathname === '/api/pro/profile' && r.request().method() === 'PUT'), pp.getByTestId('pro-profile-save').click()]);
  expect(saved.status()).toBe(200);
  await expect(pp.getByTestId('pro-profile-status')).toHaveText('Nom public enregistré.');
  await axe(pp, 'public name saved');
  expect((await db(`SELECT "displayName", "jobTitle", "isPubliclyVisible" FROM "ProProfile" WHERE "proUserId" = $1`, [N.id]))[0]).toEqual({ displayName: N.name, jobTitle: N.job, isPubliclyVisible: false });
  // the server refuses markup too, whoever sends it
  N.token = await pp.evaluate(() => localStorage.getItem('pro_token'));
  const bad = await bearer(N.token, 'PUT', '/api/pro/profile', { displayName: '<script>x</script>' }, { ip: pro.ip });
  expect(bad.status).toBe(400); expect(bad.json.code).toBe('DISPLAYNAME_INVALID');
  // the administrator's team page shows the name; the panel to change it is a labelled form
  const ap = await admin.context.newPage();
  await proSignIn(ap, 'admin', { next: '/pro/team' });
  await expect(ap.getByTestId(`team-public-name-value-${N.id}`)).toHaveText(`Nom public : ${N.name}`);
  await ap.getByTestId(`team-public-name-${N.id}`).click();
  await expect(ap.getByTestId(`team-public-name-panel-${N.id}`)).toBeVisible();
  await expect(ap.locator(`#team-profile-${N.id}-display-name`)).toHaveValue(N.name);
  await axe(ap, 'team: public name panel');
  // a plain member cannot change a colleague's name; the witness structure's administrator gets the same 404 as an unknown id
  expect((await papi('p1', 'PUT', '/api/pro/profile', { memberId: N.id, displayName: 'Autre nom' })).status).toBe(403);
  const cross = await papi('temoinAdmin', 'PUT', '/api/pro/profile', { memberId: N.id, displayName: 'Intrus' });
  expect(cross.status).toBe(404);
  expect((await papi('temoinAdmin', 'PUT', '/api/pro/profile', { memberId: `lab-nobody-${STAMP}`, displayName: 'Intrus' })).json).toEqual(cross.json);
  expect((await db(`SELECT "displayName" FROM "ProProfile" WHERE "proUserId" = $1`, [N.id]))[0].displayName).toBe(N.name);
  expect(admin.serverErrors).toEqual([]); expect(pro.serverErrors).toEqual([]);
  await ap.close(); await pp.close();
});

test('B01 B03 fr: the person picks that professional BY NAME in the booking screen and books; the appointment is theirs', async () => {
  const page = await citizen.context.newPage();
  await page.goto(`${BASE}/rdv/${SLUG}/booking`);
  await page.getByTestId('booking-suitability').getByLabel('Oui').check();
  await page.getByTestId(`booking-service-${SVC_DIRECT}`).click();
  const choice = page.getByTestId('booking-professional-choice');
  await expect(choice).toContainText(N.name); await expect(choice).toContainText(N.job); await expect(choice).not.toContainText('@');
  await choice.getByLabel(new RegExp(N.name)).check();
  await axe(page, 'professional chosen by name');
  const [slotsResp] = await Promise.all([page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/slots')), page.getByTestId('booking-professional-continue').click()]);
  const handle = new URL(slotsResp.url()).searchParams.get('professional');
  expect(handle).toMatch(/^p_/); expect(handle).not.toContain(N.id);
  await expect(page.getByTestId('booking-slot').first()).toBeVisible();
  const shown = (await slotsResp.json()).slots;
  const idx = shown.findIndex((x) => Date.parse(x.startAt) > Date.now() + 30 * 3600_000);
  await page.getByTestId('booking-slot').nth(idx).click();
  const [resp] = await Promise.all([page.waitForResponse((r) => new URL(r.url()).pathname === '/api/rdv/appointments' && r.request().method() === 'POST'), page.getByTestId('booking-confirm').click()]);
  expect(resp.status()).toBe(201);
  const created = await resp.json();
  S.id = created.id; S.start = created.startsAt; S.handle = handle;
  await expect(page.getByTestId('booking-success')).toBeVisible();
  expect((await db(`SELECT "createdByProUserId" p, status FROM "ProAppointment" WHERE id = $1`, [S.id]))[0]).toEqual({ p: N.id, status: 'confirmed' });
  expect(citizen.serverErrors).toEqual([]);
  await page.close();
});

test('B05 N03 fr: the professional moves it from the appointment detail (own free slots only) → the person sees the new time, « modifié par la structure » and the in-app notice; the journal has ids only', async () => {
  const free = await allSlots(citizen, SVC_DIRECT, { professional: S.handle, windows: 2 });
  const pp = await pro.context.newPage();
  await pp.goto(`${BASE}/pro/appointments/${encodeURIComponent(S.id)}`);
  const open = pp.getByTestId('pro-move-open');
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  const [opts] = await Promise.all([pp.waitForResponse((r) => new URL(r.url()).pathname === '/api/pro/appointments/reschedule' && r.request().method() === 'GET'), open.click()]);
  expect(opts.status()).toBe(200);
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  const offered = (await opts.json()).slots.map((s) => s.startAt);
  expect(offered.length).toBeGreaterThan(1);
  expect(offered).not.toContain(S.start);
  expect(offered.every((s) => free.some((f) => f.startAt === s)), 'only the professional\'s own free slots').toBe(true);
  const target = offered.find((s) => Date.parse(s) > Date.parse(S.start) + 86400_000) || offered.at(-1);
  await axe(pp, 'move panel');
  // keyboard: the chosen radio, then the confirmation
  await pp.locator(`[data-testid="pro-move-slot"][value="${target}"]`).check();
  const [moved] = await Promise.all([pp.waitForResponse((r) => new URL(r.url()).pathname === '/api/pro/appointments/reschedule' && r.request().method() === 'POST'), pp.getByTestId('pro-move-confirm').click()]);
  expect(moved.status()).toBe(200);
  await expect(pp.getByTestId('pro-move-done')).toBeVisible();
  await expect(pp.getByTestId('pro-appt-team-moved')).toBeVisible();
  await axe(pp, 'moved');
  const row = (await db(`SELECT "startAt", "rescheduleCount", status FROM "ProAppointment" WHERE id = $1`, [S.id]))[0];
  expect(new Date(row.startAt).toISOString()).toBe(target); expect(row.rescheduleCount).toBe(0); expect(row.status).toBe('confirmed');
  const aud = await db(`SELECT actor_id, details FROM "AuditLog" WHERE action = 'RDV_PRO_RESCHEDULED' AND details->>'appointmentId' = $1`, [S.id]);
  expect(aud).toHaveLength(1); expect(aud[0].actor_id).toBe(N.id); expect(aud[0].details).toEqual({ appointmentId: S.id, structureId: CREDS.structure.id });
  await expectNotice(S.id, 'RESCHEDULED', 'citizen'); await expectNotice(S.id, 'RESCHEDULED', 'structure', 'in_app');
  expect((await proNotices(S.id)).some((n) => n.type === 'rdv_rescheduled')).toBe(true);
  // R45 privacy level: minimal (no time, no structure) unless the service is verified ordinary (journey 1 verifies it on a full run) — then the
  // neutral catalogue subject with the new time in the body; never the person's name either way
  const sens = (await db(`SELECT settings_json -> 'serviceSensitivity' -> 'services' -> $2 ->> 'value' AS v FROM "Structure" WHERE id = $1`, [CREDS.structure.id, SVC_DIRECT]))[0]?.v;
  const mail = (await outbox(CREDS.citizens.second.email)).at(-1);
  if (sens === 'ordinary') { expect(mail.subject).toBe('Votre rendez-vous est déplacé - Accès Direct Aide'); expect(mail.text).toContain(parisHM(target)); }
  else { expect(mail.subject).toContain('vous avez une nouvelle information dans votre espace'); expect(mail.text).not.toContain(parisHM(target)); }
  expect(mail.text).not.toContain(CREDS.citizens.second.name); expect(mail.text).not.toContain(N.name);
  // the agenda shows the move
  await pp.goto(`${BASE}/pro/rdv/agenda`);
  const card = pp.getByTestId('pro-agenda-detail').and(pp.locator(`[href="/pro/appointments/${encodeURIComponent(S.id)}"]`)).locator('xpath=ancestor::div[contains(@class,"md:justify-between")][1]');
  await expect(card.getByTestId('pro-agenda-team-moved')).toBeVisible();
  // the person's side
  const cp = await citizen.context.newPage();
  await cp.goto(`${BASE}/compte/rendez-vous`);
  const item = cp.getByTestId('rdv-item').filter({ has: cp.getByTestId('rdv-moved-by-structure') });
  await expect(item).toHaveCount(1);
  await expect(item.getByTestId('rdv-when')).toContainText(parisHM(target));
  await expect(item.getByTestId('rdv-move')).toBeVisible();   // the person's own moves are not used up
  await axe(cp, 'Mes rendez-vous, moved by the structure');
  await cp.goto(`${BASE}/compte`);
  const center = cp.getByTestId('notification-center');
  await expect(center.locator('[data-kind="APPOINTMENT_RESCHEDULED"]').first()).toBeVisible();
  await expect(center.getByText('Un rendez-vous a été déplacé.').first()).toBeVisible();
  await expect(center).not.toContainText(N.name);
  // the witness structure cannot move it (same 404 as an unknown id)
  const cross = await papi('temoinAdmin', 'POST', '/api/pro/appointments/reschedule', { id: S.id, startAt: offered[0] });
  expect(cross.status).toBe(404);
  expect((await papi('temoinAdmin', 'POST', '/api/pro/appointments/reschedule', { id: `lab-nope-${STAMP}`, startAt: offered[0] })).json).toEqual(cross.json);
  expect(pro.serverErrors).toEqual([]); expect(citizen.serverErrors).toEqual([]);
  S.target = target;
  await cp.close(); await pp.close();
});

test('B04 R12 fr: the professional cancels → the person is notified, the team is told, the journal has ids + a fixed reason code; no personal data in this journey\'s journal rows', async () => {
  const r = await bearer(N.token, 'POST', '/api/pro/appointments/cancel', { id: S.id, reasonCode: 'PROFESSIONAL_UNAVAILABLE' }, { ip: pro.ip });
  expect(r.status).toBe(200);
  const aud = await db(`SELECT actor_id, details FROM "AuditLog" WHERE action = 'RDV_PRO_CANCELLED' AND details->>'appointmentId' = $1`, [S.id]);
  expect(aud).toHaveLength(1); expect(aud[0].actor_id).toBe(N.id);
  expect(aud[0].details).toEqual({ appointmentId: S.id, reasonCode: 'PROFESSIONAL_UNAVAILABLE', structureId: CREDS.structure.id });
  await expectNotice(S.id, 'CANCELLED_BY_STRUCTURE', 'citizen'); await expectNotice(S.id, 'CANCELLED_BY_STRUCTURE', 'structure', 'in_app');
  expect((await proNotices(S.id)).some((n) => n.type === 'rdv_cancelled_by_structure')).toBe(true);
  const { rows, leaks } = await auditWithoutPersonalData(S.since, [N.email, N.name, N.job]);
  expect(rows.map((x) => x.action)).toEqual(expect.arrayContaining(['PRO_PROFILE_UPDATED', 'RDV_PRO_RESCHEDULED', 'RDV_PRO_CANCELLED']));
  expect(leaks, 'AuditLog rows of this journey carry no e-mail address or name').toEqual([]);
});
