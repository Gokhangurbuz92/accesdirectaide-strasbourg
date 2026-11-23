// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { checkRateLimit, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { buildUserSessionCookie, buildUserSessionCookieClear, signUserSessionToken } from '../../_utils/user-auth.js';
import { assistOverview, endCurrentAssist, endOtherAssist, startAssist } from '../../_services/assisted-mode.js';

/**
 * G14-AID — « mode accompagnant » next to the person (api/_services/assisted-mode.js). Capability citizen.assisted_mode.
 *   GET  -> { current, sessions: [{ sid, helper, areas, startedAt, until, endedAt, endedBy, live, events: [{ at, kind, area, label, outcome }] }], limits }
 *   POST { action: 'start', password, consent: true, helperName, helperRole, structureName?, proEmail?, proCode?, areas, minutes }  (from a normal session)
 *        -> 201 { session } and the session cookie becomes the assisted one (it ends at the chosen time)
 *   POST { action: 'end' }                                   (from the assisted session) -> signed out at once
 *   POST { action: 'end', continueAlone: true, password }    (from the assisted session) -> a normal session again
 *   POST { action: 'end-session', sid }                      (from another, normal session of the person) -> that assisted session ends at once
 */
export default citizenHandler('assist', ['GET', 'POST'], async (citizen, req, res) => {
  if (req.method === 'GET') return assistOverview(citizen);
  const body = req.body || {};
  if (body.action === 'start' || (body.action === 'end' && body.continueAlone === true)) {
    const limit = await checkRateLimit('ASSIST_REAUTH', citizen.id);
    if (!limit.allowed) { res.status(getRateLimitStatus(limit)).json(limit.error || { error: 'Too many requests' }); return undefined; }
  }
  if (body.action === 'start') {
    const out = await startAssist(citizen, body);
    if (!out.ok) return out;
    const token = signUserSessionToken({ userId: citizen.id, email: citizen.email }, { assist: out.claim, maxAgeSeconds: out.maxAgeSeconds });
    res.setHeader('Set-Cookie', buildUserSessionCookie(token, { maxAgeSeconds: out.maxAgeSeconds }));
    return { ok: true, status: 201, session: out.session };
  }
  if (body.action === 'end') {
    const out = await endCurrentAssist(citizen, body);
    if (!out.ok) return out;
    res.setHeader('Set-Cookie', out.continueAlone ? buildUserSessionCookie(signUserSessionToken({ userId: citizen.id, email: citizen.email })) : buildUserSessionCookieClear());
    return { ok: true, status: 200, ended: true, signedOut: !out.continueAlone };
  }
  if (body.action === 'end-session') return endOtherAssist(citizen, body.sid);
  return { ok: false, status: 400, code: 'INVALID_ACTION', message: 'Action inconnue.' };
});
