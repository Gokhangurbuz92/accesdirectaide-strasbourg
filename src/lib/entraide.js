/**
 * X03 (expansion) — the shared vocabulary of the Entraide screens: the CLOSED lists (help categories, coarse areas, report / suspension reasons — the same as
 * api/_services/entraide.js and the CHECKs of drizzle/0057), the versions of the charter and of the contact-sharing wording (the server refuses any other),
 * the note limit and the state labels. No sample offer lives here or anywhere in the code: only real ones, from the API.
 * ⚠ A dedicated AIPD is mandatory before any opening; adding a category (especially a health, disability, addiction, legal-status, religion, sexuality or
 * ethnicity one) or a free-text need is a new processing that needs a new AIPD review.
 */

export const CATEGORIES = Object.freeze(['ADMIN_APPOINTMENT', 'SHOPPING', 'DIGITAL_HELP', 'FRENCH_CONVERSATION', 'PET_CARE', 'MOVING_HELP']);
export const AREAS = Object.freeze(['STRASBOURG_CENTRE', 'STRASBOURG_GARE', 'STRASBOURG_KRUTENAU_ESPLANADE', 'STRASBOURG_ORANGERIE_CONSEIL_DES_XV', 'STRASBOURG_ROBERTSAU_WACKEN',
  'STRASBOURG_CRONENBOURG', 'STRASBOURG_HAUTEPIERRE_POTERIES', 'STRASBOURG_KOENIGSHOFFEN_MONTAGNE_VERTE_ELSAU', 'STRASBOURG_MEINAU', 'STRASBOURG_NEUDORF_PORT_DU_RHIN',
  'STRASBOURG_NEUHOF', 'SCHILTIGHEIM', 'BISCHHEIM', 'HOENHEIM', 'ILLKIRCH_GRAFFENSTADEN', 'LINGOLSHEIM', 'OSTWALD', 'AUTRE_EUROMETROPOLE']);
export const REASONS = Object.freeze(['HARASSMENT', 'MONEY_REQUEST', 'UNSAFE_BEHAVIOUR', 'INAPPROPRIATE_CONTENT', 'SENSITIVE_DATA', 'SPAM']);
export const CHARTER_VERSION = 'x03-2026-11-19-projet';
export const CONTACT_VERSION = 'x03-contact-2026-11-19-projet';
export const NOTE_MAX = 280;

/** place names (proper nouns, the same in every language) */
const PLACES = /** @type {Record<string, string>} */ ({
  STRASBOURG_CENTRE: 'Strasbourg — Centre', STRASBOURG_GARE: 'Strasbourg — Gare', STRASBOURG_KRUTENAU_ESPLANADE: 'Strasbourg — Krutenau, Esplanade',
  STRASBOURG_ORANGERIE_CONSEIL_DES_XV: 'Strasbourg — Orangerie, Conseil des XV', STRASBOURG_ROBERTSAU_WACKEN: 'Strasbourg — Robertsau, Wacken',
  STRASBOURG_CRONENBOURG: 'Strasbourg — Cronenbourg', STRASBOURG_HAUTEPIERRE_POTERIES: 'Strasbourg — Hautepierre, Poteries',
  STRASBOURG_KOENIGSHOFFEN_MONTAGNE_VERTE_ELSAU: 'Strasbourg — Koenigshoffen, Montagne Verte, Elsau', STRASBOURG_MEINAU: 'Strasbourg — Meinau',
  STRASBOURG_NEUDORF_PORT_DU_RHIN: 'Strasbourg — Neudorf, Port du Rhin', STRASBOURG_NEUHOF: 'Strasbourg — Neuhof', SCHILTIGHEIM: 'Schiltigheim', BISCHHEIM: 'Bischheim',
  HOENHEIM: 'Hoenheim', ILLKIRCH_GRAFFENSTADEN: 'Illkirch-Graffenstaden', LINGOLSHEIM: 'Lingolsheim', OSTWALD: 'Ostwald',
});

/** @typedef {(key: string, fallback: string, opts?: Record<string, unknown>) => string} T */

/** @param {string} code @param {T} t */
export function areaLabel(code, t) {
  return code === 'AUTRE_EUROMETROPOLE' ? t('entraide:area.other', 'Autre commune de l’Eurométropole') : PLACES[code] || code;
}

/** @param {string} code @param {T} t */
export function categoryLabel(code, t) {
  /** @type {Record<string, string>} */
  const labels = {
    ADMIN_APPOINTMENT: t('entraide:category.admin_appointment', 'Accompagnement à un rendez-vous administratif'),
    SHOPPING: t('entraide:category.shopping', 'Aide aux courses'),
    DIGITAL_HELP: t('entraide:category.digital', 'Aide numérique (téléphone, ordinateur, internet)'),
    FRENCH_CONVERSATION: t('entraide:category.french', 'Conversation en français'),
    PET_CARE: t('entraide:category.pets', 'Garde d’animaux'),
    MOVING_HELP: t('entraide:category.moving', 'Coup de main pour un déménagement'),
  };
  return labels[code] || code;
}

