#!/usr/bin/env node
/**
 * R46 finish — the browser journeys of e2e-r46/finish on the BUILT app with the REAL API (scripts/lab-server.mjs → api/index.js) and a disposable, migrated
 * LAB PostgreSQL. Two servers on the same database, never :3000 and never the Vite dev proxy:
 *   R46F_PORT (5187)        the DPO has set no guardian policy (the honest default: POLICY_PENDING)
 *   R46F_PORT_CONF (3187)   a synthetic configured policy (ADA_AGE_POLICY_JSON.guardianVerification) so the record path can be exercised end to end
 * Fresh random secrets per run (never printed, never written to the tree); the administrator sessions are signed with them and passed to Playwright by env.
 *   DATABASE_URL=postgres://…@127.0.0.1:55434/ada_r46_finish_test R46F_DIST=<built app dir> node --import tsx e2e-r46/finish/run-lab.mjs [--keep] [-- <playwright args>]
 * --keep: leaves both servers running after the run (for scripts/q01-keyboard-journey.mjs and scripts/load-budget.mjs); stop them with Ctrl+C.
 * --load: the servers keep the client-supplied X-Forwarded-For (LAB_LOAD_FORWARDED=1) so the load budget can model distinct visitors.
 */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.R46F_PORT || 5187), PORT_CONF = Number(process.env.R46F_PORT_CONF || 3187);
if ([PORT, PORT_CONF].includes(3000)) throw new Error('port 3000 is the owner LAB');
const DIST = path.resolve(process.env.R46F_DIST || '');
if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('R46F_DIST: no built app (npx vite build --outDir <dir>)');
const u = new URL(process.env.DATABASE_URL || 'postgres://none/none');
if (!['127.0.0.1', 'localhost'].includes(u.hostname) || !u.pathname.endsWith('_test')) throw new Error('local *_test database only');
const keep = process.argv.includes('--keep');
const load = process.argv.includes('--load');   // Q05: the servers keep the client X-Forwarded-For (scripts/load-budget.mjs models distinct visitors)
const pwArgs = process.argv.includes('--') ? process.argv.slice(process.argv.indexOf('--') + 1) : [];

const hex = () => crypto.randomBytes(32).toString('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r46f-'));
const SECRETS = { JWT_SECRET: hex(), AUTH_SECRET: hex(), ADA_ENCRYPTION_KEY: hex(), CRON_SECRET: hex(), BYPASS_SECRET: hex() };
const BASE_ENV = {
  PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'fr_FR.UTF-8', TZ: 'Europe/Paris', NODE_ENV: 'development', VERCEL_ENV: 'development',
  DATABASE_URL: process.env.DATABASE_URL, ADA_PUBLIC_CONTENT_MODE: 'lab', MAILER_PROVIDER: 'test', OLLAMA_BASE_URL: 'http://127.0.0.1:9',
  ADA_VEILLE: 'off', ADA_VERIFICATION_NETWORK: 'off', LAB_QA_PRIORITY: 'off', ...(load ? { LAB_LOAD_FORWARDED: '1' } : {}), LAB_DIST: DIST, ADA_LOCAL_STORAGE_DIR: path.join(tmp, 'storage'), ...SECRETS,
};
export const CONFIGURED_POLICY = JSON.stringify({ status: 'CONFIGURED', guardianVerification: { strongMethods: ['PROFESSIONAL_ATTESTATION', 'IDENTITY_DOCUMENT_CHECK'], scopes: ['synthetic.lab.scope'] } });

const seedOut = path.join(tmp, 'seed.json');
const seed = spawnSync(process.execPath, ['--import', 'tsx', 'e2e-r46/finish/seed.mjs', '--out', seedOut], { cwd: ROOT, env: BASE_ENV, encoding: 'utf8' });
if (seed.status !== 0) { console.error(seed.stderr); process.exit(1); }
const { links } = JSON.parse(fs.readFileSync(seedOut, 'utf8'));

// administrator sessions signed with this run's secret (the server verifies them; AdminUser has no row for this synthetic address — non-strict LAB registry)
for (const [k, v] of Object.entries(SECRETS)) process.env[k] = v;
const { signAdminSessionToken } = await import('../../api/_utils/auth.js');
const ADMIN = 'r46f-admin@example.test';
const tokens = { mfa: signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: true }), noMfa: signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: false }) };

const servers = [];
function start(port, extra) {
  const p = spawn(process.execPath, ['--import', 'tsx', 'scripts/lab-server.mjs'], { cwd: ROOT, env: { ...BASE_ENV, LAB_PORT: String(port), ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', () => {}); p.stderr.on('data', (d) => { if (/refusing|EADDRINUSE/.test(String(d))) process.stderr.write(`[${port}] ${d}`); });
  servers.push(p); return p;
}
const stopAll = () => { for (const s of servers) { try { s.kill('SIGTERM'); } catch { /* gone */ } } };
process.on('SIGINT', () => { stopAll(); process.exit(130); });
start(PORT, {});
start(PORT_CONF, { ADA_AGE_POLICY_JSON: CONFIGURED_POLICY });
for (const port of [PORT, PORT_CONF]) {
  let up = false;
  for (let i = 0; i < 120 && !up; i += 1) { up = await fetch(`http://127.0.0.1:${port}/__lab/health`).then((r) => r.ok, () => false); if (!up) await new Promise((r) => setTimeout(r, 500)); }
  if (!up) { stopAll(); throw new Error(`server ${port} did not start`); }
}
console.log(`servers up: http://127.0.0.1:${PORT} (policy pending), http://127.0.0.1:${PORT_CONF} (synthetic configured policy)`);
const pw = spawnSync('npx', ['--no-install', 'playwright', 'test', '-c', 'e2e-r46/finish/playwright.config.mjs', ...pwArgs], {
  cwd: ROOT, stdio: 'inherit',
  env: { ...process.env, R46F_BASE: `http://127.0.0.1:${PORT}`, R46F_BASE_CONF: `http://127.0.0.1:${PORT_CONF}`, R46F_TOKEN: tokens.mfa, R46F_TOKEN_NOMFA: tokens.noMfa,
    R46F_LINKS: JSON.stringify(links), R46F_DB: process.env.DATABASE_URL },
});
if (keep) { console.log('--keep: servers left running (Ctrl+C stops them)'); await new Promise(() => {}); }
stopAll(); fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pw.status ?? 1);
