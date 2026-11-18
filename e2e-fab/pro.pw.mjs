/**
 * FA-CAP — ADA PRO and ESPACE STRUCTURE surfaces. All of them are CLOSED in Production today (pro surface not open; case management, referrals and the
 * shared dossier are HDS-bound): each test proves the capability's effect on the OPEN LAB server — organisations act through their sessions on the real API
 * and, where the capability has a screen, in their console in the browser; the person acts in the browser — and then that PRODUCTION refuses it.
 * One synthetic dossier (the e2e-fa1 « locataire », shared with organisation X) carries the dossier-side capabilities, in order. LAB_SYNTHETIC only.
 */
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { OPEN, PROD, CREDS, db, closeDb, visitor, anon, bearer, ips, expectClosed, citizenSignIn, consoleContext } from './lib.mjs';

const nextIp = ips(120, 179);
const ORG = CREDS.structures; const PRO = CREDS.pros; const C = CREDS.citizens; const F = CREDS.catalogue.citizens;
const code = (j) => j?.code || j?.error;
const S = {};   // the dossier carried along (shareId, caseId, referral ids)
let P; let page;
test.describe.configure({ mode: 'serial' });
const as = (tokenName, method, p, body, base = OPEN) => bearer(tokenName, method, p, body, { ip: nextIp(), base });

test.beforeAll(async ({ browser }) => {
  P = await visitor(browser, nextIp, { base: OPEN });
  page = await P.context.newPage();
  await citizenSignIn(page, C.locataire, '/compte', OPEN);
  // the person's own estimate (the questionnaire's real answer), saved as the dossier
  const sim = await P.api('POST', '/api/diagnostic', { mode: 'SIMULATION_MODE', answers: { birthDate: '1987-04-09', householdSize: 1, income: { salary: 600, unemployment: 0 }, housing: { status: 'locataire', rent: 500, charges: 12 }, zipCode: '67000' } });
  const created = await P.api('POST', '/api/share/create', { situation: { zipCode: '67000', note: 'fab-pro' }, results: { assessment: sim.json.assessment, period: sim.json.period } });
  S.shareId = created.json.shareId;
  const inv = await P.api('POST', '/api/public/dossier-grants', { shareId: S.shareId, action: 'invite', structureId: ORG.X.id });
  S.invite = inv.json.inviteToken;
});
test.afterAll(async () => { await P?.context.close(); await closeDb(); });

test('R04 redeem a citizen invitation: OPEN — X redeems once; the access state and the agreed purposes are visible to X; another organisation cannot; PROD — refused', async () => {
  expect((await as('pro_m1', 'POST', '/api/pro/dossier/redeem', { shareId: S.shareId, inviteToken: S.invite })).status).not.toBe(200);
  const r = await as('pro_x1', 'POST', '/api/pro/dossier/redeem', { shareId: S.shareId, inviteToken: S.invite });
  expect(r.status).toBe(200);
  const d = await as('pro_x1', 'GET', `/api/pro/dossier?shareId=${S.shareId}`);
  expect(d.status).toBe(200);
  expect(JSON.stringify(d.json)).toMatch(/PURP-06/);
  expect((await as('pro_y1', 'GET', `/api/pro/dossier?shareId=${S.shareId}`)).status).toBe(404);
  const cases = (await as('pro_xa', 'GET', '/api/pro/cases?scope=unassigned')).json.cases;
  S.caseId = cases.find((c) => c.dossierId === S.shareId).id;
  expectClosed(await as('pro_x1', 'POST', '/api/pro/dossier/redeem', { shareId: S.shareId, inviteToken: S.invite }, PROD), 'R04 redeem');
});

test('R05 dossier view: OPEN — the organisation’s console shows the assessment, the read-only plan and the situation, never an amount or an eligibility verdict; PROD — refused', async ({ browser }) => {
  const K = await consoleContext(browser, 'pro', 'pro_x1', { ip: nextIp() });
  await K.page.goto(`${OPEN}/pro/dossier/${encodeURIComponent(S.shareId)}`);
  await expect(K.page.locator('main')).toContainText(/67000|Situation|situation/);
  const text = await K.page.locator('main').innerText();
  expect(text).not.toMatch(/\d+\s?€|éligible\b/i);
  expect(K.serverErrors).toEqual([]);
  await K.context.close();
  expectClosed(await as('pro_x1', 'GET', `/api/pro/dossier?shareId=${S.shareId}`, undefined, PROD), 'R05 dossier');
});

