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
  // G14-AID — mode accompagnant
  ASSIST_NOT_ALLOWED: i18n.t('common:api_error.assist_not_allowed', 'En mode accompagnant, cette partie du compte n’est pas accessible. La personne peut la consulter seule, après avoir arrêté le mode accompagnant.'),
  ASSIST_ENDED: i18n.t('common:api_error.assist_ended', 'Le mode accompagnant est terminé : reconnectez-vous pour continuer.'),
  ASSIST_ADULT_ONLY: i18n.t('common:api_error.assist_adult_only', 'Le mode accompagnant est réservé aux comptes de personnes majeures.'),
  ASSIST_LEGAL_PROTECTION_OUT_OF_SCOPE: i18n.t('common:api_error.assist_legal_protection', 'Le mode accompagnant ne remplace pas une tutelle, une curatelle ou un mandat : il n’est pas disponible pour ce compte.'),
  PRO_HELPER_NOT_VERIFIED: i18n.t('common:api_error.pro_helper_not_verified', 'Le code de l’intervenant ADA Pro n’est pas valable. Demandez-lui un nouveau code.'),
  REQUEST_NOT_FOUND: i18n.t('common:api_error.request_not_found', 'Cette demande n’existe plus : elle a expiré ou a déjà été traitée.'),
  DELEGATION_INACTIVE: i18n.t('common:api_error.delegation_inactive', 'Cet accès n’est plus actif : rien n’a été fait.'),
  INVALID_TITLE: i18n.t('common:api_error.invalid_title', 'Décrivez l’étape en 3 à 200 caractères.'),
  DEADLINE_SOURCE_REQUIRED: i18n.t('common:api_error.deadline_source', 'Une échéance doit citer sa source officielle (adresse https d’un site public reconnu).'),
  PARCOURS_FULL: i18n.t('common:api_error.parcours_full', 'Mon Parcours a atteint le nombre maximal d’étapes.'),
  // G8: a sensitive step / note (api/lib/parcours-sensitivity.js) — refused by default; in « consent » mode, kept only with the person's explicit consent
  SENSITIVE_STEP_EXCLUDED: i18n.t('common:api_error.sensitive_step_excluded', 'Mon Parcours n’enregistre pas, pour le moment, ce qui concerne la santé, le handicap, une addiction, le droit au séjour, la justice, une mesure de protection, la vie sexuelle ou des violences subies. Rien n’a été enregistré : décrivez l’étape sans cette information.'),
  NOTES_CLOSED: i18n.t('common:api_error.notes_closed', 'Les notes personnelles ne sont plus proposées sur ce service. Vous pouvez effacer une note existante.'),
  SENSITIVE_STEP_CONSENT_REQUIRED: i18n.t('common:api_error.sensitive_step_consent', 'Cette étape semble révéler une information sensible. Elle n’est enregistrée qu’avec votre accord explicite. Rien n’a été enregistré.'),
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
  GROUND_REQUIRED: i18n.t('common:api_error.ground_required', 'Choisissez la raison de votre demande (une des quatre raisons prévues par l’article 18 du RGPD).'),
  NETWORK: i18n.t('common:api_error.network', 'Le service est momentanément injoignable. Réessayez dans un instant.'),
  // G14-R3G — protection juridique (api/_services/legal-protection.js)
  LEGAL_PROTECTION_NOT_INSTALLED: i18n.t('legalprotection:err.not_installed', 'La protection juridique n’est pas encore disponible sur ce service. Rien n’a été enregistré.'),
  STATEMENT_REQUIRED: i18n.t('legalprotection:err.statement', 'Cochez la case qui certifie que la décision du juge existe et vous désigne.'),
  KIND_NOT_ALLOWED: i18n.t('legalprotection:err.kind_not_allowed', 'L’habilitation familiale ne peut être confiée qu’à un proche de la personne.'),
  END_DATE_BEYOND_LAW: i18n.t('legalprotection:err.end_date_beyond_law', 'Cette date de fin dépasse la durée que la loi permet pour cette mesure : vérifiez-la dans la décision.'),
  MEASURE_ALREADY_ENDED: i18n.t('legalprotection:err.measure_ended', 'D’après sa date de fin, cette mesure est terminée : elle ne peut pas être enregistrée.'),
  MANDATE_NOT_ACTIVE: i18n.t('legalprotection:err.not_active', 'Ce lien n’est pas actif (pas encore vérifié, suspendu, terminé ou expiré) : rien n’a été fait.'),
  AREA_NOT_COVERED: i18n.t('legalprotection:err.area', 'La décision vérifiée ne couvre pas cette partie.'),
  REPRESENTATIVE_NOT_VERIFIED: i18n.t('legalprotection:err.rep_code', 'Le code du représentant n’est pas valable, ou son lien n’est pas vérifié. Demandez-lui un nouveau code.'),
  ASSIST_REPRESENTATIVE_REQUIRED: i18n.t('legalprotection:err.rep_required', 'Une décision de justice vérifiée confie à votre représentant le soin d’agir pour vous ici : le mode accompagnant n’est possible qu’avec lui. Vous pouvez toujours utiliser votre compte vous-même.'),
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
