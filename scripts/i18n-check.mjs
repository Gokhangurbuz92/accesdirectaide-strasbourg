#!/usr/bin/env node
/**
 * R32 — completeness and consistency of the interface translations.
 *
 * Reads every `t('ns:key', 'French default')` / `t('ns:key', { defaultValue… })` call and every `<Trans i18nKey="ns:key" defaults="…">` in src/,
 * then checks, for each of the five target languages (src/i18n/locales/<lang>/<ns>.json):
 *   - the key exists (for a plural key: every plural category of that language, from Intl.PluralRules — six in Arabic);
 *   - the {{placeholders}} and the <0>…</0> markup are the same as in the French default;
 *   - the translation is not empty and does not assert an entitlement (« you are entitled… »), which the French source never does.
 *
 *   node scripts/i18n-check.mjs [--json] [--ns a,b]      exit 1 when something is missing or inconsistent (--ns: only these namespaces)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { TARGET_LANGUAGES } from '../src/i18n/languages.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const LOCALES = path.join(SRC, 'i18n', 'locales');

/** the strings that must never appear in a translated interface string: an assertion of a right (the French source only ever says « peut-être ») */
export const ENTITLEMENT_CLAIMS = {
  en: /\byou (are|will be) (automatically )?entitled\b|\byou have (a|the) right to (receive|get|obtain)\b/i,
  de: /\b(Sie haben|haben Sie) (automatisch )?(einen )?Anspruch\b|\bIhnen steht\b/i,
  tr: /\b(almaya )?hakkınız (var|vardır)\b|\bhak kazanırsınız\b/i,
  ar: /يحق لك|من حقك الحصول|لديك الحق في الحصول/,
  uk: /\b(ви )?маєте право на отримання\b|\bвам належить\b/i,
};

const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'locales' || e.name === 'node_modules' ? [] : files(p);
  return /\.(jsx?|tsx?)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
});

const str = (n) => (n?.type === 'StringLiteral' ? n.value : n?.type === 'TemplateLiteral' && n.expressions.length === 0 ? n.quasis.map((q) => q.value.cooked).join('') : null);

/** Extracts the keys used in one source text. @returns {{ key: string, ns: string, id: string, defaults: Record<string, string>, plural: boolean, file: string }[]} */
export function extractKeys(code, file = '') {
  let ast;
  try { ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'], errorRecovery: true }); } catch { return []; }
  const out = [];
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'CallExpression') {
      const c = node.callee;
      const name = c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && c.property?.type === 'Identifier' ? c.property.name : null;
      const key = str(node.arguments[0]);
      if (name === 't' && key && /^[a-z][a-z0-9-]*:[^\s]+$/.test(key)) {
        const second = node.arguments[1];
        const defaults = {}; let plural = false;
        if (str(second) !== null) defaults[''] = str(second);
        else if (second?.type === 'ObjectExpression') {
          for (const p of second.properties) {
            const k = p.key?.name ?? p.key?.value; const v = str(p.value);
            if (typeof k === 'string' && v !== null && /^defaultValue(_[a-z]+)?$/.test(k)) { defaults[k.replace(/^defaultValue_?/, '')] = v; if (k !== 'defaultValue') plural = true; }
            if (k === 'count') plural = true;
          }
        }
        const [ns, ...rest] = key.split(':');
        out.push({ key, ns, id: rest.join(':'), defaults, plural, file });
      }
    }
    if (node.type === 'JSXOpeningElement' && node.name?.name === 'Trans') {
      const attr = (n) => node.attributes.find((a) => a.name?.name === n);
      const k = attr('i18nKey')?.value; const d = attr('defaults')?.value;
      const key = k?.type === 'StringLiteral' ? k.value : null;
      if (key && key.includes(':')) {
        const [ns, ...rest] = key.split(':');
        out.push({ key, ns, id: rest.join(':'), defaults: d?.type === 'StringLiteral' ? { '': d.value } : {}, plural: Boolean(attr('count')), file });
      }
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v);
    }
  };
  visit(ast.program);
  return out;
}

