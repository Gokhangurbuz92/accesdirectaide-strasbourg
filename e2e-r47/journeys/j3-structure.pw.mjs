/**
 * R47 journey 3 — STRUCTURE, on the built app with the REAL API (run-lab.mjs). Release A (G-1): the Production path — the platform creates the partner's
 * record (draft, unverified, not bookable; public sign-up stays closed) → identity verified by a platform administrator (evidence, version check) and
 * activated → the platform operator (SUPERADMIN, second factor) invites its first administrator from « Équipe » → password + second factor bound to the invitation → team: a member invited, roles changed → services → the platform
 * administrator classifies sensitivity (ordinary / sensitive, MFA + elevation) → opening hours, booking settings in the screen (direct vs approval) →
 * a citizen books; the sensitive service is refused while its gate is closed → reports (k-anonymity, withheld counters, CSV) → organisation export →
 * the member leaves (access ends) → closure request in the screen → two-administrator review.
 */
import { test, expect } from '@playwright/test';
import { BASE, CREDS, STAMP, db, person, citizenSignIn, proSignIn, outbox, linkIn, axe, allSlots, pickSlot, book, papi, aapi, bearer, totp, auditWithoutPersonalData, expectNotice } from './lib.mjs';

test.describe.configure({ mode: 'serial' });
const ORG = { name: `Structure R47 fictive ${STAMP}` };
const A = { email: `r47-admin-${STAMP}@structure-r47.example.test`, password: `Lab${STAMP}Adm9` };
const M = { email: `r47-membre-${STAMP}@structure-r47.example.test`, password: `Lab${STAMP}Mem9` };
const S = { since: new Date() };
let adminP; let citizen;
test.afterAll(async () => { for (const c of [adminP, citizen]) await c?.context.close(); });

test('E01 fr (Production path, Release A / G-1): the platform creates the partner record — draft, unverified, not bookable; the platform invitation of its administrator is refused until it is verified and active, and to anyone but a second-factor SUPERADMIN', async ({ browser }) => {
  adminP = await person(browser);
  // public structure sign-up stays closed in Production (R43 E1): the partner's record is created by the platform team, as a draft
  ORG.id = `r47-org-${STAMP}`; ORG.slug = `structure-r47-fictive-${STAMP}`;
  await db(`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
    VALUES ($1, $2, $3, 'association', '1 rue fictive', 'Strasbourg', '67000', false, ARRAY['accueil'], ARRAY['tout_public'], ARRAY['social'], 'brouillon', 'UNVERIFIED', NOW(), NOW())`, [ORG.id, ORG.name, ORG.slug]);
  expect((await fetch(`${BASE}/api/rdv/structures/${ORG.slug}/profile`)).status, 'not bookable while unverified').toBe(404);
  const ask = (k, body) => papi(k, 'POST', '/api/pro/invite', { email: A.email, role: 'STRUCTURE_ADMIN', structure: ORG.slug, ...body });
  // a structure administrator cannot invite into another structure; the platform role cannot name a plain member; an unknown structure reveals nothing
  const other = await ask('temoinAdmin'); expect(other.status).toBe(403); expect(other.json.code).toBe('PLATFORM_INVITATION_FORBIDDEN');
  const pro = await ask('operator', { role: 'PRO' }); expect(pro.status).toBe(400); expect(pro.json.code).toBe('PLATFORM_INVITATION_ROLE');
  const unknown = await ask('operator', { structure: `inconnue-${STAMP}` }); expect(unknown.status).toBe(404);
  // draft and unverified: refused (the platform verifies first)
  const early = await ask('operator'); expect(early.status).toBe(409); expect(early.json.code).toBe('PLATFORM_INVITATION_STRUCTURE_NOT_ELIGIBLE');
  expect((await db(`SELECT count(*)::int n FROM "Invitation" WHERE "structureId" = $1`, [ORG.id]))[0].n, 'nothing created by a refusal').toBe(0);
  expect((await db(`SELECT count(*)::int n FROM "ProUser" WHERE "structureId" = $1`, [ORG.id]))[0].n).toBe(0);
});

