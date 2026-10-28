import { eq } from 'drizzle-orm';
import { db } from '../../../src/db/index.js';
import { Territory } from '../../../src/db/schema.js';

/**
 * Ensures a territory exists before referencing it.
 * Used for application-level referential integrity.
 * @param {string | import("drizzle-orm").SQLWrapper} territoryId
 */
export async function assertTerritoryExists(territoryId) {
  if (!territoryId) throw new Error('Missing territoryId');
  const [record] = await db.select({ id: Territory.id })
    .from(Territory)
    .where(eq(Territory.id, territoryId))
    .limit(1);
  if (!record) {
    throw new Error(`Referential integrity violation: territory ${territoryId} does not exist`);
  }
}

/**
 * @param {{ territoryId: string | import("drizzle-orm").SQLWrapper; }} entry
 */
export async function validateTerritoryLabelHistory(entry) {
  await assertTerritoryExists(entry.territoryId);
  return true;
}

/**
 * @param {{ sourceId: string | import("drizzle-orm").SQLWrapper; targetId: string | import("drizzle-orm").SQLWrapper; }} relation
 */
export async function validateTerritoryRelation(relation) {
  await assertTerritoryExists(relation.sourceId);
  await assertTerritoryExists(relation.targetId);
  return true;
}

/**
 * @param {{ territoryId: string | import("drizzle-orm").SQLWrapper; }} applicability
 */
export async function validateApplicability(applicability) {
  await assertTerritoryExists(applicability.territoryId);
  return true;
}

/**
 * @param {{ serviceType: string; territoryId: string | import("drizzle-orm").SQLWrapper; }} ssa
 */
export async function validateStructureServiceArea(ssa) {
  if (ssa.serviceType !== 'NATIONAL') {
    if (!ssa.territoryId) throw new Error('territoryId required for non-NATIONAL service areas');
    await assertTerritoryExists(ssa.territoryId);
  }
  return true;
}
