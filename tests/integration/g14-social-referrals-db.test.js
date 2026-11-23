/**
 * G14-PS — the social referral (non-HDS) on REAL PostgreSQL. Migration 0061 is NOT in the journal yet (0060 belongs to branch g14-ai): this file applies
 * drizzle/pending/0061_g14_ps_social_referrals.sql itself, and rolls it back afterwards (drizzle/pending/0061_down.sql), so the database stays at the journal.
 * FIXTURES: every structure, account and address below is SYNTHETIC (example.test); deleted afterwards. Skipped without DATABASE_URL.
 */
import fs from 'node:fs';
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));

const hasDatabase = !!process.env.DATABASE_URL;
const T = Date.now().toString(36);
const S = { ccas: `g14ps-ccas-${T}`, asso: `g14ps-asso-${T}`, hlm: `g14ps-hlm-${T}`, ehpad: `g14ps-ehpad-${T}`, finess: `g14ps-fin-${T}`, unverified: `g14ps-unv-${T}`, unknown: `g14ps-unk-${T}` };
const P = { ccas: `g14ps-p1-${T}`, asso: `g14ps-p2-${T}`, hlm: `g14ps-p3-${T}`, ehpad: `g14ps-p4-${T}` };
const C = { anna: `g14ps-c1-${T}`, other: `g14ps-c2-${T}` };
const PASS = 'Fixture-Mot-De-Passe-2026!';

