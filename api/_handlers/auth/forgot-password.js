// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { CitizenUser, AuthToken } from '../../../src/db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { checkRateLimit, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { sendMail, getMailerStatus } from '../../_utils/mailer.js';
import { templates } from '../../lib/email-service.js';
import {
  buildAppUrl,
  generateAuthToken,
  getClientIp,
  hashAuthToken,
  isValidEmail,
  normalizeEmail,
} from '../../_utils/user-auth.js';

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL for stricter security

const GENERIC_RESPONSE = {
  ok: true,
  message: "Si l'email est valide, un lien a été envoyé.",
};

// R12 (C01): « sent » only when this service can send e-mail at all (configuration only — the same answer for every address)
const genericAnswer = () => (getMailerStatus().deliverable ? { ...GENERIC_RESPONSE, emailDelivery: 'SENT_IF_VALID' } : { ok: true, message: "L’envoi d’e-mails n’est pas disponible sur ce service pour le moment : aucun lien n’a pu être envoyé. Réessayez plus tard.", emailDelivery: 'UNAVAILABLE' });

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const email = normalizeEmail(req.body?.email);
  if (!isValidEmail(email)) {
    return res.status(200).json(genericAnswer());
  }

  const ip = getClientIp(req);
  const ipLimit = await checkRateLimit('FORGOT_USER', `ip:${ip}`);
  if (!ipLimit.allowed) {
    return res.status(getRateLimitStatus(ipLimit)).json(ipLimit.error || { error: 'Too many attempts' });
  }
  const emailLimit = await checkRateLimit('FORGOT_USER', `email:${email}`);
  if (!emailLimit.allowed) {
    // @ts-ignore
    return res.status(getRateLimitStatus(emailLimit)).json(emailLimit.error || { error: 'Too many attempts' });
  }

  try {
    const user = await db.query.CitizenUser.findFirst({ where: eq(CitizenUser.email, email) });
    if (!user) {
      return res.status(200).json(genericAnswer());
    }

    const rawToken = generateAuthToken();
    const tokenHash = hashAuthToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    // Sequential operations (neon-http driver doesn't support transactions)
    await db.update(AuthToken).set({ usedAt: new Date() }).where(
      and(
        eq(AuthToken.userId, user.id),
        eq(AuthToken.type, 'PASSWORD_RESET'),
        isNull(AuthToken.usedAt)
      )
    );
    await db.insert(AuthToken).values({
        userId: user.id,
        type: 'PASSWORD_RESET',
        tokenHash,
        expiresAt,
    });

    const resetUrl = buildAppUrl(`/auth/reset?token=${encodeURIComponent(rawToken)}`);
    const emailTemplate = templates.resetPassword(user.email.split('@')[0], resetUrl);

    await sendMail({
      to: email,
      subject: emailTemplate.subject,
      text: `Lien de reinitialisation: ${resetUrl}`,
      html: emailTemplate.html,
      category: 'password_reset',
    });

    return res.status(200).json(genericAnswer());
  } catch {
    return res.status(500).json({ error: 'Internal error', message: 'La demande n’a pas pu être traitée : réessayez dans quelques minutes.' });
  }
}
