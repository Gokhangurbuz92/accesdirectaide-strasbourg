/**
 * FA-D5 / PURP-06 — the dossier-sharing purpose itself is a decision of the person, so its grant AND its withdrawal are rows of the append-only consent
 * ledger, like PURP-05 (automated analysis) and PURP-07 (SIAO transmission). Found by the D1 golden journey: before, giving and withdrawing the sharing
 * consent was evidenced only by SharedDossierGrant.createdAt / revokedAt (overwritten when an access is granted again) and a best-effort AuditLog line.
 *
 * REAL PostgreSQL, real handlers (share/create, public/dossier-grants with the owner secret, pro/dossier/redeem with real pro JWTs, the referral service),
 * synthetic rows only. Skipped without DATABASE_URL.
 *   - an organisation that redeems the person's invitation → « PURP-06 yes » (channel owner_invite, proof OWNER_SECRET)
 *   - the person accepts a referral in their account → « PURP-06 yes » (channel citizen_account, proof AUTHENTICATED_SESSION)
 *   - the person removes one organisation / stops sharing → « PURP-06 no » (withdrawn_at set, strictly later, same policy as the yes it ends)
 *   - a grant that never had a ledger row (created before this change, or by the legacy link) still gets its withdrawal row
 *   - idempotent: nothing is written twice; an access granted again after a revocation writes a new « yes »
 */
import crypto from 'node:crypto';
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.stubEnv('AUTH_SECRET', 'test-auth-secret-fa5-purp06');
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const SA = `fa5-sa-${TS}`, SB = `fa5-sb-${TS}`, SC = `fa5-sc-${TS}`;
const U = (n, sid) => ({ id: `fa5-${n}-${TS}`, email: `fa5-${n}-${TS}@example.test`, sid, role: 'STRUCTURE_ADMIN' });
const PA = U('pa', SA), PB = U('pb', SB), PC = U('pc', SC);
const CIT = { id: `fa5-cit-${TS}`, email: `fa5-cit-${TS}@example.test` };
const LEGACY = `fa5-legacy-${TS}`, REF_DOSSIER = `fa5-refd-${TS}`, REF = `fa5-ref-${TS}`;
const hash = (v) => crypto.createHash('sha256').update(v, 'utf8').digest('hex');
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const created = [];

