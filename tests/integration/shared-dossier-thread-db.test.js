/**
 * SharedDossier chat — REAL PostgreSQL (isolated, synthetic). Exercises the SQL of api/_services/shared-dossier-threads.js, the uniqueness
 * and cascade guarantees of migration 0012, and the pro / sharer handlers end to end.
 * STATUS WHEN WRITTEN (2026-10-16): NOT EXECUTED — the session sandbox forbids SysV shared memory, so no local PostgreSQL could be started.
 * Skipped without DATABASE_URL. Run it before trusting this feature: node scripts/test-run.mjs tests/integration/shared-dossier-thread-db.test.js
 */
import crypto from 'node:crypto';
import { vi } from 'vitest';
vi.stubEnv('AUTH_SECRET', 'test-auth-secret-dossier-db');
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const SA = `sdt-sa-${TS}`, SB = `sdt-sb-${TS}`, D1 = `sdt-d1-${TS}`, D2 = `sdt-d2-${TS}`;
const PA = { id: `sdt-pa-${TS}`, email: `pa-${TS}@example.test` }, PB = { id: `sdt-pb-${TS}`, email: `pb-${TS}@example.test` };
const C1 = crypto.randomBytes(32).toString('base64url'), C2 = crypto.randomBytes(32).toString('base64url');
const hash = (c) => crypto.createHash('sha256').update(c, 'utf8').digest('hex');
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('SharedDossier chat (real DB)', () => {
  let db, auth, threads, secureMessages, shareThread;
  const proTok = (u, sid) => `Bearer ${auth.signProToken({ id: u.id, email: u.email, structureId: sid, role: 'STRUCTURE_ADMIN' })}`;
  const callPro = async (method, { query = '', body, token } = {}) => { const r = mk(); await secureMessages({ method, url: `/api/secure-messages${query}`, query: {}, body, headers: { host: 'x', ...(token ? { authorization: token } : {}) } }, r); return r; };
  const callShare = async (body) => { const r = mk(); await shareThread({ method: 'POST', url: '/api/share/thread', query: {}, body, headers: { host: 'x' } }, r); return r; };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); auth = await import('../../api/_utils/auth.js'); threads = await import('../../api/_services/shared-dossier-threads.js');
    ({ default: secureMessages } = await import('../../api/_handlers/secure-messages.js')); ({ default: shareThread } = await import('../../api/_handlers/share/thread.js'));
    for (const [sid, n] of [[SA, 'A'], [SB, 'B']]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, "updatedAt", "createdAt") VALUES (${sid}, ${'SDT ' + n}, ${'sdt-slug-' + n + '-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', NOW(), NOW())`);
    }
    for (const [u, sid] of [[PA, SA], [PB, SB]]) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt") VALUES (${u.id}, ${u.email}, 'x', ${sid}, 'STRUCTURE_ADMIN', 'active', NOW(), NOW())`);   // active members
    for (const [id, c] of [[D1, C1], [D2, C2]]) {
      await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "subjectType") VALUES (${id}, NOW() + interval '1 day', '{}'::jsonb, '{}'::jsonb, 0, ${hash(c)}, 'GUEST_SHARE')`);
      await db.execute(sql`UPDATE "SharedDiagnostic" SET "shareTokenHash" = ${hash('recipient-' + c)} WHERE id = ${id}`);   // RC5 row: owner secret != share token (a row without it is LEGACY and has no owner)
      for (const sid of [SA, SB]) await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId") VALUES (${`g-${id}-${sid}`}, ${id}, ${sid}, ${'pro-' + sid})`);   // RC5: structures hold a grant
    }
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id IN (${D1}, ${D2})`);   // cascades threads + messages
    await db.execute(sql`DELETE FROM "ProUser" WHERE id IN (${PA.id}, ${PB.id})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${SA}, ${SB})`);
  });

  it('service: openThread is idempotent (unique per dossier+structure); messages ordered; lastMessageAt updated', async () => {
    const t1 = await threads.openThread({ dossierId: D1, structureId: SA, proUserId: PA.id });
    const t2 = await threads.openThread({ dossierId: D1, structureId: SA, proUserId: PB.id });
    expect(t2.id).toBe(t1.id); expect(t2.openedByProUserId).toBe(PA.id);
    await threads.addMessage({ threadId: t1.id, senderType: 'PRO', senderProUserId: PA.id, body: 'one' });
    await threads.addMessage({ threadId: t1.id, senderType: 'SHARER', body: 'two' });
    expect((await threads.listMessages(t1.id)).map((m) => m.body)).toEqual(['one', 'two']);
    expect((await threads.listThreads(D1)).map((t) => t.structureName)).toEqual(['SDT A']);
    expect(await threads.findThread(D1, SB)).toBeNull(); expect(await threads.findThreadOfDossier(D2, t1.id)).toBeNull();
  });

  it('handlers end to end: pro A opens, sharer replies, pro B isolated, other dossier isolated, bodies wrapped at rest', async () => {
    const A = proTok(PA, SA), B = proTok(PB, SB);
    expect((await callPro('POST', { token: A, body: { shareId: D2, encryptedContent: 'blob-d2' } })).statusCode).toBe(201);
    const list = await callShare({ id: D2, capability: C2, action: 'list' }); expect(list.statusCode).toBe(200); expect(list.body.threads).toHaveLength(1);
    const tid = list.body.threads[0].id;
    expect((await callShare({ id: D2, capability: C2, action: 'send', threadId: tid, encryptedContent: 'reply-blob' })).statusCode).toBe(201);
    expect((await callPro('GET', { query: `?shareId=${D2}`, token: A })).body.items.map((i) => i.encryptedContent)).toEqual(['blob-d2', 'reply-blob']);
    expect((await callPro('GET', { query: `?shareId=${D2}`, token: B })).body.items).toEqual([]);
    expect((await callShare({ id: D1, capability: C1, action: 'messages', threadId: tid })).statusCode).toBe(404);           // thread of D2 via D1's capability
    expect((await callShare({ id: D2, capability: C1, action: 'list' })).statusCode).toBe(404);                              // wrong capability
    const stored = (await db.execute(sql`SELECT body FROM "SharedDossierMessage" WHERE "threadId" = ${tid}`)).rows;
    expect(stored).toHaveLength(2); for (const r of stored) { expect(r.body).toMatch(/^v2:/); expect(r.body).not.toContain('blob-d2'); }
  });

  it('cascade: revoking (deleting) the shared diagnostic removes its threads and messages', async () => {
    const before = (await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDossierThread" WHERE "sharedDiagnosticId" = ${D2}`)).rows[0].n; expect(before).toBeGreaterThan(0);
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${D2}`);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDossierThread" WHERE "sharedDiagnosticId" = ${D2}`)).rows[0].n).toBe(0);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDossierMessage" m LEFT JOIN "SharedDossierThread" t ON t.id = m."threadId" WHERE t.id IS NULL`)).rows[0].n).toBe(0);
    expect((await callPro('GET', { query: `?shareId=${D2}`, token: proTok(PA, SA) })).statusCode).toBe(404);                 // dossier gone → legacy path → 404
  });
});
