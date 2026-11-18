/**
 * FA-D4 — simplified French drafts (« texte simplifié provisoire ») of the key citizen pages: home, orientation result, rights-record template,
 * account / data rights, error and empty states. French only: simplification is not translation (src/content/falc is never translated).
 *
 * Written following the rules of « Les règles du FALC », Unapei (https://falc.unapei.org/quest-ce-que-le-falc/les-regles-du-falc/, read on 18/11/2026):
 * choose the information and the order first, short and simple sentences, easy words, a difficult word explained, one sentence per line, text aligned to
 * the left, a sans-serif font of at least 14 points, concrete everyday examples.
 * The FIRST Unapei rule — people with an intellectual disability take part in writing and/or proofreading — has NOT been applied yet. These texts are
 * therefore NOT « FALC »: every draft carries the status `simplified-draft-awaiting-participatory-validation` and the page shows « Texte simplifié
 * provisoire ». The participatory review follows docs/falc/KIT_TEST_LECTEURS_FALC.md; only then may a status change, text by text, by a person.
 *
 * Content rules of the product kept here: no sentence says a person HAS a right or WILL get an aid (api/lib/entitlementWording.js); the platform never
 * decides; only facts the product actually does are described (checked against the pages' own French texts on 18/11/2026).
 */

export const FALC_DRAFT_STATUS = 'simplified-draft-awaiting-participatory-validation';
export const FALC_RULES_SOURCE = Object.freeze({ url: 'https://falc.unapei.org/quest-ce-que-le-falc/les-regles-du-falc/', publisher: 'Unapei', readOn: '2026-11-18' });

/** @typedef {{ heading: string, lines: string[] }} FalcBlock */
/** @typedef {{ id: string, page: string, status: string, revisedOn: string, title: string, blocks: FalcBlock[], glossary?: Record<string, string> }} FalcPageDraft */

