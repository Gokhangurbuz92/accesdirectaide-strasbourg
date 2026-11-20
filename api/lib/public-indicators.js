/**
 * G8 (19/11/2026, owner decision C8/D4 « new metrics », proposed under the blanket approval of 19/11, opening still to be decided) — the PUBLIC indicators of
 * the Observatoire: what can be published to anyone, today, without a login, because it is computed only from the PUBLIC catalogue (records that are already
 * shown to every visitor under the D-5 rule) and from the platform's own checks of those records. Nothing here reads an account, a referral, an appointment,
 * a search, a visit or any table holding a person's data; nothing here is a « non-recours » or « personnes aidées » figure (api/lib/observatory-metrics.js
 * keeps those NOT_COMPUTED). The non-recours observatory (institutions, frozen quarters, suppressed grid) is a separate thing and is untouched.
 *
 * CLOSED BY DEFAULT: the endpoint (GET /api/public/indicators) answers only when ADA_PUBLIC_INDICATORS=open (exact value; unset, any other value = closed,
 * in every environment, Production included), and the /impact section shows only when the build sets VITE_PUBLIC_INDICATORS=open (exact value).
 * During the restricted public beta the gate (api/_utils/public-beta.js) lets the route through only under the same switch.
 *
 * One registry (French master text), read by the service, by the tests and by the report; the page carries the same texts translated (about:indicators.*).
 */

/** @param {Record<string, string | undefined>} [envVars] */
export function publicIndicatorsOpen(envVars = process.env) {
  return String(envVars.ADA_PUBLIC_INDICATORS ?? '').trim().toLowerCase() === 'open';
}
export const PUBLIC_INDICATORS_PATH = 'public/indicators';
export const SCHEMA = 'ada.public-indicators.v1';
/** a link-check result older than this is not counted (the job is weekly: one missed run still leaves the previous one) */
export const LINK_WINDOW_DAYS = 35;

