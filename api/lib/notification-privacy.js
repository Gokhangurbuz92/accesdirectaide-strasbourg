/**
 * R45 / ENG-LR-3 — privacy levels of the notifications a person receives about an appointment (AIPD risk A8: a relative, or someone sharing the device or
 * the mailbox, discovers an appointment with a sensitive organisation from an e-mail, its preview, a forwarded copy, an SMS or a lock-screen notification).
 * Measure P-6 of the AIPD (« e-mail minimal »).
 *
 *   minimal   the service is `sensitive`, or its sensitivity is `unknown` (fail-closed: the DEFAULT for every appointment until a verified classification
 *             exists). The message says only that there is new information in the person's space: no structure, no service or category, no professional,
 *             no date, time or place, no booking message, no kind of event (a cancellation reads exactly like a confirmation), no calendar file, a link to
 *             the generic account page (/compte: no appointment id, no structure slug). The provider category is neutral too (`account_notice`).
 *   reduced   the service is verified `ordinary`. Useful transactional content (date / time, modality, the structure's public name and public address,
 *             the calendar file), but never the booking message nor any free text of the person; subjects stay the neutral catalogue subjects.
 *
 * Sensitivity values: 'sensitive' | 'ordinary' | 'unknown' (api/lib/service-sensitivity.js `resolveServiceSensitivity(record)`, another workstream).
 * ONE injection point: every builder takes `deps.resolveSensitivity` and falls back to `defaultResolveSensitivity` below (() => 'unknown'). Wiring the
 * real resolver = changing that default (or passing it). Anything else — an exception, a rejected promise, an unknown value — is 'unknown' → minimal.
 *
 * Texts: French is the source; the five other languages are comprehension aids drafted by AI, not yet reviewed by native speakers (same status as
 * api/_utils/mail-catalogue.js). No placeholder anywhere; tests/unit/r45-notification-privacy.test.js checks every language for leaks.
 * Pure module (no I/O, no database).
 */
import { LANGUAGE_CODES, SOURCE_LANGUAGE, languageOf, matchLanguage } from '../../src/i18n/languages.js';

export const SENSITIVITY_VALUES = Object.freeze(['sensitive', 'ordinary', 'unknown']);
export const NOTIFICATION_PRIVACY_LEVELS = Object.freeze(['minimal', 'reduced']);
/** the neutral provider category of a minimal message (Mailjet EventPayload / logs): never the kind of appointment event */
export const MINIMAL_CATEGORY = 'account_notice';
/** the generic account page a minimal message links to (no appointment id, no structure slug, not even « rendez-vous ») */
export const MINIMAL_PATH = '/compte';

/** @typedef {'sensitive' | 'ordinary' | 'unknown'} Sensitivity */
/** @typedef {'minimal' | 'reduced'} PrivacyLevel */

/** the pure fallback (no classification readable): nothing is verified ordinary, so the message is minimal. */
export const defaultResolveSensitivity = (/** @type {unknown} */ _record) => /** @type {Sensitivity} */ ('unknown');

/** the production resolver (lazy import; any failure → 'unknown') @param {unknown} record */
const appointmentResolver = async (record) => {
  try { return (await import('../_services/appointment-sensitivity.js')).resolveAppointmentSensitivity(record); } catch { return defaultResolveSensitivity(record); }
};

/** @param {unknown} v @returns {Sensitivity} */
export const normalizeSensitivity = (v) => (typeof v === 'string' && SENSITIVITY_VALUES.includes(v) ? /** @type {Sensitivity} */ (v) : 'unknown');

/** only a verified `ordinary` service gets the reduced level; `sensitive`, `unknown` and anything else get minimal @param {unknown} sensitivity @returns {PrivacyLevel} */
export const privacyLevelFor = (sensitivity) => (normalizeSensitivity(sensitivity) === 'ordinary' ? 'reduced' : 'minimal');

/**
 * The privacy level of the notifications about one appointment (or service) record. Never throws.
 * @param {unknown} record @param {{ resolveSensitivity?: (record: unknown) => unknown }} [deps]
 * @returns {Promise<{ sensitivity: Sensitivity, level: PrivacyLevel }>}
 */
