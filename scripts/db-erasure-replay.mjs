#!/usr/bin/env node
/**
 * R44 / E15 — replay of the ERASURES after a restore. A backup taken at time T brings back every person erased after T; the restored database must not
 * keep them. The list to replay is the erasure ledger: the completed DELETE rights requests (DSRRequest requestType DELETE, status COMPLETED — the same
 * rows AuditLog DSR_DELETE_COMPLETED records), exported next to each backup, encrypted with the backup key, rotated with the backups.
 *
 *   BACKUP_ENCRYPTION_KEY=<64 hex> DATABASE_URL=<live> node scripts/db-erasure-replay.mjs --export --out <directory>
 *       → ada_erasures_<date>.json.enc (0600): request id, subject id, completion date, domains — no name, no e-mail, no content
 *   BACKUP_ENCRYPTION_KEY=… TARGET_DATABASE_URL=<restored> node scripts/db-erasure-replay.mjs --ledger <file.json.enc> --since <backup time ISO>
 *       --confirm-target <host>/<database>                       DRY RUN (default): which erased people the restored database holds again
 *   … npx tsx scripts/db-erasure-replay.mjs … --execute         replays them through the application's DSR erasure engine (api/_services/privacy.js
 *       deleteDataDomains: same domains, same legal-hold refusal, same audit), then records the erasure request again in the restored database
 * After the replay, run the retention purge again (its steps are idempotent and count from the data, so it re-applies what it had already done).
 * Guards: the target is typed again (--confirm-target), never DATABASE_URL; nothing is changed without --execute. Output: counts only.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import pg from 'pg';
import { backupKey, encryptStreamToFile, decryptFileToFile } from './db-backup.mjs';

export const LEDGER_KIND = 'ada-erasure-ledger';
const die = (m) => { console.error(`db-erasure-replay : ${m}`); process.exit(1); };
const arg = (name, dflt = '') => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt; };
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/** the completed erasures of a database, oldest first @param {{ query: (q: string) => Promise<{ rows: any[] }> }} client */
export async function readErasures(client) {
  const { rows } = await client.query(`SELECT id, "subjectId", "completedAt", "affectedDomains" FROM "DSRRequest"
    WHERE "requestType" = 'DELETE' AND status = 'COMPLETED' AND "completedAt" IS NOT NULL ORDER BY "completedAt", id`);
  return rows.map((r) => ({ requestId: String(r.id), subjectId: String(r.subjectId), completedAt: new Date(r.completedAt).toISOString(),
    domains: Array.isArray(r.affectedDomains) ? r.affectedDomains.map(String) : [] }));
}

/** @param {{ requestId: string, subjectId: string, completedAt: string, domains: string[] }[]} entries @param {Date} [now] */
export const ledgerOf = (entries, now = new Date()) => ({ kind: LEDGER_KIND, version: 1, exportedAt: now.toISOString(), entries });

/** the entries completed at or after the backup time (all when no time is given) @param {any} ledger @param {string | Date | null} [since] */
export function entriesSince(ledger, since = null) {
  if (!ledger || ledger.kind !== LEDGER_KIND || !Array.isArray(ledger.entries)) throw new Error('not an erasure ledger');
  if (!since) return ledger.entries;
  const t = new Date(since).getTime();
  if (!Number.isFinite(t)) throw new Error('invalid --since date');
  return ledger.entries.filter((e) => new Date(e.completedAt).getTime() >= t);
}

