// @ts-nocheck
/**
 * G14 (owner 23/11/2026: « OpenFisca için Scaleway ücretsiz kotasını kota kilidiyle … 0 € maliyet ») — monthly usage guard of the self-hosted OpenFisca
 * engine (Scaleway Serverless Container, fr-par, min-scale 0, max-scale 1; ops/openfisca/deploy_scaleway.mjs).
 *
 * Scaleway gives no spending cap. Its free tier is per account and per month: 400 000 GB-s of memory and 200 000 vCPU-s (pricing page, verified
 * 23/11/2026). A container is billed « memory tier × run duration » and « vCPU tier × run duration »; with min-scale 0 an instance is stopped only after
 * 15 minutes without a request (Scaleway docs, containers-autoscaling). So the guard counts WALL TIME, conservatively:
 *   - a call while no instance is alive opens a burst: cold-start allowance + the call's maximum duration + the 15-minute idle window;
 *   - a call while the instance is alive only extends the window to « now + call + 15 min » (the part not already counted);
 *   - GB = memory MB / 1000 (a larger figure than / 1024: conservative).
 * Each call is charged BEFORE the engine is contacted; when the charge would pass OPENFISCA_QUOTA_RATIO (≤ 0.8, default 0.8) of either free-tier
 * allowance, it is refused and nothing is recorded: the diagnostic answers its « simulation unavailable » path (OPENFISCA_QUOTA_REACHED).
 *
 * Store: Upstash KV (KV_REST_API_URL / KV_REST_API_TOKEN), one hash per UTC month, updated atomically by a Lua script (same arithmetic as chargeCall()).
 * Without KV: an in-memory counter outside production (LAB); in production the guard FAILS CLOSED (no KV = no proof of 0 € = no call). A KV error or
 * timeout also refuses the call. Off only for a loopback engine (LAB) or OPENFISCA_QUOTA_GUARD=off outside production.
 */
import { Redis } from '@upstash/redis';

export const FREE_TIER = Object.freeze({ gbSeconds: 400_000, vcpuSeconds: 200_000 });
export const MAX_RATIO = 0.8;
/** Scaleway: « Scaling down to zero (if min-scale is set to 0) happens after 15 minutes of inactivity. » */
export const IDLE_MS = 15 * 60_000;
/** allowance for one cold start (measured locally ~9–11 s of CPU at one core; at 0.56 vCPU about 20 s; doubled + margin) */
export const COLD_START_MS = 60_000;
export const DEFAULT_MEMORY_MB = 1024;
export const DEFAULT_MVCPU = 560;
export const KEY_PREFIX = 'openfisca:quota:';
const KV_BOUND_MS = 3000;

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const loopback = (url) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(url);

/** @param {NodeJS.ProcessEnv} env */
export function quotaConfig(env = process.env) {
  const production = env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
  const url = String(env.OPENFISCA_URL || env.OPENFISCA_API_URL || '').trim();
  const off = String(env.OPENFISCA_QUOTA_GUARD || '').trim().toLowerCase() === 'off';
  // no engine configured = no call to count; Production: always on (OPENFISCA_QUOTA_GUARD=off ignored); LAB: off for a loopback engine or on request
  const enabled = Boolean(url) && (production || (!loopback(url) && !off));
  const ratio = Math.min(num(env.OPENFISCA_QUOTA_RATIO, MAX_RATIO), MAX_RATIO);
  const memoryMb = num(env.OPENFISCA_CONTAINER_MEMORY_MB, DEFAULT_MEMORY_MB);
  const mvcpu = num(env.OPENFISCA_CONTAINER_MVCPU, DEFAULT_MVCPU);
  const timeoutMs = Math.min(Math.max(num(env.OPENFISCA_TIMEOUT_MS, 5000), 1000), 60_000);
  const healthMs = Math.min(Math.max(num(env.OPENFISCA_HEALTH_TIMEOUT_MS, 2000), 1000), 60_000);
  return {
    enabled, production, ratio, memoryMb, mvcpu,
    gb: memoryMb / 1000, vcpu: mvcpu / 1000,
    /** one diagnostic = a health probe + a calculation, each bounded by its timeout */
    callMs: timeoutMs + healthMs,
    idleMs: IDLE_MS, coldMs: COLD_START_MS,
    limits: { gbSeconds: FREE_TIER.gbSeconds * ratio, vcpuSeconds: FREE_TIER.vcpuSeconds * ratio },
  };
}

/** UTC month key (Scaleway bills per calendar month) */
export const monthKey = (nowMs) => `${KEY_PREFIX}${new Date(nowMs).toISOString().slice(0, 7)}`;

export const usageOf = (billedMs, cfg) => ({ gbSeconds: (billedMs / 1000) * cfg.gb, vcpuSeconds: (billedMs / 1000) * cfg.vcpu });

/**
 * PURE: charge one call at nowMs on the month state. Returns the new state when allowed, the unchanged state when refused.
 * @param {{ aliveUntil: number, billedMs: number }} state @param {number} nowMs @param {ReturnType<typeof quotaConfig>} cfg
 */
export function chargeCall(state, nowMs, cfg) {
  const aliveUntil = Number(state?.aliveUntil) || 0; const billed = Number(state?.billedMs) || 0;
  const end = nowMs + cfg.callMs + cfg.idleMs;
  const add = nowMs >= aliveUntil ? cfg.coldMs + cfg.callMs + cfg.idleMs : Math.max(0, end - aliveUntil);
  const next = billed + add;
  const usage = usageOf(next, cfg);
  const allowed = usage.gbSeconds <= cfg.limits.gbSeconds && usage.vcpuSeconds <= cfg.limits.vcpuSeconds;
  return allowed
    ? { allowed: true, state: { aliveUntil: Math.max(aliveUntil, end), billedMs: next }, usage, addedMs: add }
    : { allowed: false, state: { aliveUntil, billedMs: billed }, usage: usageOf(billed, cfg), addedMs: 0 };
}

