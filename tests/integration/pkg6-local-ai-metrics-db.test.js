/**
 * PKG-6 / A14 D21 on REAL PostgreSQL: local-model events are stored as outcome + reason code only (no text), aggregated with real latency percentiles, kept out of the
 * Gemini totals (no Gemini price on a local run), served to an administrator by /api/admin/ai-metrics; a FALC draft in the real ai-foundation output shape is a model
 * draft and is measured. The model is replaced by a fake: no network.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const hasDatabase = !!process.env.DATABASE_URL;
const MODEL = `qa-local-${Date.now().toString(36)}`;   // a model name only this test writes, so its rows are identifiable and removed
const ID = `a14-qa-${Date.now()}`;
function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}
const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 50)); } };

describe.skipIf(!hasDatabase)('PKG-6 local-model metrics (real DB)', () => {
  let db, schema, m, gem, falc, api, auth;
  const mine = async () => (await db.execute(sql`SELECT type, model, latency_ms, error_message, total_tokens, success FROM "AiMetric" WHERE model = ${MODEL} ORDER BY type, latency_ms`)).rows;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); schema = await import('../../src/db/schema.ts');
    m = await import('../../api/lib/local-ai-metrics.js'); gem = await import('../../api/lib/gemini-metrics.js'); falc = await import('../../api/_services/falc-governance.js');
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js');
    await db.insert(schema.Aide).values({ id: ID, slug: ID, titre: 'Aide fictive QA A14', statut: 'brouillon', cest_quoi: 'Cette aide fictive de test aide à payer le loyer chaque mois, selon les revenus du foyer.' });
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AiMetric" WHERE model = ${MODEL} OR (model = 'none' AND error_message = 'qa_a14_marker')`);
    await db.execute(sql`DELETE FROM "AiOutputReview" WHERE "entityId" = ${ID}`); await db.execute(sql`DELETE FROM "Aide" WHERE id = ${ID}`);
  });

  it('events are stored as outcome + reason code only, never free text; percentiles come from real model calls; Gemini totals exclude them', async () => {
    const before = await gem.getMetrics();
    m.recordLocalAiEvent({ feature: 'assistant', outcome: 'answered', model: MODEL, latencyMs: 1200, usage: { promptTokens: 300, completionTokens: 80 } });
    m.recordLocalAiEvent({ feature: 'assistant', outcome: 'answered', model: MODEL, latencyMs: 2400, usage: { promptTokens: 310, completionTokens: 90 } });
    m.recordLocalAiEvent({ feature: 'assistant', outcome: 'abstained', model: MODEL, latencyMs: 31000, reason: 'model_abstained' });
    m.recordLocalAiEvent({ feature: 'assistant', outcome: 'error', model: MODEL, latencyMs: 30000, reason: 'Mon numéro est 06 12 34 56 78, aidez-moi' });   // free text: refused
    m.recordLocalAiEvent({ feature: 'assistant', outcome: 'blocked', reason: 'qa_a14_marker', model: null, latencyMs: 999 });   // no model call: latency 0, model none
    m.recordLocalAiEvent({ feature: 'chat', outcome: 'answered', model: MODEL });   // undeclared feature: not stored
    const rows = await until(async () => { const r = await mine(); return r.length >= 4 ? r : null; });
    expect(rows.map((r) => [r.type, r.error_message])).toEqual([
      ['assistant.abstained', 'model_abstained'], ['assistant.answered', null], ['assistant.answered', null], ['assistant.error', 'other']]);
    expect(rows.find((r) => r.type === 'assistant.error').success).toBe(false);
    expect(JSON.stringify(rows)).not.toMatch(/06 12|numéro|aidez/);
    const blocked = (await db.execute(sql`SELECT model, latency_ms FROM "AiMetric" WHERE error_message = 'qa_a14_marker'`)).rows;
    expect(blocked).toEqual([{ model: 'none', latency_ms: 0 }]);

    const agg = await m.getLocalAiMetrics({ db });
    expect(agg.models.find((x) => x.model === MODEL)).toEqual({ model: MODEL, calls: 4, tokens: 780, costUsd: 0 });
    const lat = agg.latencyMs.find((x) => x.feature === 'assistant'); expect(lat.calls).toBeGreaterThanOrEqual(4); expect(lat.max).toBeGreaterThanOrEqual(31000);
    expect(agg.reasons.some((r) => r.type === 'assistant.abstained' && r.reason === 'model_abstained')).toBe(true);
    expect(agg.assistant.total).toBeGreaterThanOrEqual(5);
    expect(agg.rag).toMatchObject({ aides: expect.any(Number), published: expect.any(Number) });

    const after = await gem.getMetrics();
    expect(after.storage).toBe('database');
    expect(after.total_requests).toBe(before.total_requests);   // local rows are not Gemini requests
    expect(after.estimated_cost_usd).toBe(before.estimated_cost_usd);
    expect(Object.keys(after.by_type).some((t) => t.startsWith('assistant.'))).toBe(false);
  });

  it('/api/admin/ai-metrics serves the local section to an administrator only', async () => {
    const call = async (bearer) => { const req = { method: 'GET', url: '/api/admin/ai-metrics', query: {}, body: null, cookies: {}, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } }; const res = mkRes(); await api(req, res); return res; };
    expect((await call(null)).statusCode).toBe(401);
    const ok = await call(auth.signAdminSessionToken({ email: 'a14-qa@example.test', role: 'admin', mfa_verified: true }));
    expect(ok.statusCode).toBe(200);
    expect(ok.body.local).toMatchObject({ windowDays: 30, assistant: expect.any(Object), rag: expect.any(Object) });
    expect(ok.body.local.models.some((x) => x.model === MODEL)).toBe(true);
  });

  it('a FALC draft in the real ai-foundation shape (content.falc) is a model draft, and is measured; an unavailable model is measured as a fallback', async () => {
    const gen = async () => ({ content: { falc: 'Cette aide aide à payer le loyer. Vous la recevez chaque mois.' }, model: MODEL, provider: 'ollama', latency: 800, safeErrorState: null, usage: { promptTokens: 90, completionTokens: 20 } });
    const d = await falc.draft('aide', ID, 'summary_falc', 'a14-qa@example.test', { db, generate: gen });
    expect(d).toMatchObject({ ok: true, origin: 'AI_LOCAL', model: MODEL, published: false });
    const f = await falc.draft('aide', ID, 'summary_falc', 'a14-qa@example.test', { db, generate: async () => ({ content: null, model: MODEL, safeErrorState: 'UNAVAILABLE' }) });
    expect(f.origin).toBe('DETERMINISTIC');
    const rows = await until(async () => { const r = (await mine()).filter((x) => x.type.startsWith('falc.')); return r.length >= 2 ? r : null; });
    expect(rows.map((r) => [r.type, r.error_message])).toEqual([['falc.drafted', null], ['falc.fallback', 'unavailable']]);
  });
});
