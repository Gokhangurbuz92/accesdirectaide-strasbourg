/**
 * R47 journey 1 — CITIZEN, on the built app with the REAL API and a Production-migrated LAB database (run-lab.mjs). No API mock; mail = the LAB test outbox.
 * public search → structure → booking needs an account → register (adult statement) → e-mail verification by the outbox link → sign-in → suitability →
 * service → professional → slots (60-day paging) → direct booking with a consented message → approval-required request → status in « Mes rendez-vous » →
 * structure decision → in-app notification → reschedule → message withdrawal → cancel → data export → rectification → deletion request; negative cases:
 * no adult statement, unverified sign-in, reused link, missing message consent, stale slot (409), duplicate submission (idempotency), expired and revoked
 * session, unreviewed service refused when ADA_SENSITIVITY_REVIEW_ENFORCED=1 (server :3192).
 */
import { test, expect } from '@playwright/test';
import {
  BASE, BASE_ENF, CREDS, SLUG, SVC_DIRECT, SVC_APPROVAL, STAMP, HAS_0045, TOKENS, db, person, citizenSignIn, outbox, linkIn, axe, allSlots, pickSlot, book,
  notices, expectNotice, proNotices, papi, aapi, parisHM, addDays, parisDay,
} from './lib.mjs';

test.describe.configure({ mode: 'serial' });
const V = { email: `r47-visiteur-${STAMP}@cdgg-visiteurs.example.test`, password: `Lab-${STAMP}-Visit9a` };
const MSG = `Motif fictif R47 ${STAMP} : aide pour un dossier de recherche d’emploi`;
const S = {};
let visitor;

test.afterAll(async () => { await visitor?.context.close(); });

test('C01 C02 fr: search → structure → booking asks for an account → sign-up refused without the adult statement → registered → verified by the outbox link → signed in, back to the booking', async ({ browser }) => {
  visitor = await person(browser);
  const page = await visitor.context.newPage();
  await page.goto(`${BASE}/recherche?q=${encodeURIComponent('démarches administratives emploi')}`);
  const hit = page.locator('a[href="/structures/cdgg-conseil"]').first();
  await expect(hit).toBeVisible({ timeout: 30000 });
  await hit.click();
  await page.waitForURL(`**/structures/${SLUG}`);
  await expect(page.getByTestId('structure-booking-account-required')).toBeVisible();
  await axe(page, 'structure profile');
  await page.getByRole('main').getByRole('link', { name: 'Voir les créneaux disponibles' }).click();
  await page.waitForURL((u) => u.pathname === '/auth/login' && (u.searchParams.get('next') || '').startsWith(`/rdv/${SLUG}/booking`));
  await page.getByRole('link', { name: /pas de compte/ }).click();
  await page.waitForURL('**/auth/signup**');
  const adult = page.locator('#auth-adult');
  await expect(adult).not.toBeChecked();
  await page.locator('#auth-email').fill(V.email); await page.locator('#auth-password').fill(V.password); await page.locator('#auth-password-confirm').fill(V.password);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  const summary = page.getByTestId('auth-error-summary');
  await expect(summary).toBeVisible();
  await expect(summary).toBeFocused();   // keyboard focus moves to the error summary
  await expect(page.locator('#auth-adult-error')).toBeVisible();
  expect((await db(`SELECT count(*)::int n FROM "CitizenUser" WHERE email = $1`, [V.email]))[0].n, 'no account without the adult statement').toBe(0);
  // the server refuses it too (not only the form)
  const raw = await visitor.api('POST', '/api/auth/signup', { email: V.email, password: V.password, adultDeclaration: false });
  expect(raw.status).toBe(400); expect(raw.json.code).toBe('ADULT_DECLARATION_REQUIRED');
  await axe(page, 'sign-up with errors');
  await adult.check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.waitForURL('**/auth/verify-email**');
  // not verified yet: the sign-in is refused with the honest message
  const early = await visitor.api('POST', '/api/auth/login', { email: V.email, password: V.password });
  expect(early.status).toBe(401);
  const mails = await outbox(V.email);
  expect(mails.length).toBeGreaterThanOrEqual(1);
  const link = linkIn(mails, /(https?:\/\/[^\s]+\/api\/auth\/verify-email\?token=[0-9a-f]{64}[^\s]*)/);
  expect(link, 'verification link in the test outbox').not.toBeNull();
  const vurl = new URL(link[1]);
  expect(vurl.origin, 'the link points at this LAB origin').toBe(BASE);
  await page.goto(`${BASE}${vurl.pathname}${vurl.search}`);
  await page.waitForURL((u) => u.pathname === '/auth/verify-email' && u.searchParams.get('status') === 'success');
  await expect(page.getByRole('heading', { name: 'Adresse e-mail vérifiée' })).toBeVisible();
  // a reused link is spent
  const again = await visitor.context.request.get(`${BASE}${vurl.pathname}${vurl.search}`, { maxRedirects: 0 });
  expect(again.status()).toBe(302); expect(again.headers().location).toContain('status=expired');
  const row = (await db(`SELECT id, "emailVerifiedAt" FROM "CitizenUser" WHERE email = $1`, [V.email]))[0];
  expect(row.emailVerifiedAt).not.toBeNull(); V.id = row.id;
  expect((await db(`SELECT count(*)::int n FROM "ConsentLog" WHERE subject_id = $1 AND purpose = 'AGE_DECLARATION_ADULT' AND decision = true`, [V.id]))[0].n, 'adult statement in the ledger').toBe(1);
  await citizenSignIn(page, V, `/rdv/${SLUG}/booking`);
  await expect(page).toHaveURL(new RegExp(`/rdv/${SLUG}/booking`));
  const cookie = (await visitor.context.cookies(BASE)).find((c) => c.name === 'ada_user_session');
  expect(cookie?.httpOnly).toBe(true); expect(cookie?.sameSite).toBe('Strict');
  expect(visitor.external).toEqual([]);
  await page.close();
});

