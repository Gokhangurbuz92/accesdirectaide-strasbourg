import fs from 'node:fs';
import path from 'node:path';

/**
 * R35 (P2/P3): source-wide inventory of the environment variables the code actually reads — the activation guide and the readiness doctor are checked
 * against it, so a variable added to the code without a manifest entry fails a test instead of disappearing from the owner's guide.
 * Names only; it never reads a value.
 */

const ROOTS = ['api', 'src', 'scripts', 'packages', 'middleware.js', 'dev-server.js', 'vite.config.js', 'drizzle.config.ts', 'vercel.json'];
const SKIP_DIR = /(^|\/)(node_modules|dist|build|coverage|\.git|tests?|__tests__|e2e|fixtures)(\/|$)/;
const EXT = /\.(m?js|cjs|jsx|ts|tsx|json)$/;
const SKIP_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

const PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]+)/g,
  /process\.env\[\s*['"`]([A-Z][A-Z0-9_]+)['"`]\s*\]/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]+)/g,
  /\b(?:getEnv|requireEnv|get|has|hasEnv|envFlag|readEnv)\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g,
  /\baliases:\s*\[([^\]]+)\]/g,
  /\benvAliases\(([^)]+)\)/g,
  /\benv\.([A-Z][A-Z0-9_]{2,})\b/g,
  /\benv\[\s*['"]([A-Z][A-Z0-9_]+)['"]\s*\]/g,
];

/** names that look like env reads but are not variables of this application */
const NOT_APP_VARS = new Set(['MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL']);

/** @param {string} dir @param {string[]} acc */
function walk(dir, acc) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (SKIP_DIR.test(p)) continue;
    if (ent.isDirectory()) walk(p, acc);
    else if (EXT.test(ent.name) && !SKIP_FILE.test(ent.name)) acc.push(p);
  }
  return acc;
}

/** @param {string} root repository root @returns {Map<string, string[]>} variable name -> files that read it (relative) */
export function inventoryEnvReads(root) {
  /** @type {Map<string, Set<string>>} */
  const found = new Map();
  const files = [];
  for (const r of ROOTS) {
    const p = path.join(root, r);
    if (!fs.existsSync(p)) continue;
    if (fs.statSync(p).isDirectory()) walk(p, files);
    else files.push(p);
  }
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(root, f);
    const add = (/** @type {string} */ n) => {
      if (NOT_APP_VARS.has(n)) return;
      if (!found.has(n)) found.set(n, new Set());
      found.get(n)?.add(rel);
    };
    for (const re of PATTERNS) {
      for (const m of src.matchAll(re)) {
        if (re.source.startsWith('\\baliases') || re.source.startsWith('\\benvAliases')) for (const a of m[1].replace(/\/\/.*$/gm, '').matchAll(/['"]([A-Z][A-Z0-9_]+)['"]/g)) add(a[1]);
        else add(m[1]);
      }
    }
  }
  return new Map([...found].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v].sort()]));
}
