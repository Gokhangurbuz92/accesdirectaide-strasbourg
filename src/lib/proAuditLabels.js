/**
 * UI modernisation (24/11/2026) — readable names for the action codes of the ADA Pro audit log (codes written by logProAudit, api/_utils/auth.js).
 * Display only: the stored codes, the filter values and the CSV export are unchanged. A code without a name shows « Autre action » and the code.
 * @param {(key: string, fallback: string) => string} t
 * @returns {Record<string, string>}
 */
export const proAuditActionNames = (t) => ({
    ATTESTATION_VIEWED: t('pro:audit_log.action.attestation_viewed', 'Attestation consultée'),
    CONSENT_SIGNED: t('pro:audit_log.action.consent_signed', 'Consentement signé'),
    DOSSIER_ACCESS_GRANTED: t('pro:audit_log.action.dossier_access_granted', 'Accès au dossier accordé'),
    DOSSIER_ACCESS_REVOKED_BY_OWNER: t('pro:audit_log.action.dossier_access_revoked_by_owner', 'Accès au dossier retiré par la personne'),
    DOSSIER_EXPORTED: t('pro:audit_log.action.dossier_exported', 'Dossier exporté'),
    DOSSIER_INVITE_CREATED: t('pro:audit_log.action.dossier_invite_created', 'Invitation de partage d’un dossier créée'),
    DOSSIER_INVITE_REVOKED_BY_OWNER: t('pro:audit_log.action.dossier_invite_revoked_by_owner', 'Invitation de partage annulée par la personne'),
    DOSSIER_PURPOSES_CHANGED_BY_OWNER: t('pro:audit_log.action.dossier_purposes_changed_by_owner', 'Finalités du partage modifiées par la personne'),
    DOSSIER_REVOKED_BY_USER: t('pro:audit_log.action.dossier_revoked_by_user', 'Partage retiré par la personne'),
    DOSSIER_SHARING_STOPPED_BY_OWNER: t('pro:audit_log.action.dossier_sharing_stopped_by_owner', 'Partage arrêté par la personne'),
    EXTERNAL_BOOKING_REMOVED: t('pro:audit_log.action.external_booking_removed', 'Lien de rendez-vous externe retiré'),
    EXTERNAL_BOOKING_SUBMITTED: t('pro:audit_log.action.external_booking_submitted', 'Lien de rendez-vous externe ajouté'),
    FILE_UPLOADED: t('pro:audit_log.action.file_uploaded', 'Document déposé'),
    INVITATION_CANCELLED: t('pro:audit_log.action.invitation_cancelled', 'Invitation annulée'),
    INVITATION_REFUSED_SENDER_REVOKED: t('pro:audit_log.action.invitation_refused_sender_revoked', 'Invitation refusée (expéditeur retiré)'),
    INVITATION_RESENT: t('pro:audit_log.action.invitation_resent', 'Invitation renvoyée'),
    LOGIN_FAILED: t('pro:audit_log.action.login_failed', 'Échec de connexion'),
    MFA_CHALLENGE: t('pro:audit_log.action.mfa_challenge', 'Code de double authentification demandé'),
    MFA_DISABLED: t('pro:audit_log.action.mfa_disabled', 'Double authentification désactivée'),
    MFA_ENABLED: t('pro:audit_log.action.mfa_enabled', 'Double authentification activée'),
    MFA_ENROL_FAILED: t('pro:audit_log.action.mfa_enrol_failed', 'Échec de l’activation de la double authentification'),
    MFA_ENROL_REFUSED: t('pro:audit_log.action.mfa_enrol_refused', 'Activation de la double authentification refusée'),
    MFA_FACTOR_RESET: t('pro:audit_log.action.mfa_factor_reset', 'Double authentification réinitialisée'),
    MFA_INVITATION_REDEEMED: t('pro:audit_log.action.mfa_invitation_redeemed', 'Invitation à la double authentification utilisée'),
    MFA_INVITATION_REFUSED: t('pro:audit_log.action.mfa_invitation_refused', 'Invitation à la double authentification refusée'),
    MFA_INVITATION_REFUSED_UNVERIFIED: t('pro:audit_log.action.mfa_invitation_refused_unverified', 'Invitation à la double authentification refusée (adresse non vérifiée)'),
    MFA_LOCKED: t('pro:audit_log.action.mfa_locked', 'Double authentification bloquée après plusieurs essais'),
    MFA_VERIFY_FAILED: t('pro:audit_log.action.mfa_verify_failed', 'Code de double authentification incorrect'),
    ORGANIZATION_EXPORTED: t('pro:audit_log.action.organization_exported', 'Données de la structure exportées'),
    PROCONNECT_FAILED: t('pro:audit_log.action.proconnect_failed', 'Échec de connexion ProConnect'),
    PROCONNECT_IDENTIFIED: t('pro:audit_log.action.proconnect_identified', 'Connexion ProConnect'),
    PROCONNECT_MFA_ENROLMENT_REQUIRED: t('pro:audit_log.action.proconnect_mfa_enrolment_required', 'ProConnect : double authentification à activer'),
    PROCONNECT_NO_ACCOUNT: t('pro:audit_log.action.proconnect_no_account', 'ProConnect : aucun compte correspondant'),
    PRO_LOGOUT: t('pro:audit_log.action.pro_logout', 'Déconnexion'),
    PRO_PROFILE_UPDATED: t('pro:audit_log.action.pro_profile_updated', 'Fiche publique de la structure mise à jour'),
    PRO_SELF_REGISTRATION_ACTIVATED: t('pro:audit_log.action.pro_self_registration_activated', 'Inscription de la structure validée'),
    PRO_SELF_REGISTRATION_REFUSED: t('pro:audit_log.action.pro_self_registration_refused', 'Inscription de la structure refusée'),
    RDV_AVAILABILITY_UPDATED: t('pro:audit_log.action.rdv_availability_updated', 'Disponibilités modifiées'),
    RDV_BOOKING_CONFIG_UPDATED: t('pro:audit_log.action.rdv_booking_config_updated', 'Réglages de prise de rendez-vous modifiés'),
    RDV_MEMBER_HOURS_CLEARED: t('pro:audit_log.action.rdv_member_hours_cleared', 'Horaires d’un membre effacés'),
    RDV_MEMBER_HOURS_UPDATED: t('pro:audit_log.action.rdv_member_hours_updated', 'Horaires d’un membre modifiés'),
    RDV_PRO_CANCELLED: t('pro:audit_log.action.rdv_pro_cancelled', 'Rendez-vous annulé par la structure'),
    RDV_REQUEST_EXPIRED: t('pro:audit_log.action.rdv_request_expired', 'Demande de rendez-vous expirée'),
    RDV_TIMEOFF_CREATED: t('pro:audit_log.action.rdv_timeoff_created', 'Absence ajoutée'),
    RDV_TIMEOFF_DELETED: t('pro:audit_log.action.rdv_timeoff_deleted', 'Absence supprimée'),
    RDV_TIMEOFF_UPDATED: t('pro:audit_log.action.rdv_timeoff_updated', 'Absence modifiée'),
    REGISTER_REQUESTED: t('pro:audit_log.action.register_requested', 'Demande d’inscription envoyée'),
    RESET_REQUESTED: t('pro:audit_log.action.reset_requested', 'Réinitialisation du mot de passe demandée'),
    RESET_SUCCESS: t('pro:audit_log.action.reset_success', 'Mot de passe réinitialisé'),
    SMS_REMINDER_SUBSCRIBED: t('pro:audit_log.action.sms_reminder_subscribed', 'Rappel par SMS activé'),
    TOKEN_REFRESH: t('pro:audit_log.action.token_refresh', 'Session prolongée'),
    USER_REACTIVATED: t('pro:audit_log.action.user_reactivated', 'Membre réactivé'),
    USER_ROLE_CHANGED: t('pro:audit_log.action.user_role_changed', 'Rôle d’un membre modifié'),
    VISIO_APPROVED: t('pro:audit_log.action.visio_approved', 'Visioconférence autorisée'),
    VISIO_JOIN_ISSUED: t('pro:audit_log.action.visio_join_issued', 'Lien de visioconférence délivré'),
    VISIO_REVOKED: t('pro:audit_log.action.visio_revoked', 'Visioconférence retirée'),
});

/** the name of one code, or « Autre action » @param {(key: string, fallback: string) => string} t @param {string} code */
export function proAuditActionName(t, code) {
    const names = proAuditActionNames(t);
    return Object.prototype.hasOwnProperty.call(names, code) ? names[code] : null;
}

/** @param {(key: string, fallback: string) => string} t */
export const proAuditOtherAction = (t) => t('pro:audit_log.action.other', 'Autre action');
