import { db } from '../../../src/db/index.js';
import { AuthToken, CitizenUser } from '../../../src/db/schema.js';
import { and, eq, isNull } from 'drizzle-orm';
import { generateAuthToken, hashAuthToken, isUnsetPassword, normalizeNextPath, redirect } from '../../_utils/user-auth.js';

const CHOOSE_PASSWORD_TTL_MS = 15 * 60 * 1000;   // as the e-mailed reset links

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {string} key
 * @returns {string}
 */
function getQueryParam(req, key) {
  const direct = req?.query?.[key];
  if (typeof direct === 'string') return direct;
  if (Array.isArray(direct) && typeof direct[0] === 'string') return direct[0];

  try {
    const url = new URL(req.url || '', 'http://localhost');
    return String(url.searchParams.get(key) || '');
  } catch {
    return '';
  }
}

/**
 * @param {string} status
 * @param {string} nextPath
 * @returns {string}
 */
function buildUiRedirect(status, nextPath) {
  const safeNext = normalizeNextPath(nextPath, '/annuaire');
  return `/auth/verify-email?status=${encodeURIComponent(status)}&next=${encodeURIComponent(safeNext)}`;
}

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const token = String(getQueryParam(req, 'token') || '').trim();
  const nextPath = getQueryParam(req, 'next');

  if (!token) {
    return redirect(res, buildUiRedirect('invalid', nextPath), 302);
  }

  try {
    const tokenHash = hashAuthToken(token);
    const tokenRow = await db.query.AuthToken.findFirst({
      where: eq(AuthToken.tokenHash, tokenHash),
      with: { user: true },
    });

    if (!tokenRow || tokenRow.type !== 'EMAIL_VERIFY' || !tokenRow.user) {
      return redirect(res, buildUiRedirect('invalid', nextPath), 302);
    }

    if (tokenRow.usedAt || tokenRow.expiresAt <= new Date()) {
      return redirect(res, buildUiRedirect('expired', nextPath), 302);
    }

    // K0: atomic single-use claim (a concurrent second use of the same link is refused like a reused one)
    const claimed = await db.update(AuthToken).set({ usedAt: new Date() }).where(and(eq(AuthToken.id, tokenRow.id), isNull(AuthToken.usedAt))).returning({ id: AuthToken.id });
    if (!claimed.length) return redirect(res, buildUiRedirect('expired', nextPath), 302);
    await db.update(CitizenUser).set({ emailVerifiedAt: tokenRow.user.emailVerifiedAt || new Date() }).where(eq(CitizenUser.id, tokenRow.user.id));

    // PKG-11 audit pass 2: nobody has chosen this account's password yet (a second sign-up for the unverified address, or an ownership recovery): the person who
    // has just proved the mailbox chooses it now, through a single-use reset link of the same lifetime as an e-mailed one.
    if (isUnsetPassword(tokenRow.user.passwordHash)) {
      const raw = generateAuthToken();
      await db.update(AuthToken).set({ usedAt: new Date() }).where(and(eq(AuthToken.userId, tokenRow.user.id), eq(AuthToken.type, 'PASSWORD_RESET'), isNull(AuthToken.usedAt)));
      await db.insert(AuthToken).values({ userId: tokenRow.user.id, type: 'PASSWORD_RESET', tokenHash: hashAuthToken(raw), expiresAt: new Date(Date.now() + CHOOSE_PASSWORD_TTL_MS) });
      return redirect(res, `/auth/reset?token=${encodeURIComponent(raw)}&choose=1&next=${encodeURIComponent(normalizeNextPath(nextPath, '/annuaire'))}`, 302);
    }

    return redirect(res, buildUiRedirect('success', nextPath), 302);
  } catch {
    return redirect(res, buildUiRedirect('error', nextPath), 302);
  }
}