test('B01 B02 B03 C18 fr: suitability → service → professional → slots over 60 days (14-day pages) → message refused without consent → direct booking confirmed', async () => {
  const page = await visitor.context.newPage();
  await page.goto(`${BASE}/rdv/${SLUG}/booking`);
  const suit = page.getByTestId('booking-suitability');
  await expect(suit).toBeVisible();
  await expect(suit).toContainText('Aucune question sur votre santé');
  await suit.getByLabel('Oui').check();
  await page.getByTestId(`booking-service-${SVC_DIRECT}`).click();
  const choice = page.getByTestId('booking-professional-choice');
  await expect(choice).toBeVisible();
  await expect(choice).toContainText(CREDS.pros.p1.name); await expect(choice).not.toContainText(CREDS.pros.p3.name); await expect(choice).not.toContainText('@');
  await choice.getByLabel(/Pas de préférence/).check();
  await page.getByTestId('booking-professional-continue').click();
  await expect(page.getByTestId('booking-slot').first()).toBeVisible();
  const prev = page.getByTestId('booking-period-prev'); const next = page.getByTestId('booking-period-next'); const label = page.getByTestId('booking-period-label');
  await expect(prev).toBeDisabled();
  const first = await label.textContent();
  const asked = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.endsWith('/slots')) asked.push(u.searchParams.get('from')); });
  for (let k = 1; k <= 4; k += 1) { await next.click(); await expect.poll(() => asked.length).toBe(k); await expect(page.getByTestId('booking-slots-error')).toHaveCount(0); }
  await expect(next).toBeDisabled();   // the window starting 56 days ahead holds day 60: nothing beyond
  const today = parisDay(Date.now());
  expect(asked).toEqual([1, 2, 3, 4].map((k) => addDays(today, 14 * k)));
  // the real slots of the last window never go beyond 60 days
  const last = await visitor.api('GET', `/api/rdv/structures/${SLUG}/slots?serviceId=${SVC_DIRECT}&from=${addDays(today, 56)}&to=${addDays(today, 69)}`);
  expect(last.json.slots.every((s) => Date.parse(s.startAt) <= Date.now() + 60 * 86400_000 + 60_000)).toBe(true);
  // keyboard only: the focus stays on « previous » while each window loads (R47 fix), Enter four times goes back to the first window, then the focus is
  // handed to « next » (« previous » is disabled there)
  await prev.focus();
  for (let k = 0; k < 4; k += 1) {
    await page.keyboard.press('Enter');
    await expect.poll(() => asked.length).toBe(5 + k); await expect(page.getByTestId('booking-slot').first()).toBeVisible();
    if (k < 3) await expect(prev, 'the focus stays on the period button while it loads').toBeFocused();
  }
  await expect(prev).toBeDisabled(); await expect(next).toBeFocused(); expect(await label.textContent()).toBe(first);
  await axe(page, 'slots, first window');
  // a slot at least 30 h ahead (the reschedule notice is 24 h): the buttons follow the order of the page's own slots answer
  const shown = (await visitor.api('GET', `/api/rdv/structures/${SLUG}/slots?serviceId=${SVC_DIRECT}&from=${today}&to=${addDays(today, 13)}`)).json.slots;
  const idx = shown.findIndex((x) => Date.parse(x.startAt) > Date.now() + 30 * 3600_000);
  const target = shown[idx];
  S.directSlot = target.startAt;
  const hm = parisHM(target.startAt);
  await expect(page.getByTestId('booking-slot').nth(idx)).toHaveText(hm);   // shown in Europe/Paris
  await page.getByTestId('booking-slot').nth(idx).click();
  const msg = page.getByTestId('booking-message');
  await expect(msg).toBeVisible();
  await msg.locator('textarea').fill(MSG);
  await expect(page.locator('main')).toContainText('Inutile de décrire votre santé');
  const consent = page.getByTestId('booking-message-consent-checkbox');
  await expect(consent).not.toBeChecked();
  let posted = 0; const count = (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/rdv/appointments') posted += 1; };
  page.on('request', count);
  await page.getByTestId('booking-confirm').click();
  await expect(page.getByTestId('booking-message-consent-error')).toBeVisible();
  await expect(consent).toBeFocused(); expect(await consent.getAttribute('aria-invalid')).toBe('true'); expect(posted).toBe(0);
  await axe(page, 'recap, consent error');
  // the API refuses it too
  const noConsent = await book(visitor, SVC_DIRECT, target.startAt, { message: MSG });
  expect(noConsent.status).toBe(400); expect(noConsent.json.code).toBe('MESSAGE_CONSENT_REQUIRED');
  await consent.check();
  const [resp] = await Promise.all([page.waitForResponse((r) => new URL(r.url()).pathname === '/api/rdv/appointments' && r.request().method() === 'POST'), page.getByTestId('booking-confirm').click()]);
  expect(resp.status()).toBe(201);
  const created = await resp.json();
  S.direct = created.id; S.directStart = created.startsAt;
  await expect(page.getByTestId('booking-success')).toBeVisible();
  await expect(page.getByTestId('booking-state')).toHaveAttribute('data-state', 'CONFIRMED');
  await expect(page.getByTestId('rdv-mail-outcome')).toHaveAttribute('data-outcome', 'TEST_RECORDED');
  await axe(page, 'booking confirmed');
  const row = (await db(`SELECT status, "citizenUserId", notes FROM "ProAppointment" WHERE id = $1`, [created.id]))[0];
  expect(row.status).toBe('confirmed'); expect(row.citizenUserId).toBe(V.id);
  expect(row.notes.startsWith('v1:') && !row.notes.includes(STAMP), 'the message is sealed at rest').toBe(true);
  await expectNotice(created.id, 'BOOKED_BY_CITIZEN', 'citizen');
  await expectNotice(created.id, 'BOOKED_BY_CITIZEN', 'structure', 'in_app');
  expect((await proNotices(created.id)).filter((n) => n.type === 'rdv_booked_by_citizen').length, 'every active member is told in the console').toBeGreaterThanOrEqual(1);
  // the citizen's confirmation e-mail is MINIMAL while the service is not verified ordinary (no date, no structure, a link to the account)
  const mail = (await outbox(V.email)).at(-1);
  expect(mail.subject).toContain('vous avez une nouvelle information dans votre espace');
  expect(mail.text).not.toContain(MSG); expect(mail.text).not.toContain(hm);
  expect(visitor.serverErrors).toEqual([]);
  page.off('request', count);
  await page.close();
});

