/**
 * R31 (P13 / Q02) — a public text never asserts that a person HAS a right: « Vous avez droit si vous avez 25 ans ou plus » is wrong (age alone opens
 * nothing) and the organism decides. A question stays allowed (« savoir si vous avez le droit », « la structure vérifie si vous avez le droit »).
 * Used by the automatic text checks (writer side: api/_services/verification/texts.js, chain.js) and by the public read path (publicVisibility.stripReviewFields),
 * which withholds an already published simplified text that makes such a claim until the chain rewrites it.
 */
export const ENTITLEMENT_CLAIM = /(?<!\bsi\s)\bvous (?:avez|aurez) (?:le )?droit\b|\bvous (?:êtes|serez) (?:éligibles?|bénéficiaires?)\b|\bvous (?:recevrez|obtiendrez|toucherez)\b/iu;

/** @param {unknown} value a text, a list of texts, or a JSON-encoded list @returns {boolean} */
export function claimsEntitlement(value) {
  if (value === null || value === undefined) return false;
  const text = Array.isArray(value) ? value.join('\n') : typeof value === 'string' ? value : JSON.stringify(value);
  return ENTITLEMENT_CLAIM.test(text);
}
