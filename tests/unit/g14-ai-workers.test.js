/**
 * G14-AI — the citizen assistant on Cloudflare Workers AI at 0 € (owner decision 23/11/2026). No real Cloudflare call: fetch is mocked, the daily neuron
 * counter is an in-memory store injected through _setCounterStore. Covers the policy matrix, the adapter (timeout, no retry, daily-limit refusal, the token
 * never leaving the Authorization header), the counter, the handler path (scope, guards, citations, identifiers masked), capabilities and the preflight.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({ aides: vi.fn(), demarches: vi.fn(), structures: vi.fn(), localGenerate: vi.fn(), localEmbed: vi.fn(), metric: vi.fn() }));
vi.mock('../../api/_utils/logger.js', () => ({ default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }), warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1') }));
vi.mock('../../api/lib/hybrid-search.js', () => ({ searchAidesHybrid: mocks.aides }));
vi.mock('../../api/lib/search-query.js', () => ({ searchDemarches: mocks.demarches, searchStructures: mocks.structures }));
vi.mock('../../api/lib/ai-foundation.js', () => ({ generateCitizenLocalStructuredContent: mocks.localGenerate, generateCitizenLocalQueryEmbedding: mocks.localEmbed }));
vi.mock('../../api/lib/local-ai-metrics.js', () => ({ recordLocalAiEvent: mocks.metric }));
vi.mock('../../api/lib/geography/AssistantTerritoryResolver.js', () => ({ resolveAssistantTerritory: vi.fn().mockResolvedValue({ status: 'RESOLVED', territory: { id: 't', type: 'COMMUNE', officialCode: '67482', label: 'Strasbourg', territoryIds: ['t'] } }) }));

import { AIProviderPolicy, AUDIENCE, LOCALITY, PROVIDER, workersAiState } from '../../api/lib/ai-policy.js';
import {
  WORKERS_AI_MODELS, WorkersAiError, _setCounterStore, counterKey, dailyNeuronBudget, dailyUsage, estimateTokens, generateCitizenWorkersQueryEmbedding,
  generateCitizenWorkersStructuredContent, isDailyLimitResponse, neuronsFor, parseJsonResponse, reserveNeurons, runWorkersAi, workersAiEmbed, citizenAssistantProvider,
} from '../../api/lib/workers-ai.js';
import { stripIdentifiers } from '../../api/_utils/redact.js';
import handler, { EMERGENCY_NUMBERS, DAILY_LIMIT_MESSAGE, isEmergency, isHealthAdviceRequest } from '../../api/_handlers/assistant/chat.js';
import { capabilitiesOfRoute, capabilityState } from '../../api/_utils/capabilities.js';
import { surfaceOf } from '../../api/_utils/public-beta.js';
import { evaluateReleasePreflight, workersAiCheck } from '../../scripts/release-preflight.mjs';
import { INDEX_TARGETS, rebuildAideIndex } from '../../api/lib/retrieval-index.js';

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const TOKEN = 'cf-test-token-0123456789abcdefghij';
const ON = { AI_PROVIDER: 'workers_ai', AI_WORKERS_PRODUCTION_APPROVED: 'true', CF_WORKERS_AI_ACCOUNT_ID: ACCOUNT, CF_WORKERS_AI_TOKEN: TOKEN };

/** in-memory counter store (Upstash KV semantics used: incrby, get, set, expire) */
function memoryCounter({ remote = true } = {}) {
  const m = new Map();
  return { m, isRemote: remote, incrby: async (k, n) => { const v = (m.get(k) || 0) + n; m.set(k, v); return v; }, get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); return 'OK'; }, expire: async () => 1 };
}
const okJson = (result) => ({ ok: true, status: 200, json: async () => ({ success: true, errors: [], result }) });
const answerOf = (obj, usage = { prompt_tokens: 1200, completion_tokens: 120 }) => okJson({ response: JSON.stringify(obj), usage });
const vec = (d = 1024) => Array.from({ length: d }, (_, i) => (i === 0 ? 1 : 0.001));

