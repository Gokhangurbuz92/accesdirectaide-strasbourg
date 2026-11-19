// @ts-check
/**
 * G8 (19/11/2026) — « sensitive step » classification of Mon Parcours, so that the legal surface stays as small as possible while counsel has not answered.
 *
 * Why: a tracked step can REVEAL a special category of data (RGPD art. 9: health, disability, sex life / sexual orientation) or data on offences (art. 10),
 * or a fact that is not art. 9 but exposes the person (right of residence, legal protection measure, violence suffered) — through its title, the need it is
 * filed under, the catalogue record it points at (« Allocation aux adultes handicapés », a CSAPA…), the organisation named as the actor, or the free-text note.
 *
 * What it is: a DETERMINISTIC guard (no model, no network), applied by the server only (api/_services/mon-espace.js), on three inputs:
 *   - the need (planStep.need): the subdomains of data/reference/social-domains.v1.json listed in SENSITIVE_NEEDS;
 *   - any text the step would store or show: title, note, organisation name, link labels, and the title / category / type of each catalogue record;
 *   - a catalogue category that is itself sensitive (« sante », « handicap »…).
 * What it is NOT: a guarantee. A person can always describe a health matter in words this list does not know; the screen therefore also asks, in plain
 * words, not to write such information (title and note). The limits are stated in CONTROL/master/completion/G8_MON_PARCOURS_COUNSEL_QUESTIONS_FR.md.
 *
 * Modes (ADA_PARCOURS_SENSITIVE_STEPS, read at call time):
 *   unset / any other value  « excluded » — a sensitive step, note, need or organisation name is REFUSED (nothing stored);
 *   exactly « consent »      a sensitive step is stored only with the person's explicit, per-step consent (art. 9.2.a), recorded on the step; it needs the
 *                            "planStep" column (migration 0046) to record that consent — without it the mode stays « excluded ».
 * In every mode a sensitive step is never shown to a delegate (api/_services/delegation.js) and the plan import never copies one.
 */

/** @typedef {'health' | 'disability' | 'addiction' | 'immigration' | 'justice' | 'legal_protection' | 'sexual_life' | 'violence'} SensitiveCategory */

/** @type {Readonly<Record<string, SensitiveCategory>>} the subdomains (needs) whose mere presence on a step reveals a sensitive fact */
export const SENSITIVE_NEEDS = Object.freeze({
  // health (art. 9)
  'centres-sante': 'health', pass: 'health', psy: 'health', 'crise-suicide': 'health', 'fin-de-vie': 'health', 'aide-domicile': 'health',
  'ehpad-residences': 'health', 'apa-aspa': 'health', 'grossesse-naissance': 'health',
  // disability (health data, art. 9)
  'mdph-droits': 'disability', 'enfants-handicap': 'disability', 'adultes-hebergement': 'disability', 'vie-sociale': 'disability', 'travail-handicap': 'disability',
  'accessibilite-mobilite': 'disability', 'adaptation-logement': 'disability', 'transport-adapte': 'disability', 'scolarite-inclusive': 'disability',
  // addiction (health data, art. 9)
  addictions: 'addiction',
  // right of residence (not art. 9, but exposes the person)
  'titre-sejour': 'immigration', asile: 'immigration', 'protection-temporaire': 'immigration', 'droits-sans-titre': 'immigration', mna: 'immigration',
  // offences, convictions (art. 10)
  'pjj-spip': 'justice',
  // legal protection of adults (reveals an impairment of faculties)
  mesures: 'legal_protection', mjpm: 'legal_protection',
  // sex life, sexual orientation (art. 9)
  lgbtqi: 'sexual_life', 'violences-sexuelles': 'sexual_life', 'sante-sexuelle': 'sexual_life',
  // violence suffered (exposes the person, also to a delegate)
  'violences-conjugales': 'violence', 'traite-exploitation': 'violence', 'maltraitance-ages': 'violence', signalement: 'violence',
});

/** catalogue categories (Aide / Démarche / Guide « categorie ») that are themselves sensitive, normalised */
export const SENSITIVE_RECORD_CATEGORIES = Object.freeze({ sante: 'health', handicap: 'disability', addictions: 'addiction', addiction: 'addiction', 'sante mentale': 'health',
  migration: 'immigration', asile: 'immigration' });

/** neutral phrases removed before matching (they contain a listed word without revealing anything: health insurance, a housing « mutuelle »…) */
const NEUTRAL = [/\bassurance maladie\b/g, /\bcaisse primaire d assurance maladie\b/g, /\bcomplementaire sante( solidaire)?\b/g, /\bcarte vitale\b/g];

