// @ts-nocheck
import logger from '../../_utils/logger.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { dataQualitySummary } from '../../_services/data-quality-summary.js';

/** PKG-5 / A08 — GET /api/admin/data-quality: WS2 workflow state, review queue age, public reports (administrator sessions; counts only). */
export default async function handler(req, res) {
  const auth = await adminGate(req, res); if (!auth) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try { return res.status(200).json(await dataQualitySummary()); }
  catch (error) { logger.error({ err: { name: error?.name } }, '[DataQuality] failed'); return res.status(500).json({ error: 'DQ_FAILED', message: 'La synthèse de qualité n’a pas pu être calculée. Réessayez.' }); }
}