let counter;
beforeEach(() => { counter = memoryCounter(); _setCounterStore(counter); });
afterEach(() => { _setCounterStore(null); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const stubOn = () => { for (const [k, v] of Object.entries(ON)) vi.stubEnv(k, v); };

describe('policy matrix (api/lib/ai-policy.js)', () => {
  const evalW = (audience, env) => AIProviderPolicy.evaluate({ provider: PROVIDER.WORKERS_AI, audience, env });
  it('Workers AI is allowed for CITIZEN and PUBLIC only when every switch is set', () => {
    expect(evalW(AUDIENCE.CITIZEN, ON)).toEqual({ allowed: true });
    expect(evalW(AUDIENCE.PUBLIC, ON)).toEqual({ allowed: true });
  });
  it('fail-closed: each missing switch refuses, with its own reason', () => {
    expect(evalW(AUDIENCE.CITIZEN, {}).reason).toBe('WORKERS_AI_NOT_SELECTED');
    expect(evalW(AUDIENCE.CITIZEN, { ...ON, AI_PROVIDER: 'ollama' }).reason).toBe('WORKERS_AI_NOT_SELECTED');
    expect(evalW(AUDIENCE.CITIZEN, { ...ON, AI_WORKERS_PRODUCTION_APPROVED: 'TRUE ' }).allowed).toBe(false);
    expect(evalW(AUDIENCE.CITIZEN, { ...ON, AI_WORKERS_PRODUCTION_APPROVED: '' }).reason).toBe('WORKERS_AI_NOT_APPROVED');
    expect(evalW(AUDIENCE.CITIZEN, { ...ON, CF_WORKERS_AI_ACCOUNT_ID: 'acct' }).reason).toBe('WORKERS_AI_ACCOUNT_ID_MISSING');
    expect(evalW(AUDIENCE.CITIZEN, { ...ON, CF_WORKERS_AI_TOKEN: '' }).reason).toBe('WORKERS_AI_TOKEN_MISSING');
  });
  it('never for PROFESSIONAL / ADMIN (the pro dossier synthesis stays closed), even fully enabled', () => {
    expect(evalW(AUDIENCE.PROFESSIONAL, ON)).toEqual({ allowed: false, reason: 'WORKERS_AI_CITIZEN_ASSISTANT_ONLY' });
    expect(evalW(AUDIENCE.ADMIN, ON)).toEqual({ allowed: false, reason: 'WORKERS_AI_CITIZEN_ASSISTANT_ONLY' });
  });
  it('reads process.env when no env is given (Production path)', () => {
    expect(AIProviderPolicy.evaluate({ provider: PROVIDER.WORKERS_AI, audience: AUDIENCE.CITIZEN }).allowed).toBe(false);
    stubOn();
    expect(AIProviderPolicy.evaluate({ provider: PROVIDER.WORKERS_AI, audience: AUDIENCE.CITIZEN }).allowed).toBe(true);
    expect(citizenAssistantProvider()).toBe('workers_ai');
  });
  it('Gemini and Ollama rules are unchanged, whatever the Workers AI switches', () => {
    for (const env of [{}, ON]) {
      for (const k of Object.keys(env)) vi.stubEnv(k, env[k]);
      expect(AIProviderPolicy.evaluate({ provider: PROVIDER.GEMINI, audience: AUDIENCE.CITIZEN }).reason).toBe('AI_PROVIDER_NOT_ALLOWED_FOR_AUDIENCE');
      expect(AIProviderPolicy.evaluate({ provider: PROVIDER.GEMINI, audience: AUDIENCE.PUBLIC }).reason).toBe('AI_PROVIDER_NOT_ALLOWED_FOR_AUDIENCE');
      expect(AIProviderPolicy.evaluate({ provider: PROVIDER.GEMINI, audience: AUDIENCE.PROFESSIONAL }).reason).toBe('BLOCKED_PENDING_PROVIDER_REVIEW');
      expect(AIProviderPolicy.evaluate({ provider: PROVIDER.OLLAMA, audience: AUDIENCE.CITIZEN, locality: LOCALITY.LOCAL_LOOPBACK }).allowed).toBe(true);
      expect(AIProviderPolicy.evaluate({ provider: PROVIDER.OLLAMA, audience: AUDIENCE.CITIZEN, locality: LOCALITY.EXTERNAL }).reason).toBe('EXTERNAL_OLLAMA_DENIED_BY_DEFAULT');
      expect(AIProviderPolicy.evaluate({ provider: 'OPENAI', audience: AUDIENCE.CITIZEN }).reason).toBe('UNKNOWN_PROVIDER_DENIED');
    }
  });
  it('workersAiState trims values but never widens them', () => {
    expect(workersAiState({ ...ON, AI_PROVIDER: ' Workers_AI ' }).enabled).toBe(true);
    expect(workersAiState({ ...ON, AI_PROVIDER: 'workers' }).enabled).toBe(false);
  });
});

describe('neurons and the daily counter', () => {
  it('rates follow the published pricing (per million tokens)', () => {
    expect(neuronsFor(WORKERS_AI_MODELS.generation, 1e6, 0)).toBe(31876);
    expect(neuronsFor(WORKERS_AI_MODELS.generation, 0, 1e6)).toBe(50488);
    expect(neuronsFor(WORKERS_AI_MODELS.embedding, 1e6)).toBe(1075);
    expect(() => neuronsFor('@cf/meta/llama', 1, 1)).toThrow(WorkersAiError);
    expect(estimateTokens('abcdef')).toBe(2);
  });
  it('budget: 9 000 by default, never above 9 500, garbage = default', () => {
    expect(dailyNeuronBudget({})).toBe(9000);
    expect(dailyNeuronBudget({ AI_WORKERS_DAILY_NEURON_BUDGET: '20000' })).toBe(9500);
    expect(dailyNeuronBudget({ AI_WORKERS_DAILY_NEURON_BUDGET: '5000' })).toBe(5000);
    expect(dailyNeuronBudget({ AI_WORKERS_DAILY_NEURON_BUDGET: 'x' })).toBe(9000);
  });
  it('a reservation passing the budget is refused and undone; the key is the UTC day', async () => {
    const now = new Date('2026-11-23T23:59:00Z');
    expect(counterKey(now)).toBe('ai:workers:neurons:2026-11-23');
    await reserveNeurons(8990, { now, envVars: {} });
    await expect(reserveNeurons(20, { now, envVars: {} })).rejects.toMatchObject({ code: 'DAILY_LIMIT' });
    expect(counter.m.get('ai:workers:neurons:2026-11-23')).toBe(8990);
    await reserveNeurons(10, { now, envVars: {} });
    expect(counter.m.get('ai:workers:neurons:2026-11-23')).toBe(9000);
  });
  it('Production without the shared KV refuses (an in-memory counter bounds nothing)', async () => {
    _setCounterStore(memoryCounter({ remote: false }));
    await expect(reserveNeurons(10, { envVars: { VERCEL_ENV: 'production' } })).rejects.toMatchObject({ code: 'COUNTER_UNAVAILABLE' });
    await expect(reserveNeurons(10, { envVars: {} })).resolves.toMatchObject({ reserved: 10 });
  });
  it('dailyUsage reports counts only', async () => {
    await reserveNeurons(100, { envVars: {} });
    expect(await dailyUsage({ envVars: {} })).toEqual({ used: 100, budget: 9000, remaining: 8900 });
  });
});

describe('adapter (mocked fetch, no real Cloudflare call)', () => {
  it('posts to the documented REST URL with the bearer token, refuses redirects, settles the measured cost', async () => {
    const fetchImpl = vi.fn(async () => answerOf({ answer: 'ok', citedSourceIds: ['aide:1'], abstain: false }));
    const r = await generateCitizenWorkersStructuredContent({ prompt: 'p'.repeat(300), systemInstruction: 's', zodSchema: z.object({ answer: z.string(), citedSourceIds: z.array(z.string()), abstain: z.boolean() }), jsonSchema: { type: 'object' }, fetchImpl, envVars: ON });
    expect(r).toMatchObject({ content: { answer: 'ok' }, provider: 'workers_ai', safeErrorState: null, usage: { promptTokens: 1200, completionTokens: 120 } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/mistralai/mistral-small-3.1-24b-instruct`);
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.redirect).toBe('error');
    const body = JSON.parse(init.body);
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(body.guided_json).toEqual({ type: 'object' });
    expect(body.max_tokens).toBeLessThanOrEqual(1024);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(counter.m.get(counterKey())).toBe(neuronsFor(WORKERS_AI_MODELS.generation, 1200, 120));
  });
  it('one request only: a 500 is UNAVAILABLE without retry and its reservation is released', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ success: false, errors: [{ code: 5000, message: `boom ${TOKEN}` }] }) }));
    const r = await generateCitizenWorkersStructuredContent({ prompt: 'p', systemInstruction: 's', zodSchema: z.object({}), fetchImpl, envVars: ON });
    expect(r).toMatchObject({ content: null, safeErrorState: 'UNAVAILABLE' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(counter.m.get(counterKey())).toBe(0);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
  it('the daily-limit refusal (429, code 4006 or the allocation message) is DAILY_LIMIT and closes the day', async () => {
    expect(isDailyLimitResponse(429, null)).toBe(true);
    expect(isDailyLimitResponse(400, { errors: [{ code: 4006, message: 'x' }] })).toBe(true);
    expect(isDailyLimitResponse(403, { errors: [{ code: 1, message: 'you have used up your daily free allocation of 10,000 neurons' }] })).toBe(true);
    expect(isDailyLimitResponse(500, { errors: [{ code: 7, message: 'internal' }] })).toBe(false);
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ success: false, errors: [{ code: 4006, message: 'daily free allocation' }] }) }));
    const r = await generateCitizenWorkersStructuredContent({ prompt: 'p', systemInstruction: 's', zodSchema: z.object({}), fetchImpl, envVars: ON });
    expect(r.safeErrorState).toBe('DAILY_LIMIT');
    // the next question is refused before any request
    const again = await generateCitizenWorkersStructuredContent({ prompt: 'p', systemInstruction: 's', zodSchema: z.object({}), fetchImpl, envVars: ON });
    expect(again.safeErrorState).toBe('DAILY_LIMIT');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('a hung request is aborted (TIMEOUT), never retried', async () => {
    const fetchImpl = vi.fn((_u, init) => new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))));
    const r = await generateCitizenWorkersStructuredContent({ prompt: 'p', systemInstruction: 's', zodSchema: z.object({}), fetchImpl, envVars: ON, timeoutMs: 1000 });
    expect(r.safeErrorState).toBe('TIMEOUT');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('nothing is sent when the policy is off; output that is not the schema is INVALID_OUTPUT', async () => {
    const fetchImpl = vi.fn(async () => answerOf({ nope: true }));
    expect((await generateCitizenWorkersStructuredContent({ prompt: 'p', systemInstruction: 's', zodSchema: z.object({ answer: z.string() }), fetchImpl, envVars: { ...ON, AI_WORKERS_PRODUCTION_APPROVED: 'false' } })).safeErrorState).toBe('NOT_ALLOWED');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await generateCitizenWorkersStructuredContent({ prompt: 'p', systemInstruction: 's', zodSchema: z.object({ answer: z.string() }), fetchImpl, envVars: ON })).safeErrorState).toBe('INVALID_OUTPUT');
    await expect(runWorkersAi({ model: '@cf/meta/llama-3.1-8b-instruct', body: {}, estimate: 1, envVars: ON, fetchImpl })).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
  });
  it('parses a fenced JSON text or an object', () => {
    expect(parseJsonResponse('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonResponse({ a: 2 })).toEqual({ a: 2 });
    expect(parseJsonResponse('no json')).toBeNull();
  });
  it('bge-m3 embeddings: 1024 dimensions checked, wrong shapes refused, a failed query vector is null (lexical retrieval)', async () => {
    const fetchImpl = vi.fn(async (_u, init) => okJson({ shape: [JSON.parse(init.body).text.length, 1024], data: JSON.parse(init.body).text.map(() => vec()) }));
    const out = await workersAiEmbed(['a', 'b'], { fetchImpl, envVars: ON });
    expect(out).toHaveLength(2); expect(out[0]).toHaveLength(1024);
    expect(fetchImpl.mock.calls[0][0]).toMatch(/\/ai\/run\/@cf\/baai\/bge-m3$/);
    const bad = vi.fn(async () => okJson({ data: [vec(768)] }));
    await expect(workersAiEmbed(['a'], { fetchImpl: bad, envVars: ON })).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
    await expect(workersAiEmbed([], { fetchImpl, envVars: ON })).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    expect(await generateCitizenWorkersQueryEmbedding('loyer', { fetchImpl: bad, envVars: ON })).toBeNull();
    expect(await generateCitizenWorkersQueryEmbedding('loyer', { fetchImpl, envVars: ON })).toMatchObject({ embeddingModel: '@cf/baai/bge-m3' });
  });
});

describe('identifiers never leave the server', () => {
  it('stripIdentifiers replaces e-mail, phone, NIR, IBAN and card numbers by tags', () => {
    const s = stripIdentifiers('Je suis jean.dupont@example.org, tel 06 12 34 56 78, NIR 1 85 05 78 006 084 36, FR76 3000 6000 0112 3456 7890 189');
    expect(s).not.toMatch(/dupont|06 12|1 85 05|FR76/);
    expect(s).toContain('[courriel]'); expect(s).toContain('[téléphone]'); expect(s).toContain('[NIR]'); expect(s).toContain('[IBAN]');
  });
});

describe('citizen assistant handler on Workers AI', () => {
  const record = { id: 'aide-1', slug: 'aide-logement', titre: 'Aide au logement', summary_falc: 'Aide pour payer le loyer. '.repeat(80), provenance: { sourceUrl: 'https://www.caf.fr/aides', verifiedAt: '2026-11-01' } };
  const call = async (body) => { const out = { statusCode: 200, body: null }; out.status = (c) => { out.statusCode = c; return out; }; out.json = (b) => { out.body = b; return out; }; await handler({ method: 'POST', body, headers: {}, requestId: 'g14ai' }, out); return out; };
  let sent;
  const cloudflare = (answer) => vi.fn(async (url, init) => {
    const body = JSON.parse(init.body); sent.push({ url, body });
    if (String(url).endsWith('bge-m3')) return okJson({ data: body.text.map(() => vec()) });
    const ids = JSON.parse(body.messages[1].content).verifiedRecords.map((r) => r.sourceId);
    return typeof answer === 'function' ? answer(ids) : answerOf({ answer, citedSourceIds: ids.slice(0, 1), abstain: false });
  });
  beforeEach(() => {
    sent = [];
    stubOn();
    mocks.aides.mockResolvedValue({ items: [record] });
    mocks.demarches.mockResolvedValue({ items: Array.from({ length: 5 }, (_, i) => ({ id: `d${i}`, slug: `d-${i}`, titre: `Démarche ${i}`, resume: 'x', source_url: `https://www.service-public.fr/d${i}`, date_verification: '2026-11-01' })) });
    mocks.structures.mockResolvedValue({ items: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, nom: `Structure ${i}`, description: 'y', source_url: `https://www.strasbourg.eu/s${i}`, date_verification: '2026-11-01' })) });
  });

  it('answers from verified fiches only, cites the fiche link and the official source, never calls the local model', async () => {
    vi.stubGlobal('fetch', cloudflare('Selon la fiche, cette aide aide à payer le loyer ; la demande se fait auprès de la CAF.'));
    const r = await call({ message: 'Comment payer mon loyer ?', context: { territory: 'Strasbourg' } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ grounded: true, abstention: false, meta: { provider: 'workers_ai' } });
    expect(r.body.citations[0]).toMatchObject({ sourceId: 'aide:aide-1', ficheUrl: '/aides/aide-logement', sourceUrl: 'https://www.caf.fr/aides' });
    expect(mocks.localGenerate).not.toHaveBeenCalled(); expect(mocks.localEmbed).not.toHaveBeenCalled();
    const gen = sent.find((x) => x.url.includes('mistral'));
    const prompt = JSON.parse(gen.body.messages[1].content);
    expect(prompt.verifiedRecords.length).toBeLessThanOrEqual(8);
    expect(prompt.verifiedRecords.every((x) => x.summary.length <= 600 && !('sourceUrl' in x) && !('ficheUrl' in x))).toBe(true);
    expect(JSON.stringify(prompt)).not.toMatch(/https?:\/\//);
    expect(gen.body.messages[0].content).toMatch(/objet JSON/);
  });

  it('an entitlement claim is never shown (entitlementWording guard on the output)', async () => {
    vi.stubGlobal('fetch', cloudflare('Vous toucherez cette aide chaque mois.'));
    const r = await call({ message: 'Comment payer mon loyer ?', context: { territory: 'Strasbourg' } });
    expect(r.body).toMatchObject({ abstention: true, meta: { reason: 'eligibility_claim_blocked' } });
    expect(JSON.stringify(r.body)).not.toMatch(/toucherez/);
  });

  it('a citation of a record that was not retrieved is refused (grounding)', async () => {
    vi.stubGlobal('fetch', cloudflare(() => answerOf({ answer: 'Voir la fiche.', citedSourceIds: ['aide:invented'], abstain: false })));
    const r = await call({ message: 'Comment payer mon loyer ?', context: { territory: 'Strasbourg' } });
    expect(r.body.meta.reason).toBe('grounding_validation_failed');
  });

  it('e-mail and phone are masked before anything is sent; NIR / IBAN are refused before', async () => {
    vi.stubGlobal('fetch', cloudflare('Selon la fiche, la demande se fait auprès de la CAF.'));
    await call({ message: 'Loyer impayé, contactez-moi à marie.x@example.org ou 0612345678', context: { territory: 'Strasbourg' } });
    expect(JSON.stringify(sent)).not.toMatch(/marie\.x|0612345678/);
    expect(JSON.stringify(sent)).toContain('[courriel]');
    sent.length = 0;
    const r = await call({ message: 'mon NIR 1 85 05 78 006 084 36', context: { territory: 'Strasbourg' } });
    expect(r.statusCode).toBe(400); expect(sent).toHaveLength(0);
  });

  it('emergencies get the free numbers at once, without retrieval or any request', async () => {
    vi.stubGlobal('fetch', cloudflare('x'));
    for (const q of ['Je veux mourir, je n’en peux plus', 'Mon mari me frappe', 'Je dors dehors ce soir avec mes enfants']) {
      const r = await call({ message: q });
      expect(r.body).toMatchObject({ abstention: true, meta: { reason: 'emergency_redirect' } });
      expect(r.body.emergencyNumbers.map((e) => e.number)).toEqual(['112', '15', '17', '115', '119', '3919', '3114']);
      for (const n of ['112', '15', '17', '115', '119', '3919', '3114']) expect(r.body.answer).toContain(n);
    }
    expect(sent).toHaveLength(0); expect(mocks.aides).not.toHaveBeenCalled();
    expect(EMERGENCY_NUMBERS).toHaveLength(7);
  });

  it('catalogue questions about urgent help are not emergencies; medical advice and legal advice are redirected', async () => {
    expect(isEmergency('Où trouver un hébergement d’urgence à Strasbourg ?')).toBe(false);
    expect(isEmergency('aide alimentaire d’urgence')).toBe(false);
    expect(isHealthAdviceRequest('Quels médicaments prendre pour la fièvre ?')).toBe(true);
    expect(isHealthAdviceRequest('Comment obtenir la complémentaire santé solidaire ?')).toBe(false);
    vi.stubGlobal('fetch', cloudflare('x'));
    const h = await call({ message: 'Quelle posologie pour le paracétamol ?', context: { territory: 'Strasbourg' } });
    expect(h.body).toMatchObject({ abstention: true, meta: { reason: 'health_advice_out_of_scope' } });
    expect(h.body.answer).toMatch(/médecin/);
    const l = await call({ message: 'Comment attaquer mon bailleur en justice ?', context: { territory: 'Strasbourg' } });
    expect(l.body.meta.reason).toBe('legal_advice_out_of_scope');
    expect(l.body.answer).toMatch(/point-justice/);
    expect(sent).toHaveLength(0);
  });

  it('the daily limit is said in the assistant’s words, and no request is made once the budget is used', async () => {
    const f = cloudflare('x'); vi.stubGlobal('fetch', f);
    counter.m.set(counterKey(), 9000);
    const r = await call({ message: 'Comment payer mon loyer ?', context: { territory: 'Strasbourg' } });
    expect(r.statusCode).toBe(503);
    expect(r.body).toMatchObject({ error: 'daily_limit_reached', message: DAILY_LIMIT_MESSAGE });
    expect(DAILY_LIMIT_MESSAGE).toBe("L'assistant a atteint sa limite du jour, réessayez demain.");
    expect(f).not.toHaveBeenCalled();
    expect(mocks.metric).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'error', reason: 'daily_limit_reached' }));
  });

  it('nothing of the conversation is stored: the metric holds codes and counts only', async () => {
    vi.stubGlobal('fetch', cloudflare('Selon la fiche, la demande se fait auprès de la CAF.'));
    await call({ message: 'Comment payer mon loyer ?', context: { territory: 'Strasbourg' } });
    const row = JSON.stringify(mocks.metric.mock.calls);
    expect(row).not.toMatch(/loyer|CAF/);
    expect(mocks.metric).toHaveBeenCalledWith(expect.objectContaining({ model: 'workers-mistral-small-3.1', outcome: 'answered' }));
  });

  it('without the switches the local path is used, unchanged', async () => {
    vi.unstubAllEnvs();
    mocks.localEmbed.mockResolvedValue({ embedding: vec(768), embeddingModel: 'nomic-embed-text' });
    mocks.localGenerate.mockImplementation(async ({ prompt }) => ({ content: { answer: 'Selon la fiche, voir la CAF.', citedSourceIds: [JSON.parse(prompt).verifiedRecords[0].sourceId], abstain: false }, model: 'qwen3:8b', provider: 'ollama' }));
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const r = await call({ message: 'Comment payer mon loyer ?', context: { territory: 'Strasbourg' } });
    expect(r.body.meta.provider).toBe('ollama'); expect(f).not.toHaveBeenCalled();
  });
});

