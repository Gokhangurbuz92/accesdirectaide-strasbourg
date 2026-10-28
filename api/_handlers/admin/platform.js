// @ts-nocheck
import logger from '../../_utils/logger.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { listFlags, setKillSwitch } from '../../_services/feature-flags.js';

/**
 * PKG-5 / A15 A16 — platform operations (Super Admin surface).
 *   GET  -> feature flags (environment, override, effective)
 *   POST { action: 'flag', key, forcedOff, reason } -> kill switch / clear (MFA + elevation, audited)
 */
export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const auth = await adminGate(req, res); if (!auth) return;
      return res.status(200).json({ flags: await listFlags() });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const auth = await adminGate(req, res, { elevated: true }); if (!auth) return;
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (b.action !== 'flag') return res.status(400).json({ error: 'unknown_action' });
    const out = await setKillSwitch(String(b.key || ''), { forcedOff: b.forcedOff === true, reason: b.reason }, auth.email);
    return out.ok ? res.status(200).json(out) : res.status(out.status).json({ error: out.code, message: out.message });
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[Platform] failed');
    return res.status(500).json({ error: 'PLATFORM_FAILED', message: 'Les fonctions de la plateforme n’ont pas pu être lues ou modifiées. Réessayez.' });
  }
}
