/**
 * DTA S2B (gap D3d, data minimisation) — closed vocabulary of age bands accepted INSTEAD of an exact date of birth.
 * Pure data.  The lower bound is used ONLY by the non-authoritative local heuristic (rights-specific leads are disabled by default); it is never shown as an age and never
 * turned into a date.  No official threshold is asserted here.
 */
/** @type {Readonly<Record<string, Readonly<{ label: string, lowerBound: number }>>>} */
export const AGE_BANDS = Object.freeze({
  'moins-de-18': Object.freeze({ label: 'Moins de 18 ans', lowerBound: 16 }),
  '18-24': Object.freeze({ label: '18 à 24 ans', lowerBound: 18 }),
  '25-59': Object.freeze({ label: '25 à 59 ans', lowerBound: 25 }),
  '60-et-plus': Object.freeze({ label: '60 ans et plus', lowerBound: 60 }),
});
export const AGE_BAND_KEYS = Object.freeze(Object.keys(AGE_BANDS));

/** @param {unknown} band @returns {number|null} the heuristic lower bound, or null for anything outside the vocabulary */
export function ageFromBand(band) {
  return typeof band === 'string' && Object.prototype.hasOwnProperty.call(AGE_BANDS, band) ? AGE_BANDS[band].lowerBound : null;
}
