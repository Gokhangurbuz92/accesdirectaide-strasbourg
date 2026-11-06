#!/usr/bin/env node
/**
 * R47 journeys — the Production-equivalent LAB acceptance run. On an EMPTY disposable local PostgreSQL (*_test, with the unaccent / pg_trgm / vector
 * extensions), it:
 *   1. migrates it like Production: the chain 0000 → 0042 WITHOUT the obsolete guest migrations 0043 / 0044 (--schema 0042, the Production DB today), or
 *      that chain plus the prepared 0045 (--schema 0045, Production after an approved migration);
 *   2. seeds the fictional « CDGG Conseil » LAB pilot and its witness structure (scripts/lab/seed-cdgg-conseil.mjs seed + enrol: the professionals' MFA
 *      is enrolled through the real invitation flow) — synthetic data only, @example.test addresses;
 *   3. starts, on 127.0.0.1 only: the built app + the REAL api/index.js (e2e-r47/journeys/serve.mjs) on R47_PORT (5192) — capability gate enforced,
 *      professional MFA required, MAILER_PROVIDER=test —, a second one on R47_PORT_ENF (3192) with ADA_SENSITIVITY_REVIEW_ENFORCED=1, and the mock
 *      Microsoft authority + Graph (e2e-r47/journeys/mock-graph.mjs, 5292) — the only mocks are external providers;
 *   4. runs the Playwright suite e2e-r47/journeys/*.pw.mjs.
 * Fresh random secrets per run (never printed, never written to the tree). Administrator sessions are signed with this run's secret (non-strict LAB
 * registry; the administrator sign-in itself is not a journey here).
 *   DATABASE_URL=postgres://ada_test@127.0.0.1:55434/ada_r47_journeys_test R47_DIST=<built app dir> node --import tsx e2e-r47/journeys/run-lab.mjs --schema 0042 [-- <playwright args>]
 */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.R47_PORT || 5192), PORT_ENF = Number(process.env.R47_PORT_ENF || 3192), PORT_GRAPH = Number(process.env.R47_PORT_GRAPH || 5292);
if ([PORT, PORT_ENF, PORT_GRAPH].includes(3000)) throw new Error('port 3000 is the owner LAB');
const DIST = path.resolve(process.env.R47_DIST || path.join(ROOT, 'dist'));
if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('R47_DIST: no built app (npx vite build --outDir <dir>)');
const dbUrl = new URL(process.env.DATABASE_URL || 'postgres://none/none');
if (!['127.0.0.1', 'localhost'].includes(dbUrl.hostname) || !dbUrl.pathname.endsWith('_test')) throw new Error('local *_test database only');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const SCHEMA = arg('schema', '0042');
if (!['0042', '0045'].includes(SCHEMA)) throw new Error('--schema 0042 | 0045');
const pwArgs = process.argv.includes('--') ? process.argv.slice(process.argv.indexOf('--') + 1) : [];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r47j-'));
const pg = (await import('pg')).default;

