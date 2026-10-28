/**
 * PKG-6 / D22 on REAL PostgreSQL — human oversight of AI outputs:
 *  - the public FALC route never calls a model and never writes to the record (it used to write a cloud-model answer into the public columns with no review);
 *    it serves only publicly visible aides (D-5) and labels its automatic preview as not reviewed;
 *  - an AI repair suggestion never closes a review item by itself: the item stays open with the suggestion « PENDING_HUMAN_REVIEW »;
 *  - every human decision on the review queue is audited (who, from, to, AI suggestion attached); « resolved_by_ai » is refused as a human decision;
 *    bulk decisions now reach items written as 'OPEN' (case bug).
 * The cloud model is replaced by a fake: no network.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));
const gen = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../api/lib/gemini.js', () => ({ generateText: vi.fn(async () => { gen.calls += 1; return '{"documents": ["Pièce d\'identité", "Justificatif de domicile"]}'; }) }));
vi.mock('../../api/lib/gemini-metrics.js', () => ({ recordMetric: vi.fn() }));
// owner LAB audit: suggestions are generated only when the AI policy allows the provider for administrators (today it does not); the lifecycle below is tested
// with the policy cleared (`policy.allowed`), and the honest refusal with the real one
const policy = vi.hoisted(() => ({ allowed: true }));
vi.mock('../../api/_services/repair-suggestions.js', async (orig) => ({ ...(await orig()), suggestionsAllowed: () => policy.allowed }));

const hasDatabase = !!process.env.DATABASE_URL;
const TAG = `d22-${Date.now().toString(36)}`;
const VISIBLE = `${TAG}-visible`; const HIDDEN = `${TAG}-hidden`;
const SOURCE = 'Cette aide fictive de test est versée chaque mois aux ménages modestes pour aider à payer le loyer. La demande se fait auprès de la caisse.';
function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}
const req = (method, url, body, headers = {}) => ({ method, url, query: Object.fromEntries(new URL(url, 'http://localhost:3000').searchParams), body: body ?? null, cookies: {}, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', ...headers } });

describe.skipIf(!hasDatabase)('PKG-6 / D22 human oversight of AI outputs (real DB)', () => {
  let db, schema, api, summarize, hiveRepair, authMod;
  const admin = () => ({ authorization: `Bearer ${authMod.signAdminSessionToken({ email: `${TAG}-reviewer@example.test`, role: 'admin', mfa_verified: true })}` });   // named MFA administrator (synthetic)
  const legacy = () => ({ authorization: `Bearer ${process.env.ADMIN_TOKEN}` });
  const item = async (id) => (await db.execute(sql`SELECT status, details FROM "ReviewQueueItem" WHERE id = ${id}`)).rows[0];
  const audits = async (id) => (await db.execute(sql`SELECT actor, details FROM "AuditLog" WHERE action = 'REVIEW_QUEUE_DECISION' AND (entity_id = ${id} OR details->'ids' ? ${id}) ORDER BY "timestamp"`)).rows;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); schema = await import('../../src/db/schema.ts');
    api = (await import('../../api/index.js')).default;
    summarize = (await import('../../api/_handlers/public/falc/summarize.js')).default;
    hiveRepair = (await import('../../api/_handlers/admin/hive-repair.js')).default; authMod = await import('../../api/_utils/auth.js');
    const now = new Date();
    await db.insert(schema.Aide).values([
      { id: VISIBLE, slug: VISIBLE, titre: 'Aide fictive visible D22', statut: 'publie', cest_quoi: SOURCE, launch_eligible: true, verification_status: 'VERIFIED', verified_by: 'qa-reviewer@example.test',
        territory_verified: true, data_origin: 'official_source', source_url: 'https://www.service-public.fr/particuliers/vosdroits/F0000', date_verification: now },
      { id: HIDDEN, slug: HIDDEN, titre: 'Aide fictive brouillon D22', statut: 'brouillon', cest_quoi: SOURCE },
    ]);
    await db.insert(schema.ReviewQueueItem).values([
      { id: `${TAG}-a`, entityType: 'AIDE', entityId: VISIBLE, title: 'Aide fictive visible D22', reason: 'MISSING_REQUIRED_FIELD:documents_necessaires', severity: 'P0', status: 'OPEN' },
      { id: `${TAG}-b`, entityType: 'AIDE', entityId: HIDDEN, title: 'Aide fictive brouillon D22', reason: 'MISSING_SLUG', severity: 'P1', status: 'OPEN' },
      { id: `${TAG}-c`, entityType: 'AIDE', entityId: HIDDEN, title: 'Aide fictive brouillon D22', reason: 'MISSING_VERIFICATION', severity: 'P1', status: 'open' },
    ]);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE action = 'REVIEW_QUEUE_DECISION' AND (entity_id LIKE ${TAG + '%'} OR details::text LIKE ${'%' + TAG + '%'})`);
    await db.execute(sql`DELETE FROM "ReviewQueueItem" WHERE id LIKE ${TAG + '%'}`);
    await db.execute(sql`DELETE FROM "Aide" WHERE id IN (${VISIBLE}, ${HIDDEN})`);
  });

  it('public FALC: no model call, no write; an unpublished aide is « introuvable »; the preview says it is automatic and not reviewed', async () => {
    expect(readFileSync('api/_handlers/public/falc/summarize.js', 'utf8')).not.toMatch(/gemini|generateText|db\.update/);
    const before = gen.calls;
    const r = mkRes(); await summarize(req('POST', '/api/public/falc/summarize', { aideId: VISIBLE }), r);
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ cached: false, preview: true, persisted: false, reviewed: false, origin: 'DETERMINISTIC' });
    expect(r.body.summary_falc.length).toBeGreaterThan(20);
    expect((await db.execute(sql`SELECT summary_falc, conditions_falc FROM "Aide" WHERE id = ${VISIBLE}`)).rows[0]).toEqual({ summary_falc: null, conditions_falc: null });
    const h = mkRes(); await summarize(req('POST', '/api/public/falc/summarize', { aideId: HIDDEN }), h);
    expect(h.statusCode).toBe(404);
    expect(gen.calls).toBe(before);
  });

  it('while the AI policy blocks the provider, no suggestion is asked and the answer says why; « still in force » is never asked of a model', async () => {
    vi.stubEnv('ENABLE_AI_AGENT', 'true'); policy.allowed = false; const before = gen.calls;
    try {
      const r = mkRes(); await hiveRepair(req('POST', '/api/admin/hive-repair', { itemId: `${TAG}-a` }, admin()), r);
      expect([r.statusCode, r.body.error]).toEqual([503, 'AI_SUGGESTIONS_UNAVAILABLE']); expect(r.body.message).toMatch(/politique IA/);
      await db.insert(schema.ReviewQueueItem).values({ id: `${TAG}-v`, entityType: 'AIDE', entityId: `${TAG}-ev`, title: 'Fiche fictive v', reason: 'MISSING_VERIFICATION', severity: 'P1', status: 'OPEN', details: {} });
      policy.allowed = true;
      const v = mkRes(); await hiveRepair(req('POST', '/api/admin/hive-repair', { itemId: `${TAG}-v` }, admin()), v);
      expect([v.statusCode, v.body.error]).toEqual([400, 'HUMAN_DECISION']);
      expect(gen.calls, 'no model call').toBe(before);
    } finally { vi.unstubAllEnvs(); policy.allowed = true; }
  });

  it('an AI repair suggestion leaves the item OPEN, marked PENDING_HUMAN_REVIEW (it used to set resolved_by_ai itself)', async () => {
    vi.stubEnv('ENABLE_AI_AGENT', 'true');
    try {
      const r = mkRes(); await hiveRepair(req('POST', '/api/admin/hive-repair', { itemId: `${TAG}-a` }, admin()), r);
      expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    } finally { vi.unstubAllEnvs(); }
    const it = await item(`${TAG}-a`);
    expect(it.status).toBe('OPEN');
    expect(it.details).toMatchObject({ ai_suggestion_status: 'PENDING_HUMAN_REVIEW', ai_suggestion: { documents: expect.any(Array) } });
  });

  it('human decisions are audited under the named administrator; the shared token cannot decide; resolved_by_ai is refused; an AI suggestion needs a reason; bulk reaches items written as OPEN', async () => {
    const shared = mkRes(); await api(req('PATCH', `/api/admin/review-queue/${TAG}-a`, { status: 'resolved' }, legacy()), shared);
    expect([401, 403]).toContain(shared.statusCode);
    const bad = mkRes(); await api(req('PATCH', `/api/admin/review-queue/${TAG}-a`, { status: 'resolved_by_ai' }, admin()), bad);
    expect(bad.statusCode).toBe(400);
    const noReason = mkRes(); await api(req('PATCH', `/api/admin/review-queue/${TAG}-a`, { status: 'resolved' }, admin()), noReason);
    expect(noReason.statusCode).toBe(400); expect(noReason.body.error).toBe('REASON_REQUIRED');
    const ok = mkRes(); await api(req('PATCH', `/api/admin/review-queue/${TAG}-a`, { status: 'resolved', reason: 'Liste vérifiée sur service-public.fr (QA).' }, admin()), ok);
    expect(ok.statusCode, JSON.stringify(ok.body)).toBe(200);
    const [a] = await audits(`${TAG}-a`);
    expect(a.actor).toBe(`${TAG}-reviewer@example.test`);
    expect(a.details).toMatchObject({ itemId: `${TAG}-a`, from: 'OPEN', to: 'resolved', withAiSuggestion: true, reason: 'Liste vérifiée sur service-public.fr (QA).', mfa: true, authType: 'admin_jwt' });
    const bulk = mkRes(); await api(req('PATCH', '/api/admin/review-queue/bulk', { ids: [`${TAG}-b`, `${TAG}-c`], status: 'dismissed', reason: 'Fiches de test (QA).' }, admin()), bulk);
    expect(bulk.statusCode, JSON.stringify(bulk.body)).toBe(200);
    expect(bulk.body.result).toMatchObject({ updated: 2, skipped: 0 });
    expect((await item(`${TAG}-b`)).status).toBe('dismissed'); expect((await item(`${TAG}-c`)).status).toBe('dismissed');
    expect((await audits(`${TAG}-b`)).length).toBe(1);
  });
});

describe.skipIf(!hasDatabase)('PKG-6 / D22 oversight page API (real DB)', () => {
  let db, schema, api, auth;
  const ID = `${TAG}-ov`; const LEGACY = `${TAG}-legacy`;
  const call = async (method, bearer, body) => { const r = mkRes(); await api(req(method, '/api/admin/ai-oversight', body, bearer ? { authorization: `Bearer ${bearer}` } : {}), r); return r; };
  const tok = (mfa) => auth.signAdminSessionToken({ email: 'd22-reviewer@example.test', role: 'admin', mfa_verified: mfa });
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); schema = await import('../../src/db/schema.ts'); api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js');
    await db.insert(schema.ReviewQueueItem).values([
      { id: ID, entityType: 'AIDE', entityId: `${TAG}-x`, title: 'Fiche fictive D22', reason: 'MISSING_SOURCE_DOCUMENT', severity: 'P1', status: 'OPEN', details: { ai_suggestion: { url: 'https://example.invalid/x' }, ai_suggestion_status: 'PENDING_HUMAN_REVIEW' } },
      { id: LEGACY, entityType: 'AIDE', entityId: `${TAG}-y`, title: 'Fiche fictive D22 (avant D22)', reason: 'MISSING_VERIFICATION', severity: 'P1', status: 'resolved_by_ai', details: { ai_fix: { still_active: true } } },
    ]);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity_id IN (${ID}, ${LEGACY}) OR (action = 'ADMIN_API_WRITE' AND actor = 'd22-reviewer@example.test')`);
    await db.execute(sql`DELETE FROM "ReviewQueueItem" WHERE id IN (${ID}, ${LEGACY})`);
  });

  it('lists undecided AI suggestions (incl. those the AI had closed itself before D22); a decision needs MFA and a note; it is audited and never edits the record', async () => {
    expect((await call('GET', null)).statusCode).toBe(401);
    const g = await call('GET', tok(false)); expect(g.statusCode).toBe(200);
    expect(g.body.aiSuggestions.map((x) => x.id)).toEqual(expect.arrayContaining([ID, LEGACY])); expect(typeof g.body.falcPending).toBe('number');
    expect((await call('POST', tok(false), { action: 'decide', id: ID, decision: 'dismiss', note: 'Source inventée, écartée.' })).statusCode).toBe(403);
    expect((await call('POST', tok(true), { action: 'decide', id: ID, decision: 'dismiss', note: 'court' })).statusCode).toBe(400);
    await db.execute(sql`UPDATE "ReviewQueueItem" SET details = details || '{"ai_suggested_at": "2026-10-21T10:00:00.000Z"}'::jsonb WHERE id = ${ID}`);
    expect((await call('POST', tok(true), { action: 'decide', id: ID, decision: 'dismiss', note: 'URL non officielle : suggestion écartée.' })).body.error, 'decided on another version').toBe('VERSION_CHANGED');
    const d = await call('POST', tok(true), { action: 'decide', id: ID, decision: 'dismiss', note: 'URL non officielle : suggestion écartée.', suggestedAt: '2026-10-21T10:00:00.000Z' });
    expect(d.statusCode, JSON.stringify(d.body)).toBe(200); expect(d.body).toMatchObject({ status: 'dismissed', decision: 'DISMISSED_BY_HUMAN', recordChanged: false });
    const [row] = (await db.execute(sql`SELECT status, details FROM "ReviewQueueItem" WHERE id = ${ID}`)).rows;
    expect(row.status).toBe('dismissed'); expect(row.details).toMatchObject({ ai_suggestion_status: 'DISMISSED_BY_HUMAN', reviewed_by: 'd22-reviewer@example.test' });
    const [audit] = (await db.execute(sql`SELECT actor, details FROM "AuditLog" WHERE action = 'REVIEW_QUEUE_DECISION' AND entity_id = ${ID}`)).rows;
    expect(audit).toMatchObject({ actor: 'd22-reviewer@example.test', details: { from: 'OPEN', to: 'dismissed', mfa: true } });
    expect((await call('POST', tok(true), { action: 'decide', id: ID, decision: 'keep', note: 'Deuxième décision refusée.' })).statusCode).toBe(404);
    const k = await call('POST', tok(true), { action: 'decide', id: LEGACY, decision: 'keep', note: 'Vérifié sur la source officielle.' });
    expect(k.statusCode).toBe(200); expect(k.body.status).toBe('resolved');
  });
});