describe.skipIf(!hasDatabase)('G14-PS — social referrals (real DB)', () => {
  let db; let svc; let notices;
  const ctx = (k, mfa = true) => ({ structureId: S[k], userId: P[k], role: 'PRO', mfa });
  const one = async (q) => (await db.execute(q)).rows[0];
  let pro; let citizen;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    await db.execute(sql.raw(fs.readFileSync('drizzle/pending/0061_g14_ps_social_referrals.sql', 'utf8').replace(/--> statement-breakpoint/g, '')));
    svc = await import('../../api/_services/social-referrals.js');
    svc.forgetSocialReferralSchema(db);
    const { hashPassword } = await import('../../api/_utils/user-auth.js');
    const str = (id, kind, { finess = null, verified = 'VERIFIED' } = {}) => sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, numero_finess, "updatedAt", "createdAt")
      VALUES (${id}, ${'Fixture ' + id}, ${id}, ${kind}, '1 rue Fixture', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', ${verified}, ${finess}, NOW(), NOW())`;
    await db.execute(str(S.ccas, 'CCAS')); await db.execute(str(S.asso, 'Association')); await db.execute(str(S.hlm, 'Bailleur social'));
    await db.execute(str(S.ehpad, 'Établissement d’hébergement pour personnes âgées dépendantes (EHPAD)'));
    await db.execute(str(S.finess, 'Association', { finess: `67${T}`.slice(0, 9) })); await db.execute(str(S.unverified, 'Association', { verified: 'UNVERIFIED' }));
    await db.execute(str(S.unknown, 'Organisation'));
    for (const [k, id] of Object.entries(P)) {
      await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "updatedAt") VALUES (${id}, ${`${id}@example.test`}, 'x', 'PRO', 'active', ${S[k]}, NOW())`);
    }
    for (const sid of [S.finess, S.unverified, S.unknown]) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "updatedAt") VALUES (${sid + '-u'}, ${`${sid}-u@example.test`}, 'x', 'PRO', 'active', ${sid}, NOW())`);
    const h = await hashPassword(PASS);
    for (const id of Object.values(C)) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", phone, "updatedAt") VALUES (${id}, ${`${id}@example.test`}, ${h}, NOW(), '+33600000000', NOW())`);
    notices = [];
    const notify = async (m) => { notices.push(m); return {}; };
    pro = svc.socialReferralsPro({ db, notify }); citizen = svc.socialReferralsCitizen({ db, notify });
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "SocialReferral" WHERE "fromStructureId" LIKE ${'g14ps-%'}`);
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity = 'SocialReferral' AND actor_id LIKE ${'g14ps-%'}`);
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id LIKE ${'g14ps-%'}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id LIKE ${'g14ps-%'}`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" LIKE ${'g14ps-%'}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id LIKE ${'g14ps-%'}`);
    await db.execute(sql.raw(fs.readFileSync('drizzle/pending/0061_down.sql', 'utf8')));
    svc.forgetSocialReferralSchema(db);
  });

  it('eligible receivers: only verified, active, FINESS-free, reviewed non-medical kinds (never itself)', async () => {
    const out = await pro.receivers(ctx('ccas'), 'Fixture g14ps');
    const ids = out.receivers.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([S.asso, S.hlm]));
    for (const bad of [S.ehpad, S.finess, S.unverified, S.unknown, S.ccas]) expect(ids).not.toContain(bad);
  });
  it('refused: no second factor, an ESSMS / FINESS / unknown / unverified receiver, an ESSMS sender', async () => {
    expect(await pro.propose(ctx('ccas', false), { toStructureId: S.asso, reasonCodes: ['HOUSING'] })).toMatchObject({ status: 403, code: 'MFA_REQUIRED' });
    for (const to of [S.ehpad, S.finess, S.unknown, S.unverified]) expect(await pro.propose(ctx('ccas'), { toStructureId: to, reasonCodes: ['HOUSING'] }), to).toMatchObject({ status: 422, code: 'RECEIVER_NOT_ELIGIBLE' });
    expect(await pro.propose(ctx('ehpad'), { toStructureId: S.asso, reasonCodes: ['HOUSING'] })).toMatchObject({ status: 403, code: 'STRUCTURE_NOT_ELIGIBLE' });
    expect(Number((await one(sql`SELECT count(*)::int AS n FROM "SocialReferral" WHERE "fromStructureId" LIKE ${'g14ps-%'}`)).n)).toBe(0);
  });
  it('the database itself refuses a reason outside the list and a free motive', async () => {
    await expect(db.execute(sql`INSERT INTO "SocialReferral" (id, "fromStructureId", "toStructureId", status, "reasonCodes", "updatedAt") VALUES (${'g14ps-x-' + T}, ${S.ccas}, ${S.asso}, 'PENDING_CITIZEN', '{HEALTH}'::text[], NOW())`)).rejects.toThrow();
    await expect(db.execute(sql`INSERT INTO "SocialReferral" (id, "fromStructureId", "toStructureId", status, "reasonCodes", "updatedAt") VALUES (${'g14ps-y-' + T}, ${S.ccas}, ${S.asso}, 'SENT', '{HOUSING}'::text[], NOW())`)).rejects.toThrow();   // sent without consent
  });

  let r1; let code1;
  it('consent required: proposal → code → the person claims it → nothing visible to the receiver before acceptance', async () => {
    const out = await pro.propose(ctx('ccas'), { toStructureId: S.asso, reasonCodes: ['HOUSING', 'INCOME_BUDGET'], idempotencyKey: `g14ps-key-${T}` });
    expect(out).toMatchObject({ status: 201, referral: { status: 'PENDING_CITIZEN' } });
    r1 = out.referral.id; code1 = out.code;
    expect((await one(sql`SELECT "claimCodeHash" AS h FROM "SocialReferral" WHERE id = ${r1}`)).h).not.toContain(code1.replace('-', ''));
    expect(await pro.propose(ctx('ccas'), { toStructureId: S.asso, reasonCodes: ['HOUSING'], idempotencyKey: `g14ps-key-${T}` })).toMatchObject({ replay: true, code: null });
    expect((await pro.list(ctx('asso'), 'inbox')).referrals.map((r) => r.id)).not.toContain(r1);
    expect(await pro.get(ctx('asso'), r1)).toMatchObject({ status: 404 });
    expect(await pro.answer(ctx('asso'), r1, 'accept')).toMatchObject({ status: 404 });
    expect(await citizen.claim(C.anna, 'ZZZZZ-ZZZZZ')).toMatchObject({ status: 404, code: 'INVALID_CODE' });
    expect(await citizen.claim(C.anna, code1.toLowerCase())).toMatchObject({ ok: true });
    expect(await citizen.claim(C.other, code1)).toMatchObject({ status: 404 });   // already attached to another account
    expect((await citizen.list(C.anna)).referrals[0]).toMatchObject({ id: r1, status: 'PENDING_CITIZEN', from: `Fixture ${S.ccas}`, to: `Fixture ${S.asso}` });
  });
  it('acceptance with the chosen contact: SENT, ConsentLog, events; the receiver sees reasons and ONLY the ticked contact', async () => {
    expect(await citizen.decide(C.anna, { id: r1, decision: 'accept', shareEmail: true, sharePhone: false })).toMatchObject({ ok: true, referral: { status: 'SENT' } });
    expect(await citizen.decide(C.anna, { id: r1, decision: 'accept' })).toMatchObject({ status: 409 });
    const c = await one(sql`SELECT decision, purpose, collection_channel, proof_level FROM "ConsentLog" WHERE subject_id = ${C.anna} AND policy_hash LIKE ${'%' + r1}`);
    expect(c).toMatchObject({ decision: true, purpose: 'SOCIAL_REFERRAL', collection_channel: 'account', proof_level: 'AUTHENTICATED_SESSION' });
    const seen = await pro.get(ctx('asso'), r1);
    expect(seen).toMatchObject({ side: 'receiver', referral: { status: 'SENT', reasonCodes: ['HOUSING', 'INCOME_BUDGET'], contact: { email: `${C.anna}@example.test`, phone: null } } });
    const sender = await pro.get(ctx('ccas'), r1);
    expect(sender.referral.contact).toBeNull();
    expect(await pro.get(ctx('hlm'), r1)).toMatchObject({ status: 404 });
    expect(notices.some((n) => n.structureId === S.asso && n.type === 'social_referral_update')).toBe(true);
    expect(JSON.stringify(notices)).not.toContain('example.test');
  });
  it('statuses visible to the person and both organisations; receiver accepts; the person withdraws at any time (contact hidden)', async () => {
    expect(await pro.answer(ctx('asso'), r1, 'accept')).toMatchObject({ referral: { status: 'ACCEPTED' } });
    expect(await pro.answer(ctx('asso'), r1, 'accept')).toMatchObject({ status: 409 });
    expect((await pro.list(ctx('ccas'), 'outbox')).referrals.find((r) => r.id === r1).status).toBe('ACCEPTED');
    expect((await citizen.list(C.anna)).referrals[0]).toMatchObject({ status: 'ACCEPTED', canWithdraw: true });
    expect(await citizen.withdraw(C.other, r1)).toMatchObject({ status: 404 });
    expect(await citizen.withdraw(C.anna, r1)).toMatchObject({ referral: { status: 'WITHDRAWN' } });
    expect((await pro.get(ctx('asso'), r1)).referral).toMatchObject({ status: 'WITHDRAWN', contact: null });
    expect(await pro.answer(ctx('asso'), r1, 'complete')).toMatchObject({ status: 409 });
    const w = await one(sql`SELECT decision, withdrawn_at FROM "ConsentLog" WHERE subject_id = ${C.anna} AND policy_hash LIKE ${'%' + r1} AND decision = false`);
    expect(w.withdrawn_at).toBeTruthy();
    const ev = (await db.execute(sql`SELECT "actorType", "toStatus" FROM "SocialReferralEvent" WHERE "referralId" = ${r1} ORDER BY "createdAt", id`)).rows.map((e) => `${e.actorType}:${e.toStatus}`);
    expect(ev).toEqual(['SENDER:PENDING_CITIZEN', 'CITIZEN:SENT', 'RECEIVER:ACCEPTED', 'CITIZEN:WITHDRAWN']);
    await expect(db.execute(sql`UPDATE "SocialReferralEvent" SET "toStatus" = 'COMPLETED' WHERE "referralId" = ${r1}`)).rejects.toThrow();   // append-only
    expect((await one(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE entity = 'SocialReferral' AND entity_id = ${r1}`)).n).toBeGreaterThanOrEqual(2);
  });
  it('assisted consent on the professional screen: wrong password refused generically, right one consents with its channel', async () => {
    const out = await pro.propose(ctx('ccas'), { toStructureId: S.hlm, reasonCodes: ['HOUSING'] });
    const id = out.referral.id;
    expect(await pro.assistedConsent(ctx('ccas'), { id, email: `${C.anna}@example.test`, password: 'faux', decision: 'accept' })).toMatchObject({ status: 403, code: 'INVALID_CREDENTIALS' });
    expect(await pro.assistedConsent(ctx('ccas'), { id, email: 'nobody@example.test', password: PASS, decision: 'accept' })).toMatchObject({ status: 403, code: 'INVALID_CREDENTIALS' });
    expect(await pro.assistedConsent(ctx('asso'), { id, email: `${C.anna}@example.test`, password: PASS, decision: 'accept' })).toMatchObject({ status: 403 });   // not the sender
    const ok = await pro.assistedConsent(ctx('ccas'), { id, email: `${C.anna}@example.test`, password: PASS, decision: 'accept', sharePhone: true });
    expect(ok).toMatchObject({ referral: { status: 'SENT' } });
    expect(JSON.stringify(ok)).not.toContain('example.test');
    expect(await one(sql`SELECT "consentChannel", "citizenId", "sharePhone" FROM "SocialReferral" WHERE id = ${id}`)).toEqual({ consentChannel: 'ASSISTED_ON_SCREEN', citizenId: C.anna, sharePhone: true });
    expect(await one(sql`SELECT proof_level FROM "ConsentLog" WHERE policy_hash LIKE ${'%' + id}`)).toEqual({ proof_level: 'REAUTHENTICATED_PASSWORD' });
    expect(await pro.answer(ctx('hlm'), id, 'decline', 'NO_CAPACITY')).toMatchObject({ referral: { status: 'DECLINED' } });
    expect((await citizen.list(C.anna)).referrals.find((r) => r.id === id)).toMatchObject({ status: 'DECLINED', responseCode: 'NO_CAPACITY', canWithdraw: false });
  });
  it('refusal by the person and cancellation by the sender share nothing', async () => {
    const a = await pro.propose(ctx('ccas'), { toStructureId: S.hlm, reasonCodes: ['FOOD'] });
    await citizen.claim(C.other, a.code);
    expect(await citizen.decide(C.other, { id: a.referral.id, decision: 'refuse' })).toMatchObject({ referral: { status: 'CANCELLED' } });
    expect(await pro.get(ctx('hlm'), a.referral.id)).toMatchObject({ status: 404 });
    const b = await pro.propose(ctx('ccas'), { toStructureId: S.hlm, reasonCodes: ['MOBILITY'] });
    expect(await pro.cancel(ctx('asso'), b.referral.id)).toMatchObject({ status: 404 });
    expect(await pro.cancel(ctx('ccas'), b.referral.id)).toMatchObject({ referral: { status: 'CANCELLED' } });
    expect(await citizen.claim(C.anna, b.code)).toMatchObject({ status: 404 });
  });
  it('timeouts (existing referral-timeouts job): unused code expires; overdue reminder once; expiry 14 days after due; idle acceptance closed', async () => {
    const a = await pro.propose(ctx('ccas'), { toStructureId: S.asso, reasonCodes: ['DIGITAL'] });
    await db.execute(sql`UPDATE "SocialReferral" SET "claimExpiresAt" = NOW() - interval '1 day' WHERE id = ${a.referral.id}`);
    const b = await pro.propose(ctx('ccas'), { toStructureId: S.asso, reasonCodes: ['ENERGY'] });
    await citizen.claim(C.anna, b.code); await citizen.decide(C.anna, { id: b.referral.id, decision: 'accept' });
    await db.execute(sql`UPDATE "SocialReferral" SET "dueAt" = NOW() - interval '1 day' WHERE id = ${b.referral.id}`);
    const sent = []; const notify = async (m) => { sent.push(m); return {}; };
    const s1 = await svc.runSocialReferralTimeouts({ notify }, db);
    expect(s1.socialCodeExpired).toBeGreaterThanOrEqual(1); expect(s1.socialOverdueNotified).toBeGreaterThanOrEqual(1);
    expect((await one(sql`SELECT status FROM "SocialReferral" WHERE id = ${a.referral.id}`)).status).toBe('EXPIRED');
    expect((await svc.runSocialReferralTimeouts({ notify }, db)).socialOverdueNotified).toBe(0);
    await db.execute(sql`UPDATE "SocialReferral" SET "dueAt" = NOW() - interval '15 days' WHERE id = ${b.referral.id}`);
    expect((await svc.runSocialReferralTimeouts({ notify }, db)).socialExpired).toBeGreaterThanOrEqual(1);
    expect((await pro.get(ctx('asso'), b.referral.id)).referral).toMatchObject({ status: 'EXPIRED', contact: null });
  });
  it('the export of the person lists their social referrals; the account erasure removes them (cascade)', async () => {
    const rows = (await db.execute(svc.socialReferralsExportSql(C.anna))).rows;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(rows[0])).not.toContain('claimCodeHash');
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${C.other}`);
    expect((await one(sql`SELECT count(*)::int AS n FROM "SocialReferral" WHERE "citizenId" = ${C.other}`)).n).toBe(0);
  });
});