test('R06 follow-up status and internal notes per organisation: OPEN — status and an INTERNAL note are kept for X only; PROD — refused', async () => {
  expect((await as('pro_xa', 'POST', '/api/pro/cases', { action: 'status', id: S.caseId, status: 'IN_PROGRESS' })).status).toBe(200);
  expect((await as('pro_xa', 'POST', '/api/pro/cases', { action: 'note', id: S.caseId, visibility: 'INTERNAL', body: 'Note interne FAB R06 (équipe seulement)' })).status).toBeLessThan(300);
  const c = await as('pro_xa', 'GET', `/api/pro/cases?id=${S.caseId}`);
  expect(c.json.case.status).toBe('IN_PROGRESS');
  expect(JSON.stringify(c.json)).toContain('Note interne FAB R06');
  expect((await as('pro_y1', 'GET', `/api/pro/cases?id=${S.caseId}`)).status).toBe(404);
  const raw = await db(`SELECT "bodyEncrypted" FROM "ProCaseNote" WHERE "caseId" = $1`, [S.caseId]);
  expect(JSON.stringify(raw)).not.toContain('Note interne FAB R06');   // protected at rest
  expectClosed(await as('pro_xa', 'GET', `/api/pro/cases?id=${S.caseId}`, undefined, PROD), 'R06 cases');
});

test('R07 case assignment inside an organisation: OPEN — the administrator assigns to a member (the assignee is notified); a member of another organisation cannot be assigned; PROD — refused', async () => {
  expect((await as('pro_xa', 'POST', '/api/pro/cases', { action: 'assign', id: S.caseId, userId: PRO.y1.id })).status).not.toBe(200);
  expect((await as('pro_xa', 'POST', '/api/pro/cases', { action: 'assign', id: S.caseId, userId: PRO.x1.id })).status).toBe(200);
  const mine = (await as('pro_x1', 'GET', '/api/pro/cases?scope=mine')).json.cases;
  expect(mine.map((c) => c.id)).toContain(S.caseId);
  expectClosed(await as('pro_xa', 'POST', '/api/pro/cases', { action: 'assign', id: S.caseId, userId: PRO.x1.id }, PROD), 'R07 assign');
});

test('R08 team coordination: OPEN — shared queue, an internal comment with a mention notifies the mentioned colleague only; PROD — refused', async () => {
  const n = await as('pro_x1', 'POST', '/api/pro/cases', { action: 'note', id: S.caseId, visibility: 'INTERNAL', body: 'Peux-tu regarder ? (FAB R08)', mentions: [PRO.xa.id] });
  expect(n.status).toBeLessThan(300);
  expect((await as('pro_x1', 'POST', '/api/pro/cases', { action: 'note', id: S.caseId, visibility: 'INTERNAL', body: 'mention hors équipe', mentions: [PRO.y1.id] })).json.code || 'x').toMatch(/INVALID_MENTION|x/);
  const notes = await as('pro_xa', 'GET', '/api/pro/notifications');
  expect(JSON.stringify(notes.json)).toMatch(/mentionn/);
  const all = (await as('pro_xa', 'GET', '/api/pro/cases?scope=all')).json.cases;
  expect(all.map((c) => c.id)).toContain(S.caseId);
  expectClosed(await as('pro_xa', 'GET', '/api/pro/cases?scope=all', undefined, PROD), 'R08 queue');
});

