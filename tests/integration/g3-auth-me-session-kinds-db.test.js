/**
 * G-3 (07/11/2026, V1a) — REAL PostgreSQL, the real auth/me handler under the Production-equivalent gates (restricted beta, capability enforcement on):
 * each session kind is recognised only when ITS surface is open, otherwise it reads as « not signed in » (401, never a 503 outage):
 *   administrator (named account, MFA session) → 200 with « admin » open and « accounts » closed; 401 when « admin » is closed;
 *   disabled administrator, revoked session, expired / forged / missing token → 401;
 *   citizen session → 401 while « accounts » is closed, 200 once it is open;  professional session → 401 while « pro » is closed, 200 once it is open.
 * Synthetic data only. Skipped without DATABASE_URL.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const ADMIN = { id: `g3-ad-${TS}`, email: `g3-admin-${TS}@example.test` };
const OFF = { id: `g3-off-${TS}`, email: `g3-off-${TS}@example.test` };
const CIT = { id: `g3-ci-${TS}`, email: `g3-citizen-${TS}@example.test` };
const SID = `g3-st-${TS}`;
const PRO = { id: `g3-pro-${TS}`, email: `g3-pro-${TS}@example.test` };
const GATES = ['ADA_PUBLIC_BETA_RESTRICTED', 'ADA_CAPABILITY_ENFORCEMENT', 'ADA_BETA_OPEN_SURFACES'];
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('G-3 — auth/me answers each session kind by its own surface (real DB)', () => {
  let db, auth, userAuth, me, saved;
  const call = async ({ bearer, cookie } = {}) => {
    const r = mk();
    const headers = { host: 'localhost', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(cookie ? { cookie: `ada_user_session=${encodeURIComponent(cookie)}` } : {}) };
    await me({ method: 'GET', url: '/api/auth/me', query: {}, socket: {}, headers }, r); return r;
  };
  const gates = (open) => { process.env.ADA_PUBLIC_BETA_RESTRICTED = '1'; process.env.ADA_CAPABILITY_ENFORCEMENT = '1'; process.env.ADA_BETA_OPEN_SURFACES = open; };

  beforeAll(async () => {
    saved = Object.fromEntries(GATES.map((k) => [k, process.env[k]]));
    ({ db } = await import('../../src/db/index.js'));
    auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js');
    me = (await import('../../api/_handlers/auth/me.js')).default;
    for (const a of [ADMIN, OFF]) {
      await db.execute(sql`INSERT INTO "AdminUser" (id, email, password, role, "createdAt", "updatedAt", "failedLoginAttempts", "mfaEnabled", "displayName")
        VALUES (${a.id}, ${a.email}, 'x', 'superadmin', NOW(), NOW(), 0, true, ${'G3 ' + a.id})`);
    }
    await db.execute(sql`UPDATE "AdminUser" SET "disabledAt" = NOW() WHERE id = ${OFF.id}`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "createdAt", "updatedAt") VALUES (${CIT.id}, ${CIT.email}, 'x', NOW(), NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${SID}, 'G3 structure', ${SID}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", mfa_enabled, "updatedAt") VALUES (${PRO.id}, ${PRO.email}, 'x', 'STRUCTURE_ADMIN', 'active', ${SID}, true, NOW())`);
  }, 60000);
  afterEach(() => { for (const k of GATES) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AdminUser" WHERE id IN (${ADMIN.id}, ${OFF.id})`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${CIT.id}`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${PRO.id}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${SID}`);
  });

  it('an administrator MFA session is recognised with only « admin » open (« accounts » closed)', async () => {
    gates('admin');
    const r = await call({ bearer: auth.signAdminSessionToken({ email: ADMIN.email, role: 'superadmin', mfa_verified: true }) });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    expect(r.body.session).toMatchObject({ kind: 'admin', authType: 'admin_jwt', role: 'superadmin' });
  });

  it('administrator: « admin » closed, disabled account, revoked session, expired / forged / missing token → 401, never 503', async () => {
    gates('');
    expect((await call({ bearer: auth.signAdminSessionToken({ email: ADMIN.email, role: 'superadmin', mfa_verified: true }) })).statusCode, 'admin surface closed').toBe(401);
    gates('admin');
    expect((await call({ bearer: auth.signAdminSessionToken({ email: OFF.email, role: 'superadmin', mfa_verified: true }) })).statusCode, 'disabled administrator').toBe(401);
    const old = auth.signAdminSessionToken({ email: ADMIN.email, role: 'superadmin', mfa_verified: true });
    await new Promise((r) => setTimeout(r, 5));
    await db.execute(sql`UPDATE "AdminUser" SET "sessionsValidAfter" = NOW() WHERE id = ${ADMIN.id}`);
    expect((await call({ bearer: old })).statusCode, 'session revoked').toBe(401);
    await db.execute(sql`UPDATE "AdminUser" SET "sessionsValidAfter" = NULL WHERE id = ${ADMIN.id}`);
    const now = Math.floor(Date.now() / 1000);
    const secret = process.env.AUTH_SECRET || process.env.JWT_SECRET;
    const expired = auth.signJwt({ email: ADMIN.email, role: 'superadmin', mfa_verified: true, authType: 'admin_jwt', typ: 'admin', iat: now - 7200, exp: now - 3600 }, secret);
    expect((await call({ bearer: expired })).statusCode, 'expired token').toBe(401);
    const forged = auth.signAdminSessionToken({ email: ADMIN.email, role: 'superadmin', mfa_verified: true }).replace(/\.[^.]+$/, `.${crypto.randomBytes(32).toString('base64url')}`);
    expect((await call({ bearer: forged })).statusCode, 'forged signature').toBe(401);
    expect((await call({})).statusCode, 'no token').toBe(401);
  });

  it('citizen session: 401 while « accounts » is closed (nothing read), 200 once it is open', async () => {
    const cookie = userAuth.signUserSessionToken({ userId: CIT.id, email: CIT.email });
    gates('admin');
    const closed = await call({ cookie });
    expect(closed.statusCode).toBe(401); expect(JSON.stringify(closed.body)).not.toContain(CIT.email);
    gates('admin,accounts');
    const open = await call({ cookie });
    expect(open.statusCode, JSON.stringify(open.body)).toBe(200); expect(open.body.session.kind).toBe('user');
  });

  it('professional session: 401 while « pro » is closed, 200 once it is open', async () => {
    const token = auth.signProToken({ id: PRO.id, email: PRO.email, structureId: SID, role: 'STRUCTURE_ADMIN' }, { mfa: true });
    gates('admin');
    expect((await call({ bearer: token })).statusCode).toBe(401);
    gates('admin,pro');
    const open = await call({ bearer: token });
    expect(open.statusCode, JSON.stringify(open.body)).toBe(200); expect(open.body.session.kind).toBe('pro');
  });
});
