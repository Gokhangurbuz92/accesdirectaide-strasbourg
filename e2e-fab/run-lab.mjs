#!/usr/bin/env node
/**
 * FA-CAP — capability-level browser tests (LAB_SYNTHETIC) for the register rows that had only the R47 page crawl. Same harness as e2e-fa1 (reused, not
 * copied): on an EMPTY disposable local PostgreSQL (*_test), it
 *   1. migrates it with the whole drizzle journal;
 *   2. seeds the e2e-fa1 fixture (fictional people / organisations / institutions / administrators), the fictional LAB pilot « CDGG Conseil »
 *      (scripts/lab/seed-cdgg-conseil.mjs: bookable services, opening hours, professionals) and this suite's public catalogue (e2e-fab/seed.mjs);
 *   3. starts, on 127.0.0.1 only, the built app + the REAL api/index.js (e2e-r47/journeys/serve.mjs, unchanged) three times:
 *        FAB_PORT       (5211) LAB « open »: the restricted beta with every surface of the product open and the out-of-AIPD capabilities named (HDS-bound
 *                              ones with a SYNTHETIC LAB attestation — a format check only, not a certificate), capability enforcement on;
 *        FAB_PORT_PROD  (5212) the PRODUCTION configuration of today: restricted beta, only « admin » open (ADA_BETA_OPEN_SURFACES=admin), no capability
 *                              named, no HDS attestation — the closed-surface refusals are asserted HERE (« the gate holds » is the capability test);
 *        FAB_PORT_TWIN  (5213) a second instance of the open configuration on the same database and secrets (Q11 multi-instance);
 *        FAB_PORT_PRO   (5216) G3 « pro open + every out-of-AIPD / HDS capability closed »: the Production configuration plus the accounts and pro surfaces
 *                              (ADA_BETA_OPEN_SURFACES=admin,accounts,pro), no capability named, no HDS attestation, the second factor required
 *                              (PRO_MFA_REQUIRED=true, as VERCEL_ENV=production does), its own build (VITE_PUBLIC_BETA_OPEN_SURFACES=admin,accounts,pro) —
 *                              the partial ADA Pro opening of SD Track 2/3 (e2e-fab/pro-partial.pw.mjs);
 *   4. runs the Playwright suite e2e-fab/*.pw.mjs (one file per surface).
 * Fresh random secrets per run (never printed, never written to the tree). MAILER_PROVIDER=test (in-memory outbox, nothing delivered). The application's
 * API is never mocked.
 * One command (fresh database created, both builds made, ~4 min):
 *   FAB_CREATE_DB=1 DATABASE_URL=postgres://ada_test@127.0.0.1:55434/ada_fab_test node --import tsx e2e-fab/run-lab.mjs [-- <playwright args>]
 * (FAB_DIST / FAB_DIST_PROD / FAB_DIST_PRO reuse existing builds; FAB_LOG_DIR keeps the server logs; FAB_REPORT writes the JSON report.)
 */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const t0 = Date.now();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.FAB_PORT || 5211), PORT_PROD = Number(process.env.FAB_PORT_PROD || 5212), PORT_TWIN = Number(process.env.FAB_PORT_TWIN || 5213);
