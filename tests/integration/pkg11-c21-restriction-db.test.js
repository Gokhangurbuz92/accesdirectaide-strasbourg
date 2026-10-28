/**
 * PKG-11 / C21 — restriction of processing (RGPD art. 18) on REAL PostgreSQL, through the real handlers (synthetic citizen, dossiers and organizations).
 *  - the person asks with one of the four grounds; it applies at once; asking again is idempotent;
 *  - while active: the organization holding an access cannot open the dossier (same answer as a revoked access) and is told; a pending invitation cannot be
 *    redeemed; the person cannot share anew or widen a purpose (revoking stays possible); no notification is allowed; the purge keeps the person's dossiers;
 *  - ADA lifts it only with a named MFA session and a reason, after informing the person (notice outcome recorded); the access comes back; the person can lift
 *    their own restriction at any time.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const S = { A: `c21r-A-${TS}`, B: `c21r-B-${TS}` };
const P = { a: { id: `c21r-a-${TS}`, sid: S.A }, b: { id: `c21r-b-${TS}`, sid: S.B } };
const CIT = { id: `c21r-cit-${TS}`, email: `c21r-cit-${TS}@example.test` };
const ADMIN = `c21r-adm-${TS}@example.test`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; }, on() { return this; }, end() { return this; } });

describe.skipIf(!hasDatabase)('PKG-11 / C21 restriction of processing (real DB)', () => {
  let db, auth, userAuth, H, citizenAccount; const created = [];
  const invoke = async (handler, { method = 'GET', url = '/api/x', body, headers = {}, query = {} }) => { const r = mk(); await handler({ method, url, query, body, headers: { host: 'x', ...headers } }, r); return r; };
  const pro = (u) => ({ authorization: `Bearer ${auth.signProToken({ id: u.id, email: `${u.id}@example.test`, structureId: u.sid, role: 'STRUCTURE_ADMIN' })}` });
  const citizen = () => ({ cookie: userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: CIT.id, email: CIT.email })).split(';')[0] });
  const admin = (mfa = true) => ({ authorization: `Bearer ${auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: mfa })}` });
  const restriction = (body) => invoke(H.restriction, body ? { method: 'POST', body, headers: citizen() } : { headers: citizen() });
  const newShare = async () => {
    const r = await invoke(H.create, { method: 'POST', url: '/api/share/create', body: { situation: { zipCode: '67000' }, results: { rights: [] } } });
    expect(r.statusCode).toBe(200); created.push(r.body.shareId);
    await db.execute(sql`UPDATE "SharedDiagnostic" SET "ownerCitizenId" = ${CIT.id} WHERE id = ${r.body.shareId}`);   // an account-owned dossier
    return { id: r.body.shareId, owner: r.body.ownerSecret };
  };
  const own = (s, action, extra = {}) => invoke(H.grants, { method: 'POST', url: '/api/public/dossier-grants', body: { shareId: s.id, action, ...extra }, headers: { 'x-share-owner-secret': s.owner } });
  const dossier = (s, u) => invoke(H.dossier, { url: `/api/pro/dossier?shareId=${s.id}`, query: { shareId: s.id }, headers: pro(u) });
  let share; let inviteB;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js'); citizenAccount = await import('../../api/_services/citizen-account.js');
    H = { create: (await import('../../api/_handlers/share/create.js')).default, grants: (await import('../../api/_handlers/public/dossier-grants.js')).default,
      redeem: (await import('../../api/_handlers/pro/dossier/redeem.js')).default, dossier: (await import('../../api/_handlers/pro/dossier.js')).default,
      restriction: (await import('../../api/_handlers/citizen/restriction.js')).default, admin: (await import('../../api/_handlers/admin/processing-restrictions.js')).default,
      purge: (await import('../../api/_handlers/cron/gdpr-purge.js')).default };
    for (const id of Object.values(S)) await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${id}, ${'Org ' + id}, ${id}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    for (const p of Object.values(P)) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${p.id}, ${p.id + '@example.test'}, 'x', 'STRUCTURE_ADMIN', 'active', ${p.sid}, false, NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${CIT.id}, ${CIT.email}, 'x', NOW(), NOW())`);
    await citizenAccount.setPreference(CIT.id, { channel: 'email', category: 'service', enabled: true });
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
    share = await newShare();
    const invA = await own(share, 'invite', { structureId: S.A }); expect(invA.statusCode).toBe(201);
    expect((await invoke(H.redeem, { method: 'POST', url: '/api/pro/dossier/redeem', body: { shareId: share.id, inviteToken: invA.body.inviteToken }, headers: pro(P.a) })).statusCode).toBe(200);
    const invB = await own(share, 'invite', { structureId: S.B }); expect(invB.statusCode).toBe(201); inviteB = invB.body.inviteToken;
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    for (const id of created) await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" = ${CIT.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" IN (${S.A}, ${S.B})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProAuditLog" WHERE "structureId" IN (${S.A}, ${S.B})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${S.A}, ${S.B})`).catch(() => {});
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${S.A}, ${S.B})`).catch(() => {});
    await db.execute(sql`DELETE FROM "NotificationPreference" WHERE "userId" = ${CIT.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id = ${CIT.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${CIT.id}`).catch(() => {});
  });

  it('the person asks with a ground; it applies at once; asking again changes nothing', async () => {
    expect((await dossier(share, P.a)).statusCode).toBe(200);   // before: the organization reads the dossier
    expect(await citizenAccount.canNotify(CIT.id, 'email', 'service')).toBe(true);   // before: the person accepts service e-mails (positive control)
    expect((await restriction()).body).toMatchObject({ restriction: null, grounds: ['ACCURACY_CONTESTED', 'UNLAWFUL_PROCESSING', 'LEGAL_CLAIMS', 'OBJECTION_PENDING'] });
    expect((await restriction({ action: 'request', ground: 'BECAUSE' })).body.error).toBe('ground_required');
    const r = await restriction({ action: 'request', ground: 'ACCURACY_CONTESTED' });
    expect([r.statusCode, r.body.restriction.status, r.body.organizationsTold]).toEqual([201, 'ACTIVE', 1]);
    const again = await restriction({ action: 'request', ground: 'LEGAL_CLAIMS' });
    expect([again.statusCode, again.body.restriction.id]).toEqual([200, r.body.restriction.id]);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "DSRRequest" WHERE "subjectId" = ${CIT.id} AND "requestType" = 'RESTRICT' AND status = 'ACTIVE'`)).rows[0].n).toBe(1);
  });

  it('while active: no organization access, no new access, no new sharing, no notification, no purge', async () => {
    const closed = await dossier(share, P.a);
    expect(closed.statusCode).toBe(404);
    expect((await db.execute(sql`SELECT type FROM "ProNotification" WHERE "structureId" = ${S.A}`)).rows.map((r) => r.type)).toContain('dossier_restricted');
    expect((await invoke(H.redeem, { method: 'POST', url: '/api/pro/dossier/redeem', body: { shareId: share.id, inviteToken: inviteB }, headers: pro(P.b) })).statusCode).toBe(404);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${share.id} AND "structureId" = ${S.B}`)).rows[0].n).toBe(0);
    const inv = await own(share, 'invite', { structureId: S.B });
    expect([inv.statusCode, inv.body.error]).toEqual([409, 'PROCESSING_RESTRICTED']);
    expect((await own(share, 'set_purposes', { structureId: S.A, purposes: ['PURP-05'] })).statusCode).toBe(409);
    expect((await own(share, 'list')).statusCode).toBe(200);   // reading is a right, not new processing
    expect(await citizenAccount.canNotify(CIT.id, 'email', 'service')).toBe(false);
    const kept = await newShare(); const unowned = await newShare();
    await db.execute(sql`UPDATE "SharedDiagnostic" SET "ownerCitizenId" = NULL WHERE id = ${unowned.id}`);
    await db.execute(sql`UPDATE "SharedDiagnostic" SET "expiresAt" = NOW() - interval '1 day' WHERE id IN (${kept.id}, ${unowned.id})`);
    const p = await invoke(H.purge, { url: '/api/cron/gdpr-purge', headers: { 'x-cron-secret': process.env.CRON_SECRET, authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(p.statusCode).toBe(200);
    const left = (await db.execute(sql`SELECT id FROM "SharedDiagnostic" WHERE id IN (${kept.id}, ${unowned.id})`)).rows.map((r) => r.id);
    expect(left).toEqual([kept.id]);   // the restricted person's expired dossier is kept; another expired dossier is purged
  });

  it('R12: a dossier attached to the account WHILE the restriction is active gets its share link sealed too; a claim lost to someone else is not a success', async () => {
    const r = await invoke(H.create, { method: 'POST', url: '/api/share/create', body: { situation: { zipCode: '67000' }, results: { rights: [] } } });
    created.push(r.body.shareId);
    const out = await citizenAccount.claimShare(CIT.id, r.body.shareId, r.body.ownerSecret);
    expect(out).toMatchObject({ ok: true, shareLinkSuspended: true });
    const [row] = (await db.execute(sql`SELECT "shareTokenHash" AS h, "ownerCitizenId" AS o FROM "SharedDiagnostic" WHERE id = ${r.body.shareId}`)).rows;
    expect(row.o).toBe(CIT.id); expect(String(row.h)).toMatch(/^restricted:/);
    await db.execute(sql`UPDATE "SharedDiagnostic" SET "ownerCitizenId" = 'someone-else' WHERE id = ${r.body.shareId}`);
    expect((await citizenAccount.claimShare(CIT.id, r.body.shareId, r.body.ownerSecret)).ok).toBe(false);
    await db.execute(sql`UPDATE "SharedDiagnostic" SET "ownerCitizenId" = ${CIT.id} WHERE id = ${r.body.shareId}`);
  });

  it('ADA lifts it only with MFA and a reason, informing the person first; the access comes back', async () => {
    expect((await invoke(H.admin, { method: 'GET', headers: admin(false) })).statusCode).toBe(403);
    const list = await invoke(H.admin, { method: 'GET', headers: admin() });
    const row = list.body.restrictions.find((x) => x.ground === 'ACCURACY_CONTESTED' && x.account && x.account.startsWith('c…'));
    expect(row).toBeTruthy(); expect(JSON.stringify(list.body)).not.toContain(CIT.email);
    expect((await invoke(H.admin, { method: 'POST', body: { id: row.id, reason: 'court' }, headers: admin() })).body.error).toBe('reason_required');
    const lift = await invoke(H.admin, { method: 'POST', body: { id: row.id, reason: 'Vos données ont été vérifiées : elles sont exactes.' }, headers: admin() });
    expect([lift.statusCode, lift.body.restriction.status]).toEqual([200, 'LIFTED']);
    expect(['TEST_RECORDED', 'PROVIDER_ACCEPTED']).toContain(lift.body.notice);
    expect((await dossier(share, P.a)).statusCode).toBe(200);
    expect((await restriction()).body.lastLifted).toMatchObject({ by: 'ADA', reason: 'Vos données ont été vérifiées : elles sont exactes.' });
    expect((await db.execute(sql`SELECT action FROM "AuditLog" WHERE entity = 'DSR_REQUEST' AND entity_id = ${row.id} ORDER BY "timestamp"`)).rows.map((r) => r.action)).toEqual(['PROCESSING_RESTRICTED', 'PROCESSING_RESTRICTION_LIFTED']);
  });

  it('the person can lift their own restriction at any time', async () => {
    expect((await restriction({ action: 'request', ground: 'OBJECTION_PENDING' })).statusCode).toBe(201);
    expect((await dossier(share, P.a)).statusCode).toBe(404);
    expect((await restriction({ action: 'lift' })).body.restriction.status).toBe('LIFTED');
    expect((await dossier(share, P.a)).statusCode).toBe(200);
    expect((await restriction({ action: 'lift' })).statusCode).toBe(404);
    expect((await restriction()).body.lastLifted).toMatchObject({ by: 'vous', reason: null });
  });
});
