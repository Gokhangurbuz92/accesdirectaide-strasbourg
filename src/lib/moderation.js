/**
 * G14 — the shared vocabulary of the moderation screens (api/_services/moderation-dsa.js): notice categories and content types (closed lists, the same as the
 * CHECKs of drizzle/0059), decision actions, roles, and the minimum length of the facts of a statement of reasons (DSA art. 17(3)(b)).
 */
export const NOTICE_CATEGORIES = Object.freeze(['ILLEGAL_CONTENT', 'TERMS_VIOLATION', 'SAFETY_THREAT', 'CHILD_SAFETY']);
export const NOTICE_CONTENT_TYPES = Object.freeze(['testimonial', 'story', 'job_listing', 'entraide', 'other']);
export const ROLES = Object.freeze(['MODERATOR', 'ENTRAIDE_SAFETY_OFFICER']);
export const FACTS_MIN = 10;
export const FACTS_MAX = 2000;
export const SUSPENSION_MAX_DAYS = 180;

/** @typedef {(key: string, fallback: string, opts?: Record<string, unknown>) => string} T */

/** @param {string} code @param {T} t */
export function categoryLabel(code, t) {
  /** @type {Record<string, string>} */
  const labels = {
    ILLEGAL_CONTENT: t('moderation:category.illegal', 'Contenu illicite (contraire à la loi)'),
    TERMS_VIOLATION: t('moderation:category.terms', 'Contenu contraire aux règles du site (charte de modération)'),
    SAFETY_THREAT: t('moderation:category.safety', 'Menace pour la sécurité ou la vie d’une personne'),
    CHILD_SAFETY: t('moderation:category.child', 'Contenu mettant en danger un enfant'),
  };
  return labels[code] || code;
}

/** @param {string} code @param {T} t */
export function contentTypeLabel(code, t) {
  /** @type {Record<string, string>} */
  const labels = {
    testimonial: t('moderation:type.testimonial', 'Témoignage'), story: t('moderation:type.story', 'Histoire de la communauté'),
    job_listing: t('moderation:type.job_listing', 'Offre d’emploi'), entraide: t('moderation:type.entraide', 'Entraide (offre ou comportement d’un membre)'),
    entraide_member: t('moderation:type.entraide_member', 'Participation à l’entraide'), entraide_offer: t('moderation:type.entraide_offer', 'Offre d’entraide'),
    notice: t('moderation:type.notice', 'Contenu signalé'), other: t('moderation:type.other', 'Autre contenu publié par un utilisateur'),
  };
  return labels[code] || code;
}

/** @param {string} code @param {T} t */
export function actionLabel(code, t) {
  /** @type {Record<string, string>} */
  const labels = {
    rejected: t('moderation:action.rejected', 'Non publié'), taken_down: t('moderation:action.taken_down', 'Retiré'), offer_closed: t('moderation:action.offer_closed', 'Offre fermée'),
    member_suspended: t('moderation:action.member_suspended', 'Participation suspendue'), member_reinstated: t('moderation:action.member_reinstated', 'Participation rétablie'),
    reports_dismissed: t('moderation:action.reports_dismissed', 'Maintenu (signalements non fondés)'), notice_no_action: t('moderation:action.notice_no_action', 'Aucune mesure'),
  };
  return labels[code] || code;
}

/** @param {string} code @param {T} t */
export function roleLabel(code, t) {
  return code === 'ENTRAIDE_SAFETY_OFFICER' ? t('moderation:role.safety', 'Référent protection (entraide)') : t('moderation:role.moderator', 'Modérateur');
}

/** @param {string} code @param {T} t */
export function staffingReason(code, t) {
  /** @type {Record<string, string>} */
  const labels = {
    NO_NAMED_MODERATOR: t('moderation:staffing.no_moderator', 'Aucun modérateur nommé'),
    NO_NAMED_SAFETY_OFFICER: t('moderation:staffing.no_safety', 'Aucun référent protection nommé'),
    FEWER_THAN_TWO_NAMED_MODERATORS: t('moderation:staffing.two_moderators', 'Deux modérateurs nommés sont nécessaires'),
    MODERATION_NOT_AVAILABLE: t('moderation:staffing.not_available', 'Migration 0059 absente de cette base'),
  };
  return labels[code] || code;
}

export const EMPTY_STATEMENT = Object.freeze({ facts: '', legalGround: '', manifestlyIllegal: false, noticeId: '' });
/** the statement is complete enough for the server @param {{ facts: string, legalGround: string, manifestlyIllegal: boolean }} v */
export const statementReady = (v) => v.facts.trim().length >= FACTS_MIN && (!v.manifestlyIllegal || v.legalGround.trim().length >= 3);
/** the body fields sent with the action @param {{ facts: string, legalGround: string, manifestlyIllegal: boolean, noticeId: string }} v */
export const statementBody = (v) => ({ facts: v.facts.trim(), manifestlyIllegal: v.manifestlyIllegal, ...(v.manifestlyIllegal ? { legalGround: v.legalGround.trim() } : {}),
  ...(v.noticeId ? { noticeId: v.noticeId } : {}) });
