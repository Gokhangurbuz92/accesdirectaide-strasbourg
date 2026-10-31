/**
 * Boîte à outils (P11): official public online services and simulators, listed while no tool of AccesDirectAide's own is published.
 * Each entry points to the service's own official site and says what it is for, nothing more: AccesDirectAide does not run these tools and does not
 * vouch for a result. Each address was opened on `checkedAt` and answered normally (HTTP 200, the service's own page title); the list is checked
 * by tests/unit/r26-public-experience.test.jsx (https, official domains only).
 */
export const OFFICIAL_TOOLS_CHECKED_AT = '2026-10-31';

export const OFFICIAL_TOOLS = [
  { id: 'mes-droits-sociaux', titre: 'Simulateur Mes Droits Sociaux', url: 'https://www.mesdroitssociaux.gouv.fr/accueil/simulateur', categorie: 'droits',
    description: 'Estimer en ligne les aides sociales auxquelles vous pourriez avoir droit.' },
  { id: 'caf-demarches', titre: 'Démarches et simulations de la Caf', url: 'https://www.caf.fr/allocataires/aides-et-demarches/mes-demarches', categorie: 'droits',
    description: 'Faire une simulation ou une démarche auprès de la Caf (logement, prime d’activité, famille…).' },
  { id: '1jeune1solution', titre: 'Mes aides financières (1jeune1solution)', url: 'https://www.1jeune1solution.gouv.fr/mes-aides', categorie: 'jeunes',
    description: 'Pour les jeunes : trouver les aides financières qui correspondent à votre situation.' },
  { id: 'logement-social', titre: 'Demande de logement social en ligne', url: 'https://www.demande-logement-social.gouv.fr/', categorie: 'logement',
    description: 'Déposer, compléter ou renouveler une demande de logement social.' },
  { id: 'mes-aides-reno', titre: 'Mes aides réno', url: 'https://mesaides.france-renov.gouv.fr/', categorie: 'logement',
    description: 'Simulateur officiel des aides pour rénover un logement (chauffage, isolation…).' },
  { id: 'c2s', titre: 'Complémentaire santé solidaire (ameli)', url: 'https://www.ameli.fr/assure/droits-demarches/difficultes-acces-droits-soins/complementaire-sante/complementaire-sante-solidaire', categorie: 'santé',
    description: 'Comprendre la Complémentaire santé solidaire et la demander auprès de l’Assurance maladie.' },
  { id: 'info-retraite', titre: 'Info Retraite', url: 'https://www.info-retraite.fr/portail-info/home.html', categorie: 'retraite',
    description: 'Consulter votre relevé de carrière et estimer le montant de votre retraite.' },
  { id: 'aide-juridictionnelle', titre: 'Aide juridictionnelle en ligne', url: 'https://www.aidejuridictionnelle.justice.fr/', categorie: 'justice',
    description: 'Demander une aide pour payer les frais d’avocat ou de justice.' },
  { id: 'ants', titre: 'ANTS — titres d’identité et permis', url: 'https://ants.gouv.fr/', categorie: 'papiers',
    description: 'Démarches en ligne pour la carte d’identité, le passeport, le permis de conduire et la carte grise.' },
  { id: 'annuaire-administration', titre: 'Annuaire de l’administration', url: 'https://lannuaire.service-public.gouv.fr/', categorie: 'orientation',
    description: 'Trouver l’adresse, le téléphone et les horaires d’un service public.' },
];
