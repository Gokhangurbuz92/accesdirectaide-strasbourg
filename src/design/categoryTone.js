/**
 * THE colour system of AccesDirectAide — one colour per topic family, the same on every page and in every space (public pages, Mon Espace, ADA Pro,
 * administration). Idea of the DSFR « couleurs illustratives »: colour is an accent (a top bar, an icon tile, a chip), text stays dark on a light tint
 * (contrast ≥ 4.5:1), and colour is never the only cue (a label is always written). Literal class strings: Tailwind keeps only the classes it reads here.
 * The dark theme remaps these colours (src/styles/theme-palette.css); `color` (rgb(var(--c-*-500))) serves charts and SVG, and follows the theme too.
 * Owner 24/11/2026: « hepsi bir bütün olan bir platform » — never a local colour map in a page: add the key here.
 */
/** @typedef {{ name: string, chip: string, tile: string, bar: string, dot: string, hover: string, soft: string, text: string, ring: string, active: string, color: string }} Tone */
/** @type {Record<string, Tone>} */
export const TONES = {
  slate: { name: 'slate', chip: 'bg-slate-100 text-slate-900 border-slate-200', tile: 'bg-slate-100 text-slate-700', bar: 'bg-slate-500', dot: 'bg-slate-500', hover: 'hover:border-slate-300', soft: 'bg-slate-50', text: 'text-slate-800', ring: 'ring-slate-200', active: 'bg-slate-700 text-white border-slate-700', color: 'rgb(var(--c-slate-500))' },
  indigo: { name: 'indigo', chip: 'bg-indigo-100 text-indigo-900 border-indigo-200', tile: 'bg-indigo-100 text-indigo-700', bar: 'bg-indigo-500', dot: 'bg-indigo-500', hover: 'hover:border-indigo-300', soft: 'bg-indigo-50', text: 'text-indigo-800', ring: 'ring-indigo-200', active: 'bg-indigo-700 text-white border-indigo-700', color: 'rgb(var(--c-indigo-500))' },
  pink: { name: 'pink', chip: 'bg-pink-100 text-pink-900 border-pink-200', tile: 'bg-pink-100 text-pink-700', bar: 'bg-pink-500', dot: 'bg-pink-500', hover: 'hover:border-pink-300', soft: 'bg-pink-50', text: 'text-pink-800', ring: 'ring-pink-200', active: 'bg-pink-700 text-white border-pink-700', color: 'rgb(var(--c-pink-500))' },
  teal: { name: 'teal', chip: 'bg-teal-100 text-teal-900 border-teal-200', tile: 'bg-teal-100 text-teal-700', bar: 'bg-teal-500', dot: 'bg-teal-500', hover: 'hover:border-teal-300', soft: 'bg-teal-50', text: 'text-teal-800', ring: 'ring-teal-200', active: 'bg-teal-700 text-white border-teal-700', color: 'rgb(var(--c-teal-500))' },
  amber: { name: 'amber', chip: 'bg-amber-100 text-amber-900 border-amber-200', tile: 'bg-amber-100 text-amber-700', bar: 'bg-amber-500', dot: 'bg-amber-500', hover: 'hover:border-amber-300', soft: 'bg-amber-50', text: 'text-amber-800', ring: 'ring-amber-200', active: 'bg-amber-700 text-white border-amber-700', color: 'rgb(var(--c-amber-500))' },
  purple: { name: 'purple', chip: 'bg-purple-100 text-purple-900 border-purple-200', tile: 'bg-purple-100 text-purple-700', bar: 'bg-purple-500', dot: 'bg-purple-500', hover: 'hover:border-purple-300', soft: 'bg-purple-50', text: 'text-purple-800', ring: 'ring-purple-200', active: 'bg-purple-700 text-white border-purple-700', color: 'rgb(var(--c-purple-500))' },
  blue: { name: 'blue', chip: 'bg-blue-100 text-blue-900 border-blue-200', tile: 'bg-blue-100 text-blue-700', bar: 'bg-blue-500', dot: 'bg-blue-500', hover: 'hover:border-blue-300', soft: 'bg-blue-50', text: 'text-blue-800', ring: 'ring-blue-200', active: 'bg-blue-700 text-white border-blue-700', color: 'rgb(var(--c-blue-500))' },
  orange: { name: 'orange', chip: 'bg-orange-100 text-orange-900 border-orange-200', tile: 'bg-orange-100 text-orange-700', bar: 'bg-orange-500', dot: 'bg-orange-500', hover: 'hover:border-orange-300', soft: 'bg-orange-50', text: 'text-orange-800', ring: 'ring-orange-200', active: 'bg-orange-700 text-white border-orange-700', color: 'rgb(var(--c-orange-500))' },
  cyan: { name: 'cyan', chip: 'bg-cyan-100 text-cyan-900 border-cyan-200', tile: 'bg-cyan-100 text-cyan-700', bar: 'bg-cyan-500', dot: 'bg-cyan-500', hover: 'hover:border-cyan-300', soft: 'bg-cyan-50', text: 'text-cyan-800', ring: 'ring-cyan-200', active: 'bg-cyan-700 text-white border-cyan-700', color: 'rgb(var(--c-cyan-500))' },
  lime: { name: 'lime', chip: 'bg-lime-100 text-lime-900 border-lime-200', tile: 'bg-lime-100 text-lime-700', bar: 'bg-lime-500', dot: 'bg-lime-500', hover: 'hover:border-lime-300', soft: 'bg-lime-50', text: 'text-lime-800', ring: 'ring-lime-200', active: 'bg-lime-700 text-white border-lime-700', color: 'rgb(var(--c-lime-500))' },
  red: { name: 'red', chip: 'bg-red-100 text-red-900 border-red-200', tile: 'bg-red-100 text-red-700', bar: 'bg-red-500', dot: 'bg-red-500', hover: 'hover:border-red-300', soft: 'bg-red-50', text: 'text-red-800', ring: 'ring-red-200', active: 'bg-red-700 text-white border-red-700', color: 'rgb(var(--c-red-500))' },
  sky: { name: 'sky', chip: 'bg-sky-100 text-sky-900 border-sky-200', tile: 'bg-sky-100 text-sky-700', bar: 'bg-sky-500', dot: 'bg-sky-500', hover: 'hover:border-sky-300', soft: 'bg-sky-50', text: 'text-sky-800', ring: 'ring-sky-200', active: 'bg-sky-700 text-white border-sky-700', color: 'rgb(var(--c-sky-500))' },
  violet: { name: 'violet', chip: 'bg-violet-100 text-violet-900 border-violet-200', tile: 'bg-violet-100 text-violet-700', bar: 'bg-violet-500', dot: 'bg-violet-500', hover: 'hover:border-violet-300', soft: 'bg-violet-50', text: 'text-violet-800', ring: 'ring-violet-200', active: 'bg-violet-700 text-white border-violet-700', color: 'rgb(var(--c-violet-500))' },
  fuchsia: { name: 'fuchsia', chip: 'bg-fuchsia-100 text-fuchsia-900 border-fuchsia-200', tile: 'bg-fuchsia-100 text-fuchsia-700', bar: 'bg-fuchsia-500', dot: 'bg-fuchsia-500', hover: 'hover:border-fuchsia-300', soft: 'bg-fuchsia-50', text: 'text-fuchsia-800', ring: 'ring-fuchsia-200', active: 'bg-fuchsia-700 text-white border-fuchsia-700', color: 'rgb(var(--c-fuchsia-500))' },
  emerald: { name: 'emerald', chip: 'bg-emerald-100 text-emerald-900 border-emerald-200', tile: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500', dot: 'bg-emerald-500', hover: 'hover:border-emerald-300', soft: 'bg-emerald-50', text: 'text-emerald-800', ring: 'ring-emerald-200', active: 'bg-emerald-700 text-white border-emerald-700', color: 'rgb(var(--c-emerald-500))' },
  rose: { name: 'rose', chip: 'bg-rose-100 text-rose-900 border-rose-200', tile: 'bg-rose-100 text-rose-700', bar: 'bg-rose-500', dot: 'bg-rose-500', hover: 'hover:border-rose-300', soft: 'bg-rose-50', text: 'text-rose-800', ring: 'ring-rose-200', active: 'bg-rose-700 text-white border-rose-700', color: 'rgb(var(--c-rose-500))' },
};

/** topic (taxonomy slug, need domain, rights need, situation family, news / tool / glossary topic, pro reason code) → tone */
/** @type {Record<string, string>} */
const TOPIC_TONE = {
  // the 13 catalogue categories (CategoryChip)
  'papiers-citoyennete': 'indigo', famille: 'pink', 'social-sante': 'teal', 'personnes-agees': 'amber', handicap: 'purple', 'travail-formation': 'blue',
  logement: 'orange', transports: 'cyan', argent: 'lime', justice: 'red', etranger: 'sky', loisirs: 'fuchsia', 'lgbtqi-plus': 'rose',
  // the 20 need domains (data/reference/social-domains.v1.json)
  precarite: 'emerald', 'protection-enfance': 'pink', 'enfance-jeunesse': 'violet', autonomie: 'amber', sante: 'teal', 'sante-mentale': 'teal',
  violences: 'rose', 'protection-majeurs': 'red', migration: 'sky', emploi: 'blue', budget: 'lime', numerique: 'indigo', mobilite: 'cyan',
  discrimination: 'rose', 'lien-social': 'teal', transversal: 'slate',
  // the /droits needs (data/reference/rights-public-view.v1.json)
  'crise-suicide': 'teal', 'violences-conjugales': 'rose', 'hebergement-urgence': 'orange', energie: 'orange', 'expulsion-impayes': 'orange',
  'sortie-ase': 'violet', 'droits-sans-titre': 'sky', aidants: 'amber', 'aide-domicile': 'amber', 'accessibilite-mobilite': 'purple', 'mdph-droits': 'purple',
  psy: 'teal', surendettement: 'lime', 'recherche-emploi': 'blue', 'minima-sociaux': 'emerald', isolement: 'teal', 'aides-logement': 'orange',
  'acces-aux-droits': 'indigo', 'adaptation-logement': 'orange', 'garde-enfants': 'pink', 'scolarite-inclusive': 'violet', 'prestations-familiales': 'pink',
  // /situation families, home situations
  'argent-emploi': 'lime', jeunes: 'violet', seniors: 'amber', senior: 'amber', etrangers: 'sky', quotidien: 'slate', etudiant: 'violet', travail: 'blue',
  // aliases and other vocabularies (news topics, official tools, glossary, data·inclusion themes)
  papiers: 'indigo', administratif: 'indigo', droits: 'indigo', politique: 'indigo', orientation: 'cyan', enfance: 'pink', education: 'violet',
  social: 'teal', 'sante-': 'teal', retraite: 'amber', vieillissement: 'amber', insertion: 'blue', economie: 'blue', entreprises: 'blue', formation: 'blue',
  hebergement: 'orange', 'logement-hebergement': 'orange', accessibilite: 'purple', accompagnement: 'teal', mobilité: 'cyan', credit: 'lime',
  environnement: 'lime', etrangers_: 'sky', international: 'sky', culture: 'fuchsia', sport: 'fuchsia', technologie: 'indigo', lgbtqia: 'rose', lgbtqi: 'rose',
  societe: 'slate', strasbourg: 'emerald', une: 'slate', urgence: 'red',
  // ADA Pro orientation reason codes
  housing: 'orange', employment: 'blue', training: 'blue', income_budget: 'lime', mobility: 'cyan', digital: 'indigo', health: 'teal', family: 'pink',
  childcare: 'pink', legal: 'red', administrative: 'indigo', energy: 'orange', admin_procedures: 'indigo', access_to_rights: 'indigo',
  specialised_support: 'teal', other: 'slate', food: 'emerald', isolation: 'teal', disability: 'purple', elderly: 'amber',
};

/** the kind of content (catalogue, search results, favourites) */
/** @type {Record<string, Tone>} */
export const CONTENT_TONE = {
  aide: TONES.blue, aides: TONES.blue, demarche: TONES.violet, demarches: TONES.violet, structure: TONES.orange, structures: TONES.orange,
  guide: TONES.teal, guides: TONES.teal, actualite: TONES.pink, actualites: TONES.pink, outil: TONES.amber, outils: TONES.amber,
  dispositif: TONES.emerald, dispositifs: TONES.emerald, ressource: TONES.cyan, ressources: TONES.cyan, evenement: TONES.fuchsia, evenements: TONES.fuchsia,
  assistant: TONES.cyan, simulateur: TONES.amber, simulator: TONES.amber,
};

/** the sections of the personal spaces (Mon Espace, ADA Pro, administration): one colour each, the same in the menu, the tiles and the page header */
/** @type {Record<string, Tone>} */
export const SECTION_TONE = {
  parcours: TONES.violet, coffre: TONES.indigo, favoris: TONES.amber, profil: TONES.slate, parametres: TONES.slate, partages: TONES.teal, dossiers: TONES.teal,
  orientations: TONES.sky, 'rendez-vous': TONES.blue, rdv: TONES.blue, agenda: TONES.blue, messages: TONES.emerald, historique: TONES.slate,
  confiance: TONES.pink, delegations: TONES.pink, accompagnant: TONES.cyan, accompagnement: TONES.cyan, protection: TONES.red, moderation: TONES.rose,
  situation: TONES.lime, evenements: TONES.fuchsia, entraide: TONES.emerald, notifications: TONES.amber, guide: TONES.teal,
  dashboard: TONES.blue, services: TONES.violet, disponibilites: TONES.cyan, absences: TONES.amber, structure: TONES.orange, equipe: TONES.pink,
  team: TONES.pink, audit: TONES.slate, impact: TONES.teal, observatoire: TONES.sky, regional: TONES.sky, cases: TONES.teal, referrals: TONES.sky,
  organisations: TONES.orange, utilisateurs: TONES.pink, catalogue: TONES.violet, contenus: TONES.violet, selections: TONES.violet, securite: TONES.indigo,
  privacy: TONES.indigo, journal: TONES.slate, veille: TONES.slate, visio: TONES.cyan, ia: TONES.indigo, support: TONES.emerald,
};

const fold = (/** @type {unknown} */ s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * @param {string | null | undefined} topic a slug, a code (HOUSING) or a French label (« Santé », « Personnes âgées »)
 * @param {string} [fallback]
 * @returns {Tone}
 */
export function topicTone(topic, fallback = 'slate') {
  const k = fold(topic).replace(/\s+/g, '-');
  const name = TOPIC_TONE[k] || TOPIC_TONE[k.replace(/-/g, '_')] || TOPIC_TONE[k.split(/[-_]/)[0]] || fallback;
  return TONES[name] || TONES.slate;
}

/** @param {string | null | undefined} kind @param {string} [fallback] @returns {Tone} */
export const contentTone = (kind, fallback = 'blue') => CONTENT_TONE[fold(kind)] || TONES[fallback];
/** @param {string | null | undefined} section @param {string} [fallback] @returns {Tone} */
export const sectionTone = (section, fallback = 'blue') => SECTION_TONE[fold(section)] || TONES[fallback];

/** the kind of place (type of structure: a slug or a FINESS / SIRENE label) → its family colour */
/** @param {string | null | undefined} type @returns {Tone} */
export function structureTone(type) {
  const s = fold(type).replace(/_/g, ' ');
  if (!s) return TONES.slate;
  if (/ehpad|personnes agees|residence autonomie|accueil de jour|gerontolog|autonomie|carsat|retraite/.test(s)) return TONES.amber;
  if (/handicap|esat|savs|samsah|sessad|\bime\b|\bmas\b|\bfam\b|mdph|itep|camsp|medico.?educ/.test(s)) return TONES.purple;
  if (/hebergement|chrs|logement|foyer|residence sociale|pension de famille|cada|huda|maison relais/.test(s)) return TONES.orange;
  if (/sante|soins|hopital|hospital|clinique|medic|ssiad|cpam|pmi|psychiat|addict|csapa|caarud|pharmac/.test(s)) return TONES.teal;
  if (/enfan|famille|creche|parent|\bcaf\b/.test(s)) return TONES.pink;
  if (/france.travail|emploi|insertion|mission locale/.test(s)) return TONES.blue;
  if (/mairie|ccas|service.?public|france services|prefecture|tribunal|maison de justice/.test(s)) return TONES.indigo;
  if (/association/.test(s)) return TONES.violet;
  return TONES.slate;
}
