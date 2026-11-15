/**
 * A-23 (C04) — the account's stored language is applied to the whole application ONCE when a session starts, on whatever page the person lands after signing in
 * (before: only /compte/profil applied it, so a person who chose Arabic kept a French interface until they opened their profile).
 *
 * Same rule as the profile page (R35 / R47):
 *   - « fr » is also the column's default (a person who never chose): it does not override a language this visitor chose in this browser;
 *   - a language carried by the address (?lang=) is the visitor's explicit choice for this page and is not overridden;
 *   - a non-French account language applies everywhere.
 * Once per browser session and account (sessionStorage): after that, the language switch stays the person's — the header must not put the account language
 * back on every page. Accessibility display preferences are device-only by owner decision and are not concerned.
 */
import { SOURCE_LANGUAGE, languageFromAddress, matchLanguage, setLanguage, storedLanguage } from '@/i18n';

export const APPLIED_KEY = 'ada_account_lang_applied';

const session = () => { try { return typeof window !== 'undefined' ? window.sessionStorage : null; } catch { return null; } };

/**
 * What to do with the account language (pure). @param {{ accountLanguage?: string | null, uiLanguage?: string | null, stored?: string | null, fromAddress?: string | null }} s
 * @returns {string | null} the language to switch to, or null
 */
export function accountLanguageToApply({ accountLanguage, uiLanguage, stored = null, fromAddress = null }) {
  const lang = matchLanguage(String(accountLanguage || ''));
  if (!lang || fromAddress) return null;
  if (lang === (matchLanguage(String(uiLanguage || '')) || SOURCE_LANGUAGE)) return null;
  if (lang === SOURCE_LANGUAGE && stored) return null;
  return lang;
}

/**
 * Applies the account language once per browser session for this account. @param {{ id?: string, preferredLanguage?: string | null } | null | undefined} user
 * @param {string} uiLanguage the current interface language @returns {Promise<string | null>} the language applied, or null
 */
export async function applyAccountLanguageOnce(user, uiLanguage) {
  if (!user || !user.id || !user.preferredLanguage) return null;
  const store = session();
  const mark = String(user.id);
  try { if (store && store.getItem(APPLIED_KEY) === mark) return null; } catch { /* storage refused: applied on this page only */ }
  try { if (store) store.setItem(APPLIED_KEY, mark); } catch { /* idem */ }
  const next = accountLanguageToApply({ accountLanguage: user.preferredLanguage, uiLanguage, stored: storedLanguage(), fromAddress: languageFromAddress() });
  if (!next) return null;
  return setLanguage(next);
}
