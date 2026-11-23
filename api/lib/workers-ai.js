// @ts-nocheck
/**
 * G14-AI (owner decision 23/11/2026: « Cloudflare Workers AI ücretsiz planı … 0 € maliyet ») — the citizen assistant's cloud provider, at 0 €.
 *
 *   REST  POST https://api.cloudflare.com/client/v4/accounts/{CF_WORKERS_AI_ACCOUNT_ID}/ai/run/{model}   (Bearer CF_WORKERS_AI_TOKEN)
 *   generation  @cf/mistralai/mistral-small-3.1-24b-instruct   (guided_json; the text is parsed and validated with zod, never trusted)
 *   embeddings  @cf/baai/bge-m3 (1024 dimensions)                (the semantic index of the aides, column "Aide".embedding_m3 — migration 0060)
 *
 * Cost control (Free plan: 10 000 neurons per day, UTC; over it Cloudflare refuses, it does not bill):
 *   - a server-side daily counter in Upstash KV (key ai:workers:neurons:<UTC date>) is RESERVED before every call with a pessimistic estimate and
 *     settled with the usage Cloudflare reports; a call that would pass the budget (AI_WORKERS_DAILY_NEURON_BUDGET, default 9 000, never above 9 500)
 *     is refused before any network request (DAILY_LIMIT);
 *   - Cloudflare's own daily-limit refusal (HTTP 429 / code 4006 / « daily free allocation ») marks the day exhausted and is returned as DAILY_LIMIT;
 *   - no retry (one request per citizen question; a failure is answered « temporarily unavailable »), a hard timeout, redirects refused;
 *   - in Production the counter must be the shared KV (an in-memory counter per instance would not bound anything): otherwise COUNTER_UNAVAILABLE.
 * Rates (developers.cloudflare.com/workers-ai/platform/pricing, 23/11/2026): mistral-small-3.1 31 876 neurons / M input tokens, 50 488 / M output;
 * bge-m3 1 075 / M input. Tokens are estimated at 1 per 3 characters before the call (French text is ~1 per 4: the estimate is pessimistic).
 *
 * What is sent: the question (identifiers masked, NIR / IBAN / card refused before) and extracts of VERIFIED public fiches — no account, no IP, no
 * identifier of the person. Nothing is stored by this module beyond the day's neuron count. The token never appears in an error, a log or a response.
 */
import { AIProviderPolicy, AUDIENCE, PROVIDER, workersAiState } from './ai-policy.js';

export const WORKERS_AI_MODELS = Object.freeze({
  generation: '@cf/mistralai/mistral-small-3.1-24b-instruct',
  embedding: '@cf/baai/bge-m3',
});
export const WORKERS_AI_EMBEDDING_DIMENSION = 1024;
/** neurons per million tokens */
export const NEURON_RATES = Object.freeze({
  [WORKERS_AI_MODELS.generation]: Object.freeze({ input: 31876, output: 50488 }),
  [WORKERS_AI_MODELS.embedding]: Object.freeze({ input: 1075, output: 0 }),
});
export const FREE_DAILY_NEURONS = 10000;
export const DEFAULT_DAILY_BUDGET = 9000;
const MAX_DAILY_BUDGET = 9500;
const API_BASE = 'https://api.cloudflare.com/client/v4/accounts';

/** the closed vocabulary of failures (never a provider text) */
export class WorkersAiError extends Error {
  /** @param {'DAILY_LIMIT'|'TIMEOUT'|'UNAVAILABLE'|'NOT_ALLOWED'|'COUNTER_UNAVAILABLE'|'INVALID_OUTPUT'} code */
  constructor(code) { super(`WORKERS_AI_${code}`); this.name = 'WorkersAiError'; this.code = code; }
}

