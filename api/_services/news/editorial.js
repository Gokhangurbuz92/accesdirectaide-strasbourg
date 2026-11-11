/**
 * Actualités v2 (owner directive 11/11/2026) — the editorial layer of the news: WHERE an event happens, WHAT it is about, which reports tell the SAME
 * story, how the combined feed is balanced, and what each source's rights allow to show. Pure functions: no network, no database, deterministic.
 *
 * Principles (written so a reader can check them, not claimed as « neutrality »):
 *  - geography is the place of the EVENT, read from the text — never the publisher's country (a French report about Kyiv is « Monde », Ukraine);
 *  - a category is given by documented keyword rules (FR), never by a guess about a source's opinion; no source is labelled « biased » or « neutral »;
 *  - ranking is time-based (newest) or match-based (relevant); no source or viewpoint is boosted; a story told by several publishers is ONE card that
 *    links every report (« Sources et couverture »);
 *  - the 70 % France / 30 % Monde start is a configurable interleave: when one side has no item, nothing is invented and the other side fills the feed;
 *  - rights are per source and per element (headline, excerpt, full text, image) — anything not evidenced is refused (fail-closed).
 */

/** the editorial categories (owner list), with the existing `categorie` values they cover (current filters keep working) */
export const NEWS_TOPICS = Object.freeze([
  { id: 'une', legacy: [] },
  { id: 'societe', legacy: ['general', 'actualite'] },
  { id: 'politique', legacy: [] },
  { id: 'economie', legacy: ['emploi_economie'] },
  { id: 'international', legacy: [] },
  { id: 'sante', legacy: ['sante'] },
  { id: 'environnement', legacy: [] },
  { id: 'justice', legacy: ['justice'] },
  { id: 'emploi', legacy: ['emploi', 'travail'] },
  { id: 'education', legacy: ['education', 'scolarite'] },
  { id: 'technologie', legacy: ['numerique'] },
  { id: 'culture', legacy: ['culture'] },
  { id: 'logement', legacy: ['logement'] },
  { id: 'handicap', legacy: ['handicap'] },
  { id: 'famille', legacy: ['famille'] },
  { id: 'droits', legacy: ['droits', 'aides', 'prestations'] },
  { id: 'strasbourg', legacy: ['region', 'prefecture'] },
]);
export const TOPIC_IDS = Object.freeze(NEWS_TOPICS.map((t) => t.id));
export const GEO_SCOPES = Object.freeze(['france', 'monde', 'alsace']);