test('E01 fr: the platform administrator verifies the identity (stale version and unlisted evidence refused) and activates it; the platform operator invites its first administrator from « Équipe » → password → second factor bound to the invitation', async ({ browser }) => {
  const g = await aapi('admin', 'GET', `/api/admin/content-verification?entityType=structure&entityId=${ORG.id}`);
  expect(g.status).toBe(200);
  const base = { entityType: 'structure', entityId: ORG.id, action: 'VERIFY', evidenceNote: 'R47 LAB : pièces d’identité fictives contrôlées (synthétique)', territoryConfirmed: true };
  expect((await aapi('admin', 'POST', '/api/admin/content-verification', { ...base, sourceUrl: 'https://non-autorise.example.net/x', expectedVersion: g.json.version })).status).toBe(400);
  expect((await aapi('admin', 'POST', '/api/admin/content-verification', { ...base, sourceUrl: 'https://example.org/r47', expectedVersion: '0'.repeat(64) })).status).toBe(409);
  const v = await aapi('admin', 'POST', '/api/admin/content-verification', { ...base, sourceUrl: 'https://example.org/r47', expectedVersion: g.json.version });
  expect(v.status).toBe(200);
  const act = await aapi('admin', 'POST', '/api/admin/organizations', { id: ORG.id, action: 'REACTIVATE', reason: 'R47 LAB : identité vérifiée' });
  expect(act.status).toBe(200); expect(act.json.organization.statut).toBe('actif');
  expect((await db(`SELECT statut, verification_status FROM "Structure" WHERE id = $1`, [ORG.id]))[0]).toMatchObject({ statut: 'actif', verification_status: 'VERIFIED' });
  // the platform operator (SUPERADMIN, second factor) invites the first administrator from its « Équipe » screen
  // the operator works in its own browser (the invited administrator signs in later in adminP's)
  const operatorP = await person(browser);
  const page = await operatorP.context.newPage();
  await proSignIn(page, 'operator', { next: '/pro/team' });
  await page.getByRole('button', { name: /Inviter/ }).first().click();
  await page.locator('#invite-email').fill(A.email);
  await page.getByTestId('team-invite-structure').fill(ORG.slug);
  await expect(page.locator('#invite-role')).toBeDisabled();   // the platform invitation only names the structure's administrator
  await axe(page, 'platform invitation dialog');
  const [resp] = await Promise.all([page.waitForResponse((r) => new URL(r.url()).pathname === '/api/pro/invite' && r.request().method() === 'POST'),
    page.locator('form').filter({ has: page.locator('#invite-email') }).getByRole('button', { name: /Inviter/ }).click()]);
  expect(resp.status()).toBe(201);
  const j = await resp.json(); expect(j.structure).toMatchObject({ id: ORG.id, nom: ORG.name });
  await expect(page.getByText(new RegExp(`Invitation de l’administrateur de « ${ORG.name} »`))).toBeVisible();
  await operatorP.context.close();
  const inv = (await db(`SELECT id, role, "structureId" FROM "Invitation" WHERE email = $1`, [A.email]))[0];
  expect(inv).toMatchObject({ role: 'STRUCTURE_ADMIN', structureId: ORG.id });
  const audit = (await db(`SELECT actor_id, details FROM "AuditLog" WHERE action = 'INVITATION_SENT' AND details->>'invitationId' = $1`, [inv.id]))[0];
  expect((await db(`SELECT role FROM "ProUser" WHERE id = $1`, [audit.actor_id]))[0].role, 'the sender recorded is the platform operator').toBe('SUPERADMIN');
  expect(audit.details).toMatchObject({ platform: true, role: 'STRUCTURE_ADMIN' });
  expect(JSON.stringify(audit.details)).not.toContain(A.email);
  // the invited person sets a password, then enrols the second factor bound to that invitation
  const link = linkIn(await outbox(A.email), /\/pro\/register-invite\?token=([^\s]+)/);
  expect(link).not.toBeNull();
  const reg = await adminP.api('POST', '/api/pro/auth/register-invite', { token: decodeURIComponent(link[1]), password: A.password });
  expect(reg.status, JSON.stringify(reg.json)).toBe(201);
  expect(reg.json.user).toMatchObject({ role: 'STRUCTURE_ADMIN', structureId: ORG.id });
  A.id = reg.json.user.id;
  // without the second factor the console's data stay closed (Production rule PRO_MFA_REQUIRED)
  const closed = await bearer(reg.json.token, 'GET', '/api/pro/team', undefined, { ip: adminP.ip });
  expect(closed.status).toBe(403); expect(closed.json.code).toBe('PRO_MFA_REQUIRED');
  const grant = reg.json.mfaEnrolment.token;
  const setup = await fetch(`${BASE}/api/pro/mfa-setup`, { headers: { authorization: `Bearer ${reg.json.token}`, 'x-ada-mfa-enrolment': grant, 'x-forwarded-for': adminP.ip } }).then((r) => r.json());
  A.totpSecret = setup.secret;
  const done = await bearer(reg.json.token, 'POST', '/api/pro/mfa-setup', { code: await totp(A.totpSecret, 'r47admin'), enrolmentToken: grant }, { ip: adminP.ip });
  expect(done.status).toBe(200);
  CREDS.pros.r47admin = { email: A.email, password: A.password, totpSecret: A.totpSecret };
  expect((await db(`SELECT role, status, mfa_enabled FROM "ProUser" WHERE id = $1`, [A.id]))[0]).toMatchObject({ role: 'STRUCTURE_ADMIN', status: 'active', mfa_enabled: true });
  // the same link cannot be used twice
  expect((await adminP.api('POST', '/api/pro/auth/register-invite', { token: decodeURIComponent(link[1]), password: A.password })).status).toBe(410);
});