/** @typedef {{ id: string, label: string, definition: string, source: string, refresh: string, notPersonal: string, isNot: string }} PublicIndicator */
/** @type {ReadonlyArray<PublicIndicator>} */
export const PUBLIC_INDICATORS = Object.freeze([
  {
    id: 'catalogue', label: 'Fiches publiées',
    definition: 'Nombre d’aides, de démarches, de lieux d’accueil et de dispositifs visibles sur le site à la date du calcul (règle D-5 stricte : source officielle, vérification datée de moins de 180 jours, territoire confirmé, aucune retenue), et nombre de guides et d’actualités publiés.',
    source: '"Aide", "Demarche", "Structure", "Dispositif" filtrés par visibleSql(kind, { mode: "strict" }) ; "Guide" et "Actualite" où statut = publie',
    refresh: 'Recalculé au plus toutes les 6 heures ; la date et l’heure du calcul sont publiées.',
    notPersonal: 'Ce sont des fiches déjà publiques (aides, démarches, organismes) : on les compte, aucune ne concerne une personne.',
    isNot: 'Ce n’est ni un nombre de personnes, ni une mesure de l’accès aux droits. Une aide publiée n’est pas une aide obtenue.',
  },
  {
    id: 'aidesByDomain', label: 'Aides publiées par domaine',
    definition: 'Les aides visibles réparties selon leur domaine (logement, santé, handicap, emploi, famille…), tel qu’il est enregistré sur la fiche.',
    source: '"Aide".category_code (énumération AidCategoryCode), aides visibles',
    refresh: 'Comme les fiches publiées.',
    notPersonal: 'Classement de fiches publiques.',
    isNot: 'Ce n’est pas l’importance des besoins dans un domaine : cela dit seulement combien de fiches le catalogue contient.',
  },
  {
    id: 'aidesBySourceTheme', label: 'Aides publiées par thème de la source officielle',
    definition: 'Les aides visibles réparties selon le thème que leur source officielle leur donne (par exemple « Famille - Scolarité » ou « Logement » sur Service-Public), tel qu’il est recopié sur la fiche ; une fiche sans thème est comptée « thème non indiqué ».',
    source: '"Aide".theme (recopié de la source), aides visibles',
    refresh: 'Comme les fiches publiées.',
    notPersonal: 'Classement de fiches publiques, fait par la source officielle elle-même.',
    isNot: 'Ce n’est pas l’importance des besoins dans un domaine : seulement le nombre de fiches du catalogue, classées comme le fait la source.',
  },
  {
    id: 'aidesByScope', label: 'Aides publiées par échelon',
    definition: 'Les aides visibles réparties selon l’échelon qui les porte : nationales, régionales, départementales, communales, ou non précisé.',
    source: '"Aide".territory_scope (NATIONAL, REGIONAL, DEPARTMENTAL, COMMUNAL ; toute autre valeur = non précisé)',
    refresh: 'Comme les fiches publiées.',
    notPersonal: 'Classement de fiches publiques.',
    isNot: 'Ce n’est pas une couverture du territoire : une aide nationale s’applique partout.',
  },
  {
    id: 'structuresByCommune', label: 'Lieux d’accueil publiés par commune',
    definition: 'Les lieux d’accueil visibles par commune, d’après leur adresse déclarée (nom de commune et code postal concordants, sinon « non localisé »). Une commune de moins de 5 lieux n’est pas publiée, et si une seule commune est masquée, la plus petite publiée l’est aussi.',
    source: '"Structure".ville et code_postal (communeOfAddress), lieux visibles ; masquage primaryCell + complementColumn (api/_services/territorial-stats.js, seuil 5)',
    refresh: 'Comme les fiches publiées.',
    notPersonal: 'Les lieux sont publics dans l’annuaire. Certains organismes sont tenus par une seule personne (par exemple un mandataire individuel) : le masquage des petites communes est appliqué par précaution.',
    isNot: 'Ce n’est pas l’offre réelle d’une commune : un lieu peut servir plusieurs communes, et beaucoup de lieux ne sont pas encore vérifiés ni publiés.',
  },
  {
    id: 'freshness', label: 'Fraîcheur des vérifications',
    definition: 'Parmi les fiches visibles de chaque type, celles dont la dernière vérification automatique sur la source officielle date de 90 jours au plus (« à jour ») et celles vérifiées il y a 91 à 180 jours (« à revoir »). Au-delà de 180 jours, une fiche n’est plus publiée et n’est donc pas comptée.',
    source: 'date_verification des fiches visibles (CURRENT_DAYS = 90, DEFAULT_MAX_AGE_DAYS = 180, api/lib/publicVisibility.js) ; la chaîne de vérification D-5 v2 est seule à écrire cette date',
    refresh: 'Comme les fiches publiées.',
    notPersonal: 'Dates de vérification de fiches publiques ; l’identité de qui vérifie n’est jamais lue.',
    isNot: 'Une fiche vérifiée récemment reste une information générale : seul l’organisme concerné décide des droits d’une personne.',
  },
  {
    id: 'linkHealth', label: 'État des liens officiels',
    definition: 'Les adresses officielles citées par les fiches visibles et contrôlées par la vérification hebdomadaire des liens au cours des 35 derniers jours, selon leur dernier résultat : accessible, redirigée, introuvable (404, 410), ou non concluant (accès refusé au robot, erreur du serveur, réseau). Une adresse hors de la liste des sources officielles n’est jamais appelée et n’est pas comptée.',
    source: '"SourceSnapshot" où raw_excerpt commence par « link: » (api/_services/link-check.js), dernier résultat par adresse, limité aux fiches visibles',
    refresh: 'Chaque contrôle des liens (hebdomadaire lorsqu’il est activé) ; « non mesuré » si aucun contrôle depuis 35 jours.',
    notPersonal: 'Codes de réponse de sites officiels publics.',
    isNot: 'Un lien accessible ne garantit pas que la page dit toujours la même chose : le contenu est contrôlé par la vérification des fiches, pas par ce test.',
  },
  {
    id: 'translations', label: 'Fiches traduites',
    definition: 'Pour chacune des cinq langues proposées en plus du français, le nombre de fiches visibles dont la traduction est montrée : entièrement (tous les champs traduits ont passé les contrôles automatiques ou une relecture) ou en partie. Une traduction faite sur une ancienne version du texte français n’est pas comptée.',
    source: 'data/translations/<type>/<slug>.json comparé à la fiche publique actuelle (publicView, api/lib/contentTranslation.js)',
    refresh: 'Comme les fiches publiées.',
    notPersonal: 'Fichiers de traduction de fiches publiques.',
    isNot: 'Les traductions sont une aide à la compréhension : le texte français reste la référence. Ce n’est pas un nombre de lecteurs par langue (les langues choisies par les visiteurs ne sont pas mesurées).',
  },
  {
    id: 'structuresInformation', label: 'Informations pratiques des lieux',
    definition: 'Parmi les lieux d’accueil visibles, ceux dont la fiche indique un accès adapté aux personnes à mobilité réduite, et ceux dont la fiche indique des horaires.',
    source: '"Structure".accessibilite_pmr = true ; "Structure".horaires non vide ; lieux visibles',
    refresh: 'Comme les fiches publiées.',
    notPersonal: 'Champs de fiches publiques.',
    isNot: 'Un lieu sans mention n’est pas un lieu inaccessible : l’information manque simplement dans la source.',
  },
  {
    id: 'rightsNeeds', label: 'Besoins décrits dans « Explorer les droits »',
    definition: 'Nombre de besoins présentés sur la page /droits et nombre de fiches officielles Service-Public qui y sont reliées, avec la date de lecture de l’archive officielle.',
    source: 'data/reference/rights-public-view.v1.json (généré par scripts/rights-public-view.mjs)',
    refresh: 'À chaque publication du site.',
    notPersonal: 'Contenu éditorial public.',
    isNot: 'Ce n’est pas une liste des besoins des habitants : c’est la liste des situations que la page explique.',
  },
]);

