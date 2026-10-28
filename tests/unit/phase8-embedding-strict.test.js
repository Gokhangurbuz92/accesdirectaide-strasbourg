import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/_utils/env.js', () => ({
  env: {
    ai: {
      embeddingProvider: 'ollama',
      ollamaUrl: 'http://127.0.0.1:11434/api/embeddings',
      ollamaModel: 'nomic-embed-text'
    },
    runtime: { vercelEnv: 'test', logLevel: 'info' },
    sentry: { release: 'test' }
  }
}));

import { generateEmbedding } from '../../api/lib/EmbeddingProvider.js';

describe('EmbeddingProvider Strict Validation', () => {
  // Justification for modification: The original test relied on 'gemini' as the embeddingProvider.
  // The new AIProviderPolicy explicitly supersedes this by blocking Gemini for public/citizen embeddings.
  // The test has been updated to use the permitted 'ollama' provider, while keeping all original
  // vector safety and dimensional assertions completely intact.

  it('accepts valid 768 vector', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: Array(768).fill(0.5) })
    });

    const result = await generateEmbedding('test text');
    expect(result.length).toBe(768);
  });

  it('rejects short vector', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: Array(767).fill(0.5) })
    });

    await expect(generateEmbedding('test text')).rejects.toThrow('Embedding dimension mismatch');
  });

  it('rejects long vector', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: Array(769).fill(0.5) })
    });

    await expect(generateEmbedding('test text')).rejects.toThrow('Embedding dimension mismatch');
  });

  it('rejects NaN values', async () => {
    const badVector = Array(768).fill(0.5);
    badVector[10] = NaN;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: badVector })
    });

    await expect(generateEmbedding('test text')).rejects.toThrow('Embedding vector contains invalid non-finite numbers');
  });
});
