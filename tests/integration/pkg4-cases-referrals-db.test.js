/**
 * PKG-4 on REAL PostgreSQL (migration 0022), through the real handlers, with four synthetic organizations:
 *   A (verified, sender) — admin, pro1, pro2 · B (verified, receiver) · D (verified, receiver that declines) · C (NOT verified)
 *   - sessions: a disabled account loses access at once; refresh re-checks the database; no SUPERADMIN escalation from a structure (D1 D2 D3)
 *   - cases: queue from the citizen's grant only; assignment / handover / concurrency; an assigned case (and its dossier) is closed to colleagues; internal vs citizen notes;
 *     departure hands cases over; another organization sees nothing (IDOR: 404)
 *   - referrals: only to verified organizations; nothing shared before the citizen authorizes; receiver inbox, acknowledge, accept (case), needs info / reply, complete
 *     with outcome visible to the citizen and the sender, decline revokes the access it created, timeouts notify then expire, idempotency, concurrent accepts
 *   - database rules: controlled vocabularies, append-only histories, "sent requires the citizen's decision and a grant"
 * Synthetic data only; the mailer is the in-memory 'test' provider. Skipped without DATABASE_URL.
 */
import crypto from 'node:crypto';
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));   // KV-backed quota = infrastructure, not under test
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const S = { A: `p4-A-${TS}`, B: `p4-B-${TS}`, C: `p4-C-${TS}`, D: `p4-D-${TS}` };
const P = { admin: { id: `p4-adm-${TS}`, st: S.A, role: 'STRUCTURE_ADMIN' }, pro1: { id: `p4-p1-${TS}`, st: S.A, role: 'PRO' }, pro2: { id: `p4-p2-${TS}`, st: S.A, role: 'PRO' },
  b: { id: `p4-b-${TS}`, st: S.B, role: 'PRO' }, c: { id: `p4-c-${TS}`, st: S.C, role: 'PRO' }, d: { id: `p4-d-${TS}`, st: S.D, role: 'PRO' } };