const PORT_PRO = Number(process.env.FAB_PORT_PRO || 5216);
if ([PORT, PORT_PROD, PORT_TWIN, PORT_PRO].includes(3000)) throw new Error('port 3000 is the owner LAB');
const dbUrl = new URL(process.env.DATABASE_URL || 'postgres://none/none');
if (!['127.0.0.1', 'localhost'].includes(dbUrl.hostname) || !dbUrl.pathname.endsWith('_test')) throw new Error('local *_test database only');
const pwArgs = process.argv.includes('--') ? process.argv.slice(process.argv.indexOf('--') + 1) : [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fab-'));
const pg = (await import('pg')).default;

// 0. two builds of the app: the LAB build (no beta flags, as e2e-fa1) and the build of the PRODUCTION configuration (VITE_PUBLIC_BETA=true, only
// « admin » open — what the Production pages say about closed functions). Built here unless FAB_DIST / FAB_DIST_PROD point at existing builds.
function build(dir, extra) {
  if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  const b = spawnSync('npx', ['--no-install', 'vite', 'build', '--outDir', dir, '--emptyOutDir'], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...extra }, encoding: 'utf8' });
  if (b.status !== 0) throw new Error(`vite build failed: ${String(b.stderr).slice(-2000)}`);
  return dir;
}
const DIST = build(path.resolve(process.env.FAB_DIST || path.join(tmp, 'dist-open')), {});
const DIST_PROD = build(path.resolve(process.env.FAB_DIST_PROD || path.join(tmp, 'dist-prod')), { VITE_PUBLIC_BETA: 'true', VITE_PUBLIC_BETA_OPEN_SURFACES: 'admin', VITE_VERCEL_ENV: 'production' });
// G3: the build of the partial pro opening (the screens of accounts and pro are served; the console reads the open modules from /api/pro/me)
const DIST_PRO = build(path.resolve(process.env.FAB_DIST_PRO || path.join(tmp, 'dist-pro')), { VITE_PUBLIC_BETA: 'true', VITE_PUBLIC_BETA_OPEN_SURFACES: 'admin,accounts,pro', VITE_VERCEL_ENV: 'production' });
console.log(`builds ready (${Math.round((Date.now() - t0) / 1000)} s)`);

// FAB_CREATE_DB=1: (re)create the named loopback *_test database with the extensions the schema needs (one-command run)
if (process.env.FAB_CREATE_DB === '1') {
  const name = decodeURIComponent(dbUrl.pathname.slice(1));
  if (!/^[a-z0-9_]+_test$/.test(name)) throw new Error('FAB_CREATE_DB: plain *_test database names only');
  const admin = new URL(dbUrl.href); admin.pathname = '/postgres';
  const c = new pg.Client({ connectionString: admin.href }); await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${name}`); await c.query(`CREATE DATABASE ${name}`); await c.end();
  const d = new pg.Client({ connectionString: dbUrl.href }); await d.connect();
  for (const x of ['unaccent', 'pg_trgm', 'vector']) await d.query(`CREATE EXTENSION IF NOT EXISTS ${x}`);
  await d.query(`ALTER DATABASE ${name} SET timezone TO 'UTC'`);   // as the native QA's databases: the app stores UTC wall clocks
  await d.end();
}

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

// 2. secrets, environment, seeds
const hex = () => crypto.randomBytes(32).toString('hex');
const SECRETS = { JWT_SECRET: hex(), AUTH_SECRET: hex(), ADA_ENCRYPTION_KEY: hex(), CRON_SECRET: hex(), BYPASS_SECRET: hex(), ADA_VAULT_KEY: hex(), ADMIN_TOKEN: hex() };
for (const [k, v] of Object.entries(SECRETS)) process.env[k] = v;
const LAB_HDS = `HDS1:lab-synthetic:FAB-SYNTHETIC-NOT-A-CERT:2099-12-31:${'0'.repeat(64)}`;
const BASE_ENV = {
  PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'fr_FR.UTF-8', TZ: 'UTC', NODE_ENV: 'development', VERCEL_ENV: 'development',
  DATABASE_URL: process.env.DATABASE_URL, WS2_REQUIRE_LOCAL_DB: '1', ADA_PUBLIC_CONTENT_MODE: 'lab', MAILER_PROVIDER: 'test', MAILER_FROM: 'qa@example.test', OLLAMA_BASE_URL: 'http://127.0.0.1:9',
  ADA_VEILLE: 'off', ADA_VERIFICATION_NETWORK: 'off', ADA_LOCAL_STORAGE_DIR: path.join(tmp, 'storage'), ADA_CAPABILITY_ENFORCEMENT: '1', ADA_PUBLIC_BETA_RESTRICTED: '1',
  ...SECRETS,
};
/** every surface ADA_BETA_OPEN_SURFACES can open, every out-of-AIPD capability that a switch can open (citizen.minor_accounts can never open) */
const OPEN_CAPS = ['citizen.household', 'citizen.guardians', 'citizen.parcours', 'citizen.favorites', 'citizen.history', 'citizen.franceconnect', 'citizen.delegations',
  'citizen.orientation_records', 'citizen.vault', 'citizen.shared_dossier', 'citizen.saved_diagnostic', 'diagnostic.questionnaire', 'pro.case_management', 'pro.referrals',
  'pro.orientation_selections', 'pro.siao_interop', 'ai.processing', 'institution.portal', 'video'];
// LAB identity providers: two local mock OpenID Connect issuers (scripts/lab/mock-franceconnect.mjs — NOT FranceConnect / ProConnect, synthetic identities,
// loopback only): one as FranceConnect for the citizen link / sign-in (C26, N08), one as the ProConnect federation for the LAB pilot operator (R02, N09)
const { PROS: PILOT_PROS } = await import('../scripts/lab/seed-cdgg-conseil.mjs');
const FC_PORT = Number(process.env.FAB_PORT_FC || 5214), PC_PORT = Number(process.env.FAB_PORT_PC || 5215);
const fcMock = { issuer: `http://127.0.0.1:${FC_PORT}`, clientId: 'lab-fc-client', clientSecret: 'lab-fc-secret-not-a-real-credential' };
const pcMock = { issuer: `http://127.0.0.1:${PC_PORT}`, clientId: 'lab-pc-client', clientSecret: 'lab-pc-secret-not-a-real-credential' };
const mockProc = spawn(process.execPath, ['e2e-fab/mock-idp.mjs'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], env: { PATH: process.env.PATH, FAB_MOCKS: JSON.stringify([
  { port: FC_PORT, sub: 'fab-fc-sub-0001', email: 'fab-fc@usagers.example.test', ...fcMock },
  { port: PC_PORT, sub: 'fab-pc-sub-0001', email: PILOT_PROS.operator.email, ...pcMock }]) } });
