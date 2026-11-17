/**
 * A-13 — what the person reads when the citizen API refuses (Mon Espace and the account pages), in the INTERFACE language.
 * The API answers a stable `error` code and a French `message`. Before: the client passed the French sentence through, so every screen that shows
 * `err.message` showed French to an Arabic, Turkish… reader. Now the client itself builds the sentence:
 *   - French interface: the server's own sentence, exactly as before (it is the most specific: it carries the limits and the names);
 *   - another language: the sentence of the CODE in that language; for a code without a sentence of its own, the sentence of the HTTP status. Never the raw
 *     French server text (it stays available as `err.serverMessage` for a caller that wants to show it marked lang="fr").
 * Codes shared by several situations (NOT_FOUND, PROCESSING_RESTRICTED, INVALID_EMAIL…) have a sentence that is true in all of them.
 */
import i18n from '@/i18n';

/** @returns {Record<string, string>} the sentences by API code (upper-cased) */
const byCode = () => ({
  FILE_TOO_LARGE: i18n.t('common:api_error.file_too_large', 'Fichier trop volumineux (3 Mo au plus).'),
  UNSUPPORTED_TYPE: i18n.t('common:api_error.unsupported_type', 'Seuls les fichiers PDF, PNG et JPEG sont acceptés.'),
  TYPE_MISMATCH: i18n.t('common:api_error.type_mismatch', 'Le contenu du fichier ne correspond pas à son type déclaré.'),
  INVALID_FILE: i18n.t('common:api_error.invalid_file', 'Fichier illisible ou vide.'),
  QUOTA_BYTES: i18n.t('common:api_error.quota_bytes', 'Espace de Mon Coffre insuffisant (50 Mo au total).'),
  QUOTA_FILES: i18n.t('common:api_error.quota_files', 'Mon Coffre est plein : supprimez un document avant d’en ajouter un.'),
  HEALTH_DOCUMENTS_NOT_ACCEPTED: i18n.t('common:api_error.health_documents', 'Les documents de santé ne sont pas acceptés ici : leur hébergement demande un hébergeur agréé pour les données de santé, qui n’est pas encore en place.'),
  PROTECTED_STORE_REFUSED: i18n.t('common:api_error.protected_store', 'Le stockage protégé de ces documents n’est pas disponible sur ce service : aucun document n’a été lu ni enregistré.'),
  INVALID_PHONE: i18n.t('common:api_error.invalid_phone', 'Numéro de téléphone invalide (format français attendu, par exemple 06 12 34 56 78).'),
  INVALID_EMAIL: i18n.t('common:api_error.invalid_email', 'Adresse e-mail invalide.'),
  INVALID_PASSWORD: i18n.t('common:api_error.invalid_password', 'Mot de passe incorrect.'),
  SAME_EMAIL: i18n.t('common:api_error.same_email', 'C’est déjà votre adresse.'),
  EMAIL_NOT_VERIFIED: i18n.t('common:api_error.email_not_verified', 'Vérifiez d’abord votre adresse e-mail.'),
  INVALID_DISPLAY_NAME: i18n.t('common:api_error.invalid_display_name', 'Le nom affiché doit contenir 1 à 60 caractères.'),
  HOUSEHOLD_FULL: i18n.t('common:api_error.household_full', 'Votre foyer a atteint le nombre maximal de personnes.'),
  CONSENT_REQUIRED: i18n.t('common:api_error.consent_required', 'Cette option nécessite votre consentement explicite, distinct de l’acceptation du service.'),
  CHANNEL_UNAVAILABLE: i18n.t('common:api_error.channel_unavailable', 'Ce moyen de notification n’est pas disponible sur ce service : rien ne serait envoyé.'),
  INVALID_TITLE: i18n.t('common:api_error.invalid_title', 'Décrivez l’étape en 3 à 200 caractères.'),
  DEADLINE_SOURCE_REQUIRED: i18n.t('common:api_error.deadline_source', 'Une échéance doit citer sa source officielle (adresse https d’un site public reconnu).'),
  PARCOURS_FULL: i18n.t('common:api_error.parcours_full', 'Mon Parcours a atteint le nombre maximal d’étapes.'),
  NO_PLAN: i18n.t('common:api_error.no_plan', 'Ce dossier ne contient pas encore de plan d’action à suivre.'),
  NO_ACTIVE_GRANT: i18n.t('common:api_error.no_active_grant', 'Cette organisation n’a pas (ou plus) accès à ce dossier.'),
  PROCESSING_RESTRICTED: i18n.t('common:api_error.processing_restricted', 'La limitation du traitement des données est en place : cette action est suspendue tant qu’elle dure.'),
  SELF_DELEGATION: i18n.t('common:api_error.self_delegation', 'Vous ne pouvez pas vous déléguer à vous-même.'),
  ALREADY_INVITED: i18n.t('common:api_error.already_invited', 'Une délégation est déjà en cours avec cette personne.'),
  SCOPE_NOT_GRANTED: i18n.t('common:api_error.scope_not_granted', 'La personne ne vous a pas donné accès à cette partie.'),
  CAPABILITY_NOT_OPEN: i18n.t('common:api_error.capability_not_open', 'Cette fonction n’est pas encore ouverte sur ce service. Aucune donnée n’a été lue ni enregistrée.'),
  INVITATION_INVALID: i18n.t('common:api_error.invitation_invalid', 'Cette invitation n’est plus valable.'),
  INVITATION_NOT_FOR_YOU: i18n.t('common:api_error.invitation_not_for_you', 'Cette invitation est destinée à une autre adresse e-mail.'),
  EXPIRED: i18n.t('common:api_error.expired', 'Ce dossier a expiré.'),
  THREAD_CLOSED: i18n.t('common:api_error.thread_closed', 'Cette structure n’a plus accès à votre dossier : elle ne pourrait pas lire votre message.'),
  NOT_FOUND: i18n.t('common:api_error.not_found', 'Introuvable : cet élément n’existe pas, ou plus, ou n’est pas rattaché à votre compte.'),
  CSRF_BOOTSTRAP: i18n.t('common:api_error.csrf_bootstrap', 'Impossible de préparer la requête sécurisée. Rechargez la page puis réessayez.'),
  NETWORK: i18n.t('common:api_error.network', 'Le service est momentanément injoignable. Réessayez dans un instant.'),
});