/** @param {Record<string, string | undefined>} [envVars] */
export function dailyNeuronBudget(envVars = process.env) {
  const n = Number(String(envVars.AI_WORKERS_DAILY_NEURON_BUDGET ?? '').trim() || DEFAULT_DAILY_BUDGET);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), MAX_DAILY_BUDGET) : DEFAULT_DAILY_BUDGET;
}

/** @param {string} text */
export const estimateTokens = (text) => Math.ceil(String(text || '').length / 3);

/** @param {string} model @param {number} inputTokens @param {number} outputTokens */
export function neuronsFor(model, inputTokens, outputTokens = 0) {
  const r = NEURON_RATES[model];
  if (!r) throw new WorkersAiError('NOT_ALLOWED');
  return Math.ceil(((Math.max(0, inputTokens) * r.input) + (Math.max(0, outputTokens) * r.output)) / 1e6);
}

/** UTC day of Cloudflare's daily allocation @param {Date} [now] */
export const counterKey = (now = new Date()) => `ai:workers:neurons:${now.toISOString().slice(0, 10)}`;

/** @type {null | { incrby: (k: string, n: number) => Promise<number>, get: (k: string) => Promise<unknown>, set: Function, expire: Function, isRemote: boolean }} */
let counterStore = null;
/** tests inject a store; null restores the KV */
export function _setCounterStore(store) { counterStore = store; }
async function store() {
  if (counterStore) return counterStore;
  const { kv } = await import('../_utils/kv.js');   // lazy: no KV client is created by importing this module
  return kv;
}
const isProduction = (envVars = process.env) => ['production', 'preview'].includes(String(envVars.VERCEL_ENV || '').toLowerCase()) || envVars.NODE_ENV === 'production';

/**
 * Reserve `estimate` neurons of today's budget. Resolves to a ticket for settle(); throws DAILY_LIMIT (budget would be passed) or COUNTER_UNAVAILABLE.
 * @param {number} estimate @param {{ now?: Date, envVars?: Record<string, string | undefined> }} [opts]
 */
export async function reserveNeurons(estimate, { now = new Date(), envVars = process.env } = {}) {
  const amount = Math.max(1, Math.ceil(estimate));
  let s;
  try { s = await store(); } catch { throw new WorkersAiError('COUNTER_UNAVAILABLE'); }
  if (isProduction(envVars) && !s.isRemote) throw new WorkersAiError('COUNTER_UNAVAILABLE');
  const key = counterKey(now);
  let total;
  try {
    total = Number(await s.incrby(key, amount));
    await s.expire(key, 2 * 24 * 3600);
  } catch { throw new WorkersAiError('COUNTER_UNAVAILABLE'); }
  if (!Number.isFinite(total)) throw new WorkersAiError('COUNTER_UNAVAILABLE');
  if (total > dailyNeuronBudget(envVars)) {
    try { await s.incrby(key, -amount); } catch { /* the day stays counted higher: the safe failure */ }
    throw new WorkersAiError('DAILY_LIMIT');
  }
  return { key, reserved: amount };
}

/** replace the reservation by the measured cost (never below 0 net) @param {{ key: string, reserved: number }} ticket @param {number} actual */
export async function settleNeurons(ticket, actual) {
  const delta = Math.ceil(actual) - ticket.reserved;
  if (!delta) return;
  try { const s = await store(); await s.incrby(ticket.key, delta); } catch { /* best effort: the reservation (pessimistic) stays */ }
}

/** Cloudflare said the day's free allocation is used: no further call today @param {{ key: string }} ticket @param {Record<string, string | undefined>} [envVars] */
async function markExhausted(ticket, envVars = process.env) {
  try { const s = await store(); await s.set(ticket.key, FREE_DAILY_NEURONS + dailyNeuronBudget(envVars), { ex: 2 * 24 * 3600 }); } catch { /* best effort */ }
}

/** today's state, for the operator (counts only) */
export async function dailyUsage({ now = new Date(), envVars = process.env } = {}) {
  const s = await store();
  const used = Number(await s.get(counterKey(now))) || 0;
  return { used, budget: dailyNeuronBudget(envVars), remaining: Math.max(0, dailyNeuronBudget(envVars) - used) };
}

