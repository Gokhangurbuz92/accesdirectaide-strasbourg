/**
 * RECON Pro 2026-11-15 — A01 and B02 on REAL PostgreSQL, through the real handlers, on BOTH database levels:
 *   - a database with drizzle/0049 ("RdvConversationRead"): per-member unread conversations, read on opening the thread;
 *   - a database migrated only to 0045 (Production today): every path works, nothing names the missing table, the unread message count is « unknown »
 *     exactly as before (messages: null, notifications_only) and the lists carry no unread flag.
 * A01 (both levels): a person's message notifies the appointment's professional — not the oldest account — in-app, with an e-mail only when that member
 * keeps the « appointments » category on; an appointment nobody of the team created notifies every active member; one unread notice per appointment.
 * Raw-SQL fixtures (independent of the level). Synthetic data only. Skipped without DATABASE_URL.
 * Run on each level: DATABASE_URL=…/ada_pa_test and DATABASE_URL=…/ada_pa_0045_test (PA_EXPECT_READ_MARKER=1 / 0 makes the level an assertion).
 */
import { vi } from 'vitest';
vi.stubEnv('MAILER_PROVIDER', 'test');
vi.stubEnv('MAILER_FROM', 'noreply@example.test');
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const ST = `pa-s-${TS}`; const OTHER = `pa-o-${TS}`; const SVC = `pa-svc-${TS}`;
// OLD is the oldest account of the structure (the one the previous code e-mailed); YOUNG created appointment A1
const OLD = { id: `pa-old-${TS}`, email: `pa-old-${TS}@example.test`, role: 'STRUCTURE_ADMIN', st: ST };
const YOUNG = { id: `pa-young-${TS}`, email: `pa-young-${TS}@example.test`, role: 'PRO', st: ST };
const OUT = { id: `pa-out-${TS}`, email: `pa-out-${TS}@example.test`, role: 'STRUCTURE_ADMIN', st: OTHER };
const CIT = { id: `pa-c-${TS}`, email: `pa-c-${TS}@example.test` };
const A1 = `pa-a1-${TS}`; const A2 = `pa-a2-${TS}`; const C1 = `pa-conv1-${TS}`; const C2 = `pa-conv2-${TS}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end(d) { if (d !== undefined) this.body = d; return this; } });

describe.skipIf(!hasDatabase)('RECON Pro A01 + B02: message alert and read marker (real DB, with and without 0049)', () => {
  let db, auth, ua, mailer, read, citizenH, proConvH, proMsgH, countH; let marker = false;
  const bearer = (p) => ({ host: 'x', authorization: `Bearer ${auth.signProToken({ id: p.id, email: p.email, structureId: p.st, role: p.role })}` });
  const asCitizen = async (method, path, body) => { const r = mk(); await citizenH({ method, url: `/api/messages${path}`, query: {}, body, headers: { host: 'x', cookie: ua.buildUserSessionCookie(ua.signUserSessionToken({ userId: CIT.id, email: CIT.email })).split(';')[0] } }, r); return r; };
  const asPro = async (p, method, path, body) => { const r = mk(); await proConvH({ method, url: `/api/pro/messages/conversations${path}`, query: {}, body, headers: bearer(p) }, r); return r; };
  const count = async (p) => { const r = mk(); await countH({ method: 'GET', url: '/api/pro/notifications/unread-count', query: {}, headers: bearer(p) }, r); return r; };
  const notices = async (userId) => (await db.execute(sql`SELECT type, "readAt", metadata FROM "ProNotification" WHERE "userId" = ${userId} AND type = 'message_received' ORDER BY "createdAt"`)).rows;
  const mailsTo = (email) => mailer.__getTestOutbox().filter((m) => [m.to].flat().includes(email));
  const show = (r) => JSON.stringify(r.body).slice(0, 300);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    auth = await import('../../api/_utils/auth.js'); ua = await import('../../api/_utils/user-auth.js'); mailer = await import('../../api/_utils/mailer.js');
    read = await import('../../api/_services/conversation-read.js');
    ({ default: citizenH } = await import('../../api/_handlers/messages.js'));
    ({ default: proConvH } = await import('../../api/_handlers/pro/messages-conversations.js'));
    ({ default: proMsgH } = await import('../../api/_handlers/pro/messages.js'));
    ({ default: countH } = await import('../../api/_handlers/pro/notifications/unread-count.js'));
    marker = await read.conversationReadAvailable(db);
    for (const id of [ST, OTHER]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, "updatedAt", "createdAt")
        VALUES (${id}, 'Structure fictive PA', ${id}, 'association', '1 rue', 'Strasbourg', '67000', false, '{}', '{}', '{}', 'actif', NOW(), NOW())`);
    }
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "notificationEmailEnabled", "updatedAt", "createdAt") VALUES (${OLD.id}, ${OLD.email}, 'x', ${ST}, ${OLD.role}, 'active', true, NOW(), NOW() - interval '400 days')`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "notificationEmailEnabled", "updatedAt", "createdAt") VALUES (${YOUNG.id}, ${YOUNG.email}, 'x', ${ST}, ${YOUNG.role}, 'active', true, NOW(), NOW() - interval '2 days')`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "notificationEmailEnabled", "updatedAt", "createdAt") VALUES (${OUT.id}, ${OUT.email}, 'x', ${OTHER}, ${OUT.role}, 'active', true, NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${CIT.id}, ${CIT.email}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "updatedAt") VALUES (${SVC}, ${ST}, 'Accueil', 30, 0, 0, true, NOW())`);
    // A1: created by YOUNG for the person; A2: booked online (no professional on it)
    await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "citizenUserId", "createdByProUserId", "idempotencyKey", "updatedAt")
      VALUES (${A1}, ${ST}, ${SVC}, NOW() + interval '3 days', NOW() + interval '3 days 30 minutes', 'confirmed', 'Particulier', ${CIT.id}, ${YOUNG.id}, ${'pa1-' + TS}, NOW())`);
    await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "citizenUserId", "idempotencyKey", "updatedAt")
      VALUES (${A2}, ${ST}, ${SVC}, NOW() + interval '4 days', NOW() + interval '4 days 30 minutes', 'confirmed', 'Particulier', ${CIT.id}, ${'pa2-' + TS}, NOW())`);
    await db.execute(sql`INSERT INTO "RdvConversation" (id, "appointmentId", "structureId", "citizenUserId", "lastMessageAt", "updatedAt") VALUES (${C1}, ${A1}, ${ST}, ${CIT.id}, NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "RdvConversation" (id, "appointmentId", "structureId", "citizenUserId", "lastMessageAt", "updatedAt") VALUES (${C2}, ${A2}, ${ST}, ${CIT.id}, NOW(), NOW())`);
    mailer.__clearTestOutbox();
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" IN (${ST}, ${OTHER})`).catch(() => {});
    await db.execute(sql`DELETE FROM "RdvConversation" WHERE id IN (${C1}, ${C2})`);   // cascades messages, attachments, notification log, read markers
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE id IN (${A1}, ${A2})`); await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${SVC}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${CIT.id}`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id IN (${OLD.id}, ${YOUNG.id}, ${OUT.id})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${ST}, ${OTHER})`);
  });

  it('the database level is the one this run was started for', () => {
    console.info(`[pa] read marker table present: ${marker}`);
    if (process.env.PA_EXPECT_READ_MARKER === '1') expect(marker).toBe(true);
    if (process.env.PA_EXPECT_READ_MARKER === '0') expect(marker).toBe(false);
  });

  it('before any message: nothing unread; the count answers on both levels', async () => {
    const r = await count(YOUNG);
    expect(r.statusCode, show(r)).toBe(200);
    expect(r.body.notifications).toBe(0);
    if (marker) expect(r.body).toMatchObject({ messages: 0, countScope: 'notifications_and_messages', messageReadStateAvailable: true });
    else expect(r.body).toMatchObject({ messages: null, total: 0, countScope: 'notifications_only', messageReadStateAvailable: false });   // as before 0049
  });

  it('A01: a message on YOUNG’s appointment notifies YOUNG (in-app + e-mail), not the oldest account', async () => {
    const sent = await asCitizen('POST', `/conversations/${C1}`, { body: 'Bonjour, une question sur mon rendez-vous (texte fictif).' });
    expect(sent.statusCode, show(sent)).toBe(201);
    const young = await notices(YOUNG.id);
    expect(young).toHaveLength(1);
    expect(young[0].metadata).toMatchObject({ appointmentId: A1, conversationId: C1, delivery: { inApp: 'STORED', email: 'TEST_RECORDED' } });
    expect(JSON.stringify(young[0].metadata)).not.toContain('question');
    expect(await notices(OLD.id), 'the oldest account has no link to this appointment').toHaveLength(0);
    expect(mailsTo(YOUNG.email)).toHaveLength(1);
    expect(mailsTo(YOUNG.email)[0].text).toContain(`/pro/messages/${C1}`);
    expect(mailsTo(YOUNG.email)[0].text).not.toContain('question');
    expect(mailsTo(OLD.email)).toHaveLength(0);
  });

  it('A01: a second message while the notice is unread adds no second notice and no second e-mail', async () => {
    expect((await asCitizen('POST', `/conversations/${C1}`, { body: 'Deuxième message fictif.' })).statusCode).toBe(201);
    expect(await notices(YOUNG.id)).toHaveLength(1);
    expect(mailsTo(YOUNG.email)).toHaveLength(1);
  });

  it('B02: unread for both members, not for another structure; the list flags it (or carries no flag without the marker)', async () => {
    for (const p of [YOUNG, OLD]) {
      const r = await count(p);
      expect(r.statusCode).toBe(200);
      expect(r.body.messages).toBe(marker ? 1 : null);
      expect(r.body.total, 'the bell total stays the notices (a message is itself a notice)').toBe(r.body.notifications);
    }
    expect((await count(OUT)).body.messages).toBe(marker ? 0 : null);
    const list = await asPro(OLD, 'GET', '');
    expect(list.statusCode, show(list)).toBe(200);
    const c1 = list.body.items.find((x) => x.id === C1); const c2 = list.body.items.find((x) => x.id === C2);
    expect(list.body.unreadAvailable).toBe(marker);
    if (marker) { expect(c1.unread).toBe(true); expect(c2.unread).toBe(false); }
    else { expect('unread' in c1).toBe(false); expect('unread' in c2).toBe(false); }
  });

  it('B02: opening the thread reads it for THAT member only, and marks their message notice read', async () => {
    const thread = await asPro(YOUNG, 'GET', `/${C1}`);
    expect(thread.statusCode, show(thread)).toBe(200);
    expect(thread.body.item.messages).toHaveLength(2);
    expect((await notices(YOUNG.id))[0].readAt, 'works on both levels (ProNotification only)').not.toBeNull();
    expect((await count(YOUNG)).body).toMatchObject({ messages: marker ? 0 : null, notifications: 0 });
    expect((await count(OLD)).body.messages, 'a colleague has not read it').toBe(marker ? 1 : null);
    if (marker) {
      const rows = (await db.execute(sql`SELECT "proUserId" FROM "RdvConversationRead" WHERE "conversationId" = ${C1}`)).rows;
      expect(rows.map((r) => r.proUserId)).toEqual([YOUNG.id]);
      expect((await asPro(YOUNG, 'GET', '')).body.items.find((x) => x.id === C1).unread).toBe(false);
    }
  });

  it('another structure cannot open (or mark) the thread', async () => {
    expect((await asPro(OUT, 'GET', `/${C1}`)).statusCode).toBe(404);
    if (marker) expect((await db.execute(sql`SELECT 1 FROM "RdvConversationRead" WHERE "proUserId" = ${OUT.id}`)).rows).toHaveLength(0);
  });

  it('A01 + B02: a new message after the member read: a new notice, unread again; the team’s reply reads it for everyone', async () => {
    await db.execute(sql`SELECT pg_sleep(0.01)`);
    expect((await asCitizen('POST', `/conversations/${C1}`, { body: 'Troisième message fictif.' })).statusCode).toBe(201);
    expect(await notices(YOUNG.id)).toHaveLength(2);
    expect((await count(YOUNG)).body.messages).toBe(marker ? 1 : null);
    await db.execute(sql`SELECT pg_sleep(0.01)`);
    const reply = await asPro(YOUNG, 'POST', `/${C1}`, { body: 'Réponse fictive de la structure.' });
    expect(reply.statusCode, show(reply)).toBe(201);
    expect((await count(YOUNG)).body.messages).toBe(marker ? 0 : null);
    expect((await count(OLD)).body.messages, 'answered by the team: nothing left to read').toBe(marker ? 0 : null);
    expect((await notices(YOUNG.id)).every((n) => n.readAt !== null)).toBe(true);
  });

  it('A01: « appointments » switched off: the in-app notice stays, no e-mail', async () => {
    await db.execute(sql`UPDATE "ProUser" SET "notificationPrefs" = '{"appointments": false}'::jsonb WHERE id = ${YOUNG.id}`);
    const before = mailsTo(YOUNG.email).length;
    await db.execute(sql`SELECT pg_sleep(0.01)`);
    expect((await asCitizen('POST', `/conversations/${C1}`, { body: 'Quatrième message fictif.' })).statusCode).toBe(201);
    const mine = await notices(YOUNG.id);
    expect(mine).toHaveLength(3);
    expect(mine[2].metadata.delivery).toEqual({ inApp: 'STORED', email: 'OFF_BY_PREFERENCE' });
    expect(mailsTo(YOUNG.email)).toHaveLength(before);
    await db.execute(sql`UPDATE "ProUser" SET "notificationPrefs" = '{}'::jsonb WHERE id = ${YOUNG.id}`);
  });

  it('A01: an appointment with no professional on it (booked online) notifies every active member; a member who left is skipped', async () => {
    expect((await asCitizen('POST', `/conversations/${C2}`, { body: 'Message fictif sur le rendez-vous pris en ligne.' })).statusCode).toBe(201);
    const forA2 = async (id) => (await notices(id)).filter((n) => n.metadata.appointmentId === A2);
    expect(await forA2(OLD.id)).toHaveLength(1); expect(await forA2(YOUNG.id)).toHaveLength(1); expect(await forA2(OUT.id)).toHaveLength(0);
    // YOUNG leaves: the next message on YOUNG's own appointment goes to the remaining team
    await db.execute(sql`UPDATE "ProUser" SET status = 'disabled' WHERE id = ${YOUNG.id}`);
    await db.execute(sql`UPDATE "ProNotification" SET "readAt" = now() WHERE "structureId" = ${ST}`);
    expect((await asCitizen('POST', `/conversations/${C1}`, { body: 'Message fictif après un départ.' })).statusCode).toBe(201);
    expect((await notices(OLD.id)).filter((n) => n.metadata.appointmentId === A1)).toHaveLength(1);
    await db.execute(sql`UPDATE "ProUser" SET status = 'active' WHERE id = ${YOUNG.id}`);
  });

  it('B02: the appointment’s « Messages » tab (GET /api/pro/messages?appointmentId) reads the thread too', async () => {
    expect((await count(OLD)).body.messages).toBe(marker ? 2 : null);
    const r = mk(); await proMsgH({ method: 'GET', url: `/api/pro/messages?appointmentId=${A2}`, query: { appointmentId: A2 }, headers: bearer(OLD) }, r);
    expect(r.statusCode, show(r)).toBe(200);
    expect(r.body.messages).toHaveLength(1);
    expect((await count(OLD)).body.messages).toBe(marker ? 1 : null);
  });

  it('A10: a refused proposal is announced to the administrators and to its author (identifiers only), not to another structure', async () => {
    const { decide } = await import('../../api/_services/structure-proposals.js');
    const PROP = `pa-prop-${TS}`;
    await db.execute(sql`INSERT INTO "StructureProposal" (id, "structureId", "proposedByProUserId", field, "proposedValue", "previousValue", status) VALUES (${PROP}, ${ST}, ${YOUNG.id}, 'horaires', 'Lundi 9h-17h', NULL, 'PENDING')`);
    const out = await decide(PROP, 'REJECT', 'Motif fictif du refus.', 'reviewer@example.test');
    expect(out.ok, JSON.stringify(out)).toBe(true);
    const rows = (await db.execute(sql`SELECT "userId", title, message, metadata FROM "ProNotification" WHERE type = 'structure_proposal_decided' AND metadata->>'proposalId' = ${PROP}`)).rows;
    expect(rows.map((r) => r.userId).sort()).toEqual([OLD.id, YOUNG.id].sort());   // the administrator and the author (a PRO member)
    expect(rows[0].metadata).toMatchObject({ proposalId: PROP, kind: 'REJECTED' });
    expect(JSON.stringify(rows)).not.toContain('Motif fictif');
    expect(JSON.stringify(rows)).not.toContain('Lundi 9h-17h');
  });

  it('the person’s own side is unchanged: list and thread still load', async () => {
    const list = await asCitizen('GET', '/conversations');
    expect(list.statusCode, show(list)).toBe(200);
    expect(list.body.items.map((x) => x.id).sort()).toEqual([C1, C2].sort());
    expect((await asCitizen('GET', `/conversations/${C1}`)).statusCode).toBe(200);
  });
});