test('B03 negative: a stale slot (taken by someone else meanwhile) answers 409 and the page offers the remaining slots; a duplicate submission is replayed, not doubled', async ({ browser }) => {
  const other = await person(browser);
  const page = await other.context.newPage();
  await citizenSignIn(page, CREDS.citizens.second, `/rdv/${SLUG}/booking`);
  await page.getByTestId('booking-suitability').getByLabel('Oui').check();
  await page.getByTestId(`booking-service-${SVC_DIRECT}`).click();
  await page.getByTestId('booking-professional-choice').getByLabel(/Pas de préférence/).check();
  await page.getByTestId('booking-professional-continue').click();
  const firstSlot = page.getByTestId('booking-slot').first();
  await expect(firstSlot).toBeVisible();
  const before = await page.getByTestId('booking-slot').count();
  await firstSlot.click();
  await expect(page.getByTestId('booking-confirm')).toBeVisible();
  // meanwhile the visitor takes exactly that slot (the first offered one) through the API
  const offered = await allSlots(visitor, SVC_DIRECT, { windows: 1 });
  const taken = await book(visitor, SVC_DIRECT, offered[0].startAt);
  expect(taken.status).toBe(201); S.taken = taken.json.id;
  const [resp] = await Promise.all([page.waitForResponse((r) => new URL(r.url()).pathname === '/api/rdv/appointments' && r.request().method() === 'POST'), page.getByTestId('booking-confirm').click()]);
  expect(resp.status()).toBe(409);
  const notice = page.getByTestId('booking-slot-notice');
  await expect(notice).toHaveText('Ce créneau vient d’être réservé. Choisissez un autre horaire.');
  await expect(notice).toHaveAttribute('role', 'status');
  await expect(page.getByTestId('booking-slot').first()).toBeVisible();
  expect(await page.getByTestId('booking-slot').count()).toBeLessThanOrEqual(before);
  await axe(page, 'stale slot notice');
  // idempotency: the same key twice → one appointment, the second answer is the replay of the first
  const key = `r47-dup-${STAMP}`;
  const s2 = pickSlot(offered, { avoid: [offered[0].startAt, S.directSlot], nth: 3 });
  const a = await other.api('POST', '/api/rdv/appointments', { structureSlug: SLUG, serviceId: SVC_DIRECT, startAt: s2.startAt, idempotencyKey: key });
  const b = await other.api('POST', '/api/rdv/appointments', { structureSlug: SLUG, serviceId: SVC_DIRECT, startAt: s2.startAt, idempotencyKey: key });
  expect(a.status).toBe(201); expect(b.status).toBe(200); expect(b.json.id).toBe(a.json.id);
  expect((await db(`SELECT count(*)::int n FROM "ProAppointment" WHERE "idempotencyKey" LIKE $1`, [`%${key}%`]))[0].n).toBe(1);
  // the same slot with OTHER keys: one more appointment per free professional of the team, never two on one professional, then 409
  const ids = [a.json.id]; let last;
  for (let i = 0; i < 4; i += 1) { last = await book(other, SVC_DIRECT, s2.startAt); if (last.status !== 201) break; ids.push(last.json.id); }
  expect(last.status).toBe(409);
  const pros = (await db(`SELECT "createdByProUserId" p FROM "ProAppointment" WHERE id = ANY($1)`, [ids])).map((r) => r.p);
  expect(new Set(pros).size, 'one appointment per professional on the same time').toBe(ids.length);
  for (const id of ids) await other.api('POST', `/api/rdv/appointments/${id}/cancel`, {});
  await visitor.api('POST', `/api/rdv/appointments/${S.taken}/cancel`, {});
  expect(other.serverErrors).toEqual([]);
  await other.context.close();
});

