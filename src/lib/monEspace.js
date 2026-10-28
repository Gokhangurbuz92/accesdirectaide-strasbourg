// PKG-2 / K2 — labels shared by the Mon Espace screens. A Parcours status is the PERSON's own tracking: ADA never records or implies a decision of an organisation.
export const PARCOURS_STATUS_LABELS = Object.freeze({
  NOT_STARTED: 'À commencer',
  IN_PROGRESS: 'En cours',
  DOCUMENTS_REQUIRED: 'Papiers à rassembler',
  READY: 'Prêt à envoyer',
  SUBMITTED: 'Demande envoyée',
  WAITING_ORGANIZATION: 'En attente de l’organisme',
  ADDITIONAL_INFORMATION: 'L’organisme demande des informations',
  DECISION_POSITIVE: 'Réponse favorable (indiquée par vous)',
  DECISION_NEGATIVE: 'Réponse défavorable (indiquée par vous)',
  CLOSED: 'Terminé',
});
export const PARCOURS_DONE = ['DECISION_POSITIVE', 'DECISION_NEGATIVE', 'CLOSED'];
export const COFFRE_CATEGORY_LABELS = Object.freeze({
  identite: 'Identité', revenus: 'Revenus', logement: 'Logement', famille: 'Famille', sante: 'Santé', emploi: 'Emploi', autre: 'Autre',
});
/** R15 (HDS): categories a new document can be filed under — « Santé » is refused by the server until health-data hosting is qualified (api/_services/mon-espace.js). */
export const COFFRE_UPLOAD_CATEGORIES = Object.freeze(Object.keys(COFFRE_CATEGORY_LABELS).filter((c) => c !== 'sante'));

export const HISTORY_KIND_LABELS = Object.freeze({ search: 'Recherche', aide: 'Aide consultée', demarche: 'Démarche consultée', structure: 'Structure consultée', diagnostic: 'Simulation', plan: 'Plan d’action' });
export const formatBytes = (/** @type {number} */ n) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);
export const formatDate = (/** @type {string | Date | null} */ d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
/** Reads a File as base64 (no data: prefix). @param {Blob} file @returns {Promise<string>} */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    r.readAsDataURL(file);
  });
}
// PKG-2 / C23 — delegation labels
export const DELEGATION_ROLE_LABELS = Object.freeze({ AIDANT: 'Aidant (proche de confiance)', TUTEUR: 'Tuteur', CURATEUR: 'Curateur', REPRESENTANT: 'Représentant légal' });
export const DELEGATION_SCOPE_LABELS = Object.freeze({ PARCOURS_READ: 'Voir Mon Parcours (sans mes notes)', COFFRE_LIST: 'Voir la liste de Mon Coffre (sans ouvrir les documents)', RDV_READ: 'Voir mes prochains rendez-vous' });
export const DELEGATION_STATUS_LABELS = Object.freeze({ INVITED: 'Invitation envoyée', INVITATION_EXPIRED: 'Invitation expirée', ACTIVE: 'Active', PROOF_REQUIRED: 'En attente : preuve du mandat non vérifiée',
  EXPIRED: 'Expirée', DECLINED: 'Refusée', REVOKED: 'Terminée' });