describe.skipIf(!hasDatabase)('FA-D5 PURP-06 sharing consent in the append-only ledger (real DB)', () => {
  let db, auth, H, ledgerLib, referrals, share;
  const invoke = async (handler, { method = 'POST', url, body, headers = {} }) => { const r = mk(); await handler({ method, url, query: {}, body, headers: { host: 'x', ...headers } }, r); return r; };
  const own = (s, action, extra = {}) => invoke(H.grants, { url: '/api/public/dossier-grants', body: { shareId: s.id, action, ...extra }, headers: { 'x-share-owner-secret': s.owner } });
  const grantTo = async (s, u) => {
    const inv = await own(s, 'invite', { structureId: u.sid }); expect(inv.statusCode).toBe(201);
    const r = await invoke(H.redeem, { url: '/api/pro/dossier/redeem', body: { shareId: s.id, inviteToken: inv.body.inviteToken }, headers: { authorization: `Bearer ${auth.signProToken({ id: u.id, email: u.email, structureId: u.sid, role: u.role })}` } });
    expect(r.statusCode).toBe(200);
  };
  const rows = async (shareId, sid) => (await db.execute(sql`SELECT decision, withdrawn_at IS NOT NULL AS withdrawn, policy_version, policy_hash, collection_channel, proof_level, created_at
    FROM "ConsentLog" WHERE subject_type = 'SHARED_DOSSIER_GRANT' AND subject_id = ${`${shareId}:${sid}`} AND purpose = 'PURP-06' ORDER BY created_at`)).rows;
  const latest = async (shareId, sid) => { const r = await rows(shareId, sid); return r.length ? r[r.length - 1].decision : null; };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); auth = await import('../../api/_utils/auth.js'); ledgerLib = await import('../../api/lib/consent-ledger.js');
    referrals = await import('../../api/_services/referrals.js');
    H = { create: (await import('../../api/_handlers/share/create.js')).default, redeem: (await import('../../api/_handlers/pro/dossier/redeem.js')).default,
      grants: (await import('../../api/_handlers/public/dossier-grants.js')).default };
    for (const [sid, n] of [[SA, 'A'], [SB, 'B'], [SC, 'C']]) await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt") VALUES (${sid}, ${'FA5 ' + n}, ${'fa5-slug-' + n + '-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    for (const u of [PA, PB, PC]) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt") VALUES (${u.id}, ${u.email}, 'x', ${u.sid}, ${u.role}, 'active', NOW(), NOW())`);
    const r = await invoke(H.create, { url: '/api/share/create', body: { situation: { zipCode: '67000' }, results: { rights: [] } } });
    expect(r.statusCode).toBe(200);
    share = { id: r.body.shareId, owner: r.body.ownerSecret }; created.push(share.id);
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "Referral" WHERE id = ${REF}`);
    const ids = [...created, LEGACY, REF_DOSSIER];
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${CIT.id}`);
    await db.execute(sql`DELETE FROM "AuditLog" WHERE "structureId" IN (${SA}, ${SB}, ${SC})`).catch(() => { });
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${SA}, ${SB}, ${SC})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${SA}, ${SB}, ${SC})`);
  });

  it('an organisation redeeming the person\'s invitation writes « PURP-06 yes » (owner invitation, owner secret)', async () => {
    await grantTo(share, PA); await grantTo(share, PB);
    for (const sid of [SA, SB]) {
      const r = await rows(share.id, sid);
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ decision: true, withdrawn: false, collection_channel: 'owner_invite', proof_level: 'OWNER_SECRET' });
      expect(r[0].policy_hash).toBe(hash(`${r[0].policy_version}:PURP-06`));
    }
  });

  it('removing ONE organisation writes its « PURP-06 no » (withdrawn, same policy, strictly later); the other keeps « yes »', async () => {
    expect((await own(share, 'revoke', { structureId: SA })).statusCode).toBe(200);
    const [yes, no] = await rows(share.id, SA);
    expect(no).toMatchObject({ decision: false, withdrawn: true, policy_version: yes.policy_version, policy_hash: yes.policy_hash, proof_level: yes.proof_level });
    expect(new Date(no.created_at).getTime()).toBeGreaterThan(new Date(yes.created_at).getTime());
    expect(await latest(share.id, SB)).toBe(true);
  });

  it('idempotent: no second withdrawal, no second « yes »', async () => {
    const before = [(await rows(share.id, SA)).length, (await rows(share.id, SB)).length];
    expect(await ledgerLib.withdrawPurposesOfRevokedGrants(db, share.id, SA)).toBe(0);
    expect(await ledgerLib.withdrawPurposesOfRevokedGrants(db, share.id)).toBe(0);
    expect(await ledgerLib.recordSharingGranted(db, share.id, SB, ledgerLib.SHARING_GRANTED_BY.INVITE)).toBe(0);
    expect([(await rows(share.id, SA)).length, (await rows(share.id, SB)).length]).toEqual(before);
  });

  it('access granted again after the revocation (new invitation) writes a new « yes »', async () => {
    await grantTo(share, PA);
    expect((await rows(share.id, SA)).map((r) => r.decision)).toEqual([true, false, true]);
  });

  it('stopping all sharing withdraws PURP-06 for every organisation of the dossier', async () => {
    expect((await own(share, 'stop_sharing')).statusCode).toBe(200);
    expect(await latest(share.id, SA)).toBe(false);
    expect(await latest(share.id, SB)).toBe(false);
  });

  it('a grant with NO earlier ledger row (before this change / legacy link) still gets its withdrawal row', async () => {
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType") VALUES (${LEGACY}, NOW() + interval '1 day', '{}'::jsonb, '{}'::jsonb, 0, ${hash('owner-' + TS)}, ${hash('share-' + TS)}, 'GUEST_SHARE')`);
    await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", "grantedVia") VALUES (${`fa5-g-${TS}`}, ${LEGACY}, ${SC}, ${PC.id}, 'legacy_link')`);
    expect(await latest(LEGACY, SC)).toBe(null);
    expect((await own({ id: LEGACY, owner: 'owner-' + TS }, 'revoke', { structureId: SC })).statusCode).toBe(200);
    const r = await rows(LEGACY, SC);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ decision: false, withdrawn: true });
    expect(r[0].policy_hash).toBe(hash(`${r[0].policy_version}:PURP-06`));
  });

  it('the person accepting a referral in their account writes « PURP-06 yes » for the receiving organisation (citizen account)', async () => {
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${CIT.id}, ${CIT.email}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId") VALUES (${REF_DOSSIER}, NOW() + interval '1 day', '{}'::jsonb, '{}'::jsonb, 0, ${hash('o2-' + TS)}, ${hash('s2-' + TS)}, 'CITIZEN_ACCOUNT', ${CIT.id})`);
    await db.execute(sql`INSERT INTO "Referral" (id, "sharedDiagnosticId", "fromStructureId", "toStructureId", status, "reasonCode", "createdByProUserId", "updatedAt") VALUES (${REF}, ${REF_DOSSIER}, ${SA}, ${SB}, 'PENDING_CITIZEN', 'HOUSING', ${PA.id}, NOW())`);
    const out = await referrals.citizenDecide(CIT.id, REF, true, db);
    expect(out.ok).toBe(true);
    const r = await rows(REF_DOSSIER, SB);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ decision: true, withdrawn: false, collection_channel: 'citizen_account', proof_level: 'AUTHENTICATED_SESSION' });
  });
});
