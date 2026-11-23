// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { checkRateLimit, getClientIp } from '../../_utils/rateLimit.js';
import { socialReferralRequestRefusal } from '../../lib/social-referral-policy.js';
import { socialReferralsCitizen } from '../../_services/social-referrals.js';

/**
 * G14-PS — « Mes orientations sociales » (non-HDS).  GET -> { available, referrals }
 *   POST { action: 'claim', code }   POST { action: 'decide', id, decision: 'accept' | 'refuse', shareEmail?, sharePhone? }   POST { action: 'withdraw', id }
 * Nothing is shared before 'accept'; the person may withdraw at any time. No other field is accepted (no free text, no file).
 */
export default citizenHandler('social-referrals', ['GET', 'POST'], async (citizen, req) => {
  const refusal = socialReferralRequestRefusal('citizen', { method: req.method, body: req.body, query: req.query });
  if (refusal) return refusal;
  const svc = socialReferralsCitizen();
  if (req.method === 'GET') return svc.list(citizen.id);
  const b = req.body;
  if (b.action === 'claim') {
    const limit = await checkRateLimit('SOCIAL_REFERRAL_CLAIM', `${citizen.id}:${getClientIp(req)}`);
    if (!limit.allowed) return { ok: false, status: 429, code: 'RATE_LIMITED', message: 'Trop d’essais. Réessayez dans quelques minutes.' };
    return svc.claim(citizen.id, b.code);
  }
  if (b.action === 'decide') return svc.decide(citizen.id, b);
  return svc.withdraw(citizen.id, b.id);
});
