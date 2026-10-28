#!/usr/bin/env node
/**
 * First production administrator: a NAMED account with a password hash; MFA is enrolled at the first sign-in (launch-readiness item 44).
 * Production has no environment administrator any more (ADMIN_EMAIL / ADMIN_PASSWORD are ignored or refused there), so the owner creates the first account
 * here, from their own machine, against the deployed database:
 *
 *   DATABASE_URL=… node scripts/admin-bootstrap.mjs --confirm-host <database host> [--email … --name "…" --role admin|superadmin] [--additional]
 *
 * Guards:
 *  - the database host is typed again (--confirm-host) and must match DATABASE_URL: no account lands in the wrong database by accident;
 *  - any non-local database is reached over TLS with a VERIFIED certificate (the password hash crosses the network);
 *  - refused when an administrator already exists, unless --additional (a further named account, journalised as such);
 *  - one person = one account: attested, and a second account for the same holder name is refused;
 *  - the password is typed twice, never shown, never written anywhere, at least 12 characters;
 *  - one transaction: the account and its AuditLog line ADMIN_ACCOUNT_BOOTSTRAP (role, holder, host — never the password or a code).
 * The output never contains the connection string, the password or its hash.
 */
import crypto from 'node:crypto';
import readline from 'node:readline';
import pg from 'pg';
import { hashPassword } from '../api/_utils/password-hash.js';

const LOCAL = /^(localhost|127\.0\.0\.1|::1|\[::1\])$/i;
export const MIN_PASSWORD = 12;

/** Where the account would go, without the credentials of the connection string. */
export function databaseHost(url) {
  try { const u = new URL(String(url || '')); return u.hostname.replace(/^\[|\]$/g, '').toLowerCase(); } catch { return ''; }
}

/**
 * The decision, before any write. adminCount: administrators already in the database.
 * @returns {{ ok: true, local: boolean } | { ok: false, reason: string }}
 */
export function planBootstrap({ url, confirmHost, adminCount, additional = false }) {
  const host = databaseHost(url);
  if (!host) return { ok: false, reason: 'DATABASE_URL absente ou illisible.' };
  if (!confirmHost) return { ok: false, reason: `indiquez --confirm-host ${host} : l’hôte de la base est confirmé à chaque création.` };
  if (String(confirmHost).trim().toLowerCase() !== host) return { ok: false, reason: 'l’hôte confirmé ne correspond pas à DATABASE_URL : rien n’est créé.' };
  if (adminCount > 0 && !additional) return { ok: false, reason: `${adminCount} compte(s) administrateur existe(nt) déjà : l’amorçage ne sert qu’au premier compte. Pour un compte nominatif supplémentaire : --additional.` };
  return { ok: true, local: LOCAL.test(host) };
}

/** The connection: verified TLS for any non-local database (sslmode in the URL never weakens it). */
export function connectionOptions(url) {
  const host = databaseHost(url);
  if (LOCAL.test(host)) return { connectionString: url, ssl: false };
  const u = new URL(url);
  for (const k of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) u.searchParams.delete(k);
  return { connectionString: u.toString(), ssl: { rejectUnauthorized: true, servername: host } };
}

export function validateIdentity({ email, name, role, attest }) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'adresse e-mail invalide.';
  if (name.length < 3) return 'indiquez le nom et le prénom de la personne titulaire.';
  if (!['admin', 'superadmin'].includes(role)) return 'rôle invalide (admin ou superadmin).';
  if (attest !== 'oui') return 'un compte administrateur est personnel : une personne qui a déjà un compte ne peut pas en recevoir un second.';
  return null;
}

/**
 * Creates the account in one transaction (the AdminUser table is locked, so two simultaneous runs cannot both create a « first » account).
 * @returns {Promise<{ ok: true, id: string } | { ok: false, reason: string }>}
 */
