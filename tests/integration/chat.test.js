import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

/**
 * Assistant Chat API boundary tests.
 * The real handler is exercised; embedding, retrieval, generation, rate limiting
 * and telemetry are deterministic test doubles. No daemon, DB or cloud is used.
 * Synthetic vectors/records below are test fixtures, not live source evidence.
 */
const io = vi.hoisted(() => ({
    embedding: vi.fn(), generate: vi.fn(), territory: vi.fn(), aides: vi.fn(),
    demarches: vi.fn(), structures: vi.fn(), rateLimit: vi.fn(),
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), sentry: vi.fn(),
    cloudChat: vi.fn(), cloudText: vi.fn(),
}));
vi.mock('../../api/_utils/logger.js', () => ({
    default: { child: () => ({ info: io.info, warn: io.warn, error: io.error }) },
}));
vi.mock('@sentry/node', () => ({ captureMessage: io.sentry }));
vi.mock('../../api/_utils/rateLimit.js', () => ({
    checkRateLimit: io.rateLimit,
    getClientIp: () => '127.0.0.1',
}));
vi.mock('../../api/lib/ai-foundation.js', () => ({
    generateCitizenLocalQueryEmbedding: io.embedding,
    generateCitizenLocalStructuredContent: io.generate,
}));
vi.mock('../../api/lib/geography/AssistantTerritoryResolver.js', () => ({
    resolveAssistantTerritory: io.territory,
}));
vi.mock('../../api/lib/hybrid-search.js', () => ({ searchAidesHybrid: io.aides }));
vi.mock('../../api/lib/search-query.js', () => ({
    searchDemarches: io.demarches, searchStructures: io.structures,
}));
vi.mock('../../api/lib/gemini.js', () => ({
    chatWithRulePack: io.cloudChat, generateText: io.cloudText,
}));
import chatHandler from '../../api/_handlers/assistant/chat.js';

const queryVector = () => Array.from({ length: 768 }, (_, index) => (index + 1) / 1000);
const syntheticAide = {
    id: 'chat-test-synthetic-aide',
    titre: 'Synthetic test aide - not published',
    description_courte: 'Synthetic fixture only.',
    source_url: 'https://example.test/synthetic-aide',
    date_verification: '2026-01-01T00:00:00Z',
};
function expectNoRetrievalOrGeneration() {
    expect(io.aides).not.toHaveBeenCalled();
    expect(io.demarches).not.toHaveBeenCalled();
    expect(io.structures).not.toHaveBeenCalled();
    expect(io.generate).not.toHaveBeenCalled();
}
function expectNoModelOrRetrieval() {
    expect(io.embedding).not.toHaveBeenCalled();
    expectNoRetrievalOrGeneration();
}
beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('KV_REST_API_URL', 'http://localhost');
    vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('GOOGLE_API_KEY', '');
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('UNEXPECTED_TEST_NETWORK_CALL'); }));
    io.rateLimit.mockResolvedValue({ allowed: true });
    io.territory.mockImplementation(({ rawTerritory }) => Promise.resolve(rawTerritory ? {
        status: 'RESOLVED', territory: { id: 'territory-test-id', type: 'COMMUNE', officialCode: '67482', label: 'Strasbourg', territoryIds: ['territory-test-id'] },
    } : { status: 'UNRESOLVED' }));
    io.embedding.mockResolvedValue({ embedding: queryVector(), embeddingModel: 'nomic-embed-text' });
    io.aides.mockResolvedValue({ items: [] });
    io.demarches.mockResolvedValue({ items: [] });
    io.structures.mockResolvedValue({ items: [] });
});
afterEach(() => {
    try {
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(io.cloudChat).not.toHaveBeenCalled();
        expect(io.cloudText).not.toHaveBeenCalled();
    } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    }
});

function createMockReq({ method = 'POST', body = {}, headers = {} } = {}) {
    return {
        method,
        url: '/api/assistant/chat',
        body,
        requestId: 'test-request-id',
        headers: {
            host: 'localhost:3000',
            'content-type': 'application/json',
            'x-forwarded-for': '127.0.0.1',
            ...headers,
        },
    };
}

function createMockRes() {
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.body = data;
            return this;
        },
        setHeader(key, value) {
            this.headers[key] = value;
        },
        end(data) {
            if (data) this.body = data;
            return this;
        },
    };
    return res;
}

