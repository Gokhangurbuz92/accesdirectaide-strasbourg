import crypto from 'crypto';

// In-memory mock store for test demonstration
import * as repo from './ConflictRecordRepository.js';
let conflictStore = []; // left for legacy tests if they directly check it, but we won't use it

/**
 * For testing purposes to reset the store
 */
export function _resetStore() {
  conflictStore = [];

  const mockMode =
    process.env.USE_MOCKS === 'true' ||
    process.env.VITE_SKIP_DB === 'true';

  if (mockMode) {
    repo.clearMockConflicts?.();
  }
}

/**
* Detect attribute conflicts between sources.
* @param {string | any[]} sources
*/
export async function detectAttributeConflicts(/** @type {string | number | boolean | null | undefined} */ entityId, sources, entityType = 'Aide') {
  if (!sources || sources.length < 2) return [];

  const conflicts = [];
  const baseSource = sources[0];

  for (let i = 1; i < sources.length; i++) {
    const compareSource = sources[i];

    if (baseSource.amount !== undefined && compareSource.amount !== undefined && baseSource.amount !== compareSource.amount) {
      conflicts.push({
        id: crypto.randomUUID(),
        entityType,
        entityId,
        sourceA: baseSource.id,
        sourceB: compareSource.id,
        attribute: 'amount',
        valueA: baseSource.amount,
        valueB: compareSource.amount,
        resolutionStatus: 'PENDING'
      });
    }

    if (baseSource.eligibilityConditions !== undefined && compareSource.eligibilityConditions !== undefined && baseSource.eligibilityConditions !== compareSource.eligibilityConditions) {
      conflicts.push({
        id: crypto.randomUUID(),
        entityType,
        entityId,
        sourceA: baseSource.id,
        sourceB: compareSource.id,
        attribute: 'eligibilityConditions',
        valueA: baseSource.eligibilityConditions,
        valueB: compareSource.eligibilityConditions,
        resolutionStatus: 'PENDING'
      });
    }
  }

  for (const c of conflicts) { await repo.createConflict(c); }
  return conflicts;
}

/**
 * Resolve a conflict.
 */
export async function resolveConflict(/** @type {string | number | boolean | null | undefined} */ conflictId, /** @type {string | number | boolean | null | undefined} */ resolution, /** @type {string | number | boolean | null | undefined} */ adminId) {
  return await repo.resolveConflict(conflictId, resolution, adminId);
}

/**
 * Evaluate precedence between two sources for a specific fact
 */
export function evaluatePrecedence(/** @type {{ id: string | number | boolean | null | undefined }} */ sourceA, /** @type {{ id: string | number | boolean | null | undefined }} */ sourceB, /** @type {{ scope: string | number | boolean | null | undefined, territory: string | number | boolean | null | undefined }} */ fact) {
  const getCompetenceScore = (/** @type {Record<string, string | number | boolean | null | undefined>} */ src) => {
    if (src.competence === 'NATIONAL' && fact.scope === 'NATIONAL') return 100;
    if (src.competence === 'DEPARTMENTAL' && fact.scope === 'DEPARTMENTAL' && src.territory === fact.territory) return 100;
    if (src.competence === 'REGIONAL' && fact.scope === 'REGIONAL' && src.territory === fact.territory) return 100;
    return 0;
  };

  const scoreA = getCompetenceScore(sourceA);
  const scoreB = getCompetenceScore(sourceB);

  if (scoreA > scoreB) return { winner: sourceA.id, confidence: 'HIGH', requiresHumanReview: false };
  if (scoreB > scoreA) return { winner: sourceB.id, confidence: 'HIGH', requiresHumanReview: false };

  return {
    winner: null,
    confidence: 'LOW', // AI confidence MUST NEVER resolve source conflicts
    requiresHumanReview: true
  };
}

/**
 * Auto-generate P1 ReviewQueueItem on conflict
 */
export function createConflictReviewItem(/** @type {{ id: string | number | boolean | null | undefined, sourceA: string | number | boolean | null | undefined, sourceB: string | number | boolean | null | undefined }} */ conflictRecord) {
  return {
    id: crypto.randomUUID(),
    type: 'CONFLICT_REVIEW',
    conflictId: conflictRecord.id,
    priority: 'P1',
    status: 'PENDING',
    sourceReferences: [conflictRecord.sourceA, conflictRecord.sourceB]
  };
}

/**
 * Block auto-publish for unresolved conflicts
 * @param {string | import("drizzle-orm").SQLWrapper} entityId
 */
export async function hasUnresolvedConflicts(entityId) {
  const unresolved = await repo.getUnresolvedConflicts(entityId);
  return unresolved.length > 0;
}

/**
 * @param {string | import("drizzle-orm").SQLWrapper} entityId
 */
export async function assertPublishable(entityId) {
  if (await hasUnresolvedConflicts(entityId)) {
    throw new Error(`Cannot publish entity ${entityId} with unresolved conflicts`);
  }
}
