// PKG-5 — the owner's LOCAL LAB (own machine only, never deployed, never a real reviewer by itself).
//   node --import tsx scripts/lab-local.mjs init           create ~/.ada-lab/lab.env (random LOCAL secrets, mode 600), the local database, migrations, the 49 WS2 records as drafts
//   node --import tsx scripts/lab-local.mjs geo            load the official territory reference (INSEE COG 2026 + EPCI, committed in data/geography; no network,
//                                                         idempotent, never deletes) — without it no commune is recognised (assistant, territory search); « init » runs it
//   node --import tsx scripts/lab-local.mjs build          production build of the site into ~/.ada-lab/dist (next to the configuration: never inside the source tree)
//   node --import tsx scripts/lab-local.mjs admin-create   create a NAMED administrator (asks email, holder's name, role, « one person, one account », password; MFA at first sign-in)
//   node --import tsx scripts/lab-local.mjs admin-reset-mfa --email <e-mail>   lost authenticator: next sign-in enrols a new one; every session ends (audited)
//   node --import tsx scripts/lab-local.mjs admin-reset-password --email <e-mail>   forgotten password: asks a new one (not shown); every session ends; MFA unchanged (audited)
//   node --import tsx scripts/lab-local.mjs start          serve http://127.0.0.1:3000 (the API accepts only this local origin and :5173) (Ctrl+C stops)
//   node --import tsx scripts/lab-local.mjs status         what is ready (no secret, no e-mail address printed)
//   node --import tsx scripts/lab-local.mjs veille         run the automatic verification now (the LAB server also runs it every night at 03:17, and when the Mac wakes up);
//                                                         « --only finess,structure » runs only those steps, « --max-minutes N » bounds it
//   node --import tsx scripts/lab-local.mjs veille status  where the veille stands (last runs, pause, next run, alerts, sources) — reads only
//   node --import tsx scripts/lab-local.mjs veille pause   emergency stop: the run in progress stops at the next record, no new run starts until « veille resume »
//   node --import tsx scripts/lab-local.mjs veille resume  end of the pause
//   node --import tsx scripts/lab-local.mjs veille audit   the self-check of everything public (D-5 v2 contract) — reads only
//   node --import tsx scripts/lab-local.mjs autostart enable    start the LAB server at every login (user LaunchAgent fr.accesdirectaide.lab; 127.0.0.1 only);
//                                                               « autostart disable » stops it and removes it; « autostart status »
//   node --import tsx scripts/lab-local.mjs server status       the server (automatic startup, supervisor, crashes) and the next veille — reads only
//   node --import tsx scripts/lab-local.mjs server stop | start | restart   temporary stop (until « server start » or the next restart of the Mac) / start again /
//                                                               restart (after a « build »)
//   node --import tsx scripts/lab-local.mjs server qa-handover  before a native QA campaign: the server leaves port 3000 and comes back by itself after the campaign
//                                                               (it also steps aside by itself as soon as a campaign starts)
// Options: --env <file> (default ~/.ada-lab/lab.env), --db <name> (default ada_lab_local), --pg <postgresql://...> (default the current user on 127.0.0.1:5432).
// Nothing here bypasses MFA. The automatic verification (owner decision 2026-10-25: « veille », and the LAB server every night) reads official PUBLIC sources only
// (Service-Public, Annuaire de l'administration, SIRENE, the sites of public bodies; no personal data is sent) and publishes, updates or withdraws the records it can
// check, with the evidence, as the reviewer « ada-veille-automatique »; ADA_VERIFICATION_NETWORK=off disables it. Secrets are generated locally and never printed.
// The recovery commands need this machine, the local configuration and the local database: they are the LAB's account recovery (no e-mail provider is configured).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const ENV_FILE = path.resolve(arg('env', path.join(os.homedir(), '.ada-lab', 'lab.env')));
const DB = arg('db', 'ada_lab_local');
// the LAB build lives with the configuration, outside the source tree (so it is never packaged, linted or tested as source); only a directory « build » marked is ever emptied
const DIST = path.join(path.dirname(ENV_FILE), 'dist');
const BUILD_MARK = '.ada-lab-build';
const RUN_DIR = path.join(path.dirname(ENV_FILE), 'run');
// Homebrew's stable link to node 22 (it survives patch upgrades): the LaunchAgent names it rather than the versioned Cellar path
const NODE_STABLE = '/opt/homebrew/opt/node@22/bin/node';
const say = (m) => process.stdout.write(m + '\n');
const die = (m) => { process.stderr.write('ERREUR : ' + m + '\n'); process.exit(1); };

