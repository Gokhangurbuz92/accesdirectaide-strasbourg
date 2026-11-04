// The labels of src/lib/proLabels.js in the interface language (same keys and order; French stays the default text of each key, so the French screens are unchanged).
import { useMemo } from 'react';
import { useT } from '@/i18n';
import { MFA_ERROR, NOTICE_CHANNEL, NOTICE_KIND, NOTICE_RECIPIENT, NOTICE_STATUS, PRO_ROLE } from '@/lib/proLabels';

/** keeps the French map's keys and order; a key without a translation keeps its French label @param {Readonly<Record<string, string>>} base @param {Readonly<Record<string, string>>} labels */
const over = (base, labels) => Object.freeze(Object.fromEntries(Object.keys(base).map((k) => [k, labels[k] || base[k]])));

export function useProLabels() {
  const { t, i18n } = useT('pro');
  const lang = i18n.language;
  return useMemo(() => {
    const noticeKind = over(NOTICE_KIND, {
      BOOKED_BY_STRUCTURE: t('pro:notice_labels.kind.booked_by_structure', 'Rendez-vous pris par la structure'), RESCHEDULED: t('pro:notice_labels.kind.rescheduled', 'Rendez-vous déplacé'),
      CANCELLED_BY_STRUCTURE: t('pro:notice_labels.kind.cancelled_by_structure', 'Annulé par la structure'), CANCELLED_BY_CITIZEN: t('pro:notice_labels.kind.cancelled_by_citizen', 'Annulé par la personne'),
      REMINDER_J1: t('pro:notice_labels.kind.reminder_j1', 'Rappel de la veille'), VISIO_APPROVED: t('pro:notice_labels.kind.visio_approved', 'Visio validée'),
      VISIO_REVOKED: t('pro:notice_labels.kind.visio_revoked', 'Visio retirée'),
      // R43-E: the booking kinds recorded from migration 0045
      BOOKED_BY_CITIZEN: t('pro:notice_labels.kind.booked_by_citizen', 'Rendez-vous pris en ligne par la personne'), REQUEST_RECEIVED: t('pro:notice_labels.kind.request_received', 'Demande de rendez-vous reçue'),
      REQUEST_ACCEPTED: t('pro:notice_labels.kind.request_accepted', 'Demande de rendez-vous acceptée'), REQUEST_REFUSED: t('pro:notice_labels.kind.request_refused', 'Demande de rendez-vous refusée'),
    });
    const noticeRecipient = over(NOTICE_RECIPIENT, {
      citizen: t('pro:notice_labels.recipient.citizen', 'la personne'), structure: t('pro:notice_labels.recipient.structure', 'la structure'),
    });
    const noticeChannel = over(NOTICE_CHANNEL, {
      email: t('pro:notice_labels.channel.email', 'e-mail'), in_app: t('pro:notice_labels.channel.in_app', 'notification'), sms: t('pro:notice_labels.channel.sms', 'SMS'),
    });
    const noticeStatus = over(NOTICE_STATUS, {
      PROVIDER_ACCEPTED: t('pro:notice_labels.status.provider_accepted', 'remis au service d’envoi'), TEST_RECORDED: t('pro:notice_labels.status.test_recorded', 'enregistré (environnement de test)'),
      NO_RECIPIENT: t('pro:notice_labels.status.no_recipient', 'pas d’adresse confirmée'), NO_CONSENT: t('pro:notice_labels.status.no_consent', 'la personne a refusé ces messages'),
      NOT_DELIVERED: t('pro:notice_labels.status.not_delivered', 'non transmis'), FAILED: t('pro:notice_labels.status.failed', 'échec de l’envoi'),
      SENT: t('pro:notice_labels.status.sent', 'envoyé'), DELIVERED: t('pro:notice_labels.status.delivered', 'remise dans l’espace'),
    });
    const proRoleLabels = over(PRO_ROLE, {
      STRUCTURE_ADMIN: t('pro:role_labels.structure_admin', 'Administrateur de la structure'), PRO: t('pro:role_labels.pro', 'Professionnel'),
      SUPERADMIN: t('pro:role_labels.superadmin', 'Super-administrateur'),
    });
    const mfaError = over(MFA_ERROR, {
      MFA_ALREADY_ENABLED: t('pro:mfa_errors.already_enabled', 'La double authentification est déjà activée sur votre compte.'),
      MFA_NOT_ENABLED: t('pro:mfa_errors.not_enabled', 'La double authentification n’est pas activée.'),
      INVALID_CODE: t('pro:mfa_errors.invalid_code', 'Code incorrect ou expiré.'),
      MFA_UNAVAILABLE: t('pro:mfa_errors.unavailable', 'La double authentification est momentanément indisponible.'),
    });
    /** same text as proLabels.noticeLine in French; unknown codes still fall back to the code itself */
    const noticeLine = (/** @type {{ kind: string, recipient: string, channel: string, status: string }} */ n) => t('pro:notice_labels.line', '{{kind}} — {{recipient}}, {{channel}} : {{status}}', {
      kind: noticeKind[n.kind] || n.kind, recipient: noticeRecipient[n.recipient] || n.recipient, channel: noticeChannel[n.channel] || n.channel, status: noticeStatus[n.status] || n.status,
    });
    const proRole = (/** @type {string | null | undefined} */ role) => proRoleLabels[String(role || '').toUpperCase()] || role || '';
    return { noticeKind, noticeRecipient, noticeChannel, noticeStatus, noticeLine, proRoleLabels, proRole, mfaError };
  }, [t, lang]);   // eslint-disable-line react-hooks/exhaustive-deps -- the labels follow the interface language
}
