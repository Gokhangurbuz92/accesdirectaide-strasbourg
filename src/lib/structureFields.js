/** PKG-4 / E02 E05 — French labels for the structure profile fields a team can propose (the server validates every value). */
export const STRUCTURE_FIELD_LABELS = {
  adresse: 'Adresse', code_postal: 'Code postal', ville: 'Ville', horaires: 'Horaires d’accueil', telephone: 'Téléphone', email: 'Courriel de contact',
  site_web: 'Site web (https://…)', accessibilite_pmr: 'Accessible aux personnes à mobilité réduite', summary_falc: 'Présentation en FALC (facile à lire et à comprendre)',
  service_area: 'Zone d’intervention (codes INSEE des communes)',
};
export const PROPOSAL_STATUS_LABELS = { PENDING: 'En attente de vérification ADA', ACCEPTED: 'Acceptée et publiée', REJECTED: 'Refusée', WITHDRAWN: 'Retirée' };

/** @type {Record<string, string>} */
const DEPARTEMENTS = { 67: 'Bas-Rhin', 68: 'Haut-Rhin' };
/** The département shown on a structure page: its own field, else its postal code; null when neither says (the line is then left out, never shown empty).
 * @param {{ departement?: string | null, code_postal?: string | null } | null | undefined} structure @returns {string | null} */
export function departementLabel(structure) {
  const cp = String(structure?.code_postal || '').trim();
  const code = String(structure?.departement || '').trim() || (/^\d{5}$/.test(cp) ? cp.slice(0, 2) : '');
  return code ? DEPARTEMENTS[code] || code : null;
}
