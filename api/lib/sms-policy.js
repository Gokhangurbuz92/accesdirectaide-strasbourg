/**
 * PKG-11 / N02 — the rules every SMS of the platform follows (pure, no I/O).
 *  - send window: an SMS is only sent between 08:00 and 20:00, Paris time (every day); outside it nothing is sent;
 *  - every SMS ends with how to stop receiving them; « STOP » is written ONLY when the inbound STOP webhook is routed AND configured
 *    (SMS_INBOUND_URL + the provider auth token): the text never promises a channel that does not work. It is NOT routed yet: a provider post needs an
 *    exemption from the double-submit CSRF check, and api/index.js / api/_utils/csrf.js are byte-pinned by the frozen S1B/S1C scope guards — wiring it is a
 *    deliberate, reviewed router change (see PKG11_S8_EVIDENCE.md), never a side effect;
 *  - STOP keywords, French number normalization and the provider (Twilio) request signature check used by the inbound webhook.
 */
import crypto from 'node:crypto';

export const SEND_WINDOW = Object.freeze({ startHour: 8, endHour: 20, timeZone: 'Europe/Paris' });

/** Hour 0..23 of `date` in Paris (summer and winter time). */
export function parisHour(date = new Date()) {
  const part = new Intl.DateTimeFormat('en-GB', { timeZone: SEND_WINDOW.timeZone, hour: '2-digit', hourCycle: 'h23' }).formatToParts(date).find((p) => p.type === 'hour');
  return Number(part?.value);
}
export const isSmsSendWindow = (date = new Date()) => { const h = parisHour(date); return h >= SEND_WINDOW.startHour && h < SEND_WINDOW.endHour; };

/** Whether the inbound webhook is configured with a verifiable signature (the handler answers 404 otherwise). */
export const inboundStopConfigured = (env = process.env) => Boolean(String(env.SMS_INBOUND_URL || '').startsWith('https://') && env.TWILIO_AUTH_TOKEN);
/** The STOP handler (api/_services/sms-stop.js) is not routed yet (see above): until it is, no SMS may say « STOP ». */
export const INBOUND_STOP_ROUTED = false;
/**
 * PKG-11 / N02 (owner decision 2026-10-24): the SMS channel stays INACTIVE until a reply « STOP » is really honoured — the STOP webhook routed AND configured with
 * a verifiable signature. Every sender checks this before calling the provider (rdv-reminder, parcours-reminder, sms-notify): a configured provider alone no longer
 * sends anything. Until then reminders go by e-mail and in-app, and the SMS consent screens say that SMS are not active.
 */
export const optOutReady = (env = process.env, routed = INBOUND_STOP_ROUTED) => Boolean(routed && inboundStopConfigured(env));

/** The opt-out line appended to every SMS (GSM-7 characters only). */
export const optOutLine = (env = process.env, routed = INBOUND_STOP_ROUTED) => (routed && inboundStopConfigured(env) ? 'STOP pour ne plus recevoir ces SMS.' : 'Arreter ces SMS : Mon compte > Notifications.');
export const withOptOut = (/** @type {string} */ text, env = process.env) => `${String(text).trim()} ${optOutLine(env)}`;

const STOP_WORDS = new Set(['STOP', 'STOPALL', 'ARRET', 'ARRETER', 'UNSUBSCRIBE', 'DESABONNER', 'DESINSCRIRE', 'DESINSCRIPTION', 'END', 'QUIT', 'CANCEL']);
/** A message whose first word is a STOP keyword (accents and case ignored). */
export function isStopKeyword(/** @type {unknown} */ body) {
  const first = String(body || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase().split(/[^A-Z]+/)[0];
  return STOP_WORDS.has(first);
}

/** A French mobile / landline number as +33XXXXXXXXX, or null. Accepts 0X…, +33X…, 0033X… with spaces, dots or dashes. */
export function normalizeFrenchPhone(/** @type {unknown} */ value) {
  const d = String(value || '').replace(/[\s.\-()]/g, '');
  const m = d.match(/^(?:\+33|0033|0)([1-9]\d{8})$/);
  return m ? `+33${m[1]}` : null;
}

/**
 * Twilio request signature: base64 HMAC-SHA1 (auth token) of the full URL followed by every POST parameter as key + value, keys sorted.
 * @param {string} authToken @param {string} url @param {Record<string, unknown>} params
 */
export function twilioSignature(authToken, url, params) {
  const data = Object.keys(params || {}).sort().reduce((acc, k) => acc + k + String(params[k] ?? ''), String(url));
  return crypto.createHmac('sha1', String(authToken)).update(Buffer.from(data, 'utf8')).digest('base64');
}
/** @param {{ authToken?: string, url?: string, params: Record<string, unknown>, signature?: unknown }} input */
export function verifyTwilioSignature({ authToken, url, params, signature }) {
  if (!authToken || !url || !signature) return false;
  const want = Buffer.from(twilioSignature(authToken, url, params));
  const got = Buffer.from(String(signature));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