test('B03 C19 C13 N03 fr: approval-required request → « Demande en attente » in Mes rendez-vous → the structure accepts → confirmed, the person is notified in the account', async () => {
  const page = await visitor.context.newPage();
  await page.goto(`${BASE}/rdv/${SLUG}/booking`);
  await page.getByTestId('booking-suitability').getByLabel('Oui').check();
  await page.getByTestId(`booking-service-${SVC_APPROVAL}`).click();
  await page.getByTestId('booking-professional-choice').getByLabel(/Pas de préférence/).check();
  await page.getByTestId('booking-professional-continue').click();
  await page.getByTestId('booking-slot').nth(2).click();
  await expect(page.getByTestId('booking-approval-notice')).toBeVisible();
  await expect(page.getByTestId('booking-confirm')).toContainText('Envoyer la demande de rendez-vous');
  const [resp] = await Promise.all([page.waitForResponse((r) => new URL(r.url()).pathname === '/api/rdv/appointments' && r.request().method() === 'POST'), page.getByTestId('booking-confirm').click()]);
  expect(resp.status()).toBe(201);
  const req = await resp.json(); S.request = req.id;
  await expect(page.getByTestId('booking-state')).toHaveAttribute('data-state', 'REQUESTED');
  await expect(page.getByTestId('booking-success')).toContainText('pas encore confirmé');
  await expect(page.getByTestId('booking-download-ics')).toHaveCount(0);
  expect((await db(`SELECT status FROM "ProAppointment" WHERE id = $1`, [req.id]))[0].status).toBe('requested');
  await expectNotice(req.id, 'REQUEST_RECEIVED', 'citizen');
  await page.goto(`${BASE}/compte/rendez-vous`);
  const item = page.getByTestId('rdv-item').filter({ hasText: 'Demande en attente de validation par la structure' });
  await expect(item).toHaveCount(1);
  await axe(page, 'Mes rendez-vous with a pending request');
  // the structure (its administrator) accepts the request for the time it was asked
  const dec = await papi('admin', 'PATCH', `/api/pro/appointments?id=${encodeURIComponent(req.id)}`, { decision: 'ACCEPT', expectedStartAt: req.startsAt });
  expect(dec.status).toBe(200); expect(dec.json.status).toBe('confirmed');
  await expectNotice(req.id, 'REQUEST_ACCEPTED', 'citizen');
  await page.reload();
  await expect(page.getByTestId('rdv-item').filter({ hasText: CREDS.services.approval.name }).getByTestId('rdv-state')).toHaveText('Confirmé');
  await page.goto(`${BASE}/compte`);
  const center = page.getByTestId('notification-center');
  await expect(center).toBeVisible();
  if (HAS_0045) {
    await expect(center.getByText('Votre demande de rendez-vous a été acceptée.')).toBeVisible();
    await expect(center.getByText('Votre demande de rendez-vous a été transmise.')).toBeVisible();
  } else {
    // 0042: the four R43 kinds are not in the ledger, so the in-app list has none of them (the e-mail is still sent)
    await expect(center.locator('[data-kind="APPOINTMENT_REQUEST_ACCEPTED"]')).toHaveCount(0);
  }
  const mail = (await outbox(V.email)).at(-1);
  expect(mail.subject, 'decision e-mail at the minimal level (service not verified ordinary)').toContain('nouvelle information dans votre espace');
  await axe(page, 'Mon Espace');
  await page.close();
});

