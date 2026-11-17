/**
 * Legal v6 / owner decision C6 (17/11/2026) — the Mailjet contact of an erased account, on REAL PostgreSQL through the real API entry (synthetic data only;
 * the Mailjet HTTP layer is a fake inside the test: nothing leaves the machine, no real key or address).
 *   - success: the contact is deleted BEFORE the account leaves the database; the request is COMPLETED;
 *   - transient failure then success: nothing is erased, the request is parked (BLOCKED / MAIL_CONTACT_RETRY, shown to the person as still in progress),
 *     « Relancer » once Mailjet answers erases the account;
 *   - permanent failure: after the bounded window the account is erased anyway and the failure is recorded « intervention humaine requise », listed on the
 *     admin privacy screen and in « À traiter » until a person records what was done (a note holding an address is refused);
 *   - purge step 6c: the 8-day promise does not wait — accounts deleted, failure recorded;
 *   - no address and no Mailjet contact id in any log line, audit row, request row or KV write.
 * Run: bash $S/runint-l6.sh tests/integration/v6-mail-contact-erasure-db.test.js
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { approvedTestPolicy, approvalEnv } from '../helpers/gdpr-purge-approval.js';

const mj = vi.hoisted(() => ({ mode: 'ok', calls: /** @type {any[]} */ ([]), logs: /** @type {any[]} */ ([]), kvWrites: /** @type {string[]} */ ([]),
  /** @type {null | (() => Promise<boolean>)} */ accountStillThere: null, presentAtDelete: /** @type {boolean[]} */ ([]) }));
const CONTACT_ID = 987654321;

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0,
  lpush: async (k) => { mj.kvWrites.push(String(k)); return 1; }, ltrim: async () => 'OK', lrange: async () => [] } }));
vi.mock('../../api/_utils/logger.js', () => {
  const push = (...a) => { mj.logs.push(a); };
  const l = { info: push, warn: push, error: push, debug: push, fatal: push, trace: push, child: () => l };
  return { default: l, logger: l };
});
vi.mock('../../api/_services/mail-contact-erasure.js', async (importOriginal) => {
  const m = /** @type {any} */ (await importOriginal());
  const fetchImpl = async (url, init) => {
    const u = new URL(String(url));
    if (u.hostname !== 'api.mailjet.com') throw new Error(`unexpected host ${u.hostname}`);
    mj.calls.push({ method: init.method, path: u.pathname });
    if (mj.mode === 'down') return new Response('{}', { status: 503 });
    if (init.method === 'GET') return new Response(JSON.stringify({ Count: 1, Data: [{ ID: CONTACT_ID }], Total: 1 }), { status: 200 });
    if (mj.accountStillThere) mj.presentAtDelete.push(await mj.accountStillThere());
    return new Response('{}', { status: 200 });
  };
  const push = (...a) => { mj.logs.push(a); };
  const eraser = m.createMailContactEraser({ fetchImpl, sleep: async () => {}, config: () => ({ provider: 'mailjet', apiKey: 'pub_test:sec_test' }),
    logger: { info: push, warn: push, error: push }, kv: { lrange: async () => [], lpush: async (k) => { mj.kvWrites.push(String(k)); return 1; }, ltrim: async () => 'OK', del: async () => 0 } });
  return { ...m, mailContactEraser: eraser };
});

