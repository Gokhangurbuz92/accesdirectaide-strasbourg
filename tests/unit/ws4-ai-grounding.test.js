import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../api/lib/ai-foundation.js', import.meta.url), 'utf8');

describe('WS4 local AI foundation contract', () => {
  it('exposes a citizen local-only wrapper', () => {
    expect(source).toContain('generateCitizenLocalStructuredContent');
    expect(source).toContain("primaryProvider: 'ollama'");
    expect(source).toContain("model: 'qwen3:8b'");
    expect(source).toContain('audience: AUDIENCE.CITIZEN');
  });

  it('disables fallback for citizen execution', () => {
    expect(source).toContain('allowFallback: false');
    expect(source).toContain('fallbackProvider: null');
    expect(source).toContain('if (allowFallback && fallbackProvider && providers[fallbackProvider])');
  });

  it('requires loopback locality and a bounded timeout', () => {
    expect(source).toContain('LOCALITY.LOCAL_LOOPBACK');
    expect(source).toContain('LOCAL_PROVIDER_REQUIRED');
    expect(source).toContain('30000');
  });
});

// Behavioral checks: real citizen-vector boundary, fake transport only.
const embeddingIo = vi.hoisted(() => ({ fetch: vi.fn(), cloud: vi.fn(), ollama: vi.fn() }));
vi.mock('../../api/lib/ai-provider.js', () => ({
  GeminiProvider: class { generateStructured = embeddingIo.cloud; },
  OllamaProvider: class { generateStructured = embeddingIo.ollama; },
}));
import { generateCitizenLocalQueryEmbedding } from '../../api/lib/ai-foundation.js';
import { AIProviderPolicy } from '../../api/lib/ai-policy.js';

const validQueryVector = () => Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);
function embedResponse(embedding = validQueryVector()) {
  return { ok: true, redirected: false, json: async () => ({ embedding }) };
}