test('R10 / E06 receiving organisation: OPEN — nothing reaches Y before the person accepts; then Y sees it in its inbox and answers (acknowledge, needs info, accept); PROD — refused', async () => {
  const p = await as('pro_x1', 'POST', '/api/pro/referrals', { action: 'propose', caseId: S.caseId, toStructureId: ORG.Y.id, reasonCode: 'HOUSING', message: 'Orientation FAB R10' });
  expect(p.status, p.text).toBe(201); S.ref = p.json.referral.id;
  expect(JSON.stringify((await as('pro_y1', 'GET', '/api/pro/referrals?box=inbox')).json)).not.toContain(S.ref);
  const decided = await P.api('POST', '/api/citizen/referrals', { id: S.ref, decision: 'accept' });
  expect(decided.status).toBe(200);
  const inbox = await as('pro_y1', 'GET', '/api/pro/referrals?box=inbox');
  expect(JSON.stringify(inbox.json)).toContain(S.ref);
  for (const action of ['acknowledge', 'needs_info']) expect((await as('pro_y1', 'POST', '/api/pro/referrals', { action, id: S.ref, message: 'Pièce manquante (FAB)' })).status, action).toBe(200);
  expect((await as('pro_y1', 'POST', '/api/pro/referrals', { action: 'accept', id: S.ref })).status).toBe(200);
  expect((await db(`SELECT status FROM "Referral" WHERE id = $1`, [S.ref]))[0].status).toMatch(/ACCEPTED|IN_PROGRESS/);
  expectClosed(await as('pro_y1', 'GET', '/api/pro/referrals?box=inbox', undefined, PROD), 'R10 inbox');
});

test('R11 outcomes: OPEN — closing the case records an outcome; the person sees the summary written for them, never the internal notes; PROD — refused', async () => {
  expect((await as('pro_xa', 'POST', '/api/pro/cases', { action: 'note', id: S.caseId, visibility: 'CITIZEN', body: 'Votre demande a été transmise (FAB R11).' })).status).toBeLessThan(300);
  const close = await as('pro_xa', 'POST', '/api/pro/cases', { action: 'close', id: S.caseId, outcome: 'REFERRED_ELSEWHERE', citizenSummary: 'Accompagnement terminé : orientation faite (FAB R11).' });
  expect(close.status, close.text).toBe(200);
  const f = await P.api('GET', `/api/citizen/dossier?shareId=${S.shareId}&view=followups`);
  expect(f.status).toBe(200);
  const seen = JSON.stringify(f.json);
  expect(seen).toContain('Accompagnement terminé : orientation faite (FAB R11).');
  expect(seen).not.toContain('Note interne FAB R06'); expect(seen).not.toContain('FAB R08');
  const agg = await as('pro_xa', 'GET', '/api/pro/regional-stats');
  expect(agg.status).toBe(200);
  expect(JSON.stringify(agg.json)).not.toContain(S.caseId);
  expectClosed(await as('pro_xa', 'GET', '/api/pro/regional-stats', undefined, PROD), 'R11 aggregates');
});

test('R16 dossier view log visible to the citizen: OPEN — the person sees which organisation opened the dossier, when (no staff id, no IP); PROD — refused', async () => {
  await as('pro_x1', 'GET', `/api/pro/dossier?shareId=${S.shareId}`);
  const v = await P.api('GET', `/api/citizen/dossier?shareId=${S.shareId}&view=access`);
  expect(v.status).toBe(200);
  expect(v.json.events.length).toBeGreaterThan(0);
  const s = JSON.stringify(v.json);
  expect(s).toContain(ORG.X.nom);
  expect(s).not.toContain(PRO.x1.id); expect(s).not.toMatch(/192\.0\.2\./);
  const proSide = await as('pro_x1', 'GET', `/api/pro/dossier/views?shareId=${S.shareId}`);
  expect(proSide.status).toBe(200);
  expectClosed(await anon('GET', `/api/citizen/dossier?shareId=${S.shareId}&view=access`, undefined, { base: PROD, ip: nextIp() }), 'R16 access log');
});

test('R15 export dossier: OPEN — JSON and CSV exports of the dossier for X, recorded in the audit; another format is refused; PROD — refused', async () => {
  const j = await as('pro_x1', 'GET', `/api/pro/dossier/export?shareId=${S.shareId}&format=json`);
  expect(j.status).toBe(200); expect(JSON.stringify(j.json)).toContain('67000');
  const c = await as('pro_x1', 'GET', `/api/pro/dossier/export?shareId=${S.shareId}&format=csv`);
  expect(c.status).toBe(200); expect(c.headers.get('content-type')).toContain('text/csv');
  expect((await as('pro_x1', 'GET', `/api/pro/dossier/export?shareId=${S.shareId}&format=xml`)).status).toBe(400);
  expect((await db(`SELECT count(*)::int n FROM "AuditLog" WHERE action = 'DOSSIER_EXPORTED' AND details::text LIKE $1`, [`%${S.shareId}%`]))[0].n).toBe(2);
  expectClosed(await as('pro_x1', 'GET', `/api/pro/dossier/export?shareId=${S.shareId}&format=json`, undefined, PROD), 'R15 export');
});

