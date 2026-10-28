/**
 * PKG-5 / WS2 closure queue on REAL PostgreSQL through the REAL API entry.
 *   - GET /api/admin/ws2-queue: administrator sessions only (no session / pro token = 401); the shipped queue lists the 49 launch records
 *   - a record becomes HUMAN_VERIFIED only through a VERIFY decision recorded with an MFA admin session (content-verification ledger); a later REJECT wins;
 *     a self-declared CSV flag (csv_verifiedCurrent_flag = 'true') never counts; a slug absent from the database is NOT_IN_DATABASE
 * Synthetic Aide rows (prefix ws2q-) and a synthetic queue file in a temp directory: no shipped data file and no real launch record is touched.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const hasDatabase = !!process.env.DATABASE_URL;
const P = `ws2q-${Date.now()}-`;
function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('PKG-5 WS2 human-verification queue (real DB, real entry)', () => {
  let db, schema, api, auth, ws2, root;
  const call = async (method, url, { bearer, body } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } };
    const res = mkRes(); await api(req, res); return res;
  };
  const admin = (mfa) => auth.signAdminSessionToken({ email: 'ws2-reviewer@example.test', role: 'admin', mfa_verified: mfa });

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); schema = await import('../../src/db/schema.ts');
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js'); ws2 = await import('../../api/_services/ws2-review.js');
    for (const k of ['a', 'b', 'c']) await db.insert(schema.Aide).values({ id: P + k, slug: P + k, titre: 'WS2 ' + k, statut: 'publie' });
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws2q-'));
    fs.mkdirSync(path.join(root, 'data/strasbourg'), { recursive: true });
    const rec = (slug, extra = {}) => ({ dataset: 'aides', slug, title: slug, research_status: 'SOURCE_LOCATED', official_source: 'service-public.fr/x', findings: '-', privacy: '-', human_validation: 'check', ...extra });
    fs.writeFileSync(path.join(root, 'data/strasbourg/ws2-review-queue.v2.json'), JSON.stringify({ schema: 'ada.ws2.review-queue.v2', derivedFrom: { file: 'synthetic' }, statement: 'synthetic',
      records: [rec(P + 'a'), rec(P + 'b', { csv_verifiedCurrent_flag: 'true' }), rec(P + 'c'), rec(P + 'missing')] }));
  }, 60000);
  afterAll(async () => {
    if (db) await db.execute(sql`DELETE FROM "Aide" WHERE id LIKE ${P + '%'}`); // ledger rows are append-only by trigger and stay
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it('the endpoint is for administrator sessions only and lists the 49 shipped launch records', async () => {
    expect((await call('GET', '/api/admin/ws2-queue')).statusCode).toBe(401);
    const pro = auth.signProToken({ id: P + 'pro', email: 'p@example.test', structureId: P + 's', role: 'SUPERADMIN' });
    expect((await call('GET', '/api/admin/ws2-queue', { bearer: pro })).statusCode).toBe(401);
    const ok = await call('GET', '/api/admin/ws2-queue', { bearer: admin(false) });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.totals.records).toBe(49);
    expect(ok.body.records.every((r) => ['HUMAN_VERIFIED', 'PENDING_HUMAN_VERIFICATION', 'REJECTED', 'ON_HOLD', 'NOT_IN_DATABASE'].includes(r.state))).toBe(true);
    expect(ok.body.statement).toMatch(/research aid/i);
  });

  it('only a ledger VERIFY by an MFA admin makes a record HUMAN_VERIFIED; CSV flags never count; a later REJECT wins', async () => {
    const before = await ws2.ws2Queue({ root });
    const st = (q, slug) => q.records.find((r) => r.slug === slug).state;
    expect(st(before, P + 'a')).toBe('PENDING_HUMAN_VERIFICATION');
    expect(st(before, P + 'b')).toBe('PENDING_HUMAN_VERIFICATION'); // self-declared CSV flag
    expect(st(before, P + 'missing')).toBe('NOT_IN_DATABASE');
    // owner LAB audit: a VERIFY carries the version of the content read — here the version shown in the WS2 queue
    const versionOf = (id) => before.records.find((r) => r.entityId === id)?.version;
    const decide = (bearer, id, action, extra = {}) => call('POST', '/api/admin/content-verification', { bearer, body: { entityType: 'aide', entityId: id, action, ...(action === 'VERIFY' ? { expectedVersion: versionOf(id) } : {}), sourceUrl: 'https://www.service-public.fr/particuliers/vosdroits/F1', evidenceNote: 'Synthetic fixture: official page compared with every published claim.',territoryConfirmed: true, ...extra } });
    expect((await decide(admin(false), P + 'a', 'VERIFY')).statusCode).toBe(403); // no MFA
    expect((await decide(admin(true), P + 'a', 'VERIFY')).statusCode).toBe(200);
    expect((await decide(admin(true), P + 'c', 'VERIFY')).statusCode).toBe(200);
    expect((await decide(admin(true), P + 'c', 'REJECT')).statusCode).toBe(200);
    const after = await ws2.ws2Queue({ root });
    expect(st(after, P + 'a')).toBe('HUMAN_VERIFIED');
    expect(st(after, P + 'b')).toBe('PENDING_HUMAN_VERIFICATION');
    expect(st(after, P + 'c')).toBe('REJECTED');
    expect(after.totals).toMatchObject({ records: 4, humanVerified: 1, rejected: 1, pending: 1, notInDatabase: 1 });
  });
});
