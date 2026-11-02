// The labels of src/config/orientationNeeds.js in the interface language, at display time only (the server, api/_services/orientation-basket.js, keeps the
// French list as it is). Same codes, terms and order; French stays the default text of each key, so the French screens are unchanged.
import { useMemo } from 'react';
import { useT } from '@/i18n';
import { FOLLOW_UPS, ITEM_KINDS, ORIENTATION_NEEDS } from '@/config/orientationNeeds';

/** keeps the French map's keys and order; a key without a translation keeps its French label */
const over = (base, labels) => Object.freeze(Object.fromEntries(Object.keys(base).map((k) => [k, labels[k] || base[k]])));

export function useOrientationLabels() {
  const { t, i18n } = useT('pro');
  const lang = i18n.language;
  return useMemo(() => {
    const needLabels = {
      LOGEMENT: t('pro:orientation_needs.logement', 'Logement, hébergement'), SANTE: t('pro:orientation_needs.sante', 'Santé, soins'),
      HANDICAP: t('pro:orientation_needs.handicap', 'Handicap'), AUTONOMIE: t('pro:orientation_needs.autonomie', 'Personnes âgées, autonomie'),
      EMPLOI: t('pro:orientation_needs.emploi', 'Emploi, insertion'), FAMILLE: t('pro:orientation_needs.famille', 'Famille, enfants'),
      BUDGET: t('pro:orientation_needs.budget', 'Budget, alimentation, dettes'), DROITS: t('pro:orientation_needs.droits', 'Accès aux droits, démarches'),
      MOBILITE: t('pro:orientation_needs.mobilite', 'Mobilité, transport'), SEJOUR: t('pro:orientation_needs.sejour', 'Droit au séjour, personnes étrangères'),
      LIEN_SOCIAL: t('pro:orientation_needs.lien_social', 'Lien social, culture, loisirs'),
    };
    const needs = Object.freeze(ORIENTATION_NEEDS.map((n) => Object.freeze({ ...n, label: needLabels[n.code] || n.label })));
    const needLabel = (code) => needs.find((n) => n.code === code)?.label || code;
    const followUps = over(FOLLOW_UPS, {
      A_PROPOSER: t('pro:orientation_follow_ups.a_proposer', 'À proposer'), PROPOSE: t('pro:orientation_follow_ups.propose', 'Proposé à la personne'),
      FAIT: t('pro:orientation_follow_ups.fait', 'Démarche faite'), SANS_SUITE: t('pro:orientation_follow_ups.sans_suite', 'Sans suite'),
    });
    const itemKinds = over(ITEM_KINDS, {
      aide: t('pro:orientation_item_kinds.aide', 'Aide'), demarche: t('pro:orientation_item_kinds.demarche', 'Démarche'), structure: t('pro:orientation_item_kinds.structure', 'Lieu d’accueil'),
    });
    return { needs, needLabel, followUps, itemKinds };
  }, [t, lang]);   // eslint-disable-line react-hooks/exhaustive-deps -- the labels follow the interface language
}