process.on('exit', () => { try { mockProc.kill('SIGTERM'); } catch { /* gone */ } });
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('mock identity providers did not start')), 20000);
  mockProc.stdout.on('data', (d) => { if (String(d).includes('ready')) { clearTimeout(timer); resolve(undefined); } });
});
const JITSI_SECRET = hex();
const OPEN_ENV = { ADA_BETA_OPEN_SURFACES: 'accounts,pro,institution,appointments,video,communications,documents,diagnostic,admin', ADA_BETA_ACCOUNTS_SCOPE: 'full',
  ADA_CAPABILITIES_OPEN: OPEN_CAPS.join(','), ADA_HDS_CERTIFIED_HOSTING: LAB_HDS,
  // jobs opened one at a time, the personal-data ones (category C) also « approved » — LAB only, Production approves each job separately
  ADA_BETA_OPEN_JOBS: 'rdv-reminder,parcours-reminder,referral-timeouts,link-check,observatory-freeze,health-alert', ADA_JOBS_APPROVED: 'rdv-reminder,parcours-reminder,referral-timeouts',
  FRANCECONNECT_ISSUER: fcMock.issuer, FRANCECONNECT_CLIENT_ID: fcMock.clientId, FRANCECONNECT_CLIENT_SECRET: fcMock.clientSecret,
  PROCONNECT_ENABLED: 'true', PROCONNECT_ISSUER: pcMock.issuer, PROCONNECT_CLIENT_ID: pcMock.clientId, PROCONNECT_CLIENT_SECRET: pcMock.clientSecret,
  // video: a SANDBOX Jitsi-JWT configuration (the domain is never contacted; tokens are checked offline) — B07 / N06
  VIDEO_PROVIDER: 'jitsi-jwt', VIDEO_JITSI_DOMAIN: 'visio.lab.example.test', VIDEO_JITSI_APP_ID: 'ada-lab', VIDEO_JITSI_SECRET: JITSI_SECRET, VIDEO_SANDBOX: 'true' };
