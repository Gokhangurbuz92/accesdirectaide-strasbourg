/**
 * P19 (RECON public A-6) on REAL PostgreSQL, through the real API entry, on BOTH database levels:
 *   - with drizzle/0051 ("ContentType" has DISPOSITIF): a dispositif report from /api/feedback or /api/reports is filed as DISPOSITIF;
 *   - without it (Production until 0051 is authorised): exactly as before — AIDE + « dispositif:<id> » — and nothing names the missing value.
 * On both levels the administrator's « Dispositif » filter finds the reports of both forms (rows filed before 0051 stay as they are), the « Aide » filter
 * no longer shows dispositif reports, every row carries kind / target, and the triage (PUT) works. On the 0051 level the rollback file is proven to refuse
 * while a DISPOSITIF row exists (inside a transaction that is rolled back), and the migration is proven idempotent.
 * Raw-SQL fixtures, synthetic data only. Skipped without DATABASE_URL.
 * Run on each level: DATABASE_URL=…/ada_p19_test (P19_EXPECT_DISPOSITIF=1) and DATABASE_URL=…/ada_p19_0049_test (P19_EXPECT_DISPOSITIF=0).
 */
import { vi } from 'vitest';
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const ADMIN = `p19-adm-${TS}@example.test`;
const CSRF = 'p19csrf' + TS;
const mkRes = () => {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
};

