// @ts-nocheck
import logger from '../../_utils/logger.js';
import { getCronAuth, scheduledByVercel } from '../../_utils/cronAuth.js';
import { runReferralTimeouts } from '../../_services/referrals.js';
import { startCronRun, finishCronRun, countsOnly } from '../../_utils/cron-run.js';
import { db } from '../../../src/db/index.js';

/** PKG-4 / R10 — referral acknowledgement timeouts (GET|POST /api/cron/referral-timeouts, CRON_SECRET): notify the sender once when overdue, expire 14 days later (grant revoked). */
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!getCronAuth(req).ok) return res.status(401).json({ error: 'Unauthorized' });   // CRON_SECRET only (Vercel Cron sends it; a user-agent proves nothing)
  // RA-03: a run record around the job (the job itself, api/_services/referrals.js, is unchanged) — counts only, no referral or person identifier
  const startedAtMs = Date.now();
  const cronRunId = await startCronRun(db, 'referral-timeouts', { trigger: scheduledByVercel(req) ? 'vercel-cron' : 'manual' });
  try {
    const summary = await runReferralTimeouts();
    logger.info(summary, '[Cron] referral timeouts');
    const failed = Number(summary?.expiredNoticeFailed || 0) + Number(summary?.pendingCitizenNoticeFailed || 0) + Number(summary?.overdueRetry || 0);
    await finishCronRun(db, cronRunId, summary?.skipped ? { status: 'skipped', skipReason: String(summary.skipped), startedAtMs, metrics: countsOnly(summary) }
      : { status: failed > 0 ? 'partial' : 'success', startedAtMs, metrics: countsOnly(summary) });
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[Cron] referral timeouts failed');
    await finishCronRun(db, cronRunId, { status: 'failed', startedAtMs, error: error?.name || 'Error' });
    return res.status(500).json({ error: 'Cron referral timeouts failed.' });
  }
}