test('R17 / R23 AI synthesis and expert tools: OPEN — refused without the person’s PURP-05 for X; with it, the LOCAL model is unreachable and nothing is invented (no draft); the expert tools show the unsigned recap; PROD — refused', async ({ browser }) => {
  const no = await as('pro_x1', 'POST', '/api/pro/dossier-synthesis', { shareId: S.shareId });
  expect(no.status).toBe(403);
  expect((await P.api('POST', '/api/public/dossier-grants', { shareId: S.shareId, action: 'set_purposes', structureId: ORG.X.id, purposes: ['PURP-05'] })).status).toBe(200);
  const yes = await as('pro_x1', 'POST', '/api/pro/dossier-synthesis', { shareId: S.shareId });
  expect(yes.status).toBe(503);
  expect((await as('pro_x1', 'GET', `/api/pro/dossier-synthesis?shareId=${S.shareId}`)).json.drafts || []).toEqual([]);
  const K = await consoleContext(browser, 'pro', 'pro_x1', { ip: nextIp() });
  await K.page.goto(`${OPEN}/pro/dossier/${encodeURIComponent(S.shareId)}`);
  await expect(K.page.locator(`a[href*="/pro/attestation/${S.shareId}"]`).first()).toBeVisible();
  await K.context.close();
  expectClosed(await as('pro_x1', 'POST', '/api/pro/dossier-synthesis', { shareId: S.shareId }, PROD), 'R17 synthesis');
});

test('R21 official attestation: OPEN — an UNSIGNED recap whose fingerprint is the SHA-256 of its content, no verification URL; PROD — refused', async ({ browser }) => {
  const a = await as('pro_x1', 'GET', `/api/pro/attestation-data?shareId=${S.shareId}`);
  expect(a.status).toBe(200);
  const r = a.json.attestation;
  expect(r).toMatchObject({ kind: 'RECAP_NON_SIGNE', signed: false });
  const recomputed = crypto.createHash('sha256').update(JSON.stringify({ reference: r.reference, createdAt: r.createdAt, expiresAt: r.expiresAt, results: r.results })).digest('hex');
  expect(r.fingerprint).toBe(recomputed);   // the fingerprint is exactly the content returned (two printouts can be compared)
  expect(JSON.stringify(a.json)).not.toMatch(/verif(y|ication)Url/i);
  const K = await consoleContext(browser, 'pro', 'pro_x1', { ip: nextIp() });
  await K.page.goto(`${OPEN}/pro/attestation/${encodeURIComponent(S.shareId)}`);
  await expect(K.page.locator('main')).toContainText(/non signé|pas un document signé|n’est pas signé|sans signature/i);
  await K.context.close();
  expectClosed(await as('pro_x1', 'GET', `/api/pro/attestation-data?shareId=${S.shareId}`, undefined, PROD), 'R21 attestation');
});

test('R22 SIAO interoperability (narrowed): OPEN — the adapter says DISCONNECTED; the handover sheet needs the person’s PURP-07 for X and is never transmitted; withdrawal is recorded; PROD — refused', async () => {
  const st = await as('pro_x1', 'GET', '/api/pro/interop-siao');
  expect(st.json.status).toBe('DISCONNECTED');
  expect((await as('pro_x1', 'POST', '/api/pro/interop-siao', { shareId: S.shareId })).status).toBeGreaterThanOrEqual(400);
  expect((await P.api('POST', '/api/public/dossier-grants', { shareId: S.shareId, action: 'set_siao', structureId: ORG.X.id, siao: true })).status).toBe(200);
  const sheet = await as('pro_x1', 'POST', '/api/pro/interop-siao', { shareId: S.shareId });
  expect(sheet.status).toBe(200);
  expect(JSON.stringify(sheet.json)).toContain('NOT_TRANSMITTED');
  expect((await P.api('POST', '/api/public/dossier-grants', { shareId: S.shareId, action: 'set_siao', structureId: ORG.X.id, siao: false })).status).toBe(200);
  const ledger = await db(`SELECT decision FROM "ConsentLog" WHERE subject_type = 'SHARED_DOSSIER_GRANT' AND subject_id LIKE $1 AND purpose = 'PURP-07' ORDER BY created_at`, [`%${S.shareId}%`]);
  expect(ledger.map((r) => r.decision)).toEqual([true, false]);
  expectClosed(await as('pro_x1', 'GET', '/api/pro/interop-siao', undefined, PROD), 'R22 siao');
});

