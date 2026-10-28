// @ts-nocheck
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { CitizenUser, AuthToken } from '../../../src/db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { checkRateLimit, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { sendMail, getMailerStatus } from '../../_utils/mailer.js';
import { templates } from '../../lib/email-service.js';
import { passwordMessage, passwordProblems } from '../../../src/lib/passwordPolicy.js';
import {
  buildAppUrl,
  generateAuthToken,
  getClientIp,
  hashAuthToken,
  hashPassword,
  isValidEmail,
  normalizeEmail,
  normalizeNextPath,
  normalizePhone,
  unsetPasswordHash,
} from '../../_utils/user-auth.js';

const VERIFY_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL for stricter security

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
/**
 * R12 (C01): the answer says honestly whether e-mail can leave this service at all. It depends only on the service's configuration (never on the address
 * or on an existing account), so it reveals nothing about who is registered; « a link was sent » is no longer claimed when no mail provider exists.
 */
function signupAnswer() {
  return getMailerStatus().deliverable
    ? { ok: true, message: "Si l'email est valide, un lien a été envoyé.", emailDelivery: 'SENT_IF_VALID' }
    : { ok: true, message: "Votre demande est enregistrée, mais l’envoi d’e-mails n’est pas disponible sur ce service pour le moment : aucun lien n’a pu être envoyé.", emailDelivery: 'UNAVAILABLE' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const phone = normalizePhone(req.body?.phone);
  const nextPath = normalizeNextPath(req.body?.next, '/annuaire');

  // R18: every refusal carries the French sentence the screen shows (`message`); the screen used to show « Une erreur est survenue » for both
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Email invalide', message: 'Adresse e-mail invalide : vérifiez-la (exemple : prenom.nom@exemple.fr).' });
  }

  // Password policy (src/lib/passwordPolicy.js, shared with the screens and the reset): 8+ chars, at least 1 uppercase, 1 lowercase, 1 digit
  const pwErrors = passwordProblems(password);
  if (pwErrors.length > 0) {
    return res.status(400).json({
      error: 'Mot de passe trop faible',
      message: passwordMessage(pwErrors),
      details: pwErrors,
    });
  }

  const ip = getClientIp(req);
  const ipLimit = await checkRateLimit('SIGNUP_USER', `ip:${ip}`);
  if (!ipLimit.allowed) {
    return res.status(getRateLimitStatus(ipLimit)).json(ipLimit.error || { error: 'Too many attempts' });
  }
  const emailLimit = await checkRateLimit('SIGNUP_USER', `email:${email}`);
  if (!emailLimit.allowed) {
    // @ts-ignore
    return res.status(getRateLimitStatus(emailLimit)).json(emailLimit.error || { error: 'Too many attempts' });
  }

  try {
    let user = await db.query.CitizenUser.findFirst({ where: eq(CitizenUser.email, email) });

    if (!user) {
      const passwordHash = await hashPassword(password);
      const [newUser] = await db.insert(CitizenUser).values({
          email,
          passwordHash,
          phone: phone || null,
      }).returning();
      user = newUser;
    }

    else if (!user.emailVerifiedAt) {
      // PKG-11 audit pass 2 (pre-registration / recovery takeover): a sign-up for an address whose account is still UNVERIFIED sets no password at all — neither
      // the first registrant's nor this one's survives: the password becomes « not chosen » and whoever proves the mailbox by clicking the (new) link chooses it
      // then (verify-email → /auth/reset). Pass 1 let the latest sign-up win, so someone re-signing after the person (or after an ownership recovery) got the
      // account at the person's click. A re-sign-up never changes the phone either. The older links die below.
      await hashPassword(password);   // same work as the other branches (timing)
      await db.update(CitizenUser).set({ passwordHash: unsetPasswordHash(), updatedAt: new Date() }).where(and(eq(CitizenUser.id, user.id), isNull(CitizenUser.emailVerifiedAt)));
    }

    if (user.emailVerifiedAt) {
      await hashPassword(password);   // PKG-11 audit pass 2: same password work as a new sign-up (an existing verified address answered measurably faster)
      return res.status(200).json(signupAnswer());
    }

    const rawToken = generateAuthToken();
    const tokenHash = hashAuthToken(rawToken);
    const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);

    // Sequential operations (neon-http driver doesn't support transactions)
    await db.update(AuthToken).set({ usedAt: new Date() }).where(
      and(
        eq(AuthToken.userId, user.id),
        eq(AuthToken.type, 'EMAIL_VERIFY'),
        isNull(AuthToken.usedAt)
      )
    );
    await db.insert(AuthToken).values({
        userId: user.id,
        type: 'EMAIL_VERIFY',
        tokenHash,
        expiresAt,
    });

    const verifyUrl = buildAppUrl(`/api/auth/verify-email?token=${encodeURIComponent(rawToken)}&next=${encodeURIComponent(nextPath)}`);
    const text = [
      'Confirmez votre adresse email pour activer votre compte Acces Direct Aide.',
      '',
      `Lien de verification: ${verifyUrl}`,
      '',
      "Si vous n'etes pas a l'origine de cette demande, ignorez cet email.",
    ].join('\n');

    const emailTemplate = templates.welcome(email.split('@')[0], verifyUrl);

    await sendMail({
      to: email,
      subject: emailTemplate.subject,
      text,
      html: emailTemplate.html,
      category: 'email_verify',
    });

    return res.status(200).json(signupAnswer());
  } catch (err) {
    // @ts-ignore
    const message = String(err?.message || '');
    // Duplicate email: don't leak account existence — return same generic OK
    if (message.includes('unique') || message.includes('duplicate')) {
      return res.status(200).json(signupAnswer());
    }
    logger.error({ err }, '[signup] Registration failed');
    return res.status(500).json({ error: 'Erreur interne du serveur' });
  }
}
