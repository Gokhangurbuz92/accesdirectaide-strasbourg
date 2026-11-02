// The labels of src/lib/caseLabels.js in the interface language (same keys and order; French stays the default text of each key, so the French screens are unchanged).
import { useMemo } from 'react';
import { useT } from '@/i18n';
import { CASE_EVENT_LABELS, CASE_STATUS_LABELS, OUTCOME_LABELS, REASON_LABELS, REFERRAL_STATUS_LABELS, RESPONSE_LABELS } from '@/lib/caseLabels';

/** keeps the French map's keys and order; a key without a translation keeps its French label */
const over = (base, labels) => Object.freeze(Object.fromEntries(Object.keys(base).map((k) => [k, labels[k] || base[k]])));

export function useCaseLabels() {
  const { t, i18n } = useT('pro');
  const lang = i18n.language;
  return useMemo(() => ({
    caseStatus: over(CASE_STATUS_LABELS, {
      NEW: t('pro:case_labels.status.new', 'Nouveau'), IN_PROGRESS: t('pro:case_labels.status.in_progress', 'En cours'),
      WAITING_CITIZEN: t('pro:case_labels.status.waiting_citizen', 'En attente de la personne'), WAITING_PARTNER: t('pro:case_labels.status.waiting_partner', 'En attente d’un partenaire'),
      REFERRED: t('pro:case_labels.status.referred', 'Orienté'), CLOSED: t('pro:case_labels.status.closed', 'Clôturé'),
    }),
    outcome: over(OUTCOME_LABELS, {
      SUPPORT_COMPLETED: t('pro:case_labels.outcome.support_completed', 'Accompagnement réalisé'), APPLICATION_FILED: t('pro:case_labels.outcome.application_filed', 'Demande déposée'),
      INFORMATION_PROVIDED: t('pro:case_labels.outcome.information_provided', 'Information donnée'), REFERRED_ELSEWHERE: t('pro:case_labels.outcome.referred_elsewhere', 'Orienté vers une autre structure'),
      CITIZEN_WITHDREW: t('pro:case_labels.outcome.citizen_withdrew', 'La personne n’a pas poursuivi'), NO_RESPONSE: t('pro:case_labels.outcome.no_response', 'Sans réponse de la personne'),
      OTHER: t('pro:case_labels.outcome.other', 'Autre'),
    }),
    reason: over(REASON_LABELS, {
      SPECIALISED_SUPPORT: t('pro:case_labels.reason.specialised_support', 'Accompagnement spécialisé'), ACCESS_TO_RIGHTS: t('pro:case_labels.reason.access_to_rights', 'Accès aux droits'),
      HOUSING: t('pro:case_labels.reason.housing', 'Logement'), EMPLOYMENT: t('pro:case_labels.reason.employment', 'Emploi'), HEALTH: t('pro:case_labels.reason.health', 'Santé'),
      FOOD_AID: t('pro:case_labels.reason.food_aid', 'Aide alimentaire'), DIGITAL_SUPPORT: t('pro:case_labels.reason.digital_support', 'Aide numérique'),
      LEGAL: t('pro:case_labels.reason.legal', 'Juridique'), OTHER: t('pro:case_labels.reason.other', 'Autre'),
    }),
    response: over(RESPONSE_LABELS, {
      OUT_OF_SCOPE: t('pro:case_labels.response.out_of_scope', 'Hors de notre champ'), NO_CAPACITY: t('pro:case_labels.response.no_capacity', 'Pas de capacité actuellement'),
      ALREADY_SUPPORTED: t('pro:case_labels.response.already_supported', 'Déjà accompagné·e'), NEEDS_MORE_INFORMATION: t('pro:case_labels.response.needs_more_information', 'Informations nécessaires'),
      OTHER: t('pro:case_labels.response.other', 'Autre'),
    }),
    referralStatus: over(REFERRAL_STATUS_LABELS, {
      DRAFT: t('pro:case_labels.referral.draft', 'Brouillon'), PENDING_CITIZEN: t('pro:case_labels.referral.pending_citizen', 'En attente de l’accord de la personne'),
      SENT: t('pro:case_labels.referral.sent', 'Envoyée'), ACKNOWLEDGED: t('pro:case_labels.referral.acknowledged', 'Reçue'), NEEDS_INFO: t('pro:case_labels.referral.needs_info', 'Précisions demandées'),
      ACCEPTED: t('pro:case_labels.referral.accepted', 'Acceptée'), DECLINED: t('pro:case_labels.referral.declined', 'Déclinée'), IN_PROGRESS: t('pro:case_labels.referral.in_progress', 'En cours'),
      COMPLETED: t('pro:case_labels.referral.completed', 'Terminée'), CANCELLED: t('pro:case_labels.referral.cancelled', 'Annulée'),
      EXPIRED: t('pro:case_labels.referral.expired', 'Expirée (sans réponse)'), CLOSED: t('pro:case_labels.referral.closed', 'Clôturée'),
    }),
    caseEvent: over(CASE_EVENT_LABELS, {
      OPENED: t('pro:case_labels.event.opened', 'Dossier ouvert'), STATUS: t('pro:case_labels.event.status', 'Statut modifié'), ASSIGNED: t('pro:case_labels.event.assigned', 'Dossier attribué'),
      UNASSIGNED: t('pro:case_labels.event.unassigned', 'Remis dans la file'), HANDOVER: t('pro:case_labels.event.handover', 'Transmis à un·e collègue'),
      NOTE_INTERNAL: t('pro:case_labels.event.note_internal', 'Note interne'), NOTE_CITIZEN: t('pro:case_labels.event.note_citizen', 'Note pour la personne'),
      OUTCOME: t('pro:case_labels.event.outcome', 'Résultat enregistré'), CLOSED: t('pro:case_labels.event.closed', 'Dossier clôturé'),
      REOPENED: t('pro:case_labels.event.reopened', 'Dossier rouvert'), REFERRAL: t('pro:case_labels.event.referral', 'Orientation'),
    }),
  }), [t, lang]);   // eslint-disable-line react-hooks/exhaustive-deps -- the labels follow the interface language
}
