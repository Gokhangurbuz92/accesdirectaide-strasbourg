// @ts-nocheck
import { requireProStructureContext } from '../../_utils/auth.js';
import { withProRdvHandler } from '../../_utils/with-pro-rdv-handler.js';
import { withCapability } from '../../_utils/capabilities.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { socialReferralRequestRefusal } from '../../lib/social-referral-policy.js';
import { socialReferralsPro } from '../../_services/social-referrals.js';

/**
 * G14-PS — the social referrals of the caller's organisation (non-HDS; rules in api/lib/social-referral-policy.js, flow in api/_services/social-referrals.js).
 *   GET ?box=inbox|outbox  -> list        GET ?id=  -> one referral        GET ?receivers=<q>  -> eligible NOT_ESSMS receivers
 *   POST { action: 'propose', toStructureId, reasonCodes[1..3], idempotencyKey? }  -> { referral, code }  (the one-time code to give to the person)
 *   POST { action: 'accept' | 'complete' | 'cancel' | 'new_code', id }     POST { action: 'decline', id, responseCode }
 *   POST { action: 'assisted_consent', id, email, password, decision, shareEmail?, sharePhone? }  (typed BY THE PERSON on this screen; rate-limited)
 * Every other field is refused before any database access (400 FIELD_NOT_ALLOWED): there is no free-text and no file field. Second factor required.
 */
async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const ctx = requireProStructureContext(req, res);
  if (!ctx) return undefined;
  ctx.mfa = req.user?.mfa === true;
  const refusal = socialReferralRequestRefusal('pro', { method: req.method, body: req.body, query: req.query });
  const send = (out) => (out.ok === false ? res.status(out.status || 400).json({ error: out.code, message: out.message }) : res.status(out.status || 200).json((({ ok, status, ...b }) => b)(out)));
  if (refusal) return send(refusal);
  const svc = socialReferralsPro();
  const q = req.query || {};
  if (req.method === 'GET') {
    if (q.receivers !== undefined) return send(await svc.receivers(ctx, String(q.receivers || '')));
    return send(q.id ? await svc.get(ctx, q.id) : await svc.list(ctx, String(q.box || 'inbox')));
  }
  const b = req.body;
  switch (b.action) {
    case 'propose': return send(await svc.propose(ctx, b));
    case 'cancel': return send(await svc.cancel(ctx, b.id));
    case 'new_code': return send(await svc.newCode(ctx, b.id));
    case 'accept': case 'complete': return send(await svc.answer(ctx, b.id, b.action));
    case 'decline': return send(await svc.answer(ctx, b.id, 'decline', b.responseCode));
    case 'assisted_consent': {
      const limit = await checkRateLimit('SOCIAL_REFERRAL_ASSISTED', `${ctx.userId}:${getClientIp(req)}`);
      if (!limit.allowed) return res.status(getRateLimitStatus(limit)).json(limit.error || { error: 'Too many requests' });
      return send(await svc.assistedConsent(ctx, b));
    }
    default: return send({ ok: false, status: 400, code: 'INVALID_ACTION', message: 'Action inconnue.' });
  }
}

// outside the AIPD — refused before authentication and any database access while the capability is closed (api/_utils/capabilities.js)
export default withCapability('pro.referrals_social', withProRdvHandler('pro.referrals_social', handler));