describe('WS4 citizen local query embeddings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('AI_EMBEDDING_PROVIDER', 'ollama');
    vi.stubEnv('OLLAMA_MODEL', 'nomic-embed-text');
    vi.stubEnv('OLLAMA_URL', 'http://127.0.0.1:11434/api/embeddings');
    vi.stubEnv('OLLAMA_BASE_URL', 'http://127.0.0.1:11434');
    vi.stubEnv('GEMINI_API_KEY', 'test-cloud-key-must-not-be-used');
    vi.stubEnv('AI_FALLBACK_PROVIDER', 'gemini');
    vi.stubGlobal('fetch', embeddingIo.fetch);
    embeddingIo.fetch.mockResolvedValue(embedResponse());
  });
  afterEach(() => {
    try {
      expect(embeddingIo.cloud).not.toHaveBeenCalled();
      expect(embeddingIo.ollama).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('sends a local normalized query and returns the 768D vector with its exact model', async () => {
    const out = await generateCitizenLocalQueryEmbedding('  aide   logement\nlocale ');
    expect(out).toEqual({ embedding: validQueryVector(), embeddingModel: 'nomic-embed-text' });
    expect(embeddingIo.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = embeddingIo.fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:11434/api/embeddings');
    expect(JSON.parse(options.body)).toEqual({ model: 'nomic-embed-text', prompt: 'aide logement locale' });
    expect(options.method).toBe('POST');
    expect(options.redirect).toBe('error');
    expect(options.credentials).toBe('omit');
    expect(options.signal.aborted).toBe(false);
  });
  it('pins localhost to numeric loopback without using DNS', async () => {
    vi.stubEnv('OLLAMA_URL', 'http://localhost:11434/api/embeddings');
    await generateCitizenLocalQueryEmbedding('aide');
    expect(embeddingIo.fetch.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/embeddings');
  });
  it('supports explicit IPv6 loopback without widening the host allowlist', async () => {
    vi.stubEnv('OLLAMA_URL', 'http://[::1]:11434/api/embeddings');
    await generateCitizenLocalQueryEmbedding('aide');
    expect(embeddingIo.fetch.mock.calls[0][0]).toBe('http://[::1]:11434/api/embeddings');
  });
  it('derives the embedding endpoint from a local base when OLLAMA_URL is unset', async () => {
    vi.stubEnv('OLLAMA_URL', '');
    await generateCitizenLocalQueryEmbedding('aide');
    expect(embeddingIo.fetch.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/embeddings');
  });
  it.each([
    'https://example.test/api/embeddings',
    'http://localhost.example.test/api/embeddings',
    'http://127.0.0.2:11434/api/embeddings',
    'http://user:secret@127.0.0.1:11434/api/embeddings',
    'http://127.0.0.1:11434/api/embeddings?next=outside',
    'http://127.0.0.1:11434/api/embeddings#fragment',
    'http://127.0.0.1:11434/api/pull',
    'file:///api/embeddings',
    'not-a-url',
  ])('rejects unsafe endpoint %s before transport', async (url) => {
    vi.stubEnv('OLLAMA_URL', url);
    await expect(generateCitizenLocalQueryEmbedding('aide')).rejects.toThrow('LOCAL_QUERY_EMBEDDING_UNAVAILABLE');
    expect(embeddingIo.fetch).not.toHaveBeenCalled();
  });
  it.each(['', '   ', null, 'a'.repeat(801)])('rejects invalid input %# before transport', async (text) => {
    await expect(generateCitizenLocalQueryEmbedding(text)).rejects.toThrow('LOCAL_QUERY_EMBEDDING_UNAVAILABLE');
    expect(embeddingIo.fetch).not.toHaveBeenCalled();
  });
  it('rejects a cloud embedding selection despite available cloud credentials', async () => {
    vi.stubEnv('AI_EMBEDDING_PROVIDER', 'gemini');
    await expect(generateCitizenLocalQueryEmbedding('aide')).rejects.toThrow('LOCAL_QUERY_EMBEDDING_UNAVAILABLE');
    expect(embeddingIo.fetch).not.toHaveBeenCalled();
  });
  it('rejects a model inconsistent with the local index contract', async () => {
    vi.stubEnv('OLLAMA_MODEL', 'other-model');
    await expect(generateCitizenLocalQueryEmbedding('aide')).rejects.toThrow('LOCAL_QUERY_EMBEDDING_UNAVAILABLE');
    expect(embeddingIo.fetch).not.toHaveBeenCalled();
  });
  it('honors a policy denial without transport', async () => {
    vi.spyOn(AIProviderPolicy, 'evaluate').mockReturnValue({ allowed: false });
    await expect(generateCitizenLocalQueryEmbedding('aide')).rejects.toThrow('LOCAL_QUERY_EMBEDDING_UNAVAILABLE');
    expect(embeddingIo.fetch).not.toHaveBeenCalled();
  });
  it.each([
    ['null', null],
    ['wrong dimension', [1, 2]],
    ['nonfinite', Array.from({ length: 768 }, () => Infinity)],
    ['NaN', Array.from({ length: 768 }, () => NaN)],
    ['string entries', Array.from({ length: 768 }, () => '0.5')],
    ['sparse', new Array(768)],
    ['zero', Array.from({ length: 768 }, () => 0)],
    ['sub-rounding-only', Array.from({ length: 768 }, () => 1e-12)],
    ['float32 overflow', Array.from({ length: 768 }, () => 1e100)],
  ])('rejects %s vectors without lexical or cloud fallback', async (_label, values) => {
    embeddingIo.fetch.mockResolvedValue(embedResponse(values));
    await expect(generateCitizenLocalQueryEmbedding('aide')).rejects.toThrow('LOCAL_QUERY_EMBEDDING_UNAVAILABLE');
    expect(embeddingIo.fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects HTTP failure without exposing the response body', async () => {
    const json = vi.fn();
    embeddingIo.fetch.mockResolvedValue({ ok: false, redirected: false, json });
    await expect(generateCitizenLocalQueryEmbedding('PRIVATE_QUERY')).rejects.toThrow('LOCAL_QUERY_EMBEDDING_UNAVAILABLE');
    expect(json).not.toHaveBeenCalled();
  });
  it('rejects a redirect response even with a permissive test transport', async () => {
    const response = embedResponse();
    response.redirected = true;
    embeddingIo.fetch.mockResolvedValue(response);
    await expect(generateCitizenLocalQueryEmbedding('aide')).rejects.toThrow('LOCAL_QUERY_EMBEDDING_UNAVAILABLE');
  });
  it('hides provider exception content and performs no retry', async () => {
    embeddingIo.fetch.mockRejectedValue(new Error('PRIVATE_QUERY_AND_TOKEN'));
    const error = await generateCitizenLocalQueryEmbedding('PRIVATE_QUERY').catch((value) => value);
    expect(error.message).toBe('LOCAL_QUERY_EMBEDDING_UNAVAILABLE');
    expect(embeddingIo.fetch).toHaveBeenCalledTimes(1);
  });
  it('does not start transport for an already aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(generateCitizenLocalQueryEmbedding('aide', { signal: controller.signal })).rejects.toThrow('LOCAL_QUERY_EMBEDDING_UNAVAILABLE');
    expect(embeddingIo.fetch).not.toHaveBeenCalled();
  });
  it('forwards caller abort to the transport', async () => {
    const controller = new AbortController();
    embeddingIo.fetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('PRIVATE_ABORT')), { once: true });
    }));
    const task = generateCitizenLocalQueryEmbedding('aide', { signal: controller.signal });
    controller.abort();
    await expect(task).rejects.toThrow('LOCAL_QUERY_EMBEDDING_UNAVAILABLE');
    expect(embeddingIo.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('aborts a hanging fetch at the bounded deadline', async () => {
    embeddingIo.fetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('PRIVATE_TIMEOUT')), { once: true });
    }));
    await expect(generateCitizenLocalQueryEmbedding('aide', { timeoutMs: 5 })).rejects.toThrow('LOCAL_QUERY_EMBEDDING_UNAVAILABLE');
    expect(embeddingIo.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
