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
// F2 / F3
const SX = `fa5-sx-${TS}`, PX = U('px', SX), D_CLOSE = `fa5-close-${TS}`, D_EXP = `fa5-exp-${TS}`, REF_EXP = `fa5-refexp-${TS}`, D_GONE = `fa5-gone-${TS}`, D_KEPT = `fa5-kept-${TS}`;
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
    for (const [sid, n] of [[SA, 'A'], [SB, 'B'], [SC, 'C'], [SX, 'X']]) await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt") VALUES (${sid}, ${'FA5 ' + n}, ${'fa5-slug-' + n + '-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    for (const u of [PA, PB, PC, PX]) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt") VALUES (${u.id}, ${u.email}, 'x', ${u.sid}, ${u.role}, 'active', NOW(), NOW())`);
    const r = await invoke(H.create, { url: '/api/share/create', body: { situation: { zipCode: '67000' }, results: { rights: [] } } });
    expect(r.statusCode).toBe(200);
    share = { id: r.body.shareId, owner: r.body.ownerSecret }; created.push(share.id);
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "Referral" WHERE id IN (${REF}, ${REF_EXP})`);
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_type = 'SHARED_DOSSIER_GRANT' AND split_part(subject_id, ':', 1) IN (${D_GONE}, ${D_KEPT})`).catch(() => { });
    await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" = ${SX}`).catch(() => { });
    const ids = [...created, LEGACY, REF_DOSSIER, D_CLOSE, D_EXP, D_KEPT];
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${CIT.id}`);
    await db.execute(sql`DELETE FROM "AuditLog" WHERE "structureId" IN (${SA}, ${SB}, ${SC}, ${SX})`).catch(() => { });
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${SA}, ${SB}, ${SC}, ${SX})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${SA}, ${SB}, ${SC}, ${SX})`);
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
  // ── F2: the access ends WITHOUT a decision of the person (organisation closed, referral ended): the ledger says the sharing purpose no longer applies, with a
  //    channel that says why (never presented as the person's withdrawal) ─────────────────────────────────────────────────────────────────────────────
  const dossierRow = (id) => sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType") VALUES (${id}, NOW() + interval '1 day', '{}'::jsonb, '{}'::jsonb, 0, ${hash('o-' + id)}, ${hash('s-' + id)}, 'GUEST_SHARE')`;

  it('F2 — an organisation closed by the two-person procedure: « PURP-06 no » (channel organisation_closed, proof SYSTEM_STATE), and its PURP-05 too', async () => {
    await db.execute(dossierRow(D_CLOSE));
    await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", "grantedVia", purposes) VALUES (${`fa5-gx-${TS}`}, ${D_CLOSE}, ${SX}, ${PX.id}, 'invite', 'PURP-06,PURP-05')`);
    expect(await ledgerLib.recordSharingGranted(db, D_CLOSE, SX, ledgerLib.SHARING_GRANTED_BY.INVITE)).toBe(1);
    await db.execute(sql`INSERT INTO "ConsentLog" (id, subject_type, subject_id, purpose, decision, policy_version, policy_hash, collection_channel, guardian_involved, proof_level, created_at)
      VALUES (${`fa5-c5-${TS}`}, 'SHARED_DOSSIER_GRANT', ${`${D_CLOSE}:${SX}`}, 'PURP-05', true, ${ledgerLib.DOSSIER_PURPOSE_POLICY_VERSION}, ${ledgerLib.dossierPurposePolicyHash('PURP-05')}, 'owner_link', false, 'OWNER_SECRET', LOCALTIMESTAMP(3))`);
    const closure = await import('../../api/_services/org-closure.js');
    const req = await closure.requestClosure(SX, { reason: 'Fin de la convention de test FA5.' }, { admin: 'fa5-admin-1' }, db);
    expect(req.ok).toBe(true);
    expect((await closure.proposeClosure(req.request.id, { decision: 'APPROVE' }, 'fa5-admin-1', db)).ok).toBe(true);
    await closure.readClosure(req.request.id, 'fa5-admin-2', db);
    const [{ o }] = (await db.execute(sql`SELECT "reviewOutcome" AS o FROM "DSRRequest" WHERE id = ${req.request.id}`)).rows;
    const done = await closure.confirmClosure(req.request.id, { action: 'confirm', proposedAt: o.proposal.proposedAt, note: 'Relu, conforme.' }, 'fa5-admin-2', db, { noticeCitizen: async () => { }, sendMail: async () => ({ ok: true }) });
    expect(done).toMatchObject({ ok: true, request: { status: 'COMPLETED' } });
    const r = await rows(D_CLOSE, SX);
    expect(r.map((x) => x.decision)).toEqual([true, false]);
    expect(r[1]).toMatchObject({ withdrawn: true, collection_channel: 'organisation_closed', proof_level: 'SYSTEM_STATE', policy_version: r[0].policy_version });
    const [p5] = (await db.execute(sql`SELECT decision, collection_channel FROM "ConsentLog" WHERE subject_id = ${`${D_CLOSE}:${SX}`} AND purpose = 'PURP-05' ORDER BY created_at DESC LIMIT 1`)).rows;
    expect(p5).toMatchObject({ decision: false, collection_channel: 'organisation_closed' });
  });

  it('F2 — a referral that expires without an answer ends its access: « PURP-06 no » (channel referral_ended)', async () => {
    await db.execute(dossierRow(D_EXP));
    const gid = `fa5-gexp-${TS}`;
    await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", "grantedVia", purposes) VALUES (${gid}, ${D_EXP}, ${SB}, ${PA.id}, 'referral', 'PURP-06')`);
    expect(await ledgerLib.recordSharingGranted(db, D_EXP, SB, ledgerLib.SHARING_GRANTED_BY.REFERRAL)).toBe(1);
    await db.execute(sql`INSERT INTO "Referral" (id, "sharedDiagnosticId", "fromStructureId", "toStructureId", status, "reasonCode", "createdByProUserId", "grantId", "citizenDecisionAt", "sentAt", "dueAt", "updatedAt")
      VALUES (${REF_EXP}, ${D_EXP}, ${SA}, ${SB}, 'SENT', 'HOUSING', ${PA.id}, ${gid}, NOW() - interval '90 days', NOW() - interval '90 days', NOW() - interval '80 days', NOW())`);
    await referrals.runReferralTimeouts({ notifyImpl: async () => ({ ok: true }), sendMail: async () => ({ ok: true }) }, db);
    const r = await rows(D_EXP, SB);
    expect(r.map((x) => x.decision)).toEqual([true, false]);
    expect(r[1]).toMatchObject({ withdrawn: true, collection_channel: 'referral_ended', proof_level: 'SYSTEM_STATE' });
  });

  // ── F3: the latest dossier-sharing decisions of a dossier that no longer exists end after the existing CONSENT_AFTER_ERASURE_DAYS (no new duration) ─────
  it('F3 — purge rule: rows of a GONE dossier older than the cutoff go; a dossier that still exists, a recent row, or a held dossier keep theirs', async () => {
    const purge = await import('../../api/_handlers/cron/gdpr-purge.js');
    const step = purge.PURGE_STEPS.find((x) => x.id === 'sharedDossierConsentsAfterDossierGone');
    expect(step).toMatchObject({ kind: 'delete', table: 'ConsentLog', durationKey: 'CONSENT_AFTER_ERASURE_DAYS', ecode: 'E10' });
    await db.execute(dossierRow(D_KEPT));
    const ins = (d, sid, purpose, decision, age) => db.execute(sql`INSERT INTO "ConsentLog" (id, subject_type, subject_id, purpose, decision, policy_version, policy_hash, collection_channel, guardian_involved, proof_level, created_at)
      VALUES (gen_random_uuid()::text, 'SHARED_DOSSIER_GRANT', ${`${d}:${sid}`}, ${purpose}, ${decision}, 'v', 'h', 'owner_invite', false, 'OWNER_SECRET', LOCALTIMESTAMP(3) - ${age}::interval)`);
    await ins(D_GONE, SA, 'PURP-06', true, '500 days'); await ins(D_GONE, SA, 'PURP-06', false, '400 days'); await ins(D_GONE, SB, 'PURP-06', true, '30 days');
    await ins(D_KEPT, SA, 'PURP-06', true, '500 days');
    const count = async (d) => Number((await db.execute(sql`SELECT count(*)::int AS n FROM "ConsentLog" WHERE subject_type = 'SHARED_DOSSIER_GRANT' AND split_part(subject_id, ':', 1) = ${d}`)).rows[0].n);
    const before = new Date(Date.now() - 365 * 86400000);
    expect(await purge.purgeSharedDossierConsentsAfterDossierGone(db, before)).toBe(2);
    expect(await count(D_GONE)).toBe(1);   // the recent decision of organisation B stays until it is old enough
    expect(await count(D_KEPT)).toBe(1);   // the dossier still exists: its proof stays
    await db.execute(sql`INSERT INTO "LegalHold" (id, "dataCategory", "recordId", status, "reasonCode", "createdBy") VALUES (${`fa5-hold-${TS}`}, 'SharedDiagnostic', ${D_GONE}, 'ACTIVE', 'LITIGATION', 'fa5')`);
    // a legal hold on the dossier keeps everything (cutoff 10 days ago: B's 30-day-old row would go without the hold; rows other suites write now are younger)
    expect(await purge.purgeSharedDossierConsentsAfterDossierGone(db, new Date(Date.now() - 10 * 86400000))).toBe(0);
    expect(await count(D_GONE)).toBe(1);
    await db.execute(sql`DELETE FROM "LegalHold" WHERE id = ${`fa5-hold-${TS}`}`);
    expect(await purge.purgeSharedDossierConsentsAfterDossierGone(db, new Date(Date.now() - 10 * 86400000))).toBe(1);   // hold gone: B's old-enough row goes
    expect(await count(D_GONE)).toBe(0);
  });
});
