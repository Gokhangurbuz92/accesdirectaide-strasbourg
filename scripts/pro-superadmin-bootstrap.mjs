#!/usr/bin/env node
/**
 * R43 (opening-sequence review E3) — the FIRST platform SUPERADMIN of ADA Pro, created once from the owner's machine (a CLI, never an HTTP route).
 *
 * Why: in Production a professional's second factor is enrolled ONLY through an invitation issued by another administrator (R42-A08), and the first
 * STRUCTURE_ADMIN of the pilot structure needs a SUPERADMIN to invite them. Nobody can invite the very first SUPERADMIN, so this script is the root of trust:
 * it creates the account WITHOUT a factor and issues its MFA enrolment invitation through the existing mechanism (Invitation row: SHA-256 of the token only,
 * bound to the structure + e-mail + role SUPERADMIN, single use, 72 h). The person then signs in with the password they typed here (password-only session:
 * only /api/pro/me, /api/pro/mfa-enrolment and /api/pro/mfa-setup are reachable in Production) and redeems the link from their mailbox to enrol the factor.
 *
 *   DATABASE_URL=… APP_BASE_URL=https://… MAILER_PROVIDER=… node scripts/pro-superadmin-bootstrap.mjs \
 *       --confirm-host <host> --confirm-database <name> [--confirm-non-lab] --email … --name "…" [--attest-one-account] [--link-file <path>]
 *   … node scripts/pro-superadmin-bootstrap.mjs resend-invitation --confirm-host … --confirm-database … [--confirm-non-lab] [--link-file <path>]
 *
 * Guards (every refusal writes nothing):
 *  - the host AND the database name are typed again and must match DATABASE_URL;
 *  - a database that is not a local LAB/test database (loopback host + a « lab », « test » or « e2e » word in its name) also needs --confirm-non-lab;
 *  - any non-local database is reached over TLS with a VERIFIED certificate (scripts/admin-bootstrap.mjs connectionOptions);
 *  - refused when ANY ProUser with the role SUPERADMIN exists (whatever its status), checked again under a table lock in the same transaction;
 *  - refused when the address already has a professional account (one person, one account; attested);
 *  - the password is typed twice, never shown, never written anywhere: 12 characters minimum + the shared password rule;
 *  - the invitation link is a secret: it is NEVER printed. It goes through the configured mailer (resend / mailjet / msgraph; the in-memory « test »
 *    provider only for a local LAB database), or — when no mailer is wired — to --link-file (created 0600, outside the repository, never overwritten);
 *  - one transaction: the internal platform structure (draft, unverified, not bookable, not public), the account, the invitation and the AuditLog line
 *    PRO_SUPERADMIN_BOOTSTRAP (holder, address, ids, host, database name, delivery channel — never the password, its hash, the token or the link).
 * `resend-invitation` replaces the pending invitation of the bootstrapped SUPERADMIN while it has not enrolled its factor (lost or expired e-mail); it is
 * journalised as PRO_SUPERADMIN_BOOTSTRAP_INVITATION_RESENT and refused once the factor is enrolled. Every further SUPERADMIN goes through the application.
 * The output never contains the connection string, the password, its hash, the token or the link.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { connectionOptions, databaseHost } from './admin-bootstrap.mjs';
import { hashPassword } from '../api/_utils/password-hash.js';
import { hashInviteToken, newInviteToken } from '../api/_utils/invite-token.js';
import { passwordProblems } from '../src/lib/passwordPolicy.js';
import { isMainModule } from './lib/is-main.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = /^(localhost|127\.0\.0\.1|::1)$/i;
export const LAB_DB_NAME = /(^|_)(lab|test|e2e)(_|$)/i;
export const MIN_PASSWORD = 12;
/** the same validity as an enrolment invitation sent from the application (api/_utils/pro-mfa-enrolment.js MFA_INVITATION_TTL_MS) */
export const INVITATION_TTL_MS = 72 * 3600 * 1000;
export const PLATFORM_STRUCTURE = Object.freeze({
  slug: 'ada-exploitation-plateforme-interne',
  nom: 'Exploitation de la plateforme Accès Direct Aide (compte interne, non public)',
});
export const AUDIT_ACTOR = 'pro-superadmin-bootstrap-cli';
const DELIVERING = ['resend', 'mailjet', 'msgraph'];

