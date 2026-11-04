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