describe('capabilities and surfaces', () => {
  const beta = { ADA_PUBLIC_BETA_RESTRICTED: '1', VERCEL_ENV: 'production' };
  it('assistant/chat has its own capability and surface; nothing else moves', () => {
    expect(capabilitiesOfRoute('assistant/chat')).toEqual(['ai.citizen_assistant']);
    expect(capabilitiesOfRoute('assistant/recommendations')).toEqual(['ai.processing']);
    expect(capabilitiesOfRoute('pro/dossier-synthesis')).toEqual(['ai.processing', 'citizen.shared_dossier']);
    expect(surfaceOf('assistant/chat')).toBe('assistant');
    expect(surfaceOf('assistant/recommendations')).toBe('diagnostic');
    expect(surfaceOf('assistant/feedback')).toBe('communications');
  });
  it('opens only with the surface AND the capability named; ai.processing stays closed', () => {
    expect(capabilityState('ai.citizen_assistant', beta).reason).toBe('SURFACE_CLOSED');
    expect(capabilityState('ai.citizen_assistant', { ...beta, ADA_BETA_OPEN_SURFACES: 'assistant' }).reason).toBe('NOT_LISTED_IN_ADA_CAPABILITIES_OPEN');
    const open = { ...beta, ADA_BETA_OPEN_SURFACES: 'assistant', ADA_CAPABILITIES_OPEN: 'ai.citizen_assistant' };
    expect(capabilityState('ai.citizen_assistant', open).open).toBe(true);
    expect(capabilityState('ai.processing', open).open).toBe(false);
    expect(capabilityState('ai.citizen_assistant', { ...beta, ADA_BETA_OPEN_SURFACES: 'diagnostic', ADA_CAPABILITIES_OPEN: 'ai.citizen_assistant' }).open).toBe(false);
  });
});