/** Production today (CONTROL/master/MASTER_CHECKPOINT.md, 18/11/2026): restricted beta, administration open, accounts not yet (6B pending), nothing named */
const HEAD_SHA = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const PROD_ENV = { ADA_BETA_OPEN_SURFACES: 'admin',
  // the jobs Production opens (names only, MASTER_CHECKPOINT 15/11: health-alert, actualites, ingest-structures, veille, gdpr-purge; gdpr-purge approved,
  // GDPR_PURGE_ENABLED unset) — the suite calls only health-alert and gdpr-purge (no network); the deployed commit as Vercel gives it (Q08)
  ADA_BETA_OPEN_JOBS: 'health-alert,actualites,ingest-structures,veille,gdpr-purge', ADA_JOBS_APPROVED: 'gdpr-purge', VERCEL_GIT_COMMIT_SHA: HEAD_SHA };
/** G3: « pro open + every out-of-AIPD / HDS capability closed » — Production plus accounts and pro, nothing named, no HDS, the second factor required */
const PRO_ONLY_ENV = { ...PROD_ENV, ADA_BETA_OPEN_SURFACES: 'admin,accounts,pro', PRO_MFA_REQUIRED: 'true' };
const creds = path.join(tmp, 'creds.json');
const { seed } = await import('../e2e-fa1/seed.mjs');
const seeded = await seed(process.env.DATABASE_URL);
const pilotCreds = path.join(tmp, 'cdgg.json');
const ps = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/lab/seed-cdgg-conseil.mjs', 'seed', '--credentials', pilotCreds], { cwd: ROOT, env: { ...BASE_ENV }, encoding: 'utf8' });
if (ps.status !== 0) throw new Error(`pilot seed failed: ${ps.stderr}`);
seeded.pilot = JSON.parse(fs.readFileSync(pilotCreds, 'utf8'));
const { seedCatalogue } = await import('./seed.mjs');
seeded.catalogue = await seedCatalogue(process.env.DATABASE_URL);
fs.writeFileSync(creds, JSON.stringify(seeded, null, 2), { mode: 0o600 });
console.log(`seeded: e2e-fa1 fixture + LAB pilot + catalogue ${JSON.stringify(seeded.catalogue.counts)} (LAB_SYNTHETIC)`);

// 3. sessions signed with this run's secrets (never printed)
const { signAdminSessionToken, signProToken } = await import('../api/_utils/auth.js');
const { signInstitutionToken } = await import('../api/_utils/institution-auth.js');
const elev = () => ({ elev_until: Math.floor(Date.now() / 1000) + 3 * 3600, elev_kind: 'JIT', elev_id: crypto.randomUUID() });
const tokens = {
  admin: signAdminSessionToken({ email: seeded.admins.a, role: 'superadmin', mfa_verified: true, ...elev() }),
  admin2: signAdminSessionToken({ email: seeded.admins.b, role: 'superadmin', mfa_verified: true, ...elev() }),
  adminNoElev: signAdminSessionToken({ email: seeded.admins.a, role: 'superadmin', mfa_verified: true }),
  inst67: signInstitutionToken(seeded.institutions.bas_rhin), inst68: signInstitutionToken(seeded.institutions.haut_rhin),
};
for (const [k, p] of Object.entries(seeded.pros)) tokens[`pro_${k}`] = signProToken({ id: p.id, email: p.email, structureId: p.structureId, role: p.role });
{
  const { PROS } = await import('../scripts/lab/seed-cdgg-conseil.mjs');
  for (const [k, p] of Object.entries(PROS)) tokens[`cdgg_${k}`] = signProToken({ id: p.id, email: p.email, structureId: p.sid, role: p.role });
}
// G3: the platform operator of the partial-opening spec (its ProUser row is written by e2e-fab/pro-partial.pw.mjs), session with the second factor
tokens.g3_op = signProToken({ id: 'fab-g3-op', email: 'fab-g3-op@pros.example.test', structureId: 'fab-g3-platform', role: 'SUPERADMIN' }, { mfa: true });
tokens.cron = SECRETS.CRON_SECRET; tokens.jitsi = JITSI_SECRET;   // the jobs' secret and the sandbox video secret, for the tests' own calls / offline checks
fs.writeFileSync(path.join(tmp, 'tokens.json'), JSON.stringify(tokens), { mode: 0o600 });

