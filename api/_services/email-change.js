/**
 * Launch-readiness item 66 — the right of rectification of a citizen account's contact data (GDPR art. 16), which the account page used to postpone (« sera
 * disponible prochainement »):
 *  - e-mail: the current password is asked again; the NEW address is kept encrypted until the person proves it by a single-use link sent there (30 minutes);
 *    the OLD address is told at once. On confirmation the address changes, it counts as verified, and every session ends (sign in again with the new one).
 *    Whether another account uses the requested address is never revealed at the request; a taken address is refused at the confirmation.
 *  - phone: changed or removed directly from the session; a new number is NOT verified (no SMS exists to verify it), so nothing is ever sent to it.
 * Every step is journalised without the addresses. The mail result is reported honestly (an unconfigured provider is never « sent »).
 */
import crypto from 'node:crypto';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog, CitizenUser, EmailChangeRequest } from '../../src/db/schema.js';
import { openText, sealText } from '../lib/data-keys.js';
import { buildAppUrl, generateAuthToken, hashAuthToken, isUnsetPassword, isValidEmail, normalizeEmail, normalizePhone, verifyPassword } from '../_utils/user-auth.js';
import { sendMail } from '../_utils/mailer.js';
import { templates } from '../lib/email-service.js';

export const EMAIL_CHANGE_TTL_MS = 30 * 60 * 1000;
const seal = (/** @type {string} */ id, /** @type {string} */ email) => sealText(email, { purpose: 'email-change', context: `email-change:${id}` });
const open = (/** @type {string} */ id, /** @type {string} */ sealed) => openText(sealed, { purpose: 'email-change', context: `email-change:${id}` });
const bad = (/** @type {string} */ code, /** @type {string} */ message, status = 400) => ({ ok: false, status, code, message });
/** @param {any} db @param {string} action @param {string} userId @param {Record<string, unknown>} [details] */
const audit = (db, action, userId, details = {}) => db.insert(AuditLog).values({ action, actor: userId, actor_id: userId, entity: 'CitizenUser', entity_id: userId, details });

/**
 * @param {string} userId @param {{ newEmail?: unknown, password?: unknown }} input
 * @param {{ db?: any, send?: (m: any) => Promise<any>, now?: Date }} [deps]
 */
export async function requestEmailChange(userId, input, deps = {}) {
  const db = deps.db || defaultDb; const send = deps.send || sendMail; const now = deps.now || new Date();
  const newEmail = normalizeEmail(input?.newEmail);
  if (!isValidEmail(newEmail)) return bad('INVALID_EMAIL', 'Adresse e-mail invalide.');
  const [user] = await db.select().from(CitizenUser).where(eq(CitizenUser.id, userId)).limit(1);
  if (!user) return bad('NOT_FOUND', 'Compte introuvable.', 404);
  const password = String(input?.password || '');
  if (!password || isUnsetPassword(user.passwordHash) || !(await verifyPassword(password, user.passwordHash).catch(() => false))) return bad('INVALID_PASSWORD', 'Mot de passe incorrect.', 403);
  if (newEmail === normalizeEmail(user.email)) return bad('SAME_EMAIL', 'C’est déjà votre adresse.');
  // one pending change at a time; expired or used requests of this account are removed
  await db.delete(EmailChangeRequest).where(and(eq(EmailChangeRequest.userId, userId), or(isNull(EmailChangeRequest.usedAt), lt(EmailChangeRequest.expiresAt, now))));
  const id = crypto.randomUUID(); const raw = generateAuthToken();
  await db.insert(EmailChangeRequest).values({ id, userId, newEmailEncrypted: seal(id, newEmail), tokenHash: hashAuthToken(raw), expiresAt: new Date(now.getTime() + EMAIL_CHANGE_TTL_MS) });
  const link = buildAppUrl(`/api/citizen/email-change-confirm?token=${encodeURIComponent(raw)}`);
  const confirm = templates.emailChangeConfirm(link);
  const notice = templates.emailChangeNotice();
  const toNew = await send({ to: newEmail, subject: confirm.subject, html: confirm.html, text: `Confirmez votre nouvelle adresse : ${link}`, category: 'email_change' });
  const toOld = await send({ to: user.email, subject: notice.subject, html: notice.html, text: notice.text, category: 'email_change_notice' });
  await audit(db, 'CITIZEN_EMAIL_CHANGE_REQUESTED', userId, { linkSent: toNew?.outcome || null, noticeSent: toOld?.outcome || null });
  const sent = ['PROVIDER_ACCEPTED', 'TEST_RECORDED'].includes(toNew?.outcome);
  return { ok: true, status: sent ? 202 : 200, linkSent: sent,
    message: sent ? 'Un lien de confirmation a été envoyé à la nouvelle adresse (valable 30 minutes). Votre adresse actuelle reste valable d’ici là.'
      : 'L’e-mail de confirmation n’a pas pu être envoyé (envoi d’e-mails non configuré) : votre adresse n’a pas changé. Réessayez plus tard ou contactez-nous.' };
}

