import { db } from '../../../src/db/index.js';
import { AuthToken, CitizenUser } from '../../../src/db/schema.js';
import { and, eq, isNull } from 'drizzle-orm';
import { checkRateLimit, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { getClientIp, hashAuthToken, hashPassword } from '../../_utils/user-auth.js';
import { passwordMessage, passwordProblems } from '../../../src/lib/passwordPolicy.js';

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');

  // R18: the same password rule as the sign-up (src/lib/passwordPolicy.js) and a French `message` on every refusal (the screen showed the English code)
  if (!token) return res.status(400).json({ error: 'Invalid input', message: 'Lien invalide ou expiré : demandez un nouveau lien.' });
  const pwErrors = passwordProblems(password);
  if (pwErrors.length) return res.status(400).json({ error: 'Invalid input', message: passwordMessage(pwErrors), details: pwErrors });

  const ip = getClientIp(req);
  const ipLimit = await checkRateLimit('RESET_USER', `ip:${ip}`);
  if (!ipLimit.allowed) {
    return res.status(getRateLimitStatus(/** @type {{ status?: number }} */ (ipLimit))).json(ipLimit.error || { error: 'Too many attempts' });
  }

  try {
    const tokenHash = hashAuthToken(token);
    const row = await db.query.AuthToken.findFirst({
      where: eq(AuthToken.tokenHash, tokenHash),
      with: { user: true },
    });

    if (!row || row.type !== 'PASSWORD_RESET' || row.usedAt || row.expiresAt <= new Date() || !row.user) {
      return res.status(400).json({ error: 'Invalid or expired token', message: 'Ce lien est expiré ou a déjà servi : demandez un nouveau lien.' });
    }

    const passwordHash = await hashPassword(password);

    // K0: claim the token ATOMICALLY first (single use even when the same link is submitted twice at once), then change the password
    // R12 (C02): claim and password change in ONE transaction — a failed password write used to leave the link burnt and the old password in place
    const changed = await db.transaction(async (tx) => {
      const claimed = await tx.update(AuthToken).set({ usedAt: new Date() }).where(and(eq(AuthToken.id, row.id), isNull(AuthToken.usedAt))).returning({ id: AuthToken.id });
      if (!claimed.length) return false;
      // PKG-11 audit: every existing session ends (pass 2: compared to the millisecond, see citizenSessionRevoked); the e-mailed link proves the mailbox, so an
      // unverified address is verified by it (the « choose your password » step after a contested sign-up)
      await tx.update(CitizenUser).set({ passwordHash, sessionsValidAfter: new Date(), emailVerifiedAt: row.user.emailVerifiedAt || new Date() }).where(eq(CitizenUser.id, row.userId));
      return true;
    });
    if (!changed) return res.status(400).json({ error: 'Invalid or expired token', message: 'Ce lien est expiré ou a déjà servi : demandez un nouveau lien.' });

    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'Internal error', message: 'Le mot de passe n’a pas pu être changé : réessayez dans quelques minutes.' });
  }
}
