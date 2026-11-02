import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * R34 (R33 audit): the check read a `.env.template` that no longer exists, and asked for EVERY template variable in every environment — the opposite of
 * the activation guide (many variables are module-only, LAB-only or forbidden in production). It now lists the variables the production gate
 * (scripts/release-preflight.mjs) reads and says which of them the chosen Vercel environment has — names only, never a value. A name the gate reads is
 * not necessarily required (some are WARN or must stay ABSENT): the gate itself decides at build time; this is the owner's checklist.
 *   npm run vercel:env:check [-- --target production|preview|development]
 */
const PREFLIGHT_PATH = path.join(process.cwd(), 'scripts', 'release-preflight.mjs');
const argTarget = process.argv.includes('--target') ? process.argv[process.argv.indexOf('--target') + 1] : 'production';
const REQUIRED_TARGETS = [argTarget];

function stderr(line) {
  process.stderr.write(`${line}\n`);
}

/** the environment variable names the production gate reads (get('NAME') and the arrays of names it checks) @param {string} src */
export function gateVarNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/get\('([A-Z0-9_]+)'\)/g)) names.add(m[1]);
  for (const m of src.matchAll(/\[((?:\s*'[A-Z0-9_]+',?\s*){2,})\]\.(?:every|filter|some|map)/g)) for (const n of m[1].matchAll(/'([A-Z0-9_]+)'/g)) names.add(n[1]);
  return [...names].sort();
}

function readTemplateVarNames() {
  if (!fs.existsSync(PREFLIGHT_PATH)) {
    stderr('[vercel-env] scripts/release-preflight.mjs not found (run from the repository root).');
    process.exit(1);
  }
  return gateVarNames(fs.readFileSync(PREFLIGHT_PATH, 'utf8'));
}

function runVercelJson() {
  const res = spawnSync('vercel', ['env', 'ls', '--format', 'json', '--non-interactive'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (res.error && res.error.code === 'ENOENT') {
    stderr('[vercel-env] Vercel CLI not found. Install: npm i -g vercel');
    process.exit(2);
  }

  if (res.status !== 0) {
    // Never echo raw output because it might include sensitive values in some CLI versions.
    stderr('[vercel-env] Failed to list env vars. Ensure the repo is linked: vercel link');
    process.exit(1);
  }

  const out = (res.stdout || Buffer.from('')).toString('utf8').trim();
  try {
    return JSON.parse(out);
  } catch {
    stderr('[vercel-env] Failed to parse Vercel CLI JSON output.');
    process.exit(1);
  }
}

function buildPresenceIndex(vercelList) {
  const index = new Map(); // key -> Set(target)

  const items = Array.isArray(vercelList) ? vercelList : vercelList?.envs ?? vercelList?.variables ?? [];
  for (const item of items) {
    const key = item?.key ?? item?.name;
    const targets = item?.target ?? item?.targets;
    if (!key || !targets) continue;

    const set = index.get(key) ?? new Set();
    for (const t of targets) set.add(String(t));
    index.set(key, set);
  }

  return index;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const required = readTemplateVarNames();
  const vercelList = runVercelJson();
  const presence = buildPresenceIndex(vercelList);
  for (const target of REQUIRED_TARGETS) {
    const has = required.filter((name) => presence.get(name)?.has(target));
    const absent = required.filter((name) => !presence.get(name)?.has(target));
    process.stdout.write(`Read by the production gate — present in ${target} (${has.length}):\n${has.join('\n')}\n\nabsent in ${target} (${absent.length}):\n${absent.join('\n')}\n`);
  }
  process.stdout.write('\nThe gate decides at build time (FAIL / WARN / must stay absent): see R33_VERCEL_ENV_AND_PROVIDER_ACTIVATION_GUIDE_FR.md.\n');
  process.exit(0);
}
