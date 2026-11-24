// @ts-nocheck
import logger from '../../_utils/logger.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { requireCapability } from '../../_utils/capabilities.js';
import { adminEnd, adminQueue, adminReinstate, adminReject, adminVerify } from '../../_services/legal-protection.js';

/**
 * G14-R3G — the administrator's queue of the « représentant légal d'un majeur protégé » links (/admin/protection-juridique).
 *   POST { action: 'list' }                                    declarations waiting + contested links, with the declared facts and the two e-mails
 *   POST { action: 'verify', id, method, note, measure, mode?, representativeKind?, mjpmForm?, siret?, scopePerson, scopeAssets, areas, courtName,
 *          decisionDate, measureEndsOn? }                     the facts the EXAMINED decision confirms → VERIFIED
 *   POST { action: 'reject', id, note }                        → REJECTED
 *   POST { action: 'reinstate', id, note }                     a contested (SUSPENDED) link reviewed and kept → VERIFIED
 *   POST { action: 'end', id, reason, note }                   → ENDED (mainlevée, change of measure, contest upheld, death, other)
 * The decision is examined OUTSIDE the platform (shown, certified copy, confirmation by the court's registry): no file is received or stored here and no
 * court document passes through any AI. Named administrator session with MFA (adminGate write). Capability citizen.legal_protection.
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const rate = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rate.allowed) return res.status(getRateLimitStatus(rate)).json(rate.error);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (!requireCapability(res, 'citizen.legal_protection')) return undefined;
  const auth = await adminGate(req, res, { write: true }); if (!auth) return undefined;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    const who = String(auth.email);
    const out = body.action === 'list' ? await adminQueue()
      : body.action === 'verify' ? await adminVerify(who, body)
        : body.action === 'reject' ? await adminReject(who, body)
          : body.action === 'reinstate' ? await adminReinstate(who, body)
            : body.action === 'end' ? await adminEnd(who, body)
              : { ok: false, status: 400, code: 'invalid_action', message: 'action : « list », « verify », « reject », « reinstate » ou « end ».' };
    if (out.ok === false) return res.status(out.status || 400).json({ error: out.code, message: out.message });
    const { ok: _ok, status, ...rest } = out;
    return res.status(status || 200).json(rest);
  } catch (error) {
    logger.error({ err: { name: error?.name, code: error?.code || error?.cause?.code } }, '[admin/legal-protection] failed');
    return res.status(500).json({ error: 'LEGAL_PROTECTION_FAILED' });
  }
}