function readEnv() {
  if (!fs.existsSync(ENV_FILE)) die(`configuration absente (${ENV_FILE}) : lancez d’abord « init ».`);
  const out = {};
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) out[m[1]] = m[2]; }
  return out;
}
function localUrl(url) { const h = new URL(url).hostname; if (!['127.0.0.1', 'localhost', '::1'].includes(h)) die('la base doit être locale (127.0.0.1).'); return url; }
const withDb = (base, db) => { const u = new URL(base); u.pathname = '/' + db; return u.toString(); };
const hex = (n) => crypto.randomBytes(n).toString('hex');

async function init() {
  const base = localUrl(arg('pg', `postgresql://${encodeURIComponent(os.userInfo().username)}@127.0.0.1:5432/postgres`));
  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(ENV_FILE)) {
    const env = { NODE_ENV: 'development', VERCEL_ENV: 'development', ADA_PUBLIC_CONTENT_MODE: 'lab', LAB_PORT: '3000', DATABASE_URL: withDb(base, DB),
      JWT_SECRET: hex(32), AUTH_SECRET: hex(32), ADA_ENCRYPTION_KEY: hex(32), OUTLOOK_TOKEN_ENCRYPTION_KEY: hex(32), CRON_SECRET: hex(24),
      ADA_LOCAL_STORAGE_DIR: path.join(path.dirname(ENV_FILE), 'storage'),
      // official sites of the local public authorities used by the launch records (Collectivité européenne d’Alsace, Ville et Eurométropole de Strasbourg, Ministère de la Justice)
      ADA_VERIFICATION_EXTRA_DOMAINS: 'alsace.eu,strasbourg.eu,justice.fr' };
    fs.writeFileSync(ENV_FILE, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
    fs.mkdirSync(env.ADA_LOCAL_STORAGE_DIR, { recursive: true, mode: 0o700 });
    say(`Configuration locale créée : ${ENV_FILE} (secrets locaux aléatoires, lisibles par vous seul ; ce ne sont PAS les secrets de production).`);
  } else say(`Configuration locale existante conservée : ${ENV_FILE}`);
  const env = readEnv(); localUrl(env.DATABASE_URL);
  const admin = new pg.Client({ connectionString: base }); await admin.connect();
  const dbName = new URL(env.DATABASE_URL).pathname.slice(1);
  if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])).rowCount) { await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`); say(`Base locale créée : ${dbName}`); }
  // the application stores UTC wall-clock times in « timestamp without time zone » columns (drizzle writes Date as UTC); a server in Europe/Paris made every raw NOW()
  // (session revocation, recovery commands) one or two hours « in the future » and refused new sessions: this database always runs in UTC, as in production
  await admin.query(`ALTER DATABASE "${dbName.replace(/"/g, '')}" SET timezone TO 'UTC'`);
  await admin.end();
  const c = new pg.Client({ connectionString: env.DATABASE_URL }); await c.connect();
  for (const e of ['unaccent', 'pg_trgm', 'vector']) await c.query(`CREATE EXTENSION IF NOT EXISTS ${e}`);
  await c.end();
  const { drizzle } = await import('drizzle-orm/node-postgres'); const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL }); await migrate(drizzle(pool), { migrationsFolder: path.join(ROOT, 'drizzle') }); await pool.end();
  say('Migrations appliquées.');
  const { runWs2ReviewSeed } = await import('./seed-strasbourg.mjs');
  const r = await runWs2ReviewSeed({ databaseUrl: env.DATABASE_URL });
  say(`Fiches du lancement chargées en brouillon (non publiées, non vérifiées) : ${r.counts.inserted} ajoutées, ${r.counts.keptExisting} déjà présentes et laissées telles quelles.`);
  geo(env);
  say('Étapes suivantes : « build », puis « admin-create », puis « start ».');
}

/**
 * R13: the territory reference (régions, départements, communes, arrondissements, EPCI) as scripts/geo-load.mjs loads it. Before R13 « init » never loaded it: the
 * owner LAB had 0 territories, so the assistant recognised no commune (« Strasbourg » → territory_not_resolved) and the territory search filter matched nothing.
 * @param {Record<string, string>} [env]
 */
function geo(env = readEnv()) {
  localUrl(env.DATABASE_URL);
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'scripts', 'geo-load.mjs')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: env.DATABASE_URL } });
  const line = String(r.stdout || '').split('\n').find((l) => l.startsWith('GEO_LOAD_RESULT '));
  const out = line ? JSON.parse(line.slice('GEO_LOAD_RESULT '.length)) : null;
  if (r.status !== 0 || !out?.ok) die('le référentiel territorial n’a pas pu être chargé (rien n’a été supprimé).');
  const created = (out.cog?.stats?.created || 0) + (out.epci?.stats?.created || 0);
  say(`Référentiel territorial officiel (INSEE ${out.expected ? `${out.expected.communes} communes, ${out.expected.epcis} EPCI` : ''}) : ${created ? `${created} entrées ajoutées` : 'déjà complet, rien ajouté'}.`);
}

