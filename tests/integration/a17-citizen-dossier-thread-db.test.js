/**
 * A-17 — the ACCOUNT that owns a shared dossier reads and answers the organisations' threads (REAL PostgreSQL, synthetic rows).
 * Pro writes -> the owning citizen (session cookie, no secret) lists, reads, answers -> the pro reads the answer. Another account, a signed-out visitor and an
 * unclaimed dossier get the uniform 404 (IDOR). Removing the organisation closes the thread (readable, 409 on a new message). The answer is audited without content.
 */
import crypto from 'node:crypto';
import { vi } from 'vitest';
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const SA = `a17-sa-${TS}`, D1 = `a17-d1-${TS}`, D2 = `a17-d2-${TS}`;
const PA = { id: `a17-pa-${TS}`, email: `a17-pa-${TS}@example.test` };
const OWNER = { id: `a17-owner-${TS}`, email: `a17-owner-${TS}@example.test` }, OTHER = { id: `a17-other-${TS}`, email: `a17-other-${TS}@example.test` };
const hash = (c) => crypto.createHash('sha256').update(c, 'utf8').digest('hex');
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('A-17 citizen account reads and answers dossier threads (real DB)', () => {
  let db, auth, userAuth, secureMessages, shareThread;
  const proTok = () => `Bearer ${auth.signProToken({ id: PA.id, email: PA.email, structureId: SA, role: 'STRUCTURE_ADMIN' })}`;
  const cookie = (c) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: c.id, email: c.email })).split(';')[0];
  const callPro = async (method, { query = '', body } = {}) => { const r = mk(); await secureMessages({ method, url: `/api/secure-messages${query}`, query: {}, body, headers: { host: 'x', authorization: proTok() } }, r); return r; };
  const callShare = async (body, who) => { const r = mk(); await shareThread({ method: 'POST', url: '/api/share/thread', query: {}, body, headers: { host: 'x', ...(who ? { cookie: cookie(who) } : {}) } }, r); return r; };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js');
    ({ default: secureMessages } = await import('../../api/_handlers/secure-messages.js')); ({ default: shareThread } = await import('../../api/_handlers/share/thread.js'));
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, "updatedAt", "createdAt") VALUES (${SA}, 'A17 Structure', ${'a17-slug-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt") VALUES (${PA.id}, ${PA.email}, 'x', ${SA}, 'STRUCTURE_ADMIN', 'active', NOW(), NOW())`);
    for (const c of [OWNER, OTHER]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
    for (const [id, owner] of [[D1, OWNER.id], [D2, null]]) {
      await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId") VALUES (${id}, NOW() + interval '1 day', '{}'::jsonb, ${JSON.stringify({ _followUps: { [SA]: { internalNote: 'INTERNAL-NOTE-A17' } } })}::jsonb, 0, ${hash('owner-' + id)}, ${hash('share-' + id)}, 'GUEST_SHARE', ${owner})`);
      await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId") VALUES (${`a17-g-${id}`}, ${id}, ${SA}, ${PA.id})`);
    }
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity_id IN (${D1}, ${D2})`);
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id IN (${D1}, ${D2})`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${OWNER.id}, ${OTHER.id})`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${PA.id}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${SA}`);
  });

  let tid;
  it('pro writes, the owning account lists and reads the thread (conversation only), answers, the pro reads the answer', async () => {
    expect((await callPro('POST', { body: { shareId: D1, encryptedContent: 'blob-from-pro' } })).statusCode).toBe(201);
    const list = await callShare({ id: D1, action: 'list' }, OWNER);
    expect(list.statusCode).toBe(200);
    expect(list.body.threads).toHaveLength(1);
    expect(Object.keys(list.body.threads[0]).sort()).toEqual(['closed', 'id', 'lastMessageAt', 'structureName']);
    expect(list.body.threads[0]).toMatchObject({ structureName: 'A17 Structure', closed: false });
    tid = list.body.threads[0].id;
    const msgs = await callShare({ id: D1, action: 'messages', threadId: tid }, OWNER);
    expect(msgs.statusCode).toBe(200);
    expect(msgs.body.items.map((i) => [i.sender, i.encryptedContent])).toEqual([['PRO', 'blob-from-pro']]);
    expect(Object.keys(msgs.body.items[0]).sort()).toEqual(['createdAt', 'encryptedContent', 'id', 'sender']);
    expect(JSON.stringify([list.body, msgs.body])).not.toMatch(/INTERNAL-NOTE-A17|a17-pa-/);   // no internal note, no staff identity
    expect((await callShare({ id: D1, action: 'send', threadId: tid, encryptedContent: 'blob-from-citizen' }, OWNER)).statusCode).toBe(201);
    expect((await callPro('GET', { query: `?shareId=${D1}` })).body.items.map((i) => i.encryptedContent)).toEqual(['blob-from-pro', 'blob-from-citizen']);
  });

  it('the answer is audited: actor, dossier, organisation — never the content', async () => {
    const rows = (await db.execute(sql`SELECT action, actor, actor_id, entity, details FROM "AuditLog" WHERE entity_id = ${D1} AND action = 'DOSSIER_THREAD_ANSWERED'`)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'citizen', actor_id: OWNER.id, entity: 'SharedDiagnostic', details: { shareId: D1, threadId: tid, structureId: SA, via: 'account' } });
    expect(JSON.stringify(rows[0])).not.toContain('blob-from-citizen');
  });

  it('IDOR: another account, a signed-out visitor and an unclaimed dossier get the uniform 404; nothing is written', async () => {
    const before = (await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDossierMessage" WHERE "threadId" = ${tid}`)).rows[0].n;
    for (const who of [OTHER, null]) {
      for (const body of [{ id: D1, action: 'list' }, { id: D1, action: 'messages', threadId: tid }, { id: D1, action: 'send', threadId: tid, encryptedContent: 'x' }]) {
        const r = await callShare(body, who);
        expect(r.statusCode).toBe(404); expect(r.body.error).toBe('not_found');
      }
    }
    await callPro('POST', { body: { shareId: D2, encryptedContent: 'blob-d2' } });
    expect((await callShare({ id: D2, action: 'list' }, OWNER)).statusCode).toBe(404);              // D2 is attached to no account: a session opens nothing
    const [{ id: t2 }] = (await db.execute(sql`SELECT id FROM "SharedDossierThread" WHERE "sharedDiagnosticId" = ${D2}`)).rows;
    expect((await callShare({ id: D1, action: 'messages', threadId: t2 }, OWNER)).statusCode).toBe(404);   // a thread of another dossier through one's own
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDossierMessage" WHERE "threadId" = ${tid}`)).rows[0].n).toBe(before);
  });

  it('a revoked session (sessionsValidAfter) no longer opens the thread', async () => {
    await db.execute(sql`UPDATE "CitizenUser" SET "sessionsValidAfter" = NOW() + interval '1 hour' WHERE id = ${OWNER.id}`);
    expect((await callShare({ id: D1, action: 'list' }, OWNER)).statusCode).toBe(404);
    await db.execute(sql`UPDATE "CitizenUser" SET "sessionsValidAfter" = NULL WHERE id = ${OWNER.id}`);
    expect((await callShare({ id: D1, action: 'list' }, OWNER)).statusCode).toBe(200);
  });

  it('once the person removed the organisation the thread is closed: readable, a new message is refused (409 thread_closed)', async () => {
    await db.execute(sql`UPDATE "SharedDossierGrant" SET "revokedAt" = NOW() WHERE id = ${`a17-g-${D1}`}`);
    expect((await callShare({ id: D1, action: 'list' }, OWNER)).body.threads[0].closed).toBe(true);
    expect((await callShare({ id: D1, action: 'messages', threadId: tid }, OWNER)).body.items).toHaveLength(2);
    const r = await callShare({ id: D1, action: 'send', threadId: tid, encryptedContent: 'late' }, OWNER);
    expect(r.statusCode).toBe(409); expect(r.body.error).toBe('thread_closed');
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDossierMessage" WHERE "threadId" = ${tid}`)).rows[0].n).toBe(2);
  });
});