/** @param {number} status @param {any} body */
export function isDailyLimitResponse(status, body) {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  return status === 429 || errors.some((e) => Number(e?.code) === 4006 || /daily free allocation|neurons/i.test(String(e?.message || '')));
}

/**
 * One request to the Workers AI REST API — policy-checked, budget-reserved, bounded, never retried.
 * @param {{ model: string, body: Record<string, unknown>, estimate: number, timeoutMs?: number, fetchImpl?: typeof fetch, envVars?: Record<string, string | undefined>, signal?: AbortSignal }} p
 * @returns {Promise<{ result: any, ticket: { key: string, reserved: number } }>}
 */
export async function runWorkersAi({ model, body, estimate, timeoutMs = 20000, fetchImpl = fetch, envVars = process.env, signal }) {
  if (!Object.values(WORKERS_AI_MODELS).includes(model)) throw new WorkersAiError('NOT_ALLOWED');
  const policy = AIProviderPolicy.evaluate({ provider: PROVIDER.WORKERS_AI, audience: AUDIENCE.CITIZEN, env: envVars });
  if (!policy.allowed) throw new WorkersAiError('NOT_ALLOWED');
  const ticket = await reserveNeurons(estimate, { envVars });
  const account = String(envVars.CF_WORKERS_AI_ACCOUNT_ID).trim().toLowerCase();
  const url = `${API_BASE}/${account}/ai/run/${model}`;
  const bounded = Math.min(Math.max(1000, Number(timeoutMs) || 20000), 30000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), bounded);
  timer.unref?.();
  const forward = () => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener?.('abort', forward, { once: true });
  let res; let data = null;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${String(envVars.CF_WORKERS_AI_TOKEN).trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: controller.signal,
    });
    data = await res.json().catch(() => null);
  } catch {
    await settleNeurons(ticket, ticket.reserved);   // the request may have run: keep the pessimistic reservation
    throw new WorkersAiError(controller.signal.aborted ? 'TIMEOUT' : 'UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', forward);
  }
  if (!res.ok || data?.success === false) {
    if (isDailyLimitResponse(res.status, data)) { await markExhausted(ticket, envVars); throw new WorkersAiError('DAILY_LIMIT'); }
    await settleNeurons(ticket, 0);   // refused before inference: nothing consumed
    throw new WorkersAiError('UNAVAILABLE');
  }
  return { result: data?.result, ticket };
}

