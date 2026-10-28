import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const TEMPLATE_PATH = path.join(process.cwd(), '.env.template');
const REQUIRED_TARGETS = ['development', 'preview', 'production'];

function stderr(line) {
  process.stderr.write(`${line}\n`);
}

function readTemplateVarNames() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    stderr(`[vercel-env] Missing ${path.basename(TEMPLATE_PATH)} at repo root.`);
    process.exit(1);
  }

  const raw = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const names = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const name = trimmed.slice(0, eq).trim();
    if (!/^[A-Z0-9_]+$/.test(name)) continue;
    names.push(name);
  }

  return Array.from(new Set(names));
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

const required = readTemplateVarNames();
const vercelList = runVercelJson();
const presence = buildPresenceIndex(vercelList);

let hadMissing = false;

for (const target of REQUIRED_TARGETS) {
  const missing = [];
  for (const name of required) {
    const targets = presence.get(name);
    if (!targets || !targets.has(target)) missing.push(name);
  }

  if (missing.length > 0) {
    hadMissing = true;
    process.stdout.write(`Missing (${target}):\n`);
    for (const name of missing) process.stdout.write(`${name}\n`);
  }
}

process.exit(hadMissing ? 3 : 0);