const CIT = { id: `p4-cit-${TS}`, email: `p4-cit-${TS}@example.test` };
const DOSSIER = `p4-dos-${TS}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('PKG-4 cases and referrals (real DB, four organizations)', () => {
  let db, auth, userAuth, H, privacy;
  const tok = (p) => auth.signProToken({ id: p.id, email: `${p.id}@example.test`, structureId: p.st, role: p.role });
  const pro = async (h, p, { method = 'GET', query = {}, body, url = '/api/pro/x' } = {}) => { const r = mk(); await h({ method, url, query, body, headers: { host: 'localhost', authorization: `Bearer ${tok(p)}` } }, r); return r; };
  const cit = async (h, { method = 'GET', query = {}, body } = {}) => { const r = mk(); const c = userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: CIT.id, email: CIT.email })).split(';')[0];
    await h({ method, url: '/api/x', query, body, headers: { host: 'localhost', cookie: c } }, r); return r; };
  const cases = (p, query) => pro(H.cases, p, { query });
  const caseAct = (p, body) => pro(H.cases, p, { method: 'POST', body });
  const ref = (p, body) => pro(H.refs, p, { method: 'POST', body });
  const dossierGet = (p) => pro(H.dossier, p, { query: { shareId: DOSSIER }, url: `/api/pro/dossier?shareId=${DOSSIER}` });
  const grantActive = async (st) => (await db.execute(sql`SELECT count(*)::int n FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${DOSSIER} AND "structureId" = ${st} AND "revokedAt" IS NULL`)).rows[0].n;
  let caseId;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js'); privacy = await import('../../api/_services/privacy.js');
    H = { cases: (await import('../../api/_handlers/pro/cases.js')).default, refs: (await import('../../api/_handlers/pro/referrals.js')).default, dossier: (await import('../../api/_handlers/pro/dossier.js')).default,
      team: (await import('../../api/_handlers/pro/team.js')).default, invite: (await import('../../api/_handlers/pro/invite.js')).default, refresh: (await import('../../api/_handlers/pro/auth/refresh.js')).default,
      citRefs: (await import('../../api/_handlers/citizen/referrals.js')).default, citDossier: (await import('../../api/_handlers/citizen/dossier.js')).default, cron: (await import('../../api/_handlers/cron/referral-timeouts.js')).default };
    for (const [id, verified] of [[S.A, true], [S.B, true], [S.C, false], [S.D, true]]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${id}, ${'Org ' + id.split('-')[1]}, ${id}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', ${verified ? 'VERIFIED' : 'UNVERIFIED'}, NOW(), NOW())`);
    }
    for (const p of Object.values(P)) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${p.id}, ${p.id + '@example.test'}, 'x', ${p.role}, 'active', ${p.st}, false, NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${CIT.id}, ${CIT.email}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId") VALUES (${DOSSIER}, NOW() + interval '30 days', '{}'::jsonb, '{}'::jsonb, 0, ${'h' + TS}, ${'t' + TS}, 'GUEST_SHARE', ${CIT.id})`);
    await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", "grantedVia") VALUES (${'g-' + TS}, ${DOSSIER}, ${S.A}, ${P.pro1.id}, 'invite')`);
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${DOSSIER}`);
    await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" IN (${S.A}, ${S.B}, ${S.C}, ${S.D})`);
    await db.execute(sql`DELETE FROM "ProAuditLog" WHERE "structureId" IN (${S.A}, ${S.B}, ${S.C}, ${S.D})`).catch(() => {});
    await db.execute(sql`DELETE FROM "Invitation" WHERE "structureId" = ${S.A}`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${S.A}, ${S.B}, ${S.C}, ${S.D})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${S.A}, ${S.B}, ${S.C}, ${S.D})`);
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id = ${CIT.id}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${CIT.id}`);
  });

  it('sessions: no SUPERADMIN from a structure; a refresh and every request re-check the database', async () => {
    expect((await pro(H.team, P.admin, { method: 'PATCH', body: { targetUserId: P.pro2.id, role: 'SUPERADMIN' } })).statusCode).toBe(400);
    expect((await pro(H.invite, P.admin, { method: 'POST', body: { email: `inv-${TS}@example.test`, role: 'SUPERADMIN' } })).statusCode).toBe(400);
    expect((await pro(H.invite, P.admin, { method: 'POST', body: { email: `inv2-${TS}@example.test`, role: 'GOD' } })).statusCode).toBe(400);
    expect((await pro(H.team, P.pro1, { method: 'PATCH', body: { targetUserId: P.pro2.id, role: 'STRUCTURE_ADMIN' } })).statusCode, 'a PRO cannot change roles').toBe(403);
    const forged = { ...P.pro1, role: 'STRUCTURE_ADMIN' };   // a token claiming a role the database does not hold
    expect((await pro(H.team, forged, { method: 'PATCH', body: { targetUserId: P.pro2.id, role: 'PRO' } })).statusCode, 'the database role wins').toBe(403);
    await db.execute(sql`UPDATE "ProUser" SET status = 'disabled' WHERE id = ${P.c.id}`);
    expect((await cases(P.c, {})).statusCode, 'disabled = no access at once').toBe(403);
    const r = mk(); await H.refresh({ method: 'POST', url: '/api/pro/auth/refresh', headers: { host: 'localhost', authorization: `Bearer ${tok(P.c)}` } }, r);
    expect(r.statusCode, 'no refresh for a disabled account').toBe(401);
    await db.execute(sql`UPDATE "ProUser" SET status = 'active' WHERE id = ${P.c.id}`);
  });

  it('the queue comes from the citizen grant only; another organization sees nothing (IDOR = 404)', async () => {
    const q = await cases(P.pro1, { scope: 'unassigned' });
    expect(q.statusCode).toBe(200);
    const mine = q.body.cases.filter((c) => c.dossierId === DOSSIER); expect(mine.length).toBe(1); caseId = mine[0].id;
    expect(JSON.stringify(q.body)).not.toMatch(/situation|results|ownerCitizenId/);
    expect((await cases(P.b, { scope: 'all' })).body.cases.filter((c) => c.dossierId === DOSSIER)).toEqual([]);
    expect((await cases(P.b, { id: caseId })).statusCode).toBe(404);
    expect((await caseAct(P.b, { action: 'assign', id: caseId, userId: P.b.id })).statusCode).toBe(404);
    expect((await dossierGet(P.b)).statusCode).toBe(404);
  });

  it('assignment: one winner when two take the case at once; an assigned case and its dossier are closed to colleagues; admins reassign; history is kept', async () => {
    const [a, b] = await Promise.all([caseAct(P.pro1, { action: 'assign', id: caseId, userId: P.pro1.id }), caseAct(P.pro2, { action: 'assign', id: caseId, userId: P.pro2.id })]);
    const codes = [a.statusCode, b.statusCode].sort(); expect(codes, JSON.stringify([a.body, b.body])).toEqual([200, expect.any(Number)]);
    expect([404, 409]).toContain(codes[1]);
    const [{ assignee }] = (await db.execute(sql`SELECT "assigneeProUserId" AS assignee FROM "ProCase" WHERE id = ${caseId}`)).rows;
    const holder = assignee === P.pro1.id ? P.pro1 : P.pro2; const other = holder === P.pro1 ? P.pro2 : P.pro1;
    expect((await cases(other, { id: caseId })).statusCode).toBe(404);
    expect((await dossierGet(other)).statusCode, 'the dossier itself follows the assignment').toBe(404);
    expect((await dossierGet(holder)).statusCode).toBe(200);
    expect((await dossierGet(P.admin)).statusCode).toBe(200);
    expect((await caseAct(other, { action: 'assign', id: caseId, userId: other.id })).statusCode).toBe(404);
    const re = await caseAct(P.admin, { action: 'assign', id: caseId, userId: P.pro1.id });
    expect(re.statusCode, JSON.stringify(re.body)).toBe(200);
    expect((await caseAct(P.admin, { action: 'assign', id: caseId, userId: P.b.id })).body.error, 'only members of the organization').toBe('INVALID_ASSIGNEE');
    const kinds = (await db.execute(sql`SELECT kind FROM "ProCaseEvent" WHERE "caseId" = ${caseId} ORDER BY "createdAt"`)).rows.map((x) => x.kind);
    expect(kinds[0]).toBe('OPENED'); expect(kinds).toContain('ASSIGNED');
  });

  it('notes: internal notes stay in the organization; the person sees only notes written for them; mentions only of members', async () => {
    expect((await caseAct(P.pro1, { action: 'note', id: caseId, visibility: 'INTERNAL', body: `interne-${TS}`, mentions: [P.admin.id] })).statusCode).toBe(201);
    expect((await caseAct(P.pro1, { action: 'note', id: caseId, visibility: 'CITIZEN', body: `pour-vous-${TS}` })).statusCode).toBe(201);
    expect((await caseAct(P.pro1, { action: 'note', id: caseId, visibility: 'INTERNAL', body: 'x y', mentions: [P.b.id] })).body.error).toBe('INVALID_MENTION');
    const raw = (await db.execute(sql`SELECT "bodyEncrypted" b FROM "ProCaseNote" WHERE "caseId" = ${caseId}`)).rows.map((x) => x.b).join('');
    expect(raw).not.toContain(`interne-${TS}`);   // encrypted at rest
    const fu = await cit(H.citDossier, { query: { shareId: DOSSIER, view: 'followups' } });
    expect(fu.statusCode).toBe(200); const txt = JSON.stringify(fu.body);
    expect(txt).toContain(`pour-vous-${TS}`); expect(txt).not.toContain(`interne-${TS}`);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "ProNotification" WHERE "userId" = ${P.admin.id} AND type = 'case_mention'`)).rows[0].n).toBe(1);
  });

  it('referrals: only to verified organizations; nothing is shared before the citizen authorizes; idempotent', async () => {
    expect((await ref(P.pro1, { action: 'propose', caseId, toStructureId: S.C, reasonCode: 'HOUSING' })).body.error, 'unverified receiver').toBe('INVALID_RECEIVER');
    expect((await ref(P.pro1, { action: 'propose', caseId, toStructureId: S.A, reasonCode: 'HOUSING' })).body.error, 'not to itself').toBe('INVALID_RECEIVER');
    expect((await ref(P.pro2, { action: 'propose', caseId, toStructureId: S.B, reasonCode: 'HOUSING' })).statusCode, 'a colleague of the assignee').toBe(404);
    const key = crypto.randomUUID();
    const p = await ref(P.pro1, { action: 'propose', caseId, toStructureId: S.B, reasonCode: 'HOUSING', message: `logement-${TS}`, idempotencyKey: key });
    expect(p.statusCode, JSON.stringify(p.body)).toBe(201);
    expect((await ref(P.pro1, { action: 'propose', caseId, toStructureId: S.B, reasonCode: 'HOUSING', idempotencyKey: key })).body.referral.id).toBe(p.body.referral.id);
    expect((await ref(P.pro1, { action: 'propose', caseId, toStructureId: S.B, reasonCode: 'HOUSING' })).body.error, 'one live referral per receiver').toBe('ALREADY_REFERRED');
    expect(await grantActive(S.B)).toBe(0);
    expect((await pro(H.refs, P.b, { query: { box: 'inbox' } })).body.referrals).toEqual([]);
    expect((await pro(H.refs, P.b, { query: { id: p.body.referral.id } })).statusCode).toBe(404);
    // R14: before the citizen authorizes, the referral is not the receiver's at all — the same 404 as an unknown one (it used to answer 409, confirming it exists)
    expect((await ref(P.b, { action: 'accept', id: p.body.referral.id })).statusCode, 'the receiver cannot act before the citizen').toBe(404);
    const list = await cit(H.citRefs); expect(list.body.referrals.find((r) => r.id === p.body.referral.id)).toMatchObject({ status: 'PENDING_CITIZEN', message: `logement-${TS}` });
  });

  it('closed loop: citizen authorizes -> receiver inbox, acknowledge, accept (concurrently once) -> complete with outcome seen by the citizen and the sender -> close', async () => {
    const id = (await cit(H.citRefs)).body.referrals.find((r) => r.status === 'PENDING_CITIZEN').id;
    const [x, y] = await Promise.all([cit(H.citRefs, { method: 'POST', body: { id, decision: 'accept' } }), cit(H.citRefs, { method: 'POST', body: { id, decision: 'accept' } })]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    expect(await grantActive(S.B)).toBe(1);
    const inbox = await pro(H.refs, P.b, { query: { box: 'inbox' } }); expect(inbox.body.referrals.map((r) => r.id)).toContain(id);
    const one = await pro(H.refs, P.b, { query: { id } }); expect(one.body.side).toBe('RECEIVER'); expect(one.body.referral.message).toBe(`logement-${TS}`);
    expect(JSON.stringify(one.body)).not.toContain(`interne-${TS}`);
    expect((await dossierGet(P.b)).statusCode, 'the receiver reads the dossier through ITS grant').toBe(200);
    expect((await cases(P.b, { id: caseId })).statusCode, 'never the sender\'s case').toBe(404);
    expect((await ref(P.b, { action: 'acknowledge', id })).statusCode).toBe(200);
    const [a1, a2] = await Promise.all([ref(P.b, { action: 'accept', id }), ref(P.b, { action: 'accept', id })]);
    expect([a1.statusCode, a2.statusCode].sort()).toEqual([200, 409]);
    expect((await ref(P.pro1, { action: 'accept', id })).body.error, 'the sender cannot act for the receiver').toBe('INVALID_ACTION');
    expect((await ref(P.b, { action: 'complete', id, outcome: 'NOT_A_CODE' })).body.error).toBe('INVALID_OUTCOME');
    expect((await ref(P.b, { action: 'complete', id, outcome: 'APPLICATION_FILED', citizenSummary: `dossier-depose-${TS}` })).statusCode).toBe(200);
    expect((await cit(H.citRefs)).body.referrals.find((r) => r.id === id)).toMatchObject({ status: 'COMPLETED', outcome: 'APPLICATION_FILED', outcomeSummary: `dossier-depose-${TS}` });
    const sender = await pro(H.refs, P.pro1, { query: { id } }); expect(sender.body.referral.outcome).toBe('APPLICATION_FILED');
    expect((await ref(P.pro1, { action: 'close', id })).statusCode).toBe(200);
    const trail = (await db.execute(sql`SELECT "toStatus" FROM "ReferralEvent" WHERE "referralId" = ${id} ORDER BY "createdAt"`)).rows.map((r) => r.toStatus);
    expect(trail).toEqual(['PENDING_CITIZEN', 'SENT', 'ACKNOWLEDGED', 'ACCEPTED', 'COMPLETED', 'CLOSED']);
  });

  it('needs info / reply; a decline revokes the access the referral created; a refusal by the citizen shares nothing', async () => {
    const p = await ref(P.pro1, { action: 'propose', caseId, toStructureId: S.D, reasonCode: 'EMPLOYMENT' });
    await cit(H.citRefs, { method: 'POST', body: { id: p.body.referral.id, decision: 'accept' } });
    expect(await grantActive(S.D)).toBe(1);
    const mailer = await import('../../api/_utils/mailer.js'); mailer.__clearTestOutbox();
    expect((await ref(P.d, { action: 'needs_info', id: p.body.referral.id, message: 'Quel secteur ?' })).statusCode).toBe(200);
    // R12 (R10): the person is told, without the question itself
    const toCit = () => mailer.__getTestOutbox().filter((m) => m.to === CIT.email);
    expect(toCit().map((m) => m.subject)).toEqual(['Votre orientation est en cours d’examen']); expect(toCit()[0].text).not.toContain('Quel secteur');
    expect((await ref(P.pro1, { action: 'reply', id: p.body.referral.id, message: 'Logistique, temps partiel.' })).statusCode).toBe(200);
    expect((await ref(P.d, { action: 'decline', id: p.body.referral.id, responseCode: 'NO_CAPACITY' })).statusCode).toBe(200);
    expect(toCit().map((m) => m.subject)).toContain('Votre orientation n’a pas été acceptée');
    expect(await grantActive(S.D), 'access created by the referral is revoked').toBe(0);
    expect((await dossierGet(P.d)).statusCode).toBe(404);
    // citizen refusal
    await db.execute(sql`UPDATE "Referral" SET status = 'CLOSED', "closedAt" = NOW() WHERE id = ${p.body.referral.id}`);
    const q = await ref(P.pro1, { action: 'propose', caseId, toStructureId: S.D, reasonCode: 'LEGAL' });
    expect((await cit(H.citRefs, { method: 'POST', body: { id: q.body.referral.id, decision: 'refuse' } })).body.referral.status).toBe('CANCELLED');
    expect(await grantActive(S.D)).toBe(0);
    // R12 (E06): the case is assigned to pro1 — a colleague cannot cancel its referral; the assignee and the administrator can
    const w = await ref(P.pro1, { action: 'propose', caseId, toStructureId: S.D, reasonCode: 'LEGAL' });
    expect((await ref(P.pro2, { action: 'cancel', id: w.body.referral.id })).statusCode, 'a colleague of the assignee').toBe(409);
    expect((await db.execute(sql`SELECT status FROM "Referral" WHERE id = ${w.body.referral.id}`)).rows[0].status).toBe('PENDING_CITIZEN');
    expect((await ref(P.pro1, { action: 'cancel', id: w.body.referral.id })).statusCode).toBe(200);
  });

  it('timeouts: the sender is told once when overdue; 14 days later the referral expires and the receiver loses access', async () => {
    const p = await ref(P.pro1, { action: 'propose', caseId, toStructureId: S.D, reasonCode: 'HEALTH' });
    await cit(H.citRefs, { method: 'POST', body: { id: p.body.referral.id, decision: 'accept' } });
    const run = async () => { const r = mk(); await H.cron({ method: 'GET', url: '/api/cron/referral-timeouts', query: {}, headers: { 'x-cron-secret': process.env.CRON_SECRET } }, r); return r.body; };
    await db.execute(sql`UPDATE "Referral" SET "dueAt" = NOW() - interval '1 day' WHERE id = ${p.body.referral.id}`);
    expect((await run()).overdueNotified).toBeGreaterThanOrEqual(1);
    expect((await run()).overdueNotified, 'once').toBe(0);
    await db.execute(sql`UPDATE "Referral" SET "dueAt" = NOW() - interval '15 days' WHERE id = ${p.body.referral.id}`);
    expect((await run()).expired).toBeGreaterThanOrEqual(1);
    expect((await db.execute(sql`SELECT status FROM "Referral" WHERE id = ${p.body.referral.id}`)).rows[0].status).toBe('EXPIRED');
    expect(await grantActive(S.D)).toBe(0);
  });

  it('R40: a referral past its expiry closes the receiver\'s access without waiting for the cron', async () => {
    const share = await import('../../api/_utils/share-access.js');
    await db.execute(sql`UPDATE "Referral" SET status = 'CANCELLED', "closedAt" = NOW() WHERE "toStructureId" = ${S.D} AND status NOT IN ('EXPIRED', 'CANCELLED', 'CLOSED', 'COMPLETED', 'DECLINED')`);
    const p = await ref(P.pro1, { action: 'propose', caseId, toStructureId: S.D, reasonCode: 'HEALTH' });
    await cit(H.citRefs, { method: 'POST', body: { id: p.body.referral.id, decision: 'accept' } });
    const ctxD = { structureId: S.D, userId: P.d.id, role: 'PRO' };
    expect((await dossierGet(P.d)).statusCode, 'open while the referral is live').toBe(200);
    const inQueue = async () => ((await cases(P.d, { scope: 'unassigned' })).body.cases || []).filter((c) => c.dossierId === DOSSIER).length;
    expect(await inQueue(), 'in the receiver queue while live').toBe(1);
    await db.execute(sql`UPDATE "Referral" SET "dueAt" = NOW() - interval '13 days' WHERE id = ${p.body.referral.id}`);
    expect(await share.findActiveGrant(DOSSIER, ctxD), 'overdue but not yet expired').not.toBeNull();
    await db.execute(sql`UPDATE "Referral" SET "dueAt" = NOW() - interval '15 days' WHERE id = ${p.body.referral.id}`);
    expect(await grantActive(S.D), 'no cron ran: the row is not revoked yet').toBe(1);
    expect(await share.findActiveGrant(DOSSIER, ctxD)).toBeNull();
    expect((await db.execute(sql`SELECT 1 AS ok WHERE ${share.activeGrantExists(DOSSIER, ctxD)}`)).rows).toHaveLength(0);
    expect((await dossierGet(P.d)).statusCode).toBe(404);
    expect(await inQueue(), 'not in the receiver queue').toBe(0);
    expect((await dossierGet(P.pro1)).statusCode, 'the sender keeps its own invite grant').toBe(200);
    await db.execute(sql`UPDATE "Referral" SET "dueAt" = NOW() + interval '1 day' WHERE id = ${p.body.referral.id}`);
    expect(await share.findActiveGrant(DOSSIER, ctxD), 'the rule reads the due date, nothing was written').not.toBeNull();
    expect((await ref(P.pro1, { action: 'cancel', id: p.body.referral.id })).statusCode).toBe(200);
  });

  it('R39: a notice that could not be stored is retried on the next run (bounded), never sent twice; two runs at once → one notice', async () => {
    const { runReferralTimeouts, NOTICE_MAX_ATTEMPTS } = await import('../../api/_services/referrals.js');
    const freeReceiver = () => db.execute(sql`UPDATE "Referral" SET status = 'CANCELLED', "closedAt" = NOW() WHERE "toStructureId" = ${S.D} AND status NOT IN ('EXPIRED', 'CANCELLED', 'CLOSED', 'COMPLETED', 'DECLINED')`);
    await freeReceiver();
    const p = await ref(P.pro1, { action: 'propose', caseId, toStructureId: S.D, reasonCode: 'LEGAL' });
    await cit(H.citRefs, { method: 'POST', body: { id: p.body.referral.id, decision: 'accept' } });
    const id = p.body.referral.id;
    await db.execute(sql`UPDATE "Referral" SET "dueAt" = NOW() - interval '1 day', "overdueNotifiedAt" = NULL WHERE id = ${id}`);
    const failing = async () => ({ inApp: 0, email: { PROVIDER_ACCEPTED: 0, TEST_RECORDED: 0, NOT_DELIVERED: 1, OFF_BY_PREFERENCE: 0, NOT_EMAILABLE: 0, FAILED: 0 } });   // a member, nothing stored
    let sent = 0; const working = async () => { sent += 1; return { inApp: 1, email: { PROVIDER_ACCEPTED: 0, TEST_RECORDED: 0, NOT_DELIVERED: 0, OFF_BY_PREFERENCE: 1, NOT_EMAILABLE: 0, FAILED: 0 } }; };
    const s1 = await runReferralTimeouts({ notifyImpl: failing });
    expect(s1.overdueRetry).toBeGreaterThanOrEqual(1);
    expect((await db.execute(sql`SELECT "overdueNotifiedAt" AS t FROM "Referral" WHERE id = ${id}`)).rows[0].t, 'the claim is given back').toBeNull();
    // two runs at once: one holds the run lock, the other skips — one notice in all
    const both = await Promise.all([runReferralTimeouts({ notifyImpl: working }), runReferralTimeouts({ notifyImpl: working })]);
    expect(both.filter((x) => x.skipped === 'ALREADY_RUNNING').length + both.filter((x) => !x.skipped).length).toBe(2);
    expect(sent, 'one notice for this referral').toBe(1);
    expect((await db.execute(sql`SELECT "overdueNotifiedAt" AS t FROM "Referral" WHERE id = ${id}`)).rows[0].t).not.toBeNull();
    expect((await runReferralTimeouts({ notifyImpl: working })).overdueNotified, 'never again').toBe(0);
    const audit = (await db.execute(sql`SELECT details->>'outcome' AS o FROM "AuditLog" WHERE action = 'REFERRAL_TIMEOUT_NOTICE' AND entity_id = ${id} ORDER BY timestamp`)).rows.map((r) => r.o);
    expect(audit).toEqual(['FAILED', 'DELIVERED']);
    expect(JSON.stringify(audit)).not.toMatch(/@/);
    // the bound: after NOTICE_MAX_ATTEMPTS failures the flag is kept (given up, logged), no endless retries
    await freeReceiver();
    const q = await ref(P.pro1, { action: 'propose', caseId, toStructureId: S.D, reasonCode: 'OTHER' });
    await cit(H.citRefs, { method: 'POST', body: { id: q.body.referral.id, decision: 'accept' } });
    await db.execute(sql`UPDATE "Referral" SET "dueAt" = NOW() - interval '1 day' WHERE id = ${q.body.referral.id}`);
    let last = null; for (let i = 0; i < NOTICE_MAX_ATTEMPTS + 1; i += 1) last = await runReferralTimeouts({ notifyImpl: failing });
    expect(last.overdueRetry + last.overdueAbandoned).toBe(0);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'REFERRAL_TIMEOUT_NOTICE' AND entity_id = ${q.body.referral.id}`)).rows[0].n).toBe(NOTICE_MAX_ATTEMPTS);
  });

  it('R39: expiry, its ledger entry and the access revocation are one transaction; a failed expiry notice is retried', async () => {
    const { runReferralTimeouts } = await import('../../api/_services/referrals.js');
    await db.execute(sql`UPDATE "Referral" SET status = 'CANCELLED', "closedAt" = NOW() WHERE "toStructureId" = ${S.D} AND status NOT IN ('EXPIRED', 'CANCELLED', 'CLOSED', 'COMPLETED', 'DECLINED')`);
    const p = await ref(P.pro1, { action: 'propose', caseId, toStructureId: S.D, reasonCode: 'HOUSING' });
    await cit(H.citRefs, { method: 'POST', body: { id: p.body.referral.id, decision: 'accept' } });
    const id = p.body.referral.id;
    await db.execute(sql`UPDATE "Referral" SET "dueAt" = NOW() - interval '15 days', "overdueNotifiedAt" = NOW() WHERE id = ${id}`);
    // the revocation fails inside the transaction → nothing changes (the referral is not « expired » while the access stays)
    await db.execute(sql`CREATE OR REPLACE FUNCTION r39_refuse_revoke() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'r39 refused'; END $$ LANGUAGE plpgsql`);
    await db.execute(sql`CREATE TRIGGER r39_refuse_revoke BEFORE UPDATE ON "SharedDossierGrant" FOR EACH ROW EXECUTE FUNCTION r39_refuse_revoke()`);
    try {
      await expect(runReferralTimeouts({ notifyImpl: async () => ({ inApp: 1, email: {} }) })).rejects.toThrow();
      expect((await db.execute(sql`SELECT status FROM "Referral" WHERE id = ${id}`)).rows[0].status, 'rolled back').not.toBe('EXPIRED');
      expect((await db.execute(sql`SELECT count(*)::int AS n FROM "ReferralEvent" WHERE "referralId" = ${id} AND "toStatus" = 'EXPIRED'`)).rows[0].n).toBe(0);
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS r39_refuse_revoke ON "SharedDossierGrant"`); await db.execute(sql`DROP FUNCTION IF EXISTS r39_refuse_revoke()`);
    }
    let calls = 0;
    const s1 = await runReferralTimeouts({ notifyImpl: async () => { calls += 1; return { inApp: 0, email: { NOT_DELIVERED: 1 } }; } });
    expect(s1.expired).toBeGreaterThanOrEqual(1); expect(s1.expiredNoticeFailed).toBeGreaterThanOrEqual(1);
    expect(await grantActive(S.D)).toBe(0);
    const s2 = await runReferralTimeouts({ notifyImpl: async () => { calls += 1; return { inApp: 1, email: {} }; } });
    expect(s2.expiredNoticeRetried).toBeGreaterThanOrEqual(1);
    const s3 = await runReferralTimeouts({ notifyImpl: async () => { calls += 1; return { inApp: 1, email: {} }; } });
    expect(s3.expiredNoticeRetried, 'not after it was stored').toBe(0);
  });

  it('departure: the leaving member loses access at once and their open cases go to the successor; the database refuses bad states', async () => {
    await caseAct(P.admin, { action: 'assign', id: caseId, userId: P.pro2.id });
    const out = await pro(H.team, P.admin, { method: 'DELETE', query: { userId: P.pro2.id, successorUserId: P.pro1.id }, url: `/api/pro/team?userId=${P.pro2.id}&successorUserId=${P.pro1.id}` });
    expect(out.statusCode, JSON.stringify(out.body)).toBe(200); expect(out.body.movedCases).toBe(1);
    expect((await db.execute(sql`SELECT "assigneeProUserId" a FROM "ProCase" WHERE id = ${caseId}`)).rows[0].a).toBe(P.pro1.id);
    expect((await cases(P.pro2, {})).statusCode).toBe(403);
    expect((await pro(H.team, P.admin, { method: 'PATCH', body: { targetUserId: P.pro2.id, reactivate: true } })).statusCode).toBe(200);
    // R12 (E03): a disabled successor is refused and nothing changes (the member stays active, the case stays theirs); a platform account is never disabled here
    await caseAct(P.admin, { action: 'assign', id: caseId, userId: P.pro2.id });
    await db.execute(sql`UPDATE "ProUser" SET status = 'disabled' WHERE id = ${P.pro1.id}`);
    const refused = await pro(H.team, P.admin, { method: 'DELETE', query: { userId: P.pro2.id, successorUserId: P.pro1.id }, url: `/api/pro/team?userId=${P.pro2.id}&successorUserId=${P.pro1.id}` });
    expect(refused.statusCode).toBe(400);
    expect((await db.execute(sql`SELECT status FROM "ProUser" WHERE id = ${P.pro2.id}`)).rows[0].status).toBe('active');
    expect((await db.execute(sql`SELECT "assigneeProUserId" a FROM "ProCase" WHERE id = ${caseId}`)).rows[0].a).toBe(P.pro2.id);
    await db.execute(sql`UPDATE "ProUser" SET status = 'active' WHERE id = ${P.pro1.id}`);
    await caseAct(P.admin, { action: 'assign', id: caseId, userId: P.pro1.id });
    const SA_ID = `p4-sa-${TS}`;
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${SA_ID}, ${SA_ID + '@example.test'}, 'x', 'SUPERADMIN', 'active', ${S.A}, false, NOW())`);
    expect((await pro(H.team, P.admin, { method: 'DELETE', query: { userId: SA_ID }, url: `/api/pro/team?userId=${SA_ID}` })).statusCode).toBe(403);
    expect((await db.execute(sql`SELECT status FROM "ProUser" WHERE id = ${SA_ID}`)).rows[0].status).toBe('active');
    const code = async (q) => { try { await db.execute(q); return null; } catch (e) { return e.cause?.code || e.code; } };
    expect(await code(sql`UPDATE "ProCase" SET status = 'DONE_BY_ADA' WHERE id = ${caseId}`)).toBe('23514');
    expect(await code(sql`UPDATE "ProCaseEvent" SET kind = 'STATUS' WHERE "caseId" = ${caseId}`)).toBe('23000');
    expect(await code(sql`INSERT INTO "Referral" (id, "sharedDiagnosticId", "fromStructureId", "toStructureId", status, "reasonCode", "updatedAt") VALUES (${'r-' + TS}, ${DOSSIER}, ${S.A}, ${S.B}, 'SENT', 'OTHER', NOW())`), 'sent without the citizen and a grant').toBe('23514');
    expect(await code(sql`UPDATE "SharedDossierGrant" SET "grantedVia" = 'admin_override' WHERE id = ${'g-' + TS}`)).toBe('23514');
  });

  it('close with a controlled outcome visible to the person; DSR erasure of the dossier removes cases and referrals', async () => {
    expect((await caseAct(P.pro1, { action: 'close', id: caseId, outcome: 'SUPPORT_COMPLETED', citizenSummary: `merci-${TS}` })).statusCode).toBe(200);
    // R12 (R06): a closed case takes no new note
    expect((await caseAct(P.pro1, { action: 'note', id: caseId, visibility: 'CITIZEN', body: 'après clôture' })).body.error).toBe('CASE_CLOSED');
    expect(JSON.stringify((await cit(H.citDossier, { query: { shareId: DOSSIER, view: 'followups' } })).body)).toContain(`merci-${TS}`);
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${DOSSIER}`);
    expect((await db.execute(sql`SELECT (SELECT count(*) FROM "ProCase" WHERE "sharedDiagnosticId" = ${DOSSIER})::int c, (SELECT count(*) FROM "Referral" WHERE "sharedDiagnosticId" = ${DOSSIER})::int r`)).rows[0]).toEqual({ c: 0, r: 0 });
    void privacy;
  });
});