/** the same arithmetic as chargeCall(), atomic in Redis. ARGV: now, callMs, idleMs, coldMs, gb, vcpu, limitGb, limitVcpu, ttlSeconds */
export const LUA_CHARGE = `
local au = tonumber(redis.call('HGET', KEYS[1], 'aliveUntil') or '0')
local billed = tonumber(redis.call('HGET', KEYS[1], 'billedMs') or '0')
local now = tonumber(ARGV[1]); local callMs = tonumber(ARGV[2]); local idleMs = tonumber(ARGV[3]); local coldMs = tonumber(ARGV[4])
local gb = tonumber(ARGV[5]); local vcpu = tonumber(ARGV[6]); local limGb = tonumber(ARGV[7]); local limVcpu = tonumber(ARGV[8])
local finish = now + callMs + idleMs
local add
if now >= au then add = coldMs + callMs + idleMs else add = math.max(0, finish - au) end
local nextBilled = billed + add
if (nextBilled / 1000) * gb > limGb or (nextBilled / 1000) * vcpu > limVcpu then return {0, tostring(billed)} end
redis.call('HSET', KEYS[1], 'aliveUntil', tostring(math.max(au, finish)), 'billedMs', tostring(nextBilled))
redis.call('HINCRBY', KEYS[1], 'calls', 1)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[9]))
return {1, tostring(nextBilled)}
`;

/* ── stores ─────────────────────────────────────────────── */
const memory = new Map();
/** in-memory store (LAB / tests) */
export const memoryStore = {
  async charge(key, nowMs, cfg) {
    const r = chargeCall(memory.get(key), nowMs, cfg);
    if (r.allowed) memory.set(key, r.state);
    return { allowed: r.allowed, billedMs: r.state.billedMs };
  },
  async read(key) { return memory.get(key) || { aliveUntil: 0, billedMs: 0 }; },
};
export const _resetMemoryStore = () => memory.clear();

let redis = null;
function redisStore(env) {
  if (!env.KV_REST_API_URL || !env.KV_REST_API_TOKEN) return null;
  redis ??= new Redis({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN });
  return {
    async charge(key, nowMs, cfg) {
      const out = await redis.eval(LUA_CHARGE, [key], [String(nowMs), String(cfg.callMs), String(cfg.idleMs), String(cfg.coldMs), String(cfg.gb), String(cfg.vcpu),
        String(cfg.limits.gbSeconds), String(cfg.limits.vcpuSeconds), String(40 * 86400)]);
      return { allowed: Number(out?.[0]) === 1, billedMs: Number(out?.[1]) || 0 };
    },
    async read(key) { const h = (await redis.hgetall(key)) || {}; return { aliveUntil: Number(h.aliveUntil) || 0, billedMs: Number(h.billedMs) || 0, calls: Number(h.calls) || 0 }; },
  };
}

const bounded = (p) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('kv timeout')), KV_BOUND_MS); })]).finally(() => clearTimeout(t)); };

/**
 * Charge one engine call. Never throws.
 * @returns {Promise<{ allowed: boolean, code: string, usage?: { gbSeconds: number, vcpuSeconds: number } }>}
 *   code: OPENFISCA_QUOTA_OFF | OPENFISCA_QUOTA_OK | OPENFISCA_QUOTA_REACHED | OPENFISCA_QUOTA_STORE_UNAVAILABLE
 */
export async function reserveOpenfiscaCall({ env = process.env, now = Date.now(), store } = {}) {
  const cfg = quotaConfig(env);
  if (!cfg.enabled) return { allowed: true, code: 'OPENFISCA_QUOTA_OFF' };
  const s = store || redisStore(env) || (cfg.production ? null : memoryStore);
  if (!s) return { allowed: false, code: 'OPENFISCA_QUOTA_STORE_UNAVAILABLE' };
  try {
    const r = await bounded(s.charge(monthKey(now), now, cfg));
    return { allowed: r.allowed, code: r.allowed ? 'OPENFISCA_QUOTA_OK' : 'OPENFISCA_QUOTA_REACHED', usage: usageOf(r.billedMs, cfg) };
  } catch {
    return { allowed: false, code: 'OPENFISCA_QUOTA_STORE_UNAVAILABLE' };
  }
}

/** capacity under the guard (report / admin): isolated bursts and continuous alive hours per month */
export function monthlyCapacity(cfg = quotaConfig({ OPENFISCA_URL: 'https://x.example', OPENFISCA_TIMEOUT_MS: '30000', OPENFISCA_HEALTH_TIMEOUT_MS: '25000' })) {
  const burstMs = cfg.coldMs + cfg.callMs + cfg.idleMs;
  const aliveSeconds = Math.min(cfg.limits.gbSeconds / cfg.gb, cfg.limits.vcpuSeconds / cfg.vcpu);
  return { isolatedBursts: Math.floor((aliveSeconds * 1000) / burstMs), aliveHours: Math.round((aliveSeconds / 3600) * 10) / 10, burstSeconds: burstMs / 1000 };
}

/** French message of the refusal (the interface translates by the code OPENFISCA_QUOTA_REACHED, namespace diagnostic) */
export const QUOTA_MESSAGE_FR = 'Le calcul indicatif est suspendu jusqu’au début du mois prochain : la limite mensuelle d’utilisation du service de calcul est atteinte. Aucun résultat de remplacement n’est affiché. Vous pouvez demander conseil à un professionnel.';