/** @type {Readonly<Record<string, FalcPageDraft>>} */
export const FALC_PAGE_DRAFTS = Object.freeze({
  home: {
    id: 'home', page: '/', status: FALC_DRAFT_STATUS, revisedOn: '2026-11-18',
    title: 'Ce site, c’est quoi ?',
    blocks: [
      { heading: 'Ce que vous trouvez ici', lines: [
        'Ce site parle des aides pour la vie de tous les jours.',
        'Par exemple : payer le loyer, se soigner, trouver un travail.',
        'Il explique aussi les démarches.',
        'Une démarche, c’est ce qu’il faut faire pour demander une aide.',
        'Il donne aussi des lieux où des personnes peuvent vous aider.',
        'Ces lieux sont à Strasbourg et autour de Strasbourg.',
      ] },
      { heading: 'D’où viennent les informations', lines: [
        'Les informations viennent de sites officiels.',
        'Un site officiel, c’est le site de l’État ou d’un organisme public.',
        'Chaque fiche dit quand elle a été vérifiée.',
      ] },
      { heading: 'Ce que le site ne fait pas', lines: [
        'Le site ne décide pas si vous pouvez avoir une aide.',
        'C’est l’organisme qui verse l’aide qui décide.',
        'Par exemple : la CAF ou la mairie.',
      ] },
      { heading: 'Comment commencer', lines: [
        'Écrivez ce que vous cherchez dans la case de recherche.',
        'Ou choisissez un besoin, par exemple « logement ».',
        'Vous pouvez aussi répondre aux questions de l’assistant.',
      ] },
    ],
  },
  orientationResult: {
    id: 'orientationResult', page: '/orientation', status: FALC_DRAFT_STATUS, revisedOn: '2026-11-18',
    title: 'Comment lire ce résultat ?',
    blocks: [
      { heading: 'Ce que vous voyez', lines: [
        'Vous voyez des aides, des démarches et des lieux.',
        'Ils parlent peut-être de votre situation.',
        'Ce n’est pas une décision.',
        'Ce résultat ne dit pas que vous allez recevoir une aide.',
      ] },
      { heading: 'Ce que vous pouvez faire', lines: [
        'Ouvrez une fiche pour lire les détails.',
        'Regardez qui décide et comment faire la demande.',
        'Vous pouvez imprimer le résultat.',
        'Vous pouvez aussi créer un lien pour le montrer à un professionnel.',
      ] },
      { heading: 'Si vous voulez parler à une personne', lines: [
        'Allez au CCAS de votre commune.',
        'Le CCAS, c’est le service social de la mairie.',
        'Vous pouvez aussi aller dans une Maison des solidarités.',
        'Ou dans un espace France Services.',
      ] },
    ],
  },
  rightDetail: {
    id: 'rightDetail', page: '/aides/:slug', status: FALC_DRAFT_STATUS, revisedOn: '2026-11-18',
    title: 'Comment lire cette fiche ?',
    blocks: [
      { heading: 'Cette fiche explique une aide', lines: [
        'Elle dit à quoi sert l’aide.',
        'Elle dit qui peut la demander.',
        'Elle dit comment faire la demande.',
      ] },
      { heading: 'Qui décide', lines: [
        'Le site ne décide pas.',
        'L’organisme qui verse l’aide étudie votre demande.',
        'C’est lui qui dit oui ou non.',
      ] },
      { heading: 'La source', lines: [
        'Sur la fiche, vous voyez la source.',
        'La source, c’est le site officiel où l’information est écrite.',
        'Vous voyez aussi la date de vérification.',
        'Si la date est ancienne, vérifiez sur le site officiel.',
      ] },
    ],
  },
  accountData: {
    id: 'accountData', page: '/compte/parametres', status: FALC_DRAFT_STATUS, revisedOn: '2026-11-18',
    title: 'Vos informations dans votre compte',
    blocks: [
      { heading: 'Voir vos informations', lines: [
        'Vous pouvez télécharger une copie de vos informations.',
        'Appuyez sur « Exporter mes données ».',
        'Le fichier contient les informations de votre compte.',
      ] },
      { heading: 'Corriger vos informations', lines: [
        'Allez dans « Mon profil ».',
        'Changez ce qui est faux.',
        'Enregistrez.',
      ] },
      { heading: 'Supprimer votre compte', lines: [
        'Appuyez sur « Supprimer mon compte ».',
        'Votre demande est enregistrée.',
        'Notre équipe s’en occupe ensuite.',
        'Vos informations, vos rendez-vous et vos messages sont supprimés.',
        'La loi oblige parfois à garder quelques informations.',
        'Dans ce cas, nous vous le disons.',
      ] },
      { heading: 'Une question', lines: [
        'Écrivez-nous avec la page « Contact ».',
      ] },
    ],
  },
  notFound: {
    id: 'notFound', page: '*', status: FALC_DRAFT_STATUS, revisedOn: '2026-11-18',
    title: 'Cette page n’existe pas',
    blocks: [
      { heading: 'Que faire ?', lines: [
        'L’adresse de la page est peut-être fausse.',
        'Ou la page a été enlevée.',
        'Retournez à l’accueil.',
        'Ou cherchez avec la case de recherche.',
      ] },
    ],
  },
  serviceError: {
    id: 'serviceError', page: '(erreur)', status: FALC_DRAFT_STATUS, revisedOn: '2026-11-18',
    title: 'Le site a un problème',
    blocks: [
      { heading: 'Que faire ?', lines: [
        'Ce n’est pas de votre faute.',
        'Attendez quelques minutes.',
        'Puis essayez encore.',
        'Si le problème continue, écrivez-nous avec la page « Contact ».',
      ] },
    ],
  },
  emptyResults: {
    id: 'emptyResults', page: '/aides, /structures, /recherche', status: FALC_DRAFT_STATUS, revisedOn: '2026-11-18',
    title: 'Nous n’avons rien trouvé',
    blocks: [
      { heading: 'Que faire ?', lines: [
        'Essayez un autre mot.',
        'Par exemple : « loyer » à la place de « APL ».',
        'Enlevez des filtres.',
        'Un filtre, c’est un choix qui limite les résultats.',
      ] },
    ],
  },
});
