// @ts-nocheck
/**
 * Phase 9 — ApplicabilityEngine
 * Deterministic territorial applicability resolution.
 * NO LLM involvement. Pure algorithmic evaluation.
 */

/**
 * @typedef {'APPLICABLE' | 'NOT_APPLICABLE' | 'TERRITORY_REQUIRED' | 'UNKNOWN'} ApplicabilityState
 */

/**
 * @typedef {Object} ApplicabilityRule
 * @property {string} territoryId
 * @property {string} territoryType - e.g. 'COUNTRY', 'REGION', 'DEPARTEMENT', 'EPCI', 'COMMUNE'
 * @property {boolean} isExclusion
 */

// Hierarchy depth: narrower = higher number = higher specificity
const TYPE_DEPTH = {
  'COUNTRY': 0,
  'REGION': 1,
  'DEPARTEMENT': 2,
  'EPCI': 3,
  'COMMUNE': 4,
  'COMMUNE_DELEGUEE': 5,
  'COMMUNE_ASSOCIEE': 5,
  'MUNICIPAL_ARRONDISSEMENT': 5,
  'QPV': 6
};

/**
 * Evaluate whether an entity (Benefit or Procedure) is applicable to a user's resolved territory.
 *
 * @param {ApplicabilityRule[]} rules - The applicability rules for the entity
 * @param {string[]} userTerritoryIds - The user's resolved territory hierarchy (commune, dept, region, etc.)
 * @param {Map<string, string>} territoryTypeMap - Map of territoryId -> territoryType
 * @returns {ApplicabilityState}
 */
export function evaluateApplicability(rules, userTerritoryIds, territoryTypeMap) {
  // If no territory context provided
  if (!userTerritoryIds || userTerritoryIds.length === 0) {
    // National-only rules are still discoverable
    const hasOnlyNational = rules.length > 0 && rules.every(r => {
      const type = territoryTypeMap?.get(r.territoryId);
      return type === 'COUNTRY' && !r.isExclusion;
    });
    if (hasOnlyNational) return 'APPLICABLE';
    // Local rules require territory
    if (rules.length > 0) return 'TERRITORY_REQUIRED';
    return 'UNKNOWN';
  }

  // If no applicability rules exist for this entity
  if (!rules || rules.length === 0) {
    return 'UNKNOWN';
  }

  const userIdSet = new Set(userTerritoryIds);

  // Separate inclusions and exclusions that match the user's hierarchy
  const matchingInclusions = [];
  const matchingExclusions = [];

  for (const rule of rules) {
    const isMatch = userIdSet.has(rule.territoryId);
    if (!isMatch) continue;

    const type = territoryTypeMap?.get(rule.territoryId) || 'COUNTRY';
    const depth = TYPE_DEPTH[type] ?? 0;

    if (rule.isExclusion) {
      matchingExclusions.push({ ...rule, depth });
    } else {
      matchingInclusions.push({ ...rule, depth });
    }
  }

  // No matching rules at all
  if (matchingInclusions.length === 0 && matchingExclusions.length === 0) {
    // Check if ANY inclusion rules exist (just not for user's territories)
    const hasInclusions = rules.some(r => !r.isExclusion);
    if (hasInclusions) return 'NOT_APPLICABLE';
    return 'UNKNOWN';
  }

  // Pure exclusion, no inclusion match
  if (matchingInclusions.length === 0 && matchingExclusions.length > 0) {
    return 'NOT_APPLICABLE';
  }

  // Apply precedence: narrowest boundary wins
  // If both inclusion and exclusion exist at the same depth, exclusion wins
  const deepestInclusion = Math.max(...matchingInclusions.map(r => r.depth));
  const deepestExclusion = matchingExclusions.length > 0
    ? Math.max(...matchingExclusions.map(r => r.depth))
    : -1;

  if (deepestExclusion >= deepestInclusion) {
    return 'NOT_APPLICABLE';
  }

  return 'APPLICABLE';
}

/**
 * Convenience: evaluate for both BENEFIT and PROCEDURE identically.
 * The algorithm is type-agnostic by design.
 * @param {ApplicabilityRule[]} rules
 * @param {string[]} userTerritoryIds
 * @param {Map<string, string>} territoryTypeMap
 */
export function evaluateBenefitApplicability(rules, userTerritoryIds, territoryTypeMap) {
  return evaluateApplicability(rules, userTerritoryIds, territoryTypeMap);
}

/**
 * @param {ApplicabilityRule[]} rules
 * @param {string[]} userTerritoryIds
 * @param {Map<string, string>} territoryTypeMap
 */
export function evaluateProcedureApplicability(rules, userTerritoryIds, territoryTypeMap) {
  return evaluateApplicability(rules, userTerritoryIds, territoryTypeMap);
}

export default { evaluateApplicability, evaluateBenefitApplicability, evaluateProcedureApplicability };
