/**
 * PKG-1 / K0 — citizen session resolution (cookie session of a VERIFIED account; the same rules as GET /api/auth/me).
 * Security-critical, type-checked. Never accepts a Bearer token (pro/admin tokens are a different principal).
 */
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { CitizenUser } from '../../src/db/schema.js';
import { getUserSessionTokenFromRequest, verifyUserSessionToken, citizenSessionRevoked } from './user-auth.js';

/** @param {unknown} v */
const norm = (v) => String(v ?? '').trim().toLowerCase();

/**
 * @param {import('./http-types').ApiRequest} req
 * @returns {Promise<{ id: string, email: string, notificationEmailEnabled: boolean, assist: import('./user-auth.js').AssistClaim | null } | null>} null = no valid verified citizen session
 */
export async function resolveCitizen(req) {
  const claims = verifyUserSessionToken(getUserSessionTokenFromRequest(req));
  if (!claims || !claims.userId) return null;
  const user = await db.query.CitizenUser.findFirst({ where: eq(CitizenUser.id, String(claims.userId)), columns: { id: true, email: true, emailVerifiedAt: true, notificationEmailEnabled: true, sessionsValidAfter: true } });
  if (!user || !user.emailVerifiedAt || norm(user.email) !== norm(claims.email)) return null;
  if (citizenSessionRevoked(claims.iat, user.sessionsValidAfter, claims.iatMs)) return null;   // PKG-11 audit: revoked by a reset, a recovery or a logout
  // G14-AID: an assisted session (« mode accompagnant ») is a session only while its row is live (defence in depth: the router gate checks it first)
  if (claims.assist) {
    const { assistSessionLive } = await import('../_services/assisted-mode.js');
    if (!(await assistSessionLive(user.id, claims.assist))) return null;
  }
  return { id: user.id, email: user.email, notificationEmailEnabled: user.notificationEmailEnabled, assist: claims.assist || null };
}

/**
 * @param {import('./http-types').ApiRequest} req @param {{ status: (code: number) => { json: (body: unknown) => unknown } }} res
 * @returns {Promise<{ id: string, email: string, notificationEmailEnabled: boolean, assist: import('./user-auth.js').AssistClaim | null } | null>} the citizen, or null after a 401 was written
 */
export async function requireCitizen(req, res) {
  const citizen = await resolveCitizen(req);
  if (!citizen) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return citizen;
}
