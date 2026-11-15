/**
 * Referral chain — « a referral never silently disappears » — on REAL PostgreSQL (migration 0022, no new migration), through the real handlers, with three
 * synthetic organizations: X (sender: admin, x1, x2) · Y and Z (verified receivers).
 *   G1  the person withdraws the receiver's access (one organization, or « stop sharing »): the live referral ends (CANCELLED, outcome CITIZEN_WITHDREW,
 *       ReferralEvent by CITIZEN) in the same transaction, both organizations are told in-app, the person sees it closed, a new referral to Y is possible
 *   G2  no proposal on a dossier nobody can answer for (no verified account); a proposal the person never answers is closed by the cron, the sender is told
 *   G4  the person is told of a cancellation by the sender and of an expiry; ONE list of states behind « overdue » (lists and cron); ACCEPTED without a
 *       recorded step is flagged (flag only)
 *   G6  a departing member's pending proposals go to the successor (or to the administrator recording the departure)
 *   G8  the sending organization's colleague without access to the case sees neither the dossier nor the reason; an appointment linked to a referral must be
 *       the appointment of the person the dossier belongs to
 * Synthetic data only; the mailer is the in-memory 'test' provider. Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));   // KV-backed quota = infrastructure, not under test
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const S = { X: `vg-X-${TS}`, Y: `vg-Y-${TS}`, Z: `vg-Z-${TS}` };
const P = { admin: { id: `vg-adm-${TS}`, st: S.X, role: 'STRUCTURE_ADMIN' }, x1: { id: `vg-x1-${TS}`, st: S.X, role: 'PRO' }, x2: { id: `vg-x2-${TS}`, st: S.X, role: 'PRO' },
  y: { id: `vg-y-${TS}`, st: S.Y, role: 'PRO' }, z: { id: `vg-z-${TS}`, st: S.Z, role: 'PRO' } };
const CIT = { id: `vg-cit-${TS}`, email: `vg-cit-${TS}@example.test` };
const OTHER = { id: `vg-other-${TS}`, email: `vg-other-${TS}@example.test` };
const DOSSIER = `vg-dos-${TS}`; const ORPHAN = `vg-orphan-${TS}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('referral chain gaps G1 G2 G4 G6 G8 (real DB, three organizations)', () => {
  let db, auth, userAuth, H, mailer, svc;
  let caseId, orphanCaseId;
  const tok = (p) => auth.signProToken({ id: p.id, email: `${p.id}@example.test`, structureId: p.st, role: p.role });
  const pro = async (h, p, { method = 'GET', query = {}, body, url = '/api/pro/x' } = {}) => { const r = mk(); await h({ method, url, query, body, headers: { host: 'localhost', authorization: `Bearer ${tok(p)}` } }, r); return r; };
  const cit = async (h, { method = 'GET', query = {}, body } = {}) => { const r = mk(); const c = userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: CIT.id, email: CIT.email })).split(';')[0];
    await h({ method, url: '/api/x', query, body, headers: { host: 'localhost', cookie: c } }, r); return r; };
  const ref = (p, body) => pro(H.refs, p, { method: 'POST', body });
  const one = (p, id) => pro(H.refs, p, { query: { id } });
  const box = async (p, name, id) => (await pro(H.refs, p, { query: { box: name } })).body.referrals.find((r) => r.id === id);
  const decide = (id, decision = 'accept') => cit(H.citRefs, { method: 'POST', body: { id, decision } });
  const owner = (action, extra = {}) => cit(H.grants, { method: 'POST', body: { shareId: DOSSIER, action, ...extra } });
  const row = async (id) => (await db.execute(sql`SELECT * FROM "Referral" WHERE id = ${id}`)).rows[0];
  const trail = async (id) => (await db.execute(sql`SELECT "actorType" AS actor, "fromStatus" AS "from", "toStatus" AS "to" FROM "ReferralEvent" WHERE "referralId" = ${id} ORDER BY "createdAt"`)).rows;
  const grantActive = async (st) => (await db.execute(sql`SELECT count(*)::int n FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${DOSSIER} AND "structureId" = ${st} AND "revokedAt" IS NULL`)).rows[0].n;
  const notices = async (st, type, id) => (await db.execute(sql`SELECT title, message FROM "ProNotification" WHERE "structureId" = ${st} AND type = ${type} AND metadata->>'referralId' = ${id}`)).rows;
  const citizenNotices = async (id) => (await db.execute(sql`SELECT details->>'kind' AS k FROM "AuditLog" WHERE action = 'REFERRAL_CITIZEN_NOTICE' AND entity_id = ${id} ORDER BY timestamp`)).rows.map((r) => r.k);
  const toCit = () => mailer.__getTestOutbox().filter((m) => m.to === CIT.email);
  const cron = async () => { const r = mk(); await H.cron({ method: 'GET', url: '/api/cron/referral-timeouts', query: {}, headers: { 'x-cron-secret': process.env.CRON_SECRET } }, r); return r.body; };
  /** every live referral of the test dossiers is ended directly (fixture reset between scenarios: one live referral per receiver) */
  const free = () => db.execute(sql`UPDATE "Referral" SET status = 'CANCELLED', "closedAt" = NOW() WHERE "sharedDiagnosticId" IN (${DOSSIER}, ${ORPHAN}) AND status NOT IN ('EXPIRED', 'CANCELLED', 'CLOSED', 'COMPLETED', 'DECLINED')`);
  const propose = async (to, extra = {}, by = P.x1) => { const p = await ref(by, { action: 'propose', caseId, toStructureId: to, reasonCode: 'HOUSING', ...extra }); expect(p.statusCode, JSON.stringify(p.body)).toBe(201); return p.body.referral.id; };
  const sent = async (to) => { const id = await propose(to); expect((await decide(id)).statusCode).toBe(200); return id; };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js'); mailer = await import('../../api/_utils/mailer.js');
    svc = await import('../../api/_services/referrals.js');
    H = { cases: (await import('../../api/_handlers/pro/cases.js')).default, refs: (await import('../../api/_handlers/pro/referrals.js')).default, team: (await import('../../api/_handlers/pro/team.js')).default,
      citRefs: (await import('../../api/_handlers/citizen/referrals.js')).default, grants: (await import('../../api/_handlers/public/dossier-grants.js')).default,
      cron: (await import('../../api/_handlers/cron/referral-timeouts.js')).default };
    for (const id of Object.values(S)) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${id}, ${'Org ' + id.split('-')[1]}, ${id}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    }
    for (const p of Object.values(P)) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${p.id}, ${p.id + '@example.test'}, 'x', ${p.role}, 'active', ${p.st}, false, NOW())`);
    for (const c of [CIT, OTHER]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
    for (const [id, own] of [[DOSSIER, CIT.id], [ORPHAN, null]]) {
      await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId") VALUES (${id}, NOW() + interval '30 days', '{}'::jsonb, '{}'::jsonb, 0, ${'h' + id}, ${'t' + id}, 'GUEST_SHARE', ${own})`);
      await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", "grantedVia") VALUES (${'g-' + id}, ${id}, ${S.X}, ${P.x1.id}, 'invite')`);
    }
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
    const queue = (await pro(H.cases, P.x1, { query: { scope: 'unassigned' } })).body.cases;
    caseId = queue.find((c) => c.dossierId === DOSSIER).id; orphanCaseId = queue.find((c) => c.dossierId === ORPHAN).id;
    expect((await pro(H.cases, P.admin, { method: 'POST', body: { action: 'assign', id: caseId, userId: P.x1.id } })).statusCode).toBe(200);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'shareId' IN (${DOSSIER}, ${ORPHAN})`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity = 'Referral' AND entity_id IN (SELECT id FROM "Referral" WHERE "sharedDiagnosticId" IN (${DOSSIER}, ${ORPHAN}))`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" IN (${S.X}, ${S.Y}, ${S.Z})`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" IN (${S.X}, ${S.Y}, ${S.Z})`);
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id IN (${DOSSIER}, ${ORPHAN})`);
    await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" IN (${S.X}, ${S.Y}, ${S.Z})`);
    await db.execute(sql`DELETE FROM "ProAuditLog" WHERE "structureId" IN (${S.X}, ${S.Y}, ${S.Z})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${S.X}, ${S.Y}, ${S.Z})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${S.X}, ${S.Y}, ${S.Z})`);
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id IN (${CIT.id}, ${OTHER.id})`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${CIT.id}, ${OTHER.id})`);
  });

  it('G2: a dossier without a verified account takes no proposal (nothing is written); with one, the sender learns whether the person was e-mailed', async () => {
    const no = await ref(P.x1, { action: 'propose', caseId: orphanCaseId, toStructureId: S.Y, reasonCode: 'HOUSING' });
    expect(no.statusCode).toBe(409); expect(no.body.error).toBe('NO_CITIZEN_ACCOUNT'); expect(no.body.message).toMatch(/compte vérifié/);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "Referral" WHERE "sharedDiagnosticId" = ${ORPHAN}`)).rows[0].n).toBe(0);
    // an account whose e-mail is not verified cannot sign in to decide either
    await db.execute(sql`UPDATE "CitizenUser" SET "emailVerifiedAt" = NULL WHERE id = ${CIT.id}`);
    expect((await ref(P.x1, { action: 'propose', caseId, toStructureId: S.Y, reasonCode: 'HOUSING' })).body.error).toBe('NO_CITIZEN_ACCOUNT');
    await db.execute(sql`UPDATE "CitizenUser" SET "emailVerifiedAt" = NOW() WHERE id = ${CIT.id}`);
    const ok = await ref(P.x1, { action: 'propose', caseId, toStructureId: S.Y, reasonCode: 'HOUSING' });
    expect(ok.statusCode, JSON.stringify(ok.body)).toBe(201); expect(ok.body.referral.citizenNotified).toBe(true);
    await free();
  });

  it('G1 full scenario: X→Y accepted, the person revokes Y ⇒ referral closed in the same transaction, both organizations told, a new referral to Y is possible', async () => {
    const id = await sent(S.Y);
    expect((await ref(P.y, { action: 'accept', id })).statusCode).toBe(200);
    expect(await grantActive(S.Y)).toBe(1);
    const out = await owner('revoke', { structureId: S.Y });
    expect(out.statusCode, JSON.stringify(out.body)).toBe(200);
    expect(await grantActive(S.Y), 'the access is released as before').toBe(0);
    expect(await row(id)).toMatchObject({ status: 'CANCELLED', outcome: 'CITIZEN_WITHDREW' }); expect((await row(id)).closedAt).not.toBeNull();
    const events = await trail(id);
    expect(events[events.length - 1]).toEqual({ actor: 'CITIZEN', from: 'ACCEPTED', to: 'CANCELLED' });
    // both organizations are told in-app through the existing catalogue event (identifiers only: no name, no free text about the person)
    for (const st of [S.X, S.Y]) {
      const n = await notices(st, 'referral_cancelled', id);
      expect(n.length, st).toBeGreaterThanOrEqual(1); expect(n[0].title).toBe('Orientation close : accès retiré par la personne');
      expect(JSON.stringify(n)).not.toMatch(/@|vg-cit/);
    }
    expect((await db.execute(sql`SELECT count(*)::int n FROM "ProNotification" WHERE "structureId" = ${S.Z}`)).rows[0].n, 'nobody else').toBe(0);
    // the person sees the closed state; each side sees it too
    expect((await cit(H.citRefs)).body.referrals.find((r) => r.id === id)).toMatchObject({ status: 'CANCELLED', outcome: 'CITIZEN_WITHDREW' });
    expect((await one(P.x1, id)).body.referral.status).toBe('CANCELLED'); expect((await one(P.y, id)).body.referral).toMatchObject({ status: 'CANCELLED', dossierId: null });
    // nothing is left half-open: the receiver cannot complete, the sender has nothing to cancel
    expect((await ref(P.y, { action: 'complete', id, outcome: 'SUPPORT_COMPLETED' })).statusCode).toBe(409);
    expect((await ref(P.x1, { action: 'cancel', id })).statusCode).toBe(409);
    expect((await db.execute(sql`SELECT details->>'referralsClosed' AS n FROM "AuditLog" WHERE action = 'DOSSIER_ACCESS_REVOKED_BY_OWNER' AND details->>'structureId' = ${S.Y} ORDER BY timestamp DESC LIMIT 1`)).rows[0].n).toBe('1');
    // the live key is free: a new referral to Y, with the person's new consent, opens a new access
    const again = await sent(S.Y);
    expect(again).not.toBe(id); expect(await grantActive(S.Y)).toBe(1); expect((await row(again)).status).toBe('SENT');
    // revoking twice changes nothing more (404: no active access), the closed referral is not touched again
    await free(); await db.execute(sql`UPDATE "SharedDossierGrant" SET "revokedAt" = NOW() WHERE "sharedDiagnosticId" = ${DOSSIER} AND "structureId" = ${S.Y}`);
    expect((await owner('revoke', { structureId: S.Y })).statusCode).toBe(404);
    expect((await trail(id)).filter((e) => e.actor === 'CITIZEN' && e.to === 'CANCELLED')).toHaveLength(1);
  });

  it('G1: « stop sharing » ends every live referral of the dossier; a proposal not yet authorized stays the person\'s to decide', async () => {
    const live = await sent(S.Y);
    expect((await ref(P.y, { action: 'accept', id: live })).statusCode).toBe(200);
    expect((await ref(P.y, { action: 'start', id: live })).statusCode).toBe(200);
    const pending = await propose(S.Z);
    const out = await owner('stop_sharing');
    expect(out.statusCode, JSON.stringify(out.body)).toBe(200); expect(out.body.referralsClosed).toBe(1); expect(out.body.referrals).toBeUndefined();
    expect(await row(live)).toMatchObject({ status: 'CANCELLED', outcome: 'CITIZEN_WITHDREW' });
    expect((await trail(live)).pop()).toEqual({ actor: 'CITIZEN', from: 'IN_PROGRESS', to: 'CANCELLED' });
    expect((await notices(S.X, 'referral_cancelled', live)).length).toBeGreaterThanOrEqual(1); expect((await notices(S.Y, 'referral_cancelled', live)).length).toBeGreaterThanOrEqual(1);
    expect((await row(pending)).status, 'nothing was shared: not a withdrawn access').toBe('PENDING_CITIZEN');
    expect(await grantActive(S.X)).toBe(0); expect(await grantActive(S.Y)).toBe(0);
    await db.execute(sql`UPDATE "SharedDossierGrant" SET "revokedAt" = NULL WHERE "sharedDiagnosticId" = ${DOSSIER} AND "structureId" = ${S.X}`);   // fixture: X is invited again
    await free();
  });

  it('G1: the closure and the revocation are one transaction (a failing ledger write leaves the access and the referral as they were)', async () => {
    const id = await sent(S.Y);
    expect((await ref(P.y, { action: 'accept', id })).statusCode).toBe(200);
    await db.execute(sql`CREATE OR REPLACE FUNCTION vg_refuse_event() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'vg refused'; END $$ LANGUAGE plpgsql`);
    await db.execute(sql`CREATE TRIGGER vg_refuse_event BEFORE INSERT ON "ReferralEvent" FOR EACH ROW EXECUTE FUNCTION vg_refuse_event()`);
    try {
      expect((await owner('revoke', { structureId: S.Y })).statusCode).toBe(500);
      expect((await row(id)).status).toBe('ACCEPTED'); expect(await grantActive(S.Y)).toBe(1);
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS vg_refuse_event ON "ReferralEvent"`); await db.execute(sql`DROP FUNCTION IF EXISTS vg_refuse_event()`);
    }
    expect((await owner('revoke', { structureId: S.Y })).statusCode).toBe(200);
    expect((await row(id)).status).toBe('CANCELLED');
  });

  it('G2: a proposal the person never answers is closed by the cron after the delay; the sender and the person are told; a failed notice is retried', async () => {
    const young = await propose(S.Z); const old = await propose(S.Y);
    await db.execute(sql`UPDATE "Referral" SET "createdAt" = NOW() - make_interval(days => ${svc.PENDING_CITIZEN_EXPIRE_DAYS - 1}) WHERE id = ${young}`);
    await db.execute(sql`UPDATE "Referral" SET "createdAt" = NOW() - make_interval(days => ${svc.PENDING_CITIZEN_EXPIRE_DAYS + 1}) WHERE id = ${old}`);
    mailer.__clearTestOutbox();
    const s1 = await svc.runReferralTimeouts({ notifyImpl: async () => ({ inApp: 0, email: { NOT_DELIVERED: 1 } }) });   // members exist, nothing stored
    expect(s1.pendingCitizenExpired).toBe(1); expect(s1.pendingCitizenNoticeFailed).toBe(1);
    expect(await row(old)).toMatchObject({ status: 'CANCELLED', grantId: null }); expect((await row(young)).status).toBe('PENDING_CITIZEN');
    expect((await trail(old)).pop()).toEqual({ actor: 'SYSTEM', from: 'PENDING_CITIZEN', to: 'CANCELLED' });
    expect(toCit().map((m) => m.subject)).toEqual(['Une proposition d’orientation n’est plus valable']);
    expect(await citizenNotices(old)).toEqual(['PENDING_CITIZEN', 'PENDING_EXPIRED']);
    expect(await grantActive(S.Y), 'nothing was ever shared').toBe(0);
    const s2 = await cron();   // the real notifier: the failed notice is tried again and stored
    expect(s2.expiredNoticeRetried).toBeGreaterThanOrEqual(1); expect(s2.pendingCitizenExpired).toBe(0);
    const n = await notices(S.X, 'referral_expired', old);
    expect(n.length).toBeGreaterThanOrEqual(1); expect(n[0].title).toBe('Orientation sans accord de la personne');
    expect((await cron()).expiredNoticeRetried, 'not again once stored').toBe(0);
    expect((await decide(old)).statusCode, 'a closed proposal cannot be accepted').toBe(409);
    await propose(S.Y);   // the sender can propose again
    await free();
  });

  it('G4: the person is told when the sender cancels and when a referral expires', async () => {
    const pending = await propose(S.Y);
    mailer.__clearTestOutbox();
    expect((await ref(P.x1, { action: 'cancel', id: pending })).statusCode).toBe(200);
    expect(toCit().map((m) => m.subject)).toEqual(['Une orientation a été annulée']); expect(toCit()[0].text).toContain('Rien n’a été transmis');
    const live = await sent(S.Y);
    mailer.__clearTestOutbox();
    expect((await ref(P.x1, { action: 'cancel', id: live })).statusCode).toBe(200);
    expect(toCit()[0].text).toContain('L’accès ouvert par cette orientation est retiré'); expect(toCit()[0].text).not.toMatch(/HOUSING|Org /);
    expect(await citizenNotices(live)).toEqual(['PENDING_CITIZEN', 'CANCELLED']);
    const stale = await sent(S.Y);
    await db.execute(sql`UPDATE "Referral" SET "dueAt" = NOW() - interval '15 days', "overdueNotifiedAt" = NOW() WHERE id = ${stale}`);
    mailer.__clearTestOutbox();
    expect((await cron()).expired).toBeGreaterThanOrEqual(1);
    expect((await row(stale)).status).toBe('EXPIRED'); expect(await grantActive(S.Y)).toBe(0);
    expect(toCit().map((m) => m.subject)).toEqual(['Votre orientation n’a pas reçu de réponse']);
    expect(await citizenNotices(stale)).toEqual(['PENDING_CITIZEN', 'EXPIRED']);
    expect((await cron()).expired, 'once').toBe(0); expect(toCit()).toHaveLength(1);
    await free();
  });

  it('G4: « overdue » is the same list of states in the lists and in the cron; an ACCEPTED referral without a recorded step is flagged only', async () => {
    const share = await import('../../api/_utils/share-access.js');
    expect(svc.AWAITING_ANSWER_STATUSES).toBe(share.REFERRAL_AWAITING_ANSWER_STATUSES); expect([...svc.AWAITING_ANSWER_STATUSES]).toEqual(['SENT', 'ACKNOWLEDGED', 'NEEDS_INFO']);
    const a = await sent(S.Y); const b = await sent(S.Z);
    expect((await ref(P.y, { action: 'acknowledge', id: a })).statusCode).toBe(200);
    expect((await ref(P.z, { action: 'needs_info', id: b, message: 'Quel quartier ?' })).statusCode).toBe(200);
    expect((await box(P.x1, 'outbox', a)).overdue).toBe(false);
    await db.execute(sql`UPDATE "Referral" SET "dueAt" = NOW() - interval '1 day' WHERE id IN (${a}, ${b})`);
    for (const [who, name, id] of [[P.x1, 'outbox', a], [P.y, 'inbox', a], [P.x1, 'outbox', b], [P.z, 'inbox', b]]) expect((await box(who, name, id)).overdue, `${name} ${id === a ? 'ACKNOWLEDGED' : 'NEEDS_INFO'}`).toBe(true);
    expect((await cron()).overdueNotified).toBe(2);
    expect((await notices(S.X, 'referral_overdue', a)).length).toBeGreaterThanOrEqual(1); expect((await notices(S.X, 'referral_overdue', b)).length).toBeGreaterThanOrEqual(1);
    expect((await cron()).overdueNotified, 'once each').toBe(0);
    // accepted, then nothing: flagged for a human after the delay — the state itself is untouched, nothing is sent or claimed
    expect((await ref(P.y, { action: 'accept', id: a })).statusCode).toBe(200);
    expect((await box(P.y, 'inbox', a))).toMatchObject({ overdue: false, stalled: false });
    await db.execute(sql`UPDATE "Referral" SET "respondedAt" = NOW() - make_interval(days => ${svc.ACCEPTED_NO_PROGRESS_DAYS + 1}) WHERE id = ${a}`);
    expect((await box(P.y, 'inbox', a)).stalled).toBe(true); expect((await box(P.x1, 'outbox', a)).stalled).toBe(true);
    const before = await cron();
    expect((await row(a)).status, 'the cron never moves an accepted referral').toBe('ACCEPTED'); expect(before.expired).toBe(0);
    expect((await ref(P.y, { action: 'start', id: a })).statusCode).toBe(200);
    expect((await box(P.y, 'inbox', a)).stalled).toBe(false);
    await free();
  });

  it('G8: a colleague without access to the case sees the state only; a linked appointment must be the appointment of the dossier\'s person', async () => {
    const id = await sent(S.Y);
    // the case is assigned to x1: x2 (same organization) sees that a referral exists and where it stands — not the dossier, not the reason
    const seen = await box(P.x2, 'outbox', id);
    expect(seen).toMatchObject({ status: 'SENT', dossierId: null, reasonCode: null }); expect(seen.caseOpen).toBeUndefined();
    const detail = (await one(P.x2, id)).body;
    expect(detail.side).toBe('SENDER'); expect(detail.referral).toMatchObject({ status: 'SENT', dossierId: null, reasonCode: null, message: '', outcomeSummary: null });
    expect(JSON.stringify(detail)).not.toContain(DOSSIER);
    for (const who of [P.x1, P.admin]) {
      expect(await box(who, 'outbox', id), who.id).toMatchObject({ dossierId: DOSSIER, reasonCode: 'HOUSING' });
      expect((await one(who, id)).body.referral, who.id).toMatchObject({ dossierId: DOSSIER, reasonCode: 'HOUSING' });
    }
    expect((await one(P.y, id)).body.referral, 'the receiver side is unchanged').toMatchObject({ dossierId: DOSSIER, reasonCode: 'HOUSING' });
    // appointments of the receiving organization: one of the dossier's person, one of someone else, one of another organization
    expect((await ref(P.y, { action: 'accept', id })).statusCode).toBe(200);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${'svc-y-' + TS}, ${S.Y}, 'S', 30, NOW()), (${'svc-z-' + TS}, ${S.Z}, 'S', 30, NOW())`);
    const apt = (aid, st, svcId, citizen, h) => db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "beneficiaryPhone", "createdByProUserId", "citizenUserId", "createdAt", "updatedAt")
      VALUES (${aid}, ${st}, ${svcId}, NOW() + make_interval(days => 3, hours => ${h}), NOW() + make_interval(days => 3, hours => ${h}, mins => 30), 'confirmed', 'Personne Test', '0600000000', NULL, ${citizen}, NOW(), NOW())`);
    await apt(`apt-own-${TS}`, S.Y, 'svc-y-' + TS, CIT.id, 1); await apt(`apt-other-${TS}`, S.Y, 'svc-y-' + TS, OTHER.id, 2);
    await apt(`apt-none-${TS}`, S.Y, 'svc-y-' + TS, null, 3); await apt(`apt-z-${TS}`, S.Z, 'svc-z-' + TS, CIT.id, 4);
    for (const bad of [`apt-other-${TS}`, `apt-none-${TS}`, `apt-z-${TS}`, 'unknown']) {
      const r = await ref(P.y, { action: 'link_appointment', id, appointmentId: bad });
      expect(r.statusCode, bad).toBe(400); expect(r.body.error, bad).toBe('INVALID_APPOINTMENT');
    }
    expect(await row(id)).toMatchObject({ status: 'ACCEPTED', appointmentId: null });
    const linked = await ref(P.y, { action: 'link_appointment', id, appointmentId: `apt-own-${TS}` });
    expect(linked.statusCode, JSON.stringify(linked.body)).toBe(200); expect(await row(id)).toMatchObject({ status: 'IN_PROGRESS', appointmentId: `apt-own-${TS}` });
    await free();
  });

  it('G6: the pending proposals of a departing member go to the successor — or to the administrator recording the departure — in the same transaction', async () => {
    const assign = (to) => pro(H.cases, P.admin, { method: 'POST', body: { action: 'assign', id: caseId, userId: to.id } });
    const leave = (successor) => pro(H.team, P.admin, { method: 'DELETE', query: { userId: P.x2.id, ...(successor ? { successorUserId: successor.id } : {}) }, url: `/api/pro/team?userId=${P.x2.id}${successor ? `&successorUserId=${successor.id}` : ''}` });
    // before the fix: the person's « accept » of a departed member's proposal answered SENDER_GONE and the proposal stayed pending
    expect((await assign(P.x2)).statusCode).toBe(200);
    const id = await propose(S.Y, {}, P.x2);
    const sentBefore = await sent2(S.Z);   // a referral already sent keeps its author (history) and is not a « proposal » any more
    const out = await leave(P.x1);
    expect(out.statusCode, JSON.stringify(out.body)).toBe(200); expect(out.body).toMatchObject({ movedCases: 1, movedProposals: 1 });
    expect((await row(id)).createdByProUserId).toBe(P.x1.id); expect((await row(sentBefore)).createdByProUserId).toBe(P.x2.id);
    expect((await trail(id)).pop()).toEqual({ actor: 'SENDER', from: 'PENDING_CITIZEN', to: 'PENDING_CITIZEN' });
    const yes = await decide(id);
    expect(yes.statusCode, JSON.stringify(yes.body)).toBe(200); expect((await row(id)).status).toBe('SENT');
    expect((await db.execute(sql`SELECT "grantedByProUserId" AS by FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${DOSSIER} AND "structureId" = ${S.Y}`)).rows[0].by, 'the access names an active member').toBe(P.x1.id);
    await free();
    // no successor: the administrator who records the departure takes the proposals (the case goes back to the queue)
    expect((await pro(H.team, P.admin, { method: 'PATCH', body: { targetUserId: P.x2.id, reactivate: true } })).statusCode).toBe(200);
    expect((await assign(P.x2)).statusCode).toBe(200);
    const id2 = await propose(S.Y, {}, P.x2);
    const out2 = await leave(null);
    expect(out2.statusCode, JSON.stringify(out2.body)).toBe(200); expect(out2.body.movedProposals).toBe(1);
    expect((await row(id2)).createdByProUserId).toBe(P.admin.id);
    expect((await decide(id2)).statusCode).toBe(200);
    // a refused departure (successor not active) moves nothing
    await free();
    expect((await pro(H.team, P.admin, { method: 'PATCH', body: { targetUserId: P.x2.id, reactivate: true } })).statusCode).toBe(200);
    expect((await assign(P.x2)).statusCode).toBe(200);
    const id3 = await propose(S.Y, {}, P.x2);
    await db.execute(sql`UPDATE "ProUser" SET status = 'disabled' WHERE id = ${P.x1.id}`);
    expect((await leave(P.x1)).statusCode).toBe(400);
    expect((await row(id3)).createdByProUserId).toBe(P.x2.id);
    await db.execute(sql`UPDATE "ProUser" SET status = 'active' WHERE id = ${P.x1.id}`);
    await free();

    async function sent2(to) { const p = await propose(to, {}, P.x2); expect((await decide(p)).statusCode).toBe(200); return p; }
  });
});
