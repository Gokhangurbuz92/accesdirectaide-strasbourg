import logger from '../../_utils/logger.js';

/**
 * Agent Alerter
 *
 * Mission : Notifier les pros des changements
 * pertinents pour leurs bénéficiaires.
 *
 * Crée des ProNotification en DB pour chaque changement détecté.
 */

export class Alerter {
    constructor() {
        this.name = 'alerter';
    }

    /**
     * @param {Array<{id: string, titre: string, category?: string}>} changes
     * @returns {Promise<{ok: boolean, notified: number}>}
     */
    async notify(changes) {
        if (!changes || changes.length === 0) {
            return { ok: true, notified: 0 };
        }

        let notified = 0;

        try {
            const { db } = await import('../../../src/db/index.js');
            const { ProUser, ProNotification } = await import('../../../src/db/schema.js');

            // Get all pro users (limited for safety)
            const pros = await db.select({
                id: ProUser.id,
                structureId: ProUser.structureId,
            }).from(ProUser).where((await import('drizzle-orm')).eq(ProUser.status, 'active')).limit(50);   // PKG-4 / R20: never a disabled account

            for (const change of changes) {
                for (const pro of pros) {
                    try {
                        await db.insert(ProNotification).values({
                            userId: pro.id,
                            structureId: pro.structureId || pro.id,
                            type: 'NEW_AIDE',
                            title: `Nouvelle aide : ${String(change.titre || 'Sans titre').slice(0, 200)}`,
                            message: `Une nouvelle aide a été détectée dans la catégorie ${change.category || 'Générale'}.`,
                            metadata: { delivery: { inApp: 'STORED', email: 'NOT_EMAILABLE' } },
                        }).onConflictDoNothing();
                        notified++;
                    } catch {
                        // Skip duplicates or constraint violations
                    }
                }
            }
        } catch (error) {
            logger.error({
                msg: 'agent.alerter.db_error',
                error: (/** @type {Error} */ (error)).message,
                note: 'DB access failed — notifications skipped',
            });
        }

        logger.info({
            msg: 'agent.alerter.complete',
            changes: changes.length,
            notified,
        });

        return { ok: true, notified };
    }
}
