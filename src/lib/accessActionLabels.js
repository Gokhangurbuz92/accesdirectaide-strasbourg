/**
 * A-13 — the labels of the actions listed in the two access journals of Mon Espace, in the interface language. The API returns each event's stable `action`
 * code and a French `label`; the screens used to print the French label as is. The French label remains the fallback for a code this file does not know yet
 * (shown marked lang="fr" by the caller).
 */
import { useT } from '@/i18n';

/** @returns {{ dossier: Record<string, string>, delegation: Record<string, string> }} */
export function useAccessActionLabels() {
  const { t } = useT('compte');
  return {
    // « who did what with my dossier » (api/_services/mon-espace.js ACCESS_LABELS): the sentence follows the organisation's name
    dossier: {
      DOSSIER_ACCESS_GRANTED: t('compte:access_action.access_granted', 'a ouvert l’accès au dossier'),
      DOSSIER_VIEWED: t('compte:access_action.viewed', 'a consulté le dossier'),
      DOSSIER_EXPORTED: t('compte:access_action.exported', 'a exporté le dossier'),
      SIAO_HANDOVER_PREPARED: t('messaging:transparency.action_siao_prepared', 'a préparé une fiche de transmission au SIAO (rien n’est envoyé par AccèsDirectAide)'),
      DOSSIER_STATUS_UPDATED: t('compte:access_action.status_updated', 'a mis à jour le suivi'),
      ATTESTATION_VIEWED: t('compte:access_action.attestation_viewed', 'a consulté l’attestation'),
      FILE_UPLOADED: t('compte:access_action.file_uploaded', 'a ajouté un document'),
      DOSSIER_FILE_DOWNLOADED: t('compte:access_action.file_downloaded', 'a téléchargé un document'),
      DOSSIER_SYNTHESIS_DRAFTED: t('compte:access_action.synthesis_drafted', 'a fait rédiger une synthèse automatique'),
      DOSSIER_SYNTHESIS_APPROVED: t('compte:access_action.synthesis_approved', 'a validé une synthèse automatique'),
    },
    // what a trusted person viewed (api/_services/delegation.js ACTION_LABELS)
    delegation: {
      PARCOURS_VIEWED: t('compte:access_action.parcours_viewed', 'a consulté Mon Parcours'),
      COFFRE_LISTED: t('compte:access_action.coffre_listed', 'a consulté la liste de Mon Coffre'),
      RDV_VIEWED: t('compte:access_action.rdv_viewed', 'a consulté les rendez-vous'),
    },
  };
}
