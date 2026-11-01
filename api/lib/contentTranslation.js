// @ts-nocheck
/**
 * R32 — translations of the VERIFIED PUBLIC content (aides, démarches, guides, news, dispositifs): what is translated, how a translation is tied
 * to the exact French text it came from, the automatic checks, and the publication decision. Shared by the editorial script
 * (scripts/translate-content.mjs, run on the publisher's machine with a local engine) and the public API (api/_handlers/translations.js).
 *
 * Principles:
 *   - The French record is the authority. A translation is a comprehension aid, shown with a notice and a way back to the French text.
 *   - A translation is tied to a fingerprint (SHA-256) of the French fields it translates. When the French changes, the fingerprint no longer
 *     matches: the translation is OUTDATED and nothing of it is shown until it is regenerated and checked again.
 *   - Official names (institutions, benefits, forms) are never translated: they are replaced by placeholders before translation, restored in
 *     French after, and get a short gloss written by the project (data/i18n/terminology.json) — engines were seen to swap the CAF for a British
 *     ministry and to invent glosses.
 *   - Automatic checks never prove a translation right. They only stop the translations that are detectably wrong (lost or changed numbers,
 *     names, links, negations; French left untranslated; an assertion of entitlement). A field that fails is WITHHELD: the French text is shown.
 *   - « Reviewed by a person » is a status only a recorded human review can give (review.by + review.at in the translation file).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA = 'ada-content-translation/1';

/** translated fields per kind and their risk: 'high' = conditions, documents, steps, places, costs, deadlines (stricter checks) */
export const FIELDS = Object.freeze({
  aide: { titre: 'normal', description: 'normal', cest_quoi: 'normal', pour_qui: 'high', ce_que_ca_aide: 'normal', etapes: 'high', documents_necessaires: 'high', ou_demander: 'high', delai_indicatif: 'high' },
  demarche: { titre: 'normal', description_courte: 'normal', contenu_detaille: 'high', pour_qui: 'high', etapes: 'high', documents_necessaires: 'high', ou_faire: 'high', cout: 'high', delai: 'high' },
  guide: { titre: 'normal', contenu_json: 'normal' },
  actualite: { titre: 'normal', resume: 'normal', contenu: 'normal' },
  dispositif: { titre: 'normal', summary_falc: 'normal', description_falc: 'normal' },
});
export const KINDS = Object.freeze(Object.keys(FIELDS));
/** keys of structured values (steps, guide bodies) whose string values are text to translate; any other key (ids, urls, provenance) is kept */
const TEXT_KEYS = new Set(['titre', 'title', 'texte', 'text', 'description', 'details', 'detail', 'label', 'intro', 'contenu', 'resume']);
/** record-level statuses */
export const STATUSES = Object.freeze(['unavailable', 'machine_draft', 'auto_checked', 'partial', 'human_reviewed', 'outdated', 'withheld']);
const SHOWN = new Set(['auto_checked', 'human_reviewed']);

