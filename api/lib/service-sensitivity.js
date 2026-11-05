/**
 * R45 (ENG-LR-2, D2 P5s [PROPOSITION — À VALIDER PAR LE RESPONSABLE DE TRAITEMENT]) — the sensitivity of a bookable service (GDPR art. 9: booking a
 * service in mental health, addiction, disability… can reveal health data; CJEU C-21/23 transposition [REVUE JURIDIQUE] pending).
 *
 *   SENSITIVITY           sensitive | ordinary | unknown. Only an administrator's review sets sensitive or ordinary (api/_services/service-sensitivity-review.js);
 *                         a stored record that is not a complete review (value + reviewedAt + reviewedBy) reads as unknown. A heuristic only SUGGESTS.
 *   resolveServiceSensitivity(record)   the verified value of ONE service record, else 'unknown' (stable signature: the mail worker injects it).
 *   sensitiveBookingOpen(env)           the art. 9 booking capability: CLOSED unless ADA_SENSITIVE_BOOKING_APPROVED is exactly SENSITIVE_BOOKING_APPROVAL_VALUE
 *                                       AND ADA_HDS_BOOKING_ASSESSED=1 (both owner/legal actions). Any other value opens nothing.
 *   sensitivityReviewEnforced(env)      whether an UNREVIEWED (unknown) service is refused: ON when the restricted public beta is on, or VERCEL_ENV is
 *                                       production / preview (no variable can switch it off there), or ADA_SENSITIVITY_REVIEW_ENFORCED=1. In development /
 *                                       test without them (LAB, native QA launcher) an unknown service books normally.
 *   bookingDecision(value, env)         the rule applied by the booking routes (see below).
 *   treatAsSensitive(value)             for notifications, logs and analytics, unknown is ALWAYS treated as sensitive.
 *
 * Rule (lead clarification R45, binding):
 *   (1) verified sensitive + gate closed → refused SENSITIVE_BOOKING_NOT_OPEN, in EVERY environment;
 *       verified sensitive + gate open   → allowed only with the separate, unticked explicit consent (SENSITIVE_CONSENT_REQUIRED otherwise);
 *   (2) unknown + enforcement on         → refused SERVICE_SENSITIVITY_UNREVIEWED (a structure opens online booking service by service, once reviewed);
 *       unknown + enforcement off        → books normally (LAB only);
 *   (3) verified ordinary                → books normally.
 */
import { isPublicBetaRestricted } from '../_utils/public-beta.js';

export const SENSITIVITY = Object.freeze({ SENSITIVE: 'sensitive', ORDINARY: 'ordinary', UNKNOWN: 'unknown' });

/** the exact value of ADA_SENSITIVE_BOOKING_APPROVED that opens the art. 9 booking (with ADA_HDS_BOOKING_ASSESSED=1) — set only after the legal confirmation */
export const SENSITIVE_BOOKING_APPROVAL_VALUE = 'art9-explicit-consent-v1';

/** the explicit art. 9(2)(a) consent of a sensitive-service booking (ConsentLog purpose; one row per decision, the appointment id in policy_hash) */
export const SENSITIVE_BOOKING_CONSENT_PURPOSE = 'SENSITIVE_SERVICE_BOOKING_ART9';
/** the wording version — a DRAFT until the controller approves D2 P5s */
export const SENSITIVE_BOOKING_CONSENT_VERSION = 'r45-p5s-draft-2026-11-05';
/** French canonical wording [PROPOSITION — À VALIDER] (the interface shows it in six languages, booking:sensitive.consent_r45) */
export const SENSITIVE_BOOKING_CONSENT = 'J’accepte que la plateforme transmette ma demande de rendez-vous à ce service. Je sais que la nature de ce service peut révéler une information sur ma santé ou un handicap. Cet accord sert uniquement à traiter ce rendez-vous. Je peux le retirer à tout moment depuis mon espace : le rendez-vous à venir est alors annulé.';

export const SENSITIVITY_CODES = Object.freeze({
  NOT_OPEN: 'SENSITIVE_BOOKING_NOT_OPEN',
  UNREVIEWED: 'SERVICE_SENSITIVITY_UNREVIEWED',
  CONSENT_REQUIRED: 'SENSITIVE_CONSENT_REQUIRED',
});

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The verified sensitivity of ONE service record ({ value, reviewedAt, reviewedBy, … } as stored by the administrator review), else 'unknown'.
 * @param {unknown} record @returns {'sensitive' | 'ordinary' | 'unknown'}
 */
