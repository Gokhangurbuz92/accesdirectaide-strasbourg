/**
 * R45 (ENG-LR-5) — draft legal documents: citizen terms, professional terms, structure conditions, privacy notice (GDPR art. 13 and 14), and the
 * A-I / A-II variant of the legal notice (ENG-LR-4). French is the authoritative text (keys of the « legaldraft » namespace; the five other languages
 * are translations, labelled as such). The French masters with the owner approval box are in STRASBOURG_FULL_PRODUCT_PLAN/CONTROL/r45/.
 *
 * STATUS: every document is DRAFT_PENDING_OWNER_APPROVAL. Nothing here is a final legal claim, a decision of the controller or a legal opinion.
 *  - Production build (VERCEL_ENV=production): a draft is neither linked nor shown, unless VITE_LEGAL_DOCS_APPROVED_VERSION names it
 *    (« id@version », or the bare version, comma-separated) — then it is in force.
 *  - Any other build with VITE_LEGAL_DRAFT_PREVIEW=1 (LAB): the drafts render with a visible « Projet — non approuvé » banner.
 *  - Otherwise: hidden (fail-closed). The existing in-force pages (/cgu, /politique-confidentialite, /mentions-legales) are not affected.
 * Proposed legal bases and retention periods come from CONTROL/r44/R44_DECISIONS_RGPD_D1_D6_FR_v2.md (annexes A and B), NOT approved (D2, D4).
 */

export const LEGAL_DRAFT_STATUS = Object.freeze({
  DRAFT_PENDING_OWNER_APPROVAL: 'DRAFT_PENDING_OWNER_APPROVAL',
});

/** the version shared by the R45 drafts; a change of any French text below needs a new version (the owner approves a version, not a file) */
export const LEGAL_DRAFTS_VERSION = 'v2-2026-11-09';   // V2 final candidate (09/11/2026): + security review D3/D6 (erasure on request, hashed counters, unactivated accounts 7 days). Release B (D2 V2, 08/11/2026): notice split V2 / later waves, A7 preference, no phone, Mailjet

/**
 * @typedef {{ id: string, title: string, paras?: string[], items?: string[], proposed?: boolean }} DraftSection
 * @typedef {{ id: string, key: string, path: string | null, version: string, status: string, title: string, intro: string, sections: DraftSection[] }} DraftDocument
 */

const V2_STATUS_NOTE = 'Cette notice décrit les traitements des comptes personnels (section 3). Les rendez-vous, les messages, les rappels et le partage de dossiers ne sont pas encore ouverts : leurs bases légales sont indiquées à titre de proposition (section 3 bis) et seront confirmées avant leur ouverture.';