function build() {
  if (fs.existsSync(DIST) && fs.readdirSync(DIST).length && !fs.existsSync(path.join(DIST, BUILD_MARK))) die(`${DIST} existe et n’a pas été créé par « build » : rien n’est effacé.`);
  const r = spawnSync('npx', ['--no-install', 'vite', 'build', '--outDir', DIST, '--emptyOutDir'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
  if (r.status !== 0) die('la construction du site a échoué.');
  fs.writeFileSync(path.join(DIST, BUILD_MARK), new Date().toISOString() + '\n');
  say(`Site construit dans ${DIST}.`);
}

function ask(rl, q, hidden = false) {
  return new Promise((resolve) => {
    if (!hidden || !process.stdin.isTTY) { rl.question(q, resolve); return; }
    const out = rl.output; const write = out.write.bind(out); let muted = false;
    out.write = (s) => (muted ? (s.includes('\n') ? write('\n') : true) : write(s));
    rl.question(q, (v) => { out.write = write; resolve(v); }); muted = true;
  });
}

async function adminCreate() {
  const env = readEnv(); localUrl(env.DATABASE_URL);
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  // non-interactive use (stdin piped): the lines are read up front (readline would drop lines that arrive before a question is asked)
  const piped = process.stdin.isTTY ? null : (await new Promise((r) => { let d = ''; process.stdin.on('data', (c) => { d += c; }); process.stdin.on('end', () => r(d.split('\n'))); }));
  const rl = piped ? { question: (q, cb) => cb((piped.shift() ?? '').replace(/\r$/, '')), close: () => {}, output: process.stdout } : readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const email = String(arg('email', '') || await ask(rl, 'Adresse e-mail de l’administrateur (nominative) : ')).trim().toLowerCase();
  // owner LAB audit: a NAMED account — the person who holds it, and the attestation « one person, one account » (a two-person rule between two accounts of
  // the same person would be void; no software can detect it, so it is attested and journalised here)
  const name = String(arg('name', '') || await ask(rl, 'Nom et prénom de la personne titulaire du compte : ')).trim().replace(/\s+/g, ' ');
  const role = String(arg('role', '') || (await ask(rl, 'Rôle [admin / superadmin] (admin — superadmin seulement si nécessaire) : ')) || 'admin').trim().toLowerCase();
  const attest = process.argv.includes('--attest-one-account') ? 'oui'
    : String(await ask(rl, 'Cette personne n’a-t-elle aucun autre compte administrateur (une personne = un compte) ? [oui/non] : ')).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { rl.close(); die('adresse invalide.'); }
  if (name.length < 3) { rl.close(); die('indiquez le nom et le prénom de la personne titulaire.'); }
  if (!['admin', 'superadmin'].includes(role)) { rl.close(); die('rôle invalide.'); }
  if (attest !== 'oui') { rl.close(); die('un compte administrateur est personnel : une personne qui a déjà un compte ne peut pas en recevoir un second.'); }
  const p1 = await ask(rl, 'Mot de passe (12 caractères minimum, non affiché) : ', true);
  const p2 = await ask(rl, 'Répétez le mot de passe : ', true);
  rl.close();
  if (p1 !== p2) die('les deux saisies diffèrent.');
  if (p1.length < 12) die('mot de passe trop court (12 caractères minimum).');
  const { hashPassword } = await import('../api/_utils/user-auth.js');
  const c = new pg.Client({ connectionString: env.DATABASE_URL }); await c.connect();
  try {
    if ((await c.query('SELECT 1 FROM "AdminUser" WHERE email = $1', [email])).rowCount) die('ce compte existe déjà.');
    if ((await c.query('SELECT 1 FROM "AdminUser" WHERE lower("displayName") = lower($1)', [name])).rowCount) die('cette personne a déjà un compte administrateur (une personne = un compte).');
    const id = crypto.randomUUID();
    await c.query(`INSERT INTO "AdminUser" (id, email, password, role, "createdAt", "updatedAt", "failedLoginAttempts", "mfaEnabled", "displayName") VALUES ($1, $2, $3, $4, NOW(), NOW(), 0, false, $5)`,
      [id, email, await hashPassword(p1), role, name]);
    await c.query(`INSERT INTO "AuditLog" (id, action, actor, actor_id, entity, entity_id, details) VALUES ($1, 'ADMIN_ACCOUNT_CREATED_LOCAL', 'lab-local-cli', 'lab-local-cli', 'AdminUser', $2, $3)`,
      [crypto.randomUUID(), id, JSON.stringify({ role, target: email, holder: name, attestedOnePersonOneAccount: true })]);
  } finally { await c.end(); }
  say(`Compte ${role} créé. À la première connexion sur http://127.0.0.1:${env.LAB_PORT || 3000}/admin/login, scannez le code QR avec votre application d’authentification puis saisissez le code à 6 chiffres.`);
}

async function adminResetMfa() {
  // lost phone: the account's MFA secret is erased; the next sign-in shows a NEW QR code. Local machine only (needs the local configuration and database), audited.
  const env = readEnv(); localUrl(env.DATABASE_URL);
  const email = String(arg('email', '')).trim().toLowerCase(); if (!email) die('précisez --email.');
  const c = new pg.Client({ connectionString: env.DATABASE_URL }); await c.connect();
  try {
    const r = await c.query(`UPDATE "AdminUser" SET "mfaEnabled" = false, "mfaSecret" = NULL, "mfaIv" = NULL, "sessionsValidAfter" = NOW() WHERE email = $1 RETURNING id`, [email]);
    if (!r.rowCount) die('compte introuvable.');
    await c.query(`INSERT INTO "AuditLog" (id, action, actor, actor_id, entity, entity_id, details) VALUES ($1, 'ADMIN_MFA_RESET_LOCAL', 'lab-local-cli', 'lab-local-cli', 'AdminUser', $2, $3)`, [crypto.randomUUID(), r.rows[0].id, JSON.stringify({ target: email })]);
  } finally { await c.end(); }
  say('MFA réinitialisée et sessions terminées : à la prochaine connexion, un nouveau code QR sera proposé.');
}

async function adminResetPassword() {
  // forgotten password: a new one typed on this machine (never shown, never stored in clear); every session ends; the lockout is lifted; MFA is NOT touched. Audited.
  const env = readEnv(); localUrl(env.DATABASE_URL);
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const email = String(arg('email', '')).trim().toLowerCase(); if (!email) die('précisez --email.');
  const piped = process.stdin.isTTY ? null : (await new Promise((r) => { let d = ''; process.stdin.on('data', (c) => { d += c; }); process.stdin.on('end', () => r(d.split('\n'))); }));
  const rl = piped ? { question: (q, cb) => cb((piped.shift() ?? '').replace(/\r$/, '')), close: () => {}, output: process.stdout } : readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const p1 = await ask(rl, 'Nouveau mot de passe (12 caractères minimum, non affiché) : ', true);
  const p2 = await ask(rl, 'Répétez le mot de passe : ', true);
  rl.close();
  if (p1 !== p2) die('les deux saisies diffèrent.');
  if (p1.length < 12) die('mot de passe trop court (12 caractères minimum).');
  const { hashPassword } = await import('../api/_utils/user-auth.js');
  const c = new pg.Client({ connectionString: env.DATABASE_URL }); await c.connect();
  try {
    const r = await c.query(`UPDATE "AdminUser" SET password = $2, "failedLoginAttempts" = 0, "lockoutUntil" = NULL, "sessionsValidAfter" = NOW(), "updatedAt" = NOW() WHERE email = $1 RETURNING id`, [email, await hashPassword(p1)]);
    if (!r.rowCount) die('compte introuvable.');
    await c.query(`INSERT INTO "AuditLog" (id, action, actor, actor_id, entity, entity_id, details) VALUES ($1, 'ADMIN_PASSWORD_RESET_LOCAL', 'lab-local-cli', 'lab-local-cli', 'AdminUser', $2, $3)`, [crypto.randomUUID(), r.rows[0].id, JSON.stringify({ target: email })]);
  } finally { await c.end(); }
  say('Mot de passe remplacé et sessions terminées. La MFA reste active : connectez-vous avec le nouveau mot de passe puis le code à 6 chiffres.');
}

/**
 * The LAB server's environment (« start » and the supervisor of the automatic startup): nothing of the caller's shell but PATH and HOME; the schedule's 03:17 is
 * Paris time whatever the Mac's setting; the LAB knows only its named administrators (a token for an e-mail without an AdminUser row is refused,
 * api/_utils/auth.js adminSessionRefused). @param {Record<string, string>} env
 */
function serverEnv(env) {
  return { PATH: process.env.PATH, HOME: process.env.HOME, TZ: 'Europe/Paris', LAB_DIST: DIST, LAB_RUN_DIR: RUN_DIR, ...veilleEnv(), ...env, ADMIN_SESSION_REGISTRY_STRICT: 'true' };
}

/** the local database is up and pinned to UTC (never exits: the supervisor waits and retries) @param {Record<string, string>} env */
async function checkDb(env) {
  try { if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(env.DATABASE_URL).hostname)) return { ok: false, why: 'la base doit être locale (127.0.0.1)' }; } catch { return { ok: false, why: 'DATABASE_URL absent de la configuration' }; }
  const c = new pg.Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await c.connect();
    const tz = (await c.query('SHOW timezone')).rows[0].TimeZone;
    return tz === 'UTC' ? { ok: true } : { ok: false, why: `la base locale n’est pas réglée en UTC (${tz}) : relancez « init » (sans effet sur vos données)` };
  } catch (e) { return { ok: false, why: `base de données locale pas encore prête (${e?.code || e?.message || e})` }; }
  finally { await c.end().catch(() => {}); }
}

