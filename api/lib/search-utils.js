import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const synonymsData = JSON.parse(readFileSync(join(__dirname, './synonyms.json'), 'utf8'));

/**
 * Normalize a search term for comparison
 * - Lowercase
 * - Remove accents
 * - Remove extra spaces and punctuation
 * @param {string} term
 */
export function normalizeSearchTerm(term) {
  if (!term || typeof term !== 'string') return '';

  return term
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^\w\s]/g, ' ') // Replace punctuation with space
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim();
}

/**
 * Expand a search query with synonyms
 * Returns an array of all possible search terms including the original
 * @param {string} query
 */
export function expandQueryWithSynonyms(query) {
  if (!query || typeof query !== 'string') return [];

  const normalized = normalizeSearchTerm(query);
  const terms = new Set([query, normalized]); // Include original and normalized

  // Split into individual words
  const words = normalized.split(' ');

  // For each word, check if it matches a synonym key or value
  words.forEach(word => {
    // Check if word is a synonym key
    if (synonymsData[word]) {
      synonymsData[word].forEach(/** @type {string} */ (/** @type {string} */ synonym) => {
        terms.add(synonym);
        terms.add(normalizeSearchTerm(synonym));
      });
    }

    // Check if word is in any synonym values
    Object.entries(synonymsData).forEach(([key, synonyms]) => {
      const normalizedSynonyms = synonyms.map(/** @type {string} */ (/** @type {string} */ s) => normalizeSearchTerm(s));
      if (normalizedSynonyms.includes(word)) {
        terms.add(key);
        synonyms.forEach(/** @type {string} */ (/** @type {string} */ synonym) => {
          terms.add(synonym);
          terms.add(normalizeSearchTerm(synonym));
        });
      }
    });
  });

  return Array.from(terms).filter(t => t.length > 0);
}

/**
 * Build a search filter with synonym expansion
 * Searches across multiple fields with OR logic
 *
 * @param {string} query - The search query
 * @param {string[]} fields - Fields to search (e.g., ['titre', 'summary_falc', 'mots_cles'])
 * @returns {Object} where clause
 */
export function buildSearchFilter(query, fields = ['titre', 'summary_falc', 'mots_cles']) {
  if (!query || typeof query !== 'string') {
    return {};
  }

  const expandedTerms = expandQueryWithSynonyms(query);

  if (expandedTerms.length === 0) {
    return {};
  }

  // Build OR conditions for each term and each field
  /**
   * @type {{ [x: string]: { has: string; } | { contains: string; mode: string; }; }[]}
   */
  const orConditions = [];

  expandedTerms.forEach(term => {
    fields.forEach(field => {
      // Handle array fields differently (like mots_cles)
      if (field === 'mots_cles' || field.endsWith('[]')) {
        orConditions.push({
          [field]: {
            has: term
          }
        });
      } else {
        // String fields - use contains with case-insensitive mode
        orConditions.push({
          [field]: {
            contains: term,
            mode: 'insensitive'
          }
        });
      }
    });
  });

  return {
    OR: orConditions
  };
}

/**
* Score search results based on relevance
* Higher score = more relevant
* @param {{ [x: string]: any; }} item
*/
export function scoreSearchResult(item, /** @type {string} */ query, fields = ['titre', 'summary_falc']) {
  if (!item || !query) return 0;

  const normalizedQuery = normalizeSearchTerm(query);
  const expandedTerms = expandQueryWithSynonyms(query);
  let score = 0;

  fields.forEach((field, fieldIndex) => {
    const fieldValue = normalizeSearchTerm(item[field] || '');

    if (!fieldValue) return;

    // Exact match in title = highest score
    if (field === 'titre' && fieldValue === normalizedQuery) {
      score += 100;
    }

    // Exact match in any field
    if (fieldValue === normalizedQuery) {
      score += 50;
    }

    // Contains original query
    if (fieldValue.includes(normalizedQuery)) {
      score += 30 - (fieldIndex * 5); // Title matches worth more
    }

    // Contains any expanded term
    expandedTerms.forEach(term => {
      if (fieldValue.includes(normalizeSearchTerm(term))) {
        score += 10 - (fieldIndex * 2);
      }
    });

    // Word boundary matches (whole word)
    const words = fieldValue.split(' ');
    if (words.includes(normalizedQuery)) {
      score += 20;
    }
  });

  return score;
}

/**
 * Sort search results by relevance
 */
export function sortByRelevance(/** @type {{ map: string | number | boolean | null | undefined }} */ results, /** @type {string} */ query, fields = ['titre', 'summary_falc']) {
  if (!results || !Array.isArray(results)) return [];

  return results
    .map(item => ({
      ...item,
      _searchScore: scoreSearchResult(item, query, fields)
    }))
    .sort((a, b) => b._searchScore - a._searchScore)
    .map(({ _searchScore, ...item }) => item); // Remove score from final result
}

export default {
  normalizeSearchTerm,
  expandQueryWithSynonyms,
  buildSearchFilter,
  scoreSearchResult,
  sortByRelevance
};
