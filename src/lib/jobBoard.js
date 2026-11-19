/**
 * X05 (expansion) — the shared vocabulary of the job board screens: the contract types, the inclusive accommodations and the moderation reasons (closed
 * lists, the same as api/_services/job-board.js and the CHECKs of drizzle/0056), the limits, the states and the refusal codes. No sample listing lives here
 * or anywhere in the code: only real ones, from the API.
 */

export const CONTRACT_TYPES = Object.freeze(['CDI', 'CDD', 'CDDI', 'INTERIM', 'APPRENTISSAGE', 'PROFESSIONNALISATION', 'STAGE']);
export const ACCOMMODATIONS = Object.freeze(['STEP_FREE_ACCESS', 'ADAPTED_WORKSTATION', 'FLEXIBLE_HOURS', 'PART_TIME_POSSIBLE', 'TUTOR_SUPPORT', 'EASY_READ_INSTRUCTIONS',
  'SIGN_LANGUAGE_INTERPRETING', 'NO_DIPLOMA_REQUIRED', 'BEGINNERS_WELCOME', 'PUBLIC_TRANSPORT_ACCESS']);
export const REASONS = Object.freeze(['DISCRIMINATORY_CRITERION', 'MISLEADING_OR_ENTITLEMENT', 'HEALTH_DATA_REQUESTED', 'APPLICATION_CHANNEL', 'NOT_A_JOB_OFFER', 'INCOMPLETE']);
export const TITLE_MAX = 120;
export const DESCRIPTION_MIN = 50;
export const DESCRIPTION_MAX = 3000;
export const EXPIRY_MAX_DAYS = 90;

/** @typedef {(key: string, fallback: string, opts?: Record<string, unknown>) => string} T */

/** @param {string} code @param {T} t */
export function contractLabel(code, t) {
  /** @type {Record<string, string>} */
  const labels = {
    CDI: t('employment:contract.cdi', 'CDI (contrat à durée indéterminée)'),
    CDD: t('employment:contract.cdd', 'CDD (contrat à durée déterminée)'),
    CDDI: t('employment:contract.cddi', 'CDDI (contrat d’insertion)'),
    INTERIM: t('employment:contract.interim', 'Intérim'),
    APPRENTISSAGE: t('employment:contract.apprenticeship', 'Contrat d’apprentissage'),
    PROFESSIONNALISATION: t('employment:contract.professionalisation', 'Contrat de professionnalisation'),
    STAGE: t('employment:contract.internship', 'Stage'),
  };
  return labels[code] || code;
}

/** @param {string} code @param {T} t */
export function accommodationLabel(code, t) {
  /** @type {Record<string, string>} */
  const labels = {
    STEP_FREE_ACCESS: t('employment:accommodation.step_free', 'Locaux accessibles de plain-pied ou par ascenseur'),
    ADAPTED_WORKSTATION: t('employment:accommodation.workstation', 'Poste de travail adaptable'),
    FLEXIBLE_HOURS: t('employment:accommodation.flexible_hours', 'Horaires aménageables'),
    PART_TIME_POSSIBLE: t('employment:accommodation.part_time', 'Temps partiel possible'),
    TUTOR_SUPPORT: t('employment:accommodation.tutor', 'Tuteur ou accompagnement à la prise de poste'),
    EASY_READ_INSTRUCTIONS: t('employment:accommodation.easy_read', 'Consignes en facile à lire et à comprendre'),
    SIGN_LANGUAGE_INTERPRETING: t('employment:accommodation.sign_language', 'Interprète en langue des signes possible'),
    NO_DIPLOMA_REQUIRED: t('employment:accommodation.no_diploma', 'Aucun diplôme demandé'),
    BEGINNERS_WELCOME: t('employment:accommodation.beginners', 'Débutants bienvenus'),
    PUBLIC_TRANSPORT_ACCESS: t('employment:accommodation.transport', 'Accessible en transports en commun'),
  };
  return labels[code] || code;
}