async function start() {
  const env = readEnv(); localUrl(env.DATABASE_URL);
  const port = Number(env.LAB_PORT || 3000);
  const sup = await import('./lab-supervisor.mjs');
  // one LAB server, and never over a native QA campaign (it has priority on the port)
  if (await sup.qaRunning()) die(`une campagne de QA native est en cours : elle a la priorité sur le port ${port} ; relancez quand elle sera terminée.`);
  const l = await sup.listeners(port);
  if (l.some((x) => x.lab)) { say(`Le serveur LAB tourne déjà : http://127.0.0.1:${port} (« server status » pour le détail). Rien à faire.`); process.exit(0); }
  if (l.length) die(`le port ${port} est occupé par un autre programme.`);
  const db = await checkDb(env);
  if (!db.ok) die(`${db.why}.`);
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'scripts', 'lab-server.mjs')], { cwd: ROOT, stdio: 'inherit', env: serverEnv(env) });
  process.exit(r.status === 75 ? 0 : r.status ?? 0);
}

/** the supervisor of the automatic startup (run by the LaunchAgent, « autostart enable »); not for the owner's hands */
async function supervise() {
  const sup = await import('./lab-supervisor.mjs');
  const readEnvSafe = () => { if (!fs.existsSync(ENV_FILE)) throw new Error('configuration absente : lancez « init »'); return readEnv(); };
  const code = await sup.runSupervisor({ root: ROOT, envFile: ENV_FILE, dist: DIST, readEnv: readEnvSafe, serverEnv, checkDb, node: fs.existsSync(NODE_STABLE) ? NODE_STABLE : process.execPath });
  process.exit(code);
}

