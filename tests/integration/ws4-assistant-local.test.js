import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({
  aides: vi.fn(),
  demarches: vi.fn(),
  structures: vi.fn(),
  generate: vi.fn(),
  embedding: vi.fn(),
  territory: vi.fn(),
}));

vi.mock('../../api/_utils/logger.js', () => ({
  default: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));

vi.mock('@sentry/node', () => ({ captureMessage: vi.fn() }));
vi.mock('../../api/_utils/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));
vi.mock('../../api/lib/hybrid-search.js', () => ({ searchAidesHybrid: mocks.aides }));
vi.mock('../../api/lib/search-query.js', () => ({
  searchDemarches: mocks.demarches,
  searchStructures: mocks.structures,
}));
vi.mock('../../api/lib/ai-foundation.js', () => ({
  generateCitizenLocalStructuredContent: mocks.generate,
  generateCitizenLocalQueryEmbedding: mocks.embedding,
}));
vi.mock('../../api/lib/geography/AssistantTerritoryResolver.js', () => ({
  resolveAssistantTerritory: mocks.territory,
}));

import handler from '../../api/_handlers/assistant/chat.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/ws4-grounding-fixtures.json', import.meta.url), 'utf8'));

function req(body) {
  return { method: 'POST', body, headers: {}, requestId: 'ws4-test-request' };
}
function res() {
  const out = { statusCode: 200, body: null };
  out.status = vi.fn((code) => { out.statusCode = code; return out; });
  out.json = vi.fn((body) => { out.body = body; return out; });
  return out;
}

const queryVector = () => Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.embedding.mockReset();
  mocks.generate.mockReset();
  mocks.embedding.mockResolvedValue({ embedding: queryVector(), embeddingModel: 'nomic-embed-text' });
  mocks.territory.mockImplementation(({ rawTerritory }) => Promise.resolve(rawTerritory ? {
    status: 'RESOLVED', territory: { id: 'territory-test-id', type: 'COMMUNE', officialCode: '67482', label: 'Strasbourg', territoryIds: ['territory-test-id'] },
  } : { status: 'UNRESOLVED' }));
  mocks.aides.mockResolvedValue({ items: [] });
  mocks.demarches.mockResolvedValue({ items: [] });
  mocks.structures.mockResolvedValue({ items: [] });
});

