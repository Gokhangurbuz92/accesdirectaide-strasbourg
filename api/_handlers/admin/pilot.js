// @ts-nocheck
import logger from '../../_utils/logger.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { aggregatesCsv, deleteSessions, newParticipantCode, pilotReport, recordSession } from '../../_services/pilot-measures.js';

/**
 * Q14 (R31) — pilot measures (rules in api/_services/pilot-measures.js). GET: report (aggregates with suppression + technical indicators) | ?code=new a participant code
 * | ?csv=1 the published aggregates. POST { action: 'record', ...session } | { action: 'delete', id } | { action: 'delete', participantCode } (withdrawn consent).
 */
export default async function handler(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') {
      const auth = await adminGate(req, res); if (!auth) return;
      if (req.query?.code === 'new') return res.status(200).json({ participantCode: newParticipantCode() });
      const out = await pilotReport();
      if (req.query?.csv) return res.status(200).json({ csv: aggregatesCsv(out.journeys), filename: `pilote-agregats-${out.protocolVersion}.csv` });
      return res.status(200).json(out);
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const auth = await adminGate(req, res, { write: true }); if (!auth) return;
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const out = b.action === 'record' ? await recordSession(b, auth.email) : b.action === 'delete' ? await deleteSessions(b) : { ok: false, status: 400, code: 'unknown_action', message: 'Action inconnue.' };
    return out.ok ? res.status(out.status || 200).json(out) : res.status(out.status).json({ error: out.code, message: out.message });
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[Pilot] failed');
    return res.status(500).json({ error: 'PILOT_FAILED', message: 'Les mesures du pilote n’ont pas pu être chargées ou enregistrées. Réessayez.' });
  }
}
