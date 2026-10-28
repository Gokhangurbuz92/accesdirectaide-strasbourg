// @ts-nocheck
import { z } from 'zod';
import { GeminiProvider, OllamaProvider } from './ai-provider.js';
import { AIProviderPolicy, PROVIDER, AUDIENCE, LOCALITY } from './ai-policy.js';
import * as crypto from 'crypto';

const providers = {
  gemini: new GeminiProvider(process.env.GEMINI_API_KEY),
  ollama: new OllamaProvider(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434')
};

// ... wrapOutput and executeProviderLoop remain ...
function wrapOutput(content, meta) {
  return {
    content,
    citations: meta.citations || [],
    confidence: meta.confidence || null,
    abstention: meta.abstention || false,
    toolUsed: meta.toolUsed || null,
    provider: meta.provider,
    model: meta.model,
    latency: meta.latency,
    usage: meta.usage || { promptTokens: 0, completionTokens: 0 },
    executionId: crypto.randomUUID(),
    humanApprovalRequired: meta.humanApprovalRequired || false,
    safeErrorState: meta.safeErrorState || null
  };
}

// @ts-ignore
async function executeProviderLoop(/** @type {string | number | boolean | null | undefined} */ providerName, provider, /** @type {string | number | boolean | null | undefined} */ model, messages, /** @type {unknown} */ jsonSchema, zodSchema, tools, mappedTools, /** @type {string | number | boolean | null | undefined} */ signal, /** @type {{ options?: Record<string, unknown>, timeoutMs?: number }} */ providerOptions = {}) {
  // background local generation (generateBackgroundLocalStructuredContent): context size, temperature and the provider's own time bound
  const extra = { ...(providerOptions.options ? { options: providerOptions.options } : {}), ...(providerOptions.timeoutMs ? { timeoutMs: providerOptions.timeoutMs } : {}) };
  const startTime = Date.now();
  let toolUsedObj = null;
  let usage = { promptTokens: 0, completionTokens: 0 };
  
  let currentMessages = [...messages];

  if (mappedTools && mappedTools.length > 0) {
    const stage1Response = await provider.generateStructured({
      messages: currentMessages,
      schema: undefined,
      model,
      tools: mappedTools,
      signal,
      ...extra
    });
    
    if (stage1Response.usage) {
      usage.promptTokens += stage1Response.usage.promptTokens || 0;
      usage.completionTokens += stage1Response.usage.completionTokens || 0;
    }

    if (stage1Response.toolCalls && stage1Response.toolCalls.length > 0) {
      const tc = stage1Response.toolCalls[0];
      const toolDef = tools.find(t => t.name === tc.name);
      
      if (!toolDef) throw new Error(`Model selected unknown tool: ${tc.name}`);
      if (!toolDef.isReadOnly) throw new Error(`Tool ${tc.name} is not read-only. Consequential writes blocked in foundation loop.`);
      
      let validatedArgs;
      try {
        const rawArgs = typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments;
        validatedArgs = toolDef.parameters.parse(rawArgs);
      } catch (e) {
        throw new Error(`Invalid arguments for tool ${tc.name}: ${e.message}`);
      }
      
      const toolResult = await toolDef.execute(validatedArgs);
      toolUsedObj = { name: tc.name, arguments: validatedArgs, result: toolResult };
      
      if (stage1Response.message) currentMessages.push(stage1Response.message);
      else currentMessages.push({ role: 'assistant', content: '', tool_calls: [{ function: tc }] });
      
      currentMessages.push({ role: 'tool', content: JSON.stringify(toolResult), name: tc.name });
    } else {
      if (stage1Response.message) currentMessages.push(stage1Response.message);
      else if (stage1Response.content) currentMessages.push({ role: 'assistant', content: stage1Response.content });
      currentMessages.push({ role: 'user', content: 'Veuillez maintenant formater votre réponse finale strictement selon le format JSON demandé.' });
    }
  }

  const stage2Response = await provider.generateStructured({
    messages: currentMessages,
    schema: jsonSchema,
    model,
    tools: [],
    signal,
    ...extra
  });
  
  if (stage2Response.usage) {
    usage.promptTokens += stage2Response.usage.promptTokens || 0;
    usage.completionTokens += stage2Response.usage.completionTokens || 0;
  }

  let validatedContent = null;
  if (stage2Response.content && zodSchema) {
     validatedContent = zodSchema.parse(stage2Response.content);
  }
  
  return { content: validatedContent, toolUsed: toolUsedObj, usage, latency: Date.now() - startTime };
}

/**
 * R13 (D17 / D23): the JSON Schema the model is constrained with. zod-to-json-schema 3.x reads zod 3 internals; with zod 4 (this project) it returned an EMPTY
 * schema (`{ $ref: '#/definitions/target', definitions: { target: {} } }`), so Ollama received no constraint and qwen3:8b answered free text or « -1.0 » —
 * every citizen question then ended in « service indisponible » (found in the LAB, 26/10). zod 4 builds the schema itself.
 * @param {import('zod').ZodType} schema
 */
export function providerJsonSchema(schema) {
  const { $schema, ...jsonSchema } = z.toJSONSchema(schema);   // Ollama's `format` takes the schema object; the draft marker is not needed
  return jsonSchema;
}

export async function generateStructuredContent({
  prompt,
  systemInstruction,
  zodSchema,
  tools = [],
  primaryProvider,
  fallbackProvider = process.env.AI_FALLBACK_PROVIDER,
  allowFallback = true,
  model = process.env.AI_PRIMARY_MODEL,
  fallbackModel = process.env.AI_FALLBACK_MODEL,
  audience = AUDIENCE.PROFESSIONAL,
  signal,
  providerOptions = {}
}) {
  let resolvedPrimary = primaryProvider || process.env.AI_PRIMARY_PROVIDER;
  if (!resolvedPrimary) {
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      resolvedPrimary = 'ollama';
    } else {
      throw new Error("AI_PRIMARY_PROVIDER must be explicitly configured in production");
    }
  }

  const checkPolicy = (/** @type {string} */ providerName) => {
    let locality = LOCALITY.UNKNOWN;
    if (providerName.toUpperCase() === PROVIDER.OLLAMA) {
      locality = AIProviderPolicy.classifyLocality(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
    }
    const policy = AIProviderPolicy.evaluate({
      provider: providerName.toUpperCase(),
      audience,
      locality
    });
    if (!policy.allowed) {
      throw new Error(`AI_PROVIDER_NOT_ALLOWED_FOR_AUDIENCE: ${policy.reason}`);
    }
  };

  let resolvedModel = model;
  if (!resolvedModel) {
    if (resolvedPrimary === 'ollama') resolvedModel = 'qwen3:8b';
    else if (resolvedPrimary === 'gemini') resolvedModel = 'gemini-1.5-flash';
    else throw new Error("AI_PRIMARY_MODEL must be configured");
  }

  const jsonSchema = zodSchema ? providerJsonSchema(zodSchema) : undefined;
  const mappedTools = tools.map(t => ({ name: t.name, description: t.description, parameters: providerJsonSchema(t.parameters) }));

  let messages = [];
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
  messages.push({ role: 'user', content: prompt });

  try {
    checkPolicy(resolvedPrimary);
    const provider = providers[resolvedPrimary];
    if (!provider) throw new Error(`Unknown provider: ${resolvedPrimary}`);
    
    const result = await executeProviderLoop(resolvedPrimary, provider, resolvedModel, messages, jsonSchema, zodSchema, tools, mappedTools, signal, providerOptions);
    return wrapOutput(result.content, { provider: resolvedPrimary, model: resolvedModel, latency: result.latency, usage: result.usage, toolUsed: result.toolUsed });
  } catch (error) {
    if (allowFallback && fallbackProvider && providers[fallbackProvider]) {
      try {
        checkPolicy(fallbackProvider);
        console.warn(`Primary provider ${resolvedPrimary} failed. Falling back to ${fallbackProvider}. Error: ${error.message}`);
        let resFallbackModel = fallbackModel;
        if (!resFallbackModel) {
           if (fallbackProvider === 'gemini') resFallbackModel = 'gemini-1.5-flash';
           else if (fallbackProvider === 'ollama') resFallbackModel = 'qwen3:8b';
        }
        const fallback = providers[fallbackProvider];
        const result = await executeProviderLoop(fallbackProvider, fallback, resFallbackModel, messages, jsonSchema, zodSchema, tools, mappedTools, signal, providerOptions);
        return wrapOutput(result.content, { provider: fallbackProvider, model: resFallbackModel, latency: result.latency, usage: result.usage, toolUsed: result.toolUsed });
      } catch (fallbackError) {
         return wrapOutput(null, { provider: fallbackProvider, model: fallbackModel, latency: 0, safeErrorState: "UNAVAILABLE" });
      }
    }
    
    return wrapOutput(null, { provider: resolvedPrimary, model: resolvedModel, latency: 0, safeErrorState: "UNAVAILABLE" });
  }
}

/**
 * Citizen-facing local-only generation path.
 * Hard requirements: loopback Ollama, qwen3:8b, max 30s, no cloud fallback.
 */
export async function generateCitizenLocalStructuredContent({
  prompt,
  systemInstruction,
  zodSchema,
  tools = [],
  signal,
  timeoutMs = 30000,
}) {
  const endpoint = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const locality = AIProviderPolicy.classifyLocality(endpoint);
  if (locality !== LOCALITY.LOCAL_LOOPBACK) {
    return wrapOutput(null, {
      provider: 'ollama',
      model: 'qwen3:8b',
      latency: 0,
      safeErrorState: 'LOCAL_PROVIDER_REQUIRED',
    });
  }

  const boundedTimeout = Number.isFinite(timeoutMs)
    ? Math.min(Math.max(1, Number(timeoutMs)), 30000)
    : 30000;
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener?.('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('OLLAMA_TIMEOUT')), boundedTimeout);
  timer.unref?.();

  try {
    return await generateStructuredContent({
      prompt,
      systemInstruction,
      zodSchema,
      tools,
      primaryProvider: 'ollama',
      fallbackProvider: null,
      allowFallback: false,
      model: 'qwen3:8b',
      audience: AUDIENCE.CITIZEN,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', forwardAbort);
  }
}

/**
 * Background local-only generation (automatic verification chain, api/_services/verification/texts.js): the same hard rules as the citizen path — loopback Ollama,
 * qwen3:8b, no cloud fallback — but no user is waiting: the bound is minutes, not 30 s (max 300 s), and the context is large enough for a whole official fiche.
 * Its output is never published as such: the caller checks it (numbers, sentence length, faithfulness) and keeps the previous text when it fails.
 */
export async function generateBackgroundLocalStructuredContent({
  prompt,
  systemInstruction,
  zodSchema,
  signal,
  timeoutMs = 180000,
  options = {},
}) {
  const endpoint = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const locality = AIProviderPolicy.classifyLocality(endpoint);
  if (locality !== LOCALITY.LOCAL_LOOPBACK) {
    return wrapOutput(null, { provider: 'ollama', model: 'qwen3:8b', latency: 0, safeErrorState: 'LOCAL_PROVIDER_REQUIRED' });
  }
  const bounded = Number.isFinite(timeoutMs) ? Math.min(Math.max(1000, Number(timeoutMs)), 300000) : 180000;
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener?.('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('OLLAMA_TIMEOUT')), bounded);
  timer.unref?.();
  try {
    return await generateStructuredContent({
      prompt,
      systemInstruction,
      zodSchema,
      primaryProvider: 'ollama',
      fallbackProvider: null,
      allowFallback: false,
      model: 'qwen3:8b',
      audience: AUDIENCE.CITIZEN,
      signal: controller.signal,
      providerOptions: { options: { num_ctx: 12288, temperature: 0.2, ...options }, timeoutMs: bounded },
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', forwardAbort);
  }
}

/**
 * Citizen query-vector boundary. The general EmbeddingProvider is read-only in
 * WS4 and can select a cloud backend; this route never delegates to that path.
 * Uses the same local /api/embeddings payload, model and whitespace normalization
 * as the captured provider. Does not download models or change process.env.
 */
export async function generateCitizenLocalQueryEmbedding(/** @type {unknown} */ text, { signal, timeoutMs = 5000 } = {}) {
  const unavailable = () => new Error('LOCAL_QUERY_EMBEDDING_UNAVAILABLE');
  if (typeof text !== 'string' || text.length > 800) throw unavailable();
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized || signal?.aborted) throw unavailable();
  if (process.env.AI_EMBEDDING_PROVIDER && process.env.AI_EMBEDDING_PROVIDER !== 'ollama') throw unavailable();
  if (process.env.OLLAMA_MODEL && process.env.OLLAMA_MODEL !== 'nomic-embed-text') throw unavailable();

  let endpoint;
  try {
    endpoint = process.env.OLLAMA_URL
      ? new URL(process.env.OLLAMA_URL)
      : new URL('/api/embeddings', process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
    if (!['http:', 'https:'].includes(endpoint.protocol)
      || !['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname)
      || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || endpoint.pathname !== '/api/embeddings') throw unavailable();
    // Avoid DNS-dependent interpretation of localhost for this citizen request.
    if (endpoint.hostname === 'localhost') endpoint.hostname = '127.0.0.1';
    const policy = AIProviderPolicy.evaluate({
      provider: PROVIDER.OLLAMA, audience: AUDIENCE.CITIZEN, locality: LOCALITY.LOCAL_LOOPBACK,
    });
    if (!policy.allowed) throw unavailable();
  } catch {
    throw unavailable();
  }

  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  signal?.addEventListener?.('abort', forwardAbort, { once: true });
  const boundedTimeout = Number.isFinite(timeoutMs) ? Math.min(Math.max(timeoutMs, 1), 5000) : 5000;
  const timer = setTimeout(() => controller.abort(), boundedTimeout);
  timer.unref?.();
  try {
    if (signal?.aborted) throw unavailable();
    const response = await fetch(endpoint.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', prompt: normalized }),
      redirect: 'error',
      credentials: 'omit',
      signal: controller.signal,
    });
    if (!response.ok || response.redirected || controller.signal.aborted) throw unavailable();
    const data = await response.json();
    if (controller.signal.aborted || !Array.isArray(data?.embedding) || data.embedding.length !== 768) throw unavailable();
    // Array.from also exposes sparse slots; .every on the original would skip them.
    const embedding = Array.from(data.embedding);
    if (!embedding.every((value) => typeof value === 'number' && Number.isFinite(value)
      && Math.abs(value) <= 3.4028234663852886e38)
      || !embedding.some((value) => Math.abs(value) >= 1e-8)) throw unavailable();
    return { embedding, embeddingModel: 'nomic-embed-text' };
  } catch {
    // No provider body, citizen query, URL credentials or exception message escapes.
    throw unavailable();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', forwardAbort);
  }
}
