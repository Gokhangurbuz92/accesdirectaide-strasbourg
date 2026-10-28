import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// Exercise the real handler. Only its I/O boundaries are replaced.
const io = vi.hoisted(() => ({
  aides: vi.fn(), demarches: vi.fn(), structures: vi.fn(), generate: vi.fn(), embedding: vi.fn(), territory: vi.fn(),
  rateLimit: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn(),
  sentry: vi.fn(), cloudChat: vi.fn(), cloudText: vi.fn(),
}));
vi.mock('../../api/_utils/logger.js', () => ({
  default: {
    child: (...args) => {
      io.child(...args);
      return { info: io.info, warn: io.warn, error: io.error };
    },
  },
}));
vi.mock('@sentry/node', () => ({ captureMessage: io.sentry }));
vi.mock('../../api/_utils/rateLimit.js', () => ({
  checkRateLimit: io.rateLimit,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('../../api/lib/hybrid-search.js', () => ({ searchAidesHybrid: io.aides }));
vi.mock('../../api/lib/search-query.js', () => ({
  searchDemarches: io.demarches, searchStructures: io.structures,
}));
vi.mock('../../api/lib/ai-foundation.js', () => ({
  generateCitizenLocalStructuredContent: io.generate,
  generateCitizenLocalQueryEmbedding: io.embedding,
}));
vi.mock('../../api/lib/geography/AssistantTerritoryResolver.js', () => ({
  resolveAssistantTerritory: io.territory,
}));
vi.mock('../../api/lib/gemini.js', () => ({
  chatWithRulePack: io.cloudChat, generateText: io.cloudText,
}));

import handler from '../../api/_handlers/assistant/chat.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/ws4-grounding-fixtures.json', import.meta.url), 'utf8'));
const REQUEST_ID = 'ws4-legacy-test-request';
const PRIVATE_QUERY = 'Je cherche une aide logement. Mon email est personne@example.test.';
const PRIVATE_ANSWER = 'Information synth\u00e9tique, non publi\u00e9e.';