/** @type {DraftDocument[]} */
export const LEGAL_DRAFT_DOCUMENTS = [
  {
    id: 'cgu-citoyen',
    key: 'cguCitoyen',
    path: '/cgu/citoyen',
    version: LEGAL_DRAFTS_VERSION,
    status: LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL,
    title: "Conditions d'utilisation — particuliers",
    intro: "Ces conditions s'appliquent à toute personne qui utilise AccesDirectAide pour elle-même, avec ou sans compte.",
    sections: [
      { id: 'operator', title: '1. Qui propose le service', paras: [
        "Le service est proposé par {{operator}}, personne physique, qui exploite AccesDirectAide à titre personnel et bénévole. Aucune association n'a été créée à ce jour.",
        'Contact : {{contact}}.',
      ] },
      { id: 'free', title: '2. Un service gratuit', paras: [
        "Le service est gratuit. Aucun paiement ne vous est demandé, ni par AccesDirectAide ni, par son intermédiaire, par une structure. Le site ne contient pas de publicité.",
      ] },
      { id: 'noDecision', title: "3. Ce que le service ne fait pas", paras: [
        "AccesDirectAide n'est pas un site de l'administration. Il vous aide à trouver une information, à vérifier si une aide peut vous concerner et à contacter une structure. Il ne prend aucune décision sur vos droits : seul l'organisme compétent (Caf, CPAM, France Travail, Collectivité européenne d'Alsace, CCAS…) décide.",
        "Les informations sont données à titre indicatif, avec leur source officielle et leur date. Elles peuvent changer : vérifiez-les auprès de la source indiquée.",
      ] },
      { id: 'ai', title: "4. L'assistant automatique", paras: [
        "L'assistant peut chercher, expliquer et proposer un brouillon. Il peut se tromper. Il ne donne pas de conseil juridique et ne décide de rien.",
        "N'y écrivez pas d'information sur votre santé, un handicap, votre situation administrative ou celle d'une autre personne.",
      ] },
      { id: 'account', title: '5. Votre compte', items: [
        'Un compte est nécessaire pour demander un rendez-vous.',
        'Vous devez avoir 18 ans ou plus pour créer un compte.',
        'Vous donnez des informations exactes et gardez votre mot de passe secret.',
        "Votre compte est personnel : n'agissez pas au nom d'une autre personne sans son accord.",
      ] },
      { id: 'appointments', title: '6. Les rendez-vous', paras: [
        "Une demande de rendez-vous n'est pas un rendez-vous confirmé. C'est la structure qui confirme, propose un autre créneau ou refuse. Elle peut aussi modifier ou annuler un rendez-vous ; vous en êtes informé dans votre espace.",
        "Vous pouvez annuler votre demande ou votre rendez-vous depuis votre espace. Prévenez le plus tôt possible.",
        "Chaque structure fixe ses propres règles d'accueil. AccesDirectAide ne garantit ni une place disponible ni l'attribution d'une aide.",
        "Le message joint à une demande est facultatif. Il n'est transmis qu'avec votre accord, que vous pouvez retirer à tout moment depuis votre espace.",
      ] },
      { id: 'use', title: '7. Utilisation correcte', items: [
        "Ne publiez ni n'envoyez de contenu illicite, injurieux ou qui porte atteinte à une autre personne.",
        "Ne cherchez pas à accéder aux données d'autrui ni à perturber le service.",
        "N'utilisez pas de programme pour extraire le contenu en masse ou pour réserver des créneaux.",
      ] },
      { id: 'deletion', title: '8. Supprimer votre compte', paras: [
        "Vous pouvez demander la suppression de votre compte à tout moment, depuis votre espace ou en écrivant à {{contact}}. Une personne vérifie la demande avant la suppression, pour éviter une erreur ou une usurpation.",
        "Certaines données peuvent être gardées pour une durée limitée quand une obligation ou la défense d'un droit l'exige ; la notice de confidentialité en donne la liste.",
        "En cas d'usage contraire à ces conditions, le compte peut être suspendu. Vous en êtes informé avec le motif, sauf urgence de sécurité, et vous pouvez présenter vos observations.",
      ] },
      { id: 'liability', title: '9. Responsabilité', paras: [
        "L'exploitant prend des moyens raisonnables pour que l'information soit exacte et le service disponible. Il ne peut pas garantir l'absence de toute erreur ni un fonctionnement sans interruption. Il corrige les erreurs signalées dans les meilleurs délais.",
        "Il n'est pas responsable des décisions des organismes et des structures, ni du contenu des sites extérieurs vers lesquels il renvoie.",
        "Il reste responsable de ses fautes dans les conditions prévues par la loi. Aucune clause de ces conditions ne réduit les droits que la loi vous reconnaît.",
      ] },
      { id: 'changes', title: '10. Évolution et fin du service', paras: [
        "Ces conditions peuvent évoluer. Chaque version est publiée avec sa date. Avant un changement important, les titulaires d'un compte sont informés et peuvent supprimer leur compte.",
        "Si le service s'arrête ou est repris par une autre personne, par exemple une association créée plus tard, les titulaires d'un compte sont informés à l'avance. Aucune donnée n'est transmise sans information préalable.",
      ] },
      { id: 'law', title: '11. Droit applicable et litiges', paras: [
        "Ces conditions sont soumises au droit français. En cas de difficulté, écrivez d'abord à {{contact}} : une solution amiable est recherchée.",
        "Médiation de la consommation : son application à un service gratuit édité par un particulier, hors de toute activité professionnelle, est à vérifier. Aucun médiateur n'est désigné à ce jour.",
        'À défaut de solution amiable, vous pouvez saisir la juridiction compétente selon les règles de droit commun.',
        'La version française de ces conditions est la seule juridiquement de référence ; les traductions sont une aide à la compréhension.',
      ] },
    ],
  },
  {
    id: 'cgu-professionnel',
    key: 'cguPro',
    path: '/cgu/professionnel',
    version: LEGAL_DRAFTS_VERSION,
    status: LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL,
    title: "Conditions d'utilisation — professionnels",
    intro: "Ces conditions s'appliquent aux professionnels qui utilisent un compte ADA Pro créé à l'invitation de leur structure.",
    sections: [
      { id: 'operator', title: '1. Qui propose le service', paras: [
        "Le service est proposé par {{operator}}, personne physique, qui exploite AccesDirectAide à titre personnel et bénévole. Aucune association n'a été créée à ce jour. Contact : {{contact}}.",
        "Le service est gratuit pour les professionnels et pour leur structure. Rien n'est facturé.",
      ] },
      { id: 'account', title: '2. Votre compte professionnel', items: [
        "Le compte est créé sur invitation de votre structure. Il est personnel : ne le partagez pas.",
        "La double authentification est obligatoire. Gardez vos moyens de connexion secrets.",
        "Votre structure gère les accès de son équipe et désactive votre compte quand vous la quittez.",
      ] },
      { id: 'use', title: '3. Utilisation au service des personnes', items: [
        "Utilisez le compte seulement pour les missions de votre structure.",
        "N'ouvrez les informations d'une personne que lorsque c'est nécessaire à sa demande.",
        "Ne copiez pas ces informations hors des outils prévus par votre structure.",
        "Respectez le secret professionnel et les règles de votre structure.",
        "N'écrivez pas de donnée de santé ou de handicap dans un champ libre, sauf si c'est indispensable à la demande.",
      ] },
      { id: 'appointments', title: '4. Rendez-vous', paras: [
        "Vous confirmez, proposez un autre créneau ou refusez les demandes qui vous sont adressées, dans un délai raisonnable. Tenez vos créneaux à jour.",
        "La plateforme et son assistant ne décident d'aucun droit. Un brouillon proposé par l'assistant doit être vérifié avant tout usage.",
      ] },
      { id: 'data', title: '5. Vos propres données', paras: [
        "Pour votre compte, la plateforme traite votre nom, votre adresse électronique professionnelle, votre rôle, vos créneaux et le journal de vos actions. La notice de confidentialité décrit ces traitements, leurs bases légales proposées et leurs durées.",
        'Vos actions sont journalisées pour la sécurité et le contrôle des accès.',
      ] },
      { id: 'incident', title: '6. Incident de sécurité', paras: [
        "Signalez sans délai à {{contact}} toute perte d'un moyen de connexion, tout accès suspect ou toute erreur d'envoi.",
      ] },
      { id: 'end', title: '7. Suspension et fin', paras: [
        "En cas d'usage contraire à ces conditions, le compte peut être suspendu. Vous et votre structure en êtes informés, sauf urgence de sécurité.",
      ] },
      { id: 'liability', title: '8. Responsabilité et droit applicable', paras: [
        "Chacun répond de ses propres fautes dans les conditions prévues par la loi. L'exploitant n'est pas responsable des décisions de votre structure ni des organismes.",
        "Ces conditions sont soumises au droit français. En cas de difficulté, écrivez d'abord à {{contact}}.",
        'La version française de ces conditions est la seule juridiquement de référence ; les traductions sont une aide à la compréhension.',
      ] },
    ],
  },
  {
    id: 'conditions-structures',
    key: 'structures',
    path: '/conditions-structures',
    version: LEGAL_DRAFTS_VERSION,
    status: LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL,
    title: 'Conditions pour les structures',
    intro: "Ces conditions décrivent les règles proposées aux structures (associations, services publics, établissements) qui figurent dans l'annuaire ou qui reçoivent des demandes de rendez-vous. Aucune structure ne les a signées à ce jour.",
    sections: [
      { id: 'directory', title: "1. Fiche dans l'annuaire", paras: [
        "Les fiches viennent de sources officielles ou publiques : FINESS, data·inclusion, l'Annuaire de l'administration (Service-Public / DILA). Chaque fiche indique sa source et sa date.",
        "Une fiche signale qu'un service existe. Elle ne garantit ni une place ni une admission.",
        'La structure peut demander la correction ou la mise à jour de sa fiche à {{contact}}.',
      ] },
      { id: 'agreement', title: '2. Raccordement aux rendez-vous', paras: [
        "Pour recevoir des demandes de rendez-vous, une convention écrite est signée entre la structure et l'exploitant. Elle désigne un référent. Le raccordement est gratuit : aucune somme n'est versée par la structure ni à la structure.",
        "L'exploitant est {{operator}}, personne physique, qui exploite AccesDirectAide à titre personnel et bénévole. Aucune association n'a été créée à ce jour. Contact : {{contact}}.",
      ] },
      { id: 'roles', title: '3. Rôles pour les données personnelles', paras: [
        "Pour ce qu'elle reçoit (demandes, coordonnées, message accepté par la personne), la structure est responsable de son propre traitement, dans ses dossiers et selon ses obligations.",
        "Pour la gestion de la demande dans la plateforme, l'exploitant et la structure seraient responsables conjoints (RGPD, art. 26). Un accord le précisera ; ses grandes lignes seront mises à la disposition des personnes.",
        "Si la structure utilise l'outil comme son propre agenda, l'exploitant agirait comme sous-traitant (RGPD, art. 28), sous un contrat écrit.",
      ] },
      { id: 'commitments', title: '4. Engagements de la structure', items: [
        'Répondre aux demandes dans un délai raisonnable et tenir ses créneaux à jour.',
        "Gérer les comptes de son équipe : inviter, retirer les droits et désactiver un compte au départ d'une personne.",
        'Informer les personnes comme le prévoient ses propres obligations.',
        "Déclarer, avant l'ouverture, les services dont la nature peut révéler une donnée de santé ou de handicap.",
        "Appliquer le retrait par une personne de son accord au message : effacer toute copie, ou la garder sous sa propre responsabilité en l'en informant.",
      ] },
      { id: 'sensitive', title: '5. Services sensibles', paras: [
        "La réservation des services dont la nature peut révéler une donnée de santé ou de handicap est fermée à ce jour. Son ouverture suppose un indicateur « service sensible », le consentement explicite de la personne et une vérification des exigences d'hébergement des données de santé (à vérifier).",
      ] },
      { id: 'operatorCommitments', title: "6. Engagements de l'exploitant", items: [
        'Fournir le service gratuitement, avec des mesures de sécurité adaptées.',
        'Prévenir la structure sans retard injustifié de tout incident touchant les données qui la concernent.',
        "Ne pas utiliser ces données à d'autres fins et ne jamais les vendre.",
      ] },
      { id: 'end', title: '7. Durée, fin et droit applicable', paras: [
        "Chaque partie peut mettre fin au raccordement avec un préavis fixé dans la convention. À la fin, les données sont restituées ou effacées selon la convention.",
        "Chacun répond de ses propres fautes. Ces conditions sont soumises au droit français ; une solution amiable est recherchée d'abord.",
        'La version française de ces conditions est la seule juridiquement de référence ; les traductions sont une aide à la compréhension.',
      ] },
    ],
  },
  {
    id: 'notice-confidentialite',
    key: 'privacyNotice',
    path: '/confidentialite/notice',
    version: LEGAL_DRAFTS_VERSION,
    status: LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL,
    title: 'Notice de confidentialité (RGPD, articles 13 et 14)',
    intro: 'Cette notice explique quelles données personnelles AccesDirectAide traite, pourquoi, sur quelle base, pendant combien de temps, et quels sont vos droits.',
    sections: [
      { id: 'controller', title: '1. Responsable du traitement', paras: [
        "Le responsable du traitement est {{controller}}, personne physique, qui exploite AccesDirectAide à titre personnel et bénévole. Aucune association n'a été créée à ce jour. Aucun délégué à la protection des données n'est désigné.",
        'Pour vos données : {{contact}} ou le formulaire de contact.',
      ] },
      { id: 'status', title: '2. Statut de cette notice', paras: [V2_STATUS_NOTE] },
      { id: 'purposes', title: '3. Finalités et bases légales des comptes personnels', items: [
        "P1 — Fonctionnement et sécurité du site public (journaux techniques, limitation du nombre de requêtes, cookie de sécurité « __csrf ») : intérêt légitime (art. 6, 1, f).",
        "P2 — Création et tenue du compte (adresse électronique vérifiée, mot de passe protégé, déclaration « 18 ans ou plus », preuve de l'acceptation des conditions d'utilisation et de leur version) : exécution du contrat que sont les conditions d'utilisation (art. 6, 1, b), pour les seules données nécessaires au compte. L'acceptation des conditions et la déclaration de majorité ne sont pas des consentements au sens du RGPD. Aucun numéro de téléphone n'est demandé.",
        "P2b — Réglages d'affichage facultatifs (taille du texte, contraste, animations réduites, lecture à voix haute, FALC) : ils sont enregistrés uniquement dans votre navigateur, sur votre appareil (stockage local). Ils ne sont pas envoyés à AccesDirectAide et ne sont pas enregistrés dans votre compte : nous ne les recevons pas. Ils ne se synchronisent donc pas entre vos appareils ; sur un autre appareil ou un autre navigateur, il faut les choisir à nouveau. Ils restent sur l'appareil après la déconnexion. Vous pouvez les modifier ou les remettre à zéro à tout moment (« Réinitialiser l'affichage »), ou les effacer avec les données de votre navigateur. Ils servent uniquement à l'affichage que vous avez choisi : ils ne disent rien de votre santé ou d'un handicap, et aucune information de ce type n'est demandée. Ce stockage sur votre appareil, fait à votre demande pour adapter l'affichage, ne fait pas l'objet d'une demande de consentement (article 82 de la loi Informatique et Libertés).",
        "P3 — Connexion et verrouillage après plusieurs échecs : exécution du contrat (art. 6, 1, b) pour la connexion ; intérêt légitime de protéger les comptes (art. 6, 1, f) pour les mesures de sécurité.",
        "P10a — E-mails de service liés au compte (vérification de l'adresse, mot de passe, changement d'adresse, avis du compte) : exécution du contrat (art. 6, 1, b).",
        "P12 — Journal des actions d'administration : intérêt légitime (art. 6, 1, f).",
        "P13 — Exercice de vos droits : obligation légale (art. 6, 1, c ; articles 12 à 22 du RGPD). Conservation bloquée (« gel ») d'une donnée précise : obligation légale lorsqu'une autorité ou un juge l'exige (art. 6, 1, c) ; sinon, pour constater, exercer ou défendre un droit en justice, intérêt légitime (art. 6, 1, f) et, pour une donnée sensible, art. 9, 2, f — accès restreint, durée limitée au litige.",
        "P14 — Journaux de sécurité : intérêt légitime (art. 6, 1, f).",
        "P15 — Effacement aux échéances : obligation légale (art. 6, 1, c ; art. 5, 1, e et 17 du RGPD). Archives de preuve à accès restreint (par exemple la preuve d'un consentement ou d'une demande d'exercice des droits) : intérêt légitime (art. 6, 1, f), pour la durée indiquée en section 4.",
        "P16 — Prestataires techniques : pas de base propre ; ils agissent sur instruction (art. 28).",
      ], paras: [
        "Aucune finalité ne repose sur une mission d'intérêt public. Aucune décision produisant des effets juridiques n'est prise de façon automatisée : le service ne décide d'aucun droit.",
        "Sans adresse électronique, aucun compte ne peut être créé ; les champs facultatifs peuvent rester vides.",
      ] },
      { id: 'purposes-later', title: '3 bis. Fonctions non encore ouvertes (bases proposées)', proposed: true, paras: [
        "Ces traitements ne sont pas en service. Leurs bases légales seront confirmées par le responsable du traitement avant leur ouverture ; cette notice sera alors mise à jour.",
      ], items: [
        "P4 — Recherche d'un rendez-vous et affichage du nom des professionnels : pour vous, exécution des conditions (art. 6, 1, b) ; pour les professionnels, intérêt légitime de l'exploitant et de leur structure (art. 6, 1, f).",
        "P4p — Comptes des professionnels, y compris leur double authentification : intérêt légitime (art. 6, 1, f) ; exécution des conditions professionnelles acceptées (art. 6, 1, b).",
        "P5 — Demande, report, annulation, confirmation ou refus d'un rendez-vous, et messages de service liés : exécution des conditions (art. 6, 1, b).",
        "P5s — Rendez-vous auprès d'un service dont la nature peut révéler une donnée de santé ou de handicap : exécution des conditions (art. 6, 1, b) et consentement explicite (art. 9, 2, a) par une case distincte. Cette réservation n'est pas ouverte.",
        "P6 — Message facultatif joint à une demande : consentement (art. 6, 1, a) et consentement explicite (art. 9, 2, a), retirable à tout moment.",
        "P7 — Affectation d'un professionnel à un rendez-vous : exécution des conditions (art. 6, 1, b) ; choix « sans préférence » : intérêt légitime de la structure (art. 6, 1, f).",
        "P8 — Orientations entre professionnels (fonction fermée) : consentement à chaque partage (art. 6, 1, a ; art. 9, 2, a).",
        "P9 — Dossiers partagés et suivi (fonction fermée) : consentement au partage (art. 6, 1, a ; art. 9, 2, a).",
        "P10b/P10c — Rappel la veille et notifications du navigateur : consentement (art. 6, 1, a), retirable à tout moment.",
        "P11 — Disponibilités Outlook d'une structure (désactivé) : base choisie par la structure ; l'exploitant agit pour elle.",
      ] },
      { id: 'retention', title: '4. Durées de conservation', proposed: true, items: [
        "Compte (adresse électronique, mot de passe protégé, nom affiché, langue, préférences de notification) : tant que vous l'utilisez. Vous pouvez demander son effacement à tout moment depuis votre espace : une personne vérifie la demande, pour éviter une erreur ou une usurpation, puis efface le compte dans un délai d'un mois au plus.",
        "Compte inactif : un compte sans activité de votre part (connexion) pendant 24 mois pourra être effacé. Cet effacement n'est pas encore en service ; avant qu'il le soit, cette notice indiquera comment vous serez prévenu. Compte jamais activé (adresse électronique jamais confirmée) : effacé 7 jours après sa création, avec la trace de son inscription.",
        "Liens de vérification de l'adresse, de mot de passe et de changement d'adresse : valables 15 minutes (30 minutes pour un changement d'adresse), puis supprimés.",
        "Session de connexion : 7 jours au plus. Après 5 échecs de connexion, le compte est verrouillé 15 minutes.",
        "Compteurs de limitation des requêtes (votre adresse IP et, pour la connexion, la création de compte et l'envoi de liens, une empreinte de votre adresse électronique, jamais l'adresse elle-même) : effacés à la fin de leur fenêtre, de quelques minutes à une heure. Les journaux n'en gardent qu'une empreinte condensée.",
        "E-mails de service : leur contenu n'est pas conservé par AccesDirectAide ; la trace de l'envoi (numéro du message chez le prestataire) est gardée 12 mois. Si une adresse refuse définitivement les messages, une empreinte de l'adresse (pas l'adresse elle-même) bloque les envois ; ce blocage est revu après 12 mois et supprimé s'il n'est plus justifié.",
        "Archives à accès restreint après l'effacement d'un compte : preuve de l'acceptation des conditions d'utilisation et de la déclaration « 18 ans ou plus », 12 mois ; demandes d'exercice des droits, 3 ans après leur clôture. Elles ne servent qu'à prouver ou à se défendre en cas de litige.",
        "Journaux d'administration et de sécurité (sans votre adresse électronique) : 12 mois.",
        "Conservation bloquée (« gel ») d'une donnée précise, lorsqu'une autorité l'exige ou qu'un litige l'impose : jusqu'à la fin de la procédure ; la trace de la levée est gardée 12 mois.",
        "Journaux techniques des prestataires : l'hébergeur (Vercel) garde ses journaux d'exécution de 1 heure à 1 jour selon l'offre ; la durée des journaux du prestataire d'e-mails (Mailjet) est en cours de vérification.",
        "Historique de restauration : copies de sauvegarde chiffrées, 35 jours au plus ; historique de la base de données chez Neon, 6 heures au plus. Une donnée effacée peut subsister dans ces copies pendant ces durées ; elle n'est utilisée que pour réparer un incident. Pour qu'une restauration ne fasse pas revenir une personne effacée, une trace de chaque effacement (identifiant technique du compte et de la demande, date ; ni adresse ni nom) est gardée 40 jours hors de la base, chez Upstash (Francfort).",
        "Fonctions pas encore ouvertes (rendez-vous, message facultatif, notifications des professionnels, assistant) : leurs durées seront annoncées dans cette notice avant leur ouverture. Pour les rendez-vous confirmés, tenus ou manqués, la durée envisagée est de 1 an après la date du rendez-vous, puis anonymisation.",
      ], paras: [
        "Aucune de ces durées n'est imposée par un texte : elles sont fixées par le responsable du traitement. La suppression automatique à ces échéances n'est pas encore entièrement activée ; vous pouvez demander l'effacement à tout moment.",
      ] },
      { id: 'recipients', title: '5. Destinataires', paras: [
        "Vos données ne sont ni vendues ni louées. Y ont accès : l'exploitant ; la structure que vous choisissez pour un rendez-vous, pour ce qui lui est transmis ; les prestataires techniques ci-dessous, sur instruction.",
      ] },
      { id: 'processors', title: '6. Prestataires techniques (sous-traitants)', items: [
        'Vercel Inc. : hébergement du site et des fonctions serveur, exécutées à Francfort.',
        'Neon (contrat Databricks, Inc.) : base de données hébergée à Francfort.',
        'Upstash, Inc. : compteurs de sécurité et limitation du nombre de requêtes, à Francfort.',
        "Mailjet (groupe Sinch) : envoi des e-mails de service (vérification de l'adresse, mot de passe, avis du compte) ; données hébergées par Google Cloud à Francfort (Allemagne) et Saint-Ghislain (Belgique).",
        'Microsoft : boîte de réception de l\'adresse de contact.',
        "Scaleway SAS (France) et Cloudflare, Inc. : copies de sauvegarde de la base de données. La tâche de sauvegarde s'exécute chez Scaleway, à Paris, et chiffre la copie avant tout envoi ; Cloudflare la stocke dans l'Union européenne sans pouvoir la lire.",
      ], paras: [
        "Chacun de ces prestataires agit sur instruction, dans le cadre d'un accord de traitement des données (article 28 du RGPD) intégré à ses conditions de service.",
      ] },
      { id: 'transfers', title: '7. Transferts hors de l\'Union européenne', paras: [
        "Ces prestataires appartiennent à des groupes établis aux États-Unis : un accès depuis les États-Unis est possible. Les garanties prévues sont les clauses contractuelles types de la Commission européenne (décision 2021/914) et, pour Vercel, Upstash et Mailjet (Sinch), le cadre de protection des données UE–États-Unis, selon leurs propres conditions. Scaleway SAS fait exception : c'est une société française, qui exécute la tâche de sauvegarde à Paris.",
      ] },
      { id: 'rights', title: '8. Vos droits', items: [
        "Accès, rectification, effacement et limitation de vos données.",
        "Portabilité, pour les données traitées sur la base des conditions d'utilisation ou de votre consentement.",
        "Opposition, pour les traitements fondés sur l'intérêt légitime.",
        "Retrait de votre consentement à tout moment, aussi simplement que vous l'avez donné. Le retrait ne remet pas en cause ce qui a été fait avant.",
      ], paras: [
        'Écrivez à {{contact}}. Une réponse vous est donnée dans un délai d\'un mois.',
        'Vous pouvez aussi adresser une réclamation à la CNIL (www.cnil.fr).',
      ] },
      { id: 'booking', title: '9. Quand vous demandez un rendez-vous', paras: [
        "La structure choisie reçoit votre nom, votre adresse électronique, votre téléphone si vous l'indiquez, le créneau demandé et, si vous l'avez accepté, votre message.",
        "Pour ce qu'elle reçoit, la structure est responsable de son propre traitement : elle décide de ce qu'elle en fait dans ses dossiers, selon ses obligations. Vous pouvez exercer vos droits auprès d'elle.",
        "Pour la gestion de la demande dans la plateforme, l'exploitant et la structure seraient responsables conjoints ; un accord le précisera et ses grandes lignes seront publiées. Aucune structure n'a signé d'accord à ce jour.",
      ] },
      { id: 'sensitive', title: '10. Services sensibles (projet)', paras: [
        "Certains services peuvent révéler une information sur votre santé ou un handicap, par exemple un service de santé mentale ou d'addictologie. Une demande de rendez-vous auprès de ces services ne serait traitée qu'avec votre consentement explicite, donné par une case distincte non cochée. Retirer ce consentement annulerait la demande.",
        'La réservation de ces services est fermée à ce jour.',
      ] },
      { id: 'art14', title: '11. Professionnels et contacts des structures (article 14)', paras: [
        "L'annuaire contient des informations sur des structures et, le cas échéant, sur leurs contacts professionnels (nom de la structure, adresse de l'établissement, téléphone et adresse électronique professionnels, parfois le nom d'un responsable). Elles ne sont pas collectées auprès de vous : elles viennent de sources officielles ou publiques — FINESS, data·inclusion, l'Annuaire de l'administration (Service-Public / DILA). Chaque fiche indique sa source et sa date.",
        "Finalité : informer le public sur les services qui existent. Base proposée : intérêt légitime (art. 6, 1, f). Durée proposée : tant que la source publie l'information ; mise à jour à chaque import.",
        "Si votre structure vous crée un compte professionnel, elle fournit votre nom et votre adresse professionnelle : les sections 3 à 8 s'appliquent aussi à vous.",
        'Vous pouvez demander une rectification ou vous opposer à l\'affichage d\'une donnée qui vous concerne : {{contact}}.',
      ] },
      { id: 'language', title: '12. Langue de référence', paras: [
        'La version française de cette notice est la seule juridiquement de référence ; les traductions sont une aide à la compréhension.',
      ] },
    ],
  },
];

