// @ts-nocheck
/**
 * R32 — cross-language search. A query typed in English, Turkish, Arabic, German or Ukrainian becomes a FRENCH word query for the existing search
 * (api/lib/search-query.js), through the controlled vocabulary data/i18n/search-lexicon.json: « kira yardımı » → « loyer », « допомога на оренду »
 * → « loyer », « إيجار » → « loyer », « Wohngeld Straßburg » → « loyer Straßburg ». The search, its ranking and the D-5 publication rule are unchanged:
 * only French verified records are found, and nothing is decided from the query.
 *
 * Which words are looked up: Arabic and Cyrillic words always (the French search cannot read them); Latin words only for the language of the interface
 * (and Turkish or German words recognisable by their letters), so a French query is never rewritten. Words that are not in the vocabulary are kept
 * when they are Latin (place names, acronyms such as CAF, postal codes) unless they are function words of the query language; Arabic or Cyrillic
 * words that are not in the vocabulary are dropped. When nothing usable is left, the search must ABSTAIN (no result) rather than list everything.
 */
import fs from 'node:fs';
import path from 'node:path';

const LATIN_LANGS = ['en', 'tr', 'de'];
const STOP = {
  en: 'a an and are as at be can do does for from get help how i in is it me my need of on or please the to what where which who with you your apply find look looking want allowance allowances benefit benefits assistance aid support renewal renew request form forms office near nearby',
  tr: 'bir bu da de için ile ne nasıl nerede neden ve veya mı mi mu mü ben benim bana yardım yardımı lütfen almak alınır başvuru başvurmak istiyorum lazım gerek var yok olan ödenek ödeneği destek desteği yakın',
  de: 'der die das den dem des ein eine einen einer und oder für mit von zu zur zum wie wo was ich mein meine brauche hilfe bitte beantragen bekommen kann ist in im auf an zuschuss unterstützung antrag nähe',
};
const stop = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v.split(' ').map((w) => fold(w)))]));

/** lower case, no accents or Arabic short vowels, Turkish ı = i, ß = ss, Arabic letter variants unified, no apostrophes */
export function fold(s) {
  return String(s || '').toLowerCase().replace(/ı/g, 'i').normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss')
    .replace(/ـ/g, '').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[’'ʼ`]/g, '');
}
const ARTICLE = /^(?:وال|بال|كال|فال|لل|ال)/;
const tokenOf = (t) => { const f = fold(t); return /^\p{Script=Arabic}/u.test(f) && ARTICLE.test(f) && f.replace(ARTICLE, '').length >= 3 ? f.replace(ARTICLE, '') : f; };
const split = (s) => String(s || '').split(/[^\p{L}\p{N}*]+/u).filter(Boolean);
const scriptOf = (t) => (/\p{Script=Arabic}/u.test(t) ? 'ar' : /\p{Script=Cyrillic}/u.test(t) ? 'uk' : /\p{L}/u.test(t) ? 'latin' : 'other');

let compiled = null;
export function loadLexicon(file = path.join(process.cwd(), 'data/i18n/search-lexicon.json')) {
  if (!compiled) {
    const lex = JSON.parse(fs.readFileSync(file, 'utf8'));
    compiled = [];
    for (const c of lex.concepts) {
      for (const lang of ['en', 'tr', 'ar', 'de', 'uk']) {
        for (const term of c[lang] || []) compiled.push({ id: c.id, fr: c.fr, lang, words: split(term).map((w) => ({ w: tokenOf(w.replace(/\*$/, '')), prefix: w.endsWith('*') })) });
      }
    }
    compiled.sort((a, b) => b.words.length - a.words.length || b.words.reduce((n, x) => n + x.w.length, 0) - a.words.reduce((n, x) => n + x.w.length, 0));
  }
  return compiled;
}

const wordMatches = (tok, w) => (w.prefix ? w.w.length >= 3 && tok.startsWith(w.w) : tok === w.w);

/**
 * @param {string} query @param {string} [uiLang] the interface language
 * @returns {{ changed: boolean, query: string, concepts: string[], dropped: string[] }}
 */
export function crossLanguageQuery(query, uiLang = 'fr', terms = loadLexicon()) {
  const raw = split(query);
  const toks = raw.map(tokenOf);
  const scripts = raw.map(scriptOf);
  const latinLangs = new Set(LATIN_LANGS.includes(uiLang) ? [uiLang] : []);
  if (/[ğışİ]/i.test(query)) latinLangs.add('tr');
  if (/[ßäöü]/i.test(query) && !/[éèêàçùûôî]/i.test(query)) latinLangs.add('de');
  const used = new Array(toks.length).fill(false);
  const concepts = [];
  for (const term of terms) {
    if (['ar', 'uk'].includes(term.lang) ? false : !latinLangs.has(term.lang)) continue;
    for (let i = 0; i + term.words.length <= toks.length; i += 1) {
      if (term.words.some((w, k) => used[i + k] || !wordMatches(toks[i + k], w))) continue;
      if (['ar', 'uk'].includes(term.lang) && scripts[i] !== term.lang) continue;
      for (let k = 0; k < term.words.length; k += 1) used[i + k] = true;
      if (!concepts.some((c) => c.id === term.id)) concepts.push({ id: term.id, fr: term.fr });
    }
  }
  const foreign = concepts.length > 0 || scripts.some((s) => s === 'ar' || s === 'uk');
  if (!foreign) return { changed: false, query, concepts: [], dropped: [] };
  const kept = []; const dropped = [];
  raw.forEach((t, i) => {
    if (used[i]) return;
    const lang = [...latinLangs][0];
    if (scripts[i] === 'latin' && !(lang && stop[lang]?.has(toks[i]))) kept.push(t);
    else if (scripts[i] === 'other' && /\d/.test(t)) kept.push(t);
    else dropped.push(t);
  });
  const words = [...new Set([...concepts.map((c) => c.fr), ...kept])];
  return { changed: true, query: words.join(' ').trim(), concepts: concepts.map((c) => c.id), dropped };
}