export async function createAdministrator(client, { email, name, role, passwordHash, additional, host }) {
  await client.query('BEGIN');
  try {
    await client.query('LOCK TABLE "AdminUser" IN SHARE ROW EXCLUSIVE MODE');
    const count = (await client.query('SELECT count(*)::int AS n FROM "AdminUser"')).rows[0].n;
    if (count > 0 && !additional) { await client.query('ROLLBACK'); return { ok: false, reason: 'un compte administrateur existe déjà (créé entre-temps) : rien n’est créé.' }; }
    if ((await client.query('SELECT 1 FROM "AdminUser" WHERE email = $1', [email])).rowCount) { await client.query('ROLLBACK'); return { ok: false, reason: 'ce compte existe déjà.' }; }
    if ((await client.query('SELECT 1 FROM "AdminUser" WHERE lower("displayName") = lower($1)', [name])).rowCount) {
      await client.query('ROLLBACK'); return { ok: false, reason: 'cette personne a déjà un compte administrateur (une personne = un compte).' };
    }
    const id = crypto.randomUUID();
    await client.query(`INSERT INTO "AdminUser" (id, email, password, role, "createdAt", "updatedAt", "failedLoginAttempts", "mfaEnabled", "displayName")
      VALUES ($1, $2, $3, $4, NOW(), NOW(), 0, false, $5)`, [id, email, passwordHash, role, name]);
    await client.query(`INSERT INTO "AuditLog" (id, action, actor, actor_id, entity, entity_id, details) VALUES ($1, 'ADMIN_ACCOUNT_BOOTSTRAP', 'admin-bootstrap-cli', 'admin-bootstrap-cli', 'AdminUser', $2, $3)`,
      [crypto.randomUUID(), id, JSON.stringify({ role, target: email, holder: name, attestedOnePersonOneAccount: true, additional: count > 0, databaseHost: host, mfa: 'à configurer à la première connexion' })]);
    await client.query('COMMIT');
    return { ok: true, id };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

const arg = (name, dflt = '') => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt; };
const die = (m) => { console.error(`admin-bootstrap : ${m}`); process.exit(1); };

function ask(rl, q, hidden = false) {
  return new Promise((resolve) => {
    if (!hidden || !process.stdin.isTTY) { rl.question(q, resolve); return; }
    const out = rl.output; const write = out.write.bind(out); let muted = false;
    out.write = (s) => (muted ? (s.includes('\n') ? write('\n') : true) : write(s));
    rl.question(q, (v) => { out.write = write; resolve(v); }); muted = true;
  });
}

async function main() {
  const url = process.env.DATABASE_URL || '';
  const additional = process.argv.includes('--additional');
  const pre = planBootstrap({ url, confirmHost: arg('confirm-host'), adminCount: 0, additional: true });   // host checks first, before any connection
  if (!pre.ok) die(pre.reason);
  const host = databaseHost(url);
  const client = new pg.Client({ ...connectionOptions(url), connectionTimeoutMillis: 15000 });
  try { await client.connect(); } catch (e) { die(`connexion impossible à ${host} (${e?.code || 'erreur'}${pre.local ? '' : ' — le certificat TLS de la base doit être valide'}).`); }
  try {
    const exists = (await client.query(`SELECT to_regclass('"AdminUser"') IS NOT NULL AS ok`)).rows[0].ok;
    if (!exists) die('la table AdminUser est absente : appliquez d’abord les migrations (npx drizzle-kit migrate).');
    const adminCount = (await client.query('SELECT count(*)::int AS n FROM "AdminUser"')).rows[0].n;
    const plan = planBootstrap({ url, confirmHost: arg('confirm-host'), adminCount, additional });
    if (!plan.ok) die(plan.reason);
    // non-interactive use (stdin piped, tests): the lines are read up front (readline would drop lines that arrive before a question is asked)
    const piped = process.stdin.isTTY ? null : (await new Promise((r) => { let d = ''; process.stdin.on('data', (c) => { d += c; }); process.stdin.on('end', () => r(d.split('\n'))); }));
    const rl = piped ? { question: (q, cb) => cb((piped.shift() ?? '').replace(/\r$/, '')), close: () => {}, output: process.stdout } : readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    console.log(`Base : ${host}${plan.local ? ' (locale)' : ' (TLS vérifié)'} · comptes administrateurs existants : ${adminCount}`);
    const email = String(arg('email') || await ask(rl, 'Adresse e-mail de l’administrateur (nominative) : ')).trim().toLowerCase();
    const name = String(arg('name') || await ask(rl, 'Nom et prénom de la personne titulaire du compte : ')).trim().replace(/\s+/g, ' ');
    const role = String(arg('role') || (await ask(rl, 'Rôle [admin / superadmin] (admin — superadmin seulement si nécessaire) : ')) || 'admin').trim().toLowerCase();
    const attest = process.argv.includes('--attest-one-account') ? 'oui'
      : String(await ask(rl, 'Cette personne n’a-t-elle aucun autre compte administrateur (une personne = un compte) ? [oui/non] : ')).trim().toLowerCase();
    const bad = validateIdentity({ email, name, role, attest });
    if (bad) { rl.close(); die(bad); }
    const p1 = await ask(rl, `Mot de passe (${MIN_PASSWORD} caractères minimum, non affiché) : `, true);
    const p2 = await ask(rl, 'Répétez le mot de passe : ', true);
    rl.close();
    if (p1 !== p2) die('les deux saisies diffèrent.');
    if (p1.length < MIN_PASSWORD) die(`mot de passe trop court (${MIN_PASSWORD} caractères minimum).`);
    const r = await createAdministrator(client, { email, name, role, passwordHash: await hashPassword(p1), additional, host });
    if (!r.ok) die(r.reason);
    console.log(`Compte ${role} créé pour ${name}. À la première connexion sur /admin/login, scannez le code QR avec votre application d’authentification puis saisissez le code à 6 chiffres (MFA obligatoire).`);
  } finally { await client.end().catch(() => {}); }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((e) => die(e?.code ? `erreur ${e.code}` : 'erreur inattendue (aucune donnée affichée).'));
