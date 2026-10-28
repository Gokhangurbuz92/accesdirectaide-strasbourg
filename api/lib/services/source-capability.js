// @ts-nocheck
/**
 * Source-use compatibility rules.
 * Maps specialist agents to required source capabilities.
 * Enforces that sources are only used for purposes matching their capabilities.
 */

const SPECIALIST_REQUIREMENTS = {
  EligibilitySpecialist: ['LEGAL', 'BENEFIT_RULE', 'BENEFIT_PARAMETER'],
  OrientationSpecialist: ['DIRECTORY', 'LOCAL_SERVICE', 'PROCEDURAL'],
  ProcedureSpecialist: ['PROCEDURAL', 'LEGAL', 'REFERENCE'],
  DocumentSpecialist: ['PROCEDURAL', 'LEGAL', 'REFERENCE', 'BENEFIT_RULE'],
  FALCSpecialist: ['LEGAL', 'BENEFIT_RULE', 'PROCEDURAL', 'DIRECTORY']
};

/**
 * Check if a source's capabilities are compatible with a specialist's requirements.
 * At least one capability must match.
 */
export function isSourceCompatible(/** @type {Array<string | number | boolean | null | undefined>} */ sourceCapabilities, specialistType) {
  const required = SPECIALIST_REQUIREMENTS[specialistType];
  if (!required) return true; // Unknown specialist → allow (fail-open for extensibility)
  return sourceCapabilities.some(cap => required.includes(cap));
}

/**
* Filter sources to only those compatible with a specialist.
* @param {any[]} sources
*/
export function filterCompatibleSources(sources, /** @type {string | number | boolean | null | undefined} */ specialistType) {
  return sources.filter(source => 
    isSourceCompatible(source.capabilities || [], specialistType)
  );
}

/**
 * Get required capabilities for a specialist type.
 */
export function getSpecialistRequirements(specialistType) {
  return SPECIALIST_REQUIREMENTS[specialistType] || null;
}

/**
 * Validate that a capability list does NOT include capabilities
 * that would be misleading for the source's actual authority.
 * E.g., a STATISTICAL source should not claim BENEFIT_RULE.
 * @param {string | string[]} capabilities
 * @param {string} sourceType
 */
export function validateCapabilityConsistency(capabilities, sourceType) {
  const warnings = [];
  if (sourceType === 'STATISTICAL' && capabilities.includes('BENEFIT_RULE')) {
    warnings.push('STATISTICAL source should not claim BENEFIT_RULE capability');
  }
  if (sourceType === 'STATISTICAL' && capabilities.includes('ELIGIBILITY_RULE')) {
    warnings.push('STATISTICAL source should not claim ELIGIBILITY_RULE capability');
  }
  if (sourceType === 'OPEN_DATA_CATALOG' && capabilities.includes('LEGAL')) {
    warnings.push('OPEN_DATA_CATALOG (distribution platform) should not claim LEGAL authority — authority belongs to the producer');
  }
  return warnings;
}

export default {
  isSourceCompatible,
  filterCompatibleSources,
  getSpecialistRequirements,
  validateCapabilityConsistency,
  SPECIALIST_REQUIREMENTS
};
