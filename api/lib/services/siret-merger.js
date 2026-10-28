// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { Structure, Aide, Demarche } from '../../../src/db/schema.js';
import { eq, inArray } from 'drizzle-orm';
import logger from '../../_utils/logger.js';

/**
 * Merge duplicate structures sharing the same SIRET.
 * Returns the primary (surviving) structure ID and the number of merged duplicates.
 * @param {string | import("drizzle-orm").SQLWrapper} siret
 */
export async function mergeStructuresBySiret(siret) {
  if (!siret) throw new Error('SIRET is required for merging');
  
  const structures = await db.select().from(Structure).where(eq(Structure.siret, siret)).orderBy(Structure.createdAt);
  
  if (structures.length <= 1) {
    return { success: true, primaryId: structures[0]?.id || null, mergedCount: 0 };
  }

  const primary = structures[0];
  const duplicateIds = structures.slice(1).map(s => s.id);

  try {
    await db.transaction(async (tx) => {
      // Reassign Aides
      await tx.update(Aide)
        .set({ structureId: primary.id })
        .where(inArray(Aide.structureId, duplicateIds));

      // Reassign Demarches
      await tx.update(Demarche)
        .set({ structureId: primary.id })
        .where(inArray(Demarche.structureId, duplicateIds));

      // Delete the duplicates
      await tx.delete(Structure).where(inArray(Structure.id, duplicateIds));
    });

    logger.info(`Merged ${duplicateIds.length} duplicate structures into primary ${primary.id} for SIRET ${siret}`);
    return { success: true, primaryId: primary.id, mergedCount: duplicateIds.length };
  } catch (error) {
    logger.error('Failed to merge duplicate structures', { siret, error: error.message });
    throw error;
  }
}