test('B05 C19 N03 fr: reschedule the direct appointment in Mes rendez-vous → old slot released, notices to both sides, in-app « déplacé »', async () => {
  const page = await visitor.context.newPage();
  await page.goto(`${BASE}/compte/rendez-vous`);
  const item = page.getByTestId('rdv-item').filter({ hasText: CREDS.services.direct.name }).filter({ has: page.getByTestId('rdv-move') }).first();
  await item.getByTestId('rdv-move').click();
  const panel = page.getByTestId('rdv-move-panel');
  await expect(panel).toBeVisible();
  const choices = panel.getByTestId('rdv-slot');
  await expect(choices.first()).toBeVisible();
  await choices.nth(1).check();
  await axe(page, 'reschedule panel');
  const [resp] = await Promise.all([page.waitForResponse((r) => /\/reschedule$/.test(new URL(r.url()).pathname)), panel.getByTestId('rdv-move-confirm').click()]);
  expect(resp.status()).toBe(200);
  const moved = await resp.json();
  await expect(page.getByTestId('rdv-status')).toContainText('Rendez-vous déplacé');
  expect(moved.startsAt).not.toBe(S.directStart);
  const row = (await db(`SELECT status, "rescheduleCount", "startAt" FROM "ProAppointment" WHERE id = $1`, [S.direct]))[0];
  expect(row.rescheduleCount).toBe(1); expect(new Date(row.startAt).toISOString()).toBe(moved.startsAt);
  await expectNotice(S.direct, 'RESCHEDULED', 'citizen');
  await expectNotice(S.direct, 'RESCHEDULED', 'structure');
  // the old slot is free again
  const free = await allSlots(visitor, SVC_DIRECT, { windows: 2 });
  expect(free.some((s) => s.startAt === S.directStart), 'the previous slot is offered again').toBe(true);
  await page.goto(`${BASE}/compte`);
  await expect(page.getByTestId('notification-center').getByText('Un rendez-vous a été déplacé.')).toBeVisible();
  // a move inside the 24 h notice is refused (API)
  const late = await visitor.api('POST', `/api/rdv/appointments/${S.direct}/reschedule`, { startAt: moved.startsAt });
  expect([400, 409]).toContain(late.status);
  await page.close();
});

