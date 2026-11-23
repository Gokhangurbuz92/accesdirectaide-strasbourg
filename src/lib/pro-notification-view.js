// @ts-check
/**
 * A11 — how a professional notice is shown: where it leads (from the identifiers stored with it) and its text in the interface language.
 * The server stores a French title and message (api/_services/pro-notifications.js); French readers keep them (they can carry a time or who acted), the
 * five other languages get the event's title from its type, and the message when the event has a fixed one. A message with no translation stays the stored
 * French text, marked as French for assistive technology.
 */

const ID = /^[A-Za-z0-9_-]{1,120}$/;
/** @param {unknown} v */
const id = (v) => (typeof v === 'string' && ID.test(v) ? encodeURIComponent(v) : null);

/**
 * The page a notice opens — the same map as notificationPath() on the server (the e-mail link). Never an address taken from the notice itself.
 * @param {{ type?: unknown, metadata?: any }} notif @returns {string}
 */
export function notificationPath(notif) {
  const m = notif?.metadata && typeof notif.metadata === 'object' ? notif.metadata : {};
  const type = String(notif?.type || '');
  if (id(m.referralId)) return `/pro/orientations/${id(m.referralId)}`;
  if (id(m.caseId)) return `/pro/dossiers/${id(m.caseId)}`;
  if (id(m.conversationId)) return `/pro/messages/${id(m.conversationId)}`;
  if (id(m.appointmentId)) return `/pro/appointments/${id(m.appointmentId)}`;
  if (id(m.proposalId) || type === 'structure_proposal_decided') return '/pro/structure';
  if (type === 'team_role_change') return '/pro/team';
  if (type === 'social_referral_update') return '/pro/orientations-sociales';   // G14-PS
  if (type === 'case_handover') return '/pro/dossiers';
  return '/pro/dashboard';
}

/** @param {import('i18next').TFunction} t @returns {Record<string, string>} the title of every catalogue event */
export function notificationTitles(t) {
  return {
    case_assigned: t('pro:notifications.types.case_assigned', 'Un dossier vous est attribué'),
    case_handover: t('pro:notifications.types.case_handover', 'Des dossiers vous sont transmis'),
    case_mention: t('pro:notifications.types.case_mention', 'Vous êtes mentionné·e sur un dossier'),
    dossier_restricted: t('pro:notifications.types.dossier_restricted', 'Accès à un dossier suspendu (limitation demandée par la personne)'),
    dossier_restriction_lifted: t('pro:notifications.types.dossier_restriction_lifted', 'Accès à un dossier rétabli'),
    referral_received: t('pro:notifications.types.referral_received', 'Nouvelle orientation reçue'),
    referral_refused: t('pro:notifications.types.referral_refused', 'Orientation refusée par la personne'),
    referral_accepted: t('pro:notifications.types.referral_accepted', 'Orientation acceptée'),
    referral_declined: t('pro:notifications.types.referral_declined', 'Orientation déclinée'),
    referral_needs_info: t('pro:notifications.types.referral_needs_info', 'Précisions demandées'),
    referral_reply: t('pro:notifications.types.referral_reply', 'Précisions reçues'),
    referral_completed: t('pro:notifications.types.referral_completed', 'Orientation terminée'),
    referral_cancelled: t('pro:notifications.types.referral_cancelled', 'Orientation annulée'),
    referral_overdue: t('pro:notifications.types.referral_overdue', 'Orientation sans réponse'),
    referral_expired: t('pro:notifications.types.referral_expired', 'Orientation expirée'),
    rdv_new: t('pro:notifications.types.rdv_new', 'Rendez-vous demain'),
    rdv_booked_by_structure: t('pro:notifications.types.rdv_booked_by_structure', 'Rendez-vous créé'),
    rdv_booked_by_citizen: t('pro:notifications.types.rdv_booked_by_citizen', 'Rendez-vous pris en ligne (compte)'),
    rdv_request_received: t('pro:notifications.types.rdv_request_received', 'Demande de rendez-vous à valider'),
    rdv_cancelled_by_citizen: t('pro:notifications.types.rdv_cancelled_by_citizen', 'Rendez-vous annulé par la personne'),
    rdv_cancelled_by_structure: t('pro:notifications.types.rdv_cancelled_by_structure', 'Rendez-vous annulé par la structure'),
    rdv_rescheduled: t('pro:notifications.types.rdv_rescheduled', 'Rendez-vous déplacé'),
    message_received: t('pro:notifications.types.message_received', 'Nouveau message d’une personne'),
    rdv_message_withdrawn: t('pro:notifications.types.rdv_message_withdrawn', 'Message retiré par la personne'),
    team_role_change: t('pro:notifications.types.team_role_change', 'Votre rôle a changé'),
    structure_proposal_decided: t('pro:notifications.types.structure_proposal_decided', 'Proposition de modification traitée'),
    NEW_AIDE: t('pro:notifications.types.NEW_AIDE', 'Nouvelle aide dans la veille'),
  };
}

/** @param {import('i18next').TFunction} t @returns {Record<string, string>} the events whose message is a fixed sentence (key: type, or type:kind) */
export function notificationBodies(t) {
  return {
    case_assigned: t('pro:notifications.bodies.case_assigned', 'Un dossier vous a été attribué dans votre file.'),
    case_mention: t('pro:notifications.bodies.case_mention', 'Un membre de votre équipe vous a mentionné·e dans une note.'),
    message_received: t('pro:notifications.bodies.message_received', 'Une personne vous a écrit au sujet d’un rendez-vous.'),
    'structure_proposal_decided:ACCEPTED': t('pro:notifications.bodies.proposal_accepted', 'Votre proposition de modification a été acceptée.'),
    'structure_proposal_decided:REJECTED': t('pro:notifications.bodies.proposal_rejected', 'Votre proposition de modification a été refusée. Le motif est indiqué dans « Ma structure ».'),
  };
}

/**
 * @param {import('i18next').TFunction} t @param {string} language the interface language
 * @param {{ type?: unknown, title?: unknown, message?: unknown, metadata?: any }} notif
 * @returns {{ title: string, titleLang?: 'fr', message: string, messageLang?: 'fr', path: string }} *Lang = the text is the stored French one, shown in another language's interface
 */
export function notificationView(t, language, notif) {
  const type = String(notif?.type || '');
  const french = String(language || 'fr').toLowerCase().startsWith('fr');
  const storedTitle = String(notif?.title || '');
  const storedMessage = String(notif?.message || '');
  const kind = notif?.metadata && typeof notif.metadata === 'object' ? String(notif.metadata.kind || '') : '';
  const titleByType = notificationTitles(t)[type];
  const bodies = notificationBodies(t);
  const bodyByType = bodies[`${type}:${kind}`] || bodies[type];
  const title = french ? (storedTitle || titleByType || '') : (titleByType || storedTitle);
  const message = french ? (storedMessage || bodyByType || '') : (bodyByType || storedMessage);
  return {
    title, ...(!french && !titleByType && storedTitle ? { titleLang: /** @type {const} */ ('fr') } : {}),
    message, ...(!french && !bodyByType && storedMessage ? { messageLang: /** @type {const} */ ('fr') } : {}),
    path: notificationPath(notif),
  };
}
