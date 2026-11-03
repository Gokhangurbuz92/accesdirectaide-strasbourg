// The labels of src/lib/assessmentLabels.js in the interface language (same keys and order; French stays the default text of each key, so the French screens are unchanged).
// Same wording rule as assessmentLabels.js: pre-orientation only — never an entitlement claim (scripts/i18n-check.mjs ENTITLEMENT_CLAIMS checks every language).
import { useMemo } from 'react';
import { useT } from '@/i18n';
import { AGE_BAND_LABELS, GROUPS, MISSING_FACT_LABELS, STATE_LABELS } from '@/lib/assessmentLabels';

/** keeps the French map's keys and order; a key without a translation keeps its French label @param {Readonly<Record<string, string>>} base @param {Readonly<Record<string, string>>} labels */
const over = (base, labels) => Object.freeze(Object.fromEntries(Object.keys(base).map((k) => [k, labels[k] || base[k]])));

export function useAssessmentLabels() {
  const { t, i18n } = useT('shared');
  const lang = i18n.language;
  return useMemo(() => {
    const state = over(STATE_LABELS, {
      MISSING_INFORMATION: t('shared:assessment.state.missing_information', 'Informations manquantes'),
      CHECK_REQUIRED: t('shared:assessment.state.check_required', 'À faire vérifier'),
      POSSIBLE: t('shared:assessment.state.possible', 'Piste à vérifier'),
      UNSUPPORTED: t('shared:assessment.state.unsupported', 'Pas encore évalué par ADA'),
      ENGINE_UNAVAILABLE: t('shared:assessment.state.engine_unavailable', 'Service indisponible'),
    });
    const missingFact = over(MISSING_FACT_LABELS, {
      birthDate: t('shared:assessment.fact.birth_date', 'date de naissance ou tranche d\'âge'),
      householdSize: t('shared:assessment.fact.household_size', 'composition du foyer'),
      income: t('shared:assessment.fact.income', 'revenus'),
      'housing.status': t('shared:assessment.fact.housing_status', "statut d'occupation du logement"),
      'housing.rent': t('shared:assessment.fact.housing_rent', 'loyer'),
      territory: t('shared:assessment.fact.territory', 'commune ou code postal'),
    });
    const ageBand = over(AGE_BAND_LABELS, {
      'moins-de-18': t('shared:assessment.age_band.under_18', 'Moins de 18 ans'), '18-24': t('shared:assessment.age_band.18_24', '18 à 24 ans'),
      '25-59': t('shared:assessment.age_band.25_59', '25 à 59 ans'), '60-et-plus': t('shared:assessment.age_band.60_plus', '60 ans et plus'),
    });
    /** @type {Record<string, string>} */
    const groupTitles = {
      check: t('shared:assessment.group.check', "À faire vérifier auprès de l'organisme"), missing: t('shared:assessment.group.missing', 'Informations manquantes'),
      unsupported: t('shared:assessment.group.unsupported', 'ADA ne sait pas encore évaluer'), engine: t('shared:assessment.group.engine', 'Service indisponible'),
    };
    const groups = Object.freeze(GROUPS.map((g) => Object.freeze({ ...g, title: groupTitles[g.id] || g.title })));
    const missingFactLabel = (/** @type {string} */ k) => missingFact[k] || t('shared:assessment.fact.other', 'information à préciser');
    /** same as assessmentLabels.birthDisplay: the exact date, else the declared band, else "Non précisée" */
    const birthDisplay = (/** @type {{ birthDate?: string | null, ageBand?: string | null } | null | undefined} */ situation) => {
      const band = situation && situation.ageBand ? ageBand[situation.ageBand] : '';   // same keys as AGE_BAND_LABELS
      return (situation && situation.birthDate)
        || (band ? t('shared:assessment.age_band.display', 'Tranche d\'âge : {{band}}', { band }) : t('shared:assessment.birth_unspecified', 'Non précisée'));
    };
    const dataStatusBanner = t('shared:assessment.data_status_banner', 'Données en cours de vérification.');
    /** same codes and texts as assessmentLabels.errorMessageFor: keyed on the error code, never on server-supplied free text */
    const errorMessageFor = (/** @type {number} */ status, /** @type {string | null | undefined} */ code) => {
      if (code === 'invalid_json' || code === 'invalid_body' || code === 'validation_error') return t('shared:assessment.error.invalid_input', 'Vérifiez les informations saisies (date de naissance, montants) puis réessayez.');
      if (status === 429 || code === 'rate_limit_exceeded') return t('shared:assessment.error.rate_limited', 'Trop de demandes en peu de temps. Patientez un instant avant de réessayer.');
      if (status === 503 || code === 'OPENFISCA_UNAVAILABLE') return t('shared:assessment.error.engine_unavailable', 'Le service est momentanément indisponible. Aucun résultat de remplacement n\'est affiché. Réessayez plus tard.');
      return t('shared:assessment.error.unavailable', 'Le service de diagnostic est temporairement indisponible. Réessayez plus tard.');
    };
    return { state, missingFact, missingFactLabel, ageBand, birthDisplay, groups, dataStatusBanner, errorMessageFor };
  }, [t, lang]);   // eslint-disable-line react-hooks/exhaustive-deps -- the labels follow the interface language
}
