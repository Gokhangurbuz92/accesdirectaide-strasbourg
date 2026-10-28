/**
 * PKG-6 / D22 on the REAL API entry (api/index.js) and REAL PostgreSQL: every write on the review queue and on the AI repair agents needs a NAMED administrator
 * session with MFA. Refused: anonymous, professional token, the retired shared ADMIN_TOKEN (in the test profile AND in a production-like profile), an
 * administrator session without MFA, a non-administrator role in an administrator-shaped token. Accepted: a named MFA administrator, audited under that name.
 * Synthetic accounts only; no model is called (the repair agents are refused before any model call, or disabled by their flag).
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));
const gen = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../api/lib/gemini.js', () => ({ generateText: vi.fn(async () => { gen.calls += 1; return '{"url": "https://example.invalid/x"}'; }) }));
vi.mock('../../api/lib/gemini-metrics.js', () => ({ recordMetric: vi.fn() }));

const hasDatabase = !!process.env.DATABASE_URL;
const TAG = `d22a-${Date.now().toString(36)}`;
const NAMED = `${TAG}@example.test`;
function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('PKG-6 / D22 review and AI-repair writes need a named MFA administrator (real API entry)', () => {
  let db, schema, api, auth;
  const call = async (method, url, bearer, body) => {
    const u = new URL(url, 'http://localhost:3000');
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', cookie: '__csrf=qa-d22', 'x-csrf-token': 'qa-d22', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } };   // a valid double-submit pair: the AUTH layer is what is tested
    const res = mkRes(); await api(req, res); return res;
  };
  const writes = () => [
    ['PATCH', `/api/admin/review-queue/${TAG}-1`, { status: 'dismissed', reason: 'Décision de test synthétique.' }],
    ['PATCH', '/api/admin/review-queue/bulk', { ids: [`${TAG}-2`], status: 'dismissed', reason: 'Décision de test synthétique.' }],
    ['POST', '/api/admin/review-queue/scan', { limitPerType: 1 }],
    ['POST', '/api/admin/hive-repair', { itemId: `${TAG}-3` }],
    ['POST', '/api/admin/bulk-repair', { severity: 'P9', limit: 1 }],
    ['POST', '/api/admin/ai-oversight', { action: 'decide', id: `${TAG}-3`, decision: 'dismiss', note: 'Décision de test synthétique.', suggestedAt: null }],
  ];
  const status = async (id) => (await db.execute(sql`SELECT status FROM "ReviewQueueItem" WHERE id = ${id}`)).rows[0]?.status;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); schema = await import('../../src/db/schema.ts');
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js');
    await db.insert(schema.ReviewQueueItem).values([1, 2, 3].map((n) => ({ id: `${TAG}-${n}`, entityType: 'AIDE', entityId: `${TAG}-e${n}`, title: `Fiche fictive ${n}`, reason: n === 3 ? 'MISSING_SOURCE_DOCUMENT' : `QA_${TAG}_${n}`, severity: 'P9', status: 'OPEN' })));
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE actor = ${NAMED} OR entity_id LIKE ${TAG + '%'}`);
    await db.execute(sql`DELETE FROM "ReviewQueueItem" WHERE id LIKE ${TAG + '%'} OR "entityId" LIKE ${TAG + '%'}`);
  });

  it('refused before anything changes: anonymous, professional, retired shared token, administrator without MFA, non-administrator role', async () => {
    vi.stubEnv('ENABLE_AI_AGENT', 'true');
    try {
      const pro = auth.signProToken ? auth.signProToken({ id: `${TAG}-pro`, email: `${TAG}-pro@example.test`, role: 'pro', structureId: 'x' }) : null;
      const cases = [
        ['anonymous', null, [401]],
        ['legacy ADMIN_TOKEN (test profile)', process.env.ADMIN_TOKEN, [401, 403]],
        ['administrator without MFA', auth.signAdminSessionToken({ email: NAMED, role: 'admin', mfa_verified: false }), [401, 403]],
        ['non-administrator role', auth.signAdminSessionToken({ email: NAMED, role: 'pro', mfa_verified: true }), [401, 403]],
        ...(pro ? [['professional token', pro, [401, 403]]] : []),
      ];
      for (const [label, bearer, codes] of cases) {
        for (const [m, u, b] of writes()) {
          const r = await call(m, u, bearer, b);
          expect(codes, `${label} ${m} ${u} -> ${r.statusCode} ${JSON.stringify(r.body)}`).toContain(r.statusCode);
        }
      }
      expect([await status(`${TAG}-1`), await status(`${TAG}-2`), await status(`${TAG}-3`)]).toEqual(['OPEN', 'OPEN', 'OPEN']);
      expect(gen.calls).toBe(0);
      expect((await db.execute(sql`SELECT count(*)::int n FROM "AuditLog" WHERE action = 'REVIEW_QUEUE_DECISION' AND entity_id LIKE ${TAG + '%'}`)).rows[0].n).toBe(0);
    } finally { vi.unstubAllEnvs(); }
  });

  it('the retired shared token is refused even for reads in a production-like profile', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const r = await call('GET', '/api/admin/review-queue?status=open', process.env.ADMIN_TOKEN);
      expect([401, 403]).toContain(r.statusCode);
      const w = await call('PATCH', `/api/admin/review-queue/${TAG}-1`, process.env.ADMIN_TOKEN, { status: 'dismissed' });
      expect([401, 403]).toContain(w.statusCode);
    } finally { vi.unstubAllEnvs(); }
    expect(await status(`${TAG}-1`)).toBe('OPEN');
  });

  it('a named MFA administrator decides; the audit names that person, the status change and the reason', async () => {
    const tok = auth.signAdminSessionToken({ email: NAMED, role: 'admin', mfa_verified: true });
    const one = await call('PATCH', `/api/admin/review-queue/${TAG}-1`, tok, { status: 'dismissed', reason: 'Doublon d’une fiche existante (QA).' });
    expect(one.statusCode, JSON.stringify(one.body)).toBe(200);
    const bulk = await call('PATCH', '/api/admin/review-queue/bulk', tok, { ids: [`${TAG}-2`], status: 'resolved', reason: 'Corrigé dans la fiche (QA).' });
    expect(bulk.statusCode, JSON.stringify(bulk.body)).toBe(200); expect(bulk.body.result.updated).toBe(1);
    const rows = (await db.execute(sql`SELECT actor, details FROM "AuditLog" WHERE action = 'REVIEW_QUEUE_DECISION' AND (entity_id = ${TAG + '-1'} OR details->'ids' ? ${TAG + '-2'}) ORDER BY "timestamp"`)).rows;
    expect(rows.map((r) => r.actor)).toEqual([NAMED, NAMED]);
    expect(rows[0].details).toMatchObject({ itemId: `${TAG}-1`, from: 'OPEN', to: 'dismissed', reason: 'Doublon d’une fiche existante (QA).', mfa: true, authType: 'admin_jwt' });
    expect(rows[1].details).toMatchObject({ bulk: true, to: 'resolved', reason: 'Corrigé dans la fiche (QA).', mfa: true });
    expect((await call('PATCH', `/api/admin/review-queue/${TAG}-3`, tok, { status: 'resolved_by_ai' })).statusCode).toBe(400);
  });
});
