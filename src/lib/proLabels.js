// @ts-nocheck
/**
 * Owner usefulness pass (2026-10-25) — French labels for codes the professional space used to print as-is (appointment notices, roles, MFA answers).
 * Unknown codes fall back to the code itself, so a new server value is still visible.
 */
export const NOTICE_KIND = {
  BOOKED_BY_STRUCTURE: 'Rendez-vous pris par la structure', RESCHEDULED: 'Rendez-vous déplacé', CANCELLED_BY_STRUCTURE: 'Annulé par la structure',
  CANCELLED_BY_CITIZEN: 'Annulé par la personne', REMINDER_J1: 'Rappel de la veille', VISIO_APPROVED: 'Visio validée', VISIO_REVOKED: 'Visio retirée',
};
export const NOTICE_RECIPIENT = { citizen: 'la personne', structure: 'la structure' };
export const NOTICE_CHANNEL = { email: 'e-mail', in_app: 'notification', sms: 'SMS' };
export const NOTICE_STATUS = {
  PROVIDER_ACCEPTED: 'remis au service d’envoi', TEST_RECORDED: 'enregistré (environnement de test)', NO_RECIPIENT: 'pas d’adresse confirmée',
  NO_CONSENT: 'la personne a refusé ces messages', NOT_DELIVERED: 'non transmis', FAILED: 'échec de l’envoi', SENT: 'envoyé', DELIVERED: 'remise dans l’espace',
};
export const noticeLine = (n) => `${NOTICE_KIND[n.kind] || n.kind} — ${NOTICE_RECIPIENT[n.recipient] || n.recipient}, ${NOTICE_CHANNEL[n.channel] || n.channel} : ${NOTICE_STATUS[n.status] || n.status}`;
export const PRO_ROLE = { STRUCTURE_ADMIN: 'Administrateur de la structure', PRO: 'Professionnel', SUPERADMIN: 'Super-administrateur' };
export const proRole = (role) => PRO_ROLE[String(role || '').toUpperCase()] || role || '';
export const MFA_ERROR = {
  MFA_ALREADY_ENABLED: 'La double authentification est déjà activée sur votre compte.', MFA_NOT_ENABLED: 'La double authentification n’est pas activée.',
  INVALID_CODE: 'Code incorrect ou expiré.', MFA_UNAVAILABLE: 'La double authentification est momentanément indisponible.',
};
