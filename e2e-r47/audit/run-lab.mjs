#!/usr/bin/env node
/**
 * R47 / audit — LAB runner of e2e-r47/audit (A18 audience switch, Q04 security journey). Synthetic, loopback only, never :3000.
 *
 *   node e2e-r47/audit/run-lab.mjs [--keep-builds]
 *
 * 1 three builds of the working tree (vite build only, into dist-r47-off / -on / -onbeta: VITE_AUDIENCE_MEASUREMENT unset / on / on + VITE_PUBLIC_BETA=true);
 * 2 a disposable database at the Production shape 0042 (ada_r47_audit_journey_test on 127.0.0.1:55434: stock migrate of 0000..0041 then 0000..0042);
 * 3 for each build: scripts/lab-server.mjs on :5194 (shipped headers, real API, veille and network off) → the A18 spec with R47_A18_MODE;
 * 4 the off build again with ALERT_FAILED_LOGIN_BURST=3 and a signed LAB administrator session (written to a mode-600 file, never printed) → the Q04 spec;
 * 5 servers stopped, database dropped, builds removed (unless --keep-builds). Exit code = number of failed spec runs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 5194; const BASE = `http://127.0.0.1:${PORT}`;
const DB = 'ada_r47_audit_journey_test';
const url = (db) => `postgresql://ada_test@127.0.0.1:55434/${db}`;
const keepBuilds = process.argv.includes('--keep-builds');
const BASEENV = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'fr_FR.UTF-8', TZ: 'UTC' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'r47-audit-run-'));

async function withClient(db, fn) { const c = new pg.Client({ connectionString: url(db) }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
const admin = (sqls) => withClient('postgres', async (c) => { for (const s of sqls) await c.query(s); });

function build(name, extra) {
  const out = path.join(ROOT, `dist-r47-${name}`);
  const r = spawnSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], { cwd: ROOT, env: { ...BASEENV, ...extra }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`build ${name} failed`);
  return out;
}

async function database() {
  await admin([`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`, `CREATE DATABASE ${DB} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`, `ALTER DATABASE ${DB} SET timezone TO 'UTC'`]);
  await withClient(DB, async (c) => { for (const e of ['unaccent', 'pg_trgm', 'vector']) await c.query(`CREATE EXTENSION IF NOT EXISTS ${e}`); });
  const journal = JSON.parse(fs.readFileSync(path.join(ROOT, 'drizzle/meta/_journal.json'), 'utf8'));
  for (const max of [41, 42]) {
    const d = path.join(work, `m${max}`); fs.mkdirSync(path.join(d, 'meta'), { recursive: true });
    const entries = journal.entries.filter((e) => e.idx <= max);
    for (const e of entries) fs.copyFileSync(path.join(ROOT, 'drizzle', `${e.tag}.sql`), path.join(d, `${e.tag}.sql`));
    fs.writeFileSync(path.join(d, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    const pool = new pg.Pool({ connectionString: url(DB), max: 2 }); try { await migrate(drizzle(pool), { migrationsFolder: d }); } finally { await pool.end(); }
  }
}

async function serve(dist, secrets, extra = {}) {
  const log = fs.openSync(path.join(work, `server-${path.basename(dist)}.log`), 'w');
  const srv = spawn(process.execPath, ['--import', 'tsx', 'scripts/lab-server.mjs'], { cwd: ROOT, stdio: ['ignore', log, log],
    env: { ...BASEENV, NODE_ENV: 'development', VERCEL_ENV: '', ADA_PUBLIC_CONTENT_MODE: 'lab', LAB_PORT: String(PORT), LAB_DIST: dist, DATABASE_URL: url(DB), ...secrets,
      OLLAMA_BASE_URL: 'http://127.0.0.1:9', ADA_VEILLE: 'off', ADA_VERIFICATION_NETWORK: 'off', ...extra } });
  for (let i = 0; i < 90; i += 1) { try { if ((await fetch(`${BASE}/__lab/health`)).ok) return srv; } catch { /* starting */ } await sleep(1000); }
  srv.kill('SIGTERM'); throw new Error('LAB server did not start');
}
const stop = async (srv) => { srv.kill('SIGTERM'); await new Promise((r) => srv.once('exit', r)); await sleep(500); };
const spec = (file, env) => spawnSync('npx', ['--no-install', 'playwright', 'test', '-c', 'e2e-r47/audit/playwright.config.mjs', file], { cwd: ROOT, stdio: 'inherit', env: { ...BASEENV, R47_BASE: BASE, ...env } }).status;

async function main() {
  const builds = { off: build('off', {}), on: build('on', { VITE_AUDIENCE_MEASUREMENT: 'on' }), onbeta: build('onbeta', { VITE_AUDIENCE_MEASUREMENT: 'on', VITE_PUBLIC_BETA: 'true' }) };
  await database();
  const jwt = crypto.randomBytes(32).toString('hex');
  const secrets = { JWT_SECRET: jwt, AUTH_SECRET: jwt, ADA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'), CRON_SECRET: crypto.randomBytes(32).toString('hex'), ADMIN_TOKEN: crypto.randomBytes(32).toString('hex') };
  const results = {};
  for (const mode of ['off', 'on', 'onbeta']) {
    const srv = await serve(builds[mode], secrets);
    try { results[`a18-${mode}`] = spec('r47-a18-audience.pw.mjs', { R47_A18_MODE: mode }); } finally { await stop(srv); }
  }
  // Q04: an administrator session signed with the server's secret (LAB), handed to the spec through the environment of its process only
  const tokFile = path.join(work, 'admin.tok'); const secFile = path.join(work, 'server-secrets.env');
  fs.writeFileSync(secFile, Object.entries(secrets).map(([k, v]) => `${k}=${v}`).join('\n'), { mode: 0o600 });
  const mint = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    `import fs from 'node:fs'; const { signAdminSessionToken } = await import(${JSON.stringify(path.join(ROOT, 'api/_utils/auth.js'))}); fs.writeFileSync(${JSON.stringify(tokFile)}, signAdminSessionToken({ email: 'r47-audit-admin@example.test', role: 'admin', mfa_verified: true }), { mode: 0o600 });`],
  { cwd: ROOT, env: { ...BASEENV, NODE_ENV: 'development', DATABASE_URL: url(DB), ...secrets }, encoding: 'utf8' });
  if (mint.status !== 0 || !fs.existsSync(tokFile)) throw new Error('admin session not minted');
  const srv = await serve(builds.off, secrets, { ALERT_FAILED_LOGIN_BURST: '3' });
  try { results.q04 = spec('r47-q04-security.pw.mjs', { R47_ADMIN_TOKEN: fs.readFileSync(tokFile, 'utf8'), R47_DIST: builds.off, R47_SERVER_SECRETS: secFile }); } finally { await stop(srv); }
  await admin([`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`]);
  if (!keepBuilds) for (const d of Object.values(builds)) fs.rmSync(d, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`R47_AUDIT_JOURNEYS ${JSON.stringify(results)}`);
  process.exitCode = Object.values(results).filter((s) => s !== 0).length;
}

main().catch(async (e) => { console.error(`R47_AUDIT_JOURNEYS {"ok":false,"message":${JSON.stringify(String(e?.message || e).slice(0, 200))}}`); try { await admin([`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`]); } catch { /* best effort */ } fs.rmSync(work, { recursive: true, force: true }); process.exitCode = 99; });