/** @param {number} status @returns {string} the sentence of an HTTP status, for a code that has none of its own */
function byStatus(status) {
  if (status === 401) return i18n.t('common:api_error.status_401', 'Connectez-vous pour accéder à votre espace.');
  if (status === 403) return i18n.t('common:api_error.status_403', 'Cette action ne vous est pas ouverte.');
  if (status === 404) return byCode().NOT_FOUND;
  if (status === 409) return i18n.t('common:api_error.status_409', 'Cette action n’est pas possible dans l’état actuel. Rechargez la page, puis réessayez.');
  if (status === 413) return i18n.t('common:api_error.status_413', 'Ce que vous envoyez est trop volumineux.');
  if (status === 429) return i18n.t('common:api_error.status_429', 'Trop de demandes, patientez un instant.');
  if (status >= 500) return i18n.t('common:api_error.status_5xx', 'Le service a rencontré un problème. Réessayez dans un instant.');
  if (status === 400 || status === 422) return i18n.t('common:api_error.status_400', 'Cette demande n’a pas pu être acceptée : vérifiez ce que vous avez saisi.');
  return i18n.t('common:api_error.generic', 'Une erreur est survenue.');
}

const isFrench = () => String(i18n.language || 'fr').toLowerCase().startsWith('fr');

/**
 * @param {{ code?: unknown, status?: number, serverMessage?: unknown }} e what the API answered
 * @returns {string} the sentence to show, in the interface language
 */
export function citizenErrorText({ code, status = 0, serverMessage }) {
  const server = typeof serverMessage === 'string' ? serverMessage.trim() : '';
  if (isFrench() && server) return server;
  const known = byCode()[String(code || '').toUpperCase()];
  return known || byStatus(Number(status) || 0);
}

/** the codes that have a sentence of their own (tests, coverage) @returns {string[]} */
export const knownCitizenErrorCodes = () => Object.keys(byCode());
