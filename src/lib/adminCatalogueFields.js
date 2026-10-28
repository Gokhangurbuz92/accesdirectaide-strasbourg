/**
 * PKG-11 / A02 — editable fields of the administrator catalogue editor, per kind (real columns; the server allow-list in api/_services/admin-content.js is the
 * authority). FALC texts are edited in /admin/falc, the verification state in the verification register.
 */
export const AIDE_CATEGORIES = ['logement', 'sante', 'handicap', 'emploi', 'famille', 'budget', 'mobilite', 'justice', 'numerique', 'etrangers', 'isolement', 'lgbtqia', 'vieillissement', 'autre'];

export const AIDE_FIELDS = [
  { name: 'titre', label: 'Titre', type: 'text', required: true },
  { name: 'categorie', label: 'Catégorie', type: 'select', options: AIDE_CATEGORIES },
  { name: 'cest_quoi', label: 'C’est quoi ?', type: 'textarea' },
  { name: 'pour_qui', label: 'Pour qui ?', type: 'textarea' },
  { name: 'ce_que_ca_aide', label: 'Ce que ça aide', type: 'textarea' },
  { name: 'delai_indicatif', label: 'Délai indicatif', type: 'text' },
  { name: 'documents_necessaires', label: 'Documents nécessaires', type: 'list' },
  { name: 'ou_demander', label: 'Où demander ?', type: 'textarea' },
  { name: 'lien_demande', label: 'Lien de la demande', type: 'text' },
  { name: 'source_url', label: 'Source officielle (adresse web)', type: 'text' },
  { name: 'mots_cles', label: 'Mots-clés', type: 'list' },
  { name: 'est_urgent', label: 'Aide d’urgence', type: 'boolean' },
  // R24: the geography a record applies to (codes INSEE des départements, e.g. 67)
  { name: 'territoires', label: 'Territoires', type: 'list' },
  { name: 'departements', label: 'Départements (codes INSEE, ex. 67)', type: 'list' },
];

export const DEMARCHE_FIELDS = [
  { name: 'titre', label: 'Titre', type: 'text', required: true },
  { name: 'categorie', label: 'Catégorie', type: 'select', options: AIDE_CATEGORIES },
  { name: 'description_courte', label: 'Description courte', type: 'textarea' },
  { name: 'contenu_detaille', label: 'Contenu détaillé', type: 'textarea' },
  { name: 'pour_qui', label: 'Pour qui ?', type: 'textarea' },
  { name: 'ou_faire', label: 'Où faire la démarche ?', type: 'textarea' },
  { name: 'lien_officiel', label: 'Lien officiel', type: 'text' },
  { name: 'documents_necessaires', label: 'Documents nécessaires', type: 'list' },
  { name: 'delai', label: 'Délai', type: 'text' },
  { name: 'cout', label: 'Coût', type: 'text' },
  { name: 'mots_cles', label: 'Mots-clés', type: 'list' },
  { name: 'departements', label: 'Départements (codes INSEE, ex. 67)', type: 'list' },
];

export const STRUCTURE_FIELDS = [
  { name: 'nom', label: 'Nom', type: 'text', required: true },
  { name: 'type_structure', label: 'Type de structure', type: 'text' },
  { name: 'description_courte', label: 'Description courte', type: 'textarea' },
  { name: 'adresse', label: 'Adresse', type: 'text', required: true },
  { name: 'code_postal', label: 'Code postal', type: 'text', required: true },
  { name: 'ville', label: 'Commune', type: 'text', required: true },
  { name: 'departement', label: 'Département', type: 'text' },
  { name: 'telephone', label: 'Téléphone', type: 'text' },
  { name: 'email', label: 'Courriel', type: 'text' },
  { name: 'site_web', label: 'Site web', type: 'text' },
  { name: 'horaires', label: 'Horaires', type: 'textarea' },
  { name: 'services', label: 'Services', type: 'list' },
  { name: 'publics_accueillis', label: 'Publics accueillis', type: 'list' },
  { name: 'categories_aidees', label: 'Catégories d’aide', type: 'list' },
  { name: 'accessibilite_pmr', label: 'Accessible aux personnes à mobilité réduite', type: 'boolean' },
  { name: 'source_url', label: 'Source (adresse web)', type: 'text' },
];

export const DISPOSITIF_FIELDS = [
  { name: 'titre', label: 'Titre', type: 'text', required: true },
  { name: 'description_falc', label: 'Description (facile à lire)', type: 'textarea' },
  { name: 'summary_falc', label: 'Résumé', type: 'textarea' },
  { name: 'public', label: 'Publics concernés', type: 'list' },
  { name: 'departement', label: 'Département', type: 'text' },
  { name: 'montant', label: 'Montant (tel que l’indique la source officielle)', type: 'text' },
  { name: 'liens', label: 'Liens officiels', type: 'links' },
  { name: 'related_aide_ids', label: 'Aides liées (identifiant ou adresse de la fiche)', type: 'list' },
  { name: 'related_structure_ids', label: 'Structures qui accompagnent (identifiant ou adresse de la fiche)', type: 'list' },
  { name: 'source_url', label: 'Source officielle (adresse web)', type: 'text' },
];

/** A guide is ADA's own editorial content (no verification register); its steps are shown on /guides/:slug in this order. */
export const GUIDE_FIELDS = [
  { name: 'titre', label: 'Titre', type: 'text', required: true },
  { name: 'resume_falc', label: 'Résumé (facile à lire)', type: 'textarea' },
  { name: 'contenu_json', label: 'Étapes du guide', type: 'steps' },
  { name: 'categorie', label: 'Catégorie', type: 'select', options: AIDE_CATEGORIES },
  { name: 'publics', label: 'Publics', type: 'list' },
  { name: 'contexte', label: 'Situations', type: 'list' },
  { name: 'mots_cles', label: 'Mots-clés', type: 'list' },
  { name: 'sources_urls', label: 'Sources (adresses web)', type: 'list' },
];
