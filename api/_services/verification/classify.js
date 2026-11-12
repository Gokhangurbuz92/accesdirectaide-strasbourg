// @ts-nocheck
/**
 * Catalogue (12/11/2026) — the classification of an official Service-Public fiche: which kind of record it is (aide, démarche, dispositif / guide), which of the
 * 20 domains and 86 subdomains of data/reference/social-domains.v1.json it serves, and the taxonomy category the public pages filter on.
 *
 * Deterministic and explainable: every decision carries its reasons (the words and structured parts of the fiche that made it). Where the evidence is not
 * clear the fiche is PENDING with the reason — never a category invented to place it. Replaces the former SOCIAL_PATH whitelist (about thirty phrases), which
 * kept most of the Service-Public catalogue (identity papers, civil status, taxes, consumer debts, schooling, transport…) out of the platform.
 */
import fs from 'node:fs';
import path from 'node:path';

/** the reference, read once when a fiche is classified (the deployed functions carry data/** — vercel.json includeFiles — and run from the project root) */
let REF = null;
const ref = () => (REF ||= JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/reference/social-domains.v1.json'), 'utf8')));

/** the public taxonomy (api/_handlers/taxonomy.js, /api/taxonomy): the only category slugs the Aides / Démarches chips filter on */
export const TAXONOMY_CATEGORIES = Object.freeze(['papiers-citoyennete', 'famille', 'social-sante', 'personnes-agees', 'handicap', 'travail-formation', 'logement', 'transports',
  'argent', 'justice', 'etranger', 'loisirs', 'lgbtqi-plus']);

/**
 * Former category values found in the catalogue (hand-written or legacy imports) and the taxonomy category they mean. Before this map 8 of the 16 public aides of
 * Production (« social », « santé », « mobilite », « credit »…) matched no category chip: they were listed only without a filter.
 */
export const CATEGORY_ALIASES = Object.freeze({
  social: 'social-sante', sante: 'social-sante', 'santé': 'social-sante', 'social-santé': 'social-sante', precarite: 'social-sante', urgence: 'social-sante',
  mobilite: 'transports', 'mobilité': 'transports', transport: 'transports', credit: 'argent', 'crédit': 'argent', budget: 'argent', dettes: 'argent', impots: 'argent',
  emploi: 'travail-formation', formation: 'travail-formation', travail: 'travail-formation', 'personnes-agées': 'personnes-agees', seniors: 'personnes-agees', autonomie: 'personnes-agees',
  papiers: 'papiers-citoyennete', citoyennete: 'papiers-citoyennete', etrangers: 'etranger', 'étranger': 'etranger', culture: 'loisirs', sport: 'loisirs', 'travail-formation': 'travail-formation',
});
/** the taxonomy category of a stored value (null when it has none) @param {unknown} v */
export function canonicalCategory(v) {
  const s = String(v ?? '').trim().toLowerCase(); if (!s) return null;
  if (TAXONOMY_CATEGORIES.includes(s)) return s;
  return CATEGORY_ALIASES[s] || CATEGORY_ALIASES[fold(s)] || null;
}
/** every stored value that means this taxonomy category (the filter matches them all) @param {string} slug */
export function categoryVariants(slug) {
  const c = canonicalCategory(slug); if (!c) return [String(slug)];
  return [c, ...Object.entries(CATEGORY_ALIASES).filter(([, v]) => v === c).map(([k]) => k)].filter((x, i, a) => a.indexOf(x) === i);
}

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** whole-word match, accent-blind (JS \b is not accent-aware) */
/** whole word, accent-blind, singular or plural (« impôts » matches « Impôt sur le revenu ») */
const wordRe = (k) => { const f = fold(k); const stem = /^[a-z]{4,}s$/.test(f) ? f.slice(0, -1) : f; return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(stem)}${stem !== f || /^[a-z]{4,}$/.test(f) ? 's?' : ''}(?![\\p{L}\\p{N}])`, 'u'); };
/** reference keywords too general to place a fiche on their own (« Impôt sur le revenu » is not a minimum income; « formation » alone is not a training right) */
const GENERIC = new Set(['revenu', 'budget', 'formation', 'transport', 'parents', 'recours', 'culture', 'sport', 'loisirs', 'ecole', 'scolarite', 'detention', 'naissance', 'placement']);
/** words the reference lacks for a subdomain (audit 12/11/2026: « carte de séjour » never reached titre-sejour, « Impôt » never reached impots) */
const EXTRA = Object.freeze({ 'migration/titre-sejour': ['carte de séjour', 'carte de résident', 'certificat de résidence'], 'famille/garde-enfants': ['mode de garde'], 'budget/impots': ['impôt', 'fiscal'] });
/**
 * words that place a fiche only inside their own theme: « expulsion » of a foreigner is not a rent arrears, « pension alimentaire » is not food aid, « loyer »
 * in a rent rule is not a housing benefit, « alcool » at the wheel is not an addiction (audit: about 40 fiches)
 */
const THEME_BOUND = new Set(['expulsion', 'loyer', 'alimentaire', 'alcool', 'drogue', 'electricite', 'seniors', 'bourse', 'tutelle', 'dettes', 'impayes']);
let SUBS = null;
const subdomainsOf = () => (SUBS ||= ref().domains.flatMap((d) => d.subdomains.map((s) => ({ domain: d.id, id: s.id, legacy: (d.legacy?.taxonomy || []),
  res: [...s.keywords, ...(EXTRA[`${d.id}/${s.id}`] || [])].filter((k) => fold(k).length >= 3 && !GENERIC.has(fold(k))).map((k) => ({ k, bound: THEME_BOUND.has(fold(k)), re: wordRe(k) })) }))));

/**
 * The Service-Public theme (first element of the fiche's path) → the platform's category and the domain a fiche falls back to when no subdomain word matches.
 * A theme absent from this list (or a fiche with no path) is PENDING.
 */
/** Social - Santé without a subdomain word: the second level of the path says which domain (audit S3: health fiches fell to « précarité ») */
const SOCIAL_SECOND = [[/rembours|pr[ée]vention|hospitali|patient|don du sang|covid|compl[ée]mentaire sant|soins|m[ée]dic|sant[ée]/i, 'sante'], [/addiction/i, 'sante-mentale'],
  [/personnes? [âa]g[ée]es?/i, 'autonomie'], [/handicap/i, 'handicap']];   // « retraite » and « invalidité » are social protection, not autonomy or disability
export const THEMES = Object.freeze([
  { re: /^Social - Sant/i, categorie: 'social-sante', domain: 'precarite' },
  { re: /^Logement/i, categorie: 'logement', domain: 'logement' },
  { re: /^Famille/i, categorie: 'famille', domain: 'famille' },
  { re: /^Travail/i, categorie: 'travail-formation', domain: 'emploi' },
  { re: /^Argent/i, categorie: 'argent', domain: 'budget' },
  { re: /^Justice/i, categorie: 'justice', domain: 'justice' },
  { re: /^[ÉE]tranger/i, categorie: 'etranger', domain: 'migration' },
  { re: /^Papiers/i, categorie: 'papiers-citoyennete', domain: 'transversal' },
  { re: /^Transports/i, categorie: 'transports', domain: 'mobilite' },
  { re: /^Loisirs/i, categorie: 'loisirs', domain: 'lien-social' },
]);
/** the domain → the taxonomy category when the subdomain decides it (the reference's legacy.taxonomy, first entry that is a public category) */
let DC = null;
const domainCategory = (id) => (DC ||= Object.fromEntries(ref().domains.map((d) => [d.id, (d.legacy?.taxonomy || []).find((c) => TAXONOMY_CATEGORIES.includes(c)) || null])))[id] || null;
/** the category of these domains says more than the Service-Public theme (« Social - Santé > Handicap » is handicap, not social-sante) */
const SPECIFIC = new Set(['handicap', 'autonomie', 'migration', 'violences', 'justice', 'protection-majeurs', 'logement', 'famille', 'protection-enfance', 'emploi']);

/** the fiche kinds that are a page of the catalogue (a dossier groups fiches; a question-answer and a « comment faire si » are guides of their own, later) */
export const CATALOGUE_KINDS = /^Fiche d'information( conditionn[ée]e)?$/i;
/** the coverage of a fiche that concerns people in Strasbourg (empty = France entière in the flux) */
export const OUR_COVERAGE = /^\s*$|France enti[èe]re|M[ée]tropole|France m[ée]tropolitaine|Alsace|Moselle|Bas-Rhin|Grand Est/i;

const AIDE_TITLE = /^(aides?\b|aide financi[èe]re|allocation|prime|revenu|prestation|compl[ée]ment\b|compl[ée]mentaire sant[ée] solidaire|ch[èe]que|bourse|pass\b|fonds de solidarit|microcr[ée]dit|tarif social|r[ée]duction d.imp[ôo]t|cr[ée]dit d.imp[ôo]t|majoration|capital d[ée]c[èe]s|pension (de r[ée]version|d.orphelin|d.invalidit)|minimum vieillesse|asf\b|ma ?prime|[ée]co-pr[êe]t|pr[êe]t (à taux z[ée]ro|d.accession sociale|conventionn|à l.am[ée]lioration|[ée]tudiant|avance)|rente)/i;
/** a title « Thème : Objet » or « Objet - précision » is judged on each part (« Personne âgée : aide financière… ») */
const parts = (title) => [title, ...String(title).split(/\s:\s|\s-\s/).slice(1)].map((x) => x.trim()).filter(Boolean);
const anyPart = (re, title) => parts(title).some((x) => re.test(x));
/** a guide titled « Vous … : aides financières » lists aids, it is not one */
const GUIDE_OF_AIDS = /^vous\b/i;
/** fiches written for one city's rules (rent control…), whatever their coverage element says */
const OTHER_CITY = /^(Paris|Lyon( et Villeurbanne)?|Bordeaux|Montpellier|Est Ensemble|Plaine Commune|Lille( Hellemmes Lomme)?|Grenoble|Pays Basque|Marseille|Toulouse|Nice|Nantes)\b[^:]*:/i;
/** public agents' own rules (an audience of its own, shown as such) */
const PUBLIC_AGENTS = /fonction publique|agent public|agents publics|fonctionnaire|contractuel de la fonction/i;
/** the particulier-employeur and labour-law fiches stay in travail-formation (audit S5) */
const LABOUR = /employeur|salari|contrat de travail|licenciement|d[ée]mission|cong[ée]s pay[ée]s|paie|salaire|temps de travail|p[ée]riode d.essai/i;
const DISPOSITIF_TITLE = /^(contrat d.engagement|contrat d.insertion|parcours|service civique|garantie|dispositif|programme|accompagnement)/i;
/** a procedure: what the person does (a request, a declaration, a document to obtain, a change to report, a recourse) */
const DEMARCHE_TITLE = /^(carte (de s[ée]jour|de r[ée]sident|europ[ée]enne|mobilit[ée]|de collectionneur|talent)|certificat de r[ée]sidence|changer|d[ée]marches?\b|piratage|usurpation|arnaque|recouvrement|indemnisation|cure\b|demande|d[ée]clar|carte (nationale )?d.identit|passeport|permis|certificat|acte\b|extrait|attestation|inscription|immatriculation|changement|signal|comment|contest|recours|r[ée]clamation|obtenir|faire\b|renouvel|duplicata|perte|vol\b|naissance\b|mariage|pacs|divorce|reconnaissance|adoption|d[ée]c[èe]s|succession|procuration|vote|carte grise|s[ée]jour|titre de s[ée]jour|naturalisation|visa|r[ée]siliation|plainte|saisir|r[ée]gularisation|rachat|transfert|d[ée]m[ée]nagement)/i;
const AMOUNT_HEAD = /montant|combien|calcul|versement|bar[èe]me|plafond de ressources/i;
const PROCEDURE_HEAD = /d[ée]marche|comment (faire|demander|obtenir|proc[ée]der)|o[ùu] s'adresser|pi[èe]ces|formulaire|t[ée]l[ée]service|en ligne|d[ée]lai/i;

/**
 * @param {{ id: string, kind?: string, title: string, description?: string, path?: {title: string}[], coverage?: string, subject?: string, audience?: string }} meta
 * @param {{ text?: string, online?: {type?: string, title?: string}[], whereToGo?: unknown[] } | null} [src] the parsed fiche (optional: without it the kind rests on the title)
 * @returns {{ ok: boolean, kind: 'aide'|'demarche'|'dispositif'|null, categorie: string|null, domain: string|null, subdomain: string|null, subdomains: string[], confidence: 'high'|'medium'|null, reasons: string[], pending?: string }}
 */
export function classifyFiche(meta, src = null) {
  const reasons = [];
  const out = (o) => ({ ok: false, kind: null, categorie: null, domain: null, subdomain: null, subdomains: [], confidence: null, reasons, ...o });
  if (!CATALOGUE_KINDS.test(String(meta.kind || ''))) return out({ pending: 'NOT_A_CATALOGUE_KIND' });
  if (!OUR_COVERAGE.test(String(meta.coverage || '')) || OTHER_CITY.test(String(meta.title || ''))) return out({ pending: 'COVERAGE_ELSEWHERE' });
  // the bread-crumb starts at the portal's home (« Accueil particuliers ») and ends on the fiche itself: the theme is the first level below the home
  const pathTitles = (meta.path || []).filter((x) => x.id !== meta.id && !/^Accueil /i.test(x.title || '')).map((x) => x.title);
  const theme = THEMES.find((t) => t.re.test(pathTitles[0] || ''));
  if (!theme) return out({ pending: 'THEME_UNMAPPED' });
  reasons.push(`thème Service-Public « ${pathTitles[0]} »`);

  // subdomains: keywords of the reference in the title (3), the fiche's path (2), its official description (1)
  const T = fold(meta.title); const P = fold(pathTitles.slice(1).join(' > ')); const D = fold(meta.description);
  const scored = subdomainsOf().map((s) => {
    let score = 0; const hits = [];
    const compatible = s.legacy.includes(theme.categorie);
    for (const { k, re, bound } of s.res) { if (bound && !compatible) continue; const w = (re.test(T) ? 3 : 0) + (re.test(P) ? 2 : 0) + (re.test(D) ? 1 : 0); if (w) { score += w; hits.push(k); } }
    return { ...s, score, hits };
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  const best = scored[0] || null;
  const subdomains = scored.filter((s) => s.score >= 2).map((s) => `${s.domain}/${s.id}`).slice(0, 4);
  if (best) reasons.push(`mots du référentiel : ${best.hits.slice(0, 3).join(', ')} → ${best.domain}/${best.id}`);
  const placed = best && best.score >= 2;
  const fallback = theme.categorie === 'social-sante' ? (SOCIAL_SECOND.find(([re]) => re.test(pathTitles.slice(1).join(' ') + ' ' + meta.title))?.[1] || theme.domain) : theme.domain;
  const domain = placed ? best.domain : fallback;
  const subdomain = placed ? best.id : null;
  const labour = theme.categorie === 'travail-formation' && LABOUR.test(meta.title);
  const categorie = (!labour && SPECIFIC.has(domain) && domainCategory(domain)) || theme.categorie;

  // kind: the title, then the structure of the fiche (chapters on the amount, a procedure, an online service)
  const heads = String(src?.text || '').split('\n').filter((l) => /^#{2,4} /.test(l)).join(' ');
  const online = (src?.online || []).map((o) => `${o.type || ''} ${o.title || ''}`).join(' ');
  const signals = {
    aide: (!GUIDE_OF_AIDS.test(meta.title) && anyPart(AIDE_TITLE, meta.title) ? 2 : 0) + (AMOUNT_HEAD.test(heads) ? 1 : 0),
    // audit K1: an online form or a « où s'adresser » chapter alone made 218 démarches, half of them wrong — the structure counts only with a procedure title
    demarche: anyPart(DEMARCHE_TITLE, meta.title) ? 2 + (/t[ée]l[ée]service|formulaire/i.test(online) ? 1 : 0) + (PROCEDURE_HEAD.test(heads) ? 1 : 0) : 0,
    dispositif: DISPOSITIF_TITLE.test(meta.title) ? 3 : 0,
  };
  let kind;
  if (signals.dispositif >= 3) kind = 'dispositif';
  else if (signals.aide >= 2 && signals.aide >= signals.demarche) kind = 'aide';
  else if (signals.demarche >= 2) kind = 'demarche';
  else if (signals.aide >= 2) kind = 'aide';
  else kind = 'dispositif';   // an official explanation of a right or a rule, neither a benefit nor a procedure: the guide kind
  reasons.push(`nature : ${kind} (titre et structure : aide ${signals.aide}, démarche ${signals.demarche}, dispositif ${signals.dispositif})`);
  // a benefit title with a procedure title as strong (« Carte Mobilité Inclusion », « Chèque énergie : demande ») stays a candidate for a person to decide
  if (signals.aide >= 2 && signals.demarche >= 3 && kind === 'aide') return out({ pending: 'KIND_AMBIGUOUS', domain, subdomain, categorie, subdomains });
  const audience = PUBLIC_AGENTS.test(meta.title) ? 'agents-publics' : 'particuliers';
  return { ok: true, kind, categorie, domain, subdomain, subdomains, audience, confidence: subdomain ? 'high' : 'medium', reasons };
}
