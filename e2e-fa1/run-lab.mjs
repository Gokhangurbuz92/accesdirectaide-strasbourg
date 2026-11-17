#!/usr/bin/env node
/**
 * FA-D1 — synthetic citizen persona suite + golden journey browser layer (LAB_SYNTHETIC). On an EMPTY disposable local PostgreSQL (*_test, with the unaccent /
 * pg_trgm / vector extensions), it:
 *   1. migrates it with the WHOLE drizzle journal (0000 → the newest, as the native QA and Production after its approved migrations);
 *   2. seeds fictional people (@example.test), four organisations (three in the Eurométropole, one in the Haut-Rhin = another tenant), LAB guides for the
 *      official sheets the personas meet, official records of different verification ages, two institution accounts (Bas-Rhin, Haut-Rhin);
 *   3. starts, on 127.0.0.1 only, the built app + the REAL api/index.js twice (e2e-r47/journeys/serve.mjs, reused as is):
 *        FA1_PORT (5196)        the restricted beta with exactly the journey's surfaces and capabilities open (HDS-bound ones with a SYNTHETIC LAB attestation —
 *                               format check only, not a certificate), capability enforcement on, MAILER_PROVIDER=test (in-memory outbox, nothing delivered);
 *        FA1_PORT_CLOSED (5197) the Production default: restricted beta, nothing open — the « service unavailable / closed surface » states;
 *   4. runs the Playwright suite e2e-fa1/*.pw.mjs (personas, then the golden journey).
 * Fresh random secrets per run (never printed, never written to the tree). Organisation, institution and administrator sessions are signed with this run's
 * secret (their own sign-in screens are covered by e2e-r46 / e2e-r47); citizens sign in through the real form.
 *   DATABASE_URL=postgres://ada_test@127.0.0.1:55434/ada_fa1_e2e_test FA1_DIST=<built app dir> node --import tsx e2e-fa1/run-lab.mjs [-- <playwright args>]
 */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.FA1_PORT || 5196), PORT_CLOSED = Number(process.env.FA1_PORT_CLOSED || 5197);