const STATE_FR = { running: 'en marche', starting: 'démarrage', stopping: 'arrêt en cours', 'suspended-qa': 'suspendu : campagne de QA native en cours (il reviendra seul)',
  stopped: 'arrêté à votre demande (« server start » pour le relancer)', 'running-elsewhere': 'un serveur LAB lancé dans un Terminal sert le site', 'port-busy': 'port occupé par un autre programme',
  backoff: 'redémarrage après une panne', 'waiting-db': 'attend la base de données', 'waiting-build': 'attend le site construit (« build »)', 'waiting-config': 'attend la configuration', off: 'arrêté' };
const hhmm = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) : '—');

/** the LAB server: status, stop and start (temporary), and the hand-over of port 3000 before a native QA campaign */
async function server() {
  const sub = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'status';
  const sup = await import('./lab-supervisor.mjs'); const P = sup.paths(ENV_FILE);
  fs.mkdirSync(P.run, { recursive: true, mode: 0o700 });
  const env = readEnv(); const port = Number(env.LAB_PORT || 3000);
  const health = async () => { try { const r = await fetch(`http://127.0.0.1:${port}/__lab/health`, { signal: AbortSignal.timeout(1500) }); return r.ok ? await r.json() : null; } catch { return null; } };
  const supervisorPid = () => { try { const p = Number(fs.readFileSync(P.lock, 'utf8')); process.kill(p, 0); return p; } catch { return null; } };
  const wait = async (cond, ms) => { const until = Date.now() + ms; while (Date.now() < until) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 500)); } return false; };
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${sup.LABEL}.plist`);
  const loaded = () => spawnSync('/bin/launchctl', ['print', `gui/${process.getuid()}/${sup.LABEL}`], { encoding: 'utf8' }).status === 0;
  // the QA launchers bind the port without SO_REUSEADDR: free means free for them
  const freeForQa = () => spawnSync('/usr/bin/python3', ['-c', `import socket,sys\ns=socket.socket()\ntry:\n  s.bind(('127.0.0.1', ${port}))\nexcept OSError:\n  sys.exit(1)\nfinally:\n  s.close()`]).status === 0;

  if (sub === 'status') {
    const h = await health(); const s = supervisorPid() ? (() => { try { return JSON.parse(fs.readFileSync(P.status, 'utf8')); } catch { return null; } })() : null;
    say(`Démarrage automatique : ${fs.existsSync(plistPath) && loaded() ? 'activé (à chaque ouverture de session sur ce Mac)' : 'désactivé (« autostart enable » pour l’activer)'}.`);
    say(`Serveur LAB : ${h ? `en marche depuis le ${hhmm(h.startedAt)} — http://127.0.0.1:${port} (administration : /admin/login, veille : /admin/veille)` : 'arrêté'}${s ? ` ; superviseur : ${STATE_FR[s.state] || s.state}${s.state === 'backoff' && s.nextStartAt ? ` (prochain essai : ${hhmm(s.nextStartAt)})` : ''}` : ''}.`);
    if (s?.crashesLastHour) say(`Pannes dans la dernière heure : ${s.crashesLastHour} (dernière : ${hhmm(s.lastCrash)}) — détail dans ${path.join(P.logs, 'server.log')}.`);
    try {
      Object.assign(process.env, veilleEnv(), env);
      const { db } = await import('../src/db/index.js');
      const { pauseState } = await import('../api/_services/verification/control.js');
      const { nextRunAt } = await import('../api/_services/verification/schedule.js');
      const p = await pauseState(db); const next = await nextRunAt(db);
      say(`Veille : ${p.paused ? 'EN PAUSE (« veille resume »)' : `prochaine : ${next.at ? (new Date(next.at) <= new Date() ? 'dès que possible (rattrapage de la nuit)' : hhmm(next.at)) : next.why}`} ; chaque nuit à 3 h 17 (heure de Paris) quand le serveur tourne.`);
    } catch (e) { say(`Veille : base de données non joignable (${String(e?.code || e?.message || e).slice(0, 80)}).`); }
    say(`Journaux : ${P.logs} (supervisor.log, server.log).`);
    process.exit(0);
  }
  if (sub === 'stop') {
    fs.writeFileSync(P.stop, JSON.stringify({ at: Date.now(), boot: await sup.bootTime() }), { mode: 0o600 });
    if (!supervisorPid()) {
      try { fs.unlinkSync(P.stop); } catch { /* gone */ }
      die((await health()) ? 'le serveur LAB tourne dans un Terminal : arrêtez-le avec Ctrl+C dans cette fenêtre.' : 'aucun serveur LAB en marche.');
    }
    const ok = await wait(async () => !(await health()), 40000);
    say(ok ? 'Serveur LAB arrêté. Il ne redémarre pas avant « server start » (ou le prochain redémarrage du Mac). La veille de la nuit reprendra au redémarrage.' : 'Arrêt demandé ; le serveur termine la fiche en cours (« server status »).');
    process.exit(0);
  }
  if (sub === 'start') {
    for (const f of [P.stop, P.handover]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
    if (!supervisorPid()) die('démarrage automatique désactivé : « autostart enable », ou « start » dans un Terminal.');
    const ok = await wait(async () => Boolean(await health()), 90000);
    say(ok ? `Serveur LAB en marche : http://127.0.0.1:${port}` : `Le serveur n’a pas encore répondu : « server status » et ${path.join(P.logs, 'server.log')}.`);
    process.exit(ok ? 0 : 1);
  }
  if (sub === 'restart') {
    // after a « build »: the supervisor starts the new server at once (no crash counted)
    const h = await health(); const sp = supervisorPid();
    if (!sp) die('démarrage automatique désactivé : redémarrez le serveur du Terminal (Ctrl+C puis « start »).');
    if (h) { process.kill(sp, 'SIGHUP'); await wait(async () => { const n = await health(); return !n || n.pid !== h.pid; }, 30000); }
    const ok = await wait(async () => { const n = await health(); return Boolean(n && (!h || n.pid !== h.pid)); }, 90000);
    say(ok ? `Serveur LAB redémarré : http://127.0.0.1:${port}` : '« server status » pour voir où il en est.');
    process.exit(ok ? 0 : 1);
  }
  if (sub === 'qa-handover') {
    fs.writeFileSync(P.handover, JSON.stringify({ at: Date.now() }), { mode: 0o600 });
    if ((await health()) && !supervisorPid()) die('le serveur LAB tourne dans un Terminal : arrêtez-le (Ctrl+C), puis lancez la campagne.');
    const free = await wait(async () => !(await health()) && freeForQa(), 90000);
    say(free ? `Port ${port} libre : la campagne de QA native peut démarrer. Le serveur LAB reviendra seul après elle (ou dans trois heures si aucune campagne ne démarre).`
      : `Le port ${port} n’est pas encore libre : « server status ».`);
    process.exit(free ? 0 : 1);
  }
  die('server : status | stop | start | restart | qa-handover');
}

