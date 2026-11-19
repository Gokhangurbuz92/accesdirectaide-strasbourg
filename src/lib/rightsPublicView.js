import view from '../../data/reference/rights-public-view.v1.json';

/**
 * G3 (19/11/2026) — the public view of the Rights Graph for /droits (src/pages/Droits.jsx): data/reference/rights-public-view.v1.json, generated at build time
 * from api/lib/rightsGraph.js by scripts/rights-public-view.mjs (owner decision C4: no D11 rule, no condition), and the helpers of the page.
 */
/** @typedef {{ id: string, title: string | null, url: string, present: boolean | null, redirectedTo: string | null, importantChangeAt: string | null, modifiedAt: string | null, readAt: string | null, localGuide: string | null, uncertainty?: string }} PublicFiche */
/** @typedef {{ text: string, sources: string[], uncertainty: string }} PublicAction */
/** @typedef {{ id: string, label: string, sheet: string | null, territory: string, territoryUncertainty: string, uncertainty: string }} PublicAid */
/** @typedef {{ id: string, label: string, priority: number, urgent: boolean, topic: string, numbers: string[], fiches: PublicFiche[], actions: PublicAction[], omittedActions: number,
 *   rules: { text: string, sheet: string, window: { from: string, to: string, timeZone: string } | null }[], aids: PublicAid[], bodies: { id: string, label: string }[],
 *   offices: { type: string, sheets: string[] }[], tools: string[] }} PublicNeed */

/** @type {PublicNeed[]} */
export const NEEDS = /** @type {any} */ (view).needs;
/** the date the official archive was read (YYYY-MM-DD) */
export const SOURCES_READ_AT = /** @type {string} */ (/** @type {any} */ (view).sourcesReadAt);
export const FICHES = new Map([...NEEDS.flatMap((n) => n.fiches), .../** @type {PublicFiche[]} */ (/** @type {any} */ (view).aidFiches)].map((f) => [f.id, f]));
/** @type {Record<string, { label: string, departements: string[] | null, sheet: string | null }>} */
export const TERRITORIES = /** @type {any} */ (view).territories;
const PARIS_MONTH = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', month: 'numeric', day: 'numeric' });
/** is today (Paris calendar) inside a seasonal window « MM-DD » → « MM-DD » that may cross the new year @param {{ from: string, to: string }} w @param {Date} [now] */
export function inWindow(w, now = new Date()) {
  const parts = Object.fromEntries(PARIS_MONTH.formatToParts(now).map((p) => [p.type, p.value]));
  const md = `${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  return w.from <= w.to ? md >= w.from && md <= w.to : md >= w.from || md <= w.to;
}

/**
 * The name of a need in the interface language (the French default is the orientation's own label, api/lib/multi-need.js: a unit test keeps them equal).
 * @param {string} id @param {(key: string, fr: string) => string} t @param {string} fallback
 */
export function needLabel(id, t, fallback) {
  /** @type {Record<string, () => string>} */
  const labels = {
    'crise-suicide': () => t('rights:need.crise-suicide', 'Détresse, idées suicidaires'),
    'violences-conjugales': () => t('rights:need.violences-conjugales', 'Violences dans le couple'),
    'hebergement-urgence': () => t('rights:need.hebergement-urgence', 'Trouver un hébergement'),
    energie: () => t('rights:need.energie', 'Factures impayées : électricité, gaz, eau'),
    'expulsion-impayes': () => t('rights:need.expulsion-impayes', 'Loyer impayé, risque d’expulsion'),
    'sortie-ase': () => t('rights:need.sortie-ase', 'Sortie de l’aide sociale à l’enfance (18 ans)'),
    'droits-sans-titre': () => t('rights:need.droits-sans-titre', 'Droits sans titre de séjour'),
    aidants: () => t('rights:need.aidants', 'Aidant d’un proche'),
    'aide-domicile': () => t('rights:need.aide-domicile', 'Personne âgée : rester à domicile ou être accueillie'),
    'accessibilite-mobilite': () => t('rights:need.accessibilite-mobilite', 'Handicap et déplacements'),
    'mdph-droits': () => t('rights:need.mdph-droits', 'Handicap : dossier MDPH'),
    psy: () => t('rights:need.psy', 'Souffrance psychique'),
    surendettement: () => t('rights:need.surendettement', 'Dettes'),
    'recherche-emploi': () => t('rights:need.recherche-emploi', 'Chômage, recherche d’emploi'),
    'minima-sociaux': () => t('rights:need.minima-sociaux', 'Pas ou peu de ressources'),
    isolement: () => t('rights:need.isolement', 'Isolement'),
    'aides-logement': () => t('rights:need.aides-logement', 'Aide pour payer le loyer'),
    'acces-aux-droits': () => t('rights:need.acces-aux-droits', 'Aide pour les démarches administratives'),
    'adaptation-logement': () => t('rights:need.adaptation-logement', 'Adapter son logement (âge, handicap)'),
    'garde-enfants': () => t('rights:need.garde-enfants', 'Faire garder son enfant'),
    'scolarite-inclusive': () => t('rights:need.scolarite-inclusive', 'École et scolarité d’un enfant'),
    'prestations-familiales': () => t('rights:need.prestations-familiales', 'Enfants à charge'),
  };
  return labels[id] ? labels[id]() : fallback;
}