if ([PORT, PORT_CLOSED].includes(3000)) throw new Error('port 3000 is the owner LAB');
const DIST = path.resolve(process.env.FA1_DIST || path.join(ROOT, 'dist'));
if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('FA1_DIST: no built app (npx vite build --outDir <dir>)');
const dbUrl = new URL(process.env.DATABASE_URL || 'postgres://none/none');
if (!['127.0.0.1', 'localhost'].includes(dbUrl.hostname) || !dbUrl.pathname.endsWith('_test')) throw new Error('local *_test database only');
const pwArgs = process.argv.includes('--') ? process.argv.slice(process.argv.indexOf('--') + 1) : [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa1-'));
const pg = (await import('pg')).default;

// 1. the whole migration chain
{
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  const n = (await c.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'public'`)).rows[0].n;
  if (n > 0) { await c.end(); throw new Error('the database is not empty: create a fresh one'); }
  const { drizzle } = await import('drizzle-orm/node-postgres'); const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(drizzle(c), { migrationsFolder: path.join(ROOT, 'drizzle') });
  const rows = (await c.query('SELECT count(*)::int n FROM drizzle.__drizzle_migrations')).rows[0].n;
  const journal = JSON.parse(fs.readFileSync(path.join(ROOT, 'drizzle/meta/_journal.json'), 'utf8')).entries.length;
  await c.end();
  console.log(`migrated: ${rows} migration rows (journal ${journal})`);
  if (rows !== journal) throw new Error('unexpected schema after migration');
}

// 2. secrets, environment, seed
const hex = () => crypto.randomBytes(32).toString('hex');
const SECRETS = { JWT_SECRET: hex(), AUTH_SECRET: hex(), ADA_ENCRYPTION_KEY: hex(), CRON_SECRET: hex(), BYPASS_SECRET: hex(), ADA_VAULT_KEY: hex(), ADMIN_TOKEN: hex() };
for (const [k, v] of Object.entries(SECRETS)) process.env[k] = v;
const LAB_HDS = `HDS1:lab-synthetic:FA1-SYNTHETIC-NOT-A-CERT:2099-12-31:${'0'.repeat(64)}`;
const BASE_ENV = {
  PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'fr_FR.UTF-8', TZ: 'UTC', NODE_ENV: 'development', VERCEL_ENV: 'development',
  DATABASE_URL: process.env.DATABASE_URL, WS2_REQUIRE_LOCAL_DB: '1', ADA_PUBLIC_CONTENT_MODE: 'lab', MAILER_PROVIDER: 'test', MAILER_FROM: 'qa@example.test', OLLAMA_BASE_URL: 'http://127.0.0.1:9',
  ADA_VEILLE: 'off', ADA_VERIFICATION_NETWORK: 'off', ADA_LOCAL_STORAGE_DIR: path.join(tmp, 'storage'), ADA_CAPABILITY_ENFORCEMENT: '1', ADA_PUBLIC_BETA_RESTRICTED: '1',
  ...SECRETS,
};
const OPEN_ENV = { ADA_BETA_OPEN_SURFACES: 'accounts,pro,documents,diagnostic,institution,admin', ADA_BETA_ACCOUNTS_SCOPE: 'full',
  ADA_CAPABILITIES_OPEN: 'citizen.parcours,citizen.orientation_records,citizen.shared_dossier,citizen.saved_diagnostic,pro.case_management,pro.referrals,institution.portal',
  ADA_HDS_CERTIFIED_HOSTING: LAB_HDS };
const creds = path.join(tmp, 'creds.json');
const { seed } = await import('./seed.mjs');
const seeded = await seed(process.env.DATABASE_URL);
fs.writeFileSync(creds, JSON.stringify(seeded, null, 2), { mode: 0o600 });
console.log(`seeded: ${Object.keys(seeded.citizens).length} people, ${Object.keys(seeded.structures).length} organisations, ${seeded.guides.length} LAB guides (LAB_SYNTHETIC)`);

// 3. sessions signed with this run's secrets (never printed)
const { signAdminSessionToken, signProToken } = await import('../api/_utils/auth.js');
const { signInstitutionToken } = await import('../api/_utils/institution-auth.js');
const elev = () => ({ elev_until: Math.floor(Date.now() / 1000) + 3 * 3600, elev_kind: 'JIT', elev_id: crypto.randomUUID() });
const tokens = {
  admin: signAdminSessionToken({ email: seeded.admins.a, role: 'superadmin', mfa_verified: true, ...elev() }),
  admin2: signAdminSessionToken({ email: seeded.admins.b, role: 'superadmin', mfa_verified: true, ...elev() }),
  inst67: signInstitutionToken(seeded.institutions.bas_rhin), inst68: signInstitutionToken(seeded.institutions.haut_rhin),
};
for (const [k, p] of Object.entries(seeded.pros)) tokens[`pro_${k}`] = signProToken({ id: p.id, email: p.email, structureId: p.structureId, role: p.role });
fs.writeFileSync(path.join(tmp, 'tokens.json'), JSON.stringify(tokens), { mode: 0o600 });

// 4. servers
const servers = [];
function start(extra, label) {
  const p = spawn(process.execPath, ['--import', 'tsx', 'e2e-r47/journeys/serve.mjs'], { cwd: ROOT, env: { ...BASE_ENV, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = fs.createWriteStream(path.join(process.env.FA1_LOG_DIR || tmp, `${label}.log`));
  p.stdout.pipe(log); p.stderr.pipe(log); servers.push(p); return p;
}
const stopAll = () => { for (const s of servers) { try { s.kill('SIGTERM'); } catch { /* gone */ } } };
process.on('SIGINT', () => { stopAll(); process.exit(130); });
start({ ...OPEN_ENV, R47_PORT: String(PORT), R47_DIST: DIST, APP_BASE_URL: `http://127.0.0.1:${PORT}`, APP_URL: `http://127.0.0.1:${PORT}` }, 'server-open');
start({ R47_PORT: String(PORT_CLOSED), R47_DIST: DIST, APP_BASE_URL: `http://127.0.0.1:${PORT_CLOSED}`, APP_URL: `http://127.0.0.1:${PORT_CLOSED}` }, 'server-closed');
for (const u of [`http://127.0.0.1:${PORT}/__lab/health`, `http://127.0.0.1:${PORT_CLOSED}/__lab/health`]) {
  let up = false;
  for (let i = 0; i < 120 && !up; i += 1) { up = await fetch(u).then((r) => r.ok, () => false); if (!up) await new Promise((r) => setTimeout(r, 500)); }
  if (!up) { stopAll(); throw new Error(`${u} did not start`); }
}
console.log(`up: open ${PORT}, closed ${PORT_CLOSED}`);
const pw = spawnSync('npx', ['--no-install', 'playwright', 'test', '-c', 'e2e-fa1/playwright.config.mjs', ...pwArgs], {
  cwd: ROOT, stdio: 'inherit',
  env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'fr_FR.UTF-8', TZ: 'UTC', FA1_BASE: `http://127.0.0.1:${PORT}`, FA1_BASE_CLOSED: `http://127.0.0.1:${PORT_CLOSED}`,
    FA1_CREDS: creds, FA1_TOKENS: path.join(tmp, 'tokens.json'), FA1_DB: process.env.DATABASE_URL,
    ...(process.env.FA1_REPORT ? { FA1_REPORT: process.env.FA1_REPORT } : {}), ...(process.env.FA1_OUT ? { FA1_OUT: process.env.FA1_OUT } : {}) },
});
stopAll();
fs.rmSync(tmp, { recursive: true, force: true });   // credentials, tokens, storage: never kept (server logs go to FA1_LOG_DIR when set)
process.exit(pw.status ?? 1);
