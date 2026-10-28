#!/usr/bin/env node
/**
 * Q11 — multi-instance safety, SIMULATED LOCALLY. Two instances of the production API entry (api/index.js through scripts/lab-server.mjs) on 127.0.0.1, ONE
 * disposable PostgreSQL database, ONE shared key-value store (scripts/q11-fake-upstash.mjs: the Upstash REST protocol subset the product uses) — the shape
 * of several serverless instances behind one hosting. It is a simulation: no Vercel, no Upstash, no network; nothing here verifies the real hosting.
 *
 *   DATABASE_URL=<a DISPOSABLE local database, already migrated> node --import tsx scripts/q11-multi-instance.mjs --out <new dir>
 *
 * Scenarios (each a PASS / FAIL line in <out>/q11-report.json and .md):
 *   S1 sessions: signed in on A, the session works on B; signed out on A, it is refused on B at once (server-side revocation in the database);
 *   S2 account lockout: wrong passwords spread over A and B lock the account after five (counted in the database), on both;
 *   S3 read-after-write: a favourite added on A is listed by B immediately;
 *   S4 shared rate limiting: failed sign-ins spread over A and B are limited at the configured total (8 per 15 min per address), not per instance;
 *   S5 MFA throttling: wrong MFA codes spread over A and B are limited at the configured total (5 per 15 min per address);
 *   S6 cron duplicate prevention: the 5-minute health check run by A and B at the same moment sends ONE alert (atomic cooldown); two veille runs started at the
 *      same moment by two processes: one runs, the other is refused (database lock);
 *   S7 concurrent publication: a verification racing a content change never records a verification of content that is not the one stored (409 or serialised);
 *   S8 cache invalidation: a record withdrawn in the database is 410 on BOTH instances at the next request (no per-instance page cache); a kill switch set
 *      in the database reaches an instance that had read the flags before within its documented bound (15 s per-instance cache);
 *   S9 store unavailable then back: sign-in still answers (non-production: per-instance fallback, stated as degraded); production fail-closed for sign-in and
 *      fail-open for public search (in a production-profile process); the health check reports the store down and still delivers its alert; after recovery the
 *      limits are shared again;
 *   S10 observability: every answer carries a request id, distinct, from both instances; each instance answers its own liveness probe.
 */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import pg from 'pg';
import { createFakeUpstash } from './q11-fake-upstash.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outArg = process.argv.indexOf('--out'); const OUT = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : null;
const die = (m) => { console.error(`q11: ${m}`); process.exit(2); };
if (!OUT) die('--out <new dir> is required');
if (fs.existsSync(OUT) && fs.readdirSync(OUT).length) die('--out must be a new or empty directory');
const DB_URL = process.env.DATABASE_URL || '';
let dbName = ''; try { const u = new URL(DB_URL); if (!['127.0.0.1', 'localhost', '::1'].includes(u.hostname)) die('the database must be local'); dbName = u.pathname.slice(1); } catch { die('DATABASE_URL missing'); }
if (!/(q11|rehearsal|_test$|disposable)/.test(dbName) || /lab_local/.test(dbName)) die(`refusing database « ${dbName} »: a DISPOSABLE database is required (name with q11 / rehearsal / disposable / _test)`);
fs.mkdirSync(OUT, { recursive: true });

const results = []; const t0 = Date.now();
const check = (id, name, ok, detail) => { results.push({ id, name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name}${ok ? '' : ` — ${JSON.stringify(detail).slice(0, 400)}`}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------------------------- the shared store (simulation)
const certDir = path.join(OUT, 'tls'); fs.mkdirSync(certDir, { recursive: true, mode: 0o700 });
const keyFile = path.join(certDir, 'key.pem'); const certFile = path.join(certDir, 'cert.pem');
const ssl = spawnSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { encoding: 'utf8' });
if (ssl.status !== 0) die(`openssl: ${ssl.stderr}`);
const KV_TOKEN = crypto.randomBytes(16).toString('hex');
const store = createFakeUpstash({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile), token: KV_TOKEN });
await new Promise((r) => store.server.listen(0, '127.0.0.1', r));
const KV_URL = `https://127.0.0.1:${store.server.address().port}`;

// the alert channel: a local receiver
const alerts = [];
const hook = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { try { alerts.push(JSON.parse(b)); } catch { alerts.push({ raw: b }); } res.end('ok'); }); });
await new Promise((r) => hook.listen(0, '127.0.0.1', r));

