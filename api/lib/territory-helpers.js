// @ts-nocheck
/**
 * Canonical territory semantics.
 * Normalizes the inconsistent legacy field names into a coherent domain model.
 * Does NOT modify database columns — pure application-layer normalization.
 */

export const SCOPE = Object.freeze({
  NATIONAL: 'NATIONAL',
  REGIONAL: 'REGIONAL',
  DEPARTMENTAL: 'DEPARTMENTAL',
  COMMUNAL: 'COMMUNAL',
});

/**
 * Resolve the canonical territory scope from an entity's fields.
 * Checks territory_scope first, then falls back to heuristics.
 * @param {object} item - DB row with territory fields
 * @returns {string} One of SCOPE values
 */
export function resolveScope(item) {
  if (item.territory_scope && Object.values(SCOPE).includes(item.territory_scope)) {
    return item.territory_scope;
  }
  // Heuristic fallback from legacy fields
  if (item.insee_codes?.length > 0) return SCOPE.COMMUNAL;
  if (item.department_codes?.length > 0 || item.departements?.length > 0) return SCOPE.DEPARTMENTAL;
  if (item.region_codes?.length > 0) return SCOPE.REGIONAL;
  // Legacy territoires array check
  if (Array.isArray(item.territoires)) {
    const hasNational = item.territoires.some(t => /national/i.test(t));
    if (hasNational || item.territoires.length === 0) return SCOPE.NATIONAL;
    return SCOPE.DEPARTMENTAL; // best guess for legacy data
  }
  return SCOPE.NATIONAL;
}

/**
 * Get a human-readable territory display string.
 * @param {object} item
 * @returns {string}
 */
export function getDisplayTerritory(item) {
  const scope = resolveScope(item);
  switch (scope) {
    case SCOPE.NATIONAL: return 'France entière';
    case SCOPE.REGIONAL: return (item.region_codes || []).join(', ') || 'Régional';
    case SCOPE.DEPARTMENTAL: {
      const codes = item.department_codes || item.departements || [];
      return codes.length > 0 ? `Département${codes.length > 1 ? 's' : ''} ${codes.join(', ')}` : 'Départemental';
    }
    case SCOPE.COMMUNAL: return (item.insee_codes || []).join(', ') || 'Communal';
    default: return 'France entière';
  }
}

/**
 * Normalize raw user territory input to scope + codes.
 * @param {string} raw - User input (department code, city name, "national", etc.)
 * @returns {{ scope: string, codes: string[] }}
 */
export function normalizeTerritoryInput(raw) {
  if (!raw || raw.toLowerCase() === 'national' || raw.toLowerCase() === 'france') {
    return { scope: SCOPE.NATIONAL, codes: [] };
  }
  const trimmed = raw.trim();
  if (/^\d{2,3}$/.test(trimmed)) {
    return { scope: SCOPE.DEPARTMENTAL, codes: [trimmed] };
  }
  if (/^\d{5}$/.test(trimmed)) {
    return { scope: SCOPE.COMMUNAL, codes: [trimmed] };
  }
  return { scope: SCOPE.DEPARTMENTAL, codes: [trimmed] };
}