function request(body) {
  return { method: 'POST', body, headers: {}, requestId: REQUEST_ID };
}
function response() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}
function validBody(message = PRIVATE_QUERY) {
  return { message, context: { territory: fixture.territory } };
}
function localSuccess() {
  return {
    content: { answer: PRIVATE_ANSWER, citedSourceIds: ['aide:aide-1'], abstain: false },
    provider: 'ollama', model: 'qwen3:8b', safeErrorState: null,
  };
}
function expectNoRetrievalOrGeneration() {
  expect(io.embedding).not.toHaveBeenCalled();
  expect(io.aides).not.toHaveBeenCalled();
  expect(io.demarches).not.toHaveBeenCalled();
  expect(io.structures).not.toHaveBeenCalled();
  expect(io.generate).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('GEMINI_API_KEY', '');
  vi.stubEnv('GOOGLE_API_KEY', '');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('UNEXPECTED_TEST_NETWORK_CALL'); }));
  io.rateLimit.mockResolvedValue({ allowed: true });
  io.territory.mockImplementation(({ rawTerritory }) => Promise.resolve(rawTerritory ? {
    status: 'RESOLVED', territory: { id: fixture.territory, type: 'COMMUNE', officialCode: '67482', label: 'Strasbourg', territoryIds: [fixture.territory] },
  } : { status: 'UNRESOLVED' }));
  io.embedding.mockResolvedValue({
    embedding: Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0),
    embeddingModel: 'nomic-embed-text',
  });
  io.aides.mockResolvedValue({ items: [] });
  io.demarches.mockResolvedValue({ items: [] });
  io.structures.mockResolvedValue({ items: [] });
});
afterEach(() => {
  try {
    expect(io.cloudChat).not.toHaveBeenCalled();
    expect(io.cloudText).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

function mockReq(body, headers = {}) {
    return {
        method: 'POST',
        body,
        headers: { 'x-forwarded-for': '127.0.0.1', ...headers },
        requestId: 'test-' + Date.now(),
        socket: { remoteAddress: '127.0.0.1' },
    };
}

function mockRes() {
    const res = {
        statusCode: null,
        body: null,
        headers: {},
        status(code) { res.statusCode = code; return res; },
        json(data) { res.body = data; return res; },
        setHeader(k, v) { res.headers[k] = v; return res; },
    };
    return res;
}

describe('IA Guardrails — Golden Dataset', () => {

    // --- PII BLOCKING ---
    it('blocks NIR (numéro de sécurité sociale)', async () => {
        const req = mockReq({ message: 'Mon numéro est 1 85 01 75 123 456 78' });
        const res = mockRes();
        await handler(req, res);
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('sensitive_data_detected');
    });

    it('blocks IBAN FR', async () => {
        const req = mockReq({ message: 'Mon IBAN FR76 3000 6000 0112 3456 7890 189' });
        const res = mockRes();
        await handler(req, res);
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('sensitive_data_detected');
    });

    it('blocks credit card numbers', async () => {
        const req = mockReq({ message: 'Ma carte 4970 1012 3456 7890' });
        const res = mockRes();
        await handler(req, res);
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('sensitive_data_detected');
    });

    // --- INPUT VALIDATION ---
    it('rejects empty message', async () => {
        const req = mockReq({ message: '' });
        const res = mockRes();
        await handler(req, res);
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('invalid_message');
    });

    it('rejects message over 800 chars', async () => {
        const req = mockReq({ message: 'a'.repeat(801) });
        const res = mockRes();
        await handler(req, res);
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('message_too_long');
    });

    it('rejects invalid context type', async () => {
        const req = mockReq({ message: 'Aide logement', context: 'not-an-object' });
        const res = mockRes();
        await handler(req, res);
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('invalid_context');
    });

    it('rejects wrong method', async () => {
        const req = mockReq({ message: 'test' });
        req.method = 'GET';
        const res = mockRes();
        await handler(req, res);
        expect(res.statusCode).toBe(405);
    });

    // WS4: local service availability, not a cloud-key prerequisite.
    it('abstains without territory when cloud keys are absent', async () => {
        const res = response();
        await handler(request({ message: 'Quelles aides pour un etudiant ?' }), res);
        expect(res.statusCode).toBe(200);
        expect(res.body.abstention).toBe(true);
        expect(res.body.verified).toBe(false);
        expect(res.body.citations).toEqual([]);
        expect(res.body.meta.reason).toBe('territory_required');
        expectNoRetrievalOrGeneration();
    });

    it('abstains without verified sources and never calls an answer model', async () => {
        const res = response();
        await handler(request(validBody()), res);
        expect(res.statusCode).toBe(200);
        expect(res.body.abstention).toBe(true);
        expect(res.body.verified).toBe(false);
        expect(res.body.citations).toEqual([]);
        expect(res.body.meta.reason).toBe('no_verified_local_source');
        expect(io.aides).toHaveBeenCalledTimes(1);
        expect(io.demarches).toHaveBeenCalledTimes(1);
        expect(io.structures).toHaveBeenCalledTimes(1);
        expect(io.generate).not.toHaveBeenCalled();
    });

    it('returns 503 when the local foundation reports unavailable after retrieval', async () => {
        io.aides.mockResolvedValue({ items: [fixture.verifiedAide] });
        io.generate.mockResolvedValue({ content: null, safeErrorState: 'UNAVAILABLE', provider: 'ollama', model: 'qwen3:8b' });
        const res = response();
        await handler(request(validBody()), res);
        expect(io.generate).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBe(503);
        expect(res.body.error).toBe('service_unavailable');
    });

    it('returns 503 on a local foundation exception without exposing its content', async () => {
        io.aides.mockResolvedValue({ items: [fixture.verifiedAide] });
        io.generate.mockRejectedValue(new Error('PRIVATE_FAILURE ' + PRIVATE_QUERY));
        const res = response();
        await handler(request(validBody()), res);
        expect(io.generate).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBe(503);
        expect(res.body.error).toBe('service_unavailable');
        expect(JSON.stringify(res.body)).not.toContain(PRIVATE_QUERY);
        expect(JSON.stringify(res.body)).not.toContain('PRIVATE_FAILURE');
    });

    it('returns the local grounded response without any Gemini or Google key', async () => {
        io.aides.mockResolvedValue({ items: [fixture.verifiedAide] });
        io.generate.mockResolvedValue(localSuccess());
        const res = response();
        await handler(request(validBody()), res);
        expect(io.generate).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBe(200);
        expect(res.body.grounded).toBe(true);
        expect(res.body.abstention).toBe(false);
        expect(res.body.meta.provider).toBe('ollama');
        expect(res.body.meta.model).toBe('qwen3:8b');
        expect(res.body.citations.map((citation) => citation.sourceId)).toEqual(['aide:aide-1']);
    });
});
