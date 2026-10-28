// @ts-nocheck
import logger from '../../_utils/logger.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { listAll, createAgreement, recordSignature, endAgreement, createAccount, setAccountStatus, resetInstitutionPassword } from '../../_services/institutions.js';
import { observatoire } from '../../_services/territorial-stats.js';

/**
 * PKG-5 / I05 — partner agreements and institutional accounts. GET: list (+ observatoire preview). POST { action }:
 *   agreement_create | agreement_sign | agreement_end   (MFA)
 *   account_create | account_activate | account_suspend | account_password_reset (R21; MFA + elevation: an external party gets access)
 */
export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const auth = await adminGate(req, res); if (!auth) return;
      return res.status(200).json({ ...(await listAll()), observatoire: req.query?.view === 'observatoire' ? await observatoire() : undefined });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const elevated = String(b.action || '').startsWith('account_');
    const auth = await adminGate(req, res, { write: true, elevated }); if (!auth) return;
    const act = {
      agreement_create: () => createAgreement(b, auth.email),
      agreement_sign: () => recordSignature(b.id, b, auth.email),
      agreement_end: () => endAgreement(b.id, auth.email),
      account_create: () => createAccount(b, auth.email),
      account_activate: () => setAccountStatus(b.id, 'ACTIVATE', auth.email),
      account_suspend: () => setAccountStatus(b.id, 'SUSPEND', auth.email),
      account_password_reset: () => resetInstitutionPassword(b.id, auth.email),
    }[String(b.action || '')];
    if (!act) return res.status(400).json({ error: 'unknown_action' });
    const out = await act();
    return out.ok ? res.status(200).json(out) : res.status(out.status).json({ error: out.code, message: out.message });
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[Institutions] failed');
    return res.status(500).json({ error: 'INSTITUTIONS_FAILED', message: 'Les partenaires institutionnels n’ont pas pu être chargés ou modifiés. Réessayez.' });
  }
}