test('C18 B04 fr: the optional message is withdrawn (the structure no longer reads it), then the appointment is cancelled with notices', async () => {
  const page = await visitor.context.newPage();
  let staff = await papi('admin', 'GET', `/api/pro/appointments?id=${encodeURIComponent(S.direct)}`);
  expect((staff.json.items || [])[0]?.citizenMessage).toBe(MSG);
  await page.goto(`${BASE}/compte/rendez-vous`);
  const item = page.getByTestId('rdv-item').filter({ has: page.getByTestId('rdv-message-withdraw') }).first();
  await item.getByTestId('rdv-message-withdraw').click();
  await expect(page.getByTestId('rdv-message-withdraw-panel')).toBeVisible();
  await page.getByTestId('rdv-message-withdraw-confirm').click();
  await expect(page.getByTestId('rdv-status')).toContainText('Votre message a été effacé. La structure ne le voit plus.');
  staff = await papi('admin', 'GET', `/api/pro/appointments?id=${encodeURIComponent(S.direct)}`);
  expect((staff.json.items || [])[0]?.citizenMessage ?? null).toBeNull();
  expect((await db(`SELECT count(*)::int n FROM "ConsentLog" WHERE purpose = 'BOOKING_MESSAGE_TRANSMISSION' AND decision = false AND policy_hash LIKE $1`, [`%:${S.direct}`]))[0].n).toBe(1);
  const card = page.getByTestId('rdv-item').filter({ hasText: CREDS.services.direct.name }).filter({ has: page.getByTestId('rdv-cancel') }).first();
  await card.getByTestId('rdv-cancel').click();
  await expect(page.getByTestId('rdv-cancel-confirm-panel')).toBeVisible();
  await axe(page, 'cancel confirmation');
  await page.getByTestId('rdv-cancel-confirm').click();
  await expect(page.getByTestId('rdv-status')).toContainText('Rendez-vous annulé.');
  expect((await db(`SELECT status, "cancelledBy" FROM "ProAppointment" WHERE id = $1`, [S.direct]))[0]).toMatchObject({ status: 'cancelled' });
  await expectNotice(S.direct, 'CANCELLED_BY_CITIZEN', 'structure');
  // a second cancel sends no second notice
  const n1 = (await notices(S.direct)).length;
  const again = await visitor.api('POST', `/api/rdv/appointments/${S.direct}/cancel`, {});
  expect(again.status).toBe(200); expect((await notices(S.direct)).length).toBe(n1);
  await page.close();
});

