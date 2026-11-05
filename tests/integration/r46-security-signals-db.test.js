/**
 * R46 / Q07 + N10 — on REAL PostgreSQL, through the real API entry where a route exists:
 *  - refused citizen and institution sign-ins leave an audit row WITHOUT the e-mail (CITIZEN_LOGIN_FAILED, INSTITUTION_LOGIN_FAILED);
 *  - the 5-minute health check counts refused sign-ins, refused MFA codes and data exports from the audit trail and sends ONE alert per signal through the
 *    alert channel (local webhook receiver), counts only, nothing secret; the cooldown holds the second run;
 *  - GET /api/admin/security-signals and GET /api/admin/provider-status answer only a named administrator session, with aggregates / variable names only
 *    (a synthetic secret placed in the environment never appears).
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('203.0.113.7'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const SECRET = `synthetic-secret-${TS}-must-never-appear`;
const res = () => { const r = { statusCode: 200, body: null, headers: {}, fin: [] }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; r.fin.forEach((f) => f()); return r; };
  r.send = (b) => { r.body = b; return r; }; r.end = (b) => { if (b !== undefined) r.body = b; return r; }; r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; }; r.getHeader = (k) => r.headers[String(k).toLowerCase()];
  r.on = (e, f) => { if (e === 'finish') r.fin.push(f); return r; }; r.writeHead = (c) => { r.statusCode = c; return r; }; return r; };

describe.skipIf(!hasDatabase)('R46 security signals and provider status (real DB)', () => {
  let server; const received = []; let db; let api; let auth; let health; const saved = {};
  const ENV = ['ALERT_WEBHOOK_URL', 'ALERT_FAILED_LOGIN_BURST', 'ALERT_MFA_FAILURE_BURST', 'ALERT_EXPORT_BURST', 'ALERT_EXPORT_PER_ACTOR', 'MAILER_API_KEY', 'MAILER_PROVIDER',
    'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_KV_KV_REST_API_URL', 'UPSTASH_KV_KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_URL'];
  const call = async (method, url, { bearer } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: null, cookies: {}, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } };
    const r = res(); await api(req, r); return r;
  };
  const admin = () => auth.signAdminSessionToken({ email: `r46-sec-${TS}@example.test`, role: 'admin', mfa_verified: true });

  beforeAll(async () => {
    server = http.createServer((req, r) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { received.push(JSON.parse(b || '{}')); r.writeHead(200).end('ok'); }); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    for (const k of ENV) saved[k] = process.env[k];
    for (const k of ENV.filter((x) => /KV|UPSTASH/.test(x))) delete process.env[k];
    Object.assign(process.env, { ALERT_WEBHOOK_URL: `http://127.0.0.1:${server.address().port}/hook`, ALERT_FAILED_LOGIN_BURST: '3', ALERT_MFA_FAILURE_BURST: '2', ALERT_EXPORT_BURST: '50',
      ALERT_EXPORT_PER_ACTOR: '3', MAILER_PROVIDER: 'mailjet', MAILER_API_KEY: `${SECRET}:${SECRET}` });
    vi.resetModules();
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js');
    ({ default: health } = await import('../../api/_handlers/cron/health-alert.js'));
    // R46 integ: the signals count EVERY row of their actions in the window; earlier files of the shared integration database (refused sign-ins,
    // exports) leave such rows minutes before this file runs. Start from a clean window so the counts below are this file's own.
    const { SECURITY_SIGNAL_ACTIONS } = await import('../../api/_services/security-signals.js');
    const actions = [...new Set(Object.values(SECURITY_SIGNAL_ACTIONS).flat())];
    await db.execute(sql`DELETE FROM "AuditLog" WHERE action IN ${sql.raw(`(${actions.map((a) => `'${String(a).replace(/'/g, "''")}'`).join(', ')})`)} AND "timestamp" > NOW() - interval '3 hours'`);
  }, 60000);
  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    if (db) await db.execute(sql`DELETE FROM "AuditLog" WHERE "timestamp" > ${new Date(TS - 60_000).toISOString()}`).catch(() => {});
    await new Promise((r) => server.close(r));
  });

  it('refused citizen and institution sign-ins leave address-free audit rows', async () => {
    const { default: login } = await import('../../api/_handlers/auth/login.js');
    const { institutionLogin } = await import('../../api/_services/institutions.js');
    for (let i = 0; i < 3; i++) {
      const r = res(); await login({ method: 'POST', url: '/api/auth/login', query: {}, body: { email: `nobody-${TS}-${i}@example.test`, password: 'Wrong-password-1' }, headers: { host: 'localhost:3000', 'content-type': 'application/json' } }, r);
      expect(r.statusCode).toBe(401);
    }
    const inst = await institutionLogin({ email: `no-institution-${TS}@example.test`, password: 'x' });
    expect(inst.ok).toBe(false);
    const rows = (await db.execute(sql`SELECT action, actor, actor_id, ip_hash, details FROM "AuditLog" WHERE action IN ('CITIZEN_LOGIN_FAILED', 'INSTITUTION_LOGIN_FAILED') AND "timestamp" > ${new Date(TS - 60_000).toISOString()}`)).rows;
    expect(rows.filter((x) => x.action === 'CITIZEN_LOGIN_FAILED')).toHaveLength(3);
    expect(rows.filter((x) => x.action === 'INSTITUTION_LOGIN_FAILED')).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('@example.test');
    expect(rows.find((x) => x.action === 'CITIZEN_LOGIN_FAILED')).toMatchObject({ actor: null, actor_id: null, details: { reason: 'unknown' } });
    expect(rows.find((x) => x.action === 'CITIZEN_LOGIN_FAILED').ip_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('the health check raises one alert per security signal through the alert channel, counts only; the cooldown holds the second run', async () => {
    const now = new Date();
    await db.execute(sql`INSERT INTO "AuditLog" (id, action, actor, actor_id, entity, "timestamp", ip_hash) VALUES
      (${`r46a-${TS}-1`}, 'ADMIN_MFA_FAILED', 'a@example.test', 'a@example.test', 'AdminSession', ${now.toISOString()}, 'aaaa000000000001'),
      (${`r46a-${TS}-2`}, 'MFA_VERIFY_FAILED', 'pro-1', 'pro-1', 'ProUser', ${now.toISOString()}, 'aaaa000000000002'),
      (${`r46a-${TS}-3`}, 'AUDIT_EXPORTED', 'b@example.test', 'b@example.test', 'AuditLog', ${now.toISOString()}, NULL),
      (${`r46a-${TS}-4`}, 'ADMIN_PERSONAL_DATA_EXPORT', 'b@example.test', 'b@example.test', 'AdminExport', ${now.toISOString()}, NULL),
      (${`r46a-${TS}-5`}, 'DOSSIER_EXPORTED', 'b@example.test', 'b@example.test', 'ProUser', ${now.toISOString()}, NULL),
      (${`r46a-${TS}-6`}, 'AUDIT_EXPORTED', 'c@example.test', 'c@example.test', 'AuditLog', ${new Date(now.getTime() - 2 * 3600_000).toISOString()}, NULL)`);
    const auth2 = { authorization: `Bearer ${process.env.CRON_SECRET}` };
    const r1 = res(); await health({ method: 'GET', headers: auth2 }, r1);
    expect(r1.body.checks.security).toMatchObject({ ok: false, failedLogins: 4, mfaFailures: 2, exports: 3, exportsMaxPerActor: 3 });
    expect(r1.body.checks.security.raised.sort()).toEqual(['security.export_burst', 'security.failed_login_burst', 'security.mfa_failure_burst']);
    const names = received.map((x) => x.name).filter((n) => n.startsWith('security.'));
    expect(names.sort()).toEqual(['security.export_burst', 'security.failed_login_burst', 'security.mfa_failure_burst']);
    const burst = received.find((x) => x.name === 'security.failed_login_burst');
    expect(burst.text).toMatch(/Sécurité : 4 connexions refusées en 15 minutes \(seuil 3\)/);
    expect(burst.details).toMatchObject({ count: 4, byAction: { CITIZEN_LOGIN_FAILED: 3, INSTITUTION_LOGIN_FAILED: 1 } });
    expect(JSON.stringify(received)).not.toContain('@example.test');
    expect(JSON.stringify(received)).not.toContain(process.env.CRON_SECRET);
    const r2 = res(); await health({ method: 'GET', headers: auth2 }, r2);
    expect(r2.body.checks.security.ok).toBe(false);
    expect(received.filter((x) => String(x.name).startsWith('security.')), 'cooldown: not sent again').toHaveLength(3);
  });

  it('GET /api/admin/security-signals: refused without a named administrator session, aggregates for one', async () => {
    expect((await call('GET', '/api/admin/security-signals')).statusCode).toBe(401);
    const r = await call('GET', '/api/admin/security-signals', { bearer: admin() });
    expect(r.statusCode).toBe(200);
    expect(r.body.counts).toMatchObject({ failedLogins: { count: 4 }, mfaFailures: { count: 2 }, exports: { count: 3, maxPerActor: 3 } });
    expect(r.body.alertsNow.map((a) => a.name).sort()).toEqual(['security.export_burst', 'security.failed_login_burst', 'security.mfa_failure_burst']);
    expect(r.body.alertsSent.map((a) => a.name).sort()).toEqual(['security.export_burst', 'security.failed_login_burst', 'security.mfa_failure_burst']);
    expect(JSON.stringify(r.body)).not.toContain('@example.test');
  });

  it('GET /api/admin/provider-status: every adapter with an honest state, variable names only — never a value', async () => {
    expect((await call('GET', '/api/admin/provider-status')).statusCode).toBe(401);
    const r = await call('GET', '/api/admin/provider-status', { bearer: admin() });
    expect(r.statusCode).toBe(200);
    expect(r.body.basis).toBe('ENV_PRESENCE_ONLY');
    const ids = r.body.providers.map((p) => p.id);
    for (const id of ['mail', 'graph-mail', 'sms', 'push', 'outlook', 'video', 'openfisca', 'aides-territoires', 'franceconnect', 'proconnect', 'maps', 'sentry', 'upstash', 'hosting', 'database']) expect(ids).toContain(id);
    const by = Object.fromEntries(r.body.providers.map((p) => [p.id, p]));
    expect(by.upstash.state).toBe('SIMULATED');
    expect(by.database.state).toBe('CONNECTED');
    expect(by.franceconnect).toMatchObject({ adapter: 'PRESENT', state: 'NOT_CONFIGURED' });   // R46 integ: the N08 adapter exists, not configured here
    expect(by.mail.variables.find((v) => v.name === 'MAILER_API_KEY')).toEqual({ name: 'MAILER_API_KEY', set: true });
    expect(JSON.stringify(r.body)).not.toContain(SECRET);
    expect(JSON.stringify(r.body)).not.toMatch(/postgres(ql)?:\/\//);
  });
});
