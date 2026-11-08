import { db } from '../../../src/db/index.js';
import { CitizenUser, AuthToken } from '../../../src/db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { checkRateLimit, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { sendMail, getMailerStatus } from '../../_utils/mailer.js';
import { templates } from '../../lib/email-service.js';
import { afterResponse, holdResponseFloor } from '../../_utils/after-response.js';
import {
  buildAppUrl,
  generateAuthToken,
  getClientIp,
  hashAuthToken,
  isValidEmail,
  normalizeEmail,
  normalizeNextPath,
} from '../../_utils/user-auth.js';

const VERIFY_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL

const GENERIC_RESPONSE = {
  ok: true,
  message: "Si l'email est valide, un lien a été envoyé.",
};

// R12 (C01): « sent » only when this service can send e-mail at all (configuration only — the same answer for every address)
const genericAnswer = () => (getMailerStatus().deliverable ? { ...GENERIC_RESPONSE, emailDelivery: 'SENT_IF_VALID' }
  : { ok: true, message: "L’envoi d’e-mails n’est pas disponible sur ce service pour le moment : aucun lien n’a pu être envoyé.", emailDelivery: 'UNAVAILABLE' });

/** @param {string} email @param {string} nextPath */
async function resendLink(email, nextPath) {
  const user = await db.query.CitizenUser.findFirst({ where: eq(CitizenUser.email, email) });
  if (!user || user.emailVerifiedAt) return;
  const rawToken = generateAuthToken();
  const tokenHash = hashAuthToken(rawToken);
  const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);
  // Sequential operations (neon-http driver doesn't support transactions)
  await db.update(AuthToken).set({ usedAt: new Date() }).where(and(eq(AuthToken.userId, user.id), eq(AuthToken.type, 'EMAIL_VERIFY'), isNull(AuthToken.usedAt)));
  await db.insert(AuthToken).values({ userId: user.id, type: 'EMAIL_VERIFY', tokenHash, expiresAt });
  const verifyUrl = buildAppUrl(`/api/auth/verify-email?token=${encodeURIComponent(rawToken)}&next=${encodeURIComponent(nextPath)}`);
  const emailTemplate = templates.welcome(user.email.split('@')[0], verifyUrl);
  await sendMail({ to: email, subject: emailTemplate.subject, text: `Lien de verification: ${verifyUrl}`, html: emailTemplate.html, category: 'email_verify' });
}

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  const startedAt = Date.now();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const email = normalizeEmail(req.body?.email);
  const nextPath = normalizeNextPath(req.body?.next, '/annuaire');
  if (!isValidEmail(email)) {
    return res.status(200).json(genericAnswer());
  }

  const ip = getClientIp(req);
  const ipLimit = await checkRateLimit('RESEND_VERIFY', `ip:${ip}`);
  if (!ipLimit.allowed) {
    return res.status(getRateLimitStatus(/** @type {{ status?: number }} */ (ipLimit))).json(ipLimit.error || { error: 'Too many attempts' });
  }

  // V2 / D5: also limited per address (an unverified account could otherwise be flooded with links from rotating addresses)
  const emailLimit = await checkRateLimit('RESEND_VERIFY', `email:${email}`);
  if (!emailLimit.allowed) {
    return res.status(getRateLimitStatus(/** @type {{ status?: number }} */ (emailLimit))).json(emailLimit.error || { error: 'Too many attempts' });
  }
  // V2 / D1: the link is issued after the answer, which takes the same time for every address
  afterResponse(() => resendLink(email, nextPath), 'resend-verification');
  await holdResponseFloor(startedAt);
  return res.status(200).json(genericAnswer());
}
