/**
 * R42 (owner decision R42-A06) — the OPTIONAL short message of an appointment request:
 *   label  « Précisez brièvement le motif de votre rendez-vous (facultatif) »
 *   notice « Indiquez uniquement les informations nécessaires à votre demande. Ne transmettez pas de diagnostic ni de document médical dans ce champ. »
 *
 * Plain text only, bounded, never HTML. It is stored like the other personal data of an appointment: sealed (v1 envelope, api/lib/crypto.js) in
 * ProAppointment.notes — the same column and the same protection as the notes of a professional-created appointment — and shown only to the
 * structure's authorised staff (pro agenda). It never goes into a notification subject or text, a URL, a log line, analytics or a public API.
 */

export const BOOKING_MESSAGE_MAX_LENGTH = 500;
export const BOOKING_MESSAGE_LABEL = 'Précisez brièvement le motif de votre rendez-vous (facultatif)';
export const BOOKING_MESSAGE_NOTICE = 'Indiquez uniquement les informations nécessaires à votre demande. Ne transmettez pas de diagnostic ni de document médical dans ce champ.';

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
