import { db } from '../../../src/db/index.js';
import { FreshnessPolicy } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';

const isMock = process.env.USE_MOCKS === 'true' || process.env.VITE_SKIP_DB === 'true';
const policyStore = new Map();

/**
 * @param {string | import("drizzle-orm").SQLWrapper} sourceId
 */
export async function getPolicyForSource(sourceId) {
  if (isMock) return Array.from(policyStore.values()).find(p => p.sourceId === sourceId) || null;
  const result = await db.select().from(FreshnessPolicy).where(eq(FreshnessPolicy.sourceId, sourceId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

/**
* @param {{ id: any; ttlDays: any; actionOnExpire: any; priority: any; isActive: any; }} policy
*/
export async function upsertPolicy(policy) {
  if (isMock) { policyStore.set(policy.id, policy); return policy; }
  const [result] = await db.insert(FreshnessPolicy)
    .values(policy)
    .onConflictDoUpdate({
      target: FreshnessPolicy.id,
      set: {
        ttlDays: policy.ttlDays,
        actionOnExpire: policy.actionOnExpire,
        priority: policy.priority,
        isActive: policy.isActive,
        updatedAt: new Date()
      }
    })
    .returning();
  return result;
}

export async function listPolicies() {
  if (isMock) return Array.from(policyStore.values());
  return await db.select().from(FreshnessPolicy);
}
