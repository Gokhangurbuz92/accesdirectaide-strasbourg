// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { CitizenUser, AuthToken } from '../../../src/db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { checkRateLimit, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { sendMail, getMailerStatus } from '../../_utils/mailer.js';
import { templates } from '../../lib/email-service.js';
import { afterResponse, holdResponseFloor } from '../../_utils/after-response.js';
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
import { ADULT_REQUIRED_REFUSAL, adultDeclarationGiven, recordAgeDeclaration } from '../../_utils/age-policy.js';
import { TERMS_NOT_IN_FORCE_REFUSAL, TERMS_REQUIRED_REFUSAL, citizenTermsInForce, recordTermsAcceptance, termsAcceptanceGiven } from '../../_utils/terms-acceptance.js';
import { phoneCollectionOpen } from '../../_utils/phone-collection.js';

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

/** Postgres unique violation, whether the driver wraps it (drizzle DrizzleQueryError → cause) or not. @param {any} err */
export const isUniqueViolation = (err) => err?.code === '23505' || err?.cause?.code === '23505';

/**
 * The address-dependent part of a sign-up (after the answer). A new address gets an account; an unverified one loses any password already set (PKG-11);
 * a verified one gets nothing (no e-mail: the person is not told someone tried). A concurrent duplicate insert is the « already exists » case.
 * @param {{ email: string, passwordHash: string, phone: string | null, nextPath: string }} p
 */
async function registerOrRefresh({ email, passwordHash, phone, nextPath }) {
  let user = await db.query.CitizenUser.findFirst({ where: eq(CitizenUser.email, email) });
  if (!user) {
    try {
      [user] = await db.insert(CitizenUser).values({ email, passwordHash, phone: phone || null }).returning();
    } catch (err) {
      if (isUniqueViolation(err)) return;   // another sign-up of the same address won the race: that one sends the link
      throw err;
    }
  } else if (!user.emailVerifiedAt) {
    // PKG-11 audit pass 2 (pre-registration / recovery takeover): a sign-up for an address whose account is still UNVERIFIED sets no password at all — neither
    // the first registrant's nor this one's survives: the password becomes « not chosen » and whoever proves the mailbox by clicking the (new) link chooses it
    // then (verify-email → /auth/reset). A re-sign-up never changes the phone either. The older links die below.
    await db.update(CitizenUser).set({ passwordHash: unsetPasswordHash(), updatedAt: new Date() }).where(and(eq(CitizenUser.id, user.id), isNull(CitizenUser.emailVerifiedAt)));
  }
  if (user.emailVerifiedAt) return;

  // R42-A07: the declaration of THIS sign-up (append-only ledger); a re-sign-up of an unverified address declares again
  await recordAgeDeclaration(user.id, { adult: true, channel: 'signup' });
  await recordTermsAcceptance(user.id, { channel: 'signup' });   // Release B: the accepted terms and their version, with this sign-up

  const rawToken = generateAuthToken();
  const tokenHash = hashAuthToken(rawToken);
  const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);
  // Sequential operations (neon-http driver doesn't support transactions)
  await db.update(AuthToken).set({ usedAt: new Date() }).where(and(eq(AuthToken.userId, user.id), eq(AuthToken.type, 'EMAIL_VERIFY'), isNull(AuthToken.usedAt)));
  await db.insert(AuthToken).values({ userId: user.id, type: 'EMAIL_VERIFY', tokenHash, expiresAt });

  const verifyUrl = buildAppUrl(`/api/auth/verify-email?token=${encodeURIComponent(rawToken)}&next=${encodeURIComponent(nextPath)}`);
  const text = [
    'Confirmez votre adresse email pour activer votre compte Acces Direct Aide.',
    '',
    `Lien de verification: ${verifyUrl}`,
    '',
    "Si vous n'etes pas a l'origine de cette demande, ignorez cet email.",
  ].join('\n');
  const emailTemplate = templates.welcome(email.split('@')[0], verifyUrl);
  await sendMail({ to: email, subject: emailTemplate.subject, text, html: emailTemplate.html, category: 'email_verify' });
}

export default async function handler(req, res) {
  const startedAt = Date.now();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // V2 / D6: no account under terms that are not in force (Production): refused before anything is read, the same for every address
  if (!citizenTermsInForce()) return res.status(503).json({ ...TERMS_NOT_IN_FORCE_REFUSAL });

  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  // Release B / D2 V2: no phone is collected while its collection is closed (api/_utils/phone-collection.js) — the field is ignored, never stored
  const phone = phoneCollectionOpen() ? normalizePhone(req.body?.phone) : null;
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

  // R42-A07: an independent account is for adults only. The explicit declaration is checked before anything is looked up, so the refusal is the same whatever the
  // address (no account oracle). No date of birth is asked (api/_utils/age-policy.js).
  if (!adultDeclarationGiven(req.body?.adultDeclaration)) {
    return res.status(400).json({ ...ADULT_REQUIRED_REFUSAL });
  }
  // Release B / D2 V2: the citizen terms of use are accepted at sign-up (a contract acceptance, not a GDPR consent: api/_utils/terms-acceptance.js); checked
  // after the adult declaration and before anything is looked up (same refusal whatever the address)
  if (!termsAcceptanceGiven(req.body?.termsAccepted)) {
    return res.status(400).json({ ...TERMS_REQUIRED_REFUSAL });
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

  // R42 bot protection: a field hidden from people (« site_web », as on the contact form) filled in means an automated submission. It gets the ordinary answer
  // after the same password work, and nothing is created or sent (a bot learns nothing; the rate limits above still count it).
  if (String(req.body?.site_web ?? '').trim()) {
    await hashPassword(password);
    await holdResponseFloor(startedAt);
    return res.status(200).json(signupAnswer());
  }

  // V2 / D1: the password work is the same for every address and is done before the answer; everything that depends on whether the address already has
  // an account (lookup, writes, the e-mail) runs after the answer, which is never sent before the same floor. V2 / D4: a failure is logged by name and
  // SQL state only (the driver's message carries the query parameters, including the password hash).
  const passwordHash = await hashPassword(password);
  afterResponse(() => registerOrRefresh({ email, passwordHash, phone, nextPath }), 'signup');
  await holdResponseFloor(startedAt);
  return res.status(200).json(signupAnswer());
}
