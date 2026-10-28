/**
 * PKG-6 / D19 D22 P18 on REAL PostgreSQL: a FALC draft (local model, or the deterministic summary when the model is unavailable) goes to the review queue and NEVER
 * reaches the public record by itself; a named MFA administrator approves (edited = HUMAN origin) and the record carries reviewer + date; reject; marking an imported
 * text as reviewed; the admin route refuses a session without MFA. The model is replaced by a fake: no network.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const hasDatabase = !!process.env.DATABASE_URL;
const ID = `falc-qa-${Date.now()}`;
const SOURCE = 'Cette aide fictive de test est versée chaque mois pour aider à payer le loyer. La demande se fait auprès de la caisse compétente.';
function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('PKG-6 FALC governance (real DB)', () => {
  let db, schema, falc, api, auth;
  const call = async (method, url, bearer, body) => { const u = new URL(url, 'http://localhost:3000'); const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', authorization: `Bearer ${bearer}` } }; const res = mkRes(); await api(req, res); return res; };
  const tok = (mfa) => auth.signAdminSessionToken({ email: 'falc-reviewer@example.test', role: 'admin', mfa_verified: mfa });
  const row = async () => (await db.execute(sql`SELECT summary_falc, falc_origin, falc_reviewed_by, falc_reviewed_at FROM "Aide" WHERE id = ${ID}`)).rows[0];
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); schema = await import('../../src/db/schema.ts'); falc = await import('../../api/_services/falc-governance.js');
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js');
    await db.insert(schema.Aide).values({ id: ID, slug: ID, titre: 'Aide fictive QA', statut: 'brouillon', cest_quoi: SOURCE });
  }, 60000);
  afterAll(async () => { if (db) { await db.execute(sql`DELETE FROM "AiOutputReview" WHERE "entityId" = ${ID}`); await db.execute(sql`DELETE FROM "Aide" WHERE id = ${ID}`); } });

  it('a local-model draft goes to the queue and is NOT published; approval with an edit publishes it as HUMAN with reviewer and date', async () => {
    const fake = async () => ({ content: { falc: 'Cette aide aide à payer le loyer. Elle est versée chaque mois.' }, model: 'qwen3:8b', provider: 'ollama', safeErrorState: null, usage: { promptTokens: 120, completionTokens: 30 } });   // the shape of ai-foundation wrapOutput
    const d = await falc.draft('aide', ID, 'summary_falc', 'falc-reviewer@example.test', { generate: fake });
    expect(d).toMatchObject({ ok: true, origin: 'AI_LOCAL', published: false });
    expect((await row()).summary_falc).toBeNull();
    expect((await call('POST', '/api/admin/falc', tok(false), { action: 'approve', id: d.id })).statusCode).toBe(403);
    const list = await call('GET', '/api/admin/falc', tok(false)); expect(list.statusCode).toBe(200);
    expect(list.body.drafts.find((x) => x.id === d.id).source).toContain('loyer');
    const ok = await call('POST', '/api/admin/falc', tok(true), { action: 'approve', id: d.id, text: 'Cette aide aide à payer le loyer. Vous la recevez chaque mois.', note: 'relu' });
    expect(ok.statusCode).toBe(200); expect(ok.body.origin).toBe('HUMAN');
    const r = await row(); expect(r.summary_falc).toMatch(/Vous la recevez/); expect(r.falc_origin).toBe('HUMAN'); expect(r.falc_reviewed_by).toBe('falc-reviewer@example.test'); expect(r.falc_reviewed_at).not.toBeNull();
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "EntityVersion" WHERE entity_id = ${ID}`)).rows[0].n).toBeGreaterThan(0);
  });

  it('model unavailable: deterministic draft; reject leaves the record unchanged; the database refuses a reviewer without date', async () => {
    const before = await row();
    const d = await falc.draft('aide', ID, 'summary_falc', 'falc-reviewer@example.test', { generate: async () => ({ safeErrorState: 'LOCAL_PROVIDER_REQUIRED' }) });
    expect(d.origin).toBe('DETERMINISTIC');
    expect((await call('POST', '/api/admin/falc', tok(true), { action: 'reject', id: d.id, note: 'trop long' })).statusCode).toBe(200);
    expect(await row()).toEqual(before);
    const bad = await db.execute(sql`UPDATE "Aide" SET falc_reviewed_by = 'x', falc_reviewed_at = NULL WHERE id = ${ID}`).then(() => 'ok', (e) => String(e.code || e.cause?.code));
    expect(bad).toBe('23514');
  });

  it('marking an existing FALC text as reviewed needs MFA and a note', async () => {
    await db.execute(sql`UPDATE "Aide" SET falc_reviewed_by = NULL, falc_reviewed_at = NULL, falc_origin = NULL WHERE id = ${ID}`);
    expect((await call('POST', '/api/admin/falc', tok(true), { action: 'mark_reviewed', entityType: 'aide', entityId: ID, note: 'court' })).statusCode).toBe(400);
    expect((await call('POST', '/api/admin/falc', tok(true), { action: 'mark_reviewed', entityType: 'aide', entityId: ID, note: 'Texte relu ligne à ligne avec la source.' })).statusCode, 'the texts read are required').toBe(400);
    // owner LAB audit: the mark is bound to the text read (GET … sha-256)
    const read = (await falc.recordFalc('aide', ID)).fields.find((f) => f.field === 'summary_falc');
    expect((await call('POST', '/api/admin/falc', tok(true), { action: 'mark_reviewed', entityType: 'aide', entityId: ID, note: 'Texte relu ligne à ligne avec la source.', seen: { summary_falc: 'x'.repeat(64) } })).statusCode, 'a text changed since it was read').toBe(409);
    expect((await call('POST', '/api/admin/falc', tok(true), { action: 'mark_reviewed', entityType: 'aide', entityId: ID, note: 'Texte relu ligne à ligne avec la source.', seen: { summary_falc: read.sha256 } })).statusCode).toBe(200);
    expect((await row()).falc_origin).toBe('IMPORTED');
  });

  it('PKG-6 / D22: an approval never carries over to a source text changed after the draft', async () => {
    const fake = async () => ({ content: { falc: 'Cette aide aide à payer le loyer. Elle est versée chaque mois.' }, model: 'qwen3:8b', safeErrorState: null });
    const d = await falc.draft('aide', ID, 'summary_falc', 'falc-reviewer@example.test', { generate: fake });
    expect(d.ok).toBe(true);
    await db.execute(sql`UPDATE "Aide" SET cest_quoi = ${SOURCE + ' Nouvelle condition ajoutée après le brouillon.'} WHERE id = ${ID}`);
    const r = await call('POST', '/api/admin/falc', tok(true), { action: 'approve', id: d.id });
    expect(r.statusCode).toBe(409); expect(r.body.error).toBe('SOURCE_CHANGED');
    expect((await db.execute(sql`SELECT status FROM "AiOutputReview" WHERE id = ${d.id}`)).rows[0].status).toBe('PENDING');
    await db.execute(sql`UPDATE "Aide" SET cest_quoi = ${SOURCE} WHERE id = ${ID}`);
  });
});