describe('release preflight', () => {
  const full = { ...ON, KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 'k', VITE_ASSISTANT_PROVIDER: 'workers_ai' };
  const check = (env) => workersAiCheck((k) => String(env[k] ?? '').trim());
  it('off = PASS; stray credentials = WARN', () => {
    expect(check({})[0]).toBe('PASS');
    expect(check({ CF_WORKERS_AI_TOKEN: 'x' })[0]).toBe('WARN');
  });
  it('selected: every prerequisite, else FAIL naming it (never a value)', () => {
    expect(check(full)[0]).toBe('PASS');
    for (const [k, v, word] of [['AI_WORKERS_PRODUCTION_APPROVED', '', 'AI_WORKERS_PRODUCTION_APPROVED'], ['CF_WORKERS_AI_ACCOUNT_ID', '', 'CF_WORKERS_AI_ACCOUNT_ID'], ['CF_WORKERS_AI_TOKEN', '', 'CF_WORKERS_AI_TOKEN'],
      ['GEMINI_API_KEY', 'g', 'GEMINI'], ['KV_REST_API_URL', '', 'KV'], ['AI_WORKERS_DAILY_NEURON_BUDGET', '10000', '9500'], ['VITE_ASSISTANT_PROVIDER', '', 'VITE_ASSISTANT_PROVIDER']]) {
      const [status, detail] = check({ ...full, [k]: v });
      expect(status).toBe('FAIL'); expect(detail).toContain(word); expect(detail).not.toContain(TOKEN);
    }
  });
  it('the gate lists ai.workers_ai, and ai.assistant_provider when the assistant is opened', () => {
    const ids = (env) => evaluateReleasePreflight(env, { legalText: '' }).filter((x) => x.id.startsWith('ai.'));
    expect(ids({}).map((x) => x.id)).toEqual(['ai.workers_ai', 'ai.no_unapproved_provider_key']);
    expect(ids({ ADA_CAPABILITIES_OPEN: 'ai.citizen_assistant' }).find((x) => x.id === 'ai.assistant_provider').status).toBe('FAIL');
    expect(ids({ ...full, ADA_CAPABILITIES_OPEN: 'ai.citizen_assistant' }).find((x) => x.id === 'ai.assistant_provider').status).toBe('PASS');
    expect(JSON.stringify(evaluateReleasePreflight(full, { legalText: '' }))).not.toContain(TOKEN);
  });
});

