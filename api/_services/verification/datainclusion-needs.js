// @ts-check
/**
 * D05 / R6 — the needs (subdomains of the ONE 20 × 86 taxonomy, data/reference/social-domains.v1.json) a data·inclusion service answers, read ONLY from the
 * correspondence the taxonomy itself declares (`dataInclusion` of each subdomain: an exact thématique code, or « <theme>-- » for every thématique of that
 * theme). No similarity, no keyword, no model: a thématique the taxonomy does not name maps to nothing and is counted as unmapped. Used by servicesValue
 * (the veille) and by the open-data import (scripts/lib/datainclusion-import.mjs), so both write the same value.
 */
import fs from 'node:fs';
import path from 'node:path';
import TERMS from './datainclusion-terms.js';

/** @typedef {{ subdomain: string, domain: string, codes: string[] }} NeedRule */
/** @type {NeedRule[] | null} */
let RULES = null;

/**
 * The correspondence rules of the taxonomy (read once). A missing or unreadable file gives no rule (no need is ever guessed).
 * @param {{ root?: string, reference?: any }} [o] `reference`: the parsed taxonomy (tests)
 * @returns {NeedRule[]}
 */
export function needRules({ root = process.cwd(), reference = null } = {}) {
  if (!reference && RULES) return RULES;
  let ref = reference;
  if (!ref) { try { ref = JSON.parse(fs.readFileSync(path.join(root, 'data/reference/social-domains.v1.json'), 'utf8')); } catch { ref = { domains: [] }; } }
  /** @type {NeedRule[]} */
  const rules = [];
  for (const d of Array.isArray(ref?.domains) ? ref.domains : []) {
    for (const s of Array.isArray(d?.subdomains) ? d.subdomains : []) {
      const codes = (Array.isArray(s?.dataInclusion) ? s.dataInclusion : []).map(String).filter(Boolean);
      if (codes.length) rules.push({ subdomain: String(s.id), domain: String(d.id), codes });
    }
  }
  if (!reference) RULES = rules;
  return rules;
}
/** test seam */
export function resetNeedRules() { RULES = null; }

/** a rule code « theme-- » covers every thématique of that theme; any other code only itself @param {string} rule @param {string} code */
const covers = (rule, code) => (rule.endsWith('--') ? code.startsWith(rule) : code === rule);

/**
 * The subdomain ids of some thématique CODES (sorted, unique).
 * @param {unknown[]} codes @param {NeedRule[]} [rules]
 */
export function needsOfThemeCodes(codes, rules = needRules()) {
  const out = new Set();
  for (const c of Array.isArray(codes) ? codes : []) for (const r of rules) if (r.codes.some((x) => covers(x, String(c)))) out.add(r.subdomain);
  return [...out].sort();
}

/** the thématique code of a schema label (services keep the schema's labels, datainclusion.js serviceOf); labels are unique in the pinned referential */
const CODE_OF_LABEL = new Map(Object.entries(TERMS.lists?.thematiques || {}).map(([code, label]) => [String(label), code]));
/** @param {unknown} label */
export const themeCodeOf = (label) => CODE_OF_LABEL.get(String(label)) || null;

/**
 * The needs of a list of services (labels as stored), and the thématiques that map to no need (counted, for the report).
 * @param {Array<{ themes?: string[] }>} services @param {NeedRule[]} [rules]
 * @returns {{ needs: string[], unmapped: Record<string, number> }}
 */
export function needsOfServices(services, rules = needRules()) {
  const needs = new Set();
  /** @type {Record<string, number>} */
  const unmapped = {};
  for (const s of Array.isArray(services) ? services : []) {
    for (const label of Array.isArray(s?.themes) ? s.themes : []) {
      const code = themeCodeOf(label);
      const n = code ? needsOfThemeCodes([code], rules) : [];
      if (!n.length) { unmapped[String(code || label)] = (unmapped[String(code || label)] || 0) + 1; continue; }
      for (const x of n) needs.add(x);
    }
  }
  return { needs: [...needs].sort(), unmapped };
}
