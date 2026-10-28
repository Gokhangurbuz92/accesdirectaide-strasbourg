// @ts-nocheck
/**
 * Automatic verification chain — the texts a person reads: a normal summary (clear French) and a FALC version that is really easier (short sentences, everyday
 * words, « vous », acronyms explained), both written from the official source and nothing else.
 *
 * The local model (Ollama on this machine, qwen3:8b, no cloud: api/lib/ai-foundation.js generateBackgroundLocalStructuredContent) only drafts. A draft is kept
 * only when it passes every automatic check:
 *   1. no invented number: every number of the texts (amounts, ages, durations, dates, percentages) is in the official source;
 *   2. FALC rules (src/components/features/falc/falc.rules.md): sentences of 15 words at most (12 on average), « vous », acronyms explained the first time,
 *      no administrative jargon left unexplained, not a copy of the official sentences, really different from the normal summary;
 *   3. faithfulness: a second, independent reading by the model checks every sentence against the source and refuses any sentence the source does not say.
 * A failed draft is retried once with the reasons; if it still fails, nothing is written (the record keeps its previous texts) and the chain tries again on its
 * next run. No text is ever published because a model said so: the checks decide, and the official page stays linked on every record.
 */
import { z } from 'zod';
import { generateBackgroundLocalStructuredContent } from '../../lib/ai-foundation.js';

const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'");

// ---------------------------------------------------------------------------------------------------------------- source excerpt
const PRIORITY = /condition|qui peut|b[ée]n[ée]fici|droit|montant|calcul|combien|d[ée]marche|comment|demande|pi[èe]ces|document|d[ée]lai|o[ùu] s'adresser|versement|recours|dur[ée]e/i;
/**
 * The part of the official text the model reads (a whole fiche can be 30 000 characters): the introduction, then the chapters about conditions, amount and
 * procedure, then the rest, within the budget. @param {{ title?: string, description?: string, text: string }} src @param {number} [budget]
 */
