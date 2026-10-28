/**
 * Glossaire des aides sociales françaises.
 *
 * Source statique — 20 termes courants.
 * Utilisé par l'API /api/glossaire et la recherche.
 */
export const GLOSSAIRE = [
  {
    terme: 'AAH',
    definition: "Allocation aux Adultes Handicapés. Aide financière pour les personnes en situation de handicap avec un taux d'incapacité d'au moins 80% (ou 50 à 79% avec restriction d'accès à l'emploi).",
    categorie: 'HANDICAP',
    lien: '/aides?category=handicap',
  },
  {
    terme: 'APA',
    definition: "Allocation Personnalisée d'Autonomie. Aide pour les personnes âgées de 60 ans et plus en perte d'autonomie (GIR 1 à 4).",
    categorie: 'SANTE',
    lien: '/aides?category=sante',
  },
  {
    terme: 'APL',
    definition: 'Aide Personnalisée au Logement. Aide pour réduire le montant du loyer ou de la mensualité de prêt immobilier.',
    categorie: 'LOGEMENT',
    lien: '/aides?category=logement',
  },
  {
    terme: 'ARE',
    definition: "Allocation de Retour à l'Emploi. Indemnisation chômage versée par France Travail (ex-Pôle emploi) aux demandeurs d'emploi.",
    categorie: 'EMPLOI',
    lien: '/aides?category=emploi',
  },
  {
    terme: 'ASS',
    definition: "Allocation de Solidarité Spécifique. Pour les demandeurs d'emploi en fin de droits ayant travaillé au moins 5 ans.",
    categorie: 'EMPLOI',
    lien: '/aides?category=emploi',
  },
  {
    terme: 'CAF',
    definition: "Caisse d'Allocations Familiales. Organisme qui verse les prestations sociales (APL, RSA, allocations familiales, etc.).",
    categorie: 'FAMILLE',
    lien: '/structures?type=CAF',
  },
  {
    terme: 'CCAS',
    definition: "Centre Communal d'Action Sociale. Service municipal d'aide sociale qui accompagne les habitants en difficulté.",
    categorie: 'ACCOMPAGNEMENT',
    lien: '/structures?type=CCAS',
  },
  {
    terme: 'CMU-C',
    definition: 'Couverture Maladie Universelle Complémentaire. Ancienne mutuelle gratuite pour les revenus modestes, remplacée par la CSS.',
    categorie: 'SANTE',
    lien: '/aides?category=sante',
  },
  {
    terme: 'CPAM',
    definition: "Caisse Primaire d'Assurance Maladie. Organisme local de sécurité sociale (remboursements, carte Vitale).",
    categorie: 'SANTE',
    lien: '/structures?type=CPAM',
  },
  {
    terme: 'CSS',
    definition: 'Complémentaire Santé Solidaire. Mutuelle gratuite ou à 1€/jour pour les personnes aux revenus modestes.',
    categorie: 'SANTE',
    lien: '/aides?category=sante',
  },
  {
    terme: 'DALO',
    definition: "Droit Au Logement Opposable. Recours juridique pour obtenir un logement quand toutes les démarches classiques ont échoué.",
    categorie: 'LOGEMENT',
    lien: '/aides?category=logement',
  },
  {
    terme: 'FALC',
    definition: "Facile à Lire et à Comprendre. Méthode de rédaction qui rend l'information accessible à tous, y compris aux personnes en situation de handicap intellectuel.",
    categorie: 'ACCESSIBILITE',
  },
  {
    terme: 'FSL',
    definition: "Fonds de Solidarité pour le Logement. Aide départementale pour payer le dépôt de garantie, les impayés de loyer ou les factures d'énergie.",
    categorie: 'LOGEMENT',
    lien: '/aides?category=logement',
  },
  {
    terme: 'Garantie Visale',
    definition: "Caution locative gratuite proposée par Action Logement. Elle garantit le paiement du loyer au propriétaire en cas d'impayé.",
    categorie: 'LOGEMENT',
    lien: '/aides?category=logement',
  },
  {
    terme: 'MaPrimeRénov',
    definition: "Aide de l'État pour financer les travaux de rénovation énergétique du logement (isolation, chauffage, ventilation).",
    categorie: 'ENERGIE',
    lien: '/aides?category=energie',
  },
  {
    terme: 'MDPH',
    definition: 'Maison Départementale des Personnes Handicapées. Guichet unique pour faire reconnaître un handicap et obtenir des droits (AAH, RQTH, PCH).',
    categorie: 'HANDICAP',
    lien: '/structures?type=MDPH',
  },
  {
    terme: 'PAJE',
    definition: "Prestation d'Accueil du Jeune Enfant. Ensemble d'aides versées par la CAF pour les parents de jeunes enfants (prime de naissance, allocation de base, CMG).",
    categorie: 'FAMILLE',
    lien: '/aides?category=famille',
  },
  {
    terme: 'Prime d\'activité',
    definition: 'Complément de revenus mensuel pour les travailleurs aux revenus modestes (salariés et indépendants). Versée par la CAF.',
    categorie: 'EMPLOI',
    lien: '/aides?category=emploi',
  },
  {
    terme: 'RQTH',
    definition: "Reconnaissance de la Qualité de Travailleur Handicapé. Statut délivré par la MDPH qui ouvre des droits à l'emploi et à la formation.",
    categorie: 'HANDICAP',
    lien: '/aides?category=handicap',
  },
  {
    terme: 'RSA',
    definition: "Revenu de Solidarité Active. Revenu minimum garanti pour les personnes sans ressources ou aux revenus très faibles, à partir de 25 ans (ou dès 18 ans sous conditions).",
    categorie: 'EMPLOI',
    lien: '/aides?category=emploi',
  },
];
