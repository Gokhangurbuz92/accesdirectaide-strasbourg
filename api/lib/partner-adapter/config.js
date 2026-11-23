// @ts-check
/**
 * FA-D7 — partner referral adapter: configuration and outbound transport (no database).
 *
 * Configuration (names only; NO partner is configured anywhere — the adapter is a LAB engineering artefact until the owner signs an agreement with a
 * real organization and opens the capability):
 *   ADA_PARTNER_ADAPTERS   JSON array, one entry per connected receiving organization:
 *                          [{ "id": "lab-partner", "structureId": "<ADA Structure id>", "endpoint": "https://partner.example/ada-events",
 *                             "delegateProUserId": "<ProUser id of an active member of that structure>" }]
 *                          `delegateProUserId` is the accountable human: every inbound step is recorded as THAT member's act (ReferralEvent.actorId) and
 *                          is refused when the account is not an active member, exactly as on the native path.
 *   ADA_PARTNER_SECRET_<ID>  the shared signing secret of each partner (≥ 32 characters; <ID> = id upper-cased, « - » → « _ »); server only.
 *   ADA_PARTNER_SECRET_<ID>_PREVIOUS  R3 (key rotation, optional): the secret being retired. While it is set, an INBOUND callback signed with either
 *                          secret is accepted; OUTBOUND events are always signed with the current secret. Remove it once the partner signs with the new one
 *                          (docs/partner-bridge/RUNBOOK_OPERATEUR_FR.md § rotation). ≥ 32 characters and different from the current one, or the config is INVALID.
 *   ADA_PARTNER_ADAPTERS_PRODUCTION_APPROVED=true  required in production / preview (owner, after the partner agreement, the AIPD extension and HDS).
 * The capability `partner.referral_adapter` (api/_utils/capabilities.js) must ALSO be open. Without configuration the adapter does nothing at all:
 * referrals follow the native ADA Pro path unchanged (graceful no-integration).
 */
import { PARTNER_CONTRACT, MIN_SECRET_LENGTH, signHeader } from './contract.js';

/** @param {unknown} v */
const flag = (v) => String(v ?? '').trim();
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const deployed = (/** @type {Record<string, string | undefined>} */ e) => ['production', 'preview'].includes(flag(e.VERCEL_ENV).toLowerCase());
export const PARTNER_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
export const secretEnvName = (/** @type {string} */ id) => `ADA_PARTNER_SECRET_${id.toUpperCase().replace(/-/g, '_')}`;
/** R3: the retiring secret of a key rotation (inbound verification only) @param {string} id */
export const previousSecretEnvName = (/** @type {string} */ id) => `${secretEnvName(id)}_PREVIOUS`;

/** @param {unknown} value @param {Record<string, string | undefined>} envVars */
export function allowedPartnerEndpoint(value, envVars) {
  let u; try { u = new URL(String(value)); } catch { return false; }
  if (u.username || u.password || u.hash) return false;
  if (u.protocol === 'https:') return !LOOPBACK.has(u.hostname) || !deployed(envVars);
  return u.protocol === 'http:' && LOOPBACK.has(u.hostname) && !deployed(envVars);
}

/**
 * @typedef {{ id: string, structureId: string, endpoint: string, delegateProUserId: string, secret: string, previousSecret?: string | null }} Partner
 * @param {Record<string, string | undefined>} [envVars]
 * @returns {{ state: 'NOT_CONFIGURED' | 'INVALID' | 'PRODUCTION_NOT_APPROVED' | 'CONFIGURED', partners: Partner[], problems: string[] }}
 */