// 1. the Production migration path (0043 / 0044 never; 0045 only with --schema 0045)
{
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  const n = (await c.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'public'`)).rows[0].n;
  if (n > 0) { await c.end(); throw new Error('the database is not empty: create a fresh one'); }
  const journal = JSON.parse(fs.readFileSync(path.join(ROOT, 'drizzle/meta/_journal.json'), 'utf8'));
  const keep = journal.entries.filter((e) => { const k = Number(e.tag.slice(0, 4)); return k <= 42 || (SCHEMA === '0045' && k === 45); });
  const dir = path.join(tmp, 'drizzle'); fs.mkdirSync(path.join(dir, 'meta'), { recursive: true });
  for (const e of keep) fs.copyFileSync(path.join(ROOT, 'drizzle', `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  fs.writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: keep }));
  const { drizzle } = await import('drizzle-orm/node-postgres'); const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(drizzle(c), { migrationsFolder: dir });
  const rows = (await c.query('SELECT count(*)::int n FROM drizzle.__drizzle_migrations')).rows[0].n;
  const kinds = (await c.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'AppointmentNotice_kind_check'`)).rows[0]?.d || '';
  await c.end();
  console.log(`migrated: ${rows} migration rows (schema ${SCHEMA}); notice kinds of 0045 ${kinds.includes('REQUEST_ACCEPTED') ? 'present' : 'absent'}`);
  if (rows !== keep.length || kinds.includes('REQUEST_ACCEPTED') !== (SCHEMA === '0045') || kinds.includes('BOOKED_BY_GUEST')) throw new Error('unexpected schema after migration');
}

// 2. secrets and environment (the same for the seed and the servers)
const hex = () => crypto.randomBytes(32).toString('hex');
const SECRETS = { JWT_SECRET: hex(), AUTH_SECRET: hex(), ADA_ENCRYPTION_KEY: hex(), CRON_SECRET: hex(), BYPASS_SECRET: hex(), ADA_VAULT_KEY: hex(), ADMIN_TOKEN: hex() };
const GRAPH = { id: 'r47-lab-outlook-client', secret: `lab-${hex()}` };
const BASE_ENV = {
  PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'fr_FR.UTF-8', TZ: 'UTC', NODE_ENV: 'development', VERCEL_ENV: 'development',
  DATABASE_URL: process.env.DATABASE_URL, WS2_REQUIRE_LOCAL_DB: '1', ADA_PUBLIC_CONTENT_MODE: 'lab', MAILER_PROVIDER: 'test', OLLAMA_BASE_URL: 'http://127.0.0.1:9',
  ADA_VEILLE: 'off', ADA_VERIFICATION_NETWORK: 'off', ADA_LOCAL_STORAGE_DIR: path.join(tmp, 'storage'),
  // Production-equivalent gates: the capability layer enforced (only the first-opening, in-AIPD capabilities are open), the professional second factor required
  ADA_CAPABILITY_ENFORCEMENT: '1', PRO_MFA_REQUIRED: 'true',
  // the structure-identity check of the administrator accepts this documentation host as its evidence URL (LAB only)
  ADA_VERIFICATION_EXTRA_DOMAINS: 'example.org',
  OUTLOOK_ENABLED: 'true', OUTLOOK_CLIENT_ID: GRAPH.id, OUTLOOK_CLIENT_SECRET: GRAPH.secret, OUTLOOK_REDIRECT_URI: `http://127.0.0.1:${PORT}/api/auth/callback/outlook`,
  OUTLOOK_AUTHORITY_URL: `http://127.0.0.1:${PORT_GRAPH}/oauth2/v2.0`, OUTLOOK_GRAPH_BASE_URL: `http://127.0.0.1:${PORT_GRAPH}/v1.0`,
  ...SECRETS,
};
const creds = path.join(tmp, 'creds.json');
for (const step of ['seed', 'enrol']) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/lab/seed-cdgg-conseil.mjs', step, '--credentials', creds], { cwd: ROOT, env: BASE_ENV, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); throw new Error(`seed ${step} failed`); }
  console.log(r.stdout.trim().split('\n').filter((l) => /^(SEEDED|ENROLLED)/.test(l)).join('\n'));
}
const enrolledAt = Date.now();
// the Paris-time fixture of journey 5: a dedicated adult citizen and their past appointment on 20 October 2026 at 08:00 UTC — summer time (CEST, 10:00 in Paris), before
// the change of 25 October — beside the winter-time slots of the coming weeks (CET, UTC+1)
{
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  const cr = JSON.parse(fs.readFileSync(creds, 'utf8'));
  const { hashPassword } = await import('../../api/_utils/password-hash.js');
  const dst = { id: 'lab-r47-dst-citizen', email: 'r47-heure-paris@cdgg-usagers.example.test', name: 'Personne Heure-Fictive', password: `Lab-${crypto.randomBytes(9).toString('base64url')}-9a` };
  await c.query(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "notificationEmailEnabled", "updatedAt", "createdAt") VALUES ($1, $2, $3, NOW(), true, NOW(), NOW())`, [dst.id, dst.email, await hashPassword(dst.password)]);
  await c.query(`INSERT INTO "CitizenProfile" ("userId", "displayName", "ageBand", "updatedAt") VALUES ($1, $2, '25-59', NOW())`, [dst.id, dst.name]);
  await c.query(`INSERT INTO "ConsentLog" (id, subject_type, subject_id, purpose, decision, policy_version, policy_hash, collection_channel, guardian_involved, proof_level)
    VALUES (gen_random_uuid()::text, 'CITIZEN_USER', $1, 'AGE_DECLARATION_ADULT', true, 'r42-a07-2026-11-04', 'r42-a07-2026-11-04:AGE_DECLARATION_ADULT', 'lab_fixture', false, 'SELF_DECLARATION')`, [dst.id]);
  cr.citizens.dst = { id: dst.id, email: dst.email, name: dst.name, password: dst.password };
  fs.writeFileSync(creds, JSON.stringify(cr, null, 2), { mode: 0o600 });
  await c.query(`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "citizenUserId", "createdByProUserId", "idempotencyKey", mode, "updatedAt", "createdAt")
    VALUES ('lab-r47-dst-past', $1, $2, '2026-10-20T08:00:00Z', '2026-10-20T09:00:00Z', 'done', 'Particulier fictif', $3, $4, 'lab-r47-dst-past', 'IN_PERSON', NOW(), NOW())`,
  [cr.structure.id, cr.services.direct.id, dst.id, cr.pros.p1.id]);
  await c.end();
}

// 3. sessions signed with this run's secrets (never printed)
for (const [k, v] of Object.entries(SECRETS)) process.env[k] = v;
const { signAdminSessionToken, signJwt } = await import('../../api/_utils/auth.js');
const elev = () => ({ elev_until: Math.floor(Date.now() / 1000) + 3 * 3600, elev_kind: 'JIT', elev_id: crypto.randomUUID() });
const cred = JSON.parse(fs.readFileSync(creds, 'utf8'));
const tokens = {
  admin: signAdminSessionToken({ email: 'r47-admin-a@example.test', role: 'superadmin', mfa_verified: true, ...elev() }),
  admin2: signAdminSessionToken({ email: 'r47-admin-b@example.test', role: 'admin', mfa_verified: true }),
  adminNoElev: signAdminSessionToken({ email: 'r47-admin-c@example.test', role: 'admin', mfa_verified: true }),
  // a citizen session cookie that expired an hour ago (same secret, issuer and audience as a real one)
  expiredCitizen: signJwt({ scope: 'user', role: 'user', userId: cred.citizens.second.id, email: cred.citizens.second.email, iat_ms: Date.now() - 8 * 86400_000,
    iat: Math.floor(Date.now() / 1000) - 8 * 86400, exp: Math.floor(Date.now() / 1000) - 3600 }, process.env.AUTH_SECRET, { algorithm: 'HS256', issuer: 'accesdirectaide', audience: 'accesdirectaide-user' }),
};
fs.writeFileSync(path.join(tmp, 'tokens.json'), JSON.stringify(tokens), { mode: 0o600 });

// 4. servers
const servers = [];
function start(script, extra, label) {
  const p = spawn(process.execPath, ['--import', 'tsx', script], { cwd: ROOT, env: { ...BASE_ENV, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = fs.createWriteStream(path.join(process.env.R47_LOG_DIR || tmp, `${label}.log`));
  p.stdout.pipe(log); p.stderr.pipe(log);
  servers.push(p); return p;
}
const stopAll = () => { for (const s of servers) { try { s.kill('SIGTERM'); } catch { /* gone */ } } };
process.on('SIGINT', () => { stopAll(); process.exit(130); });
start('e2e-r47/journeys/mock-graph.mjs', { MOCK_GRAPH_PORT: String(PORT_GRAPH), MOCK_GRAPH_CLIENT_ID: GRAPH.id, MOCK_GRAPH_CLIENT_SECRET: GRAPH.secret }, 'mock-graph');
start('e2e-r47/journeys/serve.mjs', { R47_PORT: String(PORT), R47_DIST: DIST, APP_BASE_URL: `http://127.0.0.1:${PORT}`, APP_URL: `http://127.0.0.1:${PORT}` }, 'server');
start('e2e-r47/journeys/serve.mjs', { R47_PORT: String(PORT_ENF), R47_DIST: DIST, APP_BASE_URL: `http://127.0.0.1:${PORT_ENF}`, APP_URL: `http://127.0.0.1:${PORT_ENF}`, ADA_SENSITIVITY_REVIEW_ENFORCED: '1',
  OUTLOOK_REDIRECT_URI: `http://127.0.0.1:${PORT_ENF}/api/auth/callback/outlook` }, 'server-enforced');
