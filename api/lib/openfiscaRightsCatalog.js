/**
 * Rights catalog — defines which OpenFisca output variables we track,
 * with labels, explanations, FALC texts, and CTA links.
 *
 * Variable names verified via GET https://api.fr.openfisca.org/latest/variable/{name}:
 *   rsa      → famille / MONTH / Float  — "Revenu de solidarité active"
 *   ppa      → famille / MONTH / Float  — "Prime d'activité" (NOT "prime_activite")
 *   apl      → famille / MONTH / Float  — "Aide personnalisée au logement"
 *   aide_logement → famille / MONTH / Float — "Aide au logement (tout type)"
 */

export const RIGHTS_CATALOG = [
    {
        code: 'rsa',
        variable: 'rsa',
        label: 'RSA (Revenu de solidarité active)',
        category: 'minimum_social',
        explainEligible:
            "D'après votre situation, vous pourriez bénéficier du RSA. " +
            "Ce revenu minimum est versé mensuellement par la CAF ou la MSA. " +
            "Le montant dépend de votre composition familiale et de vos revenus.",
        explainNotEligible:
            'Vos revenus actuels dépassent le plafond du RSA, ou votre situation ' +
            'ne correspond pas aux critères (âge, résidence, etc.).',
        explainFalcEligible:
            '📋 Résumé\n' +
            "Le RSA, c'est de l'argent versé chaque mois pour vous aider à vivre.\n\n" +
            '👤 Pour qui ?\n' +
            '• Vous avez plus de 25 ans (ou plus de 18 ans avec un enfant).\n' +
            '• Vous habitez en France.\n' +
            "• Vous n'avez pas ou peu de revenus.\n\n" +
            '💶 Ce que ça apporte\n' +
            "Un montant d'argent versé chaque mois sur votre compte.\n" +
            'Le montant dépend de votre situation familiale.\n\n' +
            '📝 Comment faire ?\n' +
            '1. Allez sur le site de la CAF (caf.fr) ou rendez-vous dans votre CAF.\n' +
            '2. Remplissez le formulaire de demande de RSA.\n' +
            "3. Envoyez les documents demandés (pièce d'identité, justificatif de domicile, relevés bancaires).\n" +
            '4. La CAF étudie votre dossier et vous répond.\n\n' +
            '📎 Documents nécessaires\n' +
            "• Pièce d'identité\n" +
            '• Justificatif de domicile\n' +
            '• Relevés bancaires des 3 derniers mois\n' +
            "• Justificatifs de revenus (si vous en avez)\n\n" +
            '🔗 Liens officiels\n' +
            '• https://www.service-public.fr/particuliers/vosdroits/N19775\n' +
            '• https://www.caf.fr',
        explainFalcNotEligible:
            '📋 Résumé\n' +
            "D'après vos informations, vous ne pouvez probablement pas recevoir le RSA.\n\n" +
            '❓ Pourquoi ?\n' +
            '• Vos revenus sont trop élevés.\n' +
            "• Ou votre situation ne remplit pas les conditions (âge, résidence…).\n\n" +
            '💡 Que faire ?\n' +
            "• Si votre situation change, vous pouvez refaire le calcul.\n" +
            '• Vous pouvez aussi aller à la CAF pour vérifier avec un conseiller.',
        nextSteps: [
            { type: 'aide', slug: 'rsa' },
            { type: 'demarche', slug: 'demande-rsa' },
        ],
    },
    {
        code: 'prime_activite',
        variable: 'ppa',
        label: "Prime d'activité",
        category: 'complement_revenus',
        explainEligible:
            "Vous pourriez bénéficier de la Prime d'activité. " +
            "Ce complément de revenus est versé par la CAF aux travailleurs aux revenus modestes. " +
            'Son montant dépend de vos revenus professionnels et de votre situation familiale.',
        explainNotEligible:
            "Vos revenus sont en dehors de la fourchette d'éligibilité à la Prime d'activité, " +
            'ou votre statut ne correspond pas (ex. étudiant sans activité suffisante).',
        explainFalcEligible:
            '📋 Résumé\n' +
            "La Prime d'activité, c'est de l'argent en plus chaque mois " +
            'pour les personnes qui travaillent mais ne gagnent pas beaucoup.\n\n' +
            '👤 Pour qui ?\n' +
            '• Vous avez plus de 18 ans.\n' +
            '• Vous travaillez (salarié, indépendant, apprenti…).\n' +
            "• Vos revenus ne dépassent pas un certain montant.\n\n" +
            '💶 Ce que ça apporte\n' +
            'Un complément de revenus versé chaque mois par la CAF.\n' +
            'Le montant dépend de vos revenus et de votre famille.\n\n' +
            '📝 Comment faire ?\n' +
            '1. Allez sur le site de la CAF (caf.fr).\n' +
            "2. Faites d'abord une simulation pour savoir si vous y avez droit.\n" +
            '3. Si oui, remplissez la demande en ligne.\n' +
            "4. Envoyez vos justificatifs de revenus.\n" +
            '5. La CAF vous répond sous quelques semaines.\n\n' +
            '📎 Documents nécessaires\n' +
            "• Pièce d'identité\n" +
            '• Bulletins de salaire des 3 derniers mois\n' +
            "• Déclaration trimestrielle de ressources\n\n" +
            '🔗 Liens officiels\n' +
            '• https://www.service-public.fr/particuliers/vosdroits/F2882\n' +
            '• https://www.caf.fr',
        explainFalcNotEligible:
            '📋 Résumé\n' +
            "D'après vos informations, vous ne pouvez probablement pas recevoir " +
            "la Prime d'activité.\n\n" +
            '❓ Pourquoi ?\n' +
            '• Vos revenus sont trop élevés ou trop bas.\n' +
            "• Ou vous n'avez pas d'activité professionnelle.\n\n" +
            '💡 Que faire ?\n' +
            '• Si vous commencez à travailler, refaites le calcul.\n' +
            '• Vous pouvez aussi faire une simulation sur caf.fr.',
        nextSteps: [
            { type: 'aide', slug: 'prime-activite' },
            { type: 'demarche', slug: 'demande-prime-activite' },
        ],
    },
    {
        code: 'apl',
        variable: 'apl',
        label: 'APL (Aide personnalisée au logement)',
        category: 'logement',
        explainEligible:
            "Vous pourriez bénéficier de l'APL. Cette aide réduit le montant de votre loyer. " +
            'Elle est versée directement à votre bailleur ou sur votre compte par la CAF.',
        explainNotEligible:
            "L'APL ne semble pas applicable à votre situation. " +
            'Cela peut dépendre du type de logement, de vos revenus ou de votre statut.',
        explainFalcEligible:
            '📋 Résumé\n' +
            "L'APL, c'est une aide pour payer moins cher votre loyer.\n" +
            'La CAF vous verse cette aide chaque mois.\n\n' +
            '👤 Pour qui ?\n' +
            '• Vous êtes locataire.\n' +
            '• Votre logement est conventionné (surtout les HLM).\n' +
            "• Vos revenus ne dépassent pas un certain montant.\n\n" +
            '💶 Ce que ça apporte\n' +
            'Une partie de votre loyer est payée par la CAF.\n' +
            "L'aide peut être versée directement au propriétaire ou sur votre compte.\n\n" +
            '📝 Comment faire ?\n' +
            '1. Allez sur le site de la CAF (caf.fr).\n' +
            "2. Faites une simulation pour savoir combien vous pouvez recevoir.\n" +
            '3. Remplissez la demande en ligne sur votre espace personnel CAF.\n' +
            '4. Donnez votre bail (contrat de location) et vos revenus.\n' +
            '5. La CAF vous répond et commence à verser si vous y avez droit.\n\n' +
            '📎 Documents nécessaires\n' +
            "• Pièce d'identité\n" +
            '• Contrat de location (bail)\n' +
            '• Attestation de loyer (remplie par le propriétaire)\n' +
            "• Justificatifs de revenus\n\n" +
            '🔗 Liens officiels\n' +
            '• https://www.service-public.fr/particuliers/vosdroits/F12006\n' +
            '• https://www.caf.fr',
        explainFalcNotEligible:
            '📋 Résumé\n' +
            "D'après vos informations, vous ne pouvez probablement pas recevoir l'APL.\n\n" +
            '❓ Pourquoi ?\n' +
            "• Votre logement n'est peut-être pas conventionné.\n" +
            '• Ou vos revenus sont trop élevés.\n\n' +
            '💡 Que faire ?\n' +
            "• Vérifiez si votre logement est conventionné auprès de votre propriétaire.\n" +
            "• Vous avez peut-être droit à une autre aide au logement (ALS ou ALF).\n" +
            '• Faites une simulation sur caf.fr.',
        nextSteps: [
            { type: 'aide', slug: 'apl' },
            { type: 'demarche', slug: 'demande-aide-logement' },
        ],
    },
    {
        code: 'aide_logement',
        variable: 'aide_logement',
        label: 'Aide au logement (tous types)',
        category: 'logement',
        explainEligible:
            "Vous pourriez bénéficier d'une aide au logement (APL, ALS ou ALF selon votre situation). " +
            'Cette aide réduit votre charge de loyer.',
        explainNotEligible:
            "Aucune aide au logement ne semble applicable à votre situation actuelle.",
        explainFalcEligible:
            '📋 Résumé\n' +
            "Vous pouvez peut-être recevoir une aide pour payer votre logement.\n" +
            "Il existe 3 types d'aides : APL, ALS, ALF. La CAF choisit celle qui vous convient.\n\n" +
            '👤 Pour qui ?\n' +
            '• Vous êtes locataire ou vous remboursez un prêt pour votre logement.\n' +
            '• Vous habitez en France.\n' +
            "• Vos revenus ne dépassent pas un certain montant.\n\n" +
            '💶 Ce que ça apporte\n' +
            'La CAF paie une partie de votre loyer ou de votre prêt chaque mois.\n\n' +
            '📝 Comment faire ?\n' +
            '1. Allez sur le site de la CAF (caf.fr).\n' +
            '2. Faites une simulation pour connaître votre aide.\n' +
            '3. Créez votre espace personnel si vous ne l\'avez pas encore.\n' +
            '4. Remplissez la demande en ligne.\n' +
            "5. Envoyez votre bail et vos justificatifs.\n\n" +
            '📎 Documents nécessaires\n' +
            "• Pièce d'identité\n" +
            '• Contrat de location (bail) ou offre de prêt\n' +
            '• Attestation de loyer\n' +
            "• Justificatifs de revenus\n\n" +
            '🔗 Liens officiels\n' +
            '• https://www.service-public.fr/particuliers/vosdroits/N20360\n' +
            '• https://www.caf.fr',
        explainFalcNotEligible:
            '📋 Résumé\n' +
            "D'après vos informations, vous ne pouvez probablement pas " +
            "recevoir d'aide au logement.\n\n" +
            '❓ Pourquoi ?\n' +
            '• Vos revenus sont peut-être trop élevés.\n' +
            "• Ou votre situation de logement ne correspond pas aux critères.\n\n" +
            '💡 Que faire ?\n' +
            '• Si votre situation change, refaites le calcul.\n' +
            '• Vous pouvez aussi demander conseil à la CAF.',
        nextSteps: [
            { type: 'aide', slug: 'aide-logement' },
        ],
    },
    {
        code: 'aspa',
        variable: 'aspa',
        label: 'ASPA (Allocation de solidarité aux personnes âgées)',
        category: 'minimum_social',
        explainEligible:
            "D'après votre situation, vous pourriez bénéficier de l'ASPA. " +
            "Cette allocation garantit un revenu minimum aux personnes âgées de 65 ans et plus. " +
            'Elle est versée par la caisse de retraite (CARSAT, MSA).',
        explainNotEligible:
            "L'ASPA ne semble pas applicable à votre situation. " +
            "Cela peut dépendre de votre âge, de vos revenus ou de votre résidence.",
        explainFalcEligible:
            '📋 Résumé\n' +
            "L'ASPA, c'est de l'argent versé chaque mois aux personnes âgées " +
            'qui ont peu de revenus.\n\n' +
            '👤 Pour qui ?\n' +
            '• Vous avez 65 ans ou plus.\n' +
            '• Vous habitez en France de façon stable.\n' +
            '• Vos revenus sont en dessous d\'un certain montant.\n\n' +
            '💶 Ce que ça apporte\n' +
            'Un complément de revenus versé chaque mois.\n' +
            'Le montant maximum est d\'environ 1 012 € par mois pour une personne seule (2026).\n\n' +
            '📝 Comment faire ?\n' +
            '1. Contactez votre caisse de retraite (CARSAT ou MSA).\n' +
            '2. Remplissez le formulaire de demande d\'ASPA.\n' +
            '3. Joignez vos justificatifs de revenus et de résidence.\n' +
            '4. La caisse étudie votre dossier et vous répond.\n\n' +
            '📎 Documents nécessaires\n' +
            '• Pièce d\'identité\n' +
            '• Justificatif de domicile\n' +
            '• Dernier avis d\'imposition\n' +
            '• Relevés de pensions\n\n' +
            '🔗 Liens officiels\n' +
            '• https://www.service-public.fr/particuliers/vosdroits/F16871\n' +
            '• https://www.lassuranceretraite.fr',
        explainFalcNotEligible:
            '📋 Résumé\n' +
            "D'après vos informations, vous ne pouvez probablement pas recevoir l'ASPA.\n\n" +
            '❓ Pourquoi ?\n' +
            '• Vous n\'avez peut-être pas encore 65 ans.\n' +
            '• Ou vos revenus dépassent le plafond.\n\n' +
            '💡 Que faire ?\n' +
            '• Quand vous aurez 65 ans, refaites le calcul.\n' +
            '• Contactez votre caisse de retraite pour vérifier.',
        nextSteps: [
            { type: 'aide', slug: 'aspa' },
            { type: 'demarche', slug: 'demande-aspa' },
        ],
    },
    {
        code: 'ass',
        variable: 'ass',
        label: 'ASS (Allocation de solidarité spécifique)',
        category: 'chomage',
        explainEligible:
            "D'après votre situation, vous pourriez bénéficier de l'ASS. " +
            "Cette allocation est versée aux demandeurs d'emploi qui ont épuisé " +
            "leurs droits à l'allocation chômage (ARE).",
        explainNotEligible:
            "L'ASS ne semble pas applicable à votre situation. " +
            "Elle est réservée aux demandeurs d'emploi en fin de droits ayant une activité antérieure suffisante.",
        explainFalcEligible:
            '📋 Résumé\n' +
            "L'ASS, c'est de l'argent versé chaque mois quand vous n'avez plus " +
            "droit au chômage (ARE).\n\n" +
            '👤 Pour qui ?\n' +
            "• Vous êtes inscrit à France Travail (ex-Pôle emploi).\n" +
            "• Vous n'avez plus droit à l'allocation chômage.\n" +
            "• Vous avez travaillé au moins 5 ans dans les 10 dernières années.\n" +
            '• Vos revenus sont faibles.\n\n' +
            '💶 Ce que ça apporte\n' +
            "Un montant d'environ 18,17 € par jour (2026).\n" +
            "L'aide est versée tous les mois.\n\n" +
            '📝 Comment faire ?\n' +
            '1. Restez inscrit à France Travail.\n' +
            "2. Quand vos droits ARE se terminent, France Travail vous propose l'ASS.\n" +
            '3. Remplissez le formulaire de demande.\n' +
            '4. Envoyez vos justificatifs de revenus.\n\n' +
            '📎 Documents nécessaires\n' +
            "• Pièce d'identité\n" +
            "• Attestation d'inscription à France Travail\n" +
            '• Justificatifs de revenus du foyer\n' +
            "• Avis d'imposition\n\n" +
            '🔗 Liens officiels\n' +
            '• https://www.service-public.fr/particuliers/vosdroits/F12484\n' +
            '• https://www.francetravail.fr',
        explainFalcNotEligible:
            '📋 Résumé\n' +
            "D'après vos informations, vous ne pouvez probablement pas recevoir l'ASS.\n\n" +
            '❓ Pourquoi ?\n' +
            "• Vous avez peut-être encore droit au chômage (ARE).\n" +
            "• Ou vous n'avez pas travaillé assez longtemps.\n" +
            '• Ou vos revenus dépassent le plafond.\n\n' +
            '💡 Que faire ?\n' +
            '• Contactez France Travail pour connaître vos droits.\n' +
            "• Si votre situation change, refaites le calcul.",
        nextSteps: [
            { type: 'aide', slug: 'ass' },
            { type: 'demarche', slug: 'demande-ass' },
        ],
    },
    {
        code: 'aah',
        variable: 'aah',
        label: 'AAH (Allocation aux adultes handicapés)',
        category: 'handicap',
        explainEligible:
            "D'après votre situation, vous pourriez bénéficier de l'AAH. " +
            "Cette allocation garantit un revenu minimum aux personnes en situation de handicap. " +
            "Elle est versée par la CAF ou la MSA.",
        explainNotEligible:
            "L'AAH ne semble pas applicable à votre situation actuelle. " +
            "Elle nécessite une reconnaissance du handicap par la MDPH.",
        explainFalcEligible:
            '📋 Résumé\n' +
            "L'AAH, c'est de l'argent versé chaque mois aux personnes " +
            "qui ont un handicap.\n\n" +
            '👤 Pour qui ?\n' +
            "• Vous avez un handicap reconnu par la MDPH (taux d'incapacité ≥ 80%, " +
            "ou entre 50% et 79% avec une restriction d'accès à l'emploi).\n" +
            '• Vous avez 20 ans ou plus.\n' +
            '• Vous habitez en France.\n' +
            '• Vos revenus ne dépassent pas un certain montant.\n\n' +
            '💶 Ce que ça apporte\n' +
            "Un montant maximum d'environ 1 016 € par mois (2026).\n" +
            'Le montant dépend de vos revenus.\n\n' +
            '📝 Comment faire ?\n' +
            '1. Faites une demande à la MDPH de votre département.\n' +
            "2. La MDPH évalue votre taux d'incapacité.\n" +
            "3. Si votre taux est suffisant, demandez l'AAH à la CAF.\n" +
            '4. La CAF verse le montant chaque mois.\n\n' +
            '📎 Documents nécessaires\n' +
            "• Certificat médical MDPH (formulaire Cerfa n°15695*01)\n" +
            "• Formulaire de demande MDPH (Cerfa n°15692*01)\n" +
            "• Pièce d'identité\n" +
            '• Justificatif de domicile\n' +
            "• Avis d'imposition\n\n" +
            '🔗 Liens officiels\n' +
            '• https://www.service-public.fr/particuliers/vosdroits/F12242\n' +
            '• https://www.monparcourshandicap.gouv.fr',
        explainFalcNotEligible:
            '📋 Résumé\n' +
            "D'après vos informations, vous ne pouvez probablement pas recevoir l'AAH.\n\n" +
            '❓ Pourquoi ?\n' +
            "• Votre handicap n'est peut-être pas reconnu par la MDPH.\n" +
            '• Ou vos revenus dépassent le plafond.\n\n' +
            '💡 Que faire ?\n' +
            '• Contactez la MDPH de votre département.\n' +
            "• Demandez une évaluation de votre taux d'incapacité.\n" +
            '• Si vous avez déjà une reconnaissance MDPH, refaites le calcul.',
        nextSteps: [
            { type: 'aide', slug: 'aah' },
            { type: 'demarche', slug: 'demande-aah' },
        ],
    },
    {
        code: 'af',
        variable: 'af',
        label: 'Allocations familiales',
        category: 'FAMILLE',
        explainEligible: "Vous pouvez bénéficier des allocations familiales.",
        explainNotEligible: "Vous ne semblez pas éligible aux allocations familiales.",
        explainFalcEligible: "Vous pouvez avoir les allocations familiales. C'est une aide pour les familles avec au moins 2 enfants.",
        explainFalcNotEligible: "Vous ne pouvez pas avoir les allocations familiales pour le moment.",
        nextSteps: [
            "Connectez-vous à votre espace CAF",
            "Vérifiez votre situation familiale",
            "Faites votre demande en ligne sur caf.fr"
        ]
    },
    {
        code: 'cf',
        variable: 'cf',
        label: 'Complément familial',
        category: 'FAMILLE',
        explainEligible: "Vous pouvez bénéficier du complément familial.",
        explainNotEligible: "Vous ne semblez pas éligible au complément familial.",
        explainFalcEligible: "Vous pouvez avoir le complément familial. C'est une aide pour les familles avec au moins 3 enfants.",
        explainFalcNotEligible: "Vous ne pouvez pas avoir le complément familial pour le moment.",
        nextSteps: [
            "Connectez-vous à votre espace CAF",
            "Vérifiez votre situation familiale"
        ]
    },
    {
        code: 'asf',
        variable: 'asf',
        label: "Allocation de soutien familial",
        category: 'FAMILLE',
        explainEligible: "Vous pouvez bénéficier de l'allocation de soutien familial.",
        explainNotEligible: "Vous ne semblez pas éligible à l'allocation de soutien familial.",
        explainFalcEligible: "Vous pouvez avoir l'allocation de soutien familial. C'est une aide pour élever seul un enfant.",
        explainFalcNotEligible: "Vous ne pouvez pas avoir l'allocation de soutien familial pour le moment.",
        nextSteps: [
            "Contactez votre CAF",
            "Préparez vos justificatifs de situation familiale"
        ]
    },
    {
        code: 'bourse_college',
        variable: 'bourse_college',
        label: 'Bourse de collège',
        category: 'ETUDES',
        explainEligible: "Votre enfant peut bénéficier d'une bourse de collège.",
        explainNotEligible: "Votre enfant ne semble pas éligible à la bourse de collège.",
        explainFalcEligible: "Votre enfant peut avoir une bourse pour le collège. C'est une aide pour payer l'école.",
        explainFalcNotEligible: "Votre enfant ne peut pas avoir la bourse de collège pour le moment.",
        nextSteps: [
            "Faites la demande via le portail Scolarité-Services",
            "Vérifiez les plafonds de revenus"
        ]
    },
    {
        code: 'css',
        variable: 'css_participation_forfaitaire',
        label: 'Complémentaire santé solidaire',
        category: 'SANTE',
        explainEligible: "Vous pouvez bénéficier de la complémentaire santé solidaire.",
        explainNotEligible: "Vous ne semblez pas éligible à la complémentaire santé solidaire.",
        explainFalcEligible: "Vous pouvez avoir la complémentaire santé solidaire. C'est une aide pour payer vos soins de santé.",
        explainFalcNotEligible: "Vous ne pouvez pas avoir la complémentaire santé solidaire pour le moment.",
        nextSteps: [
            "Faites votre demande sur ameli.fr",
            "Contactez votre CPAM"
        ]
    }
];

/** Get variables list for OpenFisca output */
export function getOutputVariables() {
    return RIGHTS_CATALOG.map((r) => r.variable);
}

export default { RIGHTS_CATALOG, getOutputVariables };