test('E03 E04 fr: team — a member invited and registered, roles changed (a member cannot change roles); services created (a member cannot)', async () => {
  const inv = await papi('r47admin', 'POST', '/api/pro/invite', { email: M.email, role: 'PRO' });
  expect(inv.status).toBe(201);
  const link = linkIn(await outbox(M.email), /\/pro\/register-invite\?token=([^\s]+)/);
  const reg = await adminP.api('POST', '/api/pro/auth/register-invite', { token: decodeURIComponent(link[1]), password: M.password });
  expect(reg.status).toBe(201);
  M.id = reg.json.user.id;
  const grant = reg.json.mfaEnrolment.token;
  const setup = await fetch(`${BASE}/api/pro/mfa-setup`, { headers: { authorization: `Bearer ${reg.json.token}`, 'x-ada-mfa-enrolment': grant, 'x-forwarded-for': '192.0.2.199' } }).then((r) => r.json());
  const done = await bearer(reg.json.token, 'POST', '/api/pro/mfa-setup', { code: await totp(setup.secret, 'r47member'), enrolmentToken: grant }, { ip: '192.0.2.199' });
  expect(done.status).toBe(200); M.token = done.json.token;
  expect((await papi('r47admin', 'PATCH', '/api/pro/team', { targetUserId: M.id, role: 'STRUCTURE_ADMIN' })).json.newRole).toBe('STRUCTURE_ADMIN');
  expect((await papi('r47admin', 'PATCH', '/api/pro/team', { targetUserId: M.id, role: 'PRO' })).json.newRole).toBe('PRO');
  expect((await papi('r47admin', 'PATCH', '/api/pro/team', { targetUserId: M.id, role: 'SUPERADMIN' })).status).toBe(400);
  expect((await bearer(M.token, 'PATCH', '/api/pro/team', { targetUserId: A.id, role: 'PRO' }, { ip: '192.0.2.199' })).status).toBe(403);
  const s1 = await papi('r47admin', 'POST', '/api/pro/services', { name: 'Accueil administratif — service fictif R47', durationMinutes: 30, modes: ['IN_PERSON'] });
  const s2 = await papi('r47admin', 'POST', '/api/pro/services', { name: 'Accompagnement santé mentale — service fictif R47', durationMinutes: 30, modes: ['IN_PERSON'] });
  expect(s1.status).toBe(201); expect(s2.status).toBe(201);
  ORG.ordinary = s1.json.item.id; ORG.sensitive = s2.json.item.id;
  expect((await bearer(M.token, 'POST', '/api/pro/services', { name: 'Refusé — service fictif', durationMinutes: 30 }, { ip: '192.0.2.199' })).status).toBe(403);
});

test('B01 fr: the platform administrator classifies the services (reason required, elevation required), the suggestion flags the health service', async () => {
  const list = await aapi('admin', 'POST', '/api/admin/service-sensitivity', { action: 'list', structureId: ORG.id });
  expect(list.status).toBe(200);
  expect(list.json.items.find((i) => i.id === ORG.sensitive).suggestion).toBe('sensitive');
  expect(list.json.reviewComplete).toBe(false);
  expect((await aapi('admin', 'POST', '/api/admin/service-sensitivity', { action: 'review', structureId: ORG.id, serviceId: ORG.ordinary, value: 'ordinary', reason: 'court' })).status).toBe(400);
  expect((await aapi('adminNoElev', 'POST', '/api/admin/service-sensitivity', { action: 'review', structureId: ORG.id, serviceId: ORG.ordinary, value: 'ordinary', reason: 'R47 LAB : sans élévation' })).status).toBe(403);
  for (const [id, value] of [[ORG.ordinary, 'ordinary'], [ORG.sensitive, 'sensitive']]) {
    const r = await aapi('admin', 'POST', '/api/admin/service-sensitivity', { action: 'review', structureId: ORG.id, serviceId: id, value, reason: `R47 LAB : classement ${value} du service fictif` });
    expect(r.status).toBe(200); expect(r.json.value).toBe(value);
  }
  expect((await aapi('admin', 'POST', '/api/admin/service-sensitivity', { action: 'list', structureId: ORG.id })).json.reviewComplete).toBe(true);
  expect((await db(`SELECT count(*)::int n FROM "AuditLog" WHERE action = 'service.sensitivity_reviewed' AND "timestamp" >= $1`, [S.since]))[0].n).toBeGreaterThanOrEqual(2);
});