/** lower-case, accents removed, apostrophes and punctuation as spaces — the form every rule below matches on */
/** @param {unknown} s */
export function fold(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’'`]/g, ' ').replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}
const hasWord = (/** @type {string} */ text, /** @type {string} */ word) => new RegExp(`(?:^|\\s)${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`).test(text);

/** keyword rules, folded; a rule matches whole words or word prefixes ending with « * » */
const RULES = {
  politique: ['gouvernement', 'ministre', 'premier ministre', 'assemblee nationale', 'senat', 'depute*', 'senateur*', 'election*', 'scrutin', 'parlement*', 'loi de finances', 'projet de loi', 'proposition de loi', 'conseil constitutionnel', 'president de la republique', 'elysee'],
  economie: ['economie', 'economique*', 'inflation', 'prix', 'croissance', 'budget', 'impot*', 'taxe*', 'fiscal*', 'banque*', 'pouvoir d achat', 'smic', 'tva', 'insee', 'entreprise*', 'commerce'],
  sante: ['sante', 'medical*', 'medecin*', 'hopital*', 'hospital*', 'maladie*', 'vaccin*', 'assurance maladie', 'ameli', 'cpam', 'soins', 'pharmac*', 'epidemi*', 'oms', 'mutuelle*', 'complementaire sante'],
  environnement: ['environnement*', 'climat*', 'ecolog*', 'pollution', 'biodiversite', 'energie*', 'renovation energetique', 'maprimerenov', 'canicule', 'inondation*', 'secheresse', 'dechet*', 'transition ecologique'],
  justice: ['justice', 'tribunal', 'tribunaux', 'juge*', 'judiciaire', 'proces', 'condamn*', 'avocat*', 'aide juridictionnelle', 'cour de cassation', 'conseil d etat', 'penal*', 'plainte*', 'victime*'],
  emploi: ['emploi*', 'chomage', 'france travail', 'travail', 'salari*', 'licenciement*', 'retraite*', 'apprentissage', 'formation professionnelle', 'contrat de travail', 'indemnit*', 'demandeur* d emploi'],
  education: ['ecole*', 'education', 'eleve*', 'etudiant*', 'universit*', 'bourse*', 'scolaire*', 'college*', 'lycee*', 'baccalaureat', 'parcoursup', 'crous', 'enseignement*', 'rentree'],
  technologie: ['numerique', 'internet', 'donnees personnelles', 'cyber*', 'intelligence artificielle', 'ia', 'technolog*', 'arnaque* en ligne', 'cnil', 'france connect', 'franceconnect', 'smartphone*'],
  culture: ['culture*', 'culturel*', 'musee*', 'patrimoine', 'cinema', 'festival*', 'pass culture', 'bibliotheque*', 'spectacle*', 'sport*'],
  logement: ['logement*', 'loyer*', 'apl', 'locataire*', 'proprietaire*', 'bail', 'hlm', 'expulsion*', 'hebergement', 'immobilier', 'copropriete*', 'charges locatives', 'sans abri', 'sans domicile'],
  handicap: ['handicap*', 'aah', 'mdph', 'invalidite', 'accessibilite', 'pch', 'aidant*', 'autonomie', 'perte d autonomie', 'apa'],
  famille: ['famille*', 'familial*', 'enfant*', 'parent*', 'caf', 'allocations familiales', 'naissance*', 'garde d enfant*', 'creche*', 'pension alimentaire', 'divorce', 'mariage', 'pacs', 'conge parental', 'adoption'],
  droits: ['droit*', 'aide*', 'allocation*', 'prestation*', 'rsa', 'prime d activite', 'minima sociaux', 'demarche*', 'formulaire*', 'cheque energie', 'complementaire sante solidaire', 'css', 'aide sociale', 'france services'],
};
/** places, folded; « Alsace / Strasbourg » first (it is also France) */
const ALSACE = ['strasbourg', 'alsace', 'alsacien*', 'bas rhin', 'haut rhin', 'eurometropole', 'colmar', 'mulhouse', 'haguenau', 'selestat', 'schiltigheim', 'illkirch'];
/** the wider region: local news, but not Alsace — labelled « Grand Est », never « Alsace / Strasbourg » */
const GRAND_EST = ['grand est', 'moselle', 'lorraine', 'nancy', 'metz', 'reims', 'champagne ardenne'];
const FRANCE = ['france', 'francais*', 'national*', 'paris', 'metropole', 'outre mer', 'departement*', 'prefecture*', 'mairie*', 'commune*', 'service public', 'caf', 'cpam', 'urssaf', 'france travail', 'gouvernement', 'assemblee nationale', 'senat'];
/** countries and international bodies (folded French names) → ISO code or « INT » */
const WORLD = {
  ukraine: 'UA', russie: 'RU', allemagne: 'DE', belgique: 'BE', suisse: 'CH', italie: 'IT', espagne: 'ES', portugal: 'PT', 'royaume uni': 'GB', irlande: 'IE',
  'etats unis': 'US', amerique: 'US', washington: 'US', canada: 'CA', mexique: 'MX', bresil: 'BR', argentine: 'AR', chine: 'CN', japon: 'JP', inde: 'IN',
  turquie: 'TR', syrie: 'SY', liban: 'LB', israel: 'IL', gaza: 'PS', palestin: 'PS', iran: 'IR', irak: 'IQ', afghanistan: 'AF', algerie: 'DZ', maroc: 'MA',
  tunisie: 'TN', senegal: 'SN', mali: 'ML', niger: 'NE', soudan: 'SD', egypte: 'EG', 'afrique du sud': 'ZA', nigeria: 'NG', pologne: 'PL', 'pays bas': 'NL',
  grece: 'GR', roumanie: 'RO', hongrie: 'HU', autriche: 'AT', suede: 'SE', norvege: 'NO', danemark: 'DK', finlande: 'FI', australie: 'AU', coree: 'KR',
  'union europeenne': 'EU', 'commission europeenne': 'EU', 'parlement europeen': 'EU', bruxelles: 'EU', onu: 'INT', 'nations unies': 'INT', oms: 'INT', otan: 'INT',
  europe: 'EU', international: 'INT', mondial: 'INT',   // never « monde » alone: « tout le monde » is French for everybody
};

const matches = (/** @type {string} */ text, /** @type {string} */ rule) => (rule.endsWith('*') ? new RegExp(`(?:^|\\s)${rule.slice(0, -1).replace(/\s+/g, '\\s')}[a-z]*`).test(text) : hasWord(text, rule));

/**
 * Where the event happens. @param {{ titre?: string, resume?: string, contenu?: string }} item @param {{ territory?: string, scope?: string } | null} [source]
 * @returns {{ scope: 'alsace' | 'france' | 'monde', area?: 'alsace' | 'grand_est', countries: string[], basis: 'text' | 'source-scope' | 'default' }}
 */
export function classifyGeo(item, source = null) {
  const text = fold([item.titre, item.resume, item.contenu].filter(Boolean).join(' ')).slice(0, 4000);
  const countries = [...new Set(Object.entries(WORLD).filter(([k]) => matches(text, k)).map(([, v]) => v))];
  const alsace = ALSACE.some((r) => matches(text, r));
  const region = !alsace && GRAND_EST.some((r) => matches(text, r));
  const france = FRANCE.some((r) => matches(text, r));
  if (alsace || region) return { scope: 'alsace', area: alsace ? 'alsace' : 'grand_est', countries: ['FR', ...countries.filter((c) => c !== 'FR')], basis: 'text' };
  // a foreign country named and no French marker: the event is abroad, whoever publishes it
  if (countries.length && !france) return { scope: 'monde', countries, basis: 'text' };
  if (france) return { scope: 'france', countries: ['FR', ...countries], basis: 'text' };
  // no place in the text: the source's own declared scope (e.g. a national French administration publishes French measures), else France by default
  const s = String(source?.scope || source?.territory || '').toUpperCase();
  if (s === 'WORLD' || s === 'INT' || s === 'EU') return { scope: 'monde', countries: [s === 'EU' ? 'EU' : 'INT'], basis: 'source-scope' };
  if (s === 'GRAND_EST' || s.startsWith('DEP_6')) return { scope: 'alsace', area: s === 'GRAND_EST' ? 'grand_est' : 'alsace', countries: ['FR'], basis: 'source-scope' };
  if (s === 'FRANCE') return { scope: 'france', countries: ['FR'], basis: 'source-scope' };
  return { scope: 'france', countries: [], basis: 'default' };
}

/**
 * The editorial categories of an item (at most 3, strongest first). @param {{ titre?: string, resume?: string, categorie?: string | null }} item
 * @param {{ scope: string }} [geo] @returns {string[]}
 */
export function classifyTopics(item, geo) {
  const title = fold(item.titre); const body = fold([item.resume].filter(Boolean).join(' ')).slice(0, 2000);
  /** @type {[string, number][]} */ const scores = [];
  for (const [topic, rules] of Object.entries(RULES)) {
    let s = 0;
    for (const r of rules) { if (matches(title, r)) s += 3; else if (matches(body, r)) s += 1; }
    if (s) scores.push([topic, s]);
  }
  // an existing category from the feed counts (the current filters keep their meaning)
  const legacy = NEWS_TOPICS.find((t) => t.legacy.includes(String(item.categorie || '')));
  // a regional feed's « region » category is not a Strasbourg story when the text names only the wider Grand Est
  if (legacy && legacy.id !== 'societe' && !(legacy.id === 'strasbourg' && /** @type {any} */ (geo)?.area === 'grand_est')) { const e = scores.find(([t]) => t === legacy.id); if (e) e[1] += 2; else scores.push([legacy.id, 2]); }
  scores.sort((/** @type {[string, number]} */ a, /** @type {[string, number]} */ b) => b[1] - a[1] || TOPIC_IDS.indexOf(a[0]) - TOPIC_IDS.indexOf(b[0]));
  const out = scores.slice(0, 3).map(([t]) => t);
  if (geo?.scope === 'monde' && !out.includes('international')) out.push('international');
  if (geo?.scope === 'alsace' && /** @type {any} */ (geo).area !== 'grand_est' && !out.includes('strasbourg')) out.push('strasbourg');
  return out.length ? out : ['societe'];
}

const STOP = new Set('le la les un une des du de d l et ou a au aux en dans sur pour par avec sans ce ces cette son sa ses leur leurs qui que quoi dont est sont ete etre a ont plus moins tres pas ne se s il elle ils elles nous vous on y the of and to in for on with is are new nouveau nouvelle nouveaux nouvelles'.split(' '));
/** the words that carry the story (folded, no stop words, light plural folding) @param {string} title @returns {string[]} */
export function storyTokens(title) {
  return [...new Set(fold(title).split(' ').filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(aux|eaux)$/, 'al').replace(/s$/, '')))];
}
const jaccard = (/** @type {string[]} */ a, /** @type {string[]} */ b) => { const A = new Set(a); const B = new Set(b); let n = 0; for (const x of A) if (B.has(x)) n += 1; return n / Math.max(1, A.size + B.size - n); };

