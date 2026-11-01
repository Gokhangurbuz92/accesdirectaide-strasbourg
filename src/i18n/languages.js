/**
 * R32 — the six interface languages. French is the source and the authoritative language of the verified content; the five others are comprehension
 * aids (interface strings drafted by AI and not yet reviewed by native speakers; content translations carry their own status, see
 * src/lib/contentTranslation.js). Pure module: also read by the Node scripts (scripts/i18n-check.mjs, scripts/translate-content.mjs).
 */
export const SOURCE_LANGUAGE = 'fr';

export const LANGUAGES = Object.freeze([
  Object.freeze({ code: 'fr', name: 'Français', english: 'French', intl: 'fr-FR', dir: 'ltr' }),
  Object.freeze({ code: 'en', name: 'English', english: 'English', intl: 'en-GB', dir: 'ltr' }),
  Object.freeze({ code: 'tr', name: 'Türkçe', english: 'Turkish', intl: 'tr-TR', dir: 'ltr' }),
  // Latin digits in Arabic: amounts, dates and phone numbers then read the same as in the French source and the official pages
  Object.freeze({ code: 'ar', name: 'العربية', english: 'Arabic', intl: 'ar-u-nu-latn', dir: 'rtl' }),
  Object.freeze({ code: 'de', name: 'Deutsch', english: 'German', intl: 'de-DE', dir: 'ltr' }),
  Object.freeze({ code: 'uk', name: 'Українська', english: 'Ukrainian', intl: 'uk-UA', dir: 'ltr' }),
]);

export const LANGUAGE_CODES = Object.freeze(LANGUAGES.map((l) => l.code));
export const TARGET_LANGUAGES = Object.freeze(LANGUAGE_CODES.filter((c) => c !== SOURCE_LANGUAGE));

/** @param {string | null | undefined} code @returns {typeof LANGUAGES[number] | null} */
export function languageOf(code) {
  return LANGUAGES.find((l) => l.code === code) || null;
}

/** The supported language matching a BCP 47 tag (« uk-UA » → uk, « ar-MA » → ar), or null. @param {string | null | undefined} tag */
export function matchLanguage(tag) {
  const base = String(tag || '').trim().toLowerCase().split(/[-_]/)[0];
  return LANGUAGE_CODES.includes(base) ? base : null;
}
