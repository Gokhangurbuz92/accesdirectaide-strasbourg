/**
 * R43 (lint-worker finding) — the conversation endpoints honour `limit`: the detail returns the `limit` NEWEST messages, oldest first (it loaded the
 * whole conversation whatever the limit); the lists load only the latest message (their preview). Citizen (/api/messages) and professional
 * (/api/pro/messages/conversations) handlers, real PostgreSQL, raw-SQL fixtures (work on 0042 and later). Synthetic data only.
 */
import { vi } from 'vitest';
vi.stubEnv('MAILER_PROVIDER', 'test');
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const ST = `r43m-s-${TS}`; const SVC = `r43m-svc-${TS}`; const APT = `r43m-a-${TS}`; const CONV = `r43m-c-${TS}`;
const P = { id: `r43m-p-${TS}`, email: `r43m-p-${TS}@example.test` }; const C = { id: `r43m-u-${TS}`, email: `r43m-u-${TS}@example.test` };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end(d) { if (d !== undefined) this.body = d; return this; } });

describe.skipIf(!hasDatabase)('R43 conversation limits (real DB)', () => {
  let db, auth, ua, citizenH, proH;
  const callC = async (path) => { const r = mk(); await citizenH({ method: 'GET', url: `/api/messages${path}`, query: {}, headers: { host: 'x', cookie: ua.buildUserSessionCookie(ua.signUserSessionToken({ userId: C.id, email: C.email })).split(';')[0] } }, r); return r; };
  const callP = async (path) => { const r = mk(); await proH({ method: 'GET', url: `/api/pro/messages/conversations${path}`, query: {}, headers: { host: 'x', authorization: `Bearer ${auth.signProToken({ id: P.id, email: P.email, structureId: ST, role: 'STRUCTURE_ADMIN' })}` } }, r); return r; };
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    auth = await import('../../api/_utils/auth.js'); ua = await import('../../api/_utils/user-auth.js');
    ({ default: citizenH } = await import('../../api/_handlers/messages.js')); ({ default: proH } = await import('../../api/_handlers/pro/messages-conversations.js'));
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, "updatedAt", "createdAt")
      VALUES (${ST}, 'Structure fictive R43 messages', ${'r43m-slug-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, '{}', '{}', '{}', 'actif', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt") VALUES (${P.id}, ${P.email}, 'x', ${ST}, 'STRUCTURE_ADMIN', 'active', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${C.id}, ${C.email}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "updatedAt") VALUES (${SVC}, ${ST}, 'Accueil', 30, 0, 0, true, NOW())`);
    await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "citizenUserId", "idempotencyKey", "updatedAt")
      VALUES (${APT}, ${ST}, ${SVC}, NOW() + interval '3 days', NOW() + interval '3 days 30 minutes', 'confirmed', 'Particulier', ${C.id}, ${'r43m-' + TS}, NOW())`);
    await db.execute(sql`INSERT INTO "RdvConversation" (id, "appointmentId", "structureId", "citizenUserId", "lastMessageAt", "updatedAt") VALUES (${CONV}, ${APT}, ${ST}, ${C.id}, NOW(), NOW())`);
    for (let i = 1; i <= 5; i += 1) {
      await db.execute(sql`INSERT INTO "RdvConversationMessage" (id, "conversationId", "senderType", "senderCitizenUserId", body, "createdAt") VALUES (${`${CONV}-m${i}`}, ${CONV}, 'citizen', ${C.id}, ${`message ${i}`}, NOW() - (${6 - i} || ' minutes')::interval)`);
    }
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "RdvConversationMessage" WHERE "conversationId" = ${CONV}`);
    await db.execute(sql`DELETE FROM "RdvConversation" WHERE id = ${CONV}`);
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE id = ${APT}`); await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${SVC}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${C.id}`); await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${P.id}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${ST}`);
  });

  it('detail: the `limit` newest messages, oldest first, for the person and for the structure; no limit = all five (default 50)', async () => {
    for (const call of [callC, callP]) {
      const base = call === callC ? `/conversations/${CONV}` : `/${CONV}`;
      const two = await call(`${base}?limit=2`);
      expect(two.statusCode, JSON.stringify(two.body).slice(0, 200)).toBe(200);
      expect(two.body.item.messages.map((m) => m.body)).toEqual(['message 4', 'message 5']);
      expect((await call(base)).body.item.messages.map((m) => m.body)).toEqual(['message 1', 'message 2', 'message 3', 'message 4', 'message 5']);
    }
  });
  it('lists: the preview is the latest message', async () => {
    const c = (await callC('/conversations')).body.items.find((x) => x.id === CONV);
    const p = (await callP('')).body.items.find((x) => x.id === CONV);
    expect([c.lastMessagePreview, p.lastMessagePreview]).toEqual(['message 5', 'message 5']);
  });
});