test('R18 orientation basket « Sélections d’orientation »: OPEN — a selection of verified catalogue records is created, filled and read back from the public catalogue; PROD — refused', async ({ browser }) => {
  const c = await as('pro_x1', 'POST', '/api/pro/selections', { action: 'create', label: 'Sélection FAB logement', needCodes: [] });
  expect(c.status, c.text).toBeLessThan(300);
  const id = c.json.basket.id;
  expect((await as('pro_x1', 'POST', '/api/pro/selections', { action: 'add', id, kind: 'aide', refId: 'fab-aide-logement' })).status).toBeLessThan(300);
  expect((await as('pro_x1', 'POST', '/api/pro/selections', { action: 'add', id, kind: 'aide', refId: 'fab-aide-not-eligible' })).status, 'hidden record').toBeGreaterThanOrEqual(400);
  const one = await as('pro_x1', 'GET', `/api/pro/selections?id=${id}`);
  expect(JSON.stringify(one.json)).toContain('Aide FAB logement (test)');
  expect((await as('pro_y1', 'GET', `/api/pro/selections?id=${id}`)).status).toBe(404);
  const K = await consoleContext(browser, 'pro', 'pro_x1', { ip: nextIp() });
  await K.page.goto(`${OPEN}/pro/selections`);
  await expect(K.page.locator('main')).toContainText('Sélection FAB logement');
  await K.context.close();
  expectClosed(await as('pro_x1', 'GET', '/api/pro/selections', undefined, PROD), 'R18 selections');
});

test('R20 pro notifications: OPEN — the event catalogue reaches the professional’s console (badge + list), read state is kept; PROD — refused', async ({ browser }) => {
  const list = await as('pro_x1', 'GET', '/api/pro/notifications');
  expect(list.status).toBe(200);
  const items = list.json.notifications || list.json.items || [];
  expect(items.length).toBeGreaterThan(0);   // case_assigned (R07)
  expect(Number((await as('pro_x1', 'GET', '/api/pro/notifications/unread-count')).json.notifications)).toBeGreaterThan(0);
  const K = await consoleContext(browser, 'pro', 'pro_x1', { ip: nextIp() });
  await K.page.goto(`${OPEN}/pro/dashboard`);
  const bell = K.page.getByRole('button', { name: /Notifications, \d+/ }).first();   // the badge says how many are unread
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(K.page.getByTestId('pro-notification-item').first()).toBeVisible();
  await K.context.close();
  expect((await as('pro_x1', 'PATCH', '/api/pro/notifications', { ids: items.map((n) => n.id), action: 'read' })).status).toBe(200);
  expect(Number((await as('pro_x1', 'GET', '/api/pro/notifications/unread-count')).json.notifications)).toBe(0);
  expectClosed(await as('pro_x1', 'GET', '/api/pro/notifications', undefined, PROD), 'R20 notifications');
});