/** the first JSON object of a model text (the model may wrap it in a code fence) @param {unknown} response */
export function parseJsonResponse(response) {
  if (response && typeof response === 'object') return response;
  const text = String(response ?? '').trim();
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

/**
 * Citizen structured generation (mistral-small-3.1). Returns the same shape as ai-foundation's wrapOutput (content | safeErrorState), never throws.
 * @param {{ prompt: string, systemInstruction: string, zodSchema: import('zod').ZodType, jsonSchema?: object, maxTokens?: number, timeoutMs?: number, fetchImpl?: typeof fetch, envVars?: Record<string, string | undefined>, signal?: AbortSignal }} p
 */
export async function generateCitizenWorkersStructuredContent({ prompt, systemInstruction, zodSchema, jsonSchema, maxTokens = 600, timeoutMs = 20000, fetchImpl, envVars = process.env, signal }) {
  const model = WORKERS_AI_MODELS.generation;
  const started = Date.now();
  const out = (content, extra = {}) => ({ content, provider: 'workers_ai', model, latency: Date.now() - started, usage: extra.usage || { promptTokens: 0, completionTokens: 0 }, safeErrorState: extra.safeErrorState || null, citations: [], abstention: false });
  const maxOut = Math.min(Math.max(64, maxTokens), 1024);
  const inputTokens = estimateTokens(systemInstruction) + estimateTokens(prompt) + 16;
  try {
    const { result, ticket } = await runWorkersAi({
      model,
      body: {
        messages: [{ role: 'system', content: systemInstruction }, { role: 'user', content: prompt }],
        max_tokens: maxOut, temperature: 0.1,
        ...(jsonSchema ? { guided_json: jsonSchema } : {}),
      },
      estimate: neuronsFor(model, inputTokens, maxOut),
      timeoutMs, fetchImpl, envVars, signal,
    });
    const promptTokens = Number(result?.usage?.prompt_tokens) || inputTokens;
    const completionTokens = Number(result?.usage?.completion_tokens) || estimateTokens(typeof result?.response === 'string' ? result.response : JSON.stringify(result?.response ?? ''));
    await settleNeurons(ticket, neuronsFor(model, promptTokens, completionTokens));
    const usage = { promptTokens, completionTokens };
    const parsed = parseJsonResponse(result?.response);
    const valid = parsed && zodSchema ? zodSchema.safeParse(parsed) : { success: false };
    if (!valid.success) return out(null, { usage, safeErrorState: 'INVALID_OUTPUT' });
    return out(valid.data, { usage });
  } catch (e) {
    return out(null, { safeErrorState: e instanceof WorkersAiError ? e.code : 'UNAVAILABLE' });
  }
}

/**
 * bge-m3 embeddings (1024 dimensions) of 1..32 texts, each ≤ 8 000 characters. Throws WorkersAiError.
 * @param {string[]} texts @param {{ timeoutMs?: number, fetchImpl?: typeof fetch, envVars?: Record<string, string | undefined>, signal?: AbortSignal }} [opts]
 * @returns {Promise<number[][]>}
 */
export async function workersAiEmbed(texts, { timeoutMs = 10000, fetchImpl, envVars = process.env, signal } = {}) {
  const list = (Array.isArray(texts) ? texts : []).map((t) => String(t ?? '').replace(/\s+/g, ' ').trim());
  if (!list.length || list.length > 32 || list.some((t) => !t || t.length > 8000)) throw new WorkersAiError('NOT_ALLOWED');
  const model = WORKERS_AI_MODELS.embedding;
  const inputTokens = list.reduce((n, t) => n + estimateTokens(t), 0);
  const { result, ticket } = await runWorkersAi({ model, body: { text: list }, estimate: neuronsFor(model, inputTokens), timeoutMs, fetchImpl, envVars, signal });
  await settleNeurons(ticket, neuronsFor(model, inputTokens));
  const vectors = Array.isArray(result?.data) ? result.data : Array.isArray(result?.response) ? result.response : null;
  if (!vectors || vectors.length !== list.length) throw new WorkersAiError('INVALID_OUTPUT');
  for (const v of vectors) {
    if (!Array.isArray(v) || v.length !== WORKERS_AI_EMBEDDING_DIMENSION || !v.every((x) => typeof x === 'number' && Number.isFinite(x)) || !v.some((x) => Math.abs(x) >= 1e-8)) {
      throw new WorkersAiError('INVALID_OUTPUT');
    }
  }
  return vectors.map((v) => Array.from(v));
}

/** the citizen query vector, or null (the assistant then ranks lexically: an embedding failure never blocks an answer) @param {string} text */
export async function generateCitizenWorkersQueryEmbedding(text, opts = {}) {
  if (typeof text !== 'string' || !text.trim() || text.length > 800) return null;
  try {
    const [embedding] = await workersAiEmbed([text], { timeoutMs: 5000, ...opts });
    return { embedding, embeddingModel: WORKERS_AI_MODELS.embedding };
  } catch { return null; }
}

/** which provider the citizen assistant uses in this environment: 'workers_ai' when fully enabled, else the local Ollama path @param {Record<string, string | undefined>} [envVars] */
export function citizenAssistantProvider(envVars = process.env) {
  return workersAiState(envVars).enabled ? 'workers_ai' : 'ollama';
}
