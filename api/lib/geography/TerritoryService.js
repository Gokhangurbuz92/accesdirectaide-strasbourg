// @ts-nocheck
/**
 * Phase 9 — TerritoryService
 * Deterministic territory resolution using INSEE COG, API Géo, and Géoplateforme.
 */
import logger from '../../_utils/logger.js';

const API_GEO_BASE = 'https://geo.api.gouv.fr';
const GEOPLATEFORME_BASE = 'https://data.geopf.fr/geocodage';
const GEOPLATEFORME_RATE_LIMIT = 50; // req/IP/sec — documented constraint

let lastGeopfRequestMs = 0;
let geopfRequestCount = 0;

/**
 * Resolve a postal code to an array of candidate communes via API Géo.
 * NEVER returns a single arbitrary pick for ambiguous codes.
 * @param {string} postalCode - 5-digit French postal code
 * @returns {Promise<Array<{inseeCode: string, name: string, departmentCode: string}>>}
 */
export async function resolvePostalCode(postalCode) {
  if (!postalCode || !/^\d{5}$/.test(postalCode)) {
    return [];
  }

  const url = `${API_GEO_BASE}/communes?codePostal=${postalCode}&fields=nom,code,codeDepartement`;

  try {
    const res = await fetchWithRetry(url, { timeout: 5000 });
    if (!res.ok) {
      logger.warn(`[TerritoryService] API Géo returned ${res.status} for postal code ${postalCode}`);
      return [];
    }
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data.map(c => ({
      inseeCode: c.code,
      name: c.nom,
      departmentCode: c.codeDepartement
    }));
  } catch (err) {
    logger.error(`[TerritoryService] Postal code resolution failed: ${err.message}`);
    return [];
  }
}

/**
 * Resolve coordinates to a commune via API Géo reverse lookup.
 * Does NOT persist precise coordinates.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{inseeCode: string, name: string, departmentCode: string} | null>}
 */
export async function resolveCoordinates(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;

  const url = `${API_GEO_BASE}/communes?lat=${lat}&lon=${lon}&fields=nom,code,codeDepartement`;

  try {
    const res = await fetchWithRetry(url, { timeout: 5000 });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    return {
      inseeCode: data[0].code,
      name: data[0].nom,
      departmentCode: data[0].codeDepartement
    };
  } catch (err) {
    logger.error(`[TerritoryService] Coordinate resolution failed: ${err.message}`);
    return null;
  }
}

/**
 * Geocode a full address via Géoplateforme.
 * Enforces 50 req/IP/sec rate limit with 429 backoff.
 * @param {string} address
 * @returns {Promise<{lat: number, lon: number, inseeCode: string, label: string} | null>}
 */
export async function geocodeAddress(address) {
  if (!address || typeof address !== 'string') return null;

  await enforceGeopfRateLimit();

  const url = `${GEOPLATEFORME_BASE}/search?q=${encodeURIComponent(address)}&limit=1`;

  try {
    const res = await fetchWithRetry(url, { timeout: 8000, handle429: true });
    if (!res.ok) return null;
    const data = await res.json();

    const feature = data?.features?.[0];
    if (!feature) return null;

    return {
      lat: feature.geometry?.coordinates?.[1],
      lon: feature.geometry?.coordinates?.[0],
      inseeCode: feature.properties?.citycode,
      label: feature.properties?.label
    };
  } catch (err) {
    logger.error(`[TerritoryService] Geocoding failed: ${err.message}`);
    return null;
  }
}

/**
 * Build a territory hierarchy from a commune INSEE code using DB relations.
 * @param {string} inseeCode
 * @param {object} db - Drizzle db instance
 * @param {object} schemas - { Territory, TerritoryRelation }
 * @returns {Promise<object>}
 */
export async function getHierarchy(inseeCode, db, schemas) {
  if (!db || !schemas) {
    return { commune: inseeCode, hierarchy: [] };
  }

  const { Territory, TerritoryRelation } = schemas;
  const { eq, and } = await import('drizzle-orm');

  // Find the commune
  const communes = await db.select().from(Territory)
    .where(and(eq(Territory.officialCode, inseeCode), eq(Territory.type, 'COMMUNE'), eq(Territory.status, 'CURRENT')))
    .limit(1);

  if (communes.length === 0) return { commune: inseeCode, hierarchy: [] };

  const commune = communes[0];
  const hierarchy = [{ id: commune.id, type: commune.type, code: commune.officialCode }];

  // PKG-11 / D12: the EPCI the commune is MEMBER_OF comes right after it (narrower than the département)
  const memberships = await db.select().from(TerritoryRelation)
    .where(and(eq(TerritoryRelation.sourceId, commune.id), eq(TerritoryRelation.type, 'MEMBER_OF')));
  for (const rel of memberships) {
    const epci = await db.select().from(Territory).where(and(eq(Territory.id, rel.targetId), eq(Territory.type, 'EPCI'), eq(Territory.status, 'CURRENT'))).limit(1);
    if (epci.length > 0) hierarchy.push({ id: epci[0].id, type: epci[0].type, code: epci[0].officialCode });
  }

  // Walk PART_OF relations upward
  let currentId = commune.id;
  for (let depth = 0; depth < 5; depth++) {
    const rels = await db.select().from(TerritoryRelation)
      .where(and(eq(TerritoryRelation.sourceId, currentId), eq(TerritoryRelation.type, 'PART_OF')))
      .limit(1);

    if (rels.length === 0) break;

    const parent = await db.select().from(Territory)
      .where(eq(Territory.id, rels[0].targetId))
      .limit(1);

    if (parent.length === 0) break;

    hierarchy.push({ id: parent[0].id, type: parent[0].type, code: parent[0].officialCode });
    currentId = parent[0].id;
  }

  return { commune: inseeCode, hierarchy };
}

// ── Internal helpers ──

async function enforceGeopfRateLimit() {
  const now = Date.now();
  if (now - lastGeopfRequestMs < 1000) {
    geopfRequestCount++;
    if (geopfRequestCount >= GEOPLATEFORME_RATE_LIMIT) {
      const waitMs = 1000 - (now - lastGeopfRequestMs);
      await new Promise(r => setTimeout(r, waitMs));
      geopfRequestCount = 0;
      lastGeopfRequestMs = Date.now();
    }
  } else {
    geopfRequestCount = 1;
    lastGeopfRequestMs = now;
  }
}

/**
 * @param {string | URL | Request} url
 */
async function fetchWithRetry(url, opts = {}) {
  const { timeout = 5000, handle429 = false, retries = 3 } = opts;
  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (handle429 && res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '1', 10);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
  throw new Error('fetchWithRetry: exhausted retries');
}

export default { resolvePostalCode, resolveCoordinates, geocodeAddress, getHierarchy };