/** the word list, on NORMALISED text (lower case, no accents, punctuation → space). Word boundaries on both sides unless the entry ends with \w* */
/** @type {ReadonlyArray<[SensitiveCategory, string]>} */
const LEXICON = [
  ['health', 'malad\\w*|medecin\\w*|docteur|hopital\\w*|hospitali\\w*|clinique|psychiatr\\w*|psycholog\\w*|psy|cmpp?|bapu|depressi\\w*|suicid\\w*|cancer\\w*|chimio\\w*|diabet\\w*'
    + '|vih|sida|hepatite\\w*|ivg|avortement|contracepti\\w*|grossesse|enceinte|accouchement|depistage|cegidd|sante mentale|soins? palliatifs?|fin de vie|dialyse|ald'
    + '|affection de longue duree|invalidit\\w*|accident du travail|ssiad|ehpad|alzheimer|autis\\w*|tdah|traitement medical|medicament\\w*|therap\\w*|kine\\w*|infirmi\\w*'
    + '|vaccin\\w*|soins|allocation personnalisee d autonomie|perte d autonomie|permanence d acces aux soins'],
  ['disability', 'handicap\\w*|mdph|aah|pch|aeeh|rqth|cmi|carte mobilite inclusion|esat|savs|samsah|ime|sessad|camsp|itep|aesh|maprimeadapt|fauteuil roulant|cap emploi'
    + '|sourd\\w*|malvoyant\\w*|aveugle\\w*|transport adapte'],
  ['addiction', 'addict\\w*|csapa|caarud|alcool\\w*|drogue\\w*|toxico\\w*|cannabis|heroine|cocaine|methadone|subutex|sevrage'],
  ['immigration', 'titres? de sejour|cartes? de sejour|oqtf|asile|refugie\\w*|ofpra|cnda|ofii|cada|huda|sans papiers|regularisation (du sejour|de (sa |la )?situation administrative)|ame|aide medicale (d|de l) etat'
    + '|protection subsidiaire|protection temporaire|apatride\\w*|naturalisation|contrat d integration republicaine|mineurs? non accompagnes?|mna|anef'],
  ['justice', 'spip|pjj|detention|detenu\\w*|prison\\w*|incarcer\\w*|casier judiciaire|condamn\\w*|sursis probatoire|peine avec sursis|probation|bracelet electronique|garde a vue|controle judiciaire'
    + '|travail d interet general|tig|amenagement de peine'],
  ['legal_protection', 'tutelle|curatelle|sauvegarde de justice|mjpm|mandataires? judiciaires?|habilitation familiale'],
  ['sexual_life', 'orientation sexuelle|lgbt\\w*|homosexu\\w*|lesbienne\\w*|gay|bisexu\\w*|transgenre\\w*|intersexe\\w*|violences? sexuelles?|viol|agression sexuelle|prostitution'
    + '|travail du sexe|sante sexuelle'],
  ['violence', 'violences? conjugales?|violences? intrafamiliales?|3919|maltraitance\\w*|traite des etres humains|victimes?|ordonnance de protection|emprise'],
];
const LEXICON_RE = LEXICON.map(([category, words]) => /** @type {[SensitiveCategory, RegExp]} */ ([category, new RegExp(`(?:^| )(?:${words})(?= |$)`)]));

/** lower case, no accents, every non letter / digit → one space @param {unknown} v */
export function normaliseText(v) {
  if (typeof v !== 'string') return '';
  let s = ` ${v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  for (const re of NEUTRAL) s = s.replace(re, ' ');
  return s.replace(/ +/g, ' ').trim();
}

/** the sensitive categories one text reveals (empty = none found) @param {unknown} text @returns {SensitiveCategory[]} */
export function sensitiveTextCategories(text) {
  const s = normaliseText(text);
  if (!s) return [];
  return LEXICON_RE.filter(([, re]) => re.test(s)).map(([c]) => c);
}

/**
 * The classification of a step from everything it would store or show.
 * @param {{ texts?: unknown[], need?: unknown, recordCategories?: unknown[] }} input
 * @returns {{ sensitive: boolean, categories: SensitiveCategory[] }}
 */
export function classifyParcoursStep({ texts = [], need = null, recordCategories = [] } = {}) {
  /** @type {Set<SensitiveCategory>} */ const out = new Set();
  if (typeof need === 'string' && Object.prototype.hasOwnProperty.call(SENSITIVE_NEEDS, need)) out.add(SENSITIVE_NEEDS[need]);
  for (const c of recordCategories) {
    const k = normaliseText(c);
    if (k && Object.prototype.hasOwnProperty.call(SENSITIVE_RECORD_CATEGORIES, k)) out.add(/** @type {SensitiveCategory} */ (SENSITIVE_RECORD_CATEGORIES[/** @type {keyof typeof SENSITIVE_RECORD_CATEGORIES} */ (k)]));
  }
  for (const t of texts) for (const c of sensitiveTextCategories(t)) out.add(c);
  return { sensitive: out.size > 0, categories: [...out].sort() };
}

/** @param {Record<string, string | undefined>} [env] @returns {'excluded' | 'consent'} */
export const parcoursSensitiveMode = (env = process.env) => (String(env.ADA_PARCOURS_SENSITIVE_STEPS || '').trim() === 'consent' ? 'consent' : 'excluded');

/**
 * G8 — the free-text note of a step. Unset / any other value: kept (500 characters, a visible request not to write health information, the same
 * sensitive-words guard as the title, never shown to a delegate, never sent to any organisation). Exactly « off »: no new note can be written; an
 * existing note can still be read, exported and cleared by the person. Foreseen for counsel's answer « the free text must go ».
 * @param {Record<string, string | undefined>} [env] @returns {boolean}
 */
export const parcoursNotesOpen = (env = process.env) => String(env.ADA_PARCOURS_NOTES || '').trim() !== 'off';