export function sourceExcerpt(src, budget = 14000) {
  const blocks = []; let cur = { head: '(intro)', lines: [] };
  for (const line of String(src.text || '').split('\n')) {
    if (/^#{2,4} /.test(line) && cur.lines.length) { blocks.push(cur); cur = { head: line, lines: [line] }; } else cur.lines.push(line);
  }
  blocks.push(cur);
  const ranked = blocks.map((b, i) => ({ ...b, i, p: i === 0 ? 0 : PRIORITY.test(b.head) ? 1 : 2 })).sort((a, b) => a.p - b.p || a.i - b.i);
  const chosen = []; let used = 0;
  for (const b of ranked) {
    const t = b.lines.join('\n').trim(); if (!t) continue;
    if (used + t.length > budget) { if (b.p < 2 && used < budget * 0.8) { chosen.push({ i: b.i, t: t.slice(0, budget - used) }); used = budget; } continue; }
    chosen.push({ i: b.i, t }); used += t.length + 2;
  }
  chosen.sort((a, b) => a.i - b.i);
  return [src.title ? `# ${src.title}` : '', src.description ? `Résumé officiel : ${src.description}` : '', ...chosen.map((c) => c.t)].filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------------------------------------------------------- explanations (deterministic)
/** Acronyms of social rights and public bodies, explained in plain words (the FALC text gets the explanation in brackets at the first use). */
export const ACRONYM_EXPLAINED = {
  APL: 'aide personnalisée au logement', ALF: 'allocation de logement familiale', ALS: 'allocation de logement sociale', CAF: "Caisse d'allocations familiales",
  Caf: "Caisse d'allocations familiales", Cnaf: "Caisse nationale des allocations familiales", MSA: 'Mutualité sociale agricole', CPAM: "caisse d'assurance maladie",
  RSA: 'revenu de solidarité active', AAH: 'allocation aux adultes handicapés', PCH: 'prestation de compensation du handicap', AEEH: "allocation d'éducation de l'enfant handicapé",
  APA: "allocation personnalisée d'autonomie", Apa: "allocation personnalisée d'autonomie", C2S: 'complémentaire santé solidaire', MDPH: 'maison départementale des personnes handicapées',
  CCAS: "centre communal d'action sociale", UE: 'Union européenne', EEE: 'Espace économique européen', IFI: 'impôt sur la fortune immobilière', HLM: 'logement social',
  TER: 'train express régional', AME: "aide médicale de l'État", ASPA: 'allocation de solidarité aux personnes âgées', ASS: 'allocation de solidarité spécifique',
  ARE: "allocation chômage de France Travail", FSL: 'fonds de solidarité pour le logement', Anah: "Agence nationale de l'habitat", ANAH: "Agence nationale de l'habitat",
  ANEF: 'site internet des démarches pour les étrangers', ANTS: 'Agence nationale des titres sécurisés', OFII: "Office français de l'immigration et de l'intégration",
  CIDFF: "centre d'information sur les droits des femmes et des familles", PMI: 'protection maternelle et infantile', CLIC: "centre d'information pour les personnes âgées",
  SIAO: "service d'accueil et d'orientation pour l'hébergement", DALO: 'droit au logement opposable', Ehpad: 'maison de retraite médicalisée', EHPAD: 'maison de retraite médicalisée',
  FJT: 'foyer de jeunes travailleurs', RIB: "relevé d'identité bancaire", Paje: "prestation d'accueil du jeune enfant", PAJE: "prestation d'accueil du jeune enfant",
  ASF: 'allocation de soutien familial', CNI: "carte nationale d'identité", SMIC: 'salaire minimum', Smic: 'salaire minimum', FAJ: "fonds d'aide aux jeunes",
  CeA: "Collectivité européenne d'Alsace", MDS: 'maison des solidarités', CDAD: "conseil départemental de l'accès au droit", Crous: 'service des aides aux étudiants',
  CROUS: 'service des aides aux étudiants', CMU: 'couverture maladie universelle', 'CMU-C': 'ancienne complémentaire santé gratuite', URSSAF: 'organisme qui collecte les cotisations sociales',
  Urssaf: 'organisme qui collecte les cotisations sociales', CARSAT: 'caisse de retraite', Carsat: 'caisse de retraite', CNAV: 'Assurance retraite', SNCF: 'société des trains',
  QPV: 'quartier prioritaire de la ville', RQTH: 'reconnaissance de la qualité de travailleur handicapé', ESAT: 'établissement où travaillent des personnes handicapées',
  CDAPH: 'commission qui décide des droits des personnes handicapées', DOM: "départements d'outre-mer", CPF: 'compte personnel de formation', SNU: 'service national universel',
  AVE: 'aide aux vacances des enfants', AVF: 'aide aux vacances des familles', CMI: 'carte mobilité inclusion', AJ: 'aide juridictionnelle', RFR: "revenu fiscal de référence (écrit sur l'avis d'impôt)",
  CMG: "aide pour payer la garde d'un enfant", ASI: "allocation supplémentaire d'invalidité", IME: 'institut médico-éducatif', MVA: 'majoration pour la vie autonome',
  ARS: 'agence régionale de santé', CESU: 'chèque emploi service universel', CERFA: 'formulaire officiel', Cerfa: 'formulaire officiel', PDF: 'document à imprimer',
};
/** Administrative words → the plain words put in brackets after them in a FALC text (words that cannot be explained stay forbidden: see JARGON). */
export const JARGON_EXPLAINED = {
  ressources: "l'argent que vous recevez", bénéficiaire: "la personne qui reçoit l'aide", bénéficiaires: "les personnes qui reçoivent l'aide", éligible: 'qui a le droit',
  éligibilité: "le droit à l'aide", prestation: 'aide', prestations: 'aides', plafond: 'montant maximum', plafonds: 'montants maximum', allocataire: "personne qui reçoit l'aide",
  allocataires: "personnes qui reçoivent l'aide", ménage: 'les personnes qui vivent ensemble', 'foyer fiscal': 'les personnes déclarées ensemble aux impôts',
  'quotient familial': 'un calcul selon vos revenus et votre famille', 'revenu fiscal de référence': "un montant écrit sur votre avis d'impôt", justificatif: 'papier qui prouve',
  justificatifs: 'papiers qui prouvent', 'pièce justificative': 'papier qui prouve', 'pièces justificatives': 'papiers qui prouvent', modalités: 'façon de faire',
  notification: 'lettre officielle', 'recours gracieux': 'demande de revoir la décision', contentieux: 'procédure devant le juge', cumulable: 'possible en même temps',
  cumuler: 'avoir en même temps', dérogation: 'exception', 'instruction du dossier': 'étude de votre demande', subsidiaire: 'en dernier recours',
};
/**
 * Administrative words a FALC text never needs, replaced by their plain word where the replacement keeps the grammar (same person, same agreement):
 * « percevez » → « recevez », « prétendre à » → « avoir droit à », « documents requis » → « documents demandés »…
 */
const W = (w) => new RegExp(`(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, 'giu');   // a whole word, accents included (\\b is not accent-aware)
export const FALC_REPLACE = [
  [W('percevoir'), 'recevoir'], [W('percevez'), 'recevez'], [W('perçoit'), 'reçoit'], [W('perçoivent'), 'reçoivent'], [W('percevra'), 'recevra'], [W('percevrez'), 'recevrez'],
  [W('perçu(e?s?)'), 'reçu$1'], [W('prétendre à'), 'avoir droit à'], [W('prétendre aux'), 'avoir droit aux'], [W('prétendre au'), 'avoir droit au'],
  [W('requis'), 'demandés'], [W('requise'), 'demandée'], [W('requises'), 'demandées'], [W('sous réserve de'), 'à condition de'], [W('conformément à'), 'selon'],
  [W('conformément aux'), 'selon les'], [W('ouvrant droit à'), 'qui donne droit à'], [W('octroyée'), 'accordée'], [W('octroyé'), 'accordé'], [W('octroi'), 'accord'],
  [W('attribuée sous conditions'), 'donnée si vous remplissez des conditions'], [W('afin de'), 'pour'],
];
/** FALC lines with the plain words, and a line made of two sentences joined by « ; » split in two @param {string[]} lines */
export function plainWords(lines) {
  return lines.flatMap((l) => {
    let x = String(l);
    for (const [re, to] of FALC_REPLACE) x = x.replace(re, (m, ...g) => { const r = to.replace(/\$1/, typeof g[0] === 'string' ? g[0] : ''); return m[0] === m[0].toUpperCase() && m[0] !== m[0].toLowerCase() ? r[0].toUpperCase() + r.slice(1) : r; });
    return x.split(/\s*;\s+/).map((p, i, all) => { const t = p.trim(); if (!t) return null; const cap = t[0].toUpperCase() + t.slice(1); return i < all.length - 1 && !/[.!?…]$/.test(cap) ? `${cap}.` : cap; }).filter(Boolean);
  });
}
const escapeRe = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Explanations available for a source: the fiche's own acronyms (« Abreviation ») and the « Nom complet (SIGLE) » definitions, then the lists above.
 * @param {{ abbreviations?: Record<string, string>, definitions?: Record<string, string> }} src
 */
const SMALL = new Set(['de', 'des', 'du', 'la', 'le', 'les', 'l', 'd', 'et', 'à', 'a', 'aux', 'au', 'pour', 'en', 'sur', 'par']);
/**
 * Acronyms the official text explains itself: « … la commission des droits et de l'autonomie des personnes handicapées (CDAPH) » → CDAPH = the shortest run of
 * words before the brackets whose main words start with the acronym's letters. @param {string} text @returns {Record<string, string>}
 */
export function acronymsFromText(text) {
  const out = {};
  for (const m of String(text || '').matchAll(/((?:[\p{L}'’-]+\s+){1,14})\(([A-Z][A-Za-z]{1,8})\)/gu)) {
    const acr = m[2]; if (out[acr]) continue;
    const words = m[1].trim().split(/\s+/);
    for (let k = 2; k <= words.length; k += 1) {
      const run = words.slice(-k); const main = run.flatMap((w) => w.split(/['’]/)).filter((w) => w && !SMALL.has(w.toLowerCase()));
      if (main.map((w) => w[0].toUpperCase()).join('') === acr.toUpperCase()) { out[acr] = run.join(' ').replace(/^[ld]['’]/i, ''); break; }
    }
  }
  return out;
}
export function explanationsFor(src = {}) {
  const map = { ...ACRONYM_EXPLAINED };
  for (const [k, v] of Object.entries(acronymsFromText(src.text))) if (!map[k] && v.length <= 90) map[k] = v;
  for (const k of Object.keys(src.definitions || {})) { const m = k.match(/^(.{3,80}?)\s*\(([A-Za-zÀ-ÿ0-9-]{2,10})\)$/); if (m && !map[m[2]]) map[m[2]] = m[1].trim(); }
  for (const [k, v] of Object.entries(src.abbreviations || {})) if (k && v && !map[k] && v.length <= 90) map[k] = v.replace(/\.$/, '');
  return map;
}
/**
 * Add the explanation in brackets after the FIRST use of every known acronym and administrative word of a FALC text (lines kept as lines; a term already
 * followed by brackets is left as it is). @param {string[]} lines @param {Record<string, string>} acronyms
 */
export function explainFirstUse(lines, acronyms = ACRONYM_EXPLAINED) {
  const done = new Set(); const out = [];
  const terms = [...Object.entries(acronyms).map(([k, v]) => ({ k, v, re: new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRe(k)})(?![\\p{L}\\p{N}])(\\s*\\()?`, 'u') })),
    ...Object.entries(JARGON_EXPLAINED).map(([k, v]) => ({ k: k.toLowerCase(), v, re: new RegExp(`(^|[^\\p{L}])(${escapeRe(k)}${k.includes(' ') ? '' : '[sx]?'})(?![\\p{L}])(\\s*\\()?`, 'iu') }))].sort((a, b) => b.k.length - a.k.length);
  for (const line of lines) {
    let l = line;
    for (const t of terms) {
      if (done.has(t.k)) continue;
      const m = l.match(t.re); if (!m) continue;
      done.add(t.k);
      if (m[3]) continue;   // already explained
      // the expansion may already be written next to it (« aide personnalisée au logement (APL) » or « APL, aide personnalisée… »)
      if (norm(l).includes(norm(t.v))) continue;
      const at = m.index + m[1].length + m[2].length;
      const before = l.slice(0, at);
      if ((before.match(/\(/g) || []).length > (before.match(/\)/g) || []).length) continue;   // inside brackets already: no nested explanation
      l = `${before} (${t.v})${l.slice(at)}`;
    }
    out.push(l);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- checks (pure)
/** Numbers of a text, normalized (« 30 000 € » → 30000, « 1 148,90 » → 1148,90). @param {string} text */
export function numbersOf(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g)) out.add(m[0].replace(/[ \u00a0\u202f]/g, ''));
  return out;
}
/** Numbers of `output` that the source does not contain. @param {string} output @param {string} source */
export function inventedNumbers(output, source) {
  const src = numbersOf(source); const srcPlain = new Set([...src].map((n) => n.replace(/,0+$/, '')));
  return [...numbersOf(output)].filter((n) => !src.has(n) && !srcPlain.has(n.replace(/,0+$/, '')));
}
/** Sentences of a text (also one per line / bullet). @param {string | string[]} t */
export function sentences(t) {
  const text = Array.isArray(t) ? t.join('\n') : String(t || '');
  return text.split(/\n+/).flatMap((l) => l.replace(/^\s*[-•*]\s*/, '').split(/(?<=[.!?…])\s+(?=[A-ZÀ-ÖØ-Ý«"])/)).map(squash).filter((s) => s.length > 1);
}
/** words of a sentence, the explanations in brackets not counted (FALC: « le mot difficile (son explication) ») */
export const wordCount = (s) => squash(String(s).replace(/\([^)]{0,140}\)/g, ' ').replace(/(\d)[ \u00a0\u202f](?=\d{3}(?!\d))/g, '$1')).split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length;   // « 31 162,62 » is one word

/** Administrative words a FALC text must not use without an explanation in brackets right after. */
export const JARGON = ['ressources', 'percevoir', 'perçoit', 'perçu', 'percevez', 'bénéficiaire', 'bénéficiaires', 'éligible', 'éligibilité', 'prestation', 'prestations',
  'plafond', 'plafonds', 'conformément', 'afférent', 'allocataire', 'allocataires', 'ménage', 'foyer fiscal', 'quotient familial', 'revenu fiscal de référence', 'justificatif',
  'justificatifs', 'nonobstant', 'subsidiaire', 'cumulable', 'cumuler', 'modalités', 'octroi', 'octroyée', 'dérogation', 'instruction du dossier', 'ouvrant droit',
  'sous réserve', 'attribuée sous conditions', 'pièce justificative', 'pièces justificatives', 'notification', 'recours gracieux', 'contentieux', 'prétendre', 'requis', 'requise', 'requises'];
const ACRONYM = /\b(?:[A-Z][A-Z0-9]{1,6}|C2S)\b/g;
/** acronyms of a text (CAF, APL, C2S…; plus the title-case ones the official fiche defines, e.g. « Caf », « Ehpad ») @param {string} text @param {string[]} [known] */
export function acronymsOf(text, known = []) {
  const found = new Set((String(text || '').match(ACRONYM) || []).filter((a) => !/^[IVXLC]+$/.test(a) && !/^[A-Z]\d$/.test(a)));   // not roman numerals, not « A1 » (licence category)
  for (const k of known) if (k && new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) found.add(k);
  return [...found];
}
const explained = (text, acr) => new RegExp(`(\\b${acr}\\b\\s*\\()|(\\([^)]*\\b${acr}\\b[^)]*\\))`).test(text);
const trigrams = (s) => { const w = norm(s).split(/[^a-z0-9]+/).filter(Boolean); const g = new Set(); for (let i = 0; i + 2 < w.length; i += 1) g.add(w.slice(i, i + 3).join(' ')); return g; };
export function similarity(a, b) { const A = trigrams(a); const B = trigrams(b); if (!A.size || !B.size) return 0; let c = 0; for (const x of A) if (B.has(x)) c += 1; return c / Math.min(A.size, B.size); }

/**
 * Every check of a set of texts against the source. Returns the problems, in French, ready to be sent back to the model for the second attempt.
 * @param {{ resume: string, pour_qui?: string[], montant?: string | null, etapes?: string[] }} normal
 * @param {{ resume: string[], pour_qui?: string[], montant?: string | null, etapes?: string[] }} falc
 * @param {string} source the official text @param {{ acronyms?: string[] }} [opts]
 */
export function checkTexts(normal, falc, source, opts = {}) {
  const problems = [];
  const normalText = [normal.resume, ...(normal.pour_qui || []), normal.montant || '', ...(normal.etapes || [])].join('\n');
  const falcLines = [...(falc.resume || []), ...(falc.pour_qui || []), falc.montant || '', ...(falc.etapes || [])].filter(Boolean);
  const falcText = falcLines.join('\n');
  // 1. numbers
  const inv = [...new Set([...inventedNumbers(normalText, source), ...inventedNumbers(falcText, source)])];
  if (inv.length) problems.push(`Ces nombres ne sont pas dans la fiche officielle : ${inv.join(', ')}. N'écrivez que les nombres de la fiche.`);
  // 2a. normal summary shape
  const ns = sentences(normal.resume);
  if (ns.length < 2 || ns.length > 6) problems.push(`Le résumé normal doit avoir 2 à 6 phrases (il en a ${ns.length}).`);
  if (squash(normal.resume).length < 120 || squash(normal.resume).length > 900) problems.push('Le résumé normal doit faire entre 120 et 900 caractères.');
  // 2b. FALC rules
  const fs = sentences(falcLines);
  // short sentences: none over 18 words, at most one in five over 15, 13 on average at most (the explanations in brackets not counted)
  const tooLong = fs.filter((s) => wordCount(s) > 18); const long = fs.filter((s) => wordCount(s) > 15);
  if (tooLong.length || long.length > Math.max(1, Math.floor(fs.length * 0.2))) problems.push(`Phrases FALC trop longues : « ${(tooLong.length ? tooLong : long).slice(0, 3).join(' » ; « ')} ». Coupez-les en phrases de 12 mots au plus.`);
  const avg = fs.length ? fs.reduce((n, s) => n + wordCount(s), 0) / fs.length : 0;
  if (avg > 13) problems.push(`Les phrases FALC font ${avg.toFixed(1)} mots en moyenne : visez 8 à 10 mots.`);
  if ((falc.resume || []).length < 3 || (falc.resume || []).length > 9) problems.push('Le résumé FALC doit avoir 3 à 9 phrases courtes.');
  if (!/\bvous\b/i.test(falcText)) problems.push('Le texte FALC doit parler à la personne avec « vous ».');
  // a difficult word inside an explanation in brackets, or in the very name of the right (« Prestation de compensation du handicap »), is not a FALC fault
  // (a word explained at one of its uses — « vos ressources (l'argent que vous recevez) » — is accepted: the explanation is given where the reader meets it first)
  const name = opts.title ? String(opts.title).replace(/\s*\([^)]*\)\s*/g, ' ').trim() : '';
  const text = name.length > 3 ? falcText.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'), ' ') : falcText;
  const jargon = JARGON.filter((w) => {
    let used = false; let explainedOnce = false;
    for (const m of text.matchAll(new RegExp(`(^|[^\\p{L}])(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${w.includes(' ') ? '' : '[sx]?'})(?![\\p{L}])`, 'giu'))) {
      const before = text.slice(0, m.index + m[1].length);
      if ((before.match(/\(/g) || []).length > (before.match(/\)/g) || []).length) continue;   // inside an explanation
      used = true;
      if (/^\s*\(/.test(text.slice(m.index + m[0].length))) explainedOnce = true;
    }
    return used && !explainedOnce;
  });
  if (jargon.length) problems.push(`Mots difficiles à remplacer par des mots simples (ou à expliquer entre parenthèses juste après) : ${jargon.join(', ')}.`);
  const acr = acronymsOf(falcText, opts.acronyms || Object.keys(ACRONYM_EXPLAINED)).filter((a) => !explained(falcText, a));
  if (acr.length) problems.push(`Sigles à expliquer la première fois, entre parenthèses (ex. : « la Caf (Caisse d'allocations familiales) ») : ${acr.join(', ')}.`);
  if (/\b(est|sont|a été|ont été|sera|seront)\s+\p{L}+(é|ée|és|ées|is|ise|it|ite|u|ue|us|ues)\s+par\b/iu.test(falcText)) problems.push('Pas de phrase passive (« est versée par… ») : écrivez « La Caf verse… ».');
  const srcSentences = new Set(sentences(source).map((s) => norm(s)));
  const copied = fs.filter((s) => wordCount(s) >= 6 && srcSentences.has(norm(s)));
  if (fs.length && copied.length / fs.length > 0.25) problems.push('Le FALC recopie des phrases de la fiche : réécrivez-les plus simplement.');
  const sim = similarity((falc.resume || []).join(' '), normal.resume);
  if (sim >= 0.5) problems.push('Le FALC ressemble trop au résumé normal : il doit être plus simple, avec des phrases plus courtes et d\'autres mots.');
  return { ok: problems.length === 0, problems, stats: { falcSentences: fs.length, falcAvgWords: Number(avg.toFixed(1)), falcMaxWords: fs.reduce((m, s) => Math.max(m, wordCount(s)), 0), similarity: Number(sim.toFixed(2)), inventedNumbers: inv } };
}

/** Version of the text rules: texts written under older rules are written again by the chain (api/_services/verification/chain.js). */
export const TEXT_RULES_VERSION = 2;

/**
 * What the official text explicitly says is NOT a condition (« La PCH est attribuée sans condition de ressources ») must not come back as one in the conditions or
 * the summaries — the resources may still change the amount, which the amount part says. @returns {{ part: string, sentence: string, raison: string }[]}
 */
export const NOT_A_CONDITION = [
  { source: /(sans|aucune|pas de) conditions? de ressources/i, label: 'la fiche dit qu’il n’y a pas de condition de ressources (elles changent seulement le montant)',
    claim: /conditions?\b[^.]{0,80}\bressources\b|\b(ressources|revenus)\b[^.]{0,50}\b(inférieur|ne (doivent|doit) pas dépasser|ne dépasse|plafond|maximum|moins de|faibles|modestes|limitées)/i },
  { source: /(sans|aucune|pas de) conditions? d['’]âge/i, label: 'la fiche dit qu’il n’y a pas de condition d’âge',
    claim: /conditions?\b[^.]{0,80}\bâge\b|\b(moins|plus) de \d+ ans\b|\bavoir (au moins|plus de|moins de) \d+ ans\b/i },
];
/**
 * A sentence of the source that removes a condition only in some cases (« … sans condition de ressources des parents », « pas de conditions de ressources si vous
 * répondez aux 4 conditions suivantes », « Prise en charge sans condition de ressources : des frais de transport… »): an exception, not the general rule — the
 * condition still exists for everybody else, so writing it is not a contradiction (aide juridictionnelle, Aspa, PCH… read from the archive of 2026-10-25).
 */
const QUALIFIED = /\bsi\b|\blorsque\b|\bquand\b|\bsauf\b|\btoutefois\b|par d[ée]rogation|dans certains cas|\b(aux|pour les|pour l['’]|à l['’]enfant|des parents)\b|:|\bvictimes?\b|\bmineurs?\b/i;
const generalStatements = (source, re) => String(source || '').split(/(?<=[.!?])\s+|\n+/).filter((x) => re.test(x) && !QUALIFIED.test(x.replace(re, ' ').replace(/^.*?(sans|aucune|pas de)\s/i, ' ')));
export function contradictions(normal, falc, source) {
  const out = [];
  for (const rule of NOT_A_CONDITION) {
    if (!rule.source.test(source) || !generalStatements(source, rule.source).length) continue;
    const scan = (part, list) => { for (const sentence of list) if (rule.claim.test(String(sentence).replace(/\([^)]*\)/g, ' '))) out.push({ part, sentence, raison: rule.label }); };
    scan('normal.resume', sentences(normal.resume)); scan('normal.pour_qui', normal.pour_qui || []);
    scan('falc.resume', falc.resume || []); scan('falc.pour_qui', falc.pour_qui || []);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- generation
const NORMAL_SCHEMA = z.object({
  resume: z.string().min(40).max(1200),
  pour_qui: z.array(z.string().min(3).max(400)).min(1).max(8),
  montant: z.string().max(600).nullable(),
  etapes: z.array(z.string().min(3).max(400)).max(8),
  documents: z.array(z.string().min(3).max(300)).max(10),
});
const FALC_SCHEMA = z.object({
  resume: z.array(z.string().min(3).max(200)).min(2).max(10),
  pour_qui: z.array(z.string().min(3).max(200)).max(8),
  montant: z.array(z.string().min(3).max(200)).max(8),
  etapes: z.array(z.string().min(3).max(200)).max(8),
});
const JUDGE_SCHEMA = z.object({ verdicts: z.array(z.object({ n: z.number().int(), ok: z.boolean(), raison: z.string().max(300) })) });

const NORMAL_SYSTEM = `Tu rédiges pour AccesDirectAide, un service d'information sociale gratuit. À partir d'une fiche officielle (Service-Public.gouv.fr ou un site public), tu écris un résumé clair pour le grand public.
Règles :
- Utilise UNIQUEMENT ce que dit la fiche. N'ajoute rien, ne devine rien.
- Recopie exactement les montants, âges, durées et dates de la fiche. N'écris aucun autre nombre.
- Si la fiche distingue plusieurs situations, dis-le simplement (« selon votre situation »).
- Pour les conditions, les délais, les dates de début et de versement, reprends le sens exact de la fiche, sans le reformuler (« à partir du mois qui suit la demande » reste « la demande »).
- Écris au présent, en français clair, en vouvoyant le lecteur. Pas de « nous ».
Réponds uniquement en JSON.`;
const NORMAL_TASK = `Écris en JSON :
- "resume" : 3 à 5 phrases : ce que c'est, pour qui, ce que cela apporte, comment le demander ;
- "pour_qui" : les conditions principales, 2 à 6 éléments courts ;
- "montant" : ce que la fiche dit du montant (ou null si elle n'en parle pas) ;
- "etapes" : 2 à 6 étapes pour faire la demande, dans l'ordre (vide si la fiche n'en parle pas) ;
- "documents" : les documents à fournir cités par la fiche (vide sinon).`;
const FALC_SYSTEM = `Tu écris en FALC (Facile à lire et à comprendre), selon les règles européennes. Le lecteur peut avoir du mal à lire, ou bien apprendre le français.
Règles :
- Une idée par phrase. 12 mots au plus par phrase. Phrases simples : sujet, verbe, complément.
- Mots de tous les jours. Parle au lecteur avec « vous ». Voix active.
- Explique chaque sigle la première fois, entre parenthèses. Exemple : « la Caf (Caisse d'allocations familiales) ».
- Remplace les mots difficiles : ressources → l'argent que vous recevez ; percevoir → recevoir ; bénéficiaire → la personne qui reçoit l'aide ; plafond → montant maximum ; éligible → avoir le droit ; prestation → aide ; justificatif → papier qui prouve.
- Garde exactement les montants et les âges de la fiche. N'écris aucun autre nombre. N'invente rien.
- Ne recopie pas les phrases de la fiche : réécris-les plus simplement.
Exemple. Avant : « L'aide personnalisée au logement est une prestation sociale versée par la CAF sous conditions de ressources afin de réduire la charge locative. »
Après : « L'APL (aide personnalisée au logement) vous aide à payer votre loyer. » « La Caf (Caisse d'allocations familiales) verse cette aide. » « Vous devez gagner peu d'argent. »
Réponds uniquement en JSON.`;
const FALC_TASK = `Écris en JSON, en FALC :
- "resume" : 4 à 8 phrases très courtes : c'est quoi, pour qui, combien, comment faire ;
- "pour_qui" : qui a le droit, 2 à 6 phrases très courtes ;
- "montant" : combien, en phrases très courtes, une phrase par cas (exemple : « Si vous êtes seul : 10 421 € au plus par an. ») ; liste vide si la fiche ne dit rien ;
- "etapes" : comment faire, 2 à 6 phrases très courtes qui commencent par un verbe (exemple : « Remplissez le formulaire. »).`;
const JUDGE_SYSTEM = `Tu es contrôleur qualité. Tu compares des phrases à une fiche officielle. Tu es strict : une phrase est correcte seulement si la fiche dit la même chose.
Une phrase est fausse si elle ajoute une information absente de la fiche, change une condition, un montant, un âge ou un délai, exagère, ou promet quelque chose que la fiche ne promet pas.
Contrôle avec le plus grand soin les conditions, les délais, les dates de début ou de versement, les montants et les personnes concernées : un seul mot qui change le sens rend la phrase fausse (par exemple « après le traitement du dossier » au lieu de « après la demande »).
Attention aux conditions : présenter comme une CONDITION pour avoir droit ce qui, dans la fiche, sert seulement à CALCULER le montant ou le taux est faux (par exemple un plafond de ressources qui ne change que le taux).
Une phrase plus simple qui dit la même chose avec d'autres mots est correcte. Une explication de sigle entre parenthèses est correcte. Réponds uniquement en JSON.`;

const asLines = (a) => (Array.isArray(a) ? a.map(squash).filter(Boolean) : []);
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));

/**
 * Normal summary + FALC for one record, from its official source. Returns { ok: true, normal, falc, checks, attempts, model, ms } or { ok: false, reasons, draft }.
 * @param {{ title: string, description?: string, text: string, abbreviations?: Record<string, string>, definitions?: Record<string, string> }} src the official source
 *   (dila.parseFiche or pages.readOfficialPage)
 * deps.modelOptions: options of the local model for this run (resources.js: threads) — never the checks, which are the same at every attempt and every run.
 * @param {{ generate?: Function, signal?: AbortSignal, judge?: boolean, modelOptions?: Record<string, any> }} [deps]
 */
export async function writeTexts(src, deps = {}) {
  const generate = deps.generate || generateBackgroundLocalStructuredContent;
  const fullSource = `${src.title || ''}\n${src.description || ''}\n${src.text}`;
  const excerpt = sourceExcerpt(src, 9000); const shortExcerpt = sourceExcerpt(src, 5000);
  const explain = explanationsFor(src); const acronyms = Object.keys(explain);
  const started = Date.now(); const reasons = []; let model = null; let attempts = 0;
  const call = async (systemInstruction, prompt, zodSchema, temperature = 0.2) => {
    // R14: the run's heartbeat between model calls (up to 12 calls of up to 180 s): a silent run was declared dead after 20 min and a second one started beside it
    if (deps.beat && !(await deps.beat())) return { error: 'veille arrêtée pendant l’écriture des textes' };
    attempts += 1;
    const out = await generate({ systemInstruction, prompt, zodSchema, signal: deps.signal, options: { temperature, ...(deps.modelOptions || {}) } }).catch((e) => ({ safeErrorState: String(e?.message || e).slice(0, 120) }));
    if (!out || out.safeErrorState || !out.content) return { error: `modèle local indisponible ou réponse invalide (${out?.safeErrorState || 'vide'})` };
    model = out.model || model; return { content: out.content };
  };
  const block = (ex) => `Fiche officielle :\n<<<\n${ex}\n>>>`;

  // up to two rounds: a sentence the faithfulness reading refuses comes back to the model once, with the reason
  let normal = null; let judgeNormal = ''; let judgeFalc = '';
  for (let round = 0; round < 2; round += 1) {
    // 1. the normal summary (numbers and shape checked; two attempts) — written again in the second round only when one of its sentences was refused
    if (!normal || judgeNormal) {
      normal = null; let feedback = judgeNormal;
      for (let i = 0; i < 2 && !normal; i += 1) {
        const r = await call(NORMAL_SYSTEM, `${block(excerpt)}\n\n${NORMAL_TASK}${feedback}`, NORMAL_SCHEMA);
        if (r.error) return { ok: false, reasons: [...reasons, r.error], model, ms: Date.now() - started };
        const n = { resume: squash(r.content.resume), pour_qui: asLines(r.content.pour_qui), montant: r.content.montant ? squash(r.content.montant) : null, etapes: asLines(r.content.etapes), documents: asLines(r.content.documents) };
        const c = checkNormal(n, fullSource);
        if (c.length) { reasons.push(...c.map((p) => `résumé, essai ${i + 1} : ${p}`)); feedback = `${judgeNormal}${refusedBlock(c)}`; } else normal = n;
      }
      if (!normal) return { ok: false, reasons, model, ms: Date.now() - started };
    }

    // 2. the FALC version (explanations added at the first use of every acronym / difficult word of each part; three attempts)
    const facts = `Résumé normal déjà vérifié (le FALC doit dire la même chose, plus simplement) :\n${normal.resume}\nPour qui : ${normal.pour_qui.join(' ; ')}\nMontant : ${normal.montant || '—'}\nÉtapes : ${normal.etapes.join(' ; ') || '—'}`;
    let falc = null; let stats = null; let draft = null; let feedback = judgeFalc;
    for (let i = 0; i < 3 && !falc; i += 1) {
      const r = await call(FALC_SYSTEM, `${block(shortExcerpt)}\n\n${facts}\n\n${FALC_TASK}${feedback}`, FALC_SCHEMA, 0.2 + 0.25 * i);   // a different draft on each attempt
      if (r.error) { reasons.push(r.error); break; }
      const prep = (lines) => explainFirstUse(plainWords(asLines(lines)), explain);
      const amounts = Array.isArray(r.content.montant) ? r.content.montant : r.content.montant ? [r.content.montant] : [];
      const f = { resume: prep(r.content.resume), pour_qui: prep(r.content.pour_qui), montant: amounts.length ? prep(amounts).join('\n') : null, etapes: prep(r.content.etapes) };
      draft = f;
      const c = checkTexts(normal, f, fullSource, { acronyms, title: src.title });
      if (!c.ok) { reasons.push(...c.problems.map((p) => `FALC, essai ${i + 1} : ${p}`)); feedback = `${judgeFalc}${refusedBlock(c.problems)}`; continue; }
      falc = f; stats = c.stats;
    }
    if (!falc) return { ok: false, reasons, model, draft: { normal, falc: draft }, ms: Date.now() - started };

    // 3. the independent faithfulness reading: a refused list item is removed; a refused summary or amount sentence goes back to the model once, then fails the texts
    if (deps.judge === false) return { ok: true, normal, falc, checks: { ...stats, rules: TEXT_RULES_VERSION, faithfulness: null }, attempts, model, ms: Date.now() - started };
    const parts = { 'normal.resume': sentences(normal.resume), 'normal.pour_qui': normal.pour_qui, 'normal.montant': normal.montant ? [normal.montant] : [], 'normal.etapes': normal.etapes, 'normal.documents': normal.documents || [],   // R14: the documents list was never read
      'falc.resume': falc.resume, 'falc.pour_qui': falc.pour_qui, 'falc.montant': falc.montant ? falc.montant.split('\n').filter(Boolean) : [], 'falc.etapes': falc.etapes };
    const flat = Object.entries(parts).flatMap(([part, list]) => list.map((sentence) => ({ part, sentence })));
    const j = await judge(flat.map((x) => x.sentence), excerpt, call);
    if (j.error) return { ok: false, reasons: [...reasons, j.error], model, draft: { normal, falc }, ms: Date.now() - started };
    // the reader's refusals, plus what the official text explicitly says is not a condition
    const refused = [...j.refused.map((r) => ({ ...flat[r.index], raison: r.raison })), ...contradictions(normal, falc, fullSource)];
    const blocking = refused.filter((r) => /resume|montant/.test(r.part));
    if (blocking.length) {
      reasons.push(...blocking.map((r) => `fidélité, tour ${round + 1} : « ${clip(r.sentence, 160)} » n'est pas confirmé par la fiche (${r.raison}).`));
      if (round === 1) return { ok: false, reasons, model, draft: { normal, falc }, ms: Date.now() - started };
      const lines = (pre) => blocking.filter((r) => r.part.startsWith(pre)).map((r) => `« ${clip(r.sentence, 200)} » : ${r.raison}`);
      judgeNormal = lines('normal.').length ? `\n\nLe contrôle de fidélité a refusé ces phrases (la fiche ne les confirme pas) : supprimez-les ou dites exactement ce que dit la fiche.\n- ${lines('normal.').join('\n- ')}` : '';
      judgeFalc = `\n\nLe contrôle de fidélité a refusé ces phrases (la fiche ne les confirme pas) : supprimez-les ou dites exactement ce que dit la fiche.\n- ${[...lines('falc.'), ...lines('normal.')].join('\n- ')}`;
      continue;
    }
    const drop = new Set(refused.map((r) => `${r.part}|${r.sentence}`));
    for (const part of ['pour_qui', 'etapes']) {
      normal[part] = normal[part].filter((x) => !drop.has(`normal.${part}|${x}`));
      falc[part] = falc[part].filter((x) => !drop.has(`falc.${part}|${x}`));
    }
    if (Array.isArray(normal.documents)) normal.documents = normal.documents.filter((x) => !drop.has(`normal.documents|${x}`));
    if (!normal.pour_qui.length || !falc.pour_qui.length) return { ok: false, reasons: [...reasons, 'fidélité : les conditions écrites ne sont pas confirmées par la fiche.'], model, draft: { normal, falc }, ms: Date.now() - started };
    return { ok: true, normal, falc, checks: { ...stats, rules: TEXT_RULES_VERSION, faithfulness: { checked: j.checked, removed: refused.map((r) => ({ part: r.part, sentence: r.sentence, raison: r.raison })), rounds: round + 1 } }, attempts, model, ms: Date.now() - started };
  }
  return { ok: false, reasons, model, ms: Date.now() - started };
}

const refusedBlock = (problems) => `\n\nVotre essai précédent a été refusé par le contrôle automatique :\n- ${problems.join('\n- ')}\nCorrigez ces points.`;
/** shape and numbers of the normal summary @returns {string[]} problems */
export function checkNormal(normal, source) {
  const problems = [];
  const all = [normal.resume, ...(normal.pour_qui || []), normal.montant || '', ...(normal.etapes || []), ...(normal.documents || [])].join('\n');
  const inv = inventedNumbers(all, source);
  if (inv.length) problems.push(`Ces nombres ne sont pas dans la fiche officielle : ${inv.join(', ')}. N'écrivez que les nombres de la fiche.`);
  const ns = sentences(normal.resume);
  if (ns.length < 2 || ns.length > 6) problems.push(`Le résumé doit avoir 2 à 6 phrases (il en a ${ns.length}).`);
  if (squash(normal.resume).length < 120 || squash(normal.resume).length > 900) problems.push('Le résumé doit faire entre 120 et 900 caractères.');
  if (/\b(nous|notre|nos)\b/i.test(normal.resume)) problems.push('Pas de « nous » dans le résumé.');
  return problems;
}

/** The independent faithfulness reading: every sentence checked against the source excerpt. */
async function judge(items, excerpt, call) {
  if (!items.length) return { refused: [], checked: 0 };
  const numbered = items.map((x, i) => `${i + 1}. ${squash(x)}`).join('\n');
  const r = await call(JUDGE_SYSTEM, `Fiche officielle :\n<<<\n${excerpt}\n>>>\n\nPhrases à contrôler :\n${numbered}\n\nPour CHAQUE phrase (n de 1 à ${items.length}), réponds {"n": numéro, "ok": true ou false, "raison": "courte raison"}. JSON : {"verdicts": [...]}`, JUDGE_SCHEMA);
  if (r.error) return { error: 'Le contrôle de fidélité n’a pas pu être fait (modèle local indisponible).' };
  const byN = new Map(r.content.verdicts.map((v) => [v.n, v]));
  // R14: a sentence without its verdict is not confirmed (it used to pass when up to 10 % of verdicts were missing — an amount sentence could go out unread)
  const refused = []; let missing = 0;
  items.forEach((_, i) => { const v = byN.get(i + 1); if (!v) { missing += 1; refused.push({ index: i, raison: 'pas de verdict du contrôle de fidélité' }); } else if (!v.ok) refused.push({ index: i, raison: squash(v.raison) || 'non confirmée' }); });
  if (missing > Math.max(1, items.length * 0.1)) return { error: 'Le contrôle de fidélité n’a pas répondu pour toutes les phrases.' };
  return { refused, checked: items.length - missing };
}
