// @ts-nocheck
/**
 * FreshnessService — Deterministic aide freshness evaluation
 *
 * Checks aide last-verified timestamps against configurable policies.
 * Supports source/category-specific TTLs. Zero LLM calls.
 */

import { DEFAULT_FRESHNESS_TTL_DAYS } from '../agents/budget.js';

/**
 * Default TTLs in days, per source type or category.
 * Fast-changing benefits need shorter TTLs than stable structure records.
 */
const DEFAULT_TTL_POLICY = {
  DEFAULT: DEFAULT_FRESHNESS_TTL_DAYS,         // 90 days
  BENEFIT_RULE: 30,                             // Benefits/rules change frequently
  STRUCTURE: 180,                               // Structures change slowly
  PROCEDURE: 60,                                // Procedures may update quarterly
  CONTACT_INFO: 30,                             // Contact info can change monthly
};

/**
 * Evaluate freshness of an aide or source.
 *
 * @param {{ lastVerified?: string|Date, sourceType?: string, category?: string, sourceUpdatedAt?: string|Date, ingestionAt?: string|Date, contentHash?: string, previousContentHash?: string }} item
 * @param {{ ttlPolicy?: Record<string, number>, now?: Date }} options
 * @returns {{ state: 'FRESH'|'STALE'|'UNKNOWN', reason: string, daysSinceVerified: number|null, ttlDays: number, hashChanged: boolean }}
 */
export function evaluateFreshness(item, options = {}) {
  const now = options.now || new Date();
  const ttlPolicy = options.ttlPolicy || DEFAULT_TTL_POLICY;

  // Determine applicable TTL
  const ttlDays = resolveTTL(item, ttlPolicy);

  // Check hash change
  const hashChanged = !!(
    item.contentHash &&
    item.previousContentHash &&
    item.contentHash !== item.previousContentHash
  );

  // If hash changed, content is stale regardless of time
  if (hashChanged) {
    return {
      state: 'STALE',
      reason: 'CONTENT_HASH_CHANGED',
      daysSinceVerified: calculateDaysSince(item.lastVerified, now),
      ttlDays,
      hashChanged: true
    };
  }

  // If no verification date, state is unknown
  if (!item.lastVerified) {
    return {
      state: 'UNKNOWN',
      reason: 'NEVER_VERIFIED',
      daysSinceVerified: null,
      ttlDays,
      hashChanged: false
    };
  }

  const daysSince = calculateDaysSince(item.lastVerified, now);

  if (daysSince === null) {
    return {
      state: 'UNKNOWN',
      reason: 'INVALID_VERIFICATION_DATE',
      daysSinceVerified: null,
      ttlDays,
      hashChanged: false
    };
  }

  if (daysSince > ttlDays) {
    return {
      state: 'STALE',
      reason: 'TTL_EXCEEDED',
      daysSinceVerified: daysSince,
      ttlDays,
      hashChanged: false
    };
  }

  return {
    state: 'FRESH',
    reason: 'WITHIN_TTL',
    daysSinceVerified: daysSince,
    ttlDays,
    hashChanged: false
  };
}

/**
 * Resolve the applicable TTL in days for an item.
 */
// @ts-ignore
function resolveTTL(item, ttlPolicy) {
  // Check source type override first
  if (item.sourceType && ttlPolicy[item.sourceType] !== undefined) {
    return ttlPolicy[item.sourceType];
  }

  // Check category mapping
  if (item.category) {
    // Map broad categories to source types
    const categoryMapping = {
      EMPLOI: 'BENEFIT_RULE',
      LOGEMENT: 'BENEFIT_RULE',
      SANTE: 'BENEFIT_RULE',
      FAMILLE: 'BENEFIT_RULE',
      HANDICAP: 'BENEFIT_RULE',
      ETUDES: 'BENEFIT_RULE',
      MOBILITE: 'PROCEDURE',
      ENERGIE: 'BENEFIT_RULE',
      ALIMENTATION: 'BENEFIT_RULE',
      NUMERIQUE: 'STRUCTURE',
      JUSTICE: 'PROCEDURE',
      SENIORS: 'BENEFIT_RULE'
    };
    const mappedType = categoryMapping[item.category];
    if (mappedType && ttlPolicy[mappedType] !== undefined) {
      return ttlPolicy[mappedType];
    }
  }

  return ttlPolicy.DEFAULT || DEFAULT_FRESHNESS_TTL_DAYS;
}

/**
 * Calculate days since a date.
 * @param {string|Date} date
 * @param {Date} now
 * @returns {number|null}
 */
function calculateDaysSince(date, now) {
  if (!date) return null;
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return null;
    return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

/**
 * Batch-evaluate freshness for multiple items.
 * @param {Array} items
 * @param {object} options
 * @returns {Array<{ item: any, freshness: { state: string, reason: string, daysSinceVerified: number|null, ttlDays: number, hashChanged: boolean } }>}
 */
export function batchEvaluateFreshness(items, options = {}) {
  return items.map(item => ({
    item,
    freshness: evaluateFreshness(item, options)
  }));
}

/**
 * Get items requiring review (STALE or UNKNOWN).
 * @param {Array} items
 * @param {object} options
 * @returns {Array}
 */
export function getItemsNeedingReview(items, options = {}) {
  return batchEvaluateFreshness(items, options)
    .filter(r => r.freshness.state !== 'FRESH');
}

/**
 * Get sources ordered by stale first
 */
export function getStaleSourcesFirst(sources, options = {}) {
  const evaluated = batchEvaluateFreshness(sources, options);
  
  return evaluated.sort((a, b) => {
    // STALE or UNKNOWN comes first
    const aStale = a.freshness.state !== 'FRESH';
    const bStale = b.freshness.state !== 'FRESH';
    
    if (aStale && !bStale) return -1;
    if (!aStale && bStale) return 1;
    
    // If both stale/unknown, order by days since verified (descending)
    if (a.freshness.daysSinceVerified !== null && b.freshness.daysSinceVerified !== null) {
      return b.freshness.daysSinceVerified - a.freshness.daysSinceVerified;
    }
    
    return 0;
  }).map(res => res.item);
}

/**
 * Should prioritize refresh
 * @param {{ lastVerified?: string | Date; sourceType?: string; category?: string; sourceUpdatedAt?: string | Date; ingestionAt?: string | Date; contentHash?: string; previousContentHash?: string; }} source
 */
export function shouldPrioritizeRefresh(source, options = {}) {
  const { state } = evaluateFreshness(source, options);
  return state !== 'FRESH';
}

/**
 * Create bounded retry with exponential backoff and jitter
 */
export function createBoundedRetry(maxRetries = 3, baseDelay = 1000) {
  let attempt = 0;
  
  return {
    get attempt() {
      return attempt;
    },
    shouldRetry() {
      if (attempt >= maxRetries) return false;
      attempt++;
      return true;
    },
    getDelay() {
      // Exponential backoff: baseDelay * 2^(attempt-1) + jitter
      const expDelay = baseDelay * Math.pow(2, attempt - 1);
      const jitter = Math.random() * 200; // 0-200ms jitter
      return expDelay + jitter;
    }
  };
}