/** The A-I / A-II legal notice texts live in the « legal » namespace (MentionsLegales.jsx); this entry gives them the same approval state. */
export const LEGAL_NOTICE_VARIANT_DOCUMENT = Object.freeze({
  id: 'mentions-legales-a1-a2',
  key: 'mentionsVariant',
  path: null,
  version: LEGAL_DRAFTS_VERSION,
  status: LEGAL_DRAFT_STATUS.DRAFT_PENDING_OWNER_APPROVAL,
});

export const ALL_LEGAL_DRAFT_IDS = Object.freeze([...LEGAL_DRAFT_DOCUMENTS.map((d) => d.id), LEGAL_NOTICE_VARIANT_DOCUMENT.id]);

/** @param {unknown} v */
const clean = (v) => String(v ?? '').trim();

/**
 * Visibility of one draft for a given build.
 * @param {{ id: string, version: string }} doc
 * @param {{ approved?: string, preview?: string, production?: boolean }} ctx
 * @returns {'IN_FORCE' | 'PREVIEW' | 'HIDDEN'}
 */
export function draftVisibility(doc, ctx) {
  const tokens = clean(ctx.approved).split(',').map((s) => s.trim()).filter(Boolean);
  if (tokens.includes(`${doc.id}@${doc.version}`) || tokens.includes(doc.version)) return 'IN_FORCE';
  if (!ctx.production && clean(ctx.preview) === '1') return 'PREVIEW';
  return 'HIDDEN';
}

/** this build: VERCEL_ENV=production is injected by vite.config.js (__ADA_PRODUCTION_BUILD__); outside Vite, process.env */
export function currentDraftContext() {
  const nodeEnv = globalThis.process?.env || {};
  let approved; let preview;
  try {
    approved = import.meta.env.VITE_LEGAL_DOCS_APPROVED_VERSION;
    preview = import.meta.env.VITE_LEGAL_DRAFT_PREVIEW;
  } catch { /* not under Vite */ }
  // eslint-disable-next-line no-undef
  const injected = typeof __ADA_PRODUCTION_BUILD__ !== 'undefined' ? __ADA_PRODUCTION_BUILD__ : undefined;
  return {
    approved: approved || nodeEnv.VITE_LEGAL_DOCS_APPROVED_VERSION,
    preview: preview || nodeEnv.VITE_LEGAL_DRAFT_PREVIEW,
    production: injected !== undefined ? Boolean(injected) : nodeEnv.VERCEL_ENV === 'production',
  };
}

/** @param {string} path */
export function draftByPath(path) {
  return LEGAL_DRAFT_DOCUMENTS.find((d) => d.path === path) || null;
}