/** the automatic startup at login (a user LaunchAgent; no administrator right, no power, sleep or startup setting of the Mac is changed) */
async function autostart() {
  const sub = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'status';
  const sup = await import('./lab-supervisor.mjs'); const P = sup.paths(ENV_FILE);
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${sup.LABEL}.plist`);
  const uid = process.getuid(); const target = `gui/${uid}/${sup.LABEL}`;
  const loaded = () => spawnSync('/bin/launchctl', ['print', target], { encoding: 'utf8' }).status === 0;
  if (sub === 'enable') {
    const env = readEnv(); localUrl(env.DATABASE_URL);
    if (!fs.existsSync(path.join(DIST, 'index.html'))) die('site non construit : lancez d’abord « build ».');
    fs.mkdirSync(P.logs, { recursive: true, mode: 0o700 }); fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    fs.writeFileSync(plistPath, sup.plist({ node: fs.existsSync(NODE_STABLE) ? NODE_STABLE : process.execPath, root: ROOT, envFile: ENV_FILE, log: P.launchdLog }), { mode: 0o644 });
    if (loaded()) spawnSync('/bin/launchctl', ['bootout', target]);
    const r = spawnSync('/bin/launchctl', ['bootstrap', `gui/${uid}`, plistPath], { encoding: 'utf8' });
    if (r.status !== 0) die(`launchctl bootstrap : ${String(r.stderr || r.stdout || r.status).trim().slice(0, 200)}`);
    say(`Démarrage automatique activé : ${plistPath}. Le serveur LAB démarre maintenant et à chaque ouverture de session (127.0.0.1:${env.LAB_PORT || 3000} uniquement).`);
    say('« server status » pour le voir ; « autostart disable » pour l’arrêter.');
    process.exit(0);
  }
  if (sub === 'disable') {
    if (loaded()) { const r = spawnSync('/bin/launchctl', ['bootout', target], { encoding: 'utf8' }); if (r.status !== 0 && loaded()) die(`launchctl bootout : ${String(r.stderr || r.status).trim().slice(0, 200)}`); }
    try { fs.unlinkSync(plistPath); } catch { /* not installed */ }
    say('Démarrage automatique désactivé : le serveur LAB est arrêté et ne démarrera plus seul (« start » dans un Terminal, ou « autostart enable »).');
    process.exit(0);
  }
  if (sub === 'status') { process.argv[3] = 'status'; return server(); }
  die('autostart : enable | disable | status');
}

async function status() {
  const env = readEnv(); localUrl(env.DATABASE_URL);
  const c = new pg.Client({ connectionString: env.DATABASE_URL }); await c.connect();
  try {
    const [a] = (await c.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE "mfaEnabled")::int AS mfa FROM "AdminUser"`)).rows;
    const [w] = (await c.query(`SELECT (SELECT count(*) FROM "Aide")::int AS aides, (SELECT count(*) FROM "Demarche")::int AS demarches, (SELECT count(*) FROM "Structure")::int AS structures,
      (SELECT count(*) FROM "ContentVerification" WHERE "reviewerRole" <> 'system')::int AS human, (SELECT count(*) FROM "ContentVerification" WHERE "reviewerRole" = 'system')::int AS auto`)).rows;
    say(`Base locale : OK. Administrateurs : ${a.n} (dont ${a.mfa} avec MFA active). Fiches : ${w.aides} aides, ${w.demarches} démarches, ${w.structures} structures ; décisions enregistrées : ${w.human} par des personnes, ${w.auto} par la veille automatique.`);
    const [g] = (await c.query(`SELECT count(*) FILTER (WHERE type = 'COMMUNE')::int AS communes, count(*) FILTER (WHERE type = 'EPCI')::int AS epcis FROM "Territory"`).catch(() => ({ rows: [{}] }))).rows;
    say(g?.communes ? `Référentiel territorial : ${g.communes} communes, ${g.epcis} EPCI.` : 'Référentiel territorial : ABSENT — aucune commune n’est reconnue (assistant, recherche par territoire) ; lancez « geo ».');
    say(`Site construit : ${fs.existsSync(path.join(DIST, 'index.html')) ? 'oui' : 'non (lancez « build »)'}. Adresse : http://127.0.0.1:${env.LAB_PORT || 3000}`);
    const [v] = (await c.query(`SELECT "startedAt", status FROM "CronRun" WHERE job = 'veille' ORDER BY "startedAt" DESC LIMIT 1`).catch(() => ({ rows: [] }))).rows;
    say(`Veille automatique : ${v ? `dernière le ${new Date(v.startedAt).toLocaleString('fr-FR')} (${v.status})` : 'pas encore lancée'} ; chaque nuit à 3 h 17 quand le serveur tourne.`);
  } finally { await c.end(); }
}