const placeholders = (s) => [...String(s).matchAll(/\{\{\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g)].map((m) => m[1]).filter((n) => n !== 'count').sort().join(',');
const tags = (s) => [...String(s).matchAll(/<\/?(\d+|[a-z]+)\s*\/?>/g)].map((m) => m[0].replace(/\s/g, '')).sort().join('');

export function loadLocale(lang, dir = LOCALES) {
  const d = path.join(dir, lang); const out = {};
  if (!fs.existsSync(d)) return out;
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.json'))) out[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
  return out;
}

/** @returns {{ keys: number, files: number, languages: Record<string, { missing: string[], mismatched: string[], claims: string[], empty: string[] }>, noDefault: string[], unused: Record<string, string[]>, ok: boolean }} */
export function check({ srcDir = SRC, localesDir = LOCALES, languages = TARGET_LANGUAGES, namespaces = null } = {}) {
  const used = new Map(); const noDefault = []; let nfiles = 0;
  for (const f of files(srcDir)) {
    const keys = extractKeys(fs.readFileSync(f, 'utf8'), path.relative(ROOT, f));
    if (keys.length) nfiles += 1;
    for (const k of keys) {
      if (namespaces && !namespaces.includes(k.ns)) continue;
      if (!Object.keys(k.defaults).length) noDefault.push(`${k.key} (${k.file})`);
      const prev = used.get(k.key);
      used.set(k.key, prev ? { ...k, defaults: { ...prev.defaults, ...k.defaults }, plural: prev.plural || k.plural } : k);
    }
  }
  const languagesOut = {}; const unused = {};
  for (const lang of languages) {
    const res = loadLocale(lang, localesDir);
    const cats = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
    const r = { missing: [], mismatched: [], claims: [], empty: [] };
    for (const k of used.values()) {
      const bundle = res[k.ns] || {};
      const ref = k.defaults[''] ?? k.defaults.other ?? Object.values(k.defaults)[0] ?? '';
      const wanted = k.plural ? cats.map((c) => `${k.id}_${c}`) : [k.id];
      for (const w of wanted) {
        const v = bundle[w];
        if (typeof v !== 'string') { r.missing.push(`${k.ns}:${w}`); continue; }
        if (!v.trim()) r.empty.push(`${k.ns}:${w}`);
        if (placeholders(v) !== placeholders(ref) || tags(v) !== tags(ref)) r.mismatched.push(`${k.ns}:${w}`);
        if (ENTITLEMENT_CLAIMS[lang]?.test(v)) r.claims.push(`${k.ns}:${w}`);
      }
    }
    const usedIds = new Set([...used.values()].flatMap((k) => (k.plural ? cats.map((c) => `${k.ns}:${k.id}_${c}`) : [`${k.ns}:${k.id}`])));
    unused[lang] = Object.entries(res).filter(([ns]) => !namespaces || namespaces.includes(ns)).flatMap(([ns, b]) => Object.keys(b).map((id) => `${ns}:${id}`)).filter((id) => !usedIds.has(id));
    languagesOut[lang] = r;
  }
  const ok = noDefault.length === 0 && Object.values(languagesOut).every((r) => !r.missing.length && !r.mismatched.length && !r.claims.length && !r.empty.length);
  return { keys: used.size, files: nfiles, languages: languagesOut, noDefault, unused, ok };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const nsArg = process.argv.includes('--ns') ? process.argv[process.argv.indexOf('--ns') + 1] : null;
  const r = check({ namespaces: nsArg ? nsArg.split(',').map((x) => x.trim()).filter(Boolean) : null });
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else {
    console.log(`I18N_CHECK keys=${r.keys} files=${r.files} ok=${r.ok}`);
    for (const [l, x] of Object.entries(r.languages)) console.log(`  ${l}: missing ${x.missing.length}, mismatched ${x.mismatched.length}, entitlement claims ${x.claims.length}, empty ${x.empty.length}, unused ${r.unused[l].length}${x.missing.length ? ` — e.g. ${x.missing.slice(0, 5).join(', ')}` : ''}${x.mismatched.length ? ` — mismatched e.g. ${x.mismatched.slice(0, 5).join(', ')}` : ''}`);
    if (r.noDefault.length) console.log(`  keys without a French default: ${r.noDefault.slice(0, 10).join(', ')}`);
  }
  process.exit(r.ok ? 0 : 1);
}
