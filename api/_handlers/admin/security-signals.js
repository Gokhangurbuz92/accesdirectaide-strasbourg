// @ts-nocheck
import logger from '../../_utils/logger.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { kv } from '../../_utils/kv.js';
import { db } from '../../../src/db/index.js';
import { securitySignalCounts, evaluateSecuritySignals } from '../../_services/security-signals.js';

/**
 * R46 / Q07 — GET /api/admin/security-signals: the security signals the 5-minute health check watches (refused sign-ins, refused MFA codes, exports of
 * personal or audit data), as counts over their windows with their thresholds, which alerts they call for now, and the security alerts already sent
 * (KV alert log). Aggregates only — no address, no e-mail. A named administrator session (adminGate); read-only.
 */
export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const auth = await adminGate(req, res); if (!auth) return;
    const counts = await securitySignalCounts({ db });
    let sent = [];
    try { sent = ((await kv.get('alert:log')) || []).filter((a) => String(a?.name || '').startsWith('security.')).slice(0, 20).map((a) => ({ name: a.name, timestamp: a.timestamp, details: a.details })); } catch { sent = []; }
    return res.status(200).json({ checkedAt: new Date().toISOString(), counts, alertsNow: evaluateSecuritySignals(counts).map((a) => ({ name: a.name, details: a.details })), alertsSent: sent });
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[SecuritySignals] failed');
    return res.status(500).json({ error: 'SECURITY_SIGNALS_FAILED', message: 'Les signaux de sécurité n’ont pas pu être lus. Réessayez.' });
  }
}