/** @param {any} ledger @param {string} file @param {Buffer} key */
export async function writeLedgerFile(ledger, file, key) {
  await encryptStreamToFile(Readable.from([Buffer.from(JSON.stringify(ledger), 'utf8')]), file, key);
  fs.chmodSync(file, 0o600);
}
/** @param {string} file @param {Buffer} key */
export async function readLedgerFile(file, key) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-ledger-'));
  try {
    const out = path.join(tmp, 'ledger.json');
    await decryptFileToFile(file, out, key);
    return JSON.parse(fs.readFileSync(out, 'utf8'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/** which ledger subjects the target database holds again (account, appointments, conversations, dossiers) @param {{ query: Function }} client @param {any[]} entries */
export async function inspectTarget(client, entries) {
  const out = [];
  for (const e of entries) {
    const { rows: [r] } = await client.query(`SELECT
      (SELECT count(*)::int FROM "CitizenUser" WHERE id = $1) AS account,
      (SELECT count(*)::int FROM "ProAppointment" WHERE "citizenUserId" = $1) AS appointments,
      (SELECT count(*)::int FROM "RdvConversation" WHERE "citizenUserId" = $1) AS conversations,
      (SELECT count(*)::int FROM "SharedDiagnostic" WHERE "ownerCitizenId" = $1 OR "privacySubjectId" = $1) AS dossiers`, [e.subjectId]);
    out.push({ ...e, present: Number(r.account) + Number(r.appointments) + Number(r.conversations) + Number(r.dossiers) > 0 });
  }
  return out;
}

/**
 * Replays the erasures of the subjects present in the target, through the DSR engine. Idempotent: an absent subject is reported, never an error.
 * @param {{ entries: any[], privacy: { deleteDataDomains: Function }, recordRequest: (e: any) => Promise<unknown> }} deps
 */
export async function replayErasures({ entries, privacy, recordRequest }) {
  const result = { replayed: 0, absent: 0, blockedLegalHold: 0, noDomains: 0, failed: 0 };
  for (const e of entries) {
    if (!e.present) { result.absent += 1; continue; }
    if (!e.domains.length) { result.noDomains += 1; continue; }
    try {
      await privacy.deleteDataDomains(e.subjectId, e.domains, { requestId: e.requestId });
      await recordRequest(e);
      result.replayed += 1;
    } catch (error) {
      const code = /** @type {any} */ (error)?.code;
      if (code === 'SUBJECT_NOT_FOUND') { await recordRequest(e); result.absent += 1; }
      else if (code === 'LEGAL_HOLD_ACTIVE') result.blockedLegalHold += 1;
      else result.failed += 1;
    }
  }
  return result;
}

/** the erasure request, recorded again in the restored database (proof of the erasure; the retention purge counts consents from it, E10) */
export const recordRequestSql = `INSERT INTO "DSRRequest" (id, "subjectType", "subjectId", "requestType", status, "executionMode", "affectedDomains", "createdAt", "completedAt", "reasonCode")
  VALUES ($1, 'CITIZEN_USER', $2, 'DELETE', 'COMPLETED', 'HUMAN_REVIEW_REQUIRED', $3::jsonb, $4, $4, 'REPLAYED_AFTER_RESTORE')
  ON CONFLICT (id) DO UPDATE SET status = 'COMPLETED', "completedAt" = EXCLUDED."completedAt"`;

/** host/database of a connection string, without credentials */
const targetName = (url) => { try { const u = new URL(url); return `${u.hostname}/${decodeURIComponent(u.pathname.replace(/^\//, ''))}`.toLowerCase(); } catch { return ''; } };

async function exportMain() {
  const url = process.env.DATABASE_URL || die('DATABASE_URL absente.');
  const key = (() => { try { return backupKey(); } catch (e) { return die(e.message); } })();
  const outDir = arg('out') || die('indiquez --out <dossier>.');
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const c = new pg.Client({ connectionString: url }); await c.connect();
  let entries;
  try { entries = await readErasures(c); } finally { await c.end(); }
  const file = path.join(outDir, `ada_erasures_${stamp()}.json.enc`);
  await writeLedgerFile(ledgerOf(entries), file, key);
  console.log(JSON.stringify({ file, erasures: entries.length }));
}

async function replayMain() {
  const url = process.env.TARGET_DATABASE_URL || die('TARGET_DATABASE_URL absente (la cible est toujours explicite).');
  const want = targetName(url);
  if (String(arg('confirm-target')).toLowerCase() !== want) die(`indiquez --confirm-target ${want} (rien n’est rejoué).`);
  const key = (() => { try { return backupKey(); } catch (e) { return die(e.message); } })();
  const ledger = await readLedgerFile(arg('ledger') || die('indiquez --ledger <fichier>.'), key).catch(() => die('registre illisible (clé différente ou fichier modifié).'));
  const entries = entriesSince(ledger, arg('since') || null);
  const execute = process.argv.includes('--execute');
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    const inspected = await inspectTarget(pool, entries);
    const present = inspected.filter((e) => e.present).length;
    if (!execute) { console.log(JSON.stringify({ mode: 'dry-run', ledgerEntries: entries.length, presentAgain: present })); return; }
    const [{ drizzle }, schema, { createPrivacyRightsService }] = await Promise.all([import('drizzle-orm/node-postgres'), import('../src/db/schema.js'), import('../api/_services/privacy.js')]);
    const privacy = createPrivacyRightsService({ db: drizzle(pool, { schema }), cryptoLib: crypto });
    const out = await replayErasures({ entries: inspected, privacy, recordRequest: (e) => pool.query(recordRequestSql, [e.requestId, e.subjectId, JSON.stringify(e.domains), e.completedAt]) });
    console.log(JSON.stringify({ mode: 'execute', ledgerEntries: entries.length, presentAgain: present, ...out }));
    if (out.failed > 0) process.exitCode = 1;
  } finally { await pool.end(); }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  (process.argv.includes('--export') ? exportMain() : replayMain()).catch(() => die('erreur inattendue (aucune donnée affichée).'));
}
