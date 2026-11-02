// @ts-nocheck
import i18n from '@/i18n';

// owner LAB audit (2026-10-25): accessibilite_pmr is a boolean that defaults to false — « false » means « not confirmed » (the public site then says nothing),
// not « not accessible »; the review screens say so instead of showing a bare « false »
export const reviewValue = (field, value) => (field !== 'accessibilite_pmr' ? value
  : String(value) === 'true' ? i18n.t('admin:review_value.pmr_confirmed', 'confirmée (le site public l’indique)') : i18n.t('admin:review_value.pmr_not_confirmed', 'non confirmée (valeur par défaut ; le site public n’affiche rien)'));

// the D-5 public-visibility reasons (api/lib/publicVisibility.js) in plain words for the administration screens (in the interface language; an unknown code shows as is)
export const publicReason = (code) => ({
  NOT_PUBLISHED: i18n.t('admin:review_value.reason.not_published', 'non publiée (brouillon)'), ARCHIVED: i18n.t('admin:review_value.reason.archived', 'archivée'),
  LAB_ORIGIN_NOT_PUBLIC_IN_STRICT_MODE: i18n.t('admin:review_value.reason.lab_origin', 'fiche créée dans le LAB'), NOT_LAUNCH_ELIGIBLE: i18n.t('admin:review_value.reason.not_launch_eligible', 'hors périmètre du lancement'),
  NOT_VERIFIED: i18n.t('admin:review_value.reason.not_verified', 'non vérifiée'), TERRITORY_NOT_VERIFIED: i18n.t('admin:review_value.reason.territory_not_verified', 'territoire non confirmé'),
  PUBLICATION_HOLD: i18n.t('admin:review_value.reason.publication_hold', 'en attente'), NO_PROVENANCE: i18n.t('admin:review_value.reason.no_provenance', 'sans source officielle'),
  NO_VERIFICATION_DATE: i18n.t('admin:review_value.reason.no_verification_date', 'sans date de vérification'), VERIFICATION_IN_FUTURE: i18n.t('admin:review_value.reason.verification_in_future', 'date de vérification invalide'),
  VERIFICATION_STALE: i18n.t('admin:review_value.reason.verification_stale', 'vérification trop ancienne'),
}[code] || code);
