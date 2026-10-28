import { db } from '../../../src/db/index.js';
import { SourceDiff } from '../../../src/db/schema.js';
import { eq, and, desc } from 'drizzle-orm';

const isMock = process.env.USE_MOCKS === 'true' || process.env.VITE_SKIP_DB === 'true';
const diffStore = new Map();

/**
* @param {{ entityType: string | import("drizzle-orm").SQL<unknown> | import("drizzle-orm").Placeholder<string, any>; entityId: string | import("drizzle-orm").SQL<unknown> | import("drizzle-orm").Placeholder<string, any>; diffState: "NEW" | import("drizzle-orm").SQL<unknown> | "UPDATED" | "UNCHANGED" | "REMOVED" | "CONFLICTING" | import("drizzle-orm").Placeholder<string, any>; id?: string | import("drizzle-orm").SQL<unknown> | import("drizzle-orm").Placeholder<string, any> | undefined; sourceId?: string | import("drizzle-orm").SQL<unknown> | import("drizzle-orm").Placeholder<string, any> | null | undefined; previousHash?: string | import("drizzle-orm").SQL<unknown> | import("drizzle-orm").Placeholder<string, any> | null | undefined; currentHash?: string | import("drizzle-orm").SQL<unknown> | import("drizzle-orm").Placeholder<string, any> | null | undefined; changeClassification?: import("drizzle-orm").SQL<unknown> | "RAW_CONTENT_CHANGED" | "NORMALIZED_FACT_CHANGED" | "METADATA_ONLY_CHANGED" | import("drizzle-orm").Placeholder<string, any> | null | undefined; detectedAt?: import("drizzle-orm").SQL<unknown> | Date | import("drizzle-orm").Placeholder<string, any> | undefined; processedAt?: import("drizzle-orm").SQL<unknown> | Date | import("drizzle-orm").Placeholder<string, any> | null | undefined; }} diff
*/
export async function createDiff(diff) {
  if (isMock) { diffStore.set(diff.id, diff); return diff; }
  const [result] = await db.insert(SourceDiff).values(diff).returning();
  return result;
}

/**
 * @param {string | import("drizzle-orm").SQLWrapper} entityType
 * @param {string | import("drizzle-orm").SQLWrapper} entityId
 */
export async function getDiffsByEntity(entityType, entityId) {
  if (isMock) return Array.from(diffStore.values()).filter(d => d.entityType === entityType && d.entityId === entityId);
  return await db.select().from(SourceDiff).where(and(eq(SourceDiff.entityType, entityType), eq(SourceDiff.entityId, entityId))).orderBy(desc(SourceDiff.detectedAt));
}

/**
 * @param {string | import("drizzle-orm").SQLWrapper} id
 */
export async function getDiff(id) {
  if (isMock) return diffStore.get(id) || null;
  const result = await db.select().from(SourceDiff).where(eq(SourceDiff.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}
