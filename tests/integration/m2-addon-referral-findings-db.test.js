/**
 * M2 add-on — verified audit findings on the referral exchange (RECON_PRO_STRUCTURE_TERRITORY 2026-11-15), on REAL PostgreSQL through the real handlers:
 *   A05  the sender's reply no longer replaces the message the person read before authorizing: it is appended
 *   A06  a request for information gives the SENDER its own deadline and a fresh overdue notice; a timeout says who did not answer
 *   A07  the sender's case leaves REFERRED when its last sent referral is declined, cancelled, expired or withdrawn by the person
 *   A09  the person's list carries the controlled motive of the answer and its dates — never the receiver's free text
 *   B01  with migration 0048 every text of the exchange is kept in order (append-only); without it nothing is written and nothing fails
 * Synthetic organizations: X (sender: admin, x1) · Y, Z (receivers). Works with or without 0047 / 0048 (the history assertions need 0048). Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const S = { X: `m2a-X-${TS}`, Y: `m2a-Y-${TS}`, Z: `m2a-Z-${TS}` };
const P = { admin: { id: `m2a-adm-${TS}`, st: S.X, role: 'STRUCTURE_ADMIN' }, x1: { id: `m2a-x1-${TS}`, st: S.X, role: 'PRO' }, y: { id: `m2a-y-${TS}`, st: S.Y, role: 'PRO' }, z: { id: `m2a-z-${TS}`, st: S.Z, role: 'PRO' } };
const CIT = { id: `m2a-cit-${TS}`, email: `m2a-cit-${TS}@example.test` };
const DOSSIER = `m2a-dos-${TS}`;
const M1 = `Message initial lu par la personne ${TS}`; const Q1 = `Première demande de précisions ${TS}`; const R1 = `Première réponse de la structure d’origine ${TS}`;
const Q2 = `Seconde demande de précisions ${TS}`; const R2 = `Seconde réponse de la structure d’origine ${TS}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('M2 add-on — referral exchange findings A05 A06 A07 A09 B01 (real DB)', () => {
  let db, auth, userAuth, H, mailer, features, caseId;
  const tok = (p) => auth.signProToken({ id: p.id, email: `${p.id}@example.test`, structureId: p.st, role: p.role });
  const pro = async (h, p, { method = 'GET', query = {}, body, url = '/api/pro/x' } = {}) => { const r = mk(); await h({ method, url, query, body, headers: { host: 'localhost', authorization: `Bearer ${tok(p)}` } }, r); return r; };
  const cit = async (h, { method = 'GET', query = {}, body } = {}) => { const r = mk(); const c = userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: CIT.id, email: CIT.email })).split(';')[0];
    await h({ method, url: '/api/x', query, body, headers: { host: 'localhost', cookie: c } }, r); return r; };
  const ref = async (p, body) => { const r = await pro(H.refs, p, { method: 'POST', body }); return r; };
  const ok = async (p, body) => { const r = await ref(p, body); expect(r.statusCode, JSON.stringify(r.body)).toBeLessThan(300); return r; };
  const one = async (p, id) => (await pro(H.refs, p, { query: { id } })).body.referral;
  const mine = async (id) => (await cit(H.citRefs)).body.referrals.find((r) => r.id === id);
  const row = async (id) => (await db.execute(sql`SELECT * FROM "Referral" WHERE id = ${id}`)).rows[0];
  const caseRow = async () => (await db.execute(sql`SELECT status FROM "ProCase" WHERE id = ${caseId}`)).rows[0];
  const caseEvents = async () => (await db.execute(sql`SELECT kind, "fromValue" AS "from", "toValue" AS "to", "actorProUserId" AS actor FROM "ProCaseEvent" WHERE "caseId" = ${caseId} AND kind = 'STATUS' ORDER BY "createdAt"`)).rows;
  const notices = async (st, type, id) => (await db.execute(sql`SELECT title, message FROM "ProNotification" WHERE "structureId" = ${st} AND type = ${type} AND metadata->>'referralId' = ${id}`)).rows;
  const toCit = () => mailer.__getTestOutbox().filter((m) => m.to === CIT.email);
  const cron = async () => { const r = mk(); await H.cron({ method: 'GET', url: '/api/cron/referral-timeouts', query: {}, headers: { 'x-cron-secret': process.env.CRON_SECRET } }, r); expect(r.statusCode, JSON.stringify(r.body)).toBe(200); return r.body; };
  const reset = async () => {
    await db.execute(sql`UPDATE "Referral" SET status = 'CANCELLED', "closedAt" = NOW() WHERE "sharedDiagnosticId" = ${DOSSIER} AND status NOT IN ('EXPIRED', 'CANCELLED', 'CLOSED', 'COMPLETED', 'DECLINED')`);
    await db.execute(sql`UPDATE "SharedDossierGrant" SET "revokedAt" = NOW() WHERE "sharedDiagnosticId" = ${DOSSIER} AND id <> ${'g-' + DOSSIER} AND "revokedAt" IS NULL`);
    await db.execute(sql`UPDATE "ProCase" SET status = 'IN_PROGRESS', "closedAt" = NULL WHERE id = ${caseId}`);
  };
  const sent = async (to, message) => { const p = await ok(P.x1, { action: 'propose', caseId, toStructureId: to, reasonCode: 'HOUSING', ...(message ? { message } : {}) });
    expect((await cit(H.citRefs, { method: 'POST', body: { id: p.body.referral.id, decision: 'accept' } })).statusCode).toBe(200); return p.body.referral.id; };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    features = await (await import('../../api/_utils/schema-features.js')).readReferralChainSchema(db);
    auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js'); mailer = await import('../../api/_utils/mailer.js');
    H = { cases: (await import('../../api/_handlers/pro/cases.js')).default, refs: (await import('../../api/_handlers/pro/referrals.js')).default,
      citRefs: (await import('../../api/_handlers/citizen/referrals.js')).default, grants: (await import('../../api/_handlers/public/dossier-grants.js')).default,
      cron: (await import('../../api/_handlers/cron/referral-timeouts.js')).default };
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
  }, 60000);
  afterAll(async () => {
    if (!db) return;
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
  });

  it('A05 / B01: a reply is appended to the message the person authorized — two rounds, nothing is lost for the receiver or the person; the history keeps every text in order', async () => {
    await reset();
    const a = await sent(S.Y, M1);
    await ok(P.y, { action: 'needs_info', id: a, message: Q1 });
    await ok(P.x1, { action: 'reply', id: a, message: R1 });
    for (const view of [(await one(P.y, a)).message, (await one(P.x1, a)).message, (await mine(a)).message]) {
      expect(view).toContain(M1);
      expect(view).toContain(R1);
      expect(view.indexOf(M1)).toBeLessThan(view.indexOf(R1));
      expect(view).toMatch(/— Précisions apportées le \d{4}-\d{2}-\d{2} —/);
    }
    await ok(P.y, { action: 'needs_info', id: a, message: Q2 });
    await ok(P.x1, { action: 'reply', id: a, message: R2 });
    const final = (await one(P.y, a)).message;
    for (const text of [M1, R1, R2]) expect(final).toContain(text);
    expect((await mine(a)).message).toBe(final);
    // the receiver's questions are the receiver's text: never in what the person reads
    expect(JSON.stringify(await mine(a))).not.toContain(Q1);
    expect(JSON.stringify(await mine(a))).not.toContain(Q2);
    const receiver = await one(P.y, a); const sender = await one(P.x1, a);
    if (features.messages) {
      expect(receiver.messages.map((m) => [m.side, m.body])).toEqual([['SENDER', M1], ['RECEIVER', Q1], ['SENDER', R1], ['RECEIVER', Q2], ['SENDER', R2]]);
      expect(sender.messages.map((m) => m.body)).toEqual([M1, Q1, R1, Q2, R2]);
      // stored sealed, and append-only
      const stored = (await db.execute(sql`SELECT id, "bodyEncrypted" AS b FROM "ReferralMessage" WHERE "referralId" = ${a}`)).rows;
      expect(stored.length).toBe(5);
      expect(JSON.stringify(stored)).not.toContain('Première');
      await expect(db.execute(sql`UPDATE "ReferralMessage" SET side = 'RECEIVER' WHERE id = ${stored[0].id}`)).rejects.toThrow();
      // another organization reads none of it; a receiver that lost its access neither
      expect((await pro(H.refs, P.z, { query: { id: a } })).statusCode).toBe(404);
      await ok(P.y, { action: 'decline', id: a, responseCode: 'NO_CAPACITY' });
      const after = await one(P.y, a);
      expect([after.textsHidden, after.messages, after.message]).toEqual([true, [], '']);
    } else {
      expect(receiver.messages).toEqual([]);
    }
  });

  it('A06: a request for information restarts the deadline for the sender, who gets its own overdue notice; the expiry says who did not answer', async () => {
    await reset(); mailer.__clearTestOutbox();
    const a = await sent(S.Y, M1);
    // the receiver was late and the sender had already been told
    await db.execute(sql`UPDATE "Referral" SET "dueAt" = NOW() - interval '2 days', "overdueNotifiedAt" = NOW() - interval '1 day' WHERE id = ${a}`);
    await ok(P.y, { action: 'needs_info', id: a, message: Q1 });
    const r = await row(a);
    expect(r.overdueNotifiedAt).toBeNull();
    const days = (new Date(r.dueAt).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(4.9);
    expect(days).toBeLessThan(5.1);
    await cron();
    expect((await notices(S.X, 'referral_overdue', a)).length).toBe(0);
    // the sender does not reply in time: its own notice, in its own words
    await db.execute(sql`UPDATE "Referral" SET "dueAt" = NOW() - interval '1 day' WHERE id = ${a}`);
    await cron();
    const overdue = await notices(S.X, 'referral_overdue', a);
    expect(overdue.length).toBe(2);   // X has two members
    expect(overdue[0].title).toBe('Précisions attendues');
    expect(overdue[0].message).toMatch(/précisions qu’elle vous a demandées/);
    // 14 days later: expired from NEEDS_INFO — the person is not told that the receiver stayed silent
    await db.execute(sql`UPDATE "Referral" SET "dueAt" = NOW() - interval '20 days' WHERE id = ${a}`);
    await cron();
    expect((await row(a)).status).toBe('EXPIRED');
    expect((await db.execute(sql`SELECT "fromStatus" AS f FROM "ReferralEvent" WHERE "referralId" = ${a} AND "toStatus" = 'EXPIRED'`)).rows).toEqual([{ f: 'NEEDS_INFO' }]);
    const mail = toCit().at(-1);
    expect(mail.subject).toBe('Votre orientation est close');
    expect(mail.text).toMatch(/la structure qui vous accompagne ne les a pas apportées/);
    expect(mail.text).not.toMatch(/n’a pas répondu/);
    expect((await notices(S.X, 'referral_expired', a))[0].message).toMatch(/précisions demandées par la structure destinataire n’ont pas été apportées/);
    // the plain case keeps its words: the receiver never answered
    const b = await sent(S.Z);
    await db.execute(sql`UPDATE "Referral" SET "dueAt" = NOW() - interval '20 days' WHERE id = ${b}`);
    await cron();
    expect((await db.execute(sql`SELECT "fromStatus" AS f FROM "ReferralEvent" WHERE "referralId" = ${b} AND "toStatus" = 'EXPIRED'`)).rows).toEqual([{ f: 'SENT' }]);
    expect(toCit().at(-1).text).toMatch(/La structure proposée n’a pas répondu dans le délai prévu/);
    expect((await notices(S.X, 'referral_expired', b))[0].message).toMatch(/a expiré sans réponse/);
  });

  it('A07: the sender’s case leaves REFERRED when its last sent referral is declined, cancelled, expired or withdrawn — and only then', async () => {
    await reset();
    const before = (await caseEvents()).length;
    const released = async () => (await caseEvents()).filter((x) => x.from === 'REFERRED' && x.to === 'IN_PROGRESS' && x.actor === null).length;
    const releasedBefore = await released();
    // declined
    const a = await sent(S.Y);
    expect((await caseRow()).status).toBe('REFERRED');
    await ok(P.y, { action: 'decline', id: a, responseCode: 'NO_CAPACITY' });
    expect((await caseRow()).status).toBe('IN_PROGRESS');
    expect((await caseEvents()).at(-1)).toEqual({ kind: 'STATUS', from: 'REFERRED', to: 'IN_PROGRESS', actor: null });
    expect((await caseEvents()).length).toBe(before + 1);
    // two referrals: the case stays REFERRED while one of them is still with a receiver
    const y = await sent(S.Y); const z = await sent(S.Z);
    await ok(P.x1, { action: 'cancel', id: y });
    expect((await caseRow()).status).toBe('REFERRED');
    // cancelled by the sender (the last one)
    await ok(P.x1, { action: 'cancel', id: z });
    expect((await caseRow()).status).toBe('IN_PROGRESS');
    // expired
    const e = await sent(S.Y);
    expect((await caseRow()).status).toBe('REFERRED');
    await db.execute(sql`UPDATE "Referral" SET "dueAt" = NOW() - interval '20 days' WHERE id = ${e}`);
    await cron();
    expect((await row(e)).status).toBe('EXPIRED');
    expect((await caseRow()).status).toBe('IN_PROGRESS');
    // access withdrawn by the person
    const w = await sent(S.Z);
    expect((await caseRow()).status).toBe('REFERRED');
    expect((await cit(H.grants, { method: 'POST', body: { shareId: DOSSIER, action: 'revoke', structureId: S.Z } })).statusCode).toBe(200);
    expect((await row(w)).status).toBe('CANCELLED');
    expect((await caseRow()).status).toBe('IN_PROGRESS');
    expect(await released()).toBe(releasedBefore + 4);
    // a status a professional chose is not overwritten, and a completed referral leaves the case as it is
    const c = await sent(S.Y);
    expect((await pro(H.cases, P.x1, { method: 'POST', body: { action: 'status', id: caseId, status: 'WAITING_PARTNER' } })).statusCode).toBe(200);
    await ok(P.y, { action: 'decline', id: c, responseCode: 'OUT_OF_SCOPE' });
    expect((await caseRow()).status).toBe('WAITING_PARTNER');
    // a proposal the person had not answered never made the case REFERRED: cancelling it changes nothing
    const p = await ok(P.x1, { action: 'propose', caseId, toStructureId: S.Z, reasonCode: 'HOUSING' });
    await ok(P.x1, { action: 'cancel', id: p.body.referral.id });
    expect((await caseRow()).status).toBe('WAITING_PARTNER');
  });

  it('A09: the person’s list carries the controlled motive of the answer and its dates — never the receiver’s free text', async () => {
    await reset();
    const a = await sent(S.Y, M1);
    expect(await mine(a)).toMatchObject({ responseCode: null, respondedAt: null, closedAt: null });
    await ok(P.y, { action: 'decline', id: a, responseCode: 'NO_CAPACITY', message: Q1 });
    const declined = await mine(a);
    expect(declined.responseCode).toBe('NO_CAPACITY');
    expect(declined.respondedAt).toBeTruthy();
    expect(JSON.stringify(declined)).not.toContain(Q1);
    await ok(P.x1, { action: 'close', id: a });
    expect((await mine(a)).closedAt).toBeTruthy();
  });
});