/** @param {unknown} url @returns {string} the database name of a connection string ('' when unreadable) */
export function databaseName(url) {
  try { return decodeURIComponent(new URL(String(url || '')).pathname.replace(/^\//, '')); } catch { return ''; }
}

/**
 * The decision about the target, before any connection.
 * @param {{ url: string, confirmHost?: string, confirmDatabase?: string, confirmNonLab?: boolean }} o
 * @returns {{ ok: true, host: string, name: string, local: boolean, lab: boolean } | { ok: false, reason: string }}
 */
export function planTarget({ url, confirmHost = '', confirmDatabase = '', confirmNonLab = false }) {
  const host = databaseHost(url); const name = databaseName(url);
  if (!host || !name) return { ok: false, reason: 'DATABASE_URL absente ou illisible.' };
  if (!confirmHost || !confirmDatabase) return { ok: false, reason: `indiquez --confirm-host ${host} --confirm-database ${name} : la base visée est confirmée à chaque exécution.` };
  if (String(confirmHost).trim().toLowerCase() !== host) return { ok: false, reason: 'l’hôte confirmé ne correspond pas à DATABASE_URL : rien n’est créé.' };
  if (String(confirmDatabase).trim() !== name) return { ok: false, reason: 'le nom de base confirmé ne correspond pas à DATABASE_URL : rien n’est créé.' };
  const local = LOCAL.test(host); const lab = local && LAB_DB_NAME.test(name);
  if (!lab && !confirmNonLab) return { ok: false, reason: 'cette base n’est pas une base LAB locale : ajoutez --confirm-non-lab si c’est bien la base voulue (rien n’est créé).' };
  return { ok: true, host, name, local, lab };
}

/**
 * How the invitation link will reach the person — decided BEFORE any write, so a run that could not deliver creates nothing.
 * @param {{ provider?: string, deliverable: boolean, lab: boolean, linkFile?: string }} o
 * @returns {{ ok: true, channel: 'mail' | 'link-file' } | { ok: false, reason: string }}
 */
export function planDelivery({ provider = '', deliverable, lab, linkFile = '' }) {
  const p = String(provider || 'noop').trim().toLowerCase();
  if (linkFile) {
    const abs = path.resolve(linkFile);
    if (abs === ROOT || abs.startsWith(`${ROOT}${path.sep}`)) return { ok: false, reason: 'le fichier du lien doit être hors du dépôt.' };
    if (fs.existsSync(abs)) return { ok: false, reason: 'le fichier du lien existe déjà : choisissez un nouveau chemin (il n’est jamais écrasé).' };
    return { ok: true, channel: 'link-file' };
  }
  if (p === 'test' && !lab) return { ok: false, reason: 'le fournisseur « test » ne remet rien : il n’est accepté que sur une base LAB locale.' };
  if ((p === 'test' && lab) || (DELIVERING.includes(p) && deliverable)) return { ok: true, channel: 'mail' };
  return { ok: false, reason: 'aucun fournisseur d’e-mail opérationnel (MAILER_PROVIDER) : configurez-le, ou indiquez --link-file <chemin hors du dépôt>.' };
}

/** @param {{ email: string, name: string, attest: string }} o @returns {string | null} */
export function validateIdentity({ email, name, attest }) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'adresse e-mail invalide.';
  if (name.length < 3) return 'indiquez le nom et le prénom de la personne titulaire.';
  if (attest !== 'oui') return 'un compte d’exploitation est personnel : une personne qui a déjà un compte professionnel ne peut pas en recevoir un second.';
  return null;
}

/** @param {string} pw @returns {string | null} */
export function validatePassword(pw) {
  if (pw.length < MIN_PASSWORD) return `mot de passe trop court (${MIN_PASSWORD} caractères minimum).`;
  const problems = passwordProblems(pw);
  return problems.length ? `mot de passe trop faible : ${problems.join(', ')}.` : null;
}

/** @param {string} appBaseUrl @param {boolean} local @returns {string | null} the origin used for the link, or null when unusable */
export function linkOrigin(appBaseUrl, local) {
  let u; try { u = new URL(String(appBaseUrl || '')); } catch { return null; }
  if (u.protocol === 'https:' && !LOCAL.test(u.hostname.replace(/^\[|\]$/g, ''))) return u.origin;
  return local && u.protocol === 'http:' && LOCAL.test(u.hostname.replace(/^\[|\]$/g, '')) ? u.origin : null;
}
/** the enrolment link (fragment: never sent to a server nor kept in its logs) — the same screen as an invitation sent from the application */
export const invitationLink = (/** @type {string} */ origin, /** @type {string} */ token) => `${origin}/pro/mfa-settings#invitation=${encodeURIComponent(token)}`;

/** @param {import('pg').Client} client */
const superadminCount = async (client) => (await client.query(`SELECT count(*)::int AS n FROM "ProUser" WHERE upper(role) = 'SUPERADMIN'`)).rows[0].n;

/**
 * Creates the first SUPERADMIN in ONE transaction (ProUser locked: two simultaneous runs cannot both create a « first » one).
 * @param {import('pg').Client} client
 * @param {{ email: string, name: string, passwordHash: string, host: string, database: string, channel: 'mail' | 'link-file' }} o
 * @param {{ now?: number, token?: string }} [t] tests inject the clock / token
 * @returns {Promise<{ ok: true, userId: string, structureId: string, invitationId: string, token: string, expiresAt: Date } | { ok: false, reason: string }>}
 */
export async function createFirstSuperadmin(client, { email, name, passwordHash, host, database, channel }, t = {}) {
  const now = t.now ?? Date.now(); const token = t.token ?? newInviteToken();
  await client.query('BEGIN');
  try {
    await client.query('LOCK TABLE "ProUser" IN SHARE ROW EXCLUSIVE MODE');
    const n = await superadminCount(client);
    if (n > 0) { await client.query('ROLLBACK'); return { ok: false, reason: `${n} compte(s) SUPERADMIN existe(nt) déjà : l’amorçage ne sert qu’au premier. Les suivants sont invités depuis l’application.` }; }
    if ((await client.query('SELECT 1 FROM "ProUser" WHERE lower(email) = $1', [email])).rowCount) {
      await client.query('ROLLBACK'); return { ok: false, reason: 'cette adresse a déjà un compte professionnel (une personne = un compte) : rien n’est créé.' };
    }
    // the internal structure of the platform role: draft, unverified, not bookable (is_pro_enabled false) — no public list, search or booking shows it
    let structureId = (await client.query('SELECT id FROM "Structure" WHERE slug = $1', [PLATFORM_STRUCTURE.slug])).rows[0]?.id;
    const structureCreated = !structureId;
    if (!structureId) {
      structureId = crypto.randomUUID();
      await client.query(`INSERT INTO "Structure" (id, nom, slug, services, publics_accueillis, categories_aidees, status, statut, is_pro_enabled, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, '{}', '{}', '{}', 'actif', 'brouillon', false, NOW(), NOW())`, [structureId, PLATFORM_STRUCTURE.nom, PLATFORM_STRUCTURE.slug]);
    }
    const userId = crypto.randomUUID();
    await client.query(`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "createdAt", "updatedAt", mfa_enabled)
      VALUES ($1, $2, $3, 'SUPERADMIN', 'active', $4, NOW(), NOW(), false)`, [userId, email, passwordHash, structureId]);
    // expires_at is a timestamp WITHOUT time zone read as UTC by the application: the UTC instant is sent as an ISO string (a Date parameter would be
    // serialised in the operator's local time and shift the expiry by the machine's offset)
    const invitationId = crypto.randomUUID(); const expiresAt = new Date(now + INVITATION_TTL_MS);
    await client.query(`INSERT INTO "Invitation" (id, "structureId", email, role, token, expires_at, "createdAt") VALUES ($1, $2, $3, 'SUPERADMIN', $4, $5, NOW())`,
      [invitationId, structureId, email, hashInviteToken(token), expiresAt.toISOString()]);
    await client.query(`INSERT INTO "AuditLog" (id, action, actor, actor_id, entity, entity_id, details) VALUES ($1, 'PRO_SUPERADMIN_BOOTSTRAP', $2, $2, 'ProUser', $3, $4)`,
      [crypto.randomUUID(), AUDIT_ACTOR, userId, JSON.stringify({ role: 'SUPERADMIN', target: email, holder: name, attestedOnePersonOneAccount: true, structureId, structureCreated,
        invitationId, invitationExpiresAt: expiresAt.toISOString(), delivery: channel, databaseHost: host, databaseName: database, mfa: 'enrolment by invitation only (72 h, single use)' })]);
    await client.query('COMMIT');
    return { ok: true, userId, structureId, invitationId, token, expiresAt };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

/**
 * A new enrolment invitation for the bootstrapped SUPERADMIN, only while it has no factor; the pending ones stop working (only the newest link is valid).
 * @param {import('pg').Client} client
 * @param {{ host: string, database: string, channel: 'mail' | 'link-file' }} o
 * @param {{ now?: number, token?: string }} [t]
 * @returns {Promise<{ ok: true, userId: string, email: string, invitationId: string, token: string, expiresAt: Date } | { ok: false, reason: string }>}
 */
export async function resendBootstrapInvitation(client, { host, database, channel }, t = {}) {
  const now = t.now ?? Date.now(); const token = t.token ?? newInviteToken();
  await client.query('BEGIN');
  try {
    await client.query('LOCK TABLE "ProUser" IN SHARE ROW EXCLUSIVE MODE');
    const rows = (await client.query(`SELECT u.id, u.email, u."structureId", u.mfa_enabled, u.status FROM "ProUser" u WHERE upper(u.role) = 'SUPERADMIN'`)).rows;
    const boot = rows.length === 1 ? rows[0] : null;
    const journalised = boot && (await client.query(`SELECT 1 FROM "AuditLog" WHERE action = 'PRO_SUPERADMIN_BOOTSTRAP' AND entity_id = $1`, [boot.id])).rowCount;
    if (!boot || !journalised) { await client.query('ROLLBACK'); return { ok: false, reason: 'il n’y a pas exactement un SUPERADMIN créé par l’amorçage : les invitations se font depuis l’application.' }; }
    if (boot.mfa_enabled) { await client.query('ROLLBACK'); return { ok: false, reason: 'la double authentification est déjà active : plus aucune invitation d’amorçage n’est émise.' }; }
    if (!['active', 'pending'].includes(String(boot.status))) { await client.query('ROLLBACK'); return { ok: false, reason: 'ce compte est désactivé : rien n’est émis.' }; }
    const email = String(boot.email).trim().toLowerCase();
    await client.query(`DELETE FROM "Invitation" WHERE "structureId" = $1 AND lower(email) = $2 AND used_at IS NULL`, [boot.structureId, email]);
    const invitationId = crypto.randomUUID(); const expiresAt = new Date(now + INVITATION_TTL_MS);
    await client.query(`INSERT INTO "Invitation" (id, "structureId", email, role, token, expires_at, "createdAt") VALUES ($1, $2, $3, 'SUPERADMIN', $4, $5, NOW())`,
      [invitationId, boot.structureId, email, hashInviteToken(token), expiresAt.toISOString()]);
    await client.query(`INSERT INTO "AuditLog" (id, action, actor, actor_id, entity, entity_id, details) VALUES ($1, 'PRO_SUPERADMIN_BOOTSTRAP_INVITATION_RESENT', $2, $2, 'ProUser', $3, $4)`,
      [crypto.randomUUID(), AUDIT_ACTOR, boot.id, JSON.stringify({ role: 'SUPERADMIN', target: email, structureId: boot.structureId, invitationId, invitationExpiresAt: expiresAt.toISOString(),
        delivery: channel, databaseHost: host, databaseName: database })]);
    await client.query('COMMIT');
    return { ok: true, userId: boot.id, email, invitationId, token, expiresAt };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

/**
 * Delivers the link: mailer (the same text as an invitation sent from the application) or a 0600 file. Never prints it.
 * @param {{ channel: 'mail' | 'link-file', email: string, link: string, linkFile?: string, send?: (m: Record<string, string>) => Promise<{ outcome?: string }> }} o
 * @returns {Promise<{ delivered: boolean, status: string }>}
 */
export async function deliverInvitation({ channel, email, link, linkFile = '', send }) {
  if (channel === 'link-file') {
    fs.writeFileSync(path.resolve(linkFile), `${link}\n`, { mode: 0o600, flag: 'wx' });
    return { delivered: true, status: 'LINK_FILE_WRITTEN' };
  }
  const sender = send || (await import('../api/_utils/mailer.js')).sendMail;
  const out = await sender({
    to: email, category: 'pro-mfa-invitation', subject: 'Activer la double authentification — Accès Direct Aide',
    text: `Votre compte d’exploitation de la plateforme Accès Direct Aide a été créé.\nConnectez-vous sur l’espace professionnel avec le mot de passe choisi lors de la création, puis ouvrez ce lien (valable 72 heures, utilisable une fois, uniquement avec votre propre compte) : ${link}\n\nSi vous n’attendiez pas ce message, ne l’utilisez pas et prévenez le responsable de la plateforme.`,
  }).catch(() => ({ outcome: 'NOT_DELIVERED' }));
  const status = String(out?.outcome || 'NOT_DELIVERED');
  return { delivered: status === 'PROVIDER_ACCEPTED' || status === 'TEST_RECORDED', status };
}

const arg = (/** @type {string} */ name, dflt = '') => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt; };
const die = (/** @type {string} */ m) => { console.error(`pro-superadmin-bootstrap : ${m}`); process.exit(1); };

/** @param {any} rl @param {string} q @param {boolean} [hidden] @returns {Promise<string>} */
function ask(rl, q, hidden = false) {
  return new Promise((resolve) => {
    if (!hidden || !process.stdin.isTTY) { rl.question(q, resolve); return; }
    const out = rl.output; const write = out.write.bind(out); let muted = false;
    out.write = (/** @type {string} */ s) => (muted ? (s.includes('\n') ? write('\n') : true) : write(s));
    rl.question(q, (/** @type {string} */ v) => { out.write = write; resolve(v); }); muted = true;
  });
}

async function main() {
  const url = process.env.DATABASE_URL || '';
  const resend = process.argv.includes('resend-invitation');
  const target = planTarget({ url, confirmHost: arg('confirm-host'), confirmDatabase: arg('confirm-database'), confirmNonLab: process.argv.includes('--confirm-non-lab') });
  if (!target.ok) die(target.reason);
  const origin = linkOrigin(process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || '', target.local);
  if (!origin) die('APP_BASE_URL doit être l’adresse https publique du site (http://localhost seulement pour une base locale) : c’est l’adresse du lien d’invitation.');
  const provider = process.env.MAILER_PROVIDER || '';
  let deliverable = false;
  if (!arg('link-file') && DELIVERING.includes(provider.trim().toLowerCase())) deliverable = (await import('../api/_utils/mailer.js')).getMailerStatus().deliverable;
  const delivery = planDelivery({ provider, deliverable, lab: target.lab, linkFile: arg('link-file') });
  if (!delivery.ok) die(delivery.reason);

  const client = new pg.Client({ ...connectionOptions(url), connectionTimeoutMillis: 15000 });
  try { await client.connect(); } catch (e) { die(`connexion impossible à ${target.host} (${/** @type {{ code?: string }} */ (e)?.code || 'erreur'}${target.local ? '' : ' — le certificat TLS de la base doit être valide'}).`); }
  try {
    const exists = (await client.query(`SELECT to_regclass('"ProUser"') IS NOT NULL AND to_regclass('"Invitation"') IS NOT NULL AND to_regclass('"AuditLog"') IS NOT NULL AS ok`)).rows[0].ok;
    if (!exists) die('les tables ProUser / Invitation / AuditLog sont absentes : appliquez d’abord les migrations.');
    console.log(`Base : ${target.host} / ${target.name}${target.lab ? ' (LAB locale)' : target.local ? ' (locale, hors LAB)' : ' (TLS vérifié)'} · comptes SUPERADMIN existants : ${await superadminCount(client)}`);
    let r;
    if (resend) {
      r = await resendBootstrapInvitation(client, { host: target.host, database: target.name, channel: delivery.channel });
      if (!r.ok) die(r.reason);
    } else {
      if (await superadminCount(client) > 0) die('un compte SUPERADMIN existe déjà : l’amorçage ne sert qu’au premier. Les suivants sont invités depuis l’application.');
      const piped = process.stdin.isTTY ? null : (await new Promise((res) => { let d = ''; process.stdin.on('data', (c) => { d += c; }); process.stdin.on('end', () => res(d.split('\n'))); }));
      const rl = piped ? { question: (/** @type {string} */ _q, /** @type {(v: string) => void} */ cb) => cb(String(/** @type {string[]} */ (piped).shift() ?? '').replace(/\r$/, '')), close: () => {}, output: process.stdout }
        : readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
      const email = String(arg('email') || await ask(rl, 'Adresse e-mail nominative du titulaire : ')).trim().toLowerCase();
      const name = String(arg('name') || await ask(rl, 'Nom et prénom de la personne titulaire du compte : ')).trim().replace(/\s+/g, ' ');
      const attest = process.argv.includes('--attest-one-account') ? 'oui'
        : String(await ask(rl, 'Cette personne n’a-t-elle aucun autre compte professionnel (une personne = un compte) ? [oui/non] : ')).trim().toLowerCase();
      const bad = validateIdentity({ email, name, attest });
      if (bad) { rl.close(); die(bad); }
      const p1 = await ask(rl, `Mot de passe (${MIN_PASSWORD} caractères minimum, majuscule, minuscule, chiffre ; non affiché) : `, true);
      const p2 = await ask(rl, 'Répétez le mot de passe : ', true);
      rl.close();
      if (p1 !== p2) die('les deux saisies diffèrent.');
      const weak = validatePassword(p1);
      if (weak) die(weak);
      r = await createFirstSuperadmin(client, { email, name, passwordHash: await hashPassword(p1), host: target.host, database: target.name, channel: delivery.channel });
      if (!r.ok) die(r.reason);
    }
    const to = 'email' in r ? r.email : String(arg('email')).trim().toLowerCase();
    const sent = await deliverInvitation({ channel: delivery.channel, email: to, link: invitationLink(origin, r.token), linkFile: arg('link-file') });
    console.log(`Compte SUPERADMIN ${resend ? 'existant' : 'créé'} (sans double authentification). Invitation d’activation valable jusqu’au ${r.expiresAt.toISOString()} : ${
      delivery.channel === 'link-file' ? 'lien écrit dans le fichier indiqué (droits 0600) — remettez-le à la personne titulaire, puis supprimez le fichier' : `e-mail ${sent.status}`}.`);
    if (!sent.delivered) die('le lien n’a pas été remis : relancez avec « resend-invitation » une fois le fournisseur d’e-mail corrigé (ou --link-file).');
    console.log('Étapes : connexion sur /pro/login avec le mot de passe, ouverture du lien, enrôlement de l’application d’authentification. Sans cela, le compte n’ouvre aucune route professionnelle en Production.');
  } finally { await client.end().catch(() => {}); }
}

if (process.argv[1] && isMainModule(import.meta.url)) main().catch((e) => die(e?.code ? `erreur ${e.code}` : 'erreur inattendue (aucune donnée affichée).'));