describe('Assistant Chat API', () => {
    it('GET method returns 405', async () => {
        const req = createMockReq({ method: 'GET' });
        const res = createMockRes();

        await chatHandler(req, res);

        expect(res.statusCode).toBe(405);
        expect(res.body).toHaveProperty('error', 'method_not_allowed');
        expectNoModelOrRetrieval();
    });

    it('returns 400 for empty message', async () => {
        const req = createMockReq({ body: { message: '' } });
        const res = createMockRes();

        await chatHandler(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toHaveProperty('error', 'invalid_message');
        expectNoModelOrRetrieval();
    });

    it('returns 400 for missing message field', async () => {
        const req = createMockReq({ body: {} });
        const res = createMockRes();

        await chatHandler(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toHaveProperty('error', 'invalid_message');
        expectNoModelOrRetrieval();
    });

    it('returns 400 for message exceeding 800 characters', async () => {
        const req = createMockReq({ body: { message: 'a'.repeat(801) } });
        const res = createMockRes();

        await chatHandler(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toHaveProperty('error', 'message_too_long');
        expectNoModelOrRetrieval();
    });

    it('blocks sensitive data — NIR (numéro sécurité sociale)', async () => {
        const req = createMockReq({ body: { message: 'Mon numéro est 1 85 05 78 123 456 72' } });
        const res = createMockRes();

        await chatHandler(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toHaveProperty('error', 'sensitive_data_detected');
        expectNoModelOrRetrieval();
    });

    it('blocks sensitive data — IBAN FR', async () => {
        const req = createMockReq({ body: { message: 'Mon IBAN FR76 1234 5678 9012 3456 7890 123' } });
        const res = createMockRes();

        await chatHandler(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toHaveProperty('error', 'sensitive_data_detected');
        expectNoModelOrRetrieval();
    });

    it('blocks sensitive data — credit card number', async () => {
        const req = createMockReq({ body: { message: 'Ma carte 4970 1234 5678 9012' } });
        const res = createMockRes();

        await chatHandler(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toHaveProperty('error', 'sensitive_data_detected');
        expectNoModelOrRetrieval();
    });

    it('accepts valid message in mock mode and returns answer', async () => {
        // Scoped beforeEach/afterEach setup removes both cloud keys and restores them.
        const req = createMockReq({ body: { message: 'Quelles aides pour le logement ?' } });
        const res = createMockRes();

        await chatHandler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('answer');
        expect(res.body.answer.length).toBeGreaterThan(10);
        expect(res.body).toHaveProperty('mock', true);
        expect(res.body).toHaveProperty('meta');
        expect(res.body.meta).toHaveProperty('model', 'mock-dev');
        expect(res.body.abstention).toBe(true);
        expect(res.body.meta.reason).toBe('territory_required');
        expectNoModelOrRetrieval();
    });

    it('validates context object', async () => {
        const req = createMockReq({
            body: {
                message: 'Bonjour',
                context: { lang: 'invalid' },
            },
        });
        const res = createMockRes();

        await chatHandler(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.body).toHaveProperty('error', 'invalid_context');
        expectNoModelOrRetrieval();
    });

    it('accepts valid context', async () => {
        const req = createMockReq({
            body: {
                message: 'Aide RSA',
                context: { lang: 'fr', territory: '67000' },
            },
        });
        const res = createMockRes();

        await chatHandler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.abstention).toBe(true);
        expect(res.body.verified).toBe(false);
        expect(res.body.citations).toEqual([]);
        expect(res.body.meta.reason).toBe('no_verified_local_source');
        expect(io.embedding).toHaveBeenCalledTimes(1);
        expect(io.embedding).toHaveBeenCalledWith('Aide RSA');
        expect(io.aides).toHaveBeenCalledTimes(1);
        expect(io.aides.mock.calls[0][0].embedding).toEqual(queryVector());
        expect(io.aides.mock.calls[0][0].embeddingModel).toBe('nomic-embed-text');
        expect(io.aides.mock.calls[0][0]).not.toHaveProperty('geoScope');
        expect(io.aides.mock.calls[0][0].territoryFilter.userTerritoryIds).toEqual(['territory-test-id']);
        expect(io.demarches).toHaveBeenCalledTimes(1);
        expect(io.structures).toHaveBeenCalledTimes(1);
        expect(io.generate).not.toHaveBeenCalled();
    });

    it('returns 503 when query embedding fails before retrieval', async () => {
        io.embedding.mockRejectedValue(new Error('PRIVATE_EMBEDDING_FAILURE'));
        const req = createMockReq({ body: { message: 'Aide RSA', context: { territory: '67000' } } });
        const res = createMockRes();
        await chatHandler(req, res);
        expect(res.statusCode).toBe(503);
        expect(res.body.error).toBe('service_unavailable');
        expect(io.embedding).toHaveBeenCalledTimes(1);
        expectNoRetrievalOrGeneration();
        expect(JSON.stringify(res.body)).not.toContain('PRIVATE_EMBEDDING_FAILURE');
        expect(io.sentry).not.toHaveBeenCalled();
    });

    it('returns a grounded response with isolated local dependencies and no cloud key', async () => {
        io.aides.mockResolvedValue({ items: [syntheticAide] });
        io.generate.mockResolvedValue({
            content: {
                answer: 'Synthetic response for a test only.',
                citedSourceIds: ['aide:chat-test-synthetic-aide'],
                abstain: false,
            },
            provider: 'ollama', model: 'qwen3:8b', safeErrorState: null,
        });
        const req = createMockReq({ body: { message: 'Aide RSA', context: { territory: '67000' } } });
        const res = createMockRes();
        await chatHandler(req, res);
        expect(res.statusCode).toBe(200);
        expect(res.body.grounded).toBe(true);
        expect(res.body.abstention).toBe(false);
        expect(res.body.meta.provider).toBe('ollama');
        expect(res.body.meta.model).toBe('qwen3:8b');
        expect(res.body.citations.map((entry) => entry.sourceId)).toEqual(['aide:chat-test-synthetic-aide']);
        expect(io.embedding).toHaveBeenCalledTimes(1);
        expect(io.generate).toHaveBeenCalledTimes(1);
        expect(io.aides.mock.calls[0][0].embedding).toEqual(queryVector());
    });

    it('returns 503 when answer generation reports unavailable after retrieval', async () => {
        io.aides.mockResolvedValue({ items: [syntheticAide] });
        io.generate.mockResolvedValue({
            content: null, provider: 'ollama', model: 'qwen3:8b', safeErrorState: 'UNAVAILABLE',
        });
        const req = createMockReq({ body: { message: 'Aide RSA', context: { territory: '67000' } } });
        const res = createMockRes();
        await chatHandler(req, res);
        expect(res.statusCode).toBe(503);
        expect(res.body.error).toBe('service_unavailable');
        expect(io.embedding).toHaveBeenCalledTimes(1);
        expect(io.aides).toHaveBeenCalledTimes(1);
        expect(io.generate).toHaveBeenCalledTimes(1);
    });
});
