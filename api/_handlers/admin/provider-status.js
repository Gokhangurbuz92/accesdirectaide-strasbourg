// @ts-nocheck
import logger from '../../_utils/logger.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { providerStatuses, summarizeProviders } from '../../_services/provider-status.js';

/**
 * R46 / N10 — GET /api/admin/provider-status: the integration status of every provider adapter (CONNECTED / SIMULATED / NOT_CONFIGURED), from the
 * presence of environment variables only — names, never values; no provider is called. A named administrator session (adminGate); read-only.
 */
export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const auth = await adminGate(req, res); if (!auth) return;
    const providers = providerStatuses(process.env);
    return res.status(200).json({ checkedAt: new Date().toISOString(), basis: 'ENV_PRESENCE_ONLY', summary: summarizeProviders(providers), providers });
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[ProviderStatus] failed');
    return res.status(500).json({ error: 'PROVIDER_STATUS_FAILED', message: 'L’état des fournisseurs n’a pas pu être lu. Réessayez.' });
  }
}