export async function resolveNotificationPrivacy(record, deps = {}) {
  // R45 integration: without an injected resolver, the real one (verified classification of the appointment's service, api/_services/appointment-sensitivity.js),
  // loaded lazily so this module stays free of I/O at import time; a load or read failure is 'unknown' → minimal.
  const resolve = typeof deps?.resolveSensitivity === 'function' ? deps.resolveSensitivity : appointmentResolver;
  /** @type {Sensitivity} */
  let sensitivity = 'unknown';
  try { sensitivity = normalizeSensitivity(await resolve(record)); } catch { sensitivity = 'unknown'; }
  return { sensitivity, level: privacyLevelFor(sensitivity) };
}

/** @typedef {{ subject: string, preheader: string, heading: string, body: string, bodyGuest: string, cta: string, footer: string, sms: string, pushTitle: string, pushBody: string }} MinimalTexts */

/** @type {Readonly<Record<string, Readonly<MinimalTexts>>>} */
const MINIMAL = Object.freeze({
  fr: Object.freeze({
    subject: 'Accès Direct Aide — vous avez une nouvelle information dans votre espace',
    preheader: 'Connectez-vous à votre espace pour la consulter.',
    heading: 'Nouvelle information dans votre espace',
    body: 'Une nouvelle information vous attend dans votre espace Accès Direct Aide. Pour protéger votre vie privée, ce message n’en donne pas le détail : connectez-vous pour la consulter.',
    bodyGuest: 'Une nouvelle information vous concerne sur Accès Direct Aide. Pour protéger votre vie privée, ce message n’en donne pas le détail : utilisez le lien personnel que vous avez reçu d’Accès Direct Aide pour la consulter.',
    cta: 'Ouvrir mon espace',
    footer: 'Message automatique, merci de ne pas y répondre.',
    sms: 'Accès Direct Aide : vous avez une nouvelle information dans votre espace.',
    pushTitle: 'Accès Direct Aide',
    pushBody: 'Vous avez une nouvelle information dans votre espace.',
  }),
  en: Object.freeze({
    subject: 'Accès Direct Aide — you have new information in your account',
    preheader: 'Sign in to your account to see it.',
    heading: 'New information in your account',
    body: 'New information is waiting for you in your Accès Direct Aide account. To protect your privacy, this message does not give the details: sign in to see them.',
    bodyGuest: 'There is new information for you on Accès Direct Aide. To protect your privacy, this message does not give the details: use the personal link you received from Accès Direct Aide to see them.',
    cta: 'Open my account',
    footer: 'Automatic message, please do not reply.',
    sms: 'Accès Direct Aide: you have new information in your account.',
    pushTitle: 'Accès Direct Aide',
    pushBody: 'You have new information in your account.',
  }),
  tr: Object.freeze({
    subject: 'Accès Direct Aide — hesabınızda yeni bir bilgi var',
    preheader: 'Görmek için hesabınıza giriş yapın.',
    heading: 'Hesabınızda yeni bilgi',
    body: 'Accès Direct Aide hesabınızda sizi yeni bir bilgi bekliyor. Gizliliğinizi korumak için bu mesaj ayrıntı vermiyor: görmek için giriş yapın.',
    bodyGuest: 'Accès Direct Aide’da sizinle ilgili yeni bir bilgi var. Gizliliğinizi korumak için bu mesaj ayrıntı vermiyor: görmek için Accès Direct Aide’dan aldığınız kişisel bağlantıyı kullanın.',
    cta: 'Hesabımı aç',
    footer: 'Otomatik mesajdır, lütfen yanıtlamayın.',
    sms: 'Accès Direct Aide: hesabınızda yeni bir bilgi var.',
    pushTitle: 'Accès Direct Aide',
    pushBody: 'Hesabınızda yeni bir bilgi var.',
  }),
  ar: Object.freeze({
    subject: 'Accès Direct Aide — لديك معلومة جديدة في حسابك',
    preheader: 'سجّل الدخول إلى حسابك للاطلاع عليها.',
    heading: 'معلومة جديدة في حسابك',
    body: 'تنتظرك معلومة جديدة في حسابك على Accès Direct Aide. حمايةً لخصوصيتك، لا تتضمن هذه الرسالة التفاصيل: سجّل الدخول للاطلاع عليها.',
    bodyGuest: 'توجد معلومة جديدة تخصّك على Accès Direct Aide. حمايةً لخصوصيتك، لا تتضمن هذه الرسالة التفاصيل: استخدم الرابط الشخصي الذي تلقيته من Accès Direct Aide للاطلاع عليها.',
    cta: 'فتح حسابي',
    footer: 'رسالة آلية، يُرجى عدم الرد عليها.',
    sms: 'Accès Direct Aide: لديك معلومة جديدة في حسابك.',
    pushTitle: 'Accès Direct Aide',
    pushBody: 'لديك معلومة جديدة في حسابك.',
  }),
  de: Object.freeze({
    subject: 'Accès Direct Aide — Sie haben eine neue Information in Ihrem Konto',
    preheader: 'Melden Sie sich in Ihrem Konto an, um sie zu lesen.',
    heading: 'Neue Information in Ihrem Konto',
    body: 'In Ihrem Konto bei Accès Direct Aide wartet eine neue Information auf Sie. Zum Schutz Ihrer Privatsphäre nennt diese Nachricht keine Einzelheiten: Melden Sie sich an, um sie zu lesen.',
    bodyGuest: 'Bei Accès Direct Aide gibt es eine neue Information für Sie. Zum Schutz Ihrer Privatsphäre nennt diese Nachricht keine Einzelheiten: Verwenden Sie den persönlichen Link, den Sie von Accès Direct Aide erhalten haben, um sie zu lesen.',
    cta: 'Mein Konto öffnen',
    footer: 'Automatische Nachricht, bitte nicht antworten.',
    sms: 'Accès Direct Aide: Sie haben eine neue Information in Ihrem Konto.',
    pushTitle: 'Accès Direct Aide',
    pushBody: 'Sie haben eine neue Information in Ihrem Konto.',
  }),
  uk: Object.freeze({
    subject: 'Accès Direct Aide — у вашому обліковому записі є нова інформація',
    preheader: 'Увійдіть до облікового запису, щоб її переглянути.',
    heading: 'Нова інформація у вашому обліковому записі',
    body: 'У вашому обліковому записі Accès Direct Aide на вас чекає нова інформація. Щоб захистити вашу приватність, це повідомлення не містить подробиць: увійдіть, щоб її переглянути.',
    bodyGuest: 'На Accès Direct Aide є нова інформація для вас. Щоб захистити вашу приватність, це повідомлення не містить подробиць: скористайтеся персональним посиланням, яке ви отримали від Accès Direct Aide, щоб її переглянути.',
    cta: 'Відкрити мій обліковий запис',
    footer: 'Автоматичне повідомлення, будь ласка, не відповідайте на нього.',
    sms: 'Accès Direct Aide: у вашому обліковому записі є нова інформація.',
    pushTitle: 'Accès Direct Aide',
    pushBody: 'У вашому обліковому записі є нова інформація.',
  }),
});

