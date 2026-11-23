/**
 * X01 (expansion) — the shared vocabulary of the community story screens: the reasons of a report / a moderation decision (closed list, the same as
 * api/_services/community-stories.js and the CHECKs of drizzle/0055), the version of the consent wording shown next to the box (the server refuses any other),
 * the limits, the states, and the writing direction of a story's own language. No sample story lives here or anywhere in the code: only real ones, from the API.
 */

export const REASONS = Object.freeze(['HEALTH_DETAIL', 'PERSONAL_DATA', 'OFFENSIVE', 'MISLEADING', 'ADVERTISING', 'OFF_TOPIC']);
export const STORY_CONSENT_VERSION = 'x01-v12-2026-11-23';
export const TITLE_MIN = 5;
export const TITLE_MAX = 120;
export const BODY_MIN = 50;
export const BODY_MAX = 3000;
export const STORY_LANGS = Object.freeze(['fr', 'en', 'de', 'tr', 'ar', 'uk']);

/** @typedef {(key: string, fallback: string, opts?: Record<string, unknown>) => string} T */

/** the attributes of the element holding a story written in `lang` (its own language, whatever the interface language) @param {string} lang */
export const textAttrs = (lang) => ({ lang, dir: lang === 'ar' ? 'rtl' : 'ltr' });

/** @param {string} code @param {T} t */
export function reasonLabel(code, t) {
  /** @type {Record<string, string>} */
  const labels = {
    HEALTH_DETAIL: t('stories:reason.health', 'Détail sur la santé ou un handicap'),
    PERSONAL_DATA: t('stories:reason.personal_data', 'Données personnelles (nom, adresse, contact d’une personne)'),
    OFFENSIVE: t('stories:reason.offensive', 'Propos injurieux ou discriminatoires'),
    MISLEADING: t('stories:reason.misleading', 'Contenu trompeur'),
    ADVERTISING: t('stories:reason.advertising', 'Publicité'),
    OFF_TOPIC: t('stories:reason.off_topic', 'Hors sujet'),
  };
  return labels[code] || code;
}

/** @param {string} status @param {T} t */
export function statusLabel(status, t) {
  /** @type {Record<string, string>} */
  const labels = {
    pending: t('stories:status.pending', 'En attente de relecture'),
    published: t('stories:status.published', 'Publiée'),
    rejected: t('stories:status.rejected', 'Non publiée par la modération'),
    withdrawn: t('stories:status.withdrawn', 'Retirée par vous'),
    taken_down: t('stories:status.taken_down', 'Retirée par la modération'),
  };
  return labels[status] || status;
}

/** the message of a refusal code the server sent while joining or posting (the server's own French text otherwise) @param {string} code @param {T} t */
export function problemLabel(code, t) {
  /** @type {Record<string, string>} */
  const labels = {
    PSEUDONYM_INVALID: t('stories:problem.pseudonym_invalid', 'Pseudonyme : 3 à 24 lettres, chiffres, « - » ou « _ », sans espace ni « @ ».'),
    PSEUDONYM_TAKEN: t('stories:problem.pseudonym_taken', 'Ce pseudonyme est déjà utilisé : choisissez-en un autre.'),
    PSEUDONYM_FROM_EMAIL: t('stories:problem.pseudonym_email', 'N’utilisez pas le début de votre adresse e-mail comme pseudonyme.'),
    PSEUDONYM_RESERVED: t('stories:problem.pseudonym_reserved', 'Ce pseudonyme pourrait faire croire à un compte officiel ou de modération.'),
    PSEUDONYM_LOOKS_LIKE_CONTACT: t('stories:problem.pseudonym_digits', 'Le pseudonyme ne doit pas contenir une longue suite de chiffres.'),
    IMAGE_OR_MARKUP: t('stories:problem.image', 'Pas d’image, de code ni de mise en forme : du texte seulement.'),
    CONTACT_OR_LINK_IN_TEXT: t('stories:problem.contact', 'Pas de lien, d’adresse e-mail ni de compte de réseau social dans l’histoire.'),
    PHONE_IN_TEXT: t('stories:problem.phone', 'Pas de numéro de téléphone dans l’histoire.'),
    ADULT_ACCOUNT_REQUIRED: t('stories:problem.adult', 'La communauté est réservée aux comptes de personnes de 18 ans ou plus.'),
    TOO_MANY_PENDING: t('stories:problem.pending', 'Vous avez déjà trop d’histoires en attente de relecture.'),
    SUBMIT_LIMIT: t('stories:problem.limit', 'Vous avez atteint le nombre d’histoires possibles pour aujourd’hui.'),
  };
  return labels[code] || '';
}