export function partnerAdapterConfig(envVars = process.env) {
  const raw = flag(envVars.ADA_PARTNER_ADAPTERS);
  if (!raw) return { state: 'NOT_CONFIGURED', partners: [], problems: [] };
  let list;
  try { list = JSON.parse(raw); } catch { return { state: 'INVALID', partners: [], problems: ['ADA_PARTNER_ADAPTERS:json'] }; }
  if (!Array.isArray(list) || !list.length || list.length > 20) return { state: 'INVALID', partners: [], problems: ['ADA_PARTNER_ADAPTERS:list'] };
  /** @type {string[]} */ const problems = [];
  /** @type {Partner[]} */ const partners = [];
  const seen = new Set(); const seenStructures = new Set();
  list.forEach((p, i) => {
    const id = flag(p?.id); const structureId = flag(p?.structureId); const endpoint = flag(p?.endpoint); const delegateProUserId = flag(p?.delegateProUserId);
    const keys = p && typeof p === 'object' ? Object.keys(p) : [];
    if (keys.some((k) => !['id', 'structureId', 'endpoint', 'delegateProUserId'].includes(k))) problems.push(`[${i}]:extra-field`);
    if (!PARTNER_ID.test(id) || seen.has(id)) problems.push(`[${i}]:id`);
    if (!structureId || structureId.length > 80 || seenStructures.has(structureId)) problems.push(`[${i}]:structureId`);
    if (!allowedPartnerEndpoint(endpoint, envVars)) problems.push(`[${i}]:endpoint`);
    if (!delegateProUserId || delegateProUserId.length > 80) problems.push(`[${i}]:delegateProUserId`);
    const secret = PARTNER_ID.test(id) ? flag(envVars[secretEnvName(id)]) : '';
    if (secret.length < MIN_SECRET_LENGTH) problems.push(`[${i}]:secret`);
    const previousSecret = PARTNER_ID.test(id) ? flag(envVars[previousSecretEnvName(id)]) : '';
    if (previousSecret && (previousSecret.length < MIN_SECRET_LENGTH || previousSecret === secret)) problems.push(`[${i}]:previousSecret`);
    seen.add(id); seenStructures.add(structureId);
    partners.push({ id, structureId, endpoint, delegateProUserId, secret, previousSecret: previousSecret || null });
  });
  if (problems.length) return { state: 'INVALID', partners: [], problems };
  if (deployed(envVars) && flag(envVars.ADA_PARTNER_ADAPTERS_PRODUCTION_APPROVED).toLowerCase() !== 'true') return { state: 'PRODUCTION_NOT_APPROVED', partners: [], problems: [] };
  return { state: 'CONFIGURED', partners, problems: [] };
}

/** the status line (no value, no secret, no endpoint) @param {Record<string, string | undefined>} [envVars] */
export function partnerAdapterStatus(envVars = process.env) {
  const c = partnerAdapterConfig(envVars);
  return { provider: 'partner-referral-adapter', contract: PARTNER_CONTRACT, state: c.state, partners: c.partners.map((p) => p.id),
    rotating: c.partners.filter((p) => p.previousSecret).map((p) => p.id), problems: c.problems };
}

/** @param {string} id @param {Record<string, string | undefined>} [envVars] */
export function partnerById(id, envVars = process.env) {
  const c = partnerAdapterConfig(envVars);
  return c.state === 'CONFIGURED' ? c.partners.find((p) => p.id === id) || null : null;
}

export const DELIVERY = Object.freeze({ attempts: 3, timeoutMs: 8000, backoffMs: [500, 2000], maxRetryAfterMs: 10000 });

/**
 * Deliver one event to the partner: bounded in-call retries (network error, timeout, 408, 425, 429, 5xx; Retry-After honoured up to maxRetryAfterMs),
 * no retry on another 4xx (the partner refused the event: a retry would not change it), no redirect followed. The SAME Idempotency-Key on every attempt.
 * Across runs, the caller (api/_services/partner-adapter.js) retries a FAILED event on the next run, up to its own bound.
 * @param {Partner} partner @param {any} event
 * @param {{ fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, nowSeconds?: () => number }} [deps]
 * @returns {Promise<{ outcome: 'DELIVERED' | 'REJECTED' | 'FAILED', attempts: number, httpStatus: number | null }>}
 */
export async function deliverEvent(partner, event, deps = {}) {
  const doFetch = deps.fetchImpl || fetch;
  const sleep = deps.sleep || ((ms) => new Promise((r) => { setTimeout(r, ms); }));
  const nowS = deps.nowSeconds || (() => Math.floor(Date.now() / 1000));
  /** @type {number | null} */ let last = null;
  for (let attempt = 1; attempt <= DELIVERY.attempts; attempt += 1) {
    let wait = DELIVERY.backoffMs[attempt - 1] ?? 0;
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), DELIVERY.timeoutMs);
    try {
      const res = await doFetch(partner.endpoint, { method: 'POST', redirect: 'error', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': event.eventId, 'ADA-Contract': PARTNER_CONTRACT, 'ADA-Signature': signHeader(partner.secret, event, nowS()) },
        body: JSON.stringify(event) });
      last = res.status;
      if (res.status >= 200 && res.status < 300) return { outcome: 'DELIVERED', attempts: attempt, httpStatus: res.status };
      if (res.status < 500 && ![408, 425, 429].includes(res.status)) return { outcome: 'REJECTED', attempts: attempt, httpStatus: res.status };
      const ra = Number(res.headers?.get?.('retry-after'));
      if (Number.isFinite(ra) && ra >= 0) wait = Math.min(ra * 1000, DELIVERY.maxRetryAfterMs);
    } catch { last = null; } finally { clearTimeout(timer); }
    if (attempt < DELIVERY.attempts) await sleep(wait);
  }
  return { outcome: 'FAILED', attempts: DELIVERY.attempts, httpStatus: last };
}
