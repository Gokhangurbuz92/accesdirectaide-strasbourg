/**
 * M2 — the code on a database WITHOUT migrations 0047 and 0048 (Production until the migration is authorized). R47-QA: the file makes its own database migrated
 * up to 0045 — a throwaway database on the suite's cluster, drizzle's migrator, dropped at the end (tests/integration/helpers/throwaway-db.mjs) — instead of
 * skipping itself on a migrated database (on 0047 the same paths are covered by m2-redirect-referent-db.test.js). The other referral suites
 * (pkg4-cases-referrals-db, vis-referral-gaps-db, r40-referral-citizen-notice-db) are run against that database too.
 *   existing paths    propose → the person authorizes → acknowledge → decline; lists and detail on both sides; the person's list; the referral-timeouts cron;
 *                     the person withdrawing an access; a case view; a member's departure — all work, none names a 0047 column
 *   new features      the redirect and the référent answer « not available » (409) and write nothing; nothing fails with a missing column or table
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createThrowawayDatabase, isLoopbackDatabaseUrl } from './helpers/throwaway-db.mjs';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const SUITE_URL = process.env.DATABASE_URL;
const hasDatabase = isLoopbackDatabaseUrl(SUITE_URL);   // a throwaway database is only made on a loopback cluster
const TS = Date.now();
const S = { X: `m2p-X-${TS}`, Y: `m2p-Y-${TS}`, Z: `m2p-Z-${TS}` };
const P = { admin: { id: `m2p-adm-${TS}`, st: S.X, role: 'STRUCTURE_ADMIN' }, x1: { id: `m2p-x1-${TS}`, st: S.X, role: 'PRO' }, x2: { id: `m2p-x2-${TS}`, st: S.X, role: 'PRO' }, y: { id: `m2p-y-${TS}`, st: S.Y, role: 'PRO' }, z: { id: `m2p-z-${TS}`, st: S.Z, role: 'PRO' } };
const CIT = { id: `m2p-cit-${TS}`, email: `m2p-cit-${TS}@example.test` };
const DOSSIER = `m2p-dos-${TS}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('M2 code on a database without migrations 0047 / 0048', () => {
  let db, auth, userAuth, H, features, pre47 = false, caseId, throwaway;
  const tok = (p) => auth.signProToken({ id: p.id, email: `${p.id}@example.test`, structureId: p.st, role: p.role });
  const pro = async (h, p, { method = 'GET', query = {}, body, url = '/api/pro/x' } = {}) => { const r = mk(); await h({ method, url, query, body, headers: { host: 'localhost', authorization: `Bearer ${tok(p)}` } }, r); return r; };
  const cit = async (h, { method = 'GET', query = {}, body } = {}) => { const r = mk(); const c = userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: CIT.id, email: CIT.email })).split(';')[0];
    await h({ method, url: '/api/x', query, body, headers: { host: 'localhost', cookie: c } }, r); return r; };
  const ref = (p, body) => pro(H.refs, p, { method: 'POST', body });
  const row = async (id) => (await db.execute(sql`SELECT * FROM "Referral" WHERE id = ${id}`)).rows[0];
  const sent = async (to) => { const p = await ref(P.x1, { action: 'propose', caseId, toStructureId: to, reasonCode: 'HOUSING', message: 'Bonjour (test)' }); expect(p.statusCode, JSON.stringify(p.body)).toBe(201);
    expect((await cit(H.citRefs, { method: 'POST', body: { id: p.body.referral.id, decision: 'accept' } })).statusCode).toBe(200); return p.body.referral.id; };

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase({ prefix: 'ada_m2_pre47', upTo: '0045_r43_appointment_notice_kinds' });
    process.env.DATABASE_URL = throwaway.url;   // before the first import of the database module in this file (vitest isolates each file)
    ({ db } = await import('../../src/db/index.js'));
    features = await (await import('../../api/_utils/schema-features.js')).readReferralChainSchema(db);
    pre47 = !features.chain && !features.referent;
    if (!pre47) throw new Error('the throwaway database is not before 0047');
    auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js');
    H = { cases: (await import('../../api/_handlers/pro/cases.js')).default, refs: (await import('../../api/_handlers/pro/referrals.js')).default, team: (await import('../../api/_handlers/pro/team.js')).default,
      citRefs: (await import('../../api/_handlers/citizen/referrals.js')).default, citDossier: (await import('../../api/_handlers/citizen/dossier.js')).default,
      grants: (await import('../../api/_handlers/public/dossier-grants.js')).default, cron: (await import('../../api/_handlers/cron/referral-timeouts.js')).default };
    for (const id of Object.values(S)) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${id}, ${'Org test ' + id.split('-')[1]}, ${id}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    }
    for (const p of Object.values(P)) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${p.id}, ${p.id + '@example.test'}, 'x', ${p.role}, 'active', ${p.st}, false, NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${CIT.id}, ${CIT.email}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId") VALUES (${DOSSIER}, NOW() + interval '30 days', '{}'::jsonb, '{}'::jsonb, 0, 'h', 't', 'GUEST_SHARE', ${CIT.id})`);
    await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", "grantedVia") VALUES (${'g-' + DOSSIER}, ${DOSSIER}, ${S.X}, ${P.x1.id}, 'invite')`);
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
    caseId = (await pro(H.cases, P.x1, { query: { scope: 'unassigned' } })).body.cases.find((c) => c.dossierId === DOSSIER).id;
  }, 240000);
  afterAll(async () => {
    try { await cleanup(); } finally {
      await db?.$client?.end?.().catch(() => {});
      process.env.DATABASE_URL = SUITE_URL;
      await throwaway?.drop();
    }
  }, 60000);
  const cleanup = async () => {
    if (!db || !pre47) return;
    const sts = sql.join(Object.values(S).map((s) => sql`${s}`), sql`, `);
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity = 'Referral' AND entity_id IN (SELECT id FROM "Referral" WHERE "sharedDiagnosticId" = ${DOSSIER})`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'shareId' = ${DOSSIER}`).catch(() => {});
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${DOSSIER}`);
    await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" IN (${sts})`);
    await db.execute(sql`DELETE FROM "ProAuditLog" WHERE "structureId" IN (${sts})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${sts})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${sts})`);
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id = ${CIT.id}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${CIT.id}`);
  };
  const needs = (t) => { if (!pre47) t.skip(); };

  it('the database really has no 0047 / 0048 object', async (t) => {
    needs(t);
    expect(features).toEqual({ chain: false, referent: false, messages: false });
    await expect(db.execute(sql`SELECT "previousReferralId" FROM "Referral" LIMIT 1`)).rejects.toThrow();
    await expect(db.execute(sql`SELECT 1 FROM "DossierReferent" LIMIT 1`)).rejects.toThrow();
    await expect(db.execute(sql`SELECT 1 FROM "ReferralMessage" LIMIT 1`)).rejects.toThrow();
  });

  it('every earlier referral path works: propose, authorize, lists, detail, acknowledge, decline, the person’s list, the cron', async (t) => {
    needs(t);
    const a = await sent(S.Y);
    expect((await row(a)).status).toBe('SENT');
    for (const [p, name] of [[P.y, 'inbox'], [P.x1, 'outbox']]) {
      const list = await pro(H.refs, p, { query: { box: name } });
      expect(list.statusCode, JSON.stringify(list.body)).toBe(200);
      expect(list.body.referrals.find((r) => r.id === a)).toMatchObject({ status: 'SENT', needsFollowUp: false });
    }
    for (const p of [P.y, P.x1]) {
      const one = await pro(H.refs, p, { query: { id: a } });
      expect(one.statusCode, JSON.stringify(one.body)).toBe(200);
      expect(one.body.referral).toMatchObject({ status: 'SENT', suggested: null, previous: null, next: null, canProposeSuggested: false });
    }
    expect((await ref(P.y, { action: 'acknowledge', id: a })).statusCode).toBe(200);
    expect((await ref(P.y, { action: 'decline', id: a, responseCode: 'NO_CAPACITY' })).statusCode).toBe(200);
    expect((await row(a)).status).toBe('DECLINED');
    const mine = await cit(H.citRefs);
    expect(mine.statusCode, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body.referrals.find((r) => r.id === a)).toMatchObject({ status: 'DECLINED', suggested: null, previousId: null, nextId: null, nextAction: { code: 'SENDER_NEXT' } });
    // the cron: overdue, expiry and the unanswered proposal still run; the 0047 follow-up step is skipped
    const b = await sent(S.Z);
    await db.execute(sql`UPDATE "Referral" SET "dueAt" = NOW() - interval '20 days' WHERE id = ${b}`);
    const r = mk(); await H.cron({ method: 'GET', url: '/api/cron/referral-timeouts', query: {}, headers: { 'x-cron-secret': process.env.CRON_SECRET } }, r);
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ ok: true, followUpNotified: 0 });
    expect((await row(b)).status).toBe('EXPIRED');
  });

  it('the new features answer « not available » and write nothing', async (t) => {
    needs(t);
    const a = await sent(S.Y);
    const redirect = await ref(P.y, { action: 'decline', id: a, responseCode: 'REDIRECT_SUGGESTED', suggestedStructureId: S.Z });
    expect([redirect.statusCode, redirect.body.error]).toEqual([409, 'REDIRECT_UNAVAILABLE']);
    expect((await row(a)).status).toBe('SENT');
    const chained = await ref(P.x1, { action: 'propose', caseId, toStructureId: S.Z, reasonCode: 'HOUSING', previousReferralId: a });
    expect([chained.statusCode, chained.body.error]).toEqual([409, 'REDIRECT_UNAVAILABLE']);
    const vol = await pro(H.cases, P.x1, { method: 'POST', body: { action: 'referent_volunteer', id: caseId, displayName: 'Camille (test)', displayNameConsent: true } });
    expect([vol.statusCode, vol.body.error]).toEqual([409, 'REFERENT_UNAVAILABLE']);
    expect((await pro(H.cases, P.x1, { method: 'POST', body: { action: 'referent_step_down', id: caseId } })).statusCode).toBe(409);
    const view = await cit(H.citDossier, { query: { shareId: DOSSIER, view: 'referent' } });
    expect([view.statusCode, view.body]).toEqual([200, { available: false, referent: null, proposal: null }]);
    expect((await cit(H.citDossier, { method: 'POST', body: { action: 'referent_decide', shareId: DOSSIER, accept: true } })).statusCode).toBe(409);
    expect((await cit(H.citDossier, { method: 'POST', body: { action: 'referent_end', shareId: DOSSIER } })).statusCode).toBe(409);
    // an organization without access still gets « not found », not « not available » (no oracle)
    expect((await pro(H.cases, P.y, { method: 'POST', body: { action: 'referent_volunteer', id: caseId, displayName: 'Camille (test)', displayNameConsent: true } })).statusCode).toBe(404);
  });

  it('a case view, a member’s departure and the person withdrawing an access work', async (t) => {
    needs(t);
    const view = await pro(H.cases, P.x1, { query: { id: caseId } });
    expect(view.statusCode, JSON.stringify(view.body)).toBe(200);
    expect(view.body.referent).toBeNull();
    const pending = await ref(P.x2, { action: 'propose', caseId, toStructureId: S.Z, reasonCode: 'HOUSING' });
    expect(pending.statusCode, JSON.stringify(pending.body)).toBe(201);
    const leave = await pro(H.team, P.admin, { method: 'DELETE', query: { userId: P.x2.id, successorUserId: P.x1.id }, url: `/api/pro/team?userId=${P.x2.id}&successorUserId=${P.x1.id}` });
    expect(leave.statusCode, JSON.stringify(leave.body)).toBe(200);
    expect((await row(pending.body.referral.id)).createdByProUserId).toBe(P.x1.id);
    const live = (await db.execute(sql`SELECT id FROM "Referral" WHERE "sharedDiagnosticId" = ${DOSSIER} AND "toStructureId" = ${S.Y} AND status = 'SENT'`)).rows[0].id;
    const revoke = await cit(H.grants, { method: 'POST', body: { shareId: DOSSIER, action: 'revoke', structureId: S.Y } });
    expect(revoke.statusCode, JSON.stringify(revoke.body)).toBe(200);
    expect(await row(live)).toMatchObject({ status: 'CANCELLED', outcome: 'CITIZEN_WITHDREW' });
    const stop = await cit(H.grants, { method: 'POST', body: { shareId: DOSSIER, action: 'stop_sharing' } });
    expect(stop.statusCode, JSON.stringify(stop.body)).toBe(200);
  });
});
