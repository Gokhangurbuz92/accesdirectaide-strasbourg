/**
 * FA-CAP — CITIZEN surface (Mon espace). Every capability here is CLOSED in Production today (accounts surface not open, 6B pending; the out-of-AIPD
 * capabilities are not named; HDS-bound ones have no attestation): each test proves the capability's effect on the OPEN LAB server — a synthetic adult
 * signs in through the real form and acts in the browser or through the page's own API call with the browser's cookies — and then that PRODUCTION refuses
 * it (« the gate holds »). LAB_SYNTHETIC people only (e2e-fab/seed.mjs, fab-cit-*).
 */
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { OPEN, PROD, CREDS, TOKENS, db, closeDb, visitor, anon, bearer, ips, expectClosed, citizenSignIn, outbox, finalResponse } from './lib.mjs';

const nextIp = ips(60, 119);
const code = (j) => j?.code || j?.error;
const F = CREDS.catalogue.citizens; const ORG = CREDS.structures;
test.afterAll(async () => { await closeDb(); });

/** a synthetic adult signed in on the OPEN server through the real form */
async function signedIn(browser, who, next = '/compte', opts = {}) {
  const P = await visitor(browser, nextIp, { base: OPEN, ...opts });
  const page = await P.context.newPage();
  await citizenSignIn(page, who, next, OPEN);
  return { P, page };
}
/** a citizen API call on PRODUCTION (no session can exist there: the surface is closed) */
const prodCall = (method, p, body) => anon(method, p, body, { base: PROD, ip: nextIp() });
const cron = (job, base = OPEN) => fetch(`${base}/api/cron/${job}`, { headers: { authorization: `Bearer ${TOKENS.cron}`, 'x-forwarded-for': nextIp() } }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
/** a dossier owned by the signed-in person, shared with organisation X (invitation redeemed by X's professional) */
async function sharedWithX(P) {
  const created = await P.api('POST', '/api/share/create', { situation: { zipCode: '67000', note: 'fab' }, results: { rights: [] } });
  expect(created.status).toBe(200);
  const shareId = created.json.shareId;
  const inv = await P.api('POST', '/api/public/dossier-grants', { shareId, action: 'invite', structureId: ORG.X.id });
  expect(inv.status).toBe(201);
  expect((await bearer('pro_x1', 'POST', '/api/pro/dossier/redeem', { shareId, inviteToken: inv.json.inviteToken }, { ip: nextIp() })).status).toBe(200);
  return { shareId, ownerSecret: created.json.ownerSecret };
}

test('C03 profile and household: OPEN — a household member is added (age band, no name) and shown; PROD — refused (gate holds)', async ({ browser }) => {
  const { P, page } = await signedIn(browser, F[1], '/compte/profil');
  const add = await P.api('POST', '/api/citizen/household', { relation: 'child', ageBand: 'moins-de-18', label: 'Enfant' });
  expect(add.status, JSON.stringify(add.json)).toBe(201);
  expect((await db(`SELECT relation, "ageBand" FROM "HouseholdMember" WHERE "userId" = $1`, [F[1].id]))).toEqual([{ relation: 'child', ageBand: 'moins-de-18' }]);
  await page.reload();
  await expect(page.getByTestId('household-item')).toHaveCount(1);
  expect((await P.api('POST', '/api/citizen/household', { relation: 'cousin' })).status).toBe(400);
  await P.context.close();
  expectClosed(await prodCall('POST', '/api/citizen/household', { relation: 'child' }), 'C03 household');
});

test('C04 language preference persisted and applied: OPEN — the account language follows the person to a new device; display preferences stay on the device; PROD — refused', async ({ browser }) => {
  const { P } = await signedIn(browser, F[2]);
  const put = await P.api('PUT', '/api/citizen/profile', { preferredLanguage: 'de', accessibilityPrefs: { textSize: 'xl' } });
  expect(put.status).toBe(200);
  const row = (await db(`SELECT "preferredLanguage", "accessibilityPrefs" FROM "CitizenProfile" WHERE "userId" = $1`, [F[2].id]))[0];
  expect(row.preferredLanguage).toBe('de');
  expect(row.accessibilityPrefs == null || Object.keys(row.accessibilityPrefs).length === 0, 'display preferences are never stored server-side (P2b)').toBe(true);
  await P.context.close();
  const Q = await signedIn(browser, F[2], '/compte');   // another device: French in its own storage
  await expect(Q.page.locator('html')).toHaveAttribute('lang', 'de');
  await Q.P.context.close();
  expectClosed(await prodCall('PUT', '/api/citizen/profile', { preferredLanguage: 'de' }), 'C04 profile');
});

test('C06 account-owned dossiers: OPEN — an account-free dossier is attached to the account only with BOTH the session and its owner secret; PROD — refused', async ({ browser }) => {
  const free = await anon('POST', '/api/share/create', { situation: { zipCode: '67000' }, results: { rights: [] } }, { ip: nextIp() });
  expect(free.status).toBe(200);
  const { shareId, ownerSecret } = free.json;
  expect((await db(`SELECT "ownerCitizenId" FROM "SharedDiagnostic" WHERE id = $1`, [shareId]))[0].ownerCitizenId).toBeNull();
  const { P, page } = await signedIn(browser, F[3], '/compte');
  const wrong = await P.context.request.fetch(`${OPEN}/api/citizen/shares`, { method: 'POST', headers: { 'content-type': 'application/json', origin: OPEN, 'x-csrf-token': (await P.context.cookies(OPEN)).find((c) => c.name === '__csrf')?.value || '', 'x-share-owner-secret': 'not-the-secret' }, data: JSON.stringify({ shareId }) });
  expect(wrong.status()).not.toBe(200);
  const csrf = (await P.context.cookies(OPEN)).find((c) => c.name === '__csrf')?.value;
  const ok = await P.context.request.fetch(`${OPEN}/api/citizen/shares`, { method: 'POST', headers: { 'content-type': 'application/json', origin: OPEN, 'x-csrf-token': csrf, 'x-share-owner-secret': ownerSecret }, data: JSON.stringify({ shareId }) });
  expect(ok.status()).toBe(200);
  expect((await db(`SELECT "ownerCitizenId" FROM "SharedDiagnostic" WHERE id = $1`, [shareId]))[0].ownerCitizenId).toBe(F[3].id);
  await page.goto(`${OPEN}/compte/profil`);
  await expect(page.getByTestId('share-item')).toHaveCount(1);
  await P.context.close();
  expectClosed(await prodCall('POST', '/api/share/create', { situation: {}, results: { rights: [] } }), 'C06 share/create');
  expectClosed(await prodCall('GET', '/api/citizen/shares'), 'C06 citizen/shares');
});

test('C08 consented reminders of sourced deadlines: OPEN — a J-1 deadline with its official source is reminded once, without naming the step; no consent = nothing sent; PROD — refused', async ({ browser }) => {
  const { P } = await signedIn(browser, F[4]);
  const due = new Date(Date.now() + 20 * 3600e3).toISOString();   // inside the J-1 window (due within the next 24 h)
  const item = await P.api('POST', '/api/citizen/parcours', { action: 'add', title: 'Étape secrète FAB C08' });
  expect(item.status).toBe(201);
  const unsourced = await P.api('POST', '/api/citizen/parcours', { action: 'deadline', id: item.json.item.id, dueDate: due, dueSourceUrl: 'http://exemple.invalid/x' });
  expect(code(unsourced.json)).toBe('DEADLINE_SOURCE_REQUIRED');
  expect((await P.api('POST', '/api/citizen/parcours', { action: 'deadline', id: item.json.item.id, dueDate: due, dueSourceUrl: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006' })).status).toBe(200);
  const run1 = await cron('parcours-reminder'); expect(run1.status).toBe(200);
  const sent = (await outbox(F[4].email, OPEN));
  expect(sent.length).toBe(1);
  expect(sent[0].text).not.toContain('Étape secrète FAB C08');   // an e-mail can be seen by others: no step, no right named
  const rows = await db(`SELECT threshold, channel, status FROM "ParcoursReminder" WHERE "itemId" = $1 ORDER BY channel`, [item.json.item.id]);
  expect(rows).toEqual([{ threshold: 'J1', channel: 'email', status: 'TEST_RECORDED' }, { threshold: 'J1', channel: 'push', status: 'NO_CONSENT' }, { threshold: 'J1', channel: 'sms', status: 'NO_CONSENT' }]);
  await cron('parcours-reminder');
  expect((await outbox(F[4].email, OPEN)).length, 'exactly once').toBe(1);
  // the person switches e-mail reminders off: a new deadline is not sent
  expect((await P.api('PUT', '/api/citizen/preferences', { channel: 'email', category: 'reminder', enabled: false })).status).toBe(200);
  const item2 = await P.api('POST', '/api/citizen/parcours', { action: 'add', title: 'Autre étape FAB C08' });
  await P.api('POST', '/api/citizen/parcours', { action: 'deadline', id: item2.json.item.id, dueDate: due, dueSourceUrl: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006' });
  await cron('parcours-reminder');
  expect((await outbox(F[4].email, OPEN)).length).toBe(1);
  expect((await db(`SELECT status FROM "ParcoursReminder" WHERE "itemId" = $1 AND channel = 'email'`, [item2.json.item.id])).map((r) => r.status)).toEqual(['NO_CONSENT']);
  await P.context.close();
  expectClosed(await anon('GET', '/api/cron/parcours-reminder', undefined, { base: PROD, ip: nextIp() }), 'C08 job');
});

test('C10 favourites (published records only): OPEN — a verified aide is kept and listed; a hidden record cannot be kept; PROD — refused', async ({ browser }) => {
  const { P, page } = await signedIn(browser, F[5], '/compte/favoris');
  expect((await P.api('POST', '/api/citizen/favorites', { entityType: 'aide', entityId: 'fab-aide-logement' })).status).toBe(200);
  expect((await P.api('POST', '/api/citizen/favorites', { entityType: 'aide', entityId: 'fab-aide-not-eligible' })).status).toBe(404);
  await page.reload();
  await expect(page.getByTestId('favori-item')).toHaveCount(1);
  await expect(page.getByTestId('favori-item')).toContainText('Aide FAB logement (test)');
  expect((await db(`SELECT "entityId" FROM "CitizenFavorite" WHERE "userId" = $1`, [F[5].id])).map((r) => r.entityId)).toEqual(['fab-aide-logement']);
  await P.context.close();
  expectClosed(await prodCall('POST', '/api/citizen/favorites', { entityType: 'aide', entityId: 'fab-aide-logement' }), 'C10 favourites');
});

test('C11 opt-in history: OPEN — nothing is kept until the person opts in; switching it off erases every entry; PROD — refused', async ({ browser }) => {
  const { P, page } = await signedIn(browser, F[6], '/compte/historique');
  expect((await P.api('POST', '/api/citizen/history', { kind: 'aide', label: 'Aide FAB logement', ref: 'fab-aide-logement' })).status).toBe(202);   // not opted in: not recorded
  expect((await db(`SELECT count(*)::int n FROM "CitizenHistoryEntry" WHERE "userId" = $1`, [F[6].id]))[0].n).toBe(0);
  expect((await P.api('PUT', '/api/citizen/history', { enabled: true })).status).toBe(200);
  expect((await P.api('POST', '/api/citizen/history', { kind: 'aide', label: 'Aide FAB logement', ref: 'fab-aide-logement' })).status).toBe(201);
  await page.reload();
  await expect(page.getByTestId('historique-item')).toHaveCount(1);
  const off = await P.api('PUT', '/api/citizen/history', { enabled: false });
  expect(off.json.erased).toBe(1);
  expect((await db(`SELECT count(*)::int n FROM "CitizenHistoryEntry" WHERE "userId" = $1`, [F[6].id]))[0].n).toBe(0);
  await P.context.close();
  expectClosed(await prodCall('GET', '/api/citizen/history'), 'C11 history');
});

test('C12 saved diagnostics and plans: OPEN — a dossier saved under a session belongs to the account and is listed; PROD — refused', async ({ browser }) => {
  const { P, page } = await signedIn(browser, F[7], '/compte/profil');
  const saved = await P.api('POST', '/api/share/create', { situation: { zipCode: '67000' }, results: { rights: [] } });
  expect(saved.status).toBe(200);
  expect((await db(`SELECT "ownerCitizenId" FROM "SharedDiagnostic" WHERE id = $1`, [saved.json.shareId]))[0].ownerCitizenId).toBe(F[7].id);
  const list = await P.api('GET', '/api/citizen/shares');
  expect(list.json.shares.map((s) => s.id || s.shareId)).toContain(saved.json.shareId);
  await page.reload();
  await expect(page.getByTestId('share-item')).toHaveCount(1);
  await P.context.close();
  expectClosed(await prodCall('POST', '/api/share/create', { situation: {}, results: { rights: [] } }), 'C12 save');
});

test('C16 purpose control per organisation (PURP-05 / PURP-06): OPEN — the owner agrees then withdraws AI use for ONE organisation, each decision is a ledger row; PROD — refused', async ({ browser }) => {
  const { P } = await signedIn(browser, F[8]);
  const { shareId } = await sharedWithX(P);
  const yes = await P.api('POST', '/api/public/dossier-grants', { shareId, action: 'set_purposes', structureId: ORG.X.id, purposes: ['PURP-05'] });
  expect(yes.status).toBe(200); expect(yes.json.purposes).toEqual(expect.arrayContaining(['PURP-06', 'PURP-05']));
  const no = await P.api('POST', '/api/public/dossier-grants', { shareId, action: 'set_purposes', structureId: ORG.X.id, purposes: [] });
  expect(no.json.purposes).not.toContain('PURP-05');
  const ledger = await db(`SELECT purpose, decision FROM "ConsentLog" WHERE subject_type = 'SHARED_DOSSIER_GRANT' AND subject_id LIKE $1 ORDER BY created_at`, [`%${shareId}%`]);
  expect(ledger.filter((r) => r.purpose === 'PURP-05').map((r) => r.decision)).toEqual([true, false]);
  expect(ledger.some((r) => r.purpose === 'PURP-06' && r.decision === true)).toBe(true);
  await P.context.close();
  expectClosed(await prodCall('POST', '/api/public/dossier-grants', { shareId, action: 'list' }), 'C16 grants');
});

test('C22 consent ledger (append-only, withdrawal): OPEN — a withdrawal is a NEW row, an existing row cannot be rewritten; PROD — refused', async ({ browser }) => {
  const { P } = await signedIn(browser, F[9]);
  const { shareId } = await sharedWithX(P);
  expect((await P.api('POST', '/api/public/dossier-grants', { shareId, action: 'revoke', structureId: ORG.X.id })).status).toBe(200);
  const rows = await db(`SELECT id, purpose, decision FROM "ConsentLog" WHERE subject_type = 'SHARED_DOSSIER_GRANT' AND subject_id LIKE $1 AND purpose = 'PURP-06' ORDER BY created_at`, [`%${shareId}%`]);
  expect(rows.map((r) => r.decision)).toEqual([true, false]);   // the « yes » stays, the withdrawal is appended
  await expect(db(`UPDATE "ConsentLog" SET decision = true WHERE id = $1`, [rows[1].id])).rejects.toThrow();
  await P.context.close();
  expectClosed(await prodCall('POST', '/api/public/dossier-grants', { shareId, action: 'revoke', structureId: ORG.X.id }), 'C22 withdrawal');
});

test('C23 delegation: OPEN — scoped read-only access for a trusted person (invitation by e-mail, acceptance, logged views, end); a legal mandate stays « proof required »; PROD — refused', async ({ browser }) => {
  const principal = await signedIn(browser, F[10], '/compte/delegations');
  await principal.P.api('POST', '/api/citizen/parcours', { action: 'add', title: 'Étape partagée FAB C23' });
  const inv = await principal.P.api('POST', '/api/citizen/delegations', { action: 'invite', email: F[11].email, role: 'AIDANT', scopes: ['PARCOURS_READ'], days: 30 });
  expect(inv.status, JSON.stringify(inv.json)).toBeLessThan(300);
  const mail = (await outbox(F[11].email, OPEN)).find((m) => /délégation|confiance|consulter/i.test(m.subject + m.text));
  const token = decodeURIComponent(/invitation=([^\s&"]+)/.exec(mail.text)[1]);
  const delegate = await signedIn(browser, F[11], `/compte/delegations?invitation=${encodeURIComponent(token)}`);
  await delegate.page.getByTestId('delegation-accept').click();
  await expect(delegate.page.getByTestId('delegation-received-item')).toHaveCount(1);
  const id = (await db(`SELECT id FROM "CitizenDelegation" WHERE "principalUserId" = $1`, [F[10].id]))[0].id;
  const view = await delegate.P.api('GET', `/api/citizen/delegations?id=${id}&view=parcours`);
  expect(view.status).toBe(200); expect(JSON.stringify(view.json)).toContain('Étape partagée FAB C23');
  expect((await delegate.P.api('GET', `/api/citizen/delegations?id=${id}&view=coffre`)).status, 'outside the scopes').not.toBe(200);
  const log = await principal.P.api('GET', `/api/citizen/delegations?log=${id}`);
  expect(log.json.events.length).toBeGreaterThan(0);
  expect((await principal.P.api('POST', '/api/citizen/delegations', { action: 'end', id })).status).toBe(200);
  expect((await delegate.P.api('GET', `/api/citizen/delegations?id=${id}&view=parcours`)).status).not.toBe(200);
  const mandate = await principal.P.api('POST', '/api/citizen/delegations', { action: 'invite', email: F[12].email, role: 'TUTEUR', scopes: ['PARCOURS_READ'], days: 30 });
  expect(mandate.status).toBeLessThan(300);
  expect((await db(`SELECT "proofStatus" FROM "CitizenDelegation" WHERE "principalUserId" = $1 AND role = 'TUTEUR'`, [F[10].id]))[0].proofStatus).toBe('REQUIRED_NOT_VERIFIED');
  await principal.P.context.close(); await delegate.P.context.close();
  expectClosed(await prodCall('POST', '/api/citizen/delegations', { action: 'invite' }), 'C23 delegations');
});

test('C24 assisted access at a counter: OPEN — the invitation for ONE organisation is handed over as a link and a QR code, redeemable once by that organisation only; PROD — refused', async ({ browser }) => {
  const { P, page } = await signedIn(browser, F[13]);
  const created = await P.api('POST', '/api/share/create', { situation: { zipCode: '67000' }, results: { rights: [] } });
  const shareId = created.json.shareId;
  await page.goto(`${OPEN}/compte/partages/${encodeURIComponent(shareId)}`);
  await page.locator('#org-search').fill('FA1 Accueil');
  await page.getByRole('button', { name: new RegExp(ORG.X.nom) }).click();
  const inv = finalResponse(page, (u, m) => u.endsWith('/api/public/dossier-grants') && m === 'POST');
  await page.getByTestId('share-summary').getByRole('button').filter({ hasText: /partager|confirmer/i }).first().click();
  expect((await inv).status()).toBe(201);
  const ready = page.getByTestId('invite-ready');
  await expect(ready.getByRole('img').first()).toBeVisible();   // the QR code of the hand-over
  const link = await ready.locator('input[readonly]').inputValue();
  const token = decodeURIComponent(/#invite=([^&]+)/.exec(link)[1]);
  expect((await bearer('pro_y1', 'POST', '/api/pro/dossier/redeem', { shareId, inviteToken: token }, { ip: nextIp() })).status, 'another organisation').not.toBe(200);
  expect((await bearer('pro_x1', 'POST', '/api/pro/dossier/redeem', { shareId, inviteToken: token }, { ip: nextIp() })).status).toBe(200);
  const used = await db(`SELECT "usedAt" IS NOT NULL AS used, "structureId" FROM "SharedDossierInvite" WHERE "sharedDiagnosticId" = $1`, [shareId]);
  expect(used).toEqual([{ used: true, structureId: ORG.X.id }]);   // single use, bound to X
  expect((await bearer('pro_z1', 'POST', '/api/pro/dossier/redeem', { shareId, inviteToken: token }, { ip: nextIp() })).status, 'a used invitation opens nothing for anyone else').not.toBe(200);
  await P.context.close();
  expectClosed(await prodCall('POST', '/api/pro/dossier/redeem', { shareId, inviteToken: token }), 'C24 redeem');
});

test('C26 / N08 FranceConnect (LAB mock issuer): OPEN — the signed-in person links the identity, then signs in with it on a new device; no account is ever created from it; PROD — unavailable', async ({ browser }) => {
  const { P, page } = await signedIn(browser, F[14]);
  expect((await P.api('GET', '/api/auth/franceconnect/status')).json.available).toBe(true);
  await page.goto(`${OPEN}/api/auth/franceconnect/link?next=/compte`);
  await page.waitForURL((u) => u.origin === OPEN && /fc=linked/.test(u.search));
  expect((await P.api('GET', '/api/auth/franceconnect/status')).json.linked).toBe(true);
  await P.context.close();
  const Q = await visitor(browser, nextIp, { base: OPEN });
  const q = await Q.context.newPage();
  await q.goto(`${OPEN}/api/auth/franceconnect/login?next=/compte`);
  await q.waitForURL((u) => u.origin === OPEN && u.pathname === '/compte');
  const me = await Q.api('GET', '/api/auth/me');
  expect(JSON.stringify(me.json)).toContain(F[14].email);
  await Q.context.close();
  // the provider-independent sign-in and recovery stay (narrowed C26): a password reset e-mail is sent through the real flow
  expect((await anon('POST', '/api/auth/forgot-password', { email: F[15].email }, { ip: nextIp() })).status).toBe(200);
  await expect.poll(async () => (await outbox(F[15].email, OPEN)).length).toBeGreaterThan(0);
  const prod = await prodCall('GET', '/api/auth/franceconnect/status');
  expect(prod.status === 503 || prod.json?.available === false).toBe(true);
});

test('B06 J-1 reminders: OPEN — tomorrow’s appointment is reminded once (idempotent), an appointment of another day is not; PROD — the job is refused', async () => {
  const id = `fab-b06-${crypto.randomUUID().slice(0, 8)}`;
  const tomorrowNoon = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' })); tomorrowNoon.setDate(tomorrowNoon.getDate() + 1);
  const ymd = tomorrowNoon.toISOString().slice(0, 10);
  await db(`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "citizenUserId", "citizenEmailSnapshot", mode, "createdAt", "updatedAt")
    VALUES ($1, 'lab-cdgg-conseil', 'lab-cdgg-svc-demarches', ($2::date + time '10:00') AT TIME ZONE 'Europe/Paris', ($2::date + time '10:30') AT TIME ZONE 'Europe/Paris', 'confirmed', 'Personne FAB', $3, $4, 'IN_PERSON', NOW(), NOW())`, [id, ymd, F[16].id, F[16].email]);
  await db(`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "citizenUserId", "citizenEmailSnapshot", mode, "createdAt", "updatedAt")
    VALUES ($1, 'lab-cdgg-conseil', 'lab-cdgg-svc-demarches', NOW() + interval '5 days', NOW() + interval '5 days 30 minutes', 'confirmed', 'Personne FAB', $2, $3, 'IN_PERSON', NOW(), NOW())`, [`${id}-later`, F[16].id, F[16].email]);
  const r = await cron('rdv-reminder'); expect(r.status).toBe(200);
  expect((await outbox(F[16].email, OPEN)).length).toBe(1);
  expect((await db(`SELECT reminder_sent_at IS NOT NULL AS sent FROM "ProAppointment" WHERE id = $1`, [id]))[0].sent).toBe(true);
  expect((await db(`SELECT reminder_sent_at IS NULL AS unsent FROM "ProAppointment" WHERE id = $1`, [`${id}-later`]))[0].unsent).toBe(true);
  await cron('rdv-reminder');
  expect((await outbox(F[16].email, OPEN)).length, 'idempotent').toBe(1);
  expectClosed(await anon('GET', '/api/cron/rdv-reminder', undefined, { base: PROD, ip: nextIp() }), 'B06 job');
});

test('B07 / N06 video appointments (SANDBOX Jitsi-JWT, not live): OPEN — consent + structure approval + join window give a signed room token; before the window it is refused; PROD — refused', async ({ browser }) => {
  const id = `fab-b07-${crypto.randomUUID().slice(0, 8)}`;
  await db(`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "citizenUserId", "citizenEmailSnapshot", mode, "createdAt", "updatedAt")
    VALUES ($1, 'lab-cdgg-conseil', 'lab-cdgg-svc-demarches', NOW() + interval '5 minutes', NOW() + interval '35 minutes', 'confirmed', 'Personne FAB', $2, $3, 'VIDEO', NOW(), NOW())`, [id, F[17].id, F[17].email]);
  const { P } = await signedIn(browser, F[17], '/compte/rendez-vous');
  expect(code((await P.api('POST', `/api/rdv/appointments/${id}/visio`, { action: 'join' })).json)).toMatch(/VIDEO_NOT_APPROVED|VIDEO_NO_CONSENT/);
  expect((await P.api('POST', `/api/rdv/appointments/${id}/visio`, { action: 'consent' })).status).toBe(200);
  const appr = await bearer('cdgg_p1', 'POST', '/api/pro/appointments/visio', { appointmentId: id, action: 'approve' }, { ip: nextIp() });
  expect(appr.status, JSON.stringify(appr.json)).toBe(200);
  const join = await P.api('POST', `/api/rdv/appointments/${id}/visio`, { action: 'join' });
  expect(join.status, JSON.stringify(join.json)).toBe(200);
  expect(join.json.join).toMatchObject({ sandbox: true, domain: 'visio.lab.example.test', role: 'citizen' });
  const jwt = join.json.join.jwt;
  const [h, b, sig] = jwt.split('.');
  expect(crypto.createHmac('sha256', TOKENS.jitsi).update(`${h}.${b}`).digest('base64url')).toBe(sig);
  const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
  expect(claims.sub).toBe('visio.lab.example.test'); expect(claims.room).toMatch(/^ada[0-9a-f]{40}$/);
  // a later appointment: the room is not open yet
  await db(`UPDATE "ProAppointment" SET "startAt" = NOW() + interval '3 hours', "endAt" = NOW() + interval '3 hours 30 minutes' WHERE id = $1`, [id]);
  expect(code((await P.api('POST', `/api/rdv/appointments/${id}/visio`, { action: 'join' })).json)).toBe('VIDEO_NOT_OPEN_YET');
  await P.context.close();
  expectClosed(await bearer('cdgg_p1', 'POST', '/api/pro/appointments/visio', { appointmentId: id, action: 'approve' }, { base: PROD, ip: nextIp() }), 'B07 approve');
});

test('N02 SMS with consent: OPEN — an SMS option needs an explicit consent and, without a provider, is refused honestly (nothing would be sent); the STOP webhook is not exposed; PROD — refused', async ({ browser }) => {
  const { P } = await signedIn(browser, F[18], '/compte/parametres');
  const noConsent = await P.api('PUT', '/api/citizen/preferences', { channel: 'sms', category: 'service', enabled: true });
  expect([400, 409]).toContain(noConsent.status);
  expect(['CONSENT_REQUIRED', 'NOTIFICATION_OPTION_CLOSED', 'CHANNEL_UNAVAILABLE']).toContain(code(noConsent.json));
  const withConsent = await P.api('PUT', '/api/citizen/preferences', { channel: 'sms', category: 'service', enabled: true, consentGiven: true });
  expect(withConsent.status).toBe(409);
  expect(['CHANNEL_UNAVAILABLE', 'NOTIFICATION_OPTION_CLOSED']).toContain(code(withConsent.json));
  expect((await P.api('GET', '/api/citizen/preferences')).json.preferences['sms.service']).toBe(false);
  await P.context.close();
  expect((await anon('POST', '/api/monitor/sms-inbound/twilio', { Body: 'STOP' }, { base: OPEN, ip: nextIp() })).status, 'STOP webhook closed until configured').toBe(503);
  expectClosed(await prodCall('PUT', '/api/citizen/preferences', { channel: 'sms', category: 'service', enabled: true, consentGiven: true }), 'N02 preferences');
});

test('N04 web push: OPEN — without VAPID keys the device option says it is unavailable and nothing is stored; PROD — refused', async ({ browser }) => {
  const { P } = await signedIn(browser, F[19], '/compte/parametres');
  const st = await P.api('GET', '/api/citizen/push');
  expect(st.status).toBe(200); expect(st.json.available).toBe(false); expect(st.json.publicKey).toBeNull();
  const on = await P.api('PUT', '/api/citizen/preferences', { channel: 'push', category: 'reminder', enabled: true, consentGiven: true });
  expect(on.status).toBe(409); expect(code(on.json)).toBe('CHANNEL_UNAVAILABLE');
  const sub = await P.api('POST', '/api/citizen/push', { subscription: { endpoint: 'https://push.example.test/x', keys: { p256dh: 'x', auth: 'y' } } });
  expect(sub.status).toBeGreaterThanOrEqual(400);
  expect((await db(`SELECT count(*)::int n FROM "PushSubscription" WHERE "userId" = $1`, [F[19].id]).catch(() => [{ n: 0 }]))[0].n).toBe(0);
  await P.context.close();
  expectClosed(await prodCall('GET', '/api/citizen/push'), 'N04 push');
});

test('N05 ICS feeds: OPEN — the structure downloads its appointments as one .ics, without the person’s name; PROD — refused', async () => {
  const id = `fab-n05-${crypto.randomUUID().slice(0, 8)}`;
  await db(`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "citizenUserId", "citizenEmailSnapshot", mode, "createdAt", "updatedAt")
    VALUES ($1, 'lab-cdgg-conseil', 'lab-cdgg-svc-demarches', NOW() + interval '2 days', NOW() + interval '2 days 30 minutes', 'confirmed', 'Nom Secret FAB', $2, $3, 'IN_PERSON', NOW(), NOW())`, [id, F[20].id, F[20].email]);
  const from = new Date().toISOString().slice(0, 10); const to = new Date(Date.now() + 10 * 86400e3).toISOString().slice(0, 10);
  const r = await bearer('cdgg_admin', 'GET', `/api/pro/appointments/ics?from=${from}&to=${to}`, undefined, { ip: nextIp() });
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toContain('text/calendar');
  expect(r.text).toContain('BEGIN:VCALENDAR'); expect(r.text).toContain('BEGIN:VEVENT');
  expect(r.text).not.toContain('Nom Secret FAB'); expect(r.text).not.toContain(F[20].email);
  expect((await bearer('pro_x1', 'GET', `/api/pro/appointments/ics?from=${from}&to=${to}`, undefined, { ip: nextIp() })).text, 'another structure').not.toContain(id);
  expectClosed(await bearer('cdgg_admin', 'GET', `/api/pro/appointments/ics?from=${from}&to=${to}`, undefined, { base: PROD, ip: nextIp() }), 'N05 ics');
});

test('D09 API Particulier (narrowed): OPEN — the person’s information comes from the product’s own forms only (no third-party call, closed age-band vocabulary, nothing stored by the estimate); PROD — refused', async ({ browser }) => {
  const P = await visitor(browser, nextIp, { base: OPEN });
  const page = await P.context.newPage();
  await page.goto(`${OPEN}/diagnostic`);
  const r = await P.api('POST', '/api/diagnostic', { mode: 'SIMULATION_MODE', answers: { ageBand: '25-59', householdSize: 1, income: { salary: 600 }, housing: { status: 'locataire', rent: 500 }, zipCode: '67000' } });
  expect(r.status).toBe(200);
  expect((await P.api('POST', '/api/diagnostic', { mode: 'SIMULATION_MODE', answers: { ageBand: '27 ans' } })).status, 'only the closed vocabulary').toBe(400);
  expect(P.external, 'no request to any third party (API Particulier is not connected)').toEqual([]);
  await P.context.close();
  expectClosed(await prodCall('POST', '/api/diagnostic', { mode: 'SIMULATION_MODE', answers: { ageBand: '25-59' } }), 'D09 diagnostic');
});
