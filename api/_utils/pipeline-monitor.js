// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { AuditLog } from '../../../src/db/schema.js';
import logger from '../../_utils/logger.js';

/**
 * 💓 PIPELINE HEARTBEAT MONITORING
 *
 * Enregistre le résultat d'exécution d'un pipeline d'ingestion dans la table AuditLog.
 * Permet de détecter quand un cron échoue silencieusement.
 *
 * @param {string} pipelineName - Nom du pipeline (ex: 'ingest-aids', 'ingest-structures')
 * @param {'success'|'failure'} status - Résultat de l'exécution
 * @param {Record<string, unknown>} [details] - Détails additionnels (durée, nombre d'items, erreur)
 * @returns {Promise<void>}
 *
 * @example
 * import { trackPipeline } from '../../_utils/pipeline-monitor.js';
 * try {
 *     const count = await ingestAids();
 *     await trackPipeline('ingest-aids', 'success', { count, durationMs: Date.now() - start });
 * } catch (err) {
 *     await trackPipeline('ingest-aids', 'failure', { error: err.message });
 * }
 */
export async function trackPipeline(pipelineName, status, details = {}) {
    const log = logger.child({ pipeline: pipelineName });

    try {
        await db.insert(AuditLog).values({
            action: `PIPELINE_${status.toUpperCase()}`,
            entity: 'CronJob',
            actor: pipelineName,
            details: {
                ...details,
                timestamp: new Date().toISOString(),
                environment: process.env.NODE_ENV || 'unknown',
            },
        });

        if (status === 'failure') {
            log.error({ msg: 'pipeline_failure', ...details });

            // Webhook alerting (Slack/Discord compatible)
            const webhookUrl = process.env.ALERT_WEBHOOK_URL || process.env.WEBHOOK_URL;   // launch-readiness item 69: one alert channel (WEBHOOK_URL: former name)
            if (webhookUrl) {
                try {
                    await fetch(webhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            text: `🚨 *Pipeline Failure*: \`${pipelineName}\`\n${JSON.stringify(details)}`,
                        }),
                    });
                } catch (webhookErr) {
                    log.warn({ msg: 'webhook_send_failed', error: webhookErr.message });
                }
            }
        } else {
            log.info({ msg: 'pipeline_success', ...details });
        }
    } catch (err) {
        // Best-effort: don't crash the pipeline because monitoring failed
        // @ts-ignore
        log.error({ msg: 'pipeline_monitor_write_failed', error: err.message });
    }
}
