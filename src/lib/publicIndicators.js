/**
 * G8 — reads the public indicators of the Observatoire (GET /api/public/indicators, api/lib/public-indicators.js) for /impact
 * (src/components/impact/PublicIndicators.jsx). No credentials are sent; any failure, a closed route (404) or another schema gives null.
 */
/** @typedef {{ schema: string, computedAt: string, rules: any, catalogue: Record<string, number>, aidesByDomain: { domain: string, count: number }[], aidesByScope: { scope: string, count: number }[],
 *   structuresByCommune: { cells: { commune: string, label: string, count: number }[], maskedCommunes: number, notLocated: number | null, kMin: number },
 *   freshness: Record<string, { visible: number, current: number, updateNeeded: number, currentShare: number | null }>,
 *   linkHealth: { measured: boolean, windowDays: number, lastCheckedOn?: string, addresses?: number, reachable?: number, redirected?: number, broken?: number, inconclusive?: number },
 *   translations: { languages: Record<string, Record<string, { full: number, partial: number }>>, of: Record<string, number> },
 *   structuresInformation: { visible: number, stepFreeAccessIndicated: number, openingHoursIndicated: number },
 *   rightsNeeds: { needs: number, officialFiches: number, sourcesReadOn: string | null } | null }} Indicators */

/** @param {typeof fetch} [fetchImpl] @returns {Promise<Indicators | null>} */
export async function loadPublicIndicators(fetchImpl = fetch) {
  try {
    const r = await fetchImpl('/api/public/indicators', { credentials: 'omit' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.schema === 'ada.public-indicators.v1' ? j : null;
  } catch { return null; }
}

