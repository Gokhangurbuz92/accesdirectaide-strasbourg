/**
 * X02 (expansion) — the shared vocabulary of the testimonial screens: the reasons of a report / a moderation decision (closed list, the same as
 * api/_services/testimonials.js and the CHECKs of drizzle/0054), the version of the consent wording shown next to the box (the server refuses any other),
 * the states, and the writing direction of a testimonial's own language. No sample testimonial lives here or anywhere in the code: only real ones, from the API.
 */

export const REASONS = Object.freeze(['HEALTH_DETAIL', 'PERSONAL_DATA', 'OFFENSIVE', 'MISLEADING', 'ADVERTISING', 'OFF_TOPIC']);
export const TESTIMONIAL_CONSENT_VERSION = 'x02-2026-11-19-lab-proposal';
export const BODY_MIN = 30;
export const BODY_MAX = 1500;
export const TESTIMONIAL_LANGS = Object.freeze(['fr', 'en', 'de', 'tr', 'ar', 'uk']);

/** @typedef {(key: string, fallback: string, opts?: Record<string, unknown>) => string} T */

/** the attributes of the element holding a testimonial written in `lang` (its own language, whatever the interface language) @param {string} lang */
export const textAttrs = (lang) => ({ lang, dir: lang === 'ar' ? 'rtl' : 'ltr' });

/** @param {string} code @param {T} t */
export function reasonLabel(code, t) {
  /** @type {Record<string, string>} */
  const labels = {
    HEALTH_DETAIL: t('testimonials:reason.health', 'Détail sur la santé ou un handicap'),
    PERSONAL_DATA: t('testimonials:reason.personal_data', 'Données personnelles (nom, adresse, contact d’une personne)'),
    OFFENSIVE: t('testimonials:reason.offensive', 'Propos injurieux ou discriminatoires'),
    MISLEADING: t('testimonials:reason.misleading', 'Contenu trompeur'),
    ADVERTISING: t('testimonials:reason.advertising', 'Publicité'),
    OFF_TOPIC: t('testimonials:reason.off_topic', 'Hors sujet'),
  };
  return labels[code] || code;
}

/** @param {string} status @param {T} t */
export function statusLabel(status, t) {
  /** @type {Record<string, string>} */
  const labels = {
    pending: t('testimonials:status.pending', 'En attente de relecture'),
    published: t('testimonials:status.published', 'Publié'),
    rejected: t('testimonials:status.rejected', 'Non publié par la modération'),
    withdrawn: t('testimonials:status.withdrawn', 'Retiré par vous'),
    taken_down: t('testimonials:status.taken_down', 'Retiré par la modération'),
  };
  return labels[status] || status;
}
