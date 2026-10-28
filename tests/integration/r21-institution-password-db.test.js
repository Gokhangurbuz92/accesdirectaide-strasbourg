/**
 * R21 (Strasbourg V1, 2026-10-28) — REAL PostgreSQL, real handlers: an institutional partner's password. The initial password is temporary (the space asks for a
 * personal one); the change needs the current password and the shared rule, ends every OTHER session and keeps this one (new token); the old password stops
 * working; « Se déconnecter » ends every session on the server; a lost password is replaced by an administrator's new temporary password (shown once, sessions
 * ended, lockout cleared); nothing secret reaches a response or the journal. The professional password screens' server side now applies the same shared rule.
 * Synthetic data only. Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const EMAIL = `r21i-${TS}@example.test`;
const CHOSEN = 'Choisi-Par-Partenaire-21', LATER = 'Encore-Autre-Choix-22';
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('R21 institutional password (real DB)', () => {
  let db, svc, H, agreement, account, initial;
  const call = async (h, req) => { const r = mk(); await h({ query: {}, socket: {}, headers: { host: 'localhost' }, ...req }, r); return r; };
  const inst = (method, path, token, body) => call(H, { method, url: `/api/institution/${path}`, body, headers: { host: 'localhost', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  const login = (password) => inst('POST', 'login', null, { email: EMAIL, password });
  const journal = async (action) => (await db.execute(sql`SELECT details::text d FROM "AuditLog" WHERE action = ${action} AND entity_id = ${account}`)).rows;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    svc = await import('../../api/_services/institutions.js');
    H = (await import('../../api/_handlers/institution.js')).default;
    agreement = (await svc.createAgreement({ partnerName: `R21 Collectivité ${TS}`, kind: 'CONVENTION', scope: 'statistiques' }, 'qa-admin@example.test', db)).id;
    expect((await svc.recordSignature(agreement, { documentRef: 'QA-R21', signedAt: '2026-10-01', signedByPartner: 'QA signataire' }, 'qa-admin@example.test', db)).ok).toBe(true);
    const created = await svc.createAccount({ email: EMAIL, organisationName: 'R21 Collectivité', territory: 'Bas-Rhin', agreementId: agreement }, 'qa-admin@example.test', db);
    expect(created.ok).toBe(true); account = created.id; initial = created.initialPassword;
    expect((await svc.setAccountStatus(account, 'ACTIVATE', 'qa-admin@example.test', db)).ok).toBe(true);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity_id IN (${account || ''}, ${agreement || ''})`).catch(() => {});
    await db.execute(sql`DELETE FROM "InstitutionAccount" WHERE email = ${EMAIL}`);
    await db.execute(sql`DELETE FROM "PartnerAgreement" WHERE id = ${agreement || ''}`);
  });

  it('the initial password is temporary; the change needs the current one and the shared rule, ends the other sessions and keeps this one', async () => {
    const listed = async () => (await svc.listAll(db)).accounts.find((x) => x.id === account);
    expect(await listed(), 'the administrators see it, never the hash').toMatchObject({ temporaryPassword: true }); expect(await listed()).not.toHaveProperty('passwordHash');
    const first = await login(initial); expect(first.statusCode).toBe(200); expect(first.body.temporaryPassword).toBe(true);
    const other = await login(initial);   // a second device
    expect((await inst('GET', 'me', first.body.token)).body).toMatchObject({ organisation: 'R21 Collectivité', temporaryPassword: true });
    expect((await inst('POST', 'password', null, { currentPassword: initial, newPassword: CHOSEN })).statusCode, 'no session').toBe(401);
    expect((await inst('GET', 'password', first.body.token)).statusCode).toBe(405);
    const wrong = await inst('POST', 'password', first.body.token, { currentPassword: 'Pas-Le-Bon-1', newPassword: CHOSEN });
    expect(wrong.statusCode).toBe(400); expect(wrong.body).toEqual({ error: 'WRONG_CURRENT_PASSWORD', message: 'Le mot de passe actuel est incorrect.' });
    const weak = await inst('POST', 'password', first.body.token, { currentPassword: initial, newPassword: 'motdepasse' });
    expect(weak.statusCode).toBe(400); expect(weak.body.message).toBe('Mot de passe trop faible : 1 majuscule requise, 1 chiffre requis.');
    expect((await inst('POST', 'password', first.body.token, { currentPassword: initial, newPassword: initial })).body.error).toBe('SAME_PASSWORD');
    const ok = await inst('POST', 'password', first.body.token, { currentPassword: initial, newPassword: CHOSEN });
    expect(ok.statusCode, JSON.stringify(ok.body)).toBe(200); expect(ok.body.message).toBe('Mot de passe modifié. Vos autres sessions ont été fermées.');
    expect(Object.keys(ok.body).sort()).toEqual(['message', 'token']);
    expect((await inst('GET', 'me', other.body.token)).statusCode, 'the other device is signed out').toBe(401);
    expect((await inst('GET', 'me', first.body.token)).statusCode, 'the token of the old password is dead too').toBe(401);
    expect((await inst('GET', 'me', ok.body.token)).body.temporaryPassword, 'this session goes on, the password is personal now').toBe(false);
    expect((await inst('GET', 'observatoire', ok.body.token)).statusCode).toBe(200);
    expect((await login(initial)).statusCode, 'the temporary password no longer works').toBe(401);
    const again = await login(CHOSEN); expect(again.statusCode).toBe(200); expect(again.body.temporaryPassword).toBe(false);
    expect((await listed()).temporaryPassword).toBe(false);
    const rows = await journal('INSTITUTION_PASSWORD_CHANGED'); expect(rows).toHaveLength(1);
    for (const secret of [initial, CHOSEN, 'scrypt', 'temporary:']) expect(rows[0].d).not.toContain(secret);
    const stored = (await db.execute(sql`SELECT "passwordHash" h FROM "InstitutionAccount" WHERE id = ${account}`)).rows[0].h;
    expect(stored.startsWith('temporary:')).toBe(false); expect(stored).not.toContain(CHOSEN);
  });

  it('« Se déconnecter » ends every session on the server; the next sign-in works', async () => {
    const a = await login(CHOSEN); const b = await login(CHOSEN);
    expect((await inst('POST', 'logout', a.body.token, {})).statusCode).toBe(200);
    expect((await inst('GET', 'me', a.body.token)).statusCode).toBe(401);
    expect((await inst('GET', 'me', b.body.token)).statusCode, 'every device').toBe(401);
    expect((await inst('POST', 'logout', a.body.token, {})).statusCode, 'an ended session cannot act').toBe(401);
    const c = await login(CHOSEN); expect((await inst('GET', 'me', c.body.token)).statusCode).toBe(200);
    expect(await journal('INSTITUTION_LOGOUT')).toHaveLength(1);
  });

  it('a lost password or a locked account: an administrator hands over a new temporary password; every session ends; the person chooses again', async () => {
    const s = await login(CHOSEN);
    for (let i = 0; i < 5; i += 1) await login('Mauvais-Essai-1');
    expect((await login(CHOSEN)).statusCode, 'locked after 5 failures').toBe(423);
    const reset = await svc.resetInstitutionPassword(account, 'qa-admin@example.test', db);
    expect(reset.ok).toBe(true); expect(reset.initialPassword).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect((await inst('GET', 'me', s.body.token)).statusCode, 'sessions ended').toBe(401);
    expect((await login(CHOSEN)).statusCode, 'the lost password no longer works').toBe(401);
    const t = await login(reset.initialPassword); expect(t.statusCode, 'lockout cleared').toBe(200); expect(t.body.temporaryPassword).toBe(true);
    expect((await inst('POST', 'password', t.body.token, { currentPassword: reset.initialPassword, newPassword: LATER })).statusCode).toBe(200);
    const rows = await journal('INSTITUTION_PASSWORD_RESET'); expect(rows).toHaveLength(1); expect(rows[0].d).not.toContain(reset.initialPassword);
    expect((await svc.resetInstitutionPassword('r21-unknown', 'qa-admin@example.test', db)).status).toBe(404);
  });

  it('a suspended account\'s session ends and its password cannot be changed', async () => {
    const s = await login(LATER);
    expect((await svc.setAccountStatus(account, 'SUSPEND', 'qa-admin@example.test', db)).ok).toBe(true);
    expect((await inst('POST', 'password', s.body.token, { currentPassword: LATER, newPassword: CHOSEN })).statusCode).toBe(401);
    expect((await login(LATER)).statusCode).toBe(403);
  });

  it('the professional password screens\' server side applies the shared rule (sign-up by invitation, reset link)', async () => {
    const reset = (await import('../../api/_handlers/pro/auth/reset-password.js')).default;
    const r1 = await call(reset, { method: 'POST', body: { token: 'r21-any', password: 'motdepasse1' } });
    expect(r1.statusCode).toBe(400); expect(r1.body.error).toBe('Mot de passe trop faible : 1 majuscule requise.');
    const invite = (await import('../../api/_handlers/pro/auth/register-invite.js')).default;
    const r2 = await call(invite, { method: 'POST', url: '/api/pro/auth/register-invite', body: { token: 'r21-any', password: 'MOTDEPASSE' } });
    expect(r2.statusCode).toBe(400); expect(r2.body.error).toBe('Mot de passe trop faible : 1 minuscule requise, 1 chiffre requis.');
  });
});
