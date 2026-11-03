// The labels of src/lib/structureFields.js in the interface language (same keys and order; French stays the default text of each key, so the French screens are unchanged).
import { useMemo } from 'react';
import { useT } from '@/i18n';
import { PROPOSAL_STATUS_LABELS, STRUCTURE_FIELD_LABELS } from '@/lib/structureFields';

/** keeps the French map's keys and order; a key without a translation keeps its French label @param {Readonly<Record<string, string>>} base @param {Readonly<Record<string, string>>} labels */
const over = (base, labels) => Object.freeze(Object.fromEntries(Object.keys(base).map((k) => [k, labels[k] || base[k]])));

export function useStructureFieldLabels() {
  const { t, i18n } = useT('admin');
  const lang = i18n.language;
  return useMemo(() => ({
    fieldLabels: over(STRUCTURE_FIELD_LABELS, {
      adresse: t('admin:structure_field_labels.adresse', 'Adresse'), code_postal: t('admin:structure_field_labels.code_postal', 'Code postal'),
      ville: t('admin:structure_field_labels.ville', 'Ville'), horaires: t('admin:structure_field_labels.horaires', 'Horaires d’accueil'),
      telephone: t('admin:structure_field_labels.telephone', 'Téléphone'), email: t('admin:structure_field_labels.email', 'Courriel de contact'),
      site_web: t('admin:structure_field_labels.site_web', 'Site web (https://…)'),
      accessibilite_pmr: t('admin:structure_field_labels.accessibilite_pmr', 'Accessible aux personnes à mobilité réduite'),
      summary_falc: t('admin:structure_field_labels.summary_falc', 'Présentation en FALC (facile à lire et à comprendre)'),
      service_area: t('admin:structure_field_labels.service_area', 'Zone d’intervention (codes INSEE des communes)'),
    }),
    proposalStatus: over(PROPOSAL_STATUS_LABELS, {
      PENDING: t('admin:proposal_status_labels.pending', 'En attente de vérification ADA'), ACCEPTED: t('admin:proposal_status_labels.accepted', 'Acceptée et publiée'),
      REJECTED: t('admin:proposal_status_labels.rejected', 'Refusée'), WITHDRAWN: t('admin:proposal_status_labels.withdrawn', 'Retirée'),
    }),
  }), [t, lang]);   // eslint-disable-line react-hooks/exhaustive-deps -- the labels follow the interface language
}
