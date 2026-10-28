/**
 * DTA S1C — precise detector for a POSITIVE refusal / inapplicability / non-entitlement decision in user-facing text.
 * Replaces the broad /refus|pas droit|rejet/ of browser test DTA-B2, which also matched the legitimate disclaimer
 * "Elles ne sont ni une décision, ni une promesse, ni un refus." (a sentence that explains that NO decision was made).
 * Rule per sentence:
 *  - "refus" / "rejet" is allowed only inside a sentence that negates it (ni, n'est, ne … pas, aucun, sans);
 *  - "(vous) n'avez pas droit" / "pas droit à" is allowed only inside the explicit reassurance "ne veut pas dire / ne signifie pas / ne prouve pas";
 *  - past-participle decisions ("refusé(e)", "rejeté(e)"), "non éligible", "inéligible", "pas éligible" are never allowed.
 * It does not widen the existing forbidden lists (€, éligible, avez droit, non applicable, estimation totale, certifié…): those stay as they are.
 */
export const sentences = (text) => String(text).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

const NEGATES = /\bni\b|\bn['’]est\b|\bn['’]a\b|\bne\b[^.]*\bpas\b|\baucun(e)?\b|\bsans\b/i;
const REASSURES = /\bne (veut|signifie|prouve) pas\b/i;

export function findProhibitedDecisionWording(text) {
  const bad = [];
  for (const s of sentences(text)) {
    if (/\b(refusée?s?|rejetée?s?)\b|non[- ]éligible|inéligible|pas éligible/i.test(s)) { bad.push(s); continue; }
    if (/\b(refus|rejet)s?\b/i.test(s) && !NEGATES.test(s)) { bad.push(s); continue; }
    if (/n['’]avez pas droit|pas droit à|aucun droit/i.test(s) && !REASSURES.test(s)) bad.push(s);
  }
  return bad;
}
