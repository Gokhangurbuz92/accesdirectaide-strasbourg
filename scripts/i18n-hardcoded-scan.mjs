#!/usr/bin/env node
/**
 * R41 — interface strings that do not go through i18next (`t()` / `<Trans>`).
 *
 * The same walk as the R40 audit (evidence/r40/i18n): every JSX text node with at least two letters, every user-facing attribute literal
 * (aria-label, title, placeholder, alt, aria-description, label) and every `{'string literal'}` child with a word, in src/**.jsx|tsx except
 * tests and locale files. Each finding is matched against the approved exceptions (scripts/i18n-hardcoded-exceptions.json: file + exact text,
 * with a category and a reason — proper names, French legal terms of art, developer-only diagnostics, unmounted components, Storybook
 * fixtures…). The content of a `<Trans i18nKey defaults>` element is not a finding: Trans renders the translation of `defaults`. A finding that matches no exception is « unapproved »: something a visitor would read in French whatever their language.
 *
 * Each finding also says whether its file is reachable from the application entry (src/main.jsx, following static and dynamic relative and
 * `@/` imports): an « unmounted » exception is valid only while nothing imports the file.
 *
 *   node scripts/i18n-hardcoded-scan.mjs [--json] [--list]     exit 1 when an unapproved string or a stale « unmounted » exception exists
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { isMainModule } from './lib/is-main.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
export const EXCEPTIONS_FILE = path.join(ROOT, 'scripts', 'i18n-hardcoded-exceptions.json');
const ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt', 'aria-description', 'label']);
const EXTS = ['.jsx', '.tsx', '.js', '.ts', '.mjs'];

const walk = (dir, re) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'locales' || e.name === 'node_modules' ? [] : walk(p, re);
  return re.test(e.name) ? [p] : [];
});

const parseCode = (code) => {
  try { return parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'], errorRecovery: true }); } catch { return null; }
};

const visitAll = (node, fn) => {
  if (!node || typeof node.type !== 'string') return;
  if (fn(node) === false) return;
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) v.forEach((c) => visitAll(c, fn));
    else if (v && typeof v === 'object' && typeof v.type === 'string') visitAll(v, fn);
  }
};

/** the hard-coded strings of one source text @returns {{ line: number, kind: 'TEXT'|'ATTR'|'EXPR', attr?: string, text: string }[]} */
export function scanCode(code) {
  const ast = parseCode(code);
  if (!ast) return [];
  const out = [];
  visitAll(ast.program, (n) => {
    // inside <Trans defaults="…" components={[…]}>: what is rendered is the translation of `defaults`; the children (and the children of the
    // elements given as components) are replaced by it, so they are never shown
    if (n.type === 'JSXElement' && n.openingElement?.name?.type === 'JSXIdentifier' && n.openingElement.name.name === 'Trans'
      && n.openingElement.attributes.some((a) => a.name?.name === 'i18nKey')) return false;
    if (n.type === 'JSXText') {
      const s = n.value.replace(/\s+/g, ' ').trim();
      if (/[A-Za-zÀ-ÿ]{2,}/.test(s)) out.push({ line: n.loc.start.line, kind: 'TEXT', text: s });
    }
    if (n.type === 'JSXAttribute' && ATTRS.has(n.name?.name) && n.value?.type === 'StringLiteral' && /[A-Za-zÀ-ÿ]{2,}/.test(n.value.value)) {
      out.push({ line: n.loc.start.line, kind: 'ATTR', attr: n.name.name, text: n.value.value });
    }
    if (n.type === 'JSXExpressionContainer' && n.expression?.type === 'StringLiteral' && /[A-Za-zÀ-ÿ]{3,} /.test(n.expression.value)) {
      out.push({ line: n.loc.start.line, kind: 'EXPR', text: n.expression.value });
    }
  });
  return out;
}

const resolveImport = (from, spec) => {
  let base;
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null;
  const candidates = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => path.join(base, `index${e}`))];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
};

/** the source files reachable from the application entry @returns {Set<string>} paths relative to the repository */
export function reachableFiles(entry = path.join(SRC, 'main.jsx')) {
  const seen = new Set(); const stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!/\.(jsx?|tsx?|mjs)$/.test(f)) continue;
    const ast = parseCode(fs.readFileSync(f, 'utf8'));
    if (!ast) continue;
    visitAll(ast.program, (n) => {
      let spec = null;
      if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source?.type === 'StringLiteral') spec = n.source.value;
      if ((n.type === 'ImportExpression' || (n.type === 'CallExpression' && n.callee?.type === 'Import')) && (n.source ?? n.arguments?.[0])?.type === 'StringLiteral') spec = (n.source ?? n.arguments[0]).value;
      if (spec) { const r = resolveImport(f, spec); if (r) stack.push(r); }
    });
  }
  return new Set([...seen].map((f) => path.relative(ROOT, f)));
}

export function loadExceptions(file = EXCEPTIONS_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).exceptions;
}

/** @returns {{ total: number, approved: number, unapproved: object[], staleUnmounted: object[], unusedExceptions: object[], findings: object[], exceptions: number }} */
export function scan({ srcDir = SRC, exceptions = loadExceptions() } = {}) {
  const reach = reachableFiles();
  const findings = [];
  for (const f of walk(srcDir, /\.(jsx|tsx)$/).filter((p) => !/\.test\./.test(p))) {
    const rel = path.relative(ROOT, f);
    for (const x of scanCode(fs.readFileSync(f, 'utf8'))) findings.push({ file: rel, ...x, reachable: reach.has(rel) });
  }
  const used = new Set();
  for (const x of findings) {
    const i = exceptions.findIndex((e) => e.file === x.file && (e.text === x.text || (e.text === '*' && ['unmounted', 'storybook', 'developer-only'].includes(e.category))));
    x.exception = i >= 0 ? exceptions[i] : null;
    if (i >= 0) used.add(i);
  }
  const unapproved = findings.filter((x) => !x.exception);
  const staleUnmounted = findings.filter((x) => x.exception?.category === 'unmounted' && x.reachable);
  const unusedExceptions = exceptions.filter((_, i) => !used.has(i));
  return { total: findings.length, approved: findings.length - unapproved.length, unapproved, staleUnmounted, unusedExceptions, findings, exceptions: exceptions.length };
}

if (isMainModule(import.meta.url)) {
  const r = scan();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else {
    console.log(`I18N_HARDCODED total=${r.total} approved=${r.approved} unapproved=${r.unapproved.length} staleUnmounted=${r.staleUnmounted.length} unusedExceptions=${r.unusedExceptions.length} exceptionEntries=${r.exceptions}`);
    const show = process.argv.includes('--list') ? r.findings : r.unapproved;
    for (const x of show) console.log(`${x.file}:${x.line}: ${x.kind}${x.attr ? ` ${x.attr}` : ''} ${x.text.slice(0, 110)}${x.reachable ? '' : '  [unreachable]'}${x.exception ? `  <${x.exception.category}>` : ''}`);
    for (const x of r.staleUnmounted) console.log(`STALE unmounted exception: ${x.file} is now imported`);
    for (const e of r.unusedExceptions) console.log(`unused exception: ${e.file} « ${e.text} »`);
  }
  process.exit(r.unapproved.length || r.staleUnmounted.length ? 1 : 0);
}
