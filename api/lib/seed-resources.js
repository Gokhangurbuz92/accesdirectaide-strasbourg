/**
 * Seed resources — contenu initial fiable (sources gouvernementales uniquement).
 *
 * Ce fichier fournit les premières ressources pour peupler les pages
 * /ressources, /bonnes-pratiques, /outils, /dispositifs.
 */

export const INITIAL_RESOURCES = [
    // === RESSOURCES ===
    {
        type: 'RESSOURCE',
        category: 'LOGEMENT',
        title: 'Guide du locataire',
        description: 'Vos droits et démarches pour le logement : bail, état des lieux, charges, préavis.',
        url: 'https://www.service-public.fr/particuliers/vosdroits/N19808',
        source: 'service-public.fr',
    },
    {
        type: 'RESSOURCE',
        category: 'EMPLOI',
        title: 'Vos droits au chômage',
        description: "Conditions et démarches pour les allocations chômage. Inscription, indemnisation, reprise d'activité.",
        url: 'https://www.service-public.fr/particuliers/vosdroits/N178',
        source: 'service-public.fr',
    },
    {
        type: 'RESSOURCE',
        category: 'HANDICAP',
        title: 'Droits des personnes handicapées',
        description: 'AAH, RQTH, carte mobilité inclusion, aménagement du logement et du poste de travail.',
        url: 'https://www.service-public.fr/particuliers/vosdroits/N12230',
        source: 'service-public.fr',
    },
    {
        type: 'RESSOURCE',
        category: 'FAMILLE',
        title: 'Prestations familiales',
        description: 'Allocations familiales, PAJE, complément de libre choix, allocation de rentrée scolaire.',
        url: 'https://www.service-public.fr/particuliers/vosdroits/N156',
        source: 'service-public.fr',
    },

    // === OUTILS ===
    {
        type: 'OUTIL',
        category: 'AIDES',
        title: 'Simulateur mes droits sociaux',
        description: 'Estimez vos droits à 30+ aides sociales en quelques minutes.',
        url: 'https://www.mesdroitssociaux.gouv.fr',
        source: 'mesdroitssociaux.gouv.fr',
    },
    {
        type: 'OUTIL',
        category: 'LOGEMENT',
        title: 'Simulateur APL',
        description: "Calculez votre aide au logement (APL, ALS, ALF) selon votre situation.",
        url: 'https://www.caf.fr/allocataires/mes-services-en-ligne/estimer-vos-droits',
        source: 'caf.fr',
    },
    {
        type: 'OUTIL',
        category: 'SANTE',
        title: 'Simulateur Complémentaire santé solidaire',
        description: 'Vérifiez si vous pouvez bénéficier de la CSS (ex-CMU-C).',
        url: 'https://www.ameli.fr/assure/droits-demarches/difficultes-acces-droits-soins/complementaire-sante-solidaire',
        source: 'ameli.fr',
    },

    // === DISPOSITIFS ===
    {
        type: 'DISPOSITIF',
        category: 'EMPLOI',
        title: 'France Travail',
        description: "Accompagnement vers l'emploi : offres, formation, conseils personnalisés.",
        url: 'https://www.francetravail.fr',
        source: 'francetravail.fr',
    },
    {
        type: 'DISPOSITIF',
        category: 'JEUNES',
        title: '1jeune1solution',
        description: 'Emploi, alternance, formation, accompagnement pour les jeunes de 16 à 30 ans.',
        url: 'https://www.1jeune1solution.gouv.fr',
        source: '1jeune1solution.gouv.fr',
    },
    {
        type: 'DISPOSITIF',
        category: 'ENERGIE',
        title: 'MaPrimeRénov',
        description: 'Aide pour la rénovation énergétique de votre logement. Isolation, chauffage, ventilation.',
        url: 'https://www.maprimerenov.gouv.fr',
        source: 'maprimerenov.gouv.fr',
    },

    // === BONNES PRATIQUES ===
    {
        type: 'BONNE_PRATIQUE',
        category: 'ACCOMPAGNEMENT',
        title: 'Guide accueil premier rendez-vous',
        description: 'Comment accueillir un bénéficiaire lors du premier RDV : écoute active, identification des besoins, orientation.',
        source: 'Accès Direct Aide',
        content: '1. Accueil chaleureux et bienveillant\n2. Écoute active sans jugement\n3. Identification des besoins prioritaires\n4. Orientation vers les aides adaptées\n5. Planification du suivi',
    },
    {
        type: 'BONNE_PRATIQUE',
        category: 'ACCOMPAGNEMENT',
        title: 'Évaluation globale de la situation',
        description: 'Méthode pour évaluer la situation complète du bénéficiaire : logement, emploi, santé, famille.',
        source: 'Accès Direct Aide',
        content: '1. Situation administrative (papiers, droits ouverts)\n2. Logement (hébergé, locataire, SDF)\n3. Emploi (en activité, demandeur, en formation)\n4. Santé (couverture, suivi médical)\n5. Famille (enfants, isolement)\n6. Budget (dettes, revenus)',
    },
];
