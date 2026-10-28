/**
 * R24 (owner decision R21.1, 2026-10-28) — REAL PostgreSQL, real handlers, the in-memory TEST mail outbox (synthetic delivery: nothing leaves the machine):
 * an institutional partner's self-service password reset. The same answer for a known, unknown or inactive address; one link (256-bit token, only its SHA-256
 * stored), 30 minutes, single use, replaced by a newer request, killed by a password change or an administrator's hand-over; the shared password rule; every
 * session ends; no token or password in a response, the journal or the database; without an e-mail provider the page says so and points to ADA's hand-over.
 * Synthetic data only. Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const EMAIL = `r24i-${TS}@example.test`;
const CHOSEN = 'Choisi-Par-Lien-24', LATER = 'Encore-Un-Autre-25';
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('R24 institutional self-service reset (real DB, synthetic e-mail)', () => {
  let db, svc, H, mailer, agreement, account, initial;
  const call = async (path, body, token) => { const r = mk(); await H({ method: 'POST', url: `/api/institution/${path}`, query: {}, socket: {}, body, headers: { host: 'localhost', ...(token ? { authorization: `Bearer ${token}` } : {}) } }, r); return r; };
  const me = async (token) => { const r = mk(); await H({ method: 'GET', url: '/api/institution/me', query: {}, socket: {}, headers: { host: 'localhost', authorization: `Bearer ${token}` } }, r); return r.statusCode; };
  const login = (password) => call('login', { email: EMAIL, password });
  const forgot = (email = EMAIL) => call('forgot', { email });
  const mails = () => mailer.__getTestOutbox().filter((m) => m.to === EMAIL);
  const lastToken = () => { const m = mails().at(-1); return /#token=([a-f0-9]{64})/.exec(m.text)[1]; };
  const journal = async () => (await db.execute(sql`SELECT action, details::text d FROM "AuditLog" WHERE entity_id = ${account} ORDER BY "timestamp"`)).rows;

  beforeAll(async () => {
    vi.stubEnv('MAILER_PROVIDER', 'test'); vi.stubEnv('MAILER_FROM', 'ADA QA <qa@example.test>'); vi.stubEnv('APP_BASE_URL', 'http://localhost:3000');
    ({ db } = await import('../../src/db/index.js'));
    svc = await import('../../api/_services/institutions.js');
    mailer = await import('../../api/_utils/mailer.js');
    H = (await import('../../api/_handlers/institution.js')).default;
    agreement = (await svc.createAgreement({ partnerName: `R24 Collectivité ${TS}`, kind: 'CONVENTION', scope: 'statistiques' }, 'qa-admin@example.test', db)).id;
    expect((await svc.recordSignature(agreement, { documentRef: 'QA-R24', signedAt: '2026-10-01', signedByPartner: 'QA signataire' }, 'qa-admin@example.test', db)).ok).toBe(true);
    const created = await svc.createAccount({ email: EMAIL, organisationName: 'R24 Collectivité', territory: 'Bas-Rhin', agreementId: agreement }, 'qa-admin@example.test', db);
    account = created.id; initial = created.initialPassword;
  }, 60000);
  beforeEach(() => { vi.stubEnv('MAILER_PROVIDER', 'test'); });
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity_id IN (${account || ''}, ${agreement || ''})`).catch(() => {});
    await db.execute(sql`DELETE FROM "InstitutionAccount" WHERE email = ${EMAIL}`);
    await db.execute(sql`DELETE FROM "PartnerAgreement" WHERE id = ${agreement || ''}`);
  });

  it('the same answer for an inactive, unknown or malformed address; only an ACTIVE account receives a link', async () => {
    const pending = await forgot();   // the account is not activated yet
    const unknown = await forgot(`nobody-${TS}@example.test`);
    expect(pending.statusCode).toBe(200); expect(unknown.statusCode).toBe(200);
    expect(pending.body).toEqual(unknown.body); expect(pending.body.emailDelivery).toBe('SENT_IF_VALID');
    expect(mails()).toHaveLength(0);
    expect((await forgot('pas-une-adresse')).body).toEqual(unknown.body);
    expect((await call('forgot', {})).statusCode).toBe(400);
    expect((await svc.setAccountStatus(account, 'ACTIVATE', 'qa-admin@example.test', db)).ok).toBe(true);
    const known = await forgot(EMAIL.toUpperCase());
    expect(known.body, 'case-insensitive, and still the same answer').toEqual(unknown.body);
    expect(mails()).toHaveLength(1);
    expect(mails()[0].text).toMatch(/\/institution\/reinitialiser#token=[a-f0-9]{64}/); expect(mails()[0].text).toContain('30 minutes');
    const [row] = (await db.execute(sql`SELECT "resetTokenHash" h, "resetExpiresAt" e FROM "InstitutionAccount" WHERE id = ${account}`)).rows;
    expect(row.h).toMatch(/^[a-f0-9]{64}$/); expect(row.h, 'the database keeps the hash, never the token').not.toBe(lastToken());
    const minutes = (new Date(row.e).getTime() - Date.now()) / 60000; expect(minutes).toBeGreaterThan(28); expect(minutes).toBeLessThanOrEqual(30.1);
  });

  it('the link sets a new password under the shared rule, once; every session ends; nothing secret is kept', async () => {
    const before = await login(initial); expect(before.statusCode).toBe(200);
    await forgot(); const older = mails().at(-2) ? /#token=([a-f0-9]{64})/.exec(mails().at(-2).text)[1] : null; const token = lastToken();
    expect((await call('reset', { token: older, password: CHOSEN })).body.error, 'a newer request replaces the previous link').toBe('INVALID_RESET_LINK');
    expect((await call('reset', { token: 'abc', password: CHOSEN })).body.error).toBe('INVALID_RESET_LINK');
    const weak = await call('reset', { token, password: 'motdepasse' });
    expect(weak.statusCode).toBe(400); expect(weak.body.message).toBe('Mot de passe trop faible : 1 majuscule requise, 1 chiffre requis.');
    const ok = await call('reset', { token, password: CHOSEN });
    expect(ok.statusCode, JSON.stringify(ok.body)).toBe(200); expect(Object.keys(ok.body).sort()).toEqual(['message', 'ok']);
    expect(await me(before.body.token), 'every session ends').toBe(401);
    expect((await call('reset', { token, password: LATER })).body.error, 'single use').toBe('INVALID_RESET_LINK');
    const after = await login(CHOSEN); expect(after.statusCode).toBe(200); expect(after.body.temporaryPassword, 'a personal password now').toBe(false);
    expect((await login(initial)).statusCode).toBe(401);
    const rows = await journal();
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['INSTITUTION_RESET_REQUESTED', 'INSTITUTION_PASSWORD_RESET_BY_LINK']));
    for (const r of rows) for (const secret of [token, CHOSEN, initial]) expect(r.d).not.toContain(secret);
    const [row] = (await db.execute(sql`SELECT "resetTokenHash" h, "passwordHash" p FROM "InstitutionAccount" WHERE id = ${account}`)).rows;
    expect(row.h).toBeNull(); expect(row.p).not.toContain(CHOSEN); expect(row.p.startsWith('temporary:')).toBe(false);
  });

  it('a link expires, dies with a password change or an administrator\'s hand-over, and works for a locked account (the lockout is cleared)', async () => {
    await forgot(); let token = lastToken();
    await db.execute(sql`UPDATE "InstitutionAccount" SET "resetExpiresAt" = NOW() - interval '1 second' WHERE id = ${account}`);
    expect((await call('reset', { token, password: LATER })).body.error, 'expired').toBe('INVALID_RESET_LINK');
    await forgot(); token = lastToken();
    const s = await login(CHOSEN);
    expect((await call('password', { currentPassword: CHOSEN, newPassword: LATER }, s.body.token)).statusCode).toBe(200);
    expect((await call('reset', { token, password: 'Troisieme-Choix-26' })).body.error, 'a change kills the pending link').toBe('INVALID_RESET_LINK');
    await forgot(); token = lastToken();
    const handed = await svc.resetInstitutionPassword(account, 'qa-admin@example.test', db);
    expect((await call('reset', { token, password: 'Troisieme-Choix-26' })).body.error, 'so does the administrator\'s hand-over').toBe('INVALID_RESET_LINK');
    for (let i = 0; i < 5; i += 1) await login('Mauvais-Essai-1');
    expect((await login(handed.initialPassword)).statusCode, 'locked').toBe(423);
    await forgot(); token = lastToken();
    expect((await call('reset', { token, password: 'Troisieme-Choix-26' })).statusCode).toBe(200);
    expect((await login('Troisieme-Choix-26')).statusCode, 'the lockout is cleared').toBe(200);
  });

  it('a suspended account gets no link and cannot use one; without an e-mail provider the page says so and points to ADA', async () => {
    await forgot(); const token = lastToken(); const sent = mails().length;
    expect((await svc.setAccountStatus(account, 'SUSPEND', 'qa-admin@example.test', db)).ok).toBe(true);
    expect((await call('reset', { token, password: 'Quatrieme-Choix-27' })).body.error).toBe('INVALID_RESET_LINK');
    expect((await forgot()).body.emailDelivery).toBe('SENT_IF_VALID'); expect(mails()).toHaveLength(sent);
    vi.stubEnv('MAILER_PROVIDER', 'noop');
    const off = await forgot(`nobody-${TS}@example.test`);
    expect(off.statusCode).toBe(200); expect(off.body.emailDelivery).toBe('UNAVAILABLE'); expect(off.body.message).toContain('Contactez ADA');
  });
});