export function resolveServiceSensitivity(record) {
  if (!isObject(record)) return SENSITIVITY.UNKNOWN;
  const value = record.value;
  if (value !== SENSITIVITY.SENSITIVE && value !== SENSITIVITY.ORDINARY) return SENSITIVITY.UNKNOWN;
  const at = typeof record.reviewedAt === 'string' ? Date.parse(record.reviewedAt) : NaN;
  if (!Number.isFinite(at) || typeof record.reviewedBy !== 'string' || !record.reviewedBy.trim()) return SENSITIVITY.UNKNOWN;
  return value;
}

/** @param {Record<string, string | undefined>} [env] */
export function sensitiveBookingOpen(env = process.env) {
  return String(env.ADA_SENSITIVE_BOOKING_APPROVED ?? '') === SENSITIVE_BOOKING_APPROVAL_VALUE && String(env.ADA_HDS_BOOKING_ASSESSED ?? '') === '1';
}

/** @param {Record<string, string | undefined>} [env] */
export function sensitivityReviewEnforced(env = process.env) {
  const vercel = String(env.VERCEL_ENV ?? '').trim().toLowerCase();
  if (vercel === 'production' || vercel === 'preview') return true;
  if (isPublicBetaRestricted(env)) return true;
  return String(env.ADA_SENSITIVITY_REVIEW_ENFORCED ?? '').trim() === '1';
}

/** unknown is always treated as sensitive for notifications, logs and analytics @param {unknown} value */
export const treatAsSensitive = (value) => value !== SENSITIVITY.ORDINARY;

/**
 * @param {unknown} value a resolved sensitivity @param {Record<string, string | undefined>} [env]
 * @returns {{ allowed: true, requiresConsent: boolean } | { allowed: false, code: string }}
 */
export function bookingDecision(value, env = process.env) {
  if (value === SENSITIVITY.ORDINARY) return { allowed: true, requiresConsent: false };
  if (value === SENSITIVITY.SENSITIVE) return sensitiveBookingOpen(env) ? { allowed: true, requiresConsent: true } : { allowed: false, code: SENSITIVITY_CODES.NOT_OPEN };
  // unknown (anything else reads as unknown)
  return sensitivityReviewEnforced(env) ? { allowed: false, code: SENSITIVITY_CODES.UNREVIEWED } : { allowed: true, requiresConsent: false };
}

/** the neutral refusal (it describes the service's online booking, never the person) @param {string} code */
export function sensitivityRefusal(code) {
  return { status: 409, body: { error: code, code,
    message: 'La prise de rendez-vous en ligne n’est pas proposée pour ce service. Pour un rendez-vous, contactez directement la structure par ses moyens de contact habituels.' } };
}

// A proposal heuristic for the administrator ONLY: it never sets a value. Keywords of specialised support whose booking can reveal health or disability.
const KEYWORDS = [
  'sante mentale', 'psychiatr', 'psycholog', 'psychotherap', 'pedopsychiatr', 'cmpp', 'cmp ', 'addict', 'csapa', 'caarud', 'alcool', 'tabacolog', 'toxicoman',
  'drogue', 'handicap', 'mdph', 'esat', 'sessad', 'ime ', 'samsah', 'savs', 'autism', 'vih', 'sida', 'cegidd', 'depistage', 'ivg', 'contracept',
  'planning familial', 'grossesse', 'perinat', 'soins palliatifs', 'dialyse', 'cancer', 'oncolog', 'alzheimer', 'memoire', 'violences', 'victime',
];
const fold = (/** @type {unknown} */ s) => ` ${String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;

/**
 * @param {{ serviceName?: string, structure?: { type_structure?: string | null, type_finess?: string | null, categories_aidees?: string[] | null, services?: string[] | null } }} input
 * @returns {{ suggestion: 'sensitive' | 'no_signal', matched: string[] }} never a verified value
 */
export function suggestSensitivity(input = {}) {
  const st = input.structure || {};
  const text = fold([input.serviceName, st.type_structure, st.type_finess, ...(st.categories_aidees || []), ...(st.services || [])].join(' '));
  const matched = KEYWORDS.filter((k) => (k.endsWith(' ') ? text.includes(` ${k}`) : text.includes(k)));   // « cmp » / « ime »: whole words only
  return { suggestion: matched.length ? 'sensitive' : 'no_signal', matched: [...new Set(matched.map((k) => k.trim()))].slice(0, 10) };
}