// 4. servers
const servers = [];
function start(extra, label) {
  const p = spawn(process.execPath, ['--import', 'tsx', 'e2e-r47/journeys/serve.mjs'], { cwd: ROOT, env: { ...BASE_ENV, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = fs.createWriteStream(path.join(process.env.FAB_LOG_DIR || tmp, `${label}.log`));
  p.stdout.pipe(log); p.stderr.pipe(log); servers.push(p); return p;
}
const stopAll = () => { for (const s of servers) { try { s.kill('SIGTERM'); } catch { /* gone */ } } try { mockProc.kill('SIGTERM'); } catch { /* gone */ } };
process.on('SIGINT', () => { stopAll(); process.exit(130); });
process.on('exit', stopAll);   // a failed start never leaves a server behind
const at = (port) => ({ R47_PORT: String(port), R47_DIST: DIST, APP_BASE_URL: `http://127.0.0.1:${port}`, APP_URL: `http://127.0.0.1:${port}` });
start({ ...OPEN_ENV, ...at(PORT), PROCONNECT_REDIRECT_URI: `http://127.0.0.1:${PORT}/api/pro/auth/proconnect/callback` }, 'server-open');
start({ ...PROD_ENV, ...at(PORT_PROD), R47_DIST: DIST_PROD }, 'server-prod');
start({ ...OPEN_ENV, ...at(PORT_TWIN), PROCONNECT_REDIRECT_URI: `http://127.0.0.1:${PORT_TWIN}/api/pro/auth/proconnect/callback` }, 'server-twin');
start({ ...PRO_ONLY_ENV, ...at(PORT_PRO), R47_DIST: DIST_PRO }, 'server-pro-only');
for (const port of [PORT, PORT_PROD, PORT_TWIN, PORT_PRO]) {
  const u = `http://127.0.0.1:${port}/__lab/health`; let up = false;
  for (let i = 0; i < 120 && !up; i += 1) { up = await fetch(u).then((r) => r.ok, () => false); if (!up) await new Promise((r) => setTimeout(r, 500)); }
  if (!up) { stopAll(); throw new Error(`${u} did not start`); }
}
console.log(`up: open ${PORT}, production-configuration ${PORT_PROD}, twin ${PORT_TWIN}, pro-only ${PORT_PRO} (${Math.round((Date.now() - t0) / 1000)} s)`);
const pw = spawnSync('npx', ['--no-install', 'playwright', 'test', '-c', 'e2e-fab/playwright.config.mjs', ...pwArgs], {
  cwd: ROOT, stdio: 'inherit',
  env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'fr_FR.UTF-8', TZ: 'UTC',
    FA1_BASE: `http://127.0.0.1:${PORT}`, FA1_BASE_CLOSED: `http://127.0.0.1:${PORT_PROD}`, FAB_BASE_TWIN: `http://127.0.0.1:${PORT_TWIN}`, FAB_BASE_PRO: `http://127.0.0.1:${PORT_PRO}`,
    FA1_CREDS: creds, FA1_TOKENS: path.join(tmp, 'tokens.json'), FA1_DB: process.env.DATABASE_URL,
    ...(process.env.FAB_REPORT ? { FAB_REPORT: process.env.FAB_REPORT } : {}), ...(process.env.FAB_OUT ? { FAB_OUT: process.env.FAB_OUT } : {}) },
});
stopAll();
fs.rmSync(tmp, { recursive: true, force: true });   // credentials, tokens, storage: never kept (server logs go to FAB_LOG_DIR when set)
console.log(`FAB total wall time: ${Math.round((Date.now() - t0) / 1000)} s`);
process.exit(pw.status ?? 1);
