// @ts-nocheck
/**
 * Query State Management Utilities
 * 
 * Provides consistent URL query parameter handling across list pages.
 * Ensures type safety, whitelisting, and proper URL encoding.
 */

/**
 * Parse query parameters with type conversion and validation
 * @param {URLSearchParams} searchParams - URL search parameters
 * @param {Object} schema - Parameter schema with types and defaults
 * @returns {Object} Parsed and validated parameters
 */
export function parseQueryParams(searchParams, schema = {}) {
  const result = {};

  for (const [key, config] of Object.entries(schema)) {
    const value = searchParams.get(key);
    
    if (value === null || value === '') {
      result[key] = config.default;
      continue;
    }

    switch (config.type) {
      case 'number': {
        const num = parseInt(value, 10);
        result[key] = isNaN(num) ? config.default : num;
        break;
      }
      
      case 'boolean':
        result[key] = value === 'true' || value === '1';
        break;
      
      case 'string':
      default:
        result[key] = value;
        break;
    }
  }

  return result;
}

/**
 * Stringify query parameters, removing empty values
 * @param {Object} params - Parameters to stringify
 * @param {Object} schema - Parameter schema (optional, for validation)
 * @returns {URLSearchParams} URL search parameters
 */
export function stringifyQueryParams(params, schema = {}) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    // Skip if value is empty, null, undefined, or default
    if (value === null || value === undefined || value === '') {
      continue;
    }

    // Skip if value equals default (if schema provided)
    // @ts-ignore
    if (schema[key] && value === schema[key].default) {
      continue;
    }

    // Convert to string and add
    searchParams.set(key, String(value));
  }

  return searchParams;
}

/**
 * Update a single query parameter
 * @param {URLSearchParams} searchParams - Current search parameters
 * @param {string} key - Parameter key to update
 * @param {any} value - New value (null/undefined/empty string to remove)
 * @param {Object} options - Options
 * @param {boolean} options.resetPage - Reset page to 1 when changing filters
 * @returns {URLSearchParams} Updated search parameters
 */
export function updateQueryParam(searchParams, key, value, options = {}) {
  const newParams = new URLSearchParams(searchParams);

  if (value === null || value === undefined || value === '') {
    newParams.delete(key);
  } else {
    newParams.set(key, String(value));
  }

  // Reset page to 1 when changing filters (unless updating page itself)
  if (options.resetPage && key !== 'page') {
    newParams.set('page', '1');
  }

  return newParams;
}

/**
 * Clear all query parameters
 * @param {Array<string>} keep - Parameters to keep (optional)
 * @returns {URLSearchParams} Empty or filtered search parameters
 */
export function clearQueryParams(keep = []) {
  const searchParams = new URLSearchParams();
  
  // If keep list provided, preserve those parameters
  if (keep.length > 0) {
    const current = new URLSearchParams(window.location.search);
    keep.forEach(key => {
      const value = current.get(key);
      if (value) {
        searchParams.set(key, value);
      }
    });
  }

  return searchParams;
}

/**
 * Common query parameter schemas for list pages
 */
export const SCHEMAS = {
  // Aides list page
  aides: {
    q: { type: 'string', default: '' },
    theme: { type: 'string', default: '' },
    situation: { type: 'string', default: '' },
    territoire: { type: 'string', default: '' },
    public: { type: 'string', default: '' },
    organisme: { type: 'string', default: '' },
    urgent: { type: 'string', default: '' },
    page: { type: 'number', default: 1 },
  },

  // Demarches list page
  demarches: {
    q: { type: 'string', default: '' },
    category: { type: 'string', default: '' },
    situation: { type: 'string', default: '' },
    page: { type: 'number', default: 1 },
  },

  // Annuaire list page
  annuaire: {
    q: { type: 'string', default: '' },
    type: { type: 'string', default: '' },
    city: { type: 'string', default: '' },
    page: { type: 'number', default: 1 },
  },

  // Actualites list page
  actualites: {
    categorie: { type: 'string', default: '' },
    page: { type: 'number', default: 1 },
  },

  // Structures list page (Annuaire)
  structures: {
    q: { type: 'string', default: '' },
    type: { type: 'string', default: '' },
    city: { type: 'string', default: '' },
    page: { type: 'number', default: 1 },
  },
};

/**
 * Get active filters (non-empty, non-default values)
 * @param {Object} params - Current parameters
 * @param {Array<string>} exclude - Keys to exclude (e.g., ['page', 'pageSize'])
 * @returns {Object} Active filters only
 */
export function getActiveFilters(params, exclude = []) {
  const active = {};

  for (const [key, value] of Object.entries(params)) {
    // Skip excluded keys
    if (exclude.includes(key)) {
      continue;
    }

    // Skip empty values
    if (value === null || value === undefined || value === '') {
      continue;
    }

    active[key] = value;
  }

  return active;
}

/**
 * Check if any filters are active
 * @param {Object} params - Current parameters
 * @param {Array<string>} exclude - Keys to exclude (e.g., ['page'])
 * @returns {boolean} True if any filters are active
 */
export function hasActiveFilters(params, exclude = []) {
  const active = getActiveFilters(params, exclude);
  return Object.keys(active).length > 0;
}

/**
 * React hook for managing query state (optional, for future use)
 * Usage: const [filters, setFilter, clearFilters] = useQueryState(schema);
 * @param {URLSearchParams} searchParams
 * @param {(arg0: URLSearchParams) => void} setSearchParams
 * @param {Object | undefined} schema
 */
export function useQueryState(searchParams, setSearchParams, schema) {
  const filters = parseQueryParams(searchParams, schema);

  const setFilter = (/** @type {string} */ key, /** @type {string | number | boolean | null | undefined} */ value) => {
    const newParams = updateQueryParam(searchParams, key, value, { resetPage: true });
    setSearchParams(newParams);
  };

  const clearFilters = () => {
    setSearchParams(clearQueryParams());
  };

  return [filters, setFilter, clearFilters];
}