describe('bge-m3 index (api/lib/retrieval-index.js target m3, migration 0060)', () => {
  it('writes embedding_m3 / embedding_m3_sha256 / embedding_m3_at, never the 768-d column, and refuses a wrong dimension', async () => {
    const dialect = new PgDialect();
    const executed = [];
    const rows = [{ id: 'a1', titre: 'Aide', cest_quoi: 'x', index_model: '@cf/baai/bge-m3', index_hash: null, missing: true }, { id: 'a2', titre: 'Aide 2', index_model: '@cf/baai/bge-m3', index_hash: null, missing: true }];
    const db = { execute: async (q) => { const { sql: text } = dialect.sqlToQuery(q); executed.push(text); return { rows: text.startsWith('SELECT') ? rows : [] }; } };
    const summary = await rebuildAideIndex({ db, model: '@cf/baai/bge-m3', target: INDEX_TARGETS.m3, embed: async (texts) => texts.map((_, i) => (i === 0 ? vec(1024) : vec(768))) });
    expect(summary).toMatchObject({ embedded: 1, failed: 1 });
    expect(executed[0]).toContain('"embedding_m3_sha256" AS index_hash');
    const update = executed.find((x) => x.startsWith('UPDATE'));
    expect(update).toContain('"embedding_m3" =');
    expect(update).toContain('"embedding_m3_at" = NOW()');
    expect(update).not.toMatch(/SET embedding =|embedding_model/);
    await expect(rebuildAideIndex({ db, model: 'nomic-embed-text', target: INDEX_TARGETS.m3, embed: async () => [] })).rejects.toThrow(/another model/);
  });
});
