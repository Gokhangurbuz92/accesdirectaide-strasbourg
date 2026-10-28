// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { SyncRun } from '../../../src/db/schema.js';
import { eq, and, sql, asc } from 'drizzle-orm';
import logger from '../../_utils/logger.js';
import { runIngestStructures } from '../../_handlers/cron/ingest-structures.js';
import { runIngestAids } from '../../_handlers/cron/ingest-aids.js';
import { getSource } from './SourceRegistry.js';

/*
 * PKG-11 / A06: the queue never ran a job. The job's source was read as `job.sourceId` (the column is source_id → « Source not found », retried forever), the
 * timing and counts were written to columns that do not exist (startedAt, completedAt, addedItems…: silently dropped), and `status = PENDING AND nextRunAt IS
 * NULL OR nextRunAt <= now` lacked parentheses, so an old FAILED row was picked first, its claim failed, and the PENDING jobs behind it starved. Oldest first.
 */
export async function consumePendingSyncRuns() {
  logger.info('[SyncQueue] Checking for PENDING SyncRuns...');
  
  // Find one pending job
  const now = new Date();
  const pendingJobs = await db.select().from(SyncRun)
    .where(and(
      eq(SyncRun.status, 'PENDING'),
      sql`("nextRunAt" IS NULL OR "nextRunAt" <= ${now.toISOString()})`
    ))
    .orderBy(asc(SyncRun.createdAt))
    .limit(1);

  if (pendingJobs.length === 0) {
    return { ok: true, message: 'No pending jobs' };
  }

  const job = pendingJobs[0];
  const sourceId = job.source_id ?? job.sourceId;
  logger.info(`[SyncQueue] Found PENDING job ${job.id} for source ${sourceId}, attempting claim...`);

  // Atomic claim: Only update if it is still PENDING
  const claimedJobs = await db.update(SyncRun)
    .set({ status: 'RUNNING', started_at: new Date() })
    .where(and(
      eq(SyncRun.id, job.id),
      eq(SyncRun.status, 'PENDING')
    ))
    .returning();

  if (claimedJobs.length === 0) {
    logger.info(`[SyncQueue] Job ${job.id} was already claimed by another worker.`);
    return { ok: true, message: 'Job claimed by another worker' };
  }

  logger.info(`[SyncQueue] Successfully claimed job ${job.id}`);

  try {
    let stats = { created: 0, processed: 0, errors: [] };
    
    // Fake a route map for the POC (e.g. data.gouv.fr vs france-services)
    const source = await getSource(sourceId);
    if (!source) throw new Error('Source not found in registry');

    // Route to actual logic based on SourceRegistry capabilities
    if (source.capabilities.includes('DIRECTORY')) {
        stats = await runIngestStructures({ limit: 5, runId: job.id });
    } else if (source.capabilities.includes('OPEN_DATA_CATALOG')) {
        stats = await runIngestAids({ limit: 5, runId: job.id });
    } else {
        throw new Error('Unsupported source capabilities for async trigger');
    }

    // Mark COMPLETE or PARTIAL
    const finalStatus = stats.errors?.length > 0 ? 'PARTIAL' : 'COMPLETE';
    await db.update(SyncRun)
      .set({
        status: finalStatus,
        ended_at: new Date(),
        stats: { totalItems: stats.processed || 0, addedItems: stats.created || 0, updatedItems: stats.updated || 0, deletedItems: 0, errorCount: stats.errors?.length || 0, errorMessage: null },
      })
      .where(eq(SyncRun.id, job.id));
      
    logger.info(`[SyncQueue] Job ${job.id} finished with status ${finalStatus}`);
    return { ok: true, jobId: job.id, status: finalStatus, stats };
  } catch (err) {
    logger.error(`[SyncQueue] Job ${job.id} failed:`, err);
    // Mark FAILED
    const attempts = (job.attempts || 0) + 1;
    if (attempts >= 5) {
      await db.update(SyncRun)
        .set({
          status: 'FAILED',
          ended_at: new Date(),
          error: JSON.stringify({ message: err.message, exhausted: true }),
          attempts
        })
        .where(eq(SyncRun.id, job.id));
    } else {
      const delay = 60000 * Math.pow(2, attempts);
      const nextRunAt = new Date(Date.now() + delay);
      await db.update(SyncRun)
        .set({ 
          status: 'PENDING', 
          attempts,
          nextRunAt,
          error: JSON.stringify({ message: err.message })
        })
        .where(eq(SyncRun.id, job.id));
    }
    return { ok: false, jobId: job.id, status: 'FAILED', error: err.message };
  }
}