/** @param {string} code @param {T} t */
export function reasonLabel(code, t) {
  /** @type {Record<string, string>} */
  const labels = {
    DISCRIMINATORY_CRITERION: t('employment:reason.discriminatory', 'Critère de sélection interdit (Code du travail, article L1132-1)'),
    MISLEADING_OR_ENTITLEMENT: t('employment:reason.misleading', 'Contenu trompeur ou promesse'),
    HEALTH_DATA_REQUESTED: t('employment:reason.health_data', 'Demande d’informations sur la santé ou un handicap'),
    APPLICATION_CHANNEL: t('employment:reason.channel', 'Moyen de candidature incorrect'),
    NOT_A_JOB_OFFER: t('employment:reason.not_job', 'Ce n’est pas une offre d’emploi'),
    INCOMPLETE: t('employment:reason.incomplete', 'Offre incomplète'),
  };
  return labels[code] || code;
}

/** @param {string} status @param {T} t */
export function statusLabel(status, t) {
  /** @type {Record<string, string>} */
  const labels = {
    draft: t('employment:status.draft', 'Brouillon'),
    pending: t('employment:status.pending', 'En attente de relecture'),
    published: t('employment:status.published', 'Publiée'),
    rejected: t('employment:status.rejected', 'À corriger (refusée par la relecture)'),
    withdrawn: t('employment:status.withdrawn', 'Retirée'),
    taken_down: t('employment:status.taken_down', 'Retirée par la relecture'),
    expired: t('employment:status.expired', 'Terminée (date de fin passée)'),
  };
  return labels[status] || status;
}

/** the message of a refusal code the server sent (the server's own French text otherwise) @param {string} code @param {T} t */
export function problemLabel(code, t) {
  /** @type {Record<string, string>} */
  const labels = {
    FORBIDDEN_CRITERION: t('employment:problem.forbidden', 'Une offre ne peut contenir aucun critère de sélection interdit (Code du travail, article L1132-1).'),
    TITLE_TOO_SHORT: t('employment:problem.title', 'Indiquez l’intitulé du poste (5 caractères au moins).'),
    CONTRACT_TYPE_REQUIRED: t('employment:problem.contract', 'Choisissez le type de contrat.'),
    CITY_REQUIRED: t('employment:problem.city', 'Indiquez la commune du poste.'),
    POSTAL_CODE_INVALID: t('employment:problem.postal', 'Le code postal compte 5 chiffres.'),
    DESCRIPTION_TOO_SHORT: t('employment:problem.description', 'Décrivez le poste (50 caractères au moins).'),
    ACCOMMODATION_REQUIRED: t('employment:problem.accommodation', 'Cochez au moins un aménagement proposé.'),
    APPLY_METHOD_REQUIRED: t('employment:problem.apply_method', 'Choisissez comment postuler.'),
    APPLY_TARGET_INVALID: t('employment:problem.apply_target', 'Adresse de candidature incorrecte : une adresse web commençant par https:// ou une adresse e-mail.'),
    EXPIRY_IN_PAST: t('employment:problem.expiry_past', 'La date de fin doit être après aujourd’hui.'),
    EXPIRY_TOO_FAR: t('employment:problem.expiry_far', 'La date de fin ne peut pas dépasser 90 jours.'),
    EXPIRY_INVALID: t('employment:problem.expiry_invalid', 'Date de fin incorrecte.'),
    IMAGE_OR_MARKUP: t('employment:problem.markup', 'Pas d’image ni de mise en forme : du texte seulement.'),
    CONTACT_IN_TEXT: t('employment:problem.contact', 'Pas de lien, d’adresse e-mail ni de téléphone dans le texte : le moyen de candidature suffit.'),
    ENTITLEMENT_WORDING: t('employment:problem.entitlement', 'Ne promettez pas un droit ou une aide : reformulez.'),
    EMPLOYER_NOT_VERIFIED: t('employment:problem.not_verified', 'Seule une structure active et vérifiée par l’équipe ADA peut publier une offre.'),
  };
  return labels[code] || '';
}
