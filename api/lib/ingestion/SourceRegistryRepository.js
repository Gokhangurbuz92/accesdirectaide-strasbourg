import { db } from '../../../src/db/index.js';
import { SourceRegistryEntry } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';

// Fallback to in-memory for unit tests
const isMock = () => process.env.USE_MOCKS === 'true' || process.env.VITE_SKIP_DB === 'true';
const registry = new Map();

/**
* @param {{ sourceId: any; name: any; type: any; endpoint: any; cronSchedule: any; capabilities: any; producerAuthority: any; distributionPlatform: any; trustedDomains: any; organisation: any; territory: any; licenceUrl: any; licenceName: any; reuseConditions: any; }} entry
*/
export async function upsertSource(entry) {
  if (isMock()) {
    const existing = registry.get(entry.sourceId);
    // Ensure operational state is preserved if already exists
    const merged = existing ? { ...existing, ...entry } : entry;
    registry.set(entry.sourceId, merged);
    return merged;
  }
  
  // Drizzle postgres upsert logic
  const [result] = await db.insert(SourceRegistryEntry)
    .values(entry)
    .onConflictDoUpdate({
      target: SourceRegistryEntry.sourceId,
      set: {
        name: entry.name,
        type: entry.type,
        endpoint: entry.endpoint,
        cronSchedule: entry.cronSchedule,
        capabilities: entry.capabilities,
        producerAuthority: entry.producerAuthority,
        distributionPlatform: entry.distributionPlatform,
        trustedDomains: entry.trustedDomains,
        organisation: entry.organisation,
        territory: entry.territory,
        licenceUrl: entry.licenceUrl,
        licenceName: entry.licenceName,
        reuseConditions: entry.reuseConditions
        // Note: Intentionally excluding operational fields (failureCount, lastSyncAt, status)
        // so they are preserved on conflict.
      }
    })
    .returning();
  return result;
}

/**
 * @param {string | import("drizzle-orm").SQLWrapper} sourceId
 */
export async function getSource(sourceId) {
  if (isMock()) {
    return registry.get(sourceId) || null;
  }
  const result = await db.select().from(SourceRegistryEntry).where(eq(SourceRegistryEntry.sourceId, sourceId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function listSources() {
  if (isMock()) {
    return Array.from(registry.values());
  }
  return await db.select().from(SourceRegistryEntry);
}

export async function clearRegistry() {
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_CLEAR_REGISTRY) {
    throw new Error('Forbidden: Cannot clear registry in production');
  }
  if (isMock()) {
    registry.clear();
  } else {
    await db.delete(SourceRegistryEntry);
  }
}
