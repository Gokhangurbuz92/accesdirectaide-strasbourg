/**
 * PKG-11 audit — professional session lifecycle on the REAL API entry (api/index.js) and REAL PostgreSQL (migration 0029 ProUser.sessionsValidAfter).
 * Defects pinned: « Déconnexion » only cleared the browser (the 8 h token stayed valid and refreshable); the refresh grace path accepted any token signed with the
 * secret; the password-reset link was only LOGGED (« [MOCK EMAIL] ») while the person was told it was sent, the raw token was the KV key, and a reset left every
 * session alive; the e-mail button of the CITIZEN reset pointed at a page that does not exist. Synthetic accounts; the test mailer records instead of sending.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

// the integration environment points KV at a dummy URL: an in-memory store with Redis semantics (DEL returns how many keys it removed) stands in for Upstash
const KV = vi.hoisted(() => new Map());
vi.mock('../../api/_utils/kv.js', () => ({ kv: { set: async (k, v) => { KV.set(k, v); return 'OK'; }, get: async (k) => (KV.has(k) ? KV.get(k) : null), del: async (k) => (KV.delete(k) ? 1 : 0), incr: async () => 1, expire: async () => 1 } }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const S = `psl-s-${TS}`; const U = { id: `psl-u-${TS}`, email: `PSL-${TS}@Example.test` }; const OFF = { id: `psl-off-${TS}`, email: `psl-off-${TS}@example.test` };
const CSRF = 'pslcsrf' + TS;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; this.headersSent = true; fin.forEach((l) => l()); return this; },
    send(p) { this.body = p; this.headersSent = true; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; this.headersSent = true; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('pro session lifecycle (real API entry, real DB)', () => {
  let db, api, auth, mailer, kv, templates;
  const call = async (method, url, { bearer, body } = {}) => {
    const req = { method, url, query: Object.fromEntries(new URL(url, 'http://localhost:3000').searchParams), body: body ?? null, cookies: {},
      headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', cookie: `__csrf=${CSRF}`, 'x-csrf-token': CSRF, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } };
    const res = mkRes(); await api(req, res); return res;
  };
  const tok = () => auth.signProToken({ id: U.id, email: U.email, structureId: S, role: 'STRUCTURE_ADMIN' });
  beforeAll(async () => {
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js'); mailer = await import('../../api/_utils/mailer.js');
    ({ kv } = await import('../../api/_utils/kv.js')); ({ templates } = await import('../../api/lib/email-service.js'));
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${S}, 'Org PSL', ${S}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "updatedAt") VALUES (${U.id}, ${U.email}, 'old-hash', 'STRUCTURE_ADMIN', 'active', ${S}, NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "updatedAt") VALUES (${OFF.id}, ${OFF.email}, 'x', 'PRO', 'disabled', ${S}, NOW())`);
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE actor IN (${U.id}, ${OFF.id})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProUser" WHERE id IN (${U.id}, ${OFF.id})`); await db.execute(sql`DELETE FROM "Structure" WHERE id = ${S}`);
  });

  it('logout ends the session ON THE SERVER: the same token is refused everywhere and cannot be refreshed; a new login works', async () => {
    const t1 = tok();
    expect((await call('GET', '/api/pro/me', { bearer: t1 })).statusCode).toBe(200);
    await wait(1100);
    expect((await call('POST', '/api/pro/auth/logout', { bearer: t1 })).statusCode).toBe(200);
    const after = await call('GET', '/api/pro/me', { bearer: t1 }); expect(after.statusCode).toBe(401); expect(after.body.code).toBe('SESSION_REVOKED');
    const r = await call('POST', '/api/pro/auth/refresh', { bearer: t1 }); expect(r.statusCode).toBe(401); expect(r.body.code).toBe('SESSION_REVOKED');
    expect((await db.execute(sql`SELECT count(*)::int n FROM "AuditLog" WHERE action = 'PRO_LOGOUT' AND actor = ${U.id}`)).rows[0].n).toBe(1);
    await wait(1100);
    expect((await call('GET', '/api/pro/me', { bearer: tok() })).statusCode).toBe(200);
    expect((await call('POST', '/api/pro/auth/logout')).statusCode).toBe(401);   // anonymous: nothing to end
  });

  it('the refresh grace path only accepts real pro sessions (issuer / audience), not any token signed with the secret', async () => {
    const forged = jwt.sign({ userId: U.id, structureId: S, role: 'STRUCTURE_ADMIN', scope: 'pro', exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET, { algorithm: 'HS256' });
    expect((await call('POST', '/api/pro/auth/refresh', { bearer: forged })).statusCode).toBe(401);
  });

  it('forgotten password: a real e-mail with a working link; the stored key is a HASH; unknown and disabled accounts get the same answer and no e-mail', async () => {
    mailer.__clearTestOutbox();
    const res = await call('POST', '/api/pro/auth/forgot-password', { body: { email: U.email.toLowerCase() } });
    expect(res.statusCode).toBe(200);
    const mails = mailer.__getTestOutbox(); expect(mails.length).toBe(1); expect(mails[0].to).toBe(U.email);
    const link = String(mails[0].text).match(/https?:\/\/\S+\/pro\/reset-password\?token=([0-9a-f]{64})/); expect(link).toBeTruthy();
    expect(String(mails[0].html)).toContain(`/pro/reset-password?token=${link[1]}`);
    expect(await kv.get(`reset:${link[1]}`)).toBeNull();
    expect(await kv.get(`reset:pro:${crypto.createHash('sha256').update(link[1]).digest('hex')}`)).toMatchObject({ userId: U.id });
    for (const email of [`nobody-${TS}@example.test`, OFF.email]) {
      mailer.__clearTestOutbox(); const r = await call('POST', '/api/pro/auth/forgot-password', { body: { email } });
      expect(r.statusCode).toBe(200); expect(r.body).toEqual(res.body); expect(mailer.__getTestOutbox()).toEqual([]);
    }
    U.token = link[1];
  });

  it('reset: the new password is set, the link works once, and every existing session ends', async () => {
    const old = tok(); expect((await call('GET', '/api/pro/me', { bearer: old })).statusCode).toBe(200);
    await wait(1100);
    expect((await call('POST', '/api/pro/auth/reset-password', { body: { token: U.token, password: 'court' } })).statusCode).toBe(400);   // policy first, token kept
    const ok = await call('POST', '/api/pro/auth/reset-password', { body: { token: U.token, password: 'Nouveau-Mot-De-Passe-1' } }); expect(ok.statusCode).toBe(200);
    expect((await db.execute(sql`SELECT password_hash h FROM "ProUser" WHERE id = ${U.id}`)).rows[0].h).not.toBe('old-hash');
    expect((await call('POST', '/api/pro/auth/reset-password', { body: { token: U.token, password: 'Encore-Un-Autre-2' } })).statusCode).toBe(400);
    const dead = await call('GET', '/api/pro/me', { bearer: old }); expect(dead.statusCode).toBe(401); expect(dead.body.code).toBe('SESSION_REVOKED');
  });

  it('the CITIZEN reset e-mail button points at the real page /auth/reset (before: /auth/reset-password, which does not exist)', () => {
    expect(templates.resetPassword('x', 'https://app.example.test/auth/reset?token=abc').html).toContain('https://app.example.test/auth/reset?token=abc');
    const legacy = templates.resetPassword('x', 'abc').html; expect(legacy).toContain('/auth/reset?token=abc'); expect(legacy).not.toContain('/auth/reset-password');
  });
});
