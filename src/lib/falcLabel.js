/**
 * PKG-6 / P18: the label says whether the simplified text was reviewed by a person (review = { at, origin, fields } from the record).
 * PKG-11 / ADM-11: with `fields` ({ summary_falc: date | null, … } from the API, one entry per FALC text the record has), « relue » only when EVERY such text
 * was reviewed as it stands, « partiellement relue » when some were; the record-level date alone no longer vouches for every field.
 */
/** @param {boolean} hasFalcContent @param {{ at?: string | null, origin?: string | null, fields?: Record<string, string | null> | null, auto?: string | null } | null} review */
export function falcLabel(hasFalcContent, review) {
  if (!hasFalcContent) return 'FALC indisponible';
  // automatic verification chain (review.auto = date of the automatic check): written from the official source and checked automatically, not by a person
  if (review?.auto && !(review?.fields && Object.values(review.fields).some(Boolean)) && !review?.at) return 'Version simplifiée (contrôlée automatiquement)';
  const fields = review?.fields && typeof review.fields === 'object' ? Object.values(review.fields) : null;
  if (fields && fields.length) {
    const done = fields.filter(Boolean).length;
    if (done === fields.length) return 'Version simplifiée (relue)';
    if (done > 0) return 'Version simplifiée (partiellement relue)';
    return review?.origin === 'AI_LOCAL' ? 'Version simplifiée (IA, non relue)' : 'Version simplifiée (non relue)';
  }
  if (review?.at) return 'Version simplifiée (relue)';
  return review?.origin === 'AI_LOCAL' ? 'Version simplifiée (IA, non relue)' : 'Version simplifiée (non relue)';
}

/** ADM-11: the line shown under one FALC section: reviewed (date), checked automatically (date), not reviewed, or nothing when the section is not a FALC text. @param {string | null | undefined} at @param {string | null} [auto] */
export function falcFieldNote(at, auto) {
  if (at === undefined) return null;
  if (!at && auto) return `Rédigé à partir de la fiche officielle et contrôlé automatiquement le ${new Date(auto).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}`;
  return at ? `Relu par une personne le ${new Date(at).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}` : 'Texte simplifié non relu par une personne';
}