test('B12 B03 fr: opening hours; booking settings in the screen (structure: approval; the ordinary service: direct) → a citizen books it, the sensitive service is refused while its gate is closed', async ({ browser }) => {
  const hours = await papi('r47admin', 'PUT', '/api/pro/availability', { timezone: 'Europe/Paris', rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '12:00' })) });
  expect(hours.status).toBe(200);
  expect((await papi('r47admin', 'PUT', '/api/pro/availability', { rules: [{ weekday: 1, startTime: '12:00', endTime: '09:00' }] })).status).toBe(400);
  const page = await adminP.context.newPage();
  await proSignIn(page, 'r47admin', { next: '/pro/rdv/services' });
  const sel = page.getByTestId('pro-booking-confirmation');
  await expect(sel).toBeVisible();
  await sel.selectOption('APPROVAL');
  await axe(page, 'booking rules');
  await page.getByRole('button', { name: /Enregistrer/ }).filter({ hasText: /règles|Enregistrer/ }).first().click();
  await expect(page.getByText('Règles enregistrées.')).toBeVisible();
  const put = await papi('r47admin', 'PUT', '/api/pro/rdv/settings', { isPublished: true, serviceConfirmation: { [ORG.ordinary]: 'DIRECT' } });
  expect(put.status).toBe(200); expect(put.json.booking.confirmation).toBe('APPROVAL');
  citizen = await person(browser);
  const cp = await citizen.context.newPage();
  await citizenSignIn(cp, CREDS.citizens.second, `/rdv/${ORG.slug}/booking`);
  await cp.getByTestId('booking-suitability').getByLabel('Oui').check();
  await expect(cp.getByTestId(`booking-service-${ORG.ordinary}`)).toBeVisible();
  await expect(cp.getByTestId(`booking-service-contact-${ORG.sensitive}`)).toBeVisible();
  await cp.close();
  const slots = await allSlots(citizen, ORG.ordinary, { slug: ORG.slug, windows: 1 });
  expect(slots.length).toBeGreaterThan(0);
  const ok = await book(citizen, ORG.ordinary, pickSlot(slots).startAt, {}, ORG.slug);
  expect(ok.status).toBe(201); expect(ok.json.state).toBe('CONFIRMED'); S.appt = ok.json.id;
  const refused = await book(citizen, ORG.sensitive, pickSlot(slots, { nth: 1 }).startAt, {}, ORG.slug);
  expect(refused.status).toBe(409); expect(refused.json.code).toBe('SENSITIVE_BOOKING_NOT_OPEN');
  // the structure's agenda has it, the member's too (same structure)
  const agenda = await papi('r47admin', 'GET', '/api/pro/appointments');
  expect(agenda.json.items.map((i) => i.id)).toContain(S.appt);
  await page.close();
});

test('E07 R19 fr: reports — totals, k-anonymous outcomes (withheld under 5), closed capabilities withheld (null, never 0), CSV; a member cannot read them', async () => {
  const r = await papi('r47admin', 'GET', '/api/pro/reports?period=month');
  expect(r.status).toBe(200);
  expect(r.json.kAnonymityMin).toBe(5);
  expect(r.json.kpis.totalAppointments).toBeGreaterThanOrEqual(1);
  expect(r.json.withheldCapabilities).toEqual(expect.arrayContaining(['pro.case_management', 'pro.referrals']));
  expect(r.json.kpis.referralsSent ?? null).toBeNull();
  for (const o of r.json.caseOutcomes || []) if (o.suppressed) expect(o.count).toBeNull();
  const csv = await bearer(await (await import('./lib.mjs')).proLogin('r47admin'), 'GET', '/api/pro/reports?period=month&format=csv');
  expect(csv.headers['content-type']).toContain('text/csv');
  expect(csv.text.replace(/^﻿/, '').split('\r\n')[0]).toBe('indicateur,valeur');
  expect(csv.text).toContain('fonctions_non_ouvertes');
  expect(csv.text).not.toContain('@');
  expect((await bearer(M.token, 'GET', '/api/pro/reports?period=month', undefined, { ip: '192.0.2.199' })).status).toBe(403);
  const stats = await bearer(M.token, 'GET', '/api/pro/team/stats', undefined, { ip: '192.0.2.199' });
  expect(stats.status).toBe(200);
  // the organisation's export (administrator only): the structure, its team — never a password hash or a TOTP secret
  const ex = await papi('r47admin', 'GET', '/api/pro/structure?export=1');
  expect(ex.status).toBe(200); expect(ex.headers['content-disposition']).toContain('export-structure.json');
  expect(ex.text).toContain(ORG.name); expect(ex.text).not.toMatch(/password_hash|mfa_secret|\$scrypt|\$2[aby]\$/);
});