for (const u of [`http://127.0.0.1:${PORT}/__lab/health`, `http://127.0.0.1:${PORT_ENF}/__lab/health`, `http://127.0.0.1:${PORT_GRAPH}/__calls`]) {
  let up = false;
  for (let i = 0; i < 120 && !up; i += 1) { up = await fetch(u).then((r) => r.ok, () => false); if (!up) await new Promise((r) => setTimeout(r, 500)); }
  if (!up) { stopAll(); throw new Error(`${u} did not start`); }
}
// the enrolment claimed the current TOTP step of each member (monotonic claim, replay guard): the browser's first codes need the next step
const wait = 31_000 - (Date.now() - enrolledAt); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
console.log(`up: app ${PORT}, enforced ${PORT_ENF}, mock Microsoft ${PORT_GRAPH}; schema ${SCHEMA}`);
const pw = spawnSync('npx', ['--no-install', 'playwright', 'test', '-c', 'e2e-r47/journeys/playwright.config.mjs', ...pwArgs], {
  cwd: ROOT, stdio: 'inherit',
  env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'fr_FR.UTF-8', TZ: 'UTC', R47_BASE: `http://127.0.0.1:${PORT}`, R47_BASE_ENF: `http://127.0.0.1:${PORT_ENF}`,
    R47_GRAPH: `http://127.0.0.1:${PORT_GRAPH}`, R47_CREDS: creds, R47_TOKENS: path.join(tmp, 'tokens.json'), R47_SCHEMA: SCHEMA, R47_DB: process.env.DATABASE_URL,
    ...(process.env.R47_REPORT ? { R47_REPORT: process.env.R47_REPORT } : {}), ...(process.env.R47_OUT ? { R47_OUT: process.env.R47_OUT } : {}) },
});
stopAll();
if (!process.env.R47_LOG_DIR) fs.rmSync(tmp, { recursive: true, force: true });
else { fs.rmSync(creds, { force: true }); fs.rmSync(path.join(tmp, 'tokens.json'), { force: true }); }
process.exit(pw.status ?? 1);
