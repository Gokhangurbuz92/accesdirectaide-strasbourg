/**
 * Owner LAB audit (2026-10-24) on REAL PostgreSQL — one-time codes are used ONCE (RFC 6238 §5.2) and professional TOTP seeds are sealed at rest (migration 0034):
 *  - administrator: a sign-in code is accepted once — also when the same code arrives twice at the same moment (exactly one wins) — and the code of the
 *    sign-in does not elevate; a code of the next 30-second step does, once; the MFA steps are in the session history (ADMIN_MFA_VERIFIED / ADMIN_MFA_FAILED);
 *  - professional: the enrolment stores « v1:… » (the seed is not readable in the table), the enrolment code cannot sign in again, the next step's code does,
 *    a seed stored before the change (clear base32) still works, and switching MFA off needs an unused code.
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const ADM = `mfa1-adm-${TS}@example.test`, SUP = `mfa1-sup-${TS}@example.test`;
const ST = `mfa1-st-${TS}`; const PRO = { id: `mfa1-pro-${TS}`, email: `mfa1-pro-${TS}@example.test` };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; },
  end() { return this; }, setHeader(k, v) { this.headers[k] = v; }, getHeader() { return undefined; } });

describe.skipIf(!hasDatabase)('one-time codes are used once; professional seeds are sealed (real DB)', () => {
  let db, auth, otp, vault, guard, jwt, adminSecret, supSecret;
  const at = (secret, ahead = 0) => otp.generateSync({ secret, epoch: Math.floor(Date.now() / 1000) + 30 * ahead });
  const adminReq = (email, role, body) => ({ method: 'POST', url: '/api/admin/mfa-verify', query: {}, body, headers: { host: 'localhost', authorization: `Bearer ${auth.signAdminSessionToken({ email, role, mfa_verified: false })}` } });
  const pendingPro = () => jwt.sign({ userId: PRO.id, email: PRO.email, structureId: ST, scope: 'mfa_pending' }, process.env.JWT_SECRET, { expiresIn: '5m', algorithm: 'HS256' });
  const proVerify = async (code) => { const h = (await import('../../api/_handlers/pro/auth/mfa-verify.js')).default; const r = mk();
    await h({ method: 'POST', url: '/api/pro/auth/mfa-verify', query: {}, body: { mfa_token: pendingPro(), code }, headers: { host: 'localhost' } }, r); return r; };

  beforeAll(async () => {
    process.env.OUTLOOK_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');   // synthetic vault key for this suite only
    ({ db } = await import('../../src/db/index.js'));
    auth = await import('../../api/_utils/auth.js'); otp = await import('otplib'); vault = await import('../../api/_utils/vault.js'); guard = await import('../../api/_utils/totp-guard.js');
    jwt = (await import('jsonwebtoken')).default;
    adminSecret = otp.generateSecret(); supSecret = otp.generateSecret();
    for (const [email, role, secret] of [[ADM, 'admin', adminSecret], [SUP, 'superadmin', supSecret]]) {
      const enc = vault.encryptToken(secret);
      await db.execute(sql`INSERT INTO "AdminUser" (id, email, password, role, "createdAt", "updatedAt", "failedLoginAttempts", "mfaEnabled", "mfaSecret", "mfaIv")
        VALUES (${'mfa1-' + crypto.randomUUID()}, ${email}, 'x', ${role}, NOW(), NOW(), 0, true, ${enc.content}, ${enc.iv})`);
    }
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${ST}, 'Org MFA', ${ST}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${PRO.id}, ${PRO.email}, 'x', 'PRO', 'active', ${ST}, false, NOW())`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE actor IN (${ADM}, ${SUP}, ${PRO.id})`).catch(() => {});
    await db.execute(sql`DELETE FROM "AdminUser" WHERE email IN (${ADM}, ${SUP})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${PRO.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${ST}`).catch(() => {});
  });

  it('administrator: a sign-in code is accepted once (also twice at the same moment), does not elevate; the next step’s code elevates, once', async () => {
    const verify = (await import('../../api/_handlers/admin/mfa-verify.js')).default;
    const c = at(adminSecret); const r1 = mk(), r2 = mk();
    await Promise.all([verify(adminReq(ADM, 'admin', { code: c }), r1), verify(adminReq(ADM, 'admin', { code: c }), r2)]);
    expect([r1.statusCode, r2.statusCode].sort(), 'exactly one of two simultaneous uses').toEqual([200, 403]);
    const r3 = mk(); await verify(adminReq(ADM, 'admin', { code: c }), r3); expect(r3.statusCode, 'replay').toBe(403);
    const r4 = mk(); await verify(adminReq(ADM, 'admin', { code: at(adminSecret, 1) }), r4); expect(r4.statusCode, 'a code of the next step').toBe(200);
    const acts = (await db.execute(sql`SELECT action FROM "AuditLog" WHERE actor = ${ADM}`)).rows.map((x) => x.action);
    expect(acts.filter((a) => a === 'ADMIN_MFA_VERIFIED')).toHaveLength(2); expect(acts.filter((a) => a === 'ADMIN_MFA_FAILED')).toHaveLength(2);

    const ident = await import('../../api/_services/admin-identity.js');
    const sc = at(supSecret); const sv = mk(); await verify(adminReq(SUP, 'superadmin', { code: sc }), sv); expect(sv.statusCode).toBe(200);
    const ctx = { authType: 'admin_jwt', mfa_verified: true, email: SUP }; const reason = 'Contrôle synthétique de la règle du code unique';
    expect((await ident.elevate(ctx, { code: sc, reason })).code, 'the sign-in code does not elevate').toBe('FRESH_MFA_CODE_REQUIRED');
    const nx = at(supSecret, 1);
    expect((await ident.elevate(ctx, { code: nx, reason })).ok).toBe(true);
    expect((await ident.elevate(ctx, { code: nx, reason })).code, 'an elevation code is used once').toBe('FRESH_MFA_CODE_REQUIRED');
  });

  it('professional: the seed is stored sealed; the enrolment code does not sign in again; the next step’s code does; a clear seed stored before still works; switching off needs an unused code', async () => {
    const setup = (await import('../../api/_handlers/pro/mfa-setup.js')).default;
    const tok = auth.signProToken({ id: PRO.id, email: PRO.email, structureId: ST, role: 'PRO' });
    const req = (method, body) => ({ method, url: '/api/pro/mfa-setup', query: {}, body, headers: { host: 'localhost', authorization: `Bearer ${tok}` } });
    let r = mk(); await setup(req('GET'), r); expect(r.statusCode).toBe(200); const secret = r.body.secret;
    const stored = (await db.execute(sql`SELECT mfa_secret FROM "ProUser" WHERE id = ${PRO.id}`)).rows[0].mfa_secret;
    expect(stored.startsWith('v1:')).toBe(true); expect(stored).not.toContain(secret); expect(guard.openMfaSecret(stored)).toBe(secret);
    const enrol = at(secret); r = mk(); await setup(req('POST', { code: enrol }), r); expect(r.statusCode).toBe(200);
    expect((await proVerify(enrol)).statusCode, 'the enrolment code does not sign in').toBe(401);
    const next = at(secret, 1);
    const ok = await proVerify(next); expect(ok.statusCode).toBe(200); expect(ok.body.token).toBeTruthy();
    expect((await proVerify(next)).statusCode, 'replay at sign-in').toBe(401);
    // a seed stored in clear before this change is still read (no lock-out of enrolled professionals)
    const legacy = otp.generateSecret();
    await db.execute(sql`UPDATE "ProUser" SET mfa_secret = ${legacy}, mfa_last_time_step = NULL, mfa_enabled = true WHERE id = ${PRO.id}`);
    const lc = at(legacy); expect((await proVerify(lc)).statusCode).toBe(200);
    r = mk(); await setup(req('DELETE', { code: lc }), r); expect(r.statusCode, 'switching off with the code just used').toBe(400);
    r = mk(); await setup(req('DELETE', { code: at(legacy, 1) }), r); expect(r.statusCode).toBe(200);
    expect((await db.execute(sql`SELECT mfa_enabled e, mfa_secret s FROM "ProUser" WHERE id = ${PRO.id}`)).rows[0]).toEqual({ e: false, s: null });
  });
});