test('C21 fr: data export, rectification (with a refused value), deletion request — the account stays active until review', async () => {
  const page = await visitor.context.newPage();
  // rectification
  await page.goto(`${BASE}/compte/profil`);
  const name = page.locator('#pf-name');
  await expect(name).toBeVisible();
  const bad = await visitor.api('PUT', '/api/citizen/profile', { displayName: 'x'.repeat(61) });
  expect(bad.status).toBe(400); expect(bad.json.error).toBe('INVALID_DISPLAY_NAME');
  await name.fill('Personne R47 fictive');
  await page.getByTestId('profil-save').click();
  await expect(page.getByTestId('profil-status')).toContainText('Profil enregistré.');
  expect((await db(`SELECT "displayName" FROM "CitizenProfile" WHERE "userId" = $1`, [V.id]))[0].displayName).toBe('Personne R47 fictive');
  await axe(page, 'profile saved');
  // export
  await page.goto(`${BASE}/compte/parametres`);
  await page.getByRole('tab', { name: 'Données' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Télécharger (JSON)' }).click()]);
  const file = await download.path();
  const data = JSON.parse((await import('node:fs')).readFileSync(file, 'utf8'));
  expect(JSON.stringify(data)).toContain(V.email);
  expect(JSON.stringify(data)).toContain('Personne R47 fictive');
  await expect(page.getByTestId('compte-export-status')).toContainText('Export téléchargé.');
  expect((await db(`SELECT count(*)::int n FROM "DSRRequest" WHERE "subjectId" = $1 AND "requestType" = 'EXPORT'`, [V.id]))[0].n).toBeGreaterThanOrEqual(1);
  // deletion request
  await page.getByRole('button', { name: 'Supprimer mon compte' }).click();
  await expect(page.getByRole('alertdialog').or(page.getByRole('dialog'))).toContainText('Supprimer votre compte ?');
  await page.getByRole('button', { name: 'Demander la suppression' }).click();
  await expect(page.getByTestId('deletion-requested')).toContainText('Votre compte reste actif jusqu’à son traitement.');
  await axe(page, 'deletion requested');
  const st = await visitor.api('GET', '/api/auth/delete-account');
  expect(st.json.request.status).toBe('IN_REVIEW');
  const twice = await visitor.api('DELETE', '/api/auth/delete-account');
  expect(twice.status).toBe(202); expect(twice.json.message).toContain('déjà en cours');
  expect((await db(`SELECT "emailVerifiedAt" IS NOT NULL AS active FROM "CitizenUser" WHERE id = $1`, [V.id]))[0].active).toBe(true);
  expect(visitor.serverErrors).toEqual([]);
  await page.close();
});

test('C01 negative: an expired session cookie and a revoked one (signed out everywhere) are refused — the pages ask to sign in again, no data is shown', async ({ browser }) => {
  const p = await person(browser);
  await p.context.addCookies([{ name: 'ada_user_session', value: TOKENS.expiredCitizen, url: BASE, httpOnly: true, sameSite: 'Strict' }]);
  const page = await p.context.newPage();
  expect((await p.api('GET', '/api/rdv/appointments')).status).toBe(401);
  expect((await p.api('GET', '/api/citizen/notifications')).status).toBe(401);
  await page.goto(`${BASE}/compte`);
  await expect(page.getByTestId('mon-espace-error')).toContainText('Connectez-vous pour accéder à Mon Espace.');
  await page.goto(`${BASE}/rdv/${SLUG}/booking`);
  await page.waitForURL((u) => u.pathname === '/auth/login' && (u.searchParams.get('next') || '').startsWith(`/rdv/${SLUG}/booking`));
  // a real session, then « sign out »: the old cookie value is refused afterwards (sessionsValidAfter)
  await citizenSignIn(page, CREDS.citizens.second, '/compte');
  const old = (await p.context.cookies(BASE)).find((c) => c.name === 'ada_user_session').value;
  expect((await p.api('GET', '/api/rdv/appointments')).status).toBe(200);
  expect((await p.api('POST', '/api/auth/logout', {})).status).toBe(200);
  await p.context.addCookies([{ name: 'ada_user_session', value: old, url: BASE, httpOnly: true, sameSite: 'Strict' }]);
  expect((await p.api('GET', '/api/rdv/appointments')).status).toBe(401);
  await p.context.close();
});

test('B01 negative (ADA_SENSITIVITY_REVIEW_ENFORCED=1, server :3192): an unreviewed service is refused online — contact the structure; a service the administrator verified ordinary is bookable', async ({ browser }) => {
  // the platform administrator (MFA + elevation, reason recorded) verifies the direct service as ordinary; the approval service stays unreviewed
  const review = await aapi('admin', 'POST', '/api/admin/service-sensitivity', { action: 'review', structureId: CREDS.structure.id, serviceId: SVC_DIRECT, value: 'ordinary', reason: 'R47 LAB : service fictif sans donnée sensible' });
  expect(review.status).toBe(200);
  const noElev = await aapi('adminNoElev', 'POST', '/api/admin/service-sensitivity', { action: 'review', structureId: CREDS.structure.id, serviceId: SVC_APPROVAL, value: 'ordinary', reason: 'R47 LAB : tentative sans élévation' });
  expect(noElev.status).toBe(403); expect(noElev.json.error).toBe('ELEVATION_REQUIRED');
  const list = await aapi('admin', 'POST', '/api/admin/service-sensitivity', { action: 'list', structureId: CREDS.structure.id });
  expect(list.json.items.find((i) => i.id === SVC_DIRECT).value).toBe('ordinary');
  expect(list.json.items.find((i) => i.id === SVC_APPROVAL).value).toBe('unknown');
  const p = await person(browser, { base: BASE_ENF });
  const page = await p.context.newPage();
  await citizenSignIn(page, CREDS.citizens.second, `/rdv/${SLUG}/booking`, BASE_ENF);
  await page.getByTestId('booking-suitability').getByLabel('Oui').check();
  await expect(page.getByTestId(`booking-service-contact-${SVC_APPROVAL}`)).toBeVisible();
  await page.getByTestId(`booking-service-${SVC_APPROVAL}`).click();
  const notice = page.getByTestId('booking-contact-structure');
  await expect(notice).toContainText('La prise de rendez-vous en ligne n’est pas proposée pour ce service.');
  await axe(page, 'unreviewed service refused');
  const svc = await p.api('GET', `/api/rdv/structures/${SLUG}/services`);
  expect(svc.json.items.find((i) => i.id === SVC_APPROVAL).onlineBooking).toBe('CONTACT_STRUCTURE');
  expect(svc.json.items.find((i) => i.id === SVC_DIRECT).onlineBooking).toBe('OPEN');
  const today = parisDay(Date.now());
  const slotsRefused = await p.api('GET', `/api/rdv/structures/${SLUG}/slots?serviceId=${SVC_APPROVAL}&from=${today}&to=${addDays(today, 13)}`);
  expect(slotsRefused.status).toBe(409); expect(slotsRefused.json.code).toBe('SERVICE_SENSITIVITY_UNREVIEWED');
  const direct = await allSlots(p, SVC_DIRECT, { windows: 1 });
  const refused = await book(p, SVC_APPROVAL, direct[0].startAt, {}, SLUG);
  expect(refused.status).toBe(409); expect(refused.json.code).toBe('SERVICE_SENSITIVITY_UNREVIEWED');
  expect((await db(`SELECT count(*)::int n FROM "ProAppointment" WHERE "serviceId" = $1 AND "citizenUserId" = $2 AND status IN ('requested','confirmed')`, [SVC_APPROVAL, CREDS.citizens.second.id]))[0].n).toBe(0);
  const ok = await book(p, SVC_DIRECT, pickSlot(direct, { nth: 5 }).startAt);
  expect(ok.status).toBe(201);
  // verified ordinary: the confirmation e-mail is the REDUCED level (date and time, no free text) instead of the minimal one
  const mail = (await outbox(CREDS.citizens.second.email, BASE_ENF)).at(-1);
  expect(mail.subject).not.toContain('nouvelle information dans votre espace');
  expect(mail.text).toContain(parisHM(ok.json.startsAt));
  await p.api('POST', `/api/rdv/appointments/${ok.json.id}/cancel`, {});
  await p.context.close();
});