/** @param {string} code @param {T} t */
export function reasonLabel(code, t) {
  /** @type {Record<string, string>} */
  const labels = {
    HARASSMENT: t('entraide:reason.harassment', 'Harcèlement ou propos insistants'),
    MONEY_REQUEST: t('entraide:reason.money', 'Demande d’argent ou de paiement'),
    UNSAFE_BEHAVIOUR: t('entraide:reason.unsafe', 'Comportement inquiétant ou dangereux'),
    INAPPROPRIATE_CONTENT: t('entraide:reason.inappropriate', 'Propos injurieux ou discriminatoires'),
    SENSITIVE_DATA: t('entraide:reason.sensitive', 'Demande ou partage d’informations personnelles sensibles'),
    SPAM: t('entraide:reason.spam', 'Publicité ou fausse offre'),
  };
  return labels[code] || code;
}

/** @param {string} status @param {T} t */
export function requestStatusLabel(status, t) {
  /** @type {Record<string, string>} */
  const labels = {
    pending: t('entraide:request_status.pending', 'En attente de réponse'),
    accepted: t('entraide:request_status.accepted', 'Acceptée des deux côtés'),
    declined: t('entraide:request_status.declined', 'Non retenue'),
    withdrawn: t('entraide:request_status.withdrawn', 'Retirée'),
    ended: t('entraide:request_status.ended', 'Terminée'),
  };
  return labels[status] || status;
}

/** @param {string} status @param {T} t */
export function offerStatusLabel(status, t) {
  /** @type {Record<string, string>} */
  const labels = { open: t('entraide:offer_status.open', 'Visible'), paused: t('entraide:offer_status.paused', 'En pause'), closed: t('entraide:offer_status.closed', 'Fermée') };
  return labels[status] || status;
}

/** the message of a refusal code the server sent (the server's own French text otherwise) @param {string} code @param {T} t */
export function problemLabel(code, t) {
  /** @type {Record<string, string>} */
  const labels = {
    PSEUDONYM_INVALID: t('entraide:problem.pseudonym_invalid', 'Pseudonyme : 3 à 24 lettres, chiffres, « - » ou « _ », sans espace ni « @ ».'),
    PSEUDONYM_TAKEN: t('entraide:problem.pseudonym_taken', 'Ce pseudonyme est déjà utilisé : choisissez-en un autre.'),
    PSEUDONYM_FROM_EMAIL: t('entraide:problem.pseudonym_email', 'N’utilisez pas le début de votre adresse e-mail comme pseudonyme.'),
    PSEUDONYM_RESERVED: t('entraide:problem.pseudonym_reserved', 'Ce pseudonyme pourrait faire croire à un compte officiel ou de modération.'),
    PSEUDONYM_LOOKS_LIKE_CONTACT: t('entraide:problem.pseudonym_digits', 'Le pseudonyme ne doit pas contenir une longue suite de chiffres.'),
    PSEUDONYM_SAME_AS_COMMUNITY: t('entraide:problem.pseudonym_community', 'Choisissez un pseudonyme différent de celui de vos histoires.'),
    ADULT_ACCOUNT_REQUIRED: t('entraide:problem.adult', 'L’entraide est réservée aux comptes de personnes de 18 ans ou plus.'),
    MEMBER_SUSPENDED: t('entraide:problem.suspended', 'Votre participation est suspendue par la modération.'),
    IMAGE_OR_MARKUP: t('entraide:problem.markup', 'Du texte seulement, sans mise en forme.'),
    CONTACT_OR_LINK_IN_TEXT: t('entraide:problem.contact', 'Pas de lien, d’adresse e-mail ni de compte de réseau social dans la note.'),
    PHONE_IN_TEXT: t('entraide:problem.phone', 'Pas de numéro de téléphone dans la note.'),
    MONEY_IN_NOTE: t('entraide:problem.money', 'L’entraide est gratuite : pas de prix, de montant ni de paiement dans la note.'),
    TOO_MANY_OFFERS: t('entraide:problem.offers', 'Vous avez déjà le nombre maximal d’offres en cours.'),
    TOO_MANY_PENDING: t('entraide:problem.pending', 'Vous avez déjà le nombre maximal de demandes en attente.'),
    OFFER_LIMIT: t('entraide:problem.limit', 'Limite du jour atteinte : réessayez demain.'),
    REQUEST_LIMIT: t('entraide:problem.limit', 'Limite du jour atteinte : réessayez demain.'),
    REPORT_LIMIT: t('entraide:problem.limit', 'Limite du jour atteinte : réessayez demain.'),
    ALREADY_REQUESTED: t('entraide:problem.already_requested', 'Vous avez déjà une demande en cours sur cette offre.'),
    ALREADY_REPORTED: t('entraide:problem.already_reported', 'Vous avez déjà signalé cette personne.'),
    EMAIL_INVALID: t('entraide:problem.email', 'Adresse e-mail invalide.'),
  };
  return labels[code] || '';
}