describe('WS4 local grounded assistant', () => {
  it('rejects NIR before retrieval or model execution', async () => {
    const response = res();
    await handler(req({ message: fixtures.pii.nir, context: { territory: fixtures.territory } }), response);
    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe('sensitive_data_detected');
    expect(mocks.aides).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('blocks prompt injection before model execution', async () => {
    const response = res();
    await handler(req({ message: fixtures.promptInjection, context: { territory: fixtures.territory } }), response);
    expect(response.statusCode).toBe(200);
    expect(response.body.abstention).toBe(true);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('abstains when no verified local record exists', async () => {
    const response = res();
    await handler(req({ message: fixtures.normalQuery, context: { territory: fixtures.territory } }), response);
    expect(response.statusCode).toBe(200);
    expect(response.body.grounded).toBe(false);
    expect(response.body.citations).toEqual([]);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('returns citations only for retrieved verified records', async () => {
    mocks.aides.mockResolvedValue({ items: [fixtures.verifiedAide] });
    mocks.generate.mockResolvedValue({
      content: { answer: 'Une information locale verifiee est disponible.', citedSourceIds: ['aide:aide-1'], abstain: false },
      provider: 'ollama',
      model: 'qwen3:8b',
      safeErrorState: null,
    });
    const response = res();
    await handler(req({ message: fixtures.normalQuery, context: { territory: fixtures.territory } }), response);
    expect(response.statusCode).toBe(200);
    expect(response.body.grounded).toBe(true);
    expect(response.body.verified).toBe(true);
    expect(response.body.citations[0].sourceId).toBe('aide:aide-1');
    expect(response.body.citations[0].entityId).toBe('aide-1');
  });

  it('rejects a citation identifier absent from retrieval', async () => {
    mocks.aides.mockResolvedValue({ items: [fixtures.verifiedAide] });
    mocks.generate.mockResolvedValue({
      content: { answer: 'Texte non retenu.', citedSourceIds: ['aide:invented'], abstain: false },
      provider: 'ollama',
      model: 'qwen3:8b',
      safeErrorState: null,
    });
    const response = res();
    await handler(req({ message: fixtures.normalQuery, context: { territory: fixtures.territory } }), response);
    expect(response.statusCode).toBe(200);
    expect(response.body.abstention).toBe(true);
    expect(response.body.citations).toEqual([]);
  });

  it('returns 503 when the local provider is unavailable', async () => {
    mocks.aides.mockResolvedValue({ items: [fixtures.verifiedAide] });
    mocks.generate.mockResolvedValue({ content: null, provider: 'ollama', model: 'qwen3:8b', safeErrorState: 'UNAVAILABLE' });
    const response = res();
    await handler(req({ message: fixtures.normalQuery, context: { territory: fixtures.territory } }), response);
    expect(response.statusCode).toBe(503);
    expect(response.body.error).toBe('service_unavailable');
  });
});

describe('WS4 query-vector wiring before existing retrieval', () => {
  it('passes the actual vector and matching model, not null, to hybrid search', async () => {
    const response = res();
    await handler(req({ message: fixtures.normalQuery, context: { territory: fixtures.territory } }), response);
    expect(mocks.embedding).toHaveBeenCalledTimes(1);
    expect(mocks.embedding).toHaveBeenCalledWith(fixtures.normalQuery);
    expect(mocks.aides).toHaveBeenCalledTimes(1);
    expect(mocks.aides.mock.calls[0][0].embedding).toEqual(queryVector());
    expect(mocks.aides.mock.calls[0][0].embeddingModel).toBe('nomic-embed-text');
    expect(mocks.aides.mock.calls[0][0]).not.toHaveProperty('geoScope');
    expect(mocks.aides.mock.calls[0][0].territoryFilter.userTerritoryIds).toEqual(['territory-test-id']);
    expect(mocks.embedding.mock.invocationCallOrder[0]).toBeLessThan(mocks.aides.mock.invocationCallOrder[0]);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('preserves the full vector without constant substitution', async () => {
    const vector = Array.from({ length: 768 }, (_, index) => (index + 1) / 1000);
    mocks.embedding.mockResolvedValue({ embedding: vector, embeddingModel: 'nomic-embed-text' });
    await handler(req({ message: fixtures.normalQuery, context: { territory: fixtures.territory } }), res());
    expect(mocks.aides.mock.calls[0][0].embedding).toBe(vector);
  });
  it('returns 503 and does not perform retrieval or answer generation if embeddings fail', async () => {
    mocks.embedding.mockRejectedValue(new Error('PRIVATE_EMBEDDING_ERROR'));
    const response = res();
    await handler(req({ message: fixtures.normalQuery, context: { territory: fixtures.territory } }), response);
    expect(response.statusCode).toBe(503);
    expect(response.body.error).toBe('service_unavailable');
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE_EMBEDDING_ERROR');
    expect(mocks.aides).not.toHaveBeenCalled();
    expect(mocks.demarches).not.toHaveBeenCalled();
    expect(mocks.structures).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it.each([
    ['NIR', fixtures.pii.nir, 400],
    ['IBAN', fixtures.pii.iban, 400],
    ['card', 'Ma carte 4970 1012 3456 7890', 400],
    ['injection', fixtures.promptInjection, 200],
    ['legal-advice', fixtures.legalAdvice, 200],
  ])('rejects %s before query embedding', async (_name, message, status) => {
    const response = res();
    await handler(req({ message, context: { territory: fixtures.territory } }), response);
    expect(response.statusCode).toBe(status);
    expect(mocks.embedding).not.toHaveBeenCalled();
    expect(mocks.aides).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('does not embed an unscoped request', async () => {
    const response = res();
    await handler(req({ message: fixtures.normalQuery }), response);
    expect(response.body.meta.reason).toBe('territory_required');
    expect(mocks.embedding).not.toHaveBeenCalled();
  });
  it('uses one embedding before a cited answer and preserves source binding', async () => {
    mocks.aides.mockResolvedValue({ items: [fixtures.verifiedAide] });
    mocks.generate.mockResolvedValue({
      content: { answer: 'Information synthetique de test.', citedSourceIds: ['aide:aide-1'], abstain: false },
      provider: 'ollama', model: 'qwen3:8b', safeErrorState: null,
    });
    const response = res();
    await handler(req({ message: fixtures.normalQuery, context: { territory: fixtures.territory } }), response);
    expect(response.body.grounded).toBe(true);
    expect(response.body.citations.map((item) => item.sourceId)).toEqual(['aide:aide-1']);
    expect(mocks.embedding).toHaveBeenCalledTimes(1);
    expect(mocks.aides.mock.invocationCallOrder[0]).toBeLessThan(mocks.generate.mock.invocationCallOrder[0]);
  });
});
