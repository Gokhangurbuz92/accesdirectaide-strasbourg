#!/usr/bin/env node
/**
 * R15 (env reconciliation, ASSO-061 / A17) — after `npm run build`: fails when the VALUE of a server-only secret present in the build environment appears in
 * the browser bundle (dist/). Prints variable NAMES and file paths only, never a value. `VITE_*` values are public by design and are not checked.
 * Usage: node scripts/bundle-secret-scan.mjs [distDir]      exit 1 on a leak, 2 when the directory is missing.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** server-only names whose value must never reach the browser (secret-like names; VITE_* excluded) */
export const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY|ACCESS_KEY|ENCRYPTION_KEY|VAULT_KEY|DATABASE_URL|AUTH_TOKEN|DSN_SERVER)/;
const MIN_LENGTH = 8;   // shorter values ('true', a port) would match by chance

/** @param {string} dir @returns {string[]} */
function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(?:js|mjs|cjs|css|html|json|map|txt|webmanifest|svg)$/i.test(name)) out.push(p);
  }
  return out;
}

/**
 * @param {string} dir the built bundle
 * @param {Record<string, string | undefined>} env
 * @returns {{ checked: string[], leaks: { name: string, file: string }[] }}
 */
export function scanBundle(dir, env) {
  const secrets = Object.entries(env).filter(([k, v]) => !k.startsWith('VITE_') && SECRET_NAME.test(k) && typeof v === 'string' && v.trim().length >= MIN_LENGTH)
    .map(([k, v]) => [k, String(v).trim()]);
  const leaks = [];
  for (const f of files(dir)) {
    const text = readFileSync(f, 'utf8');
    for (const [name, value] of secrets) if (text.includes(value)) leaks.push({ name, file: relative(dir, f) });
  }
  return { checked: secrets.map(([k]) => k).sort(), leaks };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2] || 'dist';
  if (!existsSync(dir)) { console.error(`[bundle-secret-scan] ${dir} not found: build first`); process.exit(2); }
  const { checked, leaks } = scanBundle(dir, process.env);
  for (const l of leaks) console.error(`[bundle-secret-scan] FAIL ${l.name} value found in ${l.file}`);
  console.log(`[bundle-secret-scan] ${leaks.length ? 'FAIL' : 'PASS'} — ${checked.length} server-only secret value(s) checked, ${leaks.length} leak(s)`);
  process.exit(leaks.length ? 1 : 0);
}
