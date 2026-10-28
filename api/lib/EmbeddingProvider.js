// @ts-nocheck
import { env } from '../_utils/env.js';
import { generateEmbeddings } from './gemini.js';
import { AIProviderPolicy, PROVIDER, LOCALITY, AUDIENCE } from './ai-policy.js';

export const CANONICAL_DIMENSION = 768;
export const MAX_INPUT_CHARS = 12000;

export function getActiveEmbeddingModel() {
  if (env.ai.embeddingProvider === 'ollama') {
    const policy = AIProviderPolicy.evaluate({ provider: PROVIDER.OLLAMA, audience: AUDIENCE.PUBLIC, locality: AIProviderPolicy.classifyLocality(env.ai.ollamaUrl || 'http://127.0.0.1:11434/api/embeddings') });
    if (policy.allowed) return env.ai.ollamaModel || 'nomic-embed-text';
  }
  if (env.ai.geminiKey) {
    const policy = AIProviderPolicy.evaluate({ provider: PROVIDER.GEMINI, audience: AUDIENCE.PUBLIC });
    if (policy.allowed) return 'gemini-embedding-001';
  }
  return null;
}

/**
 * @param {string} text
 */
function normalizeInput(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function truncateInput(/** @type {string} */ text, maxChars = MAX_INPUT_CHARS) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

async function generateOllamaEmbedding(/** @type {string | number | boolean | null | undefined} */ text, /** @type {string | number | boolean | null | undefined} */ outputDimensionality) {
  const OLLAMA_ENDPOINT = env.ai.ollamaUrl || 'http://127.0.0.1:11434/api/embeddings';
  const OLLAMA_MODEL = env.ai.ollamaModel || 'nomic-embed-text';

  const locality = AIProviderPolicy.classifyLocality(OLLAMA_ENDPOINT);
  const policy = AIProviderPolicy.evaluate({ 
    provider: PROVIDER.OLLAMA, 
    audience: AUDIENCE.PUBLIC, 
    locality 
  });

  if (!policy.allowed) {
    throw new Error(`AI_PROVIDER_NOT_ALLOWED_FOR_AUDIENCE: ${policy.reason}`);
  }

  try {
    const response = await fetch(OLLAMA_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: text
      }),
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed (${response.status})`);
    }

    const data = await response.json();
    const values = data?.embedding;
    if (!Array.isArray(values)) {
      throw new Error('Ollama response missing values');
    }
    
    return values;
  } catch (err) {
    throw new Error(`Ollama embedding failed: ${err.message}`);
  }
}

export function canUseEmbeddings() {
  return getActiveEmbeddingModel() !== null;
}

/**
 * @param {string} text
 */
export async function generateEmbedding(text, outputDimensionality = CANONICAL_DIMENSION) {
  if (outputDimensionality !== CANONICAL_DIMENSION) {
    throw new Error(`Incompatible dimension requested: ${outputDimensionality}. Index requires ${CANONICAL_DIMENSION}. Index migration required to change dimension.`);
  }

  const normalized = normalizeInput(text);
  if (!normalized) return null;
  const truncated = truncateInput(normalized);

  let rawValues = null;

  if (env.ai.embeddingProvider === 'ollama') {
    rawValues = await generateOllamaEmbedding(truncated, outputDimensionality);
  } else if (env.ai.geminiKey) {
    const policy = AIProviderPolicy.evaluate({ provider: PROVIDER.GEMINI, audience: AUDIENCE.PUBLIC });
    if (!policy.allowed) throw new Error(`AI_PROVIDER_NOT_ALLOWED_FOR_AUDIENCE: ${policy.reason}`);
    rawValues = await generateEmbeddings([truncated]).then(res => res[0]);
  }
  
  if (!rawValues) return null;
  if (!Array.isArray(rawValues)) throw new Error('Embedding vector is not an array');
  if (rawValues.length !== outputDimensionality) throw new Error(`Embedding dimension mismatch: expected ${outputDimensionality}, got ${rawValues.length}`);
  if (!rawValues.every(Number.isFinite)) throw new Error('Embedding vector contains invalid non-finite numbers');

  return rawValues;
}

/**
 * @param {string[]} texts
 */
export async function generateEmbeddingsBatch(texts, outputDimensionality = CANONICAL_DIMENSION) {
  if (env.ai.geminiKey) {
    const results = [];
    for (let i = 0; i < texts.length; i += 5) {
      const batch = texts.slice(i, i + 5);
      const batchPromises = batch.map(/** @type {string} */ (/** @type {string} */ t) => generateEmbedding(t, outputDimensionality));
      results.push(...await Promise.all(batchPromises));
    }
    return results;
  }
  return Promise.all(texts.map(/** @type {string} */ (/** @type {string} */ t) => generateEmbedding(t, outputDimensionality)));
}

export const DEFAULT_OUTPUT_DIMENSIONALITY = CANONICAL_DIMENSION;