// ---------------------------------------------------------------------------------------------------------------- the database (disposable)
const pool = new pg.Pool({ connectionString: DB_URL, max: 4 });
const q = (text, values) => pool.query(text, values);
const { hashPassword } = await import('../api/_utils/password-hash.js');
const N = String(Date.now()).slice(-7); const PASSWORD = `Q11-${crypto.randomBytes(6).toString('hex')}-pass`;
const hash = await hashPassword(PASSWORD);
const users = {}; for (const k of ['session', 'lockout', 'favorite']) {
  users[k] = { id: `q11-${k}-${N}`, email: `q11-${k}-${N}@example.test` };
  await q(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES ($1, $2, $3, NOW(), NOW())`, [users[k].id, users[k].email, hash]);
}
const REC = { id: `q11-st-${N}`, slug: `q11-lieu-${N}` };
await q(`INSERT INTO "Structure" (id, nom, slug, adresse, code_postal, ville, services, publics_accueillis, categories_aidees, statut, verification_status, verified_by, date_verification, territory_verified,
  launch_eligible, data_origin, source_url, published_at, description_courte, "updatedAt", "createdAt") VALUES ($1, $2, $3, '1 rue de la Paix', '67000', 'Strasbourg', ARRAY[]::text[], ARRAY[]::text[], ARRAY['Accès aux droits'],
  'actif', 'VERIFIED', 'ada-veille-automatique', NOW(), true, true, 'official', 'https://annuaire-entreprises.data.gouv.fr/etablissement/1', NOW(), 'Un lieu de la simulation Q11.', NOW(), NOW())`, [REC.id, `Lieu Q11 ${N}`, REC.slug]);

// ---------------------------------------------------------------------------------------------------------------- the two instances
const dist = path.join(OUT, 'dist'); fs.mkdirSync(dist, { recursive: true }); fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(dist, 'index.html'));
const KV_ALIASES = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_KV_KV_REST_API_URL', 'UPSTASH_KV_KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'UPSTASH_KV_REST_API_URL', 'UPSTASH_KV_REST_API_TOKEN', 'KV_URL', 'KV_REST_API_READ_ONLY_TOKEN'];
const baseEnv = () => { const e = { ...process.env }; for (const k of KV_ALIASES) delete e[k]; return { ...e, KV_REST_API_URL: KV_URL, KV_REST_API_TOKEN: KV_TOKEN, NODE_EXTRA_CA_CERTS: certFile, ADA_VEILLE: 'off', LAB_QA_PRIORITY: 'off',
  LAB_DIST: dist, ALERT_WEBHOOK_URL: `http://127.0.0.1:${hook.address().port}/hook`, ALERT_VEILLE_STALE_HOURS: '0', LAB_STOP_GRACE_MS: '2000' }; };
const freePort = () => new Promise((r) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const instances = {};
for (const name of ['A', 'B']) {
  const port = await freePort(); const log = fs.openSync(path.join(OUT, `instance-${name}.log`), 'w');
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'scripts', 'lab-server.mjs')], { cwd: ROOT, env: { ...baseEnv(), LAB_PORT: String(port) }, stdio: ['ignore', log, log] });
  instances[name] = { name, port, child, base: `http://127.0.0.1:${port}` };
}
const stopAll = async () => { for (const i of Object.values(instances)) { try { i.child.kill('SIGTERM'); } catch { /* gone */ } } await sleep(500); };
process.on('exit', () => { for (const i of Object.values(instances)) { try { i.child.kill('SIGKILL'); } catch { /* gone */ } } });
for (const i of Object.values(instances)) {
  const until = Date.now() + 60000; let up = false;
  while (Date.now() < until && !up) { try { up = (await fetch(`${i.base}/__lab/health`)).ok; } catch { await sleep(300); } }
  if (!up) { await stopAll(); die(`instance ${i.name} did not start (see instance-${i.name}.log)`); }
}
const A = instances.A; const B = instances.B;
const ORIGIN = 'http://127.0.0.1:3000'; const CSRF = crypto.randomBytes(12).toString('hex');
const call = async (inst, method, p, { body, cookie = '', headers = {} } = {}) => {
  const started = Date.now();
  const r = await fetch(`${inst.base}${p}`, { method, redirect: 'manual', headers: { Origin: ORIGIN, 'content-type': 'application/json', cookie: [`__csrf=${CSRF}`, cookie].filter(Boolean).join('; '), 'x-csrf-token': CSRF, ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: r.status, json, text, headers: Object.fromEntries(r.headers), ms: Date.now() - started, setCookie: r.headers.getSetCookie?.() || [] };
};
const sessionOf = (r) => (r.setCookie.find((c) => !c.startsWith('__csrf=')) || '').split(';')[0];

try {
  // S1 — sessions across instances
  const login = await call(A, 'POST', '/api/auth/login', { body: { email: users.session.email, password: PASSWORD } });
  const cookie = sessionOf(login);
  const meB = await call(B, 'GET', '/api/auth/me', { cookie });
  const out = await call(A, 'POST', '/api/auth/logout', { cookie });
  await sleep(5);
  const meB2 = await call(B, 'GET', '/api/auth/me', { cookie });
  check('S1', 'session opened on A works on B; signed out on A, refused on B at once', login.status === 200 && Boolean(cookie) && meB.status === 200 && [200, 204].includes(out.status) && meB2.status === 401,
    { login: login.status, meB: meB.status, logout: out.status, meAfter: meB2.status });

  // S2 — account lockout counted in the database, whichever instance
  store.data.clear();
  const tries = [];
  for (let i = 0; i < 5; i += 1) tries.push((await call(i % 2 ? B : A, 'POST', '/api/auth/login', { body: { email: users.lockout.email, password: 'wrong-password-q11' } })).status);
  const right = await call(B, 'POST', '/api/auth/login', { body: { email: users.lockout.email, password: PASSWORD } });
  const locked = (await q(`SELECT "lockoutUntil" > NOW() AS l, "failedLoginAttempts" AS n FROM "CitizenUser" WHERE id = $1`, [users.lockout.id])).rows[0];
  check('S2', 'five wrong passwords over A and B lock the account (database), the right one is refused on B', tries.every((s) => s === 401) && right.status === 401 && locked.l === true, { tries, right: right.status, locked });

  // S3 — read-after-write across instances
  store.data.clear();
  const l3 = await call(A, 'POST', '/api/auth/login', { body: { email: users.favorite.email, password: PASSWORD } });
  const c3 = sessionOf(l3);
  const add = await call(A, 'POST', '/api/citizen/favorites', { cookie: c3, body: { entityType: 'structure', entityId: REC.id } });
  const list = await call(B, 'GET', '/api/citizen/favorites', { cookie: c3 });
  const listed = JSON.stringify(list.json || {}).includes(REC.id);
  check('S3', 'a favourite added on A is listed by B immediately', l3.status === 200 && [200, 201].includes(add.status) && list.status === 200 && listed, { login: l3.status, add: add.status, list: list.status, listed });

  // S4 — shared rate limiting of failed sign-ins (LOGIN_USER: 8 / 15 min per address)
  store.data.clear();
  const s4 = [];
  for (let i = 0; i < 12; i += 1) s4.push((await call(i % 2 ? B : A, 'POST', '/api/auth/login', { body: { email: `q11-nobody-${N}-${i}@example.test`, password: 'x-q11-wrong' } })).status);
  const firstLimited = s4.indexOf(429);
  check('S4', 'failed sign-ins over A and B are limited at the total (8 per address), not per instance', firstLimited === 8 && s4.slice(8).every((s) => s === 429), { statuses: s4, firstLimitedAt: firstLimited + 1 });

  // S5 — MFA throttling (MFA_VERIFY_PRO: 5 / 15 min per address)
  store.data.clear();
  const s5 = [];
  for (let i = 0; i < 8; i += 1) s5.push((await call(i % 2 ? B : A, 'POST', '/api/pro/auth/mfa-verify', { body: { mfa_token: `q11-bogus-${i}`, code: '123456' } })).status);
  const mfaLimited = s5.indexOf(429);
  check('S5', 'wrong MFA codes over A and B are limited at the total (5 per address)', mfaLimited === 5 && s5.slice(5).every((s) => s === 429) && s5.slice(0, 5).every((s) => s !== 429), { statuses: s5, firstLimitedAt: mfaLimited + 1 });

  // S6 — cron: the health check at the same moment on A and B sends ONE alert; two veille runs at once: one runs
  store.data.clear(); alerts.length = 0;
  const auth = { authorization: `Bearer ${process.env.CRON_SECRET}` };
  const [h1, h2] = await Promise.all([call(A, 'GET', '/api/cron/health-alert', { headers: auth }), call(B, 'GET', '/api/cron/health-alert', { headers: auth })]);
  await sleep(300);
  const stale = alerts.filter((x) => x.name === 'veille.stale');
  check('S6a', 'the health check run by A and B at the same moment delivers ONE alert (atomic cooldown in the shared store)', stale.length === 1 && h1.json?.checks?.kv?.ok === true && h2.json?.checks?.kv?.ok === true,
    { delivered: stale.length, kvA: h1.json?.checks?.kv, kvB: h2.json?.checks?.kv });
  // S7 — a verification racing a content change (two processes, the record's row lock and its content version)
  const raceScript = path.join(OUT, 'q11-race.mjs');
  fs.writeFileSync(raceScript, `const role = process.argv[2]; const id = process.argv[3];
const cv = await import(${JSON.stringify(path.join(ROOT, 'api/_services/content-verification.js'))});
const { db } = await import(${JSON.stringify(path.join(ROOT, 'src/db/index.js'))});
const { createRequire } = await import('node:module'); const { pathToFileURL } = await import('node:url');
const { sql } = await import(pathToFileURL(createRequire(${JSON.stringify(path.join(ROOT, 'package.json'))}).resolve('drizzle-orm')).href);
const before = cv.contentVersion(await cv.rowJson(db, 'structure', id));
await new Promise((x) => setTimeout(x, Number(process.argv[4]) - Date.now()));
let r;
if (role === 'edit') { await db.execute(sql\`UPDATE "Structure" SET description_courte = 'Texte changé pendant la vérification (Q11).' WHERE id = \${id}\`); r = { edited: true }; }
else r = await cv.recordVerification({ entityType: 'structure', entityId: id, action: 'VERIFY', reviewer: { id: 'q11-reviewer', role: 'admin' }, sourceUrl: 'https://annuaire-entreprises.data.gouv.fr/etablissement/1', evidenceNote: 'Simulation Q11 : vérification concurrente.', territoryConfirmed: true, expectedVersion: before });
console.log('Q11 ' + JSON.stringify({ role, ok: r.ok ?? true, code: r.code || null, status: r.status || null })); process.exit(0);\n`);
  const raceOnce = (role, at) => new Promise((resolve) => { const c = spawn(process.execPath, ['--import', 'tsx', raceScript, role, REC.id, String(at)], { cwd: ROOT, env: baseEnv() }); let o = ''; c.stdout.on('data', (d) => { o += d; }); c.on('close', () => { const m = o.match(/^Q11 (.*)$/m); resolve(m ? JSON.parse(m[1]) : { error: o.slice(-300) }); }); });
  const at = Date.now() + 6000;
  const [rv, re] = await Promise.all([raceOnce('verify', at), raceOnce('edit', at)]);
  const { contentVersion, rowJson } = await import('../api/_services/content-verification.js');
  const { db: appDb } = await import('../src/db/index.js');
  const now = contentVersion(await rowJson(appDb, 'structure', REC.id));
  const last = (await q(`SELECT "contentVersion" AS v, "createdAt" FROM "ContentVerification" WHERE "entityId" = $1 ORDER BY "createdAt" DESC LIMIT 1`, [REC.id])).rows[0];
  // the verification either ran before the edit (its version is the old content's) or was refused as stale (409): never a verification stamped on content it did not see
  const consistent = rv.ok ? last && last.v !== now : rv.code === 'STALE_REVIEW';
  check('S7', 'a verification racing a content change is either serialised before it or refused as stale (409): no verification of unseen content', re.role === 'edit' && re.ok === true && consistent, { verify: rv, edit: re, lastVersionIsCurrent: last ? last.v === now : null });

  // S8 — cache invalidation: the page of a withdrawn record is 410 on both instances at once; a kill switch reaches the other instance within 15 s
  const p1 = [(await call(A, 'GET', `/structures/${REC.slug}`)).status, (await call(B, 'GET', `/structures/${REC.slug}`)).status];
  await q(`UPDATE "Structure" SET publication_hold = 'Veille automatique : simulation Q11' WHERE id = $1`, [REC.id]);
  const p2 = [(await call(A, 'GET', `/structures/${REC.slug}`)).status, (await call(B, 'GET', `/structures/${REC.slug}`)).status];
  check('S8a', 'a record withdrawn in the database is 410 on BOTH instances at the next request (no per-instance page cache)', p1.every((s) => s === 200) && p2.every((s) => s === 410), { before: p1, after: p2 });
  const fb = (inst) => call(inst, 'POST', '/api/support', { body: {} });   // SUPPORT_FORM: 503 FEATURE_DISABLED once the kill switch is seen, else the form's own answer
  const fb0 = await fb(B);
  await q(`INSERT INTO "FeatureFlagOverride" (key, "forcedOff", reason, "setBy", "setAt") VALUES ('SUPPORT_FORM', true, 'Simulation Q11 (kill switch)', 'q11', NOW()) ON CONFLICT (key) DO UPDATE SET "forcedOff" = true`).catch((e) => ({ error: e.message }));
  const t8 = Date.now(); let fbAfter = fb0.status; let waited = 0;
  while (Date.now() - t8 < 20000) { fbAfter = (await fb(B)).status; if (fbAfter === 503) break; await sleep(1000); }   // before: the form's answer (400, then 429 once its own limit is reached)
  waited = Date.now() - t8;
  await q(`DELETE FROM "FeatureFlagOverride" WHERE key = 'SUPPORT_FORM' AND "setBy" = 'q11'`).catch(() => {});
  check('S8b', 'a kill switch reaches the other instance within its documented bound (15 s per-instance cache)', fb0.status !== 503 && fbAfter === 503 && waited <= 16500, { before: fb0.status, after: fbAfter, waitedMs: waited });

  // S6b (after S7 / S8: the veille's own self-check withdraws the simulation's record, which has no verification ledger)
  const veilleScript = path.join(OUT, 'q11-veille-once.mjs');
  fs.writeFileSync(veilleScript, `const { runVeille } = await import(${JSON.stringify(path.join(ROOT, 'api/_services/verification/chain.js'))});
const { db } = await import(${JSON.stringify(path.join(ROOT, 'src/db/index.js'))});
const r = await runVeille({ db, trigger: 'q11', texts: false, ignorePause: true, only: ['audit'], fetchImpl: async () => { await new Promise((x) => setTimeout(x, 50)); throw new TypeError('q11 offline'); }, maxMinutes: 2 });
console.log('Q11 ' + JSON.stringify({ ok: r.ok, status: r.status || null, skipped: r.skipped || null, runId: r.runId || null })); process.exit(0);\n`);
  const runOnce = () => new Promise((resolve) => { const c = spawn(process.execPath, ['--import', 'tsx', veilleScript], { cwd: ROOT, env: baseEnv() }); let o = ''; c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', () => {}); c.on('close', () => { const m = o.match(/^Q11 (.*)$/m); resolve(m ? JSON.parse(m[1]) : { error: o.slice(-300) }); }); });
  await q(`UPDATE "CronRun" SET status = 'interrupted' WHERE job = 'veille' AND status = 'running'`);
  const [v1, v2] = await Promise.all([runOnce(), runOnce()]);
  const ran = [v1, v2].filter((v) => v.runId && !v.skipped).length; const refused = [v1, v2].filter((v) => v.skipped === 'ALREADY_RUNNING').length;
  check('S6b', 'two veille runs started at the same moment by two processes: one runs, the other is refused (database lock)', ran === 1 && refused === 1, { v1, v2 });

  // S9 — the store down, then back
  store.data.clear(); store.setDown(true); alerts.length = 0;
  const d1 = await call(A, 'POST', '/api/auth/login', { body: { email: `q11-down-${N}@example.test`, password: 'x' } });
  const hDown = await call(A, 'GET', '/api/cron/health-alert', { headers: auth });
  await sleep(300);
  const kvAlert = alerts.filter((x) => x.name === 'kv.down').length;
  const prodScript = path.join(OUT, 'q11-prod-failclosed.mjs');
  fs.writeFileSync(prodScript, `const rl = await import(${JSON.stringify(path.join(ROOT, 'api/_utils/rateLimit.js'))});
const a = await rl.checkRateLimit('LOGIN_PRO', 'ip:q11'); const b = await rl.checkRateLimit('SEARCH_AIDES', 'ip:q11');
console.log('Q11 ' + JSON.stringify({ login: { allowed: a.allowed, status: a.status || null }, search: { allowed: b.allowed } })); process.exit(0);\n`);
  const prod = await new Promise((resolve) => { const c = spawn(process.execPath, ['--import', 'tsx', prodScript], { cwd: ROOT, env: { ...baseEnv(), VERCEL_ENV: 'production' } }); let o = ''; c.stdout.on('data', (d) => { o += d; }); c.on('close', () => { const m = o.match(/^Q11 (.*)$/m); resolve(m ? JSON.parse(m[1]) : { error: o.slice(-300) }); }); });
  check('S9a', 'store down (non-production): sign-in still answers promptly (per-instance fallback, or the limiter\'s own cache of an address it already blocked: degraded, stated)', [401, 429].includes(d1.status) && d1.ms < 15000, { status: d1.status, ms: d1.ms });
  check('S9b', 'store down: the health check reports it and still delivers its alert (bounded, KV-independent delivery)', hDown.json?.checks?.kv?.ok === false && kvAlert === 1 && hDown.ms < 30000, { kv: hDown.json?.checks?.kv, delivered: kvAlert, ms: hDown.ms });
  check('S9c', 'store down in a production-profile process: sign-in fails CLOSED (503), public search fails open', prod.login?.allowed === false && prod.login?.status === 503 && prod.search?.allowed === true, prod);
  // back: the store keeps its data (an outage is not a flush); an action this address has not used yet (professional sign-in, 5 per 15 min) is shared again
  store.setDown(false);
  const s9 = [];
  for (let i = 0; i < 8; i += 1) s9.push((await call(i % 2 ? B : A, 'POST', '/api/pro/auth/login', { body: { email: `q11-back-${N}-${i}@example.test`, password: 'x-q11-wrong' } })).status);
  check('S9d', 'store back: the limits are shared again (the 6th failed professional sign-in over A and B is limited)', s9.indexOf(429) === 5 && s9.slice(5).every((x) => x === 429), { statuses: s9 });

  // S10 — observability
  const ids = [];
  for (const inst of [A, B, A, B]) ids.push((await call(inst, 'GET', '/api/health/live')).headers['x-request-id']);
  const live = [(await fetch(`${A.base}/__lab/health`)).ok, (await fetch(`${B.base}/__lab/health`)).ok];
  check('S10', 'every answer carries a distinct request id from both instances; each instance answers its own liveness probe', ids.every(Boolean) && new Set(ids).size === ids.length && live.every(Boolean), { ids, live });
} catch (e) {
  check('RUN', 'the simulation ran to the end without an exception', false, String(e?.stack || e).slice(0, 600));
} finally {
  await stopAll();
  await q(`DELETE FROM "ContentVerification" WHERE "entityId" = $1`, [REC.id]).catch(() => {});
  await q(`DELETE FROM "EntityVersion" WHERE entity_id = $1`, [REC.id]).catch(() => {});
  await q(`DELETE FROM "CitizenFavorite" WHERE "userId" = ANY($1)`, [Object.values(users).map((u) => u.id)]).catch(() => {});
  await q(`DELETE FROM "Structure" WHERE id = $1`, [REC.id]).catch(() => {});
  await q(`DELETE FROM "CitizenUser" WHERE id = ANY($1)`, [Object.values(users).map((u) => u.id)]).catch(() => {});
  await pool.end(); store.server.close(); hook.close();
  fs.rmSync(certDir, { recursive: true, force: true });   // the run's throwaway TLS key is not evidence
}
const report = { label: 'SIMULATION LOCALE — deux instances locales, une base PostgreSQL jetable, un magasin clé-valeur local compatible avec le protocole REST d’Upstash ; ce n’est NI Vercel NI Upstash : aucune vérification de l’hébergement réel.',
  generatedAt: new Date().toISOString(), durationMs: Date.now() - t0, database: dbName, instances: 2, store: { protocol: 'Upstash REST (sous-ensemble)', commands: store.stats.commands, byCommand: store.stats.byCommand },
  passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
fs.writeFileSync(path.join(OUT, 'q11-report.json'), JSON.stringify(report, null, 1) + '\n');
fs.writeFileSync(path.join(OUT, 'q11-report.md'), [`# Q11 — sécurité multi-instance (SIMULATION LOCALE)`, '', `> ${report.label}`, '', `${report.passed} réussis, ${report.failed} échoués — ${Math.round(report.durationMs / 1000)} s.`, '',
  '| | Scénario | Résultat |', '|---|---|---|', ...results.map((r) => `| ${r.id} | ${r.name} | ${r.ok ? 'PASS' : 'FAIL'} |`), ''].join('\n'));
console.log(`Q11 SIMULATION: ${report.passed} PASS, ${report.failed} FAIL → ${path.join(OUT, 'q11-report.md')}`);
process.exit(report.failed ? 1 : 0);
