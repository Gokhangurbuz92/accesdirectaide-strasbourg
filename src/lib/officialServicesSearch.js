/** Search of the official online services (Outils › « Services en ligne officiels »): pure functions, shared by the component and its tests. */
/** @typedef {{ id: string, kind: string, title: string, operator?: string, cerfa?: string, audience?: string, categorie?: string, cited?: number }} OfficialService */
/** @param {unknown} s */
export const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
/**
 * 12/11/2026 — a person often types the TYPE of service (« cerfa », « formulaire », « simulateur », « modèle de lettre »…), not a title: before, only
 * `title operator cerfa-number` were searched, so « cerfa » found 2 services out of ~800 forms. Each kind is now also found by its French words and by its
 * label in the interface language. The French words stay whatever the language: the services' own titles are French.
 */
/** @type {Record<string, string>} */
export const KIND_WORDS = {
  simulateur: 'simulateur simulateurs simulation calcul estimation',
  teleservice: 'demarche en ligne demarches en ligne teleservice teleservices',
  formulaire: 'formulaire formulaires cerfa',
  modele: 'modele de lettre modeles de lettres courrier',
  recherche: 'outil de recherche outils de recherche recherche annuaire',
};
/** the words a service is found by: its title, operator, cerfa number, and the words and label of its kind (folded) @param {OfficialService} x @param {string} [kindLabel] */
export const searchText = (x, kindLabel = '') => fold(`${x.title} ${x.operator || ''} ${x.cerfa ? `cerfa ${x.cerfa}` : ''} ${KIND_WORDS[x.kind] || ''} ${kindLabel}`);
/** filter + rank (most cited first, then title) — the words of `q` must all be found
 * @param {OfficialService[]} items @param {{ q?: string, kind?: string, cat?: string, pro?: boolean, kindLabels?: Record<string, string> }} [o] */
export function filterServices(items, { q = '', kind = '', cat = '', pro = false, kindLabels = {} } = {}) {
  const words = fold(q).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
  return items.filter((x) => (pro || x.audience !== 'pro') && (!kind || x.kind === kind) && (!cat || x.categorie === cat)
    && (!words.length || words.every((w) => searchText(x, kindLabels[x.kind]).includes(w))))
    .sort((a, b) => (b.cited || 0) - (a.cited || 0) || a.title.localeCompare(b.title, 'fr'));
}
