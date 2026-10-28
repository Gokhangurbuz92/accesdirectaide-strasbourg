// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { ConflictRecord } from '../../../src/db/schema.js';
import { eq, and, desc } from 'drizzle-orm';

const isMock = () => process.env.USE_MOCKS === 'true' || process.env.VITE_SKIP_DB === 'true';
const conflictStore = new Map();

export async function createConflict(record) {
  if (isMock()) { conflictStore.set(record.id, record); return record; }
  const [result] = await db.insert(ConflictRecord).values(record).returning();
  return result;
}

/**
 * @param {string | import("drizzle-orm").SQLWrapper} entityId
 */
export async function getUnresolvedConflicts(entityId) {
  if (isMock()) return Array.from(conflictStore.values()).filter(c => c.entityId === entityId && c.resolutionStatus === 'PENDING');
  return await db.select().from(ConflictRecord).where(and(eq(ConflictRecord.entityId, entityId), eq(ConflictRecord.resolutionStatus, 'PENDING')));
}

/**
* @param {string | number | boolean | null | undefined} id
* @param {string | number | boolean | null | undefined} resolution
* @param {string | number | boolean | null | undefined} resolvedBy
*/
export async function resolveConflict(id, resolution, resolvedBy) {
  if (isMock()) {
    const c = conflictStore.get(id);
    if(c) { 
      c.resolutionStatus = 'RESOLVED'; 
      c.resolutionRationale = resolution; 
      c.resolvedBy = resolvedBy; 
    }
    return c;
  }
  const [result] = await db.update(ConflictRecord)
    .set({ resolutionStatus: 'RESOLVED', resolutionRationale: resolution, resolvedBy, updatedAt: new Date() })
    .where(eq(ConflictRecord.id, id))
    .returning();
  return result;
}

/**
 * @param {string | import("drizzle-orm").SQLWrapper} id
 */
export async function getConflict(id) {
  if (isMock()) return conflictStore.get(id) || null;
  const result = await db.select().from(ConflictRecord).where(eq(ConflictRecord.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export function clearMockConflicts() {
  if (!isMock()) {
    throw new Error('clearMockConflicts is only available in mock mode');
  }

  conflictStore.clear();
}
