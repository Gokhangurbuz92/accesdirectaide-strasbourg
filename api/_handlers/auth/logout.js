import { eq } from 'drizzle-orm';
import { db } from '../../../src/db/index.js';
import { CitizenUser } from '../../../src/db/schema.js';
import { buildUserSessionCookieClear, getUserSessionTokenFromRequest, verifyUserSessionToken } from '../../_utils/user-auth.js';

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // PKG-11 audit: a server-side logout — the token itself stops working (a copied cookie used to stay valid for 7 days after « Se déconnecter »)
  const claims = verifyUserSessionToken(getUserSessionTokenFromRequest(req));
  // R12 (C01): a failed revocation is no longer reported as a logout — the browser copy is cleared, but the person is told the server did not confirm
  // (the client says so and advises closing the browser on a shared device)
  let revoked = true;
  if (claims?.userId) revoked = await db.update(CitizenUser).set({ sessionsValidAfter: new Date()   /* pass 2: exact, the token carries iat_ms */ }).where(eq(CitizenUser.id, claims.userId)).then(() => true, () => false);
  // G14-AID: signing out of an assisted session ends it in the person's history (the revocation above ends it anyway)
  if (claims?.assist) await import('../../_services/assisted-mode.js').then((m) => m.endAssistOnLogout(claims.userId, claims.assist)).catch(() => {});
  res.setHeader('Set-Cookie', buildUserSessionCookieClear());
  if (!revoked) return res.status(503).json({ ok: false, error: 'LOGOUT_NOT_CONFIRMED' });
  return res.status(200).json({ ok: true });
}