/** the supported language of a person (« ar-MA » → ar), French otherwise @param {unknown} lang @returns {string} */
export function privacyLanguage(lang) {
  const code = typeof lang === 'string' ? (matchLanguage(lang) || '') : '';
  return LANGUAGE_CODES.includes(code) ? code : SOURCE_LANGUAGE;
}

/** the minimal texts of a language, with its direction @param {unknown} lang @returns {MinimalTexts & { lang: string, dir: 'ltr' | 'rtl' }} */
export function minimalTexts(lang) {
  const code = privacyLanguage(lang);
  return { ...MINIMAL[code], lang: code, dir: languageOf(code)?.dir || 'ltr' };
}

/** every language's minimal texts (tests, evidence) */
export const minimalCatalogue = () => MINIMAL;

const esc = (/** @type {unknown} */ v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
/** only an absolute http(s) link without query or fragment is printed (a caller can never smuggle an id or a slug in through the query) @param {unknown} url */
function safeLink(url) {
  try {
    const u = new URL(String(url || ''));
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
    u.search = ''; u.hash = '';
    return u.toString();
  } catch { return null; }
}

/** @param {MinimalTexts & { lang: string, dir: string }} t @param {boolean} guest @param {string | null} link */
function textPart(t, guest, link) {
  return [t.heading, '', guest ? t.bodyGuest : t.body, ...(link && !guest ? ['', `${t.cta}${t.lang === 'fr' ? ' :' : ':'} ${link}`] : []), '', t.footer].join('\n');
}
/** @param {MinimalTexts & { lang: string, dir: string }} t @param {boolean} guest @param {string | null} link */
function htmlPart(t, guest, link) {
  return `<div dir="${t.dir}" lang="${t.lang}" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; text-align: ${t.dir === 'rtl' ? 'right' : 'left'};">
    <h1 style="color: #1e293b; font-size: 20px;">${esc(t.heading)}</h1>
    <p style="color: #334155; line-height: 1.6;">${esc(guest ? t.bodyGuest : t.body)}</p>
    ${link && !guest ? `<p style="margin: 24px 0;"><a href="${esc(link)}" style="display: inline-block; background: #1d4ed8; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 700;">${esc(t.cta)}</a></p>` : ''}
    <p style="color: #64748b; font-size: 12px;">${esc(t.footer)}</p>
  </div>`;
}

/**
 * The minimal e-mail of every appointment notice kind (the SAME message for a confirmation, a move, a cancellation, a refusal or a J-1 reminder).
 * For a language other than French, the French version follows (the source wording), equally neutral.
 * @param {unknown} lang @param {{ url?: string | null, guest?: boolean }} [opts] url = the generic account page (absolute); guest = an account-free booking
 * @returns {{ subject: string, preheader: string, text: string, html: string, lang: string, dir: 'ltr' | 'rtl', category: string, attachments: [] }}
 */
export function minimalMail(lang, opts = {}) {
  const t = minimalTexts(lang); const fr = minimalTexts(SOURCE_LANGUAGE);
  const guest = Boolean(opts.guest); const link = safeLink(opts.url);
  const both = t.lang !== SOURCE_LANGUAGE;
  const text = both ? `${textPart(t, guest, link)}\n\n---\n\n${textPart(fr, guest, link)}` : textPart(t, guest, link);
  const html = `<!doctype html>
<html lang="${t.lang}" dir="${t.dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(t.subject)}</title></head>
<body style="margin: 0; padding: 24px; background: #ffffff;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${esc(t.preheader)}</div>
  ${htmlPart(t, guest, link)}
  ${both ? `<hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;">\n  ${htmlPart(fr, guest, link)}` : ''}
</body>
</html>`;
  return { subject: t.subject, preheader: t.preheader, text, html, lang: t.lang, dir: /** @type {'ltr' | 'rtl'} */ (t.dir), category: MINIMAL_CATEGORY, attachments: [] };
}

/** the minimal SMS body (the caller adds the opt-out line, api/lib/sms-policy.js withOptOut) @param {unknown} lang @returns {string} */
export const minimalSms = (lang) => minimalTexts(lang).sms;

/** the minimal web-push message (title, body, the generic account page) @param {unknown} lang @returns {{ title: string, body: string, url: string }} */
export function minimalPush(lang) {
  const t = minimalTexts(lang);
  return { title: t.pushTitle, body: t.pushBody, url: MINIMAL_PATH };
}

/**
 * Reduced level guard: the booking message (ProAppointment.notes, when it is readable here) and any free text of the person never reach a notification,
 * even if a caller's text were to quote it. Encrypted values (« v1:… ») cannot be quoted by a caller and are ignored. Texts shorter than 4 characters are
 * ignored too (they would erase ordinary words).
 * @param {string} text @param {{ notes?: unknown, freeText?: unknown } | null | undefined} record @returns {string}
 */
export function withoutPersonalFreeText(text, record) {
  let out = String(text ?? '');
  for (const v of [record?.notes, record?.freeText]) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s.length >= 4 && !/^v\d+:/.test(s)) out = out.split(s).join('[…]');
  }
  return out;
}