describe.skipIf(!hasDatabase)('P19: dispositif content reports (real DB, with and without 0051)', () => {
  let db, api, auth, features; let level = false; const ids = [];
  const call = async (method, url, { admin = false, body } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http',
      ...(admin ? { authorization: `Bearer ${auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: true })}` } : { cookie: `__csrf=${CSRF}`, 'x-csrf-token': CSRF }) } };
    const res = mkRes(); await api(req, res); return res;
  };
  const row = async (id) => (await db.execute(sql`SELECT "contentType"::text AS "contentType", "contentId" FROM "ContentReport" WHERE id = ${id}`)).rows[0];
  const list = async (contentType) => (await call('GET', `/api/reports?status=NEW&limit=100${contentType ? `&contentType=${contentType}` : ''}`, { admin: true }));
  const mine = (r) => r.body.reports.filter((x) => String(x.contentId).includes(`-${TS}`));

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js');
    features = await import('../../api/_utils/schema-features.js');
    level = (await features.contentTypeSchema(db)).dispositif;
    if (process.env.P19_EXPECT_DISPOSITIF === '1' || process.env.P19_EXPECT_DISPOSITIF === '0') expect(level).toBe(process.env.P19_EXPECT_DISPOSITIF === '1');
    const userAuth = await import('../../api/_utils/user-auth.js');
    await db.execute(sql`INSERT INTO "AdminUser" (id, email, password, role, "createdAt", "updatedAt", "failedLoginAttempts", "mfaEnabled")
      VALUES (${'p19-' + crypto.randomUUID()}, ${ADMIN}, ${await userAuth.hashPassword('p19-Synthetic-Pass-1')}, 'admin', NOW(), NOW(), 0, true)`);
    // filed before 0051 (or on a database without it): a dispositif under AIDE, and a plain aide report
    for (const [id, type, target] of [[`p19-legacy-${TS}`, 'AIDE', `dispositif:dp-legacy-${TS}`], [`p19-aide-${TS}`, 'AIDE', `aide-${TS}`]]) {
      await db.execute(sql`INSERT INTO "ContentReport" (id, "contentType", "contentId", reason, status, "createdAt", "updatedAt") VALUES (${id}, ${type}::"ContentType", ${target}, 'AUTRE', 'NEW', NOW(), NOW())`);
      ids.push(id);
    }
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ContentReport" WHERE "contentId" LIKE ${`%-${TS}`}`);
    await db.execute(sql`DELETE FROM "AuditLog" WHERE actor_id = ${ADMIN} OR actor = ${ADMIN}`);
    await db.execute(sql`DELETE FROM "AdminUser" WHERE email = ${ADMIN}`);
  });

  it('/api/feedback files a dispositif report in the form this database supports', async () => {
    const r = await call('POST', '/api/feedback', { body: { type: 'dispositif', id: `dp-fb-${TS}`, message: 'Le lien officiel a changé.', pageUrl: 'https://example.test/dispositifs/x' } });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201);
    ids.push(r.body.feedbackId);
    expect(await row(r.body.feedbackId)).toEqual(level ? { contentType: 'DISPOSITIF', contentId: `dp-fb-${TS}` } : { contentType: 'AIDE', contentId: `dispositif:dp-fb-${TS}` });
    const s = await call('POST', '/api/feedback', { body: { type: 'dispositif', slug: `carte-${TS}`, message: 'Le lien officiel a changé.' } });
    expect(await row(s.body.feedbackId)).toEqual(level ? { contentType: 'DISPOSITIF', contentId: `slug:carte-${TS}` } : { contentType: 'AIDE', contentId: `dispositif:slug:carte-${TS}` });
  });

  it('/api/reports accepts DISPOSITIF on both levels; the other kinds are unchanged', async () => {
    const r = await call('POST', '/api/reports', { body: { contentType: 'DISPOSITIF', contentId: `dp-rep-${TS}`, reason: 'LIEN_MORT' } });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201);
    expect(await row(r.body.reportId)).toEqual(level ? { contentType: 'DISPOSITIF', contentId: `dp-rep-${TS}` } : { contentType: 'AIDE', contentId: `dispositif:dp-rep-${TS}` });
    const s = await call('POST', '/api/reports', { body: { contentType: 'STRUCTURE', contentId: `st-${TS}`, reason: 'HORAIRES_FAUX' } });
    expect(await row(s.body.reportId)).toEqual({ contentType: 'STRUCTURE', contentId: `st-${TS}` });
    expect((await call('POST', '/api/reports', { body: { contentType: 'NOPE', contentId: 'x', reason: 'AUTRE' } })).statusCode).toBe(400);
  });

  it('the administrator\'s « Dispositif » filter finds both forms, « Aide » no longer shows dispositif reports, every row says its kind', async () => {
    const d = await list('DISPOSITIF');
    expect(d.statusCode, JSON.stringify(d.body)).toBe(200);
    const got = mine(d);
    expect(got.map((x) => x.target).sort()).toEqual([`dp-fb-${TS}`, `dp-legacy-${TS}`, `dp-rep-${TS}`, `slug:carte-${TS}`].sort());
    expect(got.every((x) => x.kind === 'DISPOSITIF')).toBe(true);
    expect(got.find((x) => x.target === `dp-legacy-${TS}`)).toMatchObject({ contentType: 'AIDE', contentId: `dispositif:dp-legacy-${TS}`, legacyDispositif: true });
    expect(got.filter((x) => x.legacyDispositif).length).toBe(level ? 1 : 4);
    const a = mine(await list('AIDE'));
    expect(a.map((x) => x.contentId)).toEqual([`aide-${TS}`]);
    const all = mine(await list(''));
    expect(all.length).toBe(6);
    expect(all.find((x) => x.contentId === `st-${TS}`)).toMatchObject({ kind: 'STRUCTURE', target: `st-${TS}`, legacyDispositif: false });
  });

  it('the triage of a dispositif report works and is journalised with the stored form', async () => {
    const d = mine(await list('DISPOSITIF')).find((x) => x.target === `dp-fb-${TS}`);
    const r = await call('PUT', `/api/reports?id=${encodeURIComponent(d.id)}`, { admin: true, body: { status: 'IN_PROGRESS', note: 'Synthetic P19 triage' } });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    const audit = (await db.execute(sql`SELECT details FROM "AuditLog" WHERE entity = 'ContentReport' AND entity_id = ${d.id} AND action = 'CONTENT_REPORT_IN_PROGRESS'`)).rows;
    expect(audit[0].details).toMatchObject({ contentType: level ? 'DISPOSITIF' : 'AIDE', to: 'IN_PROGRESS' });
  });

  it('0051 level only: the migration is idempotent and its rollback refuses while a DISPOSITIF row exists (changing nothing)', async () => {
    if (!level) return;
    const pg = (await import('pg')).default;
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
    try {
      await client.query(fs.readFileSync('drizzle/0051_p19_dispositif_content_type.sql', 'utf8'));   // IF NOT EXISTS: a no-op
      await client.query('BEGIN');
      await expect(client.query(fs.readFileSync('drizzle/rollback/0051_down.sql', 'utf8'))).rejects.toThrow(/0051_down refused: \d+ ContentReport row\(s\) are DISPOSITIF/);
      await client.query('ROLLBACK');
      const labels = (await client.query(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'ContentType' ORDER BY e.enumsortorder`)).rows.map((x) => x.enumlabel);
      expect(labels).toEqual(['AIDE', 'DEMARCHE', 'STRUCTURE', 'ACTUALITE', 'DISPOSITIF']);
      expect((await client.query(`SELECT count(*)::int n FROM drizzle.__drizzle_migrations WHERE created_at = 1794930000000`)).rows[0].n).toBe(1);
    } finally { await client.end(); }
  });
});