// ── fingerprint of the French source ────────────────────────────────────────────────────────────────────────────────────────────────────────
const canon = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v.replace(/\r\n/g, '\n');
  if (Array.isArray(v)) return v.map(canon);
  if (typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().filter((k) => k !== 'provenance').map((k) => [k, canon(v[k])]));
  return v;
};
/** the French fields of a record that its translation covers (missing fields as null) */
export function sourceFields(kind, record) {
  return Object.fromEntries(Object.keys(FIELDS[kind] || {}).map((f) => [f, canon(parseMaybeJson(record?.[f]))]));
}
/** SHA-256 of those fields: any change of the French text changes it */
export function sourceHash(kind, record) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(sourceFields(kind, record))).digest('hex')}`;
}
function parseMaybeJson(v) {
  if (typeof v !== 'string' || !/^\s*[[{]/.test(v)) return v;
  try { return JSON.parse(v); } catch { return v; }
}

// ── segmentation: a field becomes translation units (one per line or sentence) and is rebuilt from them ────────────────────────────────────
const BULLET = /^(\s*(?:[-•*–—]|\d{1,2}[.)])\s+)/;
const splitSentences = (s) => (s.length <= 600 ? [s] : s.split(/(?<=[.!?;:])\s+(?=[A-ZÀ-ÝÉ«"(0-9])/));
/** @returns {{ units: string[], rebuild: (texts: string[]) => any }} */
export function unitsOf(value) {
  const units = [];
  const plan = (v, key = null) => {
    if (typeof v === 'string') {
      if (key !== null && !TEXT_KEYS.has(key)) return { keep: v };
      const lines = v.replace(/\r\n/g, '\n').split('\n').map((line) => {
        const m = line.match(BULLET); const prefix = m ? m[1] : ''; const body = line.slice(prefix.length);
        if (!body.trim() || !/[A-Za-zÀ-ÿ]/.test(body)) return { keep: line };
        return { prefix, parts: splitSentences(body).map((p) => { units.push(p); return units.length - 1; }) };
      });
      return { lines };
    }
    if (Array.isArray(v)) return { arr: v.map((x) => plan(x, key === null ? null : key)) };
    if (v && typeof v === 'object') return { obj: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'provenance' ? { keep: x } : plan(x, k)])) };
    return { keep: v };
  };
  const p = plan(parseMaybeJson(value));
  const build = (n, t) => {
    if ('keep' in n) return n.keep;
    if (n.lines) return n.lines.map((l) => ('keep' in l ? l.keep : l.prefix + l.parts.map((i) => t[i]).join(' '))).join('\n');
    if (n.arr) return n.arr.map((x) => build(x, t));
    if (n.obj) return Object.fromEntries(Object.entries(n.obj).map(([k, x]) => [k, build(x, t)]));
    return null;
  };
  return { units, rebuild: (texts) => build(p, texts) };
}

// ── official names: placeholders before translation, French + gloss after ───────────────────────────────────────────────────────────────────
let terminology = null;
export function loadTerminology(file = path.join(process.cwd(), 'data/i18n/terminology.json')) {
  if (!terminology) {
    const t = JSON.parse(fs.readFileSync(file, 'utf8'));
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    terminology = t.terms.map((x) => ({ ...x, re: new RegExp(`(?<![\\p{L}\\d])(?:${x.match || esc(x.fr)})(?![\\p{L}\\d])`, 'gu') }))
      .sort((a, b) => b.fr.length - a.fr.length);
  }
  return terminology;
}
/** @returns {{ text: string, slots: { token: string, fr: string, term: any }[] }} */
export function protect(text, terms = loadTerminology()) {
  const slots = []; let out = text;
  for (const term of terms) {
    out = out.replace(term.re, (m) => { slots.push({ token: `[[T${slots.length + 1}]]`, fr: m, term }); return slots.at(-1).token; });
  }
  return { text: out, slots };
}
/** @returns {{ text: string, missing: string[] }} */
export function restore(translated, slots, lang, glossed = new Set()) {
  let out = translated; const missing = [];
  for (const s of slots) {
    // engines sometimes damage a placeholder: « [[T1] », « [T1] », « [[ T1 ]] » are all accepted (never another number: T1 ≠ T12)
    const n = s.token.match(/\d+/)[0];
    const re = new RegExp(`\\[\\[?\\s*T${n}(?!\\d)\\s*\\]?\\]`, 'g');
    if (!re.test(out)) { missing.push(s.token); continue; }
    // the gloss follows the FIRST occurrence of a name in the field only, and never when the text already explains it: a name followed by
    // « ( », or written inside parentheses as the abbreviation of the name before it (« Caisse primaire d'assurance maladie (CPAM) »)
    const gloss = s.term.gloss?.[lang];
    let glossNow = Boolean(gloss) && !glossed.has(s.term.fr) && !glossed.has(`gloss:${gloss}`);
    out = out.replace(re, (m, offset, whole) => {
      if (!glossNow) return s.fr;
      const before = whole.slice(0, offset).trimEnd(); const after = whole.slice(offset + m.length).trimStart();
      if (after.startsWith('(')) return s.fr;   // the parenthesis that follows (usually the abbreviation) will carry the gloss
      glossNow = false; glossed.add(s.term.fr); glossed.add(`gloss:${gloss}`);
      return before.endsWith('(') && after.startsWith(')') ? `${s.fr}: ${gloss}` : `${s.fr} (${gloss})`;
    });
  }
  return { text: out, missing };
}

// ── automatic checks ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// times are written 9h, 9 h 30, 9:00 or 09:30 depending on the language: normalised before the digits are compared
const times = (s) => String(s).replace(/(?<!\d)0?(\d{1,2})\s*[h:]\s*(\d{2})(?!\d)/g, (_, h, m) => (m === '00' ? h : `${h}${m}`)).replace(/(?<!\d)0?(\d{1,2})\s*h(?![\p{L}\d])/gu, '$1');
// a number: digits, optional groups of three after a (narrow) space, optional decimals — « 1 234,56 », « 1,234.56 » and « 1234.56 » are the same; « 12, 25 » are two
const digits = (s) => (times(s).match(/\d+(?:[\u00a0\u202f ]\d{3}(?!\d))*(?:[.,]\d+)*/g) || []).map((x) => x.replace(/\D/g, '')).sort();
const links = (s) => (String(s).match(/https?:\/\/[^\s)»"]+|[\w.+-]+@[\w-]+\.[\w.]+/g) || []).map((x) => x.replace(/[.,;]$/, '')).sort();
const FR_NEGATION = /(?<![\p{L}])(ne|n['’]|pas|jamais|aucun(e|s)?|sans|ni|non|rien|personne ne|nulle?)(?![\p{L}])/giu;
const FR_UNCERTAIN = /(?<![\p{L}])(peut|peuvent|pouvez|pourrait|pourriez|pourraient|peut-être|éventuellement|possible(ment)?|selon|sous (certaines )?conditions?|le cas échéant|en fonction de|suivant|dépend(ent|ant)?|il se peut)(?![\p{L}])/giu;
/** assertions of entitlement, which the French source never makes (« vous avez droit si » is refused upstream) */
export const ENTITLEMENT = {
  en: /\byou (are|will be) (automatically )?entitled\b|\byou have (a|the) right to (receive|get|obtain)\b/i,
  de: /\b(Sie haben|haben Sie) (automatisch )?(einen )?Anspruch\b|\bIhnen steht\b|\bstehen Ihnen\b/i,
  tr: /\b(almaya )?hakkınız (var|vardır)\b|\bhak kazanırsınız\b|\bhak sahibisiniz\b/i,
  ar: /يحق لك|من حقك الحصول|لديك الحق في الحصول/,
  uk: /\b(ви )?маєте право на отримання\b|\bвам належить\b|\bвам належать\b/i,
};
const FR_WORDS = /(?<![\p{L}])(le|la|les|des|du|vous|pour|est|une|avec|dans|votre|vos|sur|aux|qui|que)(?![\p{L}])/giu;
const count = (re, s) => (String(s).match(re) || []).length;
const letters = (s) => (String(s).match(/\p{L}/gu) || []);

/** character n-gram F-score (chrF, n = 1…6, β = 2) of a back-translation against the French source, 0–100 */
export function chrF(hyp, ref) {
  const grams = (s, n) => { const m = new Map(); const t = String(s).replace(/\s+/g, ' ').trim(); for (let i = 0; i + n <= t.length; i += 1) { const g = t.slice(i, i + n); m.set(g, (m.get(g) || 0) + 1); } return m; };
  let p = 0; let r = 0; let k = 0;
  for (let n = 1; n <= 6; n += 1) {
    const h = grams(hyp, n); const g = grams(ref, n); let hit = 0; let th = 0; let tg = 0;
    for (const [x, c] of h) { th += c; hit += Math.min(c, g.get(x) || 0); }
    for (const c of g.values()) tg += c;
    if (th && tg) { p += hit / th; r += hit / tg; k += 1; }
  }
  if (!k) return 0;
  p /= k; r /= k;
  return p + r === 0 ? 0 : Math.round(((1 + 4) * p * r) / (4 * p + r) * 1000) / 10;
}

/**
 * Checks one translated field. `source` and `target` are the flattened texts of the field (all units joined), `back` the back-translation into
 * French (or null when not run), `missing` the placeholders lost by the engine. @returns {{ critical: string[], warnings: string[], roundtrip: number|null }}
 */
export function checkField({ lang, risk, source, target, back = null, missing = [] }) {
  const critical = []; const warnings = [];
  if (!String(target || '').trim()) critical.push('empty');
  if (missing.length) critical.push('names');
  if (digits(source).join(',') !== digits(target).join(',')) critical.push('numbers');
  if (links(source).join(' ') !== links(target).join(' ')) critical.push('links');
  if (ENTITLEMENT[lang]?.test(target)) critical.push('entitlement');
  const plain = String(target).replace(/\([^)]*\)/g, ' ');
  if (['ar', 'uk'].includes(lang)) {
    const all = letters(plain); const own = all.filter((c) => (lang === 'ar' ? /\p{Script=Arabic}/u : /\p{Script=Cyrillic}/u).test(c));
    if (all.length > 20 && own.length / all.length < 0.5) critical.push('untranslated');
    // one word mixing the target script with Latin letters is a broken word (« أوروبوميتropole »), never a deliberate name
    if ((plain.match(/\p{L}+/gu) || []).some((w) => /\p{Script=Latin}/u.test(w) && /[\p{Script=Arabic}\p{Script=Cyrillic}]/u.test(w))) critical.push('script');
  } else if (count(FR_WORDS, plain) >= Math.max(4, Math.round(plain.split(/\s+/).length * 0.12))) critical.push('untranslated');
  const ratio = String(target).length / Math.max(1, String(source).length);
  if (ratio < 0.4 || ratio > 3) warnings.push('length');
  let roundtrip = null;
  if (back !== null) {
    roundtrip = chrF(back, source);
    const negS = count(FR_NEGATION, source); const negB = count(FR_NEGATION, back);
    if ((negS > 0) !== (negB > 0) || Math.abs(negS - negB) >= 2) (risk === 'high' ? critical : warnings).push('negation');
    if (count(FR_UNCERTAIN, source) > 0 && count(FR_UNCERTAIN, back) === 0) (risk === 'high' ? critical : warnings).push('modality');
    if (roundtrip < 35) warnings.push('roundtrip_low');
  }
  return { critical, warnings, roundtrip };
}

/** the status of one field from its checks (and an optional recorded human review) */
export function fieldStatus(checks, risk, reviewed = false) {
  if (reviewed) return 'human_reviewed';
  if (!checks) return 'machine_draft';
  if (checks.critical.length) return 'withheld';
  if (risk === 'high' && checks.warnings.length) return 'withheld';
  return 'auto_checked';
}

/** the record-level status of one language entry */
export function recordStatus(entry) {
  const st = Object.values(entry?.fields || {}).filter((f) => f && f.text !== null && f.text !== undefined).map((f) => f.status);
  if (!st.length) return 'unavailable';
  if (st.every((s) => s === 'human_reviewed')) return 'human_reviewed';
  if (st.every((s) => SHOWN.has(s))) return 'auto_checked';
  if (st.some((s) => SHOWN.has(s))) return 'partial';
  if (st.every((s) => s === 'machine_draft')) return 'machine_draft';
  return 'withheld';
}

/**
 * What the public may see of a translation file for one language, given the CURRENT French record. Outdated → nothing. Only fields whose status
 * is auto_checked or human_reviewed are returned; every other field shows in French.
 */
export function publicView(file, lang, kind, record) {
  const base = { kind, lang, status: 'unavailable', fields: {}, fieldStatus: {}, engine: null, translatedAt: null, review: null };
  const entry = file?.translations?.[lang];
  if (!file || file.schema !== SCHEMA || !entry) return base;
  if (file.source?.hash !== sourceHash(kind, record)) return { ...base, status: 'outdated', translatedAt: entry.translatedAt || null };
  if (entry.withheld === true) return { ...base, status: 'withheld', engine: entry.engine || null, translatedAt: entry.translatedAt || null };
  const fields = {}; const fieldStatusOut = {};
  for (const [name, f] of Object.entries(entry.fields || {})) {
    if (!(name in (FIELDS[kind] || {})) || f?.text === null || f?.text === undefined) continue;
    fieldStatusOut[name] = f.status;
    if (SHOWN.has(f.status)) fields[name] = f.text;
  }
  return { ...base, status: recordStatus(entry), fields, fieldStatus: fieldStatusOut, engine: entry.engine || null, translatedAt: entry.translatedAt || null, review: entry.review || null };
}
