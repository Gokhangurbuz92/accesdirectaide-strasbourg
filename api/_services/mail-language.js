/**
 * R43-MAIL — the language a person's e-mails are written in: their stored preference (CitizenProfile.preferredLanguage, one of the six interface
 * languages), French otherwise — no account, no profile, an unknown value or a failed lookup. Never throws: a language must not block a notice.
 */
import { eq } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { CitizenProfile } from '../../src/db/schema.js';
import { mailLanguage } from '../_utils/mail-catalogue.js';

/** @param {unknown} citizenUserId @param {typeof defaultDb} [db] @returns {Promise<string>} */
export async function citizenMailLanguage(citizenUserId, db = defaultDb) {
  if (typeof citizenUserId !== 'string' || !citizenUserId) return 'fr';
  try {
    /** @type {Array<{ lang?: unknown }>} */
    const rows = await db.select({ lang: CitizenProfile.preferredLanguage }).from(CitizenProfile).where(eq(CitizenProfile.userId, citizenUserId)).limit(1);
    return mailLanguage(rows?.[0]?.lang);
  } catch {
    return 'fr';
  }
}

/**
 * A-15 — the language of an ACCOUNT e-mail (verification link, password reset): the person's stored language; when none was ever chosen (no profile row, or the
 * column's default « fr »), the interface language of the page the request came from (`requestLanguage`: the sign-up or the « forgot password » form); French
 * otherwise. The request language only chooses the wording of a message sent to the account's own address: it is not stored and opens nothing.
 * @param {unknown} citizenUserId @param {unknown} requestLanguage @param {typeof defaultDb} [db] @returns {Promise<string>}
 */
export async function accountMailLanguage(citizenUserId, requestLanguage, db = defaultDb) {
  const stored = await citizenMailLanguage(citizenUserId, db);
  return stored !== 'fr' ? stored : mailLanguage(requestLanguage);
}