/**
 * Groups reports of the same story: same story = similar title words (Jaccard ≥ threshold) published within `windowHours` of each other. The
 * representative is the earliest licensed (lane A) or ADA report, else the earliest. Order of the input is kept for representatives.
 * @template {{ id: string, titre: string, date_publication: string | Date, lane?: string }} T
 * @param {T[]} items @param {{ threshold?: number, windowHours?: number }} [o] @returns {{ key: string, lead: T, members: T[] }[]}
 */
export function clusterStories(items, { threshold = 0.5, windowHours = 72 } = {}) {
  /** @type {{ key: string, lead: T, members: T[], tokens: string[], at: number }[]} */
  const clusters = [];
  for (const it of items) {
    const tokens = storyTokens(it.titre); const at = new Date(it.date_publication).getTime();
    const hit = tokens.length >= 2 ? clusters.find((c) => Math.abs(c.at - at) <= windowHours * 3600000 && jaccard(c.tokens, tokens) >= threshold) : null;
    if (hit) { hit.members.push(it); continue; }
    clusters.push({ key: `story:${it.id}`, lead: it, members: [it], tokens, at });
  }
  const rank = (/** @type {T} */ x) => (x.lane === 'A' || x.lane === 'ADA' || x.lane === 'OWN' ? 0 : 1);
  return clusters.map((c) => {
    const lead = [...c.members].sort((a, b) => rank(a) - rank(b) || new Date(a.date_publication).getTime() - new Date(b.date_publication).getTime())[0];
    return { key: c.key, lead, members: c.members };
  });
}

