// @ts-nocheck
/**
 * Phase 9 — QPV Adapter (legacy, NOT used by any request handler).
 * R46 / P07: the product's QPV facts now come from the official ANCT 2024 list in data/reference/qpv-2024.v1.json (api/lib/geography/postalReference.js),
 * which says which communes count a quartier prioritaire and never places an address in one.
 * The fixtures below are SYNTHETIC test values: they do NOT match the official list (QP067001 is « Quartier Liberté » in the 2015 generation, and the 2024
 * codes are QN…); never show them to a person. No coordinate API of sig.ville.gouv.fr is documented as a supported public API, so the « live » call below
 * is refused even when a key is configured (QPV state UNKNOWN) — never call an unverified API as if it were supported.
 */
import logger from '../../_utils/logger.js';

// SYNTHETIC fixtures for legacy unit tests only (names and codes are NOT the official correspondence)
const QPV_FIXTURES = new Map([
  ['QP067001', { code: 'QP067001', name: 'Hautepierre', commune: '67482', departement: '67' }],
  ['QP067002', { code: 'QP067002', name: 'Neuhof - Meinau', commune: '67482', departement: '67' }],
  ['QP069001', { code: 'QP069001', name: 'La Duchère', commune: '69123', departement: '69' }],
  ['QP075001', { code: 'QP075001', name: 'Goutte d\'Or', commune: '75118', departement: '75' }],
  ['QP974001', { code: 'QP974001', name: 'Le Chaudron', commune: '97411', departement: '974' }],
]);

const SIG_VILLE_API_BASE = process.env.SIG_VILLE_API_URL || 'https://sig.ville.gouv.fr/api';

/**
 * Resolve QPV code from official fixtures.
 * @param {string} qpvCode
 * @returns {{ code: string, name: string, commune: string, departement: string } | null}
 */
export function resolveQPVFromFixtures(qpvCode) {
  return QPV_FIXTURES.get(qpvCode) || null;
}

/**
 * Resolve QPV from live SIG Ville API (EXTERNAL ACTION REQUIRED).
 * Returns null if credentials unavailable.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{ code: string, name: string } | null>}
 */
export async function resolveQPVFromLiveAPI(lat, lon) {
  const apiKey = process.env.SIG_VILLE_API_KEY;
  if (!apiKey) {
    const nodeEnv = process.env.NODE_ENV || 'development';
    if (nodeEnv === 'production' || nodeEnv === 'staging') {
      // Production/staging: no fixture fallback — return explicit unavailable
      logger.warn('[QPV] Live API credentials not available in production (EXTERNAL ACTION REQUIRED). QPV state: UNKNOWN.');
      return null; // Caller must treat as UNKNOWN, never as fixture success
    }
    logger.warn('[QPV] Live API credentials not available (EXTERNAL ACTION REQUIRED) — fixture fallback allowed in dev/test');
    return null;
  }

  // R46: a key alone does not make an undocumented endpoint official — refused, the caller treats the state as UNKNOWN
  if (process.env.SIG_VILLE_API_VERIFIED !== 'documented-official-api') {
    logger.warn('[QPV] No documented official coordinate API: QPV state UNKNOWN (use the official address lookup on sig.ville.gouv.fr).');
    return null;
  }
  try {
    const url = `${SIG_VILLE_API_BASE}/qpv?lat=${lat}&lon=${lon}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.code ? { code: data.code, name: data.nom } : null;
  } catch (err) {
    logger.error(`[QPV] Live API error: ${err.message}`);
    return null;
  }
}

/**
 * Structure QPV cache: persistent with provenance.
 * User QPV: transient/session-only (never persisted by default).
 */
const structureQPVCache = new Map();

/**
 * Cache QPV result for a structure (persistent).
 */
export function cacheStructureQPV(/** @type {string | number | boolean | null | undefined} */ structureId, /** @type {Record<string, string | number | boolean | null | undefined>} */ qpvResult) {
  structureQPVCache.set(structureId, {
    ...qpvResult,
    cachedAt: new Date().toISOString(),
    source: 'SIG_VILLE'
  });
}

/**
 * Get cached structure QPV.
 */
export function getCachedStructureQPV(/** @type {string | number | boolean | null | undefined} */ structureId) {
  return structureQPVCache.get(structureId) || null;
}

/**
 * User QPV resolution: returns result but does NOT persist.
 * @param {number} lat
 * @param {number} lon
 */
export async function resolveUserQPV(lat, lon) {
  // Transient only — result is returned but never stored
  const result = await resolveQPVFromLiveAPI(lat, lon);
  // Do NOT persist to any user profile or database
  return result;
}

export default {
  resolveQPVFromFixtures,
  resolveQPVFromLiveAPI,
  cacheStructureQPV,
  getCachedStructureQPV,
  resolveUserQPV,
  QPV_FIXTURES
};