/** the LAB's veille settings: the machine guard on (disk floor for the native QA, no run during a QA campaign, model only with free memory), the archive cache */
function veilleEnv() {
  return { ADA_VEILLE_RESOURCE_GUARD: process.env.ADA_VEILLE_RESOURCE_GUARD || 'on', ADA_VEILLE_CACHE_DIR: process.env.ADA_VEILLE_CACHE_DIR || path.join(path.dirname(ENV_FILE), 'veille-cache') };
}

async function veille() {
  const env = readEnv(); localUrl(env.DATABASE_URL);
  Object.assign(process.env, veilleEnv(), env);   // the LAB configuration (local database, official sites of the launch territory) before the application modules load
  const sub = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'run';   // « veille --max-minutes 60 » is a run with an option, not a sub-command
  const { db } = await import('../src/db/index.js');
  const control = await import('../api/_services/verification/control.js');
  if (sub === 'pause') { await control.setPause(db, { paused: true, by: 'lab-command', reason: arg('reason', 'mise en pause depuis le terminal') }); say('Veille en pause : la veille en cours s’arrête à la fiche suivante, aucune autre ne démarre. Reprise : « veille resume ».'); process.exit(0); }
  if (sub === 'resume') { await control.setPause(db, { paused: false, by: 'lab-command' }); say('Veille reprise : la prochaine démarre à son heure (ou dans les minutes qui viennent si celle de cette nuit n’a pas eu lieu).'); process.exit(0); }
  if (sub === 'status') {
    const { veilleDigest } = await import('../api/_services/verification/digest.js');
    const { nextRunAt } = await import('../api/_services/verification/schedule.js');
    const d = await veilleDigest({ db, days: 7 }); const next = await nextRunAt(db);
    const last = d.status.lastRun;
    say(`Veille : ${d.status.paused.paused ? 'EN PAUSE' : d.status.running ? `en cours (${d.status.running.progress?.phase || '…'})` : 'active'} ; dernière : ${last ? `${new Date(last.startedAt).toLocaleString('fr-FR')} (${last.status})` : 'aucune'} ; prochaine : ${next.at ? new Date(next.at).toLocaleString('fr-FR') : next.why}.`);
    say(`Publiées : ${d.totals.map((t) => `${t.published}/${t.total} ${t.kind}`).join(', ')}. Sources officielles suivies : ${d.sources.active} (${d.sources.newSince} nouvelles cette semaine, ${d.sources.rejectedCount} écartées).`);
    say(`7 derniers jours : ${d.period.checked} vérifications, ${d.period.published + d.period.created} publiées ou ajoutées, ${d.period.updated} mises à jour, ${d.period.withdrawn} retirées, ${d.period.duplicates} doublons, ${d.period.textsRefused} textes refusés.`);
    for (const a of d.alerts) say(`  [${a.level}] ${a.message}`);
    process.exit(0);
  }
  if (sub === 'audit') {
    const { publicationAudit } = await import('../api/_services/verification/audit.js');
    const { trustedDomains } = await import('../api/_services/verification/sources.js');
    const a = await publicationAudit({ db, trusted: await trustedDomains(db) });
    say(`Contrôle de cohérence : ${a.checked} fiches publiques, ${a.violations.length} écart(s).`);
    for (const v of a.violations.slice(0, 40)) say(`  ${v.code} ${v.kind} « ${v.title} » : ${v.detail}`);
    process.exit(0);
  }
  if (sub !== 'run') die('veille : (rien) | status | pause | resume | audit');
  const { runVeille } = await import('../api/_services/verification/chain.js');
  const { bumpContentEpoch } = await import('../api/lib/search-cache.js');
  say('Veille automatique : lecture des sources officielles et vérification des fiches (plusieurs minutes ; Ctrl+C pour arrêter, la prochaine veille reprendra).');
  const minutes = Number(arg('max-minutes', '')) || undefined;
  // « veille --only finess,structure »: only those steps (aide, demarche, dispositif, structure, offices, finess, fiches, review, audit)
  const only = arg('only', '') ? arg('only', '').split(',').map((x) => x.trim()).filter(Boolean) : undefined;
  const r = await runVeille({ trigger: 'lab-command', root: ROOT, log: (m) => say(`  ${m}`), maxMinutes: minutes, force: process.argv.includes('--force'), ...(only ? { only } : {}) });
  if (r.skipped) die(`veille non lancée : ${r.message || ({ ALREADY_RUNNING: 'une veille est déjà en cours (elle continue ; rien à faire)' }[r.skipped]) || r.skipped}`);
  if (r.ok) await bumpContentEpoch().catch(() => {});
  const c = r.counts || {}; const n = (re) => Object.entries(c).filter(([k]) => re.test(k)).reduce((t, [, v]) => t + v, 0);
  say(`Veille ${r.status} en ${Math.max(1, Math.round(r.durationMs / 60000))} min : ${n(/^(aide|demarche|dispositif|structure):checked$/)} vérifiées, ${n(/:PUBLISHED$/)} publiées, ${n(/:CREATED$/)} ajoutées, ${n(/:(UPDATED|CORRECTED)$/)} mises à jour, ${n(/:WITHDRAWN$/)} retirées, ${n(/:(RETRY|UNRESOLVED)$/)} à réessayer${r.stop ? ` — arrêtée : ${r.stop.reason}` : ''}. Détail : http://127.0.0.1:${env.LAB_PORT || 3000}/admin/veille`);
  process.exit(r.ok ? 0 : 1);
}

const cmd = process.argv[2];
const run = { init, geo: () => geo(), build, 'admin-create': adminCreate, 'admin-reset-mfa': adminResetMfa, 'admin-reset-password': adminResetPassword, start, status, veille, server, autostart, supervise }[cmd];
if (!run) die('commande : init | geo | build | admin-create | admin-reset-mfa --email … | admin-reset-password --email … | start | status | veille [status | pause | resume | audit] | server [status | stop | start | restart | qa-handover] | autostart [enable | disable | status]');
Promise.resolve(run()).catch((e) => die(String(e?.code || e?.message || e).slice(0, 200)));