/**
 * Interleaves France (incl. Alsace) and Monde at the given share, in time order on each side; never invents an item: when one side is exhausted the
 * other continues. @template {{ geo: { scope: string } }} T @param {T[]} items newest first @param {{ franceShare?: number }} [o] @returns {T[]}
 */
export function balanceFeed(items, { franceShare = 0.7 } = {}) {
  const share = Math.min(1, Math.max(0, Number(franceShare)));
  const fr = items.filter((i) => i.geo?.scope !== 'monde'); const world = items.filter((i) => i.geo?.scope === 'monde');
  const out = []; let f = 0; let w = 0;
  while (f < fr.length || w < world.length) {
    const wantFrance = (f + w === 0) ? share >= 0.5 : (f / (f + w)) < share;
    if ((wantFrance && f < fr.length) || w >= world.length) out.push(fr[f++]); else out.push(world[w++]);
  }
  return out;
}

/** what a rights record allows; unknown or malformed = nothing beyond a link (fail-closed) */
export const RIGHTS_ELEMENTS = Object.freeze(['headline', 'excerpt', 'fullText', 'images']);
/**
 * @param {{ status?: string, rights?: Record<string, unknown>, evidenceUrl?: string, verifiedAt?: string, enabled?: boolean } | null | undefined} source
 * @param {Date} [now] @returns {{ lane: 'A' | 'B' | 'BLOCKED', allow: Record<string, boolean>, reason: string | null }}
 */
export function sourceRights(source, now = new Date()) {
  const none = { headline: false, excerpt: false, fullText: false, images: false };
  if (!source) return { lane: 'BLOCKED', allow: none, reason: 'SOURCE_UNKNOWN' };
  if (source.enabled === false || source.status === 'blocked') return { lane: 'BLOCKED', allow: none, reason: 'SOURCE_BLOCKED' };
  if (source.status !== 'approved') return { lane: 'BLOCKED', allow: none, reason: source.status === 'restricted' ? 'SOURCE_RESTRICTED' : 'SOURCE_PENDING_REVIEW' };
  if (!/^https:\/\//.test(String(source.evidenceUrl || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(source.verifiedAt || ''))) return { lane: 'BLOCKED', allow: none, reason: 'RIGHTS_EVIDENCE_MISSING' };
  // terms change: evidence older than a year must be read again before anything is shown
  if (now.getTime() - Date.parse(`${source.verifiedAt}T00:00:00Z`) > 366 * 86400000) return { lane: 'BLOCKED', allow: none, reason: 'RIGHTS_EVIDENCE_EXPIRED' };
  const r = source.rights || {};
  const allow = Object.fromEntries(RIGHTS_ELEMENTS.map((k) => [k, r[k] === true]));
  return { lane: allow.fullText ? 'A' : 'B', allow, reason: null };
}
