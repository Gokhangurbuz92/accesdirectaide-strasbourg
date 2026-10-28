/**
 * PKG-6 / R17 on the REAL API entry (api/index.js) and REAL PostgreSQL — dossier synthesis by the LOCAL model, kept as a draft until a member of the organization
 * reviews it. The model is a MOCK here (fault injection: unavailable, timeout-like failure, invalid output, invented figure, URL, eligibility promise); the real
 * local-model evidence is recorded separately (STRASBOURG_FULL_PRODUCT_PLAN/R17_LOCAL_MODEL_SAMPLE_2026-10-21.json). Gemini is mocked to FAIL if ever called.
 * Synthetic organizations, professionals, citizen and dossier only.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));
const M = vi.hoisted(() => ({ mode: 'ok', calls: [], gemini: 0 }));
vi.mock('../../api/lib/gemini.js', () => ({ generateText: async () => { M.gemini += 1; throw new Error('GEMINI_MUST_NOT_BE_CALLED'); } }));
vi.mock('../../api/lib/ai-foundation.js', async (importOriginal) => ({ ...(await importOriginal()), generateStructuredContent: async (args) => {
  M.calls.push({ prompt: String(args.prompt), provider: args.primaryProvider, fallback: args.fallbackProvider ?? null, allowFallback: args.allowFallback, audience: args.audience });
  const ok = (points) => ({ content: { points }, model: 'qwen3:8b', provider: 'ollama', safeErrorState: null });
  switch (M.mode) {
    case 'down': return { content: null, model: 'qwen3:8b', provider: 'ollama', safeErrorState: 'UNAVAILABLE' };
    case 'throw': throw new Error('LOCAL_MODEL_TIMEOUT');
    case 'invalid': return { content: { text: 'pas un tableau' }, model: 'qwen3:8b', safeErrorState: null };
    case 'figure': return ok(['La personne touchera 512 euros par mois.']);
    case 'url': return ok(['Voir https://example.invalid/aide pour la suite.']);
    case 'promise': return ok(['Vous êtes éligible au RSA.']);
    default: return ok(['Faire préciser la composition du foyer.', 'Demander les revenus récents.', 'Orienter vers la CAF pour vérification.']);
  }
} }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const S = { A: `r17-a-${TS}`, B: `r17-b-${TS}` };
const P = { a1: { id: `r17-pa1-${TS}`, st: S.A }, a2: { id: `r17-pa2-${TS}`, st: S.A }, b: { id: `r17-pb-${TS}`, st: S.B } };
const CIT = { id: `r17-cit-${TS}`, email: `r17-cit-${TS}@example.test` };
const D = `r17-d-${TS}`;
function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('PKG-6 / R17 local dossier synthesis (real API entry, real DB)', () => {
  let db, api, auth, userAuth, contract;
  const call = async (method, url, { pro, cit, body } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const cookies = ['__csrf=qa-r17']; if (cit) cookies.push(userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: CIT.id, email: CIT.email })).split(';')[0]);
    const headers = { host: 'localhost:3000', 'x-forwarded-proto': 'http', cookie: cookies.join('; '), 'x-csrf-token': 'qa-r17',
      ...(pro ? { authorization: `Bearer ${auth.signProToken({ id: pro.id, email: `${pro.id}@example.test`, structureId: pro.st, role: 'STRUCTURE_ADMIN' })}` } : {}) };
    const res = mkRes(); await api({ method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, headers }, res); return res;
  };
  const synth = (pro, body = { shareId: D }) => call('POST', '/api/pro/dossier-synthesis', { pro, body });
  const list = (pro) => call('GET', `/api/pro/dossier-synthesis?shareId=${D}`, { pro });
  const drafts = async () => (await db.execute(sql`SELECT id, status, origin, kind, "scopeStructureId", "outputText" FROM "AiOutputReview" WHERE "sharedDiagnosticId" = ${D} ORDER BY "createdAt"`)).rows;
  const purposes = (p) => db.execute(sql`UPDATE "SharedDossierGrant" SET purposes = ${p} WHERE "sharedDiagnosticId" = ${D} AND "structureId" = ${S.A}`);
  const setResults = (answers) => db.execute(sql`UPDATE "SharedDiagnostic" SET results = ${JSON.stringify({ assessment: contract.buildAssessment({ answers }) })}::jsonb WHERE id = ${D}`);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); api = (await import('../../api/index.js')).default;
    auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js'); contract = await import('../../api/lib/assessmentContract.js');
    for (const id of Object.values(S)) await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${id}, ${'R17 ' + id}, ${id}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    for (const p of Object.values(P)) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${p.id}, ${p.id + '@example.test'}, 'x', 'STRUCTURE_ADMIN', 'active', ${p.st}, false, NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${CIT.id}, ${CIT.email}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId")
      VALUES (${D}, NOW() + interval '30 days', ${JSON.stringify({ zipCode: '67000', marker: 'SECRET_SITUATION_R17' })}::jsonb, '{}'::jsonb, 0, ${'h' + TS}, ${'t' + TS}, 'GUEST_SHARE', ${CIT.id})`);
    await setResults({ birthDate: '1990-01-01' });
    await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", "grantedVia", purposes) VALUES (${'g-' + TS}, ${D}, ${S.A}, ${P.a1.id}, 'invite', 'PURP-06')`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${D}`);
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity_id IN (SELECT id FROM "AiOutputReview" WHERE "sharedDiagnosticId" = ${D}) OR actor_id IN (${P.a1.id}, ${P.a2.id}, ${P.b.id})`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${CIT.id}`);
    for (const p of Object.values(P)) await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${p.id}`);
    for (const id of Object.values(S)) await db.execute(sql`DELETE FROM "Structure" WHERE id = ${id}`);
  });

  it('refused before any model call or write: anonymous, no AI consent (PURP-06 only), another organization', async () => {
    M.calls.length = 0;
    expect((await call('POST', '/api/pro/dossier-synthesis', { body: { shareId: D } })).statusCode).toBe(401);
    const r = await synth(P.a1); expect(r.statusCode).toBe(403); expect(r.body.error).toBe('AI_CONSENT_REQUIRED');
    expect((await synth(P.b)).statusCode).toBe(404);
    expect((await list(P.b)).statusCode).toBe(404);
    expect(M.calls.length).toBe(0); expect(await drafts()).toEqual([]);
  });

  it('with the citizen consent: a local draft (AI label, pending), local model only, minimal prompt; visible to its organization only', async () => {
    await purposes('PURP-06,PURP-05'); M.mode = 'ok'; M.calls.length = 0;
    const r = await synth(P.a1);
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    expect(r.body.draft).toMatchObject({ status: 'PENDING', aiGenerated: true, model: 'qwen3:8b', label: expect.stringMatching(/non relu/) });
    expect(M.calls).toHaveLength(1);
    expect(M.calls[0]).toMatchObject({ provider: 'ollama', fallback: null, allowFallback: false, audience: 'PROFESSIONAL' });
    expect(M.calls[0].prompt).not.toMatch(/SECRET_SITUATION_R17|zipCode|_files|signature|internalNote/);
    const [row] = await drafts(); expect(row).toMatchObject({ kind: 'DOSSIER_SYNTHESIS', origin: 'AI_LOCAL', status: 'PENDING', scopeStructureId: S.A });
    expect((await list(P.a2)).body.drafts.map((d) => d.id)).toEqual([r.body.draft.id]);   // another member of the same organization sees it
    expect(M.gemini).toBe(0);
  });

  it('honest failures, nothing stored: model unavailable, failure / timeout, invalid output, invented figure, URL, eligibility promise', async () => {
    const before = (await drafts()).length;
    for (const [mode, status, code] of [['down', 503, 'AI_LOCAL_UNAVAILABLE'], ['throw', 503, 'AI_LOCAL_UNAVAILABLE'], ['invalid', 502, 'AI_OUTPUT_INVALID'],
      ['figure', 422, 'AI_OUTPUT_REJECTED'], ['url', 422, 'AI_OUTPUT_REJECTED'], ['promise', 422, 'AI_OUTPUT_REJECTED']]) {
      M.mode = mode; const r = await synth(P.a1);
      expect([mode, r.statusCode, r.body.error]).toEqual([mode, status, code]);
    }
    expect((await drafts()).length).toBe(before); expect(M.gemini).toBe(0); M.mode = 'ok';
  });

  it('review is bound to the dossier version: a changed dossier cannot approve an old draft; a reviewed draft cannot be reviewed again; the dossier is never modified', async () => {
    const [d1] = (await list(P.a1)).body.drafts;
    expect((await call('POST', '/api/pro/dossier-synthesis', { pro: P.a2, body: { action: 'review', shareId: D, id: d1.id, decision: 'approve' } })).body.error).toBe('NOTE_REQUIRED');
    const resultsBefore = (await db.execute(sql`SELECT results FROM "SharedDiagnostic" WHERE id = ${D}`)).rows[0].results;
    await setResults({ birthDate: '1990-01-01', householdSize: 2 });
    const stale = await call('POST', '/api/pro/dossier-synthesis', { pro: P.a2, body: { action: 'review', shareId: D, id: d1.id, decision: 'approve', note: 'Relu avec la personne.' } });
    expect(stale.statusCode).toBe(409); expect(stale.body.error).toBe('SOURCE_CHANGED');
    expect((await list(P.a1)).body.drafts.find((d) => d.id === d1.id)).toMatchObject({ status: 'PENDING', sourceChanged: true });
    expect((await call('POST', '/api/pro/dossier-synthesis', { pro: P.a2, body: { action: 'review', shareId: D, id: d1.id, decision: 'reject', note: 'Dossier modifié depuis.' } })).statusCode).toBe(200);
    const d2 = (await synth(P.a1)).body.draft;
    const ok = await call('POST', '/api/pro/dossier-synthesis', { pro: P.a2, body: { action: 'review', shareId: D, id: d2.id, decision: 'approve', note: 'Relu, conforme au dossier.' } });
    expect(ok.statusCode, JSON.stringify(ok.body)).toBe(200); expect(ok.body.status).toBe('APPROVED');
    expect((await call('POST', '/api/pro/dossier-synthesis', { pro: P.a2, body: { action: 'review', shareId: D, id: d2.id, decision: 'approve', note: 'Encore une fois.' } })).statusCode).toBe(404);
    expect((await call('POST', '/api/pro/dossier-synthesis', { pro: P.b, body: { action: 'review', shareId: D, id: d2.id, decision: 'reject', note: 'Autre structure.' } })).statusCode).toBe(404);
    const after = (await db.execute(sql`SELECT results FROM "SharedDiagnostic" WHERE id = ${D}`)).rows[0].results;
    expect(after).not.toEqual(resultsBefore);   // changed by the test above, not by the synthesis
    expect(JSON.stringify(after)).not.toMatch(/Faire préciser|synthesis|AiOutputReview/);
  });

  it('the citizen decides: withdrawing AI consent forgets the drafts and stops new ones; revoking the organization and erasing the dossier also forget them', async () => {
    expect((await drafts()).length).toBeGreaterThan(0);
    const w = await call('POST', '/api/public/dossier-grants', { cit: true, body: { shareId: D, action: 'set_purposes', structureId: S.A, purposes: ['PURP-06'] } });
    expect(w.statusCode, JSON.stringify(w.body)).toBe(200);
    expect(await drafts()).toEqual([]); expect((await synth(P.a1)).statusCode).toBe(403);
    await call('POST', '/api/public/dossier-grants', { cit: true, body: { shareId: D, action: 'set_purposes', structureId: S.A, purposes: ['PURP-06', 'PURP-05'] } });
    expect((await synth(P.a1)).statusCode).toBe(200);
    expect((await call('POST', '/api/public/dossier-grants', { cit: true, body: { shareId: D, action: 'revoke', structureId: S.A } })).statusCode).toBe(200);
    expect(await drafts()).toEqual([]); expect((await synth(P.a1)).statusCode).toBe(404);
    await db.execute(sql`UPDATE "SharedDossierGrant" SET "revokedAt" = NULL WHERE "sharedDiagnosticId" = ${D} AND "structureId" = ${S.A}`);
    expect((await synth(P.a1)).statusCode).toBe(200);
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${D}`);   // erasure / expiry purge path: the database cascade
    expect(await drafts()).toEqual([]); expect(M.gemini).toBe(0);
  });
});
