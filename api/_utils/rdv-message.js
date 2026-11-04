/**
 * R42 (owner decision R42-A06) — the OPTIONAL short message of an appointment request. R43 (dossier RGPD § 2.1, gap E6 — [PROPOSITION À VALIDER RT]):
 *   label   « Message à la structure (facultatif) »   (the R42 label invited the person to describe the reason, i.e. often a health situation)
 *   notice  « Inutile de décrire votre santé, un handicap ou un diagnostic : la structure vous posera les questions utiles pendant le rendez-vous.
 *            N'envoyez pas de document médical. »
 *   consent an explicit, never pre-ticked box shown only when a message is written (art. 6(1)(a) + 9(2)(a) proposal); without it the server refuses a
 *           non-empty message (MESSAGE_CONSENT_REQUIRED) — nothing is dropped silently. The decision is kept in the append-only ConsentLog (purpose
 *           BOOKING_MESSAGE_TRANSMISSION, one row per appointment, the appointment id in policy_hash); a withdrawal erases the message and appends
 *           decision false. ConsentLog.purpose is free text on 0042: no migration.
 *
 * Plain text only, bounded, never HTML. It is stored like the other personal data of an appointment: sealed (v1 envelope, api/lib/crypto.js) in
 * ProAppointment.notes — the same column and the same protection as the notes of a professional-created appointment — and shown only to the
 * structure's authorised staff (pro agenda). It never goes into a notification subject or text, a URL, a log line, analytics or a public API.
 */

export const BOOKING_MESSAGE_MAX_LENGTH = 500;
export const BOOKING_MESSAGE_LABEL = 'Message à la structure (facultatif)';
export const BOOKING_MESSAGE_NOTICE = 'Inutile de décrire votre santé, un handicap ou un diagnostic : la structure vous posera les questions utiles pendant le rendez-vous. N’envoyez pas de document médical.';
export const BOOKING_MESSAGE_CONSENT = 'J’accepte que ce message soit transmis à l’équipe de la structure choisie. Il peut contenir des informations sur ma situation. Je peux le retirer avant le rendez-vous.';
export const BOOKING_MESSAGE_CONSENT_PURPOSE = 'BOOKING_MESSAGE_TRANSMISSION';
/** the version of the consent wording (changes when the wording changes) */
export const BOOKING_MESSAGE_CONSENT_VERSION = 'r43-e6-2026-11-04';
/** only the boolean true is a consent @param {unknown} v */
export const messageConsentGiven = (v) => v === true;
export const MESSAGE_CONSENT_REFUSAL = Object.freeze({ status: 400, body: Object.freeze({ error: 'MESSAGE_CONSENT_REQUIRED', code: 'MESSAGE_CONSENT_REQUIRED',
  message: 'Pour envoyer votre message à la structure, cochez la case d’accord, ou effacez le message : le rendez-vous peut être demandé sans message.' }) });

// a tag, a comment, a doctype or a character reference: anything a browser could read as markup
const MARKUP = /<\s*[a-zA-Z!/?]|&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]{2,8});/;
/** C0 / C1 controls other than tab and line feed, and the bidirectional overrides U+202A–U+202E, U+2066–U+2069 (text spoofing) @param {string} text */
const hasForbiddenChar = (text) => Array.from(text).some((ch) => {
  const c = ch.codePointAt(0) ?? 0;
  return (c <= 0x1f && c !== 0x09 && c !== 0x0a) || (c >= 0x7f && c <= 0x9f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);
});

/**
 * @param {unknown} raw the request body value (absent, null or blank = no message)
 * @returns {{ ok: true, value: string | null } | { ok: false, code: 'MESSAGE_INVALID' | 'MESSAGE_TOO_LONG' | 'MESSAGE_MARKUP_REFUSED' }}
 */
export function validateBookingMessage(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, code: 'MESSAGE_INVALID' };
  const text = raw.replace(/\r\n?/g, '\n').normalize('NFC').trim();
  if (!text) return { ok: true, value: null };
  if (Array.from(text).length > BOOKING_MESSAGE_MAX_LENGTH) return { ok: false, code: 'MESSAGE_TOO_LONG' };
  if (hasForbiddenChar(text)) return { ok: false, code: 'MESSAGE_INVALID' };
  if (MARKUP.test(text)) return { ok: false, code: 'MESSAGE_MARKUP_REFUSED' };
  return { ok: true, value: text.replace(/\n{3,}/g, '\n\n') };
}

/** the French refusal text of a validation code @param {'MESSAGE_INVALID' | 'MESSAGE_TOO_LONG' | 'MESSAGE_MARKUP_REFUSED'} code */
export function bookingMessageRefusal(code) {
  const message = code === 'MESSAGE_TOO_LONG'
    ? `Le message ne peut pas dépasser ${BOOKING_MESSAGE_MAX_LENGTH} caractères.`
    : code === 'MESSAGE_MARKUP_REFUSED'
      ? 'Le message doit être du texte simple, sans balises.'
      : 'Le message contient des caractères non acceptés.';
  return { status: 400, body: { error: code, code, message } };
}
