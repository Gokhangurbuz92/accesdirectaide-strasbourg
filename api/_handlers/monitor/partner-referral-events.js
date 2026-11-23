/**
 * FA-D7 — POST /api/monitor/partner/referral-events?partner=<id>: a connected partner organization answers a referral FROM ITS OWN TOOL
 * (contract ada.partner-referral/1, api/lib/partner-adapter/contract.js).
 *
 *   Closed by default, three locks: the capability `partner.referral_adapter` (outside the AIPD, HDS-bound — api/_utils/capabilities.js refuses 503 before
 *   this code runs), the configuration (ADA_PARTNER_ADAPTERS + the partner's secret; production also ADA_PARTNER_ADAPTERS_PRODUCTION_APPROVED=true), and
 *   the signature. Not configured / unknown partner → 404 (graceful no-integration: nothing changes on the native ADA Pro path).
 *   Under /monitor/ because that prefix is the one the byte-pinned CSRF middleware exempts for server-to-server calls (no cookie, no Origin).
 *   Answers: 200 applied (or replay of the first answer), 400 invalid body, 401 bad / stale signature, 404 not found, 409 refused by the referral rules,
 *   413 body too large, 429 over the per-partner budget (PARTNER_CALLBACK, api/_utils/rateLimit.js). Nothing about the person is logged or answered.
 */
import logger from '../../_utils/logger.js';
import { verifySignature, SIGNATURE_HEADER } from '../../lib/partner-adapter/contract.js';
import { partnerById, PARTNER_ID } from '../../lib/partner-adapter/config.js';
import { applyPartnerCallback } from '../../_services/partner-adapter.js';
import { checkRateLimit, getRateLimitStatus } from '../../_utils/rateLimit.js';

const MAX_BODY_BYTES = 16 * 1024;

/**
 * @param {{ method?: string, headers?: Record<string, unknown>, body?: unknown, query?: Record<string, unknown>, url?: string }} req
 * @param {{ status: (code: number) => { json: (b: unknown) => unknown }, setHeader: (k: string, v: string) => unknown }} res
 * @param {{ apply?: typeof applyPartnerCallback, envVars?: Record<string, string | undefined>, nowSeconds?: number, rateLimit?: (action: string, key: string) => Promise<any> }} [deps]
 */
export default async function partnerReferralEventsHandler(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (String(req.method || '').toUpperCase() !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  let id = String(req.query?.partner ?? '');
  if (!id) { try { id = new URL(String(req.url || '/'), 'http://localhost').searchParams.get('partner') || ''; } catch { id = ''; } }
  const partner = PARTNER_ID.test(id) ? partnerById(id, deps.envVars || process.env) : null;
  if (!partner) return res.status(404).json({ error: 'Not Found' });
  const length = Number(req.headers?.['content-length'] || 0);
  if (length > MAX_BODY_BYTES || JSON.stringify(req.body ?? null).length > MAX_BODY_BYTES) return res.status(413).json({ error: 'BODY_TOO_LARGE' });
  // R3: per-partner request budget (a partner's tool in a loop, or a flood of forged calls naming a partner id), checked before the signature work
  const rl = await (deps.rateLimit || checkRateLimit)('PARTNER_CALLBACK', `partner:${partner.id}`);
  if (rl && rl.allowed === false) return res.status(getRateLimitStatus(rl)).json({ error: 'TOO_MANY_REQUESTS' });
  let sig = verifySignature({ header: req.headers?.[SIGNATURE_HEADER], body: req.body, secret: partner.secret, nowSeconds: deps.nowSeconds });
  // R3 key rotation: while ADA_PARTNER_SECRET_<ID>_PREVIOUS is set, a callback signed with the retiring secret is still accepted (recorded as such)
  if (!sig.ok && sig.reason === 'BAD_SIGNATURE' && partner.previousSecret) {
    const prev = verifySignature({ header: req.headers?.[SIGNATURE_HEADER], body: req.body, secret: partner.previousSecret, nowSeconds: deps.nowSeconds });
    if (prev.ok) { sig = prev; logger.info({ msg: 'partner_callback.previous_secret', partner: partner.id }, '[partner-adapter] signed with the retiring secret'); }
  }
  if (!sig.ok) {
    logger.warn({ msg: 'partner_callback.unauthorized', partner: partner.id, reason: sig.reason }, '[partner-adapter] refused');
    return res.status(401).json({ error: 'UNAUTHORIZED', reason: sig.reason });
  }
  try {
    const out = await (deps.apply || applyPartnerCallback)(partner, req.body);
    return res.status(out.status).json(out.body);
  } catch (error) {
    logger.error({ msg: 'partner_callback.failed', partner: partner.id, err: { name: error instanceof Error ? error.name : 'Error' } }, '[partner-adapter] failed');
    // the partner retries: the referral transition is conditional (never applied twice); an already-applied step is answered as a replay or refused 409
    return res.status(500).json({ error: 'NOT_APPLIED' });
  }
}
