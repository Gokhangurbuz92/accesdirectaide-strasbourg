// @ts-nocheck
// owner LAB audit (2026-10-25): accessibilite_pmr is a boolean that defaults to false — « false » means « not confirmed » (the public site then says nothing),
// not « not accessible »; the review screens say so instead of showing a bare « false »
export const reviewValue = (field, value) => (field !== 'accessibilite_pmr' ? value
  : String(value) === 'true' ? 'confirmée (le site public l’indique)' : 'non confirmée (valeur par défaut ; le site public n’affiche rien)');

// the D-5 public-visibility reasons (api/lib/publicVisibility.js) in plain French for the administration screens
export const PUBLIC_REASON = {
  NOT_PUBLISHED: 'non publiée (brouillon)', ARCHIVED: 'archivée', LAB_ORIGIN_NOT_PUBLIC_IN_STRICT_MODE: 'fiche créée dans le LAB', NOT_LAUNCH_ELIGIBLE: 'hors périmètre du lancement',
  NOT_VERIFIED: 'non vérifiée', TERRITORY_NOT_VERIFIED: 'territoire non confirmé', PUBLICATION_HOLD: 'en attente', NO_PROVENANCE: 'sans source officielle',
  NO_VERIFICATION_DATE: 'sans date de vérification', VERIFICATION_IN_FUTURE: 'date de vérification invalide', VERIFICATION_STALE: 'vérification trop ancienne',
};