/** @param {string} rawToken @param {{ db?: any, now?: Date }} [deps] @returns {Promise<{ ok: boolean, status: string }>} status for the account page */
export async function confirmEmailChange(rawToken, deps = {}) {
  const db = deps.db || defaultDb; const now = deps.now || new Date();
  const token = String(rawToken || '').trim();
  if (!token) return { ok: false, status: 'invalid' };
  const [row] = await db.select().from(EmailChangeRequest).where(eq(EmailChangeRequest.tokenHash, hashAuthToken(token))).limit(1);
  if (!row) return { ok: false, status: 'invalid' };
  if (row.usedAt || new Date(row.expiresAt) <= now) return { ok: false, status: 'expired' };
  return db.transaction(async (/** @type {any} */ tx) => {
    const claimed = await tx.update(EmailChangeRequest).set({ usedAt: now }).where(and(eq(EmailChangeRequest.id, row.id), isNull(EmailChangeRequest.usedAt))).returning({ id: EmailChangeRequest.id });
    if (!claimed.length) return { ok: false, status: 'expired' };
    const newEmail = String(open(row.id, row.newEmailEncrypted) || '');
    if (!newEmail) return { ok: false, status: 'invalid' };
    const [taken] = await tx.select({ id: CitizenUser.id }).from(CitizenUser).where(eq(CitizenUser.email, newEmail)).limit(1);
    if (taken) { await audit(tx, 'CITIZEN_EMAIL_CHANGE_REFUSED', row.userId, { reason: 'address_in_use' }); return { ok: false, status: 'taken' }; }
    await tx.update(CitizenUser).set({ email: newEmail, emailVerifiedAt: now, sessionsValidAfter: now }).where(eq(CitizenUser.id, row.userId));
    await audit(tx, 'CITIZEN_EMAIL_CHANGED', row.userId, { sessionsEnded: true });
    return { ok: true, status: 'changed' };
  });
}

/** @param {string} userId @param {{ phone?: unknown }} input @param {{ db?: any }} [deps] */
export async function setPhone(userId, input, deps = {}) {
  const db = deps.db || defaultDb;
  const rawValue = input?.phone;
  const remove = rawValue === null || String(rawValue ?? '').trim() === '';
  const phone = remove ? null : normalizePhone(rawValue);
  if (!remove && !/^(?:0[1-9]\d{8}|\+33[1-9]\d{8})$/.test(String(phone))) return bad('INVALID_PHONE', 'Numéro de téléphone invalide (format français attendu, par exemple 06 12 34 56 78).');
  await db.update(CitizenUser).set({ phone, phoneVerifiedAt: null }).where(eq(CitizenUser.id, userId));
  await audit(db, remove ? 'CITIZEN_PHONE_REMOVED' : 'CITIZEN_PHONE_CHANGED', userId, { verified: false });
  return { ok: true, status: 200, phone, phoneVerified: false };
}