/** keys that name a row, a person or an internal reviewer: none may appear anywhere in a public indicators response */
export const FORBIDDEN_KEYS = Object.freeze(['id', 'slug', 'nom', 'name_person', 'email', 'telephone', 'phone', 'adresse', 'address', 'siret', 'rna_id', 'numero_finess',
  'verified_by', 'updatedBy', 'reviewer_id', 'falc_reviewed_by', 'publication_hold', 'commentaire_statut', 'url', 'source_url', 'final_url', 'entity_id', 'entityId',
  'userId', 'citizenUserId', 'ip', 'query', 'q', 'latitude', 'longitude']);
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const LINK = /\b(?:https?:\/\/|www\.)/i;
const PHONE = /(?:\+33|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/;
/** an ISO date or date-time, a code (UPPER_CASE, digits) or a commune name: the only strings a response may hold */
// G12.1: a comma is admitted inside a label (Service-Public theme « Social - Santé, Financement »); e-mails, links and phone numbers stay refused above
const ALLOWED_STRING = /^(?:\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?|[A-Za-z0-9_.-]{1,40}|[\p{L}' ’(),-]{1,80}(?: [\p{L}' ’(),-]{1,80}){0,3})$/u;

/**
 * Fail closed: throws when the body holds anything that is not an aggregate — a forbidden key, an e-mail, a link, a phone number, a long free text, or an
 * array of more than 400 entries. Called by the handler before every answer. @param {unknown} body @returns {true}
 */
export function assertAggregateOnly(body) {
  /** @param {unknown} v @param {string} at */
  const walk = (v, at) => {
    if (v === null || typeof v === 'number' || typeof v === 'boolean') { if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`public indicators: non-finite number at ${at}`); return; }
    if (typeof v === 'string') {
      if (EMAIL.test(v) || LINK.test(v) || PHONE.test(v) || !ALLOWED_STRING.test(v)) throw new Error(`public indicators: string not allowed at ${at}`);
      return;
    }
    if (Array.isArray(v)) { if (v.length > 400) throw new Error(`public indicators: list too long at ${at}`); v.forEach((x, i) => walk(x, `${at}[${i}]`)); return; }
    if (typeof v === 'object') {
      for (const [k, x] of Object.entries(/** @type {Record<string, unknown>} */ (v))) {
        if (FORBIDDEN_KEYS.includes(k)) throw new Error(`public indicators: key not allowed at ${at}.${k}`);
        walk(x, `${at}.${k}`);
      }
      return;
    }
    throw new Error(`public indicators: value not allowed at ${at}`);
  };
  walk(body, '$');
  return true;
}
