// @ts-nocheck
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { EntityVersion } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import logger from './logger.js';

/**
 * Creates a version snapshot of an entity before update.
 * @param {string} type - Entity type (Aide, Demarche, Structure, Actualite)
 * @param {string} id - Entity ID
 * @param {string} actorEmail - Email of the person making the change
 */
export async function createSnapshot(type, id, actorEmail) {
    try {
        const modelName = type.toLowerCase();
        const modelKey = Object.keys(schema).find(k => k.toLowerCase() === modelName);
        if (!modelKey || !db.query[modelKey]) return;
        // @ts-ignore
        const model = schema[modelKey];

        const entity = await db.query[modelKey].findFirst({
            where: eq(model.id, String(id))
        });

        if (!entity) return;

        await db.insert(EntityVersion).values({
            entity_type: type,
            entity_id: String(id),
            snapshot_json: entity,
            actor_email: actorEmail,
            reason: 'Auto-snapshot before update'
        });
    } catch (e) {
        logger.error(`Failed to create snapshot for ${type}:${id}`, e);
    }
}

/**
 * Restores an entity to a previous version.
 * @param {string} versionId - The ID of the version to restore
 * @param {string} actorEmail - Email of the person restoring
 */
export async function restoreVersion(versionId, actorEmail) {
    const version = await db.query.EntityVersion.findFirst({
        where: eq(EntityVersion.id, versionId)
    });

    if (!version) throw new Error('Version not found');

    const modelName = version.entity_type.toLowerCase();

    // Create a snapshot of the CURRENT state before rolling back
    await createSnapshot(version.entity_type, version.entity_id, actorEmail);

    // Restore the data
    const modelKey = Object.keys(schema).find(k => k.toLowerCase() === modelName);
    const model = schema[modelKey];
    
    // update returns array. Let's return the first updated element.
    const [restored] = await db.update(model).set(version.snapshot_json).where(eq(model.id, version.entity_id)).returning();

    return restored;
}
