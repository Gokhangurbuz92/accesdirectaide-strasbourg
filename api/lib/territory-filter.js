// @ts-nocheck
/**
 * Territory filtering utilities
 *
 * Implements strict cascade logic:
 * User location (INSEE code) -> Department -> Region -> National
 *
 * A user should see:
 * - All NATIONAL content
 * - REGIONAL content matching their region
 * - DEPARTMENTAL content matching their department
 * - COMMUNAL content matching their specific INSEE code
 *
 * And NEVER see content from other territories
 */

// Mapping of departments to regions (simplified - should be complete)
const DEPT_TO_REGION = {
  '67': 'grand-est',
  '68': 'grand-est',
  '75': 'ile-de-france',
  '92': 'ile-de-france',
  '93': 'ile-de-france',
  '94': 'ile-de-france',
  '13': 'provence-alpes-cote-azur',
  '06': 'provence-alpes-cote-azur',
  '69': 'auvergne-rhone-alpes',
  '38': 'auvergne-rhone-alpes',
  '33': 'nouvelle-aquitaine',
  '44': 'pays-de-la-loire',
  '59': 'hauts-de-france',
  '31': 'occitanie',
  '35': 'bretagne',
  // Add all departments...
};

// Mapping of INSEE codes to departments (first 2 or 3 digits)
/**
 * @param {string | undefined} inseeCode
 */
function getDepFromInsee(inseeCode) {
  if (!inseeCode || typeof inseeCode !== 'string') return null;

  // Extract department code (first 2-3 characters)
  // For Corsica: 2A, 2B
  // For overseas: 971-976, 977, 978, 984-988
  if (inseeCode.startsWith('2A') || inseeCode.startsWith('2B')) {
    return inseeCode.substring(0, 2);
  }

  if (inseeCode.length === 5 && inseeCode.startsWith('97')) {
    return inseeCode.substring(0, 3);
  }

  return inseeCode.substring(0, 2);
}

/**
 * Build a territory filter for DB queries
 *
 * @param {Object} userLocation - User's location info
 * @param {string} [userLocation.inseeCode] - INSEE code of the user's commune
 * @param {string} [userLocation.department] - Department code
 * @param {string} [userLocation.region] - Region slug
 * @returns {Object} where clause for territory filtering
 */
export function buildTerritoryFilter(userLocation) {
  if (!userLocation) {
    // No location provided - return only NATIONAL content
    return {
      OR: [
        { territory_scope: 'NATIONAL' },
        { territory_scope: null }, // Legacy content without scope
      ],
    };
  }

  const { inseeCode, department, region } = userLocation;

  // Derive missing values if possible
  const derivedDept = department || getDepFromInsee(inseeCode);
  const derivedRegion = region || (derivedDept ? DEPT_TO_REGION[derivedDept] : null);

  const conditions = [];

  // 1. Always include NATIONAL
  conditions.push({ territory_scope: 'NATIONAL' });

  // 2. Include legacy content without scope (for backward compatibility)
  conditions.push({ territory_scope: null });

  // 3. REGIONAL - if we know the region
  if (derivedRegion) {
    conditions.push({
      AND: [
        { territory_scope: 'REGIONAL' },
        { region_codes: { has: derivedRegion } },
      ],
    });
  }

  // 4. DEPARTMENTAL - if we know the department
  if (derivedDept) {
    conditions.push({
      AND: [
        { territory_scope: 'DEPARTMENTAL' },
        { department_codes: { has: derivedDept } },
      ],
    });
  }

  // 5. COMMUNAL - if we have the exact INSEE code
  if (inseeCode) {
    conditions.push({
      AND: [
        { territory_scope: 'COMMUNAL' },
        { insee_codes: { has: inseeCode } },
      ],
    });
  }

  return {
    OR: conditions,
  };
}

/**
 * Validate if content is accessible from a given location
 *
 * @param {Object} content - The content item (Aide, Demarche, etc.)
 * @param {Object} userLocation - User's location
 * @returns {boolean} True if content is accessible
 */
export function isContentAccessible(content, userLocation) {
  if (!content || !content.territory_scope) {
    // No scope defined - accessible (legacy content)
    return true;
  }

  if (content.territory_scope === 'NATIONAL') {
    return true;
  }

  if (!userLocation) {
    return false; // Scoped content requires location
  }

  const { inseeCode, department, region } = userLocation;
  const derivedDept = department || getDepFromInsee(inseeCode);
  const derivedRegion = region || (derivedDept ? DEPT_TO_REGION[derivedDept] : null);

  switch (content.territory_scope) {
    case 'REGIONAL':
      return (
        derivedRegion &&
        content.region_codes &&
        content.region_codes.includes(derivedRegion)
      );

    case 'DEPARTMENTAL':
      return (
        derivedDept &&
        content.department_codes &&
        content.department_codes.includes(derivedDept)
      );

    case 'COMMUNAL':
      return (
        inseeCode && content.insee_codes && content.insee_codes.includes(inseeCode)
      );

    default:
      return false;
  }
}

/**
 * Get human-readable territory label
 */
export function getTerritoryLabel(content) {
  if (!content || !content.territory_scope) {
    return 'National';
  }

  switch (content.territory_scope) {
    case 'NATIONAL':
      return 'National';
    case 'REGIONAL':
      return content.region_codes?.join(', ') || 'Régional';
    case 'DEPARTMENTAL':
      return `Département ${content.department_codes?.join(', ') || ''}`;
    case 'COMMUNAL':
      return 'Local';
    default:
      return content.territory_scope;
  }
}

export default {
  buildTerritoryFilter,
  isContentAccessible,
  getTerritoryLabel,
  getDepFromInsee,
};
