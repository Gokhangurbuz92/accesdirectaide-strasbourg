import { citizenHandler } from '../../_utils/citizen-handler.js';
import { checkRateLimit, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { requestEmailChange } from '../../_services/email-change.js';

/** POST /api/citizen/email-change { newEmail, password } — launch-readiness item 66 (api/_services/email-change.js). */
export default citizenHandler('email-change', ['POST'], async (/** @type {{ id: string }} */ citizen, /** @type {any} */ req, /** @type {any} */ res) => {
  const limit = /** @type {any} */ (await checkRateLimit('EMAIL_CHANGE', citizen.id));
  if (!limit.allowed) { res.status(getRateLimitStatus(limit)).json(limit.error || { error: 'Too many requests' }); return undefined; }
  return requestEmailChange(citizen.id, req.body || {});
});
