import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

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
function loggedText() {
  return JSON.stringify([
    io.child.mock.calls, io.info.mock.calls, io.warn.mock.calls,
    io.error.mock.calls, io.sentry.mock.calls,
  ]);
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

/**
 * AI module contracts — vérifier que les modules IA sont bien structurés.
 */
describe('AI module contracts', () => {
  it('gemini module exists', () => {
    expect(existsSync('api/lib/gemini.js')).toBe(true);
  });

  it('gemini circuit breaker exists', () => {
    expect(existsSync('api/lib/gemini-circuit-breaker.js')).toBe(true);
  });

  it('prompt sanitizer exists', () => {
    expect(existsSync('api/lib/prompt-sanitizer.js')).toBe(true);
  });

  it('gemini metrics exists', () => {
    expect(existsSync('api/lib/gemini-metrics.js')).toBe(true);
  });

  it('gemini module uses circuit breaker', () => {
    const content = readFileSync('api/lib/gemini.js', 'utf-8');
    expect(content).toMatch(/circuit|breaker|opossum/i);
  });

  it('chat handler blocks sensitive data', () => {
    const content = readFileSync('api/_handlers/assistant/chat.js', 'utf-8');
    expect(content).toMatch(/NIR|IBAN|sensitive|block/i);
  });

  it('chat handler emits minimized success measurements without raw content', async () => {
    io.aides.mockResolvedValue({ items: [fixture.verifiedAide] });
    io.generate.mockResolvedValue(localSuccess());
    const res = response();
    await handler(request(validBody()), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.grounded).toBe(true);
    expect(io.generate).toHaveBeenCalledTimes(1);
    expect(io.info).toHaveBeenCalledTimes(1);
    const event = io.info.mock.calls[0][0];
    expect(event).toEqual({
      msg: 'assistant.chat_success', requestId: REQUEST_ID,
      searchMode: 'local_grounded', sourceCount: 1, citationCount: 1,
      grounded: true, latencyMs: expect.any(Number),
    });
    expect(Number.isFinite(event.latencyMs)).toBe(true);
    expect(event.latencyMs).toBeGreaterThanOrEqual(0);
    for (const value of [PRIVATE_QUERY, 'personne@example.test', PRIVATE_ANSWER, fixture.territory, fixture.verifiedAide.source_url]) {
      expect(loggedText()).not.toContain(value);
    }
  });

  it('chat handler measures empty-source abstention without executing an answer model', async () => {
    const res = response();
    await handler(request(validBody()), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.abstention).toBe(true);
    expect(res.body.citations).toEqual([]);
    expect(io.generate).not.toHaveBeenCalled();
    expect(io.info).toHaveBeenCalledTimes(1);
    const event = io.info.mock.calls[0][0];
    expect(event).toEqual({
      msg: 'assistant.chat_abstained', requestId: REQUEST_ID,
      searchMode: 'local_grounded', sourceCount: 0, grounded: false,
      latencyMs: expect.any(Number),
    });
    expect(Number.isFinite(event.latencyMs)).toBe(true);
    expect(event.latencyMs).toBeGreaterThanOrEqual(0);
    expect(loggedText()).not.toContain(PRIVATE_QUERY);
    expect(loggedText()).not.toContain('personne@example.test');
  });

  it('chat handler keeps local-provider exception telemetry generic', async () => {
    io.aides.mockResolvedValue({ items: [fixture.verifiedAide] });
    const privateFailure = 'PRIVATE_PROVIDER_ERROR ' + PRIVATE_QUERY;
    io.generate.mockRejectedValue(new Error(privateFailure));
    const res = response();
    await handler(request(validBody()), res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('service_unavailable');
    expect(io.error).toHaveBeenCalledTimes(1);
    expect(io.error).toHaveBeenCalledWith({ msg: 'assistant.local_failure', requestId: REQUEST_ID });
    expect(io.sentry).not.toHaveBeenCalled();
    expect(loggedText()).not.toContain(privateFailure);
    expect(loggedText()).not.toContain('personne@example.test');
    expect(JSON.stringify(res.body)).not.toContain(privateFailure);
  });

  it.each([
    ['NIR', 'Mon numero est 1 85 01 75 123 456 78'],
    ['IBAN', 'Mon IBAN FR76 3000 6000 0112 3456 7890 189'],
    ['card', 'Ma carte 4970 1012 3456 7890'],
  ])('chat handler rejects %s before I/O and logs no sensitive value', async (_kind, message) => {
    const res = response();
    await handler(request(validBody(message)), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('sensitive_data_detected');
    expectNoRetrievalOrGeneration();
    expect(io.warn).toHaveBeenCalledTimes(1);
    expect(io.warn).toHaveBeenCalledWith({ msg: 'assistant.sensitive_data_blocked', requestId: REQUEST_ID });
    expect(io.info).not.toHaveBeenCalled();
    expect(io.error).not.toHaveBeenCalled();
    expect(loggedText()).not.toContain(message);
    expect(loggedText()).not.toMatch(/1 85 01 75|FR76 3000|4970 1012/);
  });
});