test('E03 R12 fr: the member leaves — access ends at once; E08 closure requested in the screen → two administrators review it', async () => {
  const dep = await papi('r47admin', 'DELETE', `/api/pro/team?userId=${encodeURIComponent(M.id)}`);
  expect(dep.status).toBe(200);
  const after = await bearer(M.token, 'GET', '/api/pro/team/stats', undefined, { ip: '192.0.2.199' });
  expect(after.status).toBe(401); expect(after.json.code).toBe('SESSION_REVOKED');
  const page = await adminP.context.newPage();
  await page.goto(`${BASE}/pro/structure`);
  await expect(page.getByTestId('structure-closure')).toBeVisible();
  await page.getByTestId('structure-closure-reason').fill('R47 LAB : fin de l’activité fictive de démonstration');
  await axe(page, 'closure request');
  const dialog = new Promise((r) => page.once('dialog', async (d) => { r(d.message()); await d.accept(); }));
  await page.getByTestId('structure-closure-request').click();
  expect(await dialog).toContain('Demander la fermeture');
  await expect(page.getByTestId('structure-closure-state')).toBeVisible();
  const list = await aapi('admin2', 'GET', '/api/admin/org-closure');
  const req = list.json.requests.find((x) => x.structureId === ORG.id);
  expect(req).toMatchObject({ status: 'IN_REVIEW', origin: 'ORGANIZATION' });
  const first = await aapi('admin', 'POST', '/api/admin/org-closure', { id: req.id, decision: 'APPROVE', reason: 'R47 LAB : clôture demandée par la structure fictive' });
  expect(first.status).toBe(200);
  const again = (await aapi('admin2', 'GET', '/api/admin/org-closure')).json.requests.find((x) => x.id === req.id);
  expect(again.stage).toBe('AWAITING_SECOND_REVIEWER');
  // the same administrator cannot be the second reviewer
  expect((await aapi('admin', 'POST', '/api/admin/org-closure', { id: req.id, action: 'confirm', note: 'même personne', proposedAt: again.proposedAt })).status).toBe(403);
  // the second reviewer must read the request first (its summary), then confirms what was read
  const early = await aapi('admin2', 'POST', '/api/admin/org-closure', { id: req.id, action: 'confirm', note: 'R47 LAB : sans lecture', proposedAt: again.proposedAt });
  expect(early.status).toBe(409);
  const read = await aapi('admin2', 'GET', `/api/admin/org-closure?id=${encodeURIComponent(req.id)}`);
  expect(read.status).toBe(200); expect(read.json.summary).toBeTruthy();
  const conf = await aapi('admin2', 'POST', '/api/admin/org-closure', { id: req.id, action: 'confirm', note: 'R47 LAB : second contrôle', proposedAt: again.proposedAt });
  expect(conf.status).toBe(200);
  expect(['COMPLETED', 'BLOCKED']).toContain(conf.json.request.status);
  if (conf.json.request.status === 'COMPLETED') {
    expect((await fetch(`${BASE}/api/rdv/structures/${ORG.slug}/profile`)).status, 'a closed organisation is not bookable').toBe(404);
    // the person's confirmed appointment is cancelled and the person is told (R47 fix: account bookings, not only the legacy « booked » status)
    expect((await db(`SELECT status, "cancelledBy" FROM "ProAppointment" WHERE id = $1`, [S.appt]))[0]).toEqual({ status: 'cancelled', cancelledBy: 'ORGANIZATION_CLOSED' });
    await expectNotice(S.appt, 'CANCELLED_BY_STRUCTURE', 'citizen');
    expect(conf.json.summary.appointmentsCancelled).toBeGreaterThanOrEqual(1);
  }
  const { leaks } = await auditWithoutPersonalData(S.since, [A.email, M.email]);
  expect(leaks).toEqual([]);
  await page.close();
});