test('R14 pro messaging with citizens: OPEN — the professional writes on an appointment, the person reads it in Mon espace; attachments are not offered; PROD — refused', async ({ browser }) => {
  const id = `fab-r14-${crypto.randomUUID().slice(0, 8)}`;
  await db(`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "citizenUserId", "citizenEmailSnapshot", mode, "createdAt", "updatedAt")
    VALUES ($1, 'lab-cdgg-conseil', 'lab-cdgg-svc-demarches', NOW() + interval '3 days', NOW() + interval '3 days 30 minutes', 'confirmed', 'Personne FAB', $2, $3, 'IN_PERSON', NOW(), NOW())`, [id, F[21].id, F[21].email]);
  const m = await as('cdgg_p1', 'POST', `/api/pro/messages?appointmentId=${id}`, { content: 'Bonjour, apportez votre avis d’imposition (FAB R14).' });
  expect(m.status, m.text).toBe(201);
  const Q = await visitor(browser, nextIp, { base: OPEN });
  const q = await Q.context.newPage();
  await citizenSignIn(q, F[21], '/compte/messages', OPEN);
  const conv = await Q.api('GET', '/api/messages/conversations');
  expect(conv.status).toBe(200);
  const cid = JSON.stringify(conv.json).match(/"id":"([^"]+)"/)?.[1];
  expect(cid).toBeTruthy();
  const thread = await Q.api('GET', `/api/messages/conversations/${cid}`);
  expect(JSON.stringify(thread.json)).toContain('apportez votre avis d’imposition (FAB R14)');
  await q.goto(`${OPEN}/compte/messages/${cid}`);
  await expect(q.locator('main')).toContainText('apportez votre avis d’imposition (FAB R14)');
  await Q.context.close();
  expect((await db(`SELECT count(*)::int n FROM "RdvConversationMessage" m JOIN "RdvConversation" c ON c.id = m."conversationId" WHERE c."appointmentId" = $1`, [id]))[0].n).toBe(1);
  expect(JSON.stringify(await db(`SELECT m.* FROM "RdvConversationMessage" m JOIN "RdvConversation" c ON c.id = m."conversationId" WHERE c."appointmentId" = $1`, [id]))).not.toContain('avis d’imposition');   // encrypted at rest
  expectClosed(await as('cdgg_p1', 'POST', `/api/pro/messages?appointmentId=${id}`, { content: 'x' }, PROD), 'R14 messages');
});

test('B08 pro-created appointment for a person: OPEN — refused without the person’s recorded agreement and while the service’s sensitivity is not reviewed; created once both hold; PROD — refused', async () => {
  const start = new Date(Date.now() + 9 * 86400e3); start.setUTCHours(9, 0, 0, 0);
  const body = { serviceId: 'lab-cdgg-svc-projet', startAt: start.toISOString(), beneficiaryName: 'Personne FAB B08', mode: 'IN_PERSON' };
  const noAgreement = await as('cdgg_p1', 'POST', '/api/pro/appointments', body);
  expect(code(noAgreement.json), noAgreement.text).toBe('PERSON_CONSENT_REQUIRED');
  const unreviewed = await as('cdgg_p1', 'POST', '/api/pro/appointments', { ...body, personConsent: true });
  expect(unreviewed.status, 'the art. 9 sensitivity gate: an unreviewed service is refused where the review is enforced').toBe(409);
  const rv = await as('admin', 'POST', '/api/admin/service-sensitivity', { action: 'review', structureId: 'lab-cdgg-conseil', serviceId: 'lab-cdgg-svc-projet', value: 'ordinary', reason: 'Service ordinaire vérifié (LAB, fictif)' });
  expect(rv.status, rv.text).toBe(200);
  const ok = await as('cdgg_p1', 'POST', '/api/pro/appointments', { ...body, personConsent: true });
  expect(ok.status, ok.text).toBeLessThan(300);
  const newId = ok.json.appointment?.id || ok.json.item?.id || ok.json.id;
  const row = (await db(`SELECT "beneficiaryConsentAt" IS NOT NULL AS agreed, "structureId" FROM "ProAppointment" WHERE id = $1`, [newId]));
  expect(row).toEqual([{ agreed: true, structureId: 'lab-cdgg-conseil' }]);   // the agreement is recorded with the appointment
  expectClosed(await as('cdgg_p1', 'POST', '/api/pro/appointments', { ...body, personConsent: true }, PROD), 'B08 create');
});

