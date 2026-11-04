// R42 — what happened to the e-mail of a booking action, as the server reports it (`notification.email`): never « an e-mail was sent » by assumption.
import { useT } from '@/i18n';

/** @param {{ outcome?: string | null }} props */
export default function MailOutcomeNote({ outcome }) {
  const { t } = useT('booking');
  const text = outcome === 'ACCEPTED_BY_PROVIDER'
    ? t('booking:mail.accepted', 'Un e-mail récapitulatif a été remis au service d’envoi (sa réception n’est pas garantie). Votre espace « Mes rendez-vous » fait foi.')
    : outcome === 'TEST_RECORDED'
      ? t('booking:mail.test', 'Environnement de test : l’e-mail a seulement été enregistré, il n’a pas été envoyé.')
      : outcome === 'NO_PROVIDER'
        ? t('booking:mail.no_provider', 'Aucun e-mail n’a été envoyé : l’envoi d’e-mails n’est pas activé sur ce service. Retrouvez le détail dans « Mes rendez-vous ».')
        : outcome === 'NOT_SENT'
          ? t('booking:mail.not_sent', 'L’e-mail n’a pas pu être envoyé. Retrouvez le détail dans « Mes rendez-vous ».')
          : t('booking:mail.unknown', 'Retrouvez le détail de votre rendez-vous dans « Mes rendez-vous ».');
  return <p className="text-sm text-slate-700" data-testid="rdv-mail-outcome" data-outcome={outcome || 'UNKNOWN'}>{text}</p>;
}
