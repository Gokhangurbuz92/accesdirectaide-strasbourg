// The labels of src/lib/monEspace.js in the interface language (same keys; French stays the default text of each key, so the French screens are unchanged).
import { useMemo } from 'react';
import { formatNumber, useT } from '@/i18n';
import {
  COFFRE_CATEGORY_LABELS, DELEGATION_ROLE_LABELS, DELEGATION_SCOPE_LABELS, DELEGATION_STATUS_LABELS, HISTORY_KIND_LABELS, PARCOURS_STATUS_LABELS,
} from '@/lib/monEspace';

/** keeps the French map's keys and order; a key without a translation keeps its French label */
const over = (base, labels) => Object.freeze(Object.fromEntries(Object.keys(base).map((k) => [k, labels[k] || base[k]])));

export function useMonEspaceLabels() {
  const { t, i18n } = useT('compte');
  const lang = i18n.language;
  return useMemo(() => ({
    parcoursStatus: over(PARCOURS_STATUS_LABELS, {
      NOT_STARTED: t('compte:labels.parcours.not_started', 'À commencer'),
      IN_PROGRESS: t('compte:labels.parcours.in_progress', 'En cours'),
      DOCUMENTS_REQUIRED: t('compte:labels.parcours.documents_required', 'Papiers à rassembler'),
      READY: t('compte:labels.parcours.ready', 'Prêt à envoyer'),
      SUBMITTED: t('compte:labels.parcours.submitted', 'Demande envoyée'),
      WAITING_ORGANIZATION: t('compte:labels.parcours.waiting_organization', 'En attente de l’organisme'),
      ADDITIONAL_INFORMATION: t('compte:labels.parcours.additional_information', 'L’organisme demande des informations'),
      DECISION_POSITIVE: t('compte:labels.parcours.decision_positive', 'Réponse favorable (indiquée par vous)'),
      DECISION_NEGATIVE: t('compte:labels.parcours.decision_negative', 'Réponse défavorable (indiquée par vous)'),
      CLOSED: t('compte:labels.parcours.closed', 'Terminé'),
    }),
    coffreCategory: over(COFFRE_CATEGORY_LABELS, {
      identite: t('compte:labels.coffre.identite', 'Identité'), revenus: t('compte:labels.coffre.revenus', 'Revenus'), logement: t('compte:labels.coffre.logement', 'Logement'),
      famille: t('compte:labels.coffre.famille', 'Famille'), sante: t('compte:labels.coffre.sante', 'Santé'), emploi: t('compte:labels.coffre.emploi', 'Emploi'), autre: t('compte:labels.coffre.autre', 'Autre'),
    }),
    historyKind: over(HISTORY_KIND_LABELS, {
      search: t('compte:labels.history.search', 'Recherche'), aide: t('compte:labels.history.aide', 'Aide consultée'), demarche: t('compte:labels.history.demarche', 'Démarche consultée'),
      structure: t('compte:labels.history.structure', 'Structure consultée'), diagnostic: t('compte:labels.history.diagnostic', 'Simulation'), plan: t('compte:labels.history.plan', 'Plan d’action'),
    }),
    delegationRole: over(DELEGATION_ROLE_LABELS, {
      AIDANT: t('compte:labels.role.aidant', 'Aidant (proche de confiance)'), TUTEUR: t('compte:labels.role.tuteur', 'Tuteur'),
      CURATEUR: t('compte:labels.role.curateur', 'Curateur'), REPRESENTANT: t('compte:labels.role.representant', 'Représentant légal'),
    }),
    delegationScope: over(DELEGATION_SCOPE_LABELS, {
      PARCOURS_READ: t('compte:labels.scope.parcours_read', 'Voir Mon Parcours (sans mes notes)'),
      COFFRE_LIST: t('compte:labels.scope.coffre_list', 'Voir la liste de Mon Coffre (sans ouvrir les documents)'),
      RDV_READ: t('compte:labels.scope.rdv_read', 'Voir mes prochains rendez-vous'),
    }),
    delegationStatus: over(DELEGATION_STATUS_LABELS, {
      INVITED: t('compte:labels.status.invited', 'Invitation envoyée'), INVITATION_EXPIRED: t('compte:labels.status.invitation_expired', 'Invitation expirée'),
      ACTIVE: t('compte:labels.status.active', 'Active'), PROOF_REQUIRED: t('compte:labels.status.proof_required', 'En attente : preuve du mandat non vérifiée'),
      EXPIRED: t('compte:labels.status.expired', 'Expirée'), DECLINED: t('compte:labels.status.declined', 'Refusée'), REVOKED: t('compte:labels.status.revoked', 'Terminée'),
    }),
    /** the size of a file (« 1,5 Mo », « 1.5 MB »…) */
    formatBytes: (/** @type {number} */ n) => (n >= 1024 * 1024
      ? t('compte:labels.size_mb', '{{n}} Mo', { n: formatNumber(n / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })
      : t('compte:labels.size_kb', '{{n}} Ko', { n: formatNumber(Math.max(1, Math.round(n / 1024))) })),
  }), [t, lang]);   // eslint-disable-line react-hooks/exhaustive-deps -- the labels follow the interface language
}