const TS = Date.now(); const CSRF = 'v6csrf' + TS;
const CIT = ['ok', 'transient', 'permanent'].map((n) => ({ id: `v6mc-${n}-${TS}`, email: `v6mc-${n}-${TS}@example.test` }));
const UNVERIFIED = { id: `v6mc-unverified-${TS}`, email: `v6mc-unverified-${TS}@example.test` };
const A = `v6mc-a-${TS}@example.test`; const B = `v6mc-b-${TS}@example.test`;
function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe('legal v6 / C6 — Mailjet contact deletion around an account erasure (real DB)', () => {
  let db, api, auth, userAuth, review, purge, tasks;
  const call = async (method, url, { body, cit, bearer } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(cit ? { cookie: `${userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: cit.id, email: cit.email })).split(';')[0]}; __csrf=${CSRF}`, 'x-csrf-token': CSRF } : {}) } };
    const res = mkRes(); await api(req, res); return res;
  };
  const mfa = (email) => auth.signAdminSessionToken({ email, role: 'admin', mfa_verified: true });
  const erasure = (bearer, body) => call('POST', '/api/admin/dsr-erasure', { bearer, body });
  const openOf = async (id) => (await call('GET', '/api/admin/dsr-erasure', { bearer: mfa(A) })).body.requests.find((r) => r.id === id);
  const exists = async (id) => (await db.execute(sql`SELECT count(*)::int AS n FROM "CitizenUser" WHERE id = ${id}`)).rows[0].n === 1;
  /** request → proposed by A → read and confirmed by B; returns the confirm answer */
  const approve = async (cit) => {
    const id = (await call('DELETE', '/api/auth/delete-account', { cit })).body.requestId;
    expect((await erasure(mfa(A), { id, decision: 'APPROVE' })).statusCode).toBe(200);
    const open = await openOf(id);
    await call('GET', `/api/admin/dsr-erasure?id=${id}`, { bearer: mfa(B) });
    return { id, res: await erasure(mfa(B), { id, action: 'confirm', note: 'Identité vérifiée', proposedAt: open.proposedAt }) };
  };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js');
    review = await import('../../api/_services/dsr-erasure-review.js'); purge = await import('../../api/_handlers/cron/gdpr-purge.js');
    tasks = await import('../../api/_services/admin-tasks.js');
    for (const c of CIT) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "createdAt", "updatedAt") VALUES (${UNVERIFIED.id}, ${UNVERIFIED.email}, 'x', NOW() - INTERVAL '9 days', NOW() - INTERVAL '9 days')`);
  }, 90000);

  afterAll(async () => {
    if (!db) return;
    for (const c of [...CIT, UNVERIFIED]) {
      await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" = ${c.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${c.id}`).catch(() => {});
    }
  });

  it('success: the contact is deleted while the account is still in the database, then the account is erased', async () => {
    mj.mode = 'ok'; mj.presentAtDelete.length = 0; mj.accountStillThere = () => exists(CIT[0].id);
    const { id, res } = await approve(CIT[0]);
    expect([res.statusCode, res.body.request.status, res.body.mailContact]).toEqual([200, 'COMPLETED', 'deleted']);
    expect(mj.presentAtDelete, 'Mailjet DELETE happened BEFORE the database erasure').toEqual([true]);
    expect(await exists(CIT[0].id)).toBe(false);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "AuditLog" WHERE action = 'MAIL_CONTACT_ERASURE_FAILED' AND entity_id = ${id}`)).rows[0].n).toBe(0);
    mj.accountStillThere = null;
  });

  it('transient failure then success: nothing erased while Mailjet fails, the request is parked and shown as in progress; « Relancer » completes it', async () => {
    mj.mode = 'down';
    const { id, res } = await approve(CIT[1]);
    expect([res.statusCode, res.body.request.status, res.body.blockedBy, res.body.attempts]).toEqual([200, 'BLOCKED', 'MAIL_CONTACT_RETRY', 1]);
    expect(await exists(CIT[1].id), 'the address stays in its existing place, nowhere else').toBe(true);
    const open = await openOf(id);
    expect(open.stage).toBe('MAIL_CONTACT_RETRY');
    expect(open.mailContactRetry.attempts).toBe(1);
    expect(new Date(open.mailContactRetry.retryUntil).getTime()).toBeGreaterThan(Date.now() + 2 * 86400000);
    // the person is not told about a legal hold that does not exist
    expect((await call('GET', '/api/auth/delete-account', { cit: CIT[1] })).body.request.status).toBe('APPROVED');
    // still down: a second attempt keeps it parked and counts
    expect((await erasure(mfa(A), { id, action: 'retry' })).body.attempts).toBe(2);
    mj.mode = 'ok';
    const done = await erasure(mfa(A), { id, action: 'retry' });
    expect([done.body.request.status, done.body.mailContact]).toEqual(['COMPLETED', 'deleted']);
    expect(await exists(CIT[1].id)).toBe(false);
    const actions = (await db.execute(sql`SELECT action FROM "AuditLog" WHERE entity_id = ${id} ORDER BY "timestamp", id`)).rows.map((r) => r.action);
    expect(actions.filter((a) => a === 'MAIL_CONTACT_ERASURE_RETRY')).toHaveLength(2);
    expect(actions).not.toContain('MAIL_CONTACT_ERASURE_FAILED');
  });

  it('permanent failure: once the window is closed the account is erased anyway and the failure is flagged for a person until it is resolved', async () => {
    mj.mode = 'down';
    const { id, res } = await approve(CIT[2]);
    expect(res.body.blockedBy).toBe('MAIL_CONTACT_RETRY');
    // the bounded window (3 days after the first failure) has passed
    await db.execute(sql`UPDATE "DSRRequest" SET "reviewOutcome" = jsonb_set("reviewOutcome", '{mailContactRetry,firstFailedAt}', to_jsonb((NOW() - INTERVAL '4 days')::text)) WHERE id = ${id}`);
    const run = await review.retryMailContactErasures(db);
    expect(run).toMatchObject({ erased: 1, humanIntervention: 1, failed: 0 });
    expect(await exists(CIT[2].id)).toBe(false);
    expect((await db.execute(sql`SELECT status FROM "DSRRequest" WHERE id = ${id}`)).rows[0].status).toBe('COMPLETED');
    const [f] = (await db.execute(sql`SELECT id, details FROM "AuditLog" WHERE action = 'MAIL_CONTACT_ERASURE_FAILED' AND entity_id = ${id}`)).rows;
    expect(f.details).toMatchObject({ reason: 'account_erasure', step: 'lookup', status: 503, humanInterventionRequired: true, label: 'intervention humaine requise', requestId: id, attempts: 2 });
    // visible on the admin privacy screen and in « À traiter »
    const console1 = await call('GET', '/api/admin/privacy', { bearer: mfa(A) });
    expect(console1.body.mailContactFailures.failures.map((x) => x.id)).toContain(f.id);
    expect((await tasks.adminTasks({ db })).mailContactFailures).toBeGreaterThanOrEqual(1);
    expect(await openOf(id)).toBeUndefined();
    // resolution: MFA, a note, never an address
    expect((await erasure(mfa(A), { id: f.id, action: 'mail_contact_resolved', note: `supprimé ${CIT[2].email}` })).body.error).toBe('address_in_note');
    expect((await erasure(mfa(A), { id: f.id, action: 'mail_contact_resolved', note: 'Contacts orphelins supprimés dans Mailjet (17/11)' })).statusCode).toBe(200);
    expect((await call('GET', '/api/admin/privacy', { bearer: mfa(A) })).body.mailContactFailures.failures.map((x) => x.id)).not.toContain(f.id);
  });

  it('purge step 6c: never-confirmed accounts are deleted on time whatever Mailjet answers; the failure is recorded and named', async () => {
    mj.mode = 'down';
    const STEPS = ['unverifiedAccountsDeleted'];
    const r = await purge.runGdprPurge({ policy: approvedTestPolicy({ steps: STEPS }), env: approvalEnv(STEPS) });
    expect(r.body.unverified_accounts_deleted).toBeGreaterThanOrEqual(1);
    expect(r.body.failed_steps).toContain('mailContactErasure');
    expect(await exists(UNVERIFIED.id)).toBe(false);
    const rows = (await db.execute(sql`SELECT details FROM "AuditLog" WHERE action = 'MAIL_CONTACT_ERASURE_FAILED' AND details->>'reason' = 'unverified_account_purge'`)).rows;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].details).toMatchObject({ humanInterventionRequired: true, step: 'lookup', requestId: null });
  });

  it('no address and no Mailjet contact id anywhere: logs, audit rows, request rows, KV writes', async () => {
    const needles = [...CIT, UNVERIFIED].map((c) => c.email).concat(String(CONTACT_ID));
    const audit = JSON.stringify((await db.execute(sql`SELECT action, actor_id, entity_id, details FROM "AuditLog" WHERE action LIKE 'MAIL_CONTACT%' OR action LIKE 'DSR_%' OR action = 'GDPR_PURGE_RUN'`)).rows);
    const requests = JSON.stringify((await db.execute(sql`SELECT * FROM "DSRRequest" WHERE "subjectId" LIKE ${`v6mc-%-${TS}`}`)).rows);
    const logs = JSON.stringify(mj.logs);
    for (const n of needles) {
      expect(audit, n).not.toContain(n);
      expect(requests, n).not.toContain(n);
      expect(logs, n).not.toContain(n);
    }
    expect(mj.kvWrites.filter((k) => k.includes('mail-contact')), 'nothing is queued in the KV store any more').toEqual([]);
    expect(logs).toContain('mail_contact.erasure_failed');
  });
});
