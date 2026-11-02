// R38 — the visitor-facing text of each account-free booking refusal code (api/_services/rdv-guest.js)
import { useT } from '@/i18n';

export function useGuestMessages() {
  const { t } = useT('booking');
  return (code) => ({
    GUEST_BOOKING_DISABLED: t('booking:error.disabled', 'La prise de rendez-vous sans compte n’est pas ouverte pour le moment.'),
    GUEST_BOOKING_MAIL_UNAVAILABLE: t('booking:error.mailUnavailable', 'Nous ne pouvons pas envoyer d’e-mail pour le moment : aucun créneau n’a été réservé. Réessayez plus tard.'),
    GUEST_BOOKING_UNAVAILABLE: t('booking:error.unavailable', 'Cette structure ne propose pas de rendez-vous sans compte.'),
    SERVICE_NOT_FOUND: t('booking:error.service', 'Ce motif n’est plus proposé sans compte.'),
    SLOT_TAKEN: t('booking:error.slotTaken', 'Ce créneau n’est plus libre. Choisissez-en un autre.'),
    INVALID_NAME: t('booking:error.name', 'Indiquez un nom ou des initiales (sans chiffres).'),
    INVALID_EMAIL: t('booking:error.email', 'Indiquez une adresse e-mail valide.'),
    INVALID_PHONE: t('booking:error.phone', 'Le numéro de téléphone n’est pas valide.'),
    CONSENT_REQUIRED: t('booking:error.consent', 'Cochez la case pour recevoir les e-mails de ce rendez-vous.'),
    NOTE_TOO_LONG: t('booking:error.note', 'Le message est trop long.'),
    CODE_INVALID: t('booking:error.code', 'Ce code ne correspond pas.'),
    HOLD_EXPIRED: t('booking:error.holdExpired', 'Le délai de 20 minutes est dépassé : le créneau a été libéré. Recommencez.'),
    HOLD_LOCKED: t('booking:error.holdLocked', 'Trop d’essais : la demande est annulée et le créneau libéré. Recommencez.'),
    HOLD_NOT_ACTIVE: t('booking:error.holdNotActive', 'Cette demande n’est plus active. Recommencez.'),
    HOLD_ALREADY_CONFIRMED: t('booking:error.alreadyConfirmed', 'Ce rendez-vous est déjà confirmé : utilisez le lien reçu par e-mail.'),
    APPOINTMENT_NOT_FOUND: t('booking:error.manageNotFound', 'Ce lien n’est pas (ou plus) valable.'),
    RESCHEDULE_TOO_LATE: t('booking:error.tooLate', 'Il est trop tard pour déplacer ce rendez-vous en ligne : contactez la structure.'),
    RESCHEDULE_LIMIT: t('booking:error.limit', 'Ce rendez-vous a déjà été déplacé deux fois : contactez la structure.'),
    APPOINTMENT_NOT_CANCELLABLE: t('booking:error.notCancellable', 'Ce rendez-vous est passé : il ne peut plus être annulé.'),
  }[code] || t('booking:error.generic', 'Une erreur est survenue. Réessayez dans un instant.'));
}
