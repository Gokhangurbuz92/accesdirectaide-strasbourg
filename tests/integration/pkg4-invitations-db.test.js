/**
 * PKG-4 / D8 on REAL PostgreSQL, through the real handlers: a team invitation token is stored only as its SHA-256; the clear token travels in the invitation e-mail
 * (in-memory 'test' mailer: nothing leaves the machine); the stored hash cannot be replayed as a token; an invitation is redeemed once, also under concurrency;
 * an invitation written before PKG-4 (clear token) still works until it expires; the API answer never carries the token. Synthetic data only. Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const ST = `p4i-st-${TS}`; const ADMIN = { id: `p4i-adm-${TS}`, email: `p4i-adm-${TS}@example.test` };
const PASSWORD = 'Synthetique-QA-2026!x';
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('PKG-4 D8 team invitations (real DB)', () => {
  let db, auth, mailer, H;
  const asAdmin = async (body) => { const r = mk(); await H.invite({ method: 'POST', url: '/api/pro/invite', query: {}, body, headers: { host: 'localhost', authorization: `Bearer ${auth.signProToken({ id: ADMIN.id, email: ADMIN.email, structureId: ST, role: 'STRUCTURE_ADMIN' })}` }, socket: {} }, r); return r; };
  const check = async (token) => { const r = mk(); await H.register({ method: 'GET', url: `/api/pro/auth/register-invite?token=${encodeURIComponent(token)}`, query: { token }, headers: { host: 'localhost' } }, r); return r; };
  const redeem = async (token) => { const r = mk(); await H.register({ method: 'POST', url: '/api/pro/auth/register-invite', query: {}, body: { token, password: PASSWORD }, headers: { host: 'localhost' }, socket: {} }, r); return r; };
  const tokenFromMail = (to) => { const m = mailer.__getTestOutbox().filter((x) => x.to === to).pop(); expect(m, 'invitation e-mail handed to the mailer').toBeTruthy(); return new URL(m.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token'); };

  beforeAll(async () => {
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
    ({ db } = await import('../../src/db/index.js'));
    auth = await import('../../api/_utils/auth.js'); mailer = await import('../../api/_utils/mailer.js');
    H = { invite: (await import('../../api/_handlers/pro/invite.js')).default, register: (await import('../../api/_handlers/pro/auth/register-invite.js')).default };
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${ST}, 'Org invitations', ${ST}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${ADMIN.id}, ${ADMIN.email}, 'x', 'STRUCTURE_ADMIN', 'active', ${ST}, false, NOW())`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ProAuditLog" WHERE "structureId" = ${ST}`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuditLog" WHERE actor_id LIKE ${'p4i-%'}`).catch(() => {});
    await db.execute(sql`DELETE FROM "Invitation" WHERE "structureId" = ${ST}`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" = ${ST}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${ST}`);
  });

  it('only the hash is stored; the answer carries no token; the e-mail link works once; the stored value is not a token', async () => {
    const email = `p4i-new-${TS}@example.test`;
    const out = await asAdmin({ email, role: 'PRO' });
    expect(out.statusCode, JSON.stringify(out.body)).toBe(201);
    expect(out.body).not.toHaveProperty('token');
    const token = tokenFromMail(email); expect(token).toMatch(/^[0-9a-f]{64}$/);
    const [row] = (await db.execute(sql`SELECT token FROM "Invitation" WHERE "structureId" = ${ST} AND email = ${email}`)).rows;
    expect(row.token).toMatch(/^sha256:[0-9a-f]{64}$/); expect(row.token).not.toContain(token);
    expect((await check(row.token)).statusCode, 'a stored hash cannot be replayed as a token').toBe(404);
    expect((await check(row.token.slice(7))).statusCode).toBe(404);
    expect((await check(token)).statusCode).toBe(200);
    const ok = await redeem(token); expect(ok.statusCode, JSON.stringify(ok.body)).toBe(201); expect(ok.body.user).toMatchObject({ email, role: 'PRO', structureId: ST });
    expect((await redeem(token)).statusCode, 'single use').toBe(410);
  });

  it('two concurrent redemptions of one invitation: exactly one account', async () => {
    const email = `p4i-race-${TS}@example.test`;
    expect((await asAdmin({ email, role: 'STRUCTURE_ADMIN' })).statusCode).toBe(201);
    const token = tokenFromMail(email);
    const codes = (await Promise.all([redeem(token), redeem(token), redeem(token)])).map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201).length, JSON.stringify(codes)).toBe(1);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "ProUser" WHERE "structureId" = ${ST} AND email = ${email}`)).rows[0].n).toBe(1);
  });

  it('an invitation written before PKG-4 (clear token) still works until it expires; an expired one does not', async () => {
    const legacy = `legacy${TS}`.padEnd(64, '0'); const email = `p4i-old-${TS}@example.test`;
    await db.execute(sql`INSERT INTO "Invitation" (id, "structureId", email, role, token, expires_at) VALUES (${'inv-old-' + TS}, ${ST}, ${email}, 'PRO', ${legacy}, NOW() + interval '1 day')`);
    expect((await check(legacy)).statusCode).toBe(200);
    expect((await redeem(legacy)).statusCode).toBe(201);
    const expired = `expired${TS}`.padEnd(64, '0');
    await db.execute(sql`INSERT INTO "Invitation" (id, "structureId", email, role, token, expires_at) VALUES (${'inv-exp-' + TS}, ${ST}, ${'p4i-exp-' + TS + '@example.test'}, 'PRO', ${expired}, NOW() - interval '1 minute')`);
    expect((await redeem(expired)).statusCode).toBe(410);
  });
});
