// @ts-nocheck
import logger from '../../_utils/logger.js';
import { getCronAuth } from '../../_utils/cronAuth.js';
import { runReferralTimeouts } from '../../_services/referrals.js';

/** PKG-4 / R10 — referral acknowledgement timeouts (GET|POST /api/cron/referral-timeouts, CRON_SECRET): notify the sender once when overdue, expire 14 days later (grant revoked). */
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!getCronAuth(req).ok) return res.status(401).json({ error: 'Unauthorized' });   // CRON_SECRET only (Vercel Cron sends it; a user-agent proves nothing)
  try {
    const summary = await runReferralTimeouts();
    logger.info(summary, '[Cron] referral timeouts');
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[Cron] referral timeouts failed');
    return res.status(500).json({ error: 'Cron referral timeouts failed.' });
  }
}
