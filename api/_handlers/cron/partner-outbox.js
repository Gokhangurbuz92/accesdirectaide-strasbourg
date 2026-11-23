// @ts-nocheck
import logger from '../../_utils/logger.js';
import { getCronAuth, scheduledByVercel } from '../../_utils/cronAuth.js';
import { capabilityOpen } from '../../_utils/capabilities.js';
import { runPartnerOutbox } from '../../_services/partner-adapter.js';
import { startCronRun, finishCronRun, countsOnly } from '../../_utils/cron-run.js';
import { db } from '../../../src/db/index.js';

/**
 * FA-D7 — partner referral outbox (GET|POST /api/cron/partner-outbox, CRON_SECRET): sends the signed events of ada.partner-referral/1 to the connected
 * partner organizations (api/_services/partner-adapter.js). Job category C (it concerns referrals of persons: ADA_BETA_OPEN_JOBS + ADA_JOBS_APPROVED during
 * the beta), scheduled hourly in vercel.json since R3 (refused by the beta gate until named AND approved), and skipped while the capability partner.referral_adapter is closed or no partner is configured.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!getCronAuth(req).ok) return res.status(401).json({ error: 'Unauthorized' });
  if (!capabilityOpen('partner.referral_adapter')) return res.status(200).json({ ok: true, skipped: 'CAPABILITY_CLOSED' });
  const startedAtMs = Date.now();
  const cronRunId = await startCronRun(db, 'partner-outbox', { trigger: scheduledByVercel(req) ? 'vercel-cron' : 'manual' });
  try {
    const summary = await runPartnerOutbox();
    logger.info(countsOnly(summary), '[Cron] partner outbox');
    await finishCronRun(db, cronRunId, summary.noIntegration ? { status: 'skipped', skipReason: `NO_INTEGRATION_${summary.state}`, startedAtMs, metrics: countsOnly(summary) }
      : { status: summary.failed > 0 ? 'partial' : 'success', startedAtMs, metrics: countsOnly(summary) });
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[Cron] partner outbox failed');
    await finishCronRun(db, cronRunId, { status: 'failed', startedAtMs, error: error?.name || 'Error' });
    return res.status(500).json({ error: 'Cron partner outbox failed.' });
  }
}