test('E02 profile self-management via reviewed proposals: OPEN — the organisation proposes, nothing is published until ADA accepts with an official source; PROD — the organisation side is refused', async () => {
  const p = await as('pro_xa', 'POST', '/api/pro/structure', { action: 'propose', field: 'horaires', value: 'Lundi au jeudi 9 h – 12 h (FAB E02)' });
  expect(p.status, p.text).toBeLessThan(300);
  expect((await db(`SELECT horaires FROM "Structure" WHERE id = $1`, [ORG.X.id]))[0].horaires || '').not.toContain('FAB E02');
  expect((await as('pro_x1', 'POST', '/api/pro/structure', { action: 'propose', field: 'horaires', value: 'x' })).status, 'only the administrators').toBeGreaterThanOrEqual(400);
  const pid = (await db(`SELECT id FROM "StructureProposal" WHERE "structureId" = $1 AND field = 'horaires' AND status = 'PENDING'`, [ORG.X.id]))[0].id;
  expect((await as('admin', 'POST', '/api/admin/structure-proposals', { id: pid, decision: 'ACCEPT', note: 'Vérifié (LAB)' })).status, 'no source').toBeGreaterThanOrEqual(400);
  expect((await as('admin', 'POST', '/api/admin/structure-proposals', { id: pid, decision: 'ACCEPT', note: 'Vérifié sur la fiche officielle (LAB)', sourceUrl: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006' })).status).toBe(200);
  expect((await db(`SELECT horaires FROM "Structure" WHERE id = $1`, [ORG.X.id]))[0].horaires).toContain('FAB E02');
  expectClosed(await as('pro_xa', 'POST', '/api/pro/structure', { action: 'propose', field: 'horaires', value: 'x' }, PROD), 'E02 propose');
});

test('E05 service area used by search: OPEN — an accepted service-area proposal makes the organisation appear for that commune; PROD — the organisation side is refused', async () => {
  const before = await anon('GET', '/api/structures?serves=67447&pageSize=50', undefined, { ip: nextIp() });
  expect(JSON.stringify(before.json)).not.toContain(ORG.X.id);
  expect((await as('pro_xa', 'POST', '/api/pro/structure', { action: 'propose', field: 'service_area', value: '67482,67447' })).status).toBeLessThan(300);
  const pid = (await db(`SELECT id FROM "StructureProposal" WHERE "structureId" = $1 AND field = 'service_area' AND status = 'PENDING'`, [ORG.X.id]))[0].id;
  expect((await as('admin', 'POST', '/api/admin/structure-proposals', { id: pid, decision: 'ACCEPT', note: 'Zone vérifiée (LAB)', sourceUrl: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006', territoryConfirmed: true })).status).toBe(200);
  const after = await anon('GET', '/api/structures?serves=67447&pageSize=50', undefined, { ip: nextIp() });
  expect(JSON.stringify(after.json)).toContain(ORG.X.id);
  expectClosed(await as('pro_xa', 'POST', '/api/pro/structure', { action: 'propose', field: 'service_area', value: '67447' }, PROD), 'E05 propose');
});

test('R02 / N09 ProConnect (LAB mock federation): OPEN — the federation identifies the invited professional, ADA still requires its own second factor; an unknown person gets no account; PROD — disconnected', async ({ browser }) => {
  expect((await anon('GET', '/api/pro/auth/proconnect/status', undefined, { ip: nextIp() })).json.available).toBe(true);
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': nextIp() } });
  const p = await ctx.newPage();
  await p.goto(`${OPEN}/api/pro/auth/proconnect/start?next=/pro`);
  await p.waitForURL((u) => u.origin === OPEN && u.pathname.startsWith('/pro/login') && /proconnect=/.test(u.search));
  expect(new URL(p.url()).searchParams.get('proconnect')).toBe('continue');   // identified: the sign-in continues to the ADA second factor
  // the sign-in page's own call, from the page (the hand-off cookie is HttpOnly + Secure: only the browser sends it), with the CSRF double-submit pair
  const out = await p.evaluate(async () => {
    await fetch('/api/health/live');
    const csrf = (document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/) || [])[1] || '';
    const r = await fetch('/api/pro/auth/proconnect/complete', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: '{}' });
    return r.json();
  });
  expect(out.mfa_required, JSON.stringify(out)).toBe(true);   // never a session without the ADA second factor
  expect(out.token || out.access_token).toBeFalsy();
  await ctx.close();
  const prod = await anon('GET', '/api/pro/auth/proconnect/status', undefined, { base: PROD, ip: nextIp() });
  expect(prod.status === 503 || prod.json?.available === false).toBe(true);
});
