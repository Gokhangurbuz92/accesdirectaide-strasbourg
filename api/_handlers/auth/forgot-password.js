// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { CitizenUser, AuthToken } from '../../../src/db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { checkRateLimit, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { sendMail, getMailerStatus } from '../../_utils/mailer.js';
import { accountMailLanguage } from '../../_services/mail-language.js';
import { localizedMail } from '../../_utils/mail-catalogue.js';
import { templates } from '../../lib/email-service.js';
import { afterResponse, holdResponseFloor } from '../../_utils/after-response.js';
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

/** The link of an existing account (run after the answer: V2 / D1, no timing oracle). @param {string} email @param {unknown} [requestLanguage] */
async function issueReset(email, requestLanguage) {
  const user = await db.query.CitizenUser.findFirst({ where: eq(CitizenUser.email, email) });
  if (!user) return;
  const rawToken = generateAuthToken();
  const tokenHash = hashAuthToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  // Sequential operations (neon-http driver doesn't support transactions)
  await db.update(AuthToken).set({ usedAt: new Date() }).where(and(eq(AuthToken.userId, user.id), eq(AuthToken.type, 'PASSWORD_RESET'), isNull(AuthToken.usedAt)));
  await db.insert(AuthToken).values({ userId: user.id, type: 'PASSWORD_RESET', tokenHash, expiresAt });
  const resetUrl = buildAppUrl(`/auth/reset?token=${encodeURIComponent(rawToken)}`);
  // A-15: in the person's stored language (else the language of the form they used, else French); the French text stays below the translated opening
  const lang = await accountMailLanguage(user.id, requestLanguage);
  const emailTemplate = templates.resetPassword(user.email.split('@')[0], resetUrl, '15 minutes', lang);
  const plain = localizedMail('password_reset', lang, `Lien de reinitialisation: ${resetUrl}`);
  await sendMail({ to: email, subject: emailTemplate.subject, text: plain.text, html: emailTemplate.html, category: 'password_reset' });
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

  // V2 / D1: the same answer, after the same time, whether or not the address has an account; the link is issued after the answer
  afterResponse(() => issueReset(email, req.body?.language), 'forgot-password');
  await holdResponseFloor(startedAt);
  return res.status(200).json(genericAnswer());
}
