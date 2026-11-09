#!/usr/bin/env node
/**
 * R44 / E15 — replay of the ERASURES after a restore. A backup taken at time T brings back every person erased after T; the restored database must not
 * keep them. The list to replay is the erasure ledger: the completed DELETE rights requests (DSRRequest requestType DELETE, status COMPLETED — the same
 * rows AuditLog DSR_DELETE_COMPLETED records), exported next to each backup, encrypted with the backup key, rotated with the backups.
 *
 *   BACKUP_ENCRYPTION_KEY=<64 hex> DATABASE_URL=<live> node scripts/db-erasure-replay.mjs --export --out <directory>
 *       → ada_erasures_<date>.json.enc (0600): request id, subject id, completion date, domains — no name, no e-mail, no content
 *   BACKUP_ENCRYPTION_KEY=… TARGET_DATABASE_URL=<restored> node scripts/db-erasure-replay.mjs --ledger <file.json.enc> (--since <backup time ISO> | --since-backup <file.dump.enc>)
 *       --confirm-target <host>/<database>                       DRY RUN (default): which erased people the restored database holds again
 *   … npx tsx scripts/db-erasure-replay.mjs … --execute         replays them through the application's DSR erasure engine (api/_services/privacy.js
 *       deleteDataDomains: same domains, same legal-hold refusal, same audit), then records the erasure request again in the restored database
 * After the replay, run the retention purge again (its steps are idempotent and count from the data, so it re-applies what it had already done).
 * Guards: the target is typed again (--confirm-target), never DATABASE_URL; nothing is changed without --execute. Output: counts only.
 *
 * R45 (restore rehearsal, ENG-LR-7) — ledger version 2. A DSR erasure is not the only thing a restore of an OLDER backup undoes:
 *   - messageWithdrawals: a booking message the person withdrew (ConsentLog BOOKING_MESSAGE_TRANSMISSION decision false — the appointment id is the
 *     last « : » part of policy_hash, rdv-message-consent.js) comes back with the backup → replayed: notes = NULL on THAT person's appointment, and the
 *     withdrawal row recorded again (same policy_version / policy_hash, channel « restore-replay »);
 *   - protections: an ACTIVE legal hold, an ACTIVE restriction (art. 18, DSRRequest RESTRICT) or an open access / review request created after the backup
 *     is missing from it → reinstated FIRST (before any erasure is replayed and before the purge runs again), so nothing protected is erased or purged.
 * `--since-backup <file.dump.enc>` takes the backup time from the backup's own name (scripts/db-backup.mjs) instead of a typed date; a ledger exported
 * BEFORE that time is refused (it cannot know what happened after the backup: export the newest one). Version 1 ledgers are still read (erasures only).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import pg from 'pg';
import { backupKey, backupPublicKey, backupTimeOf, decryptionKeyFor, encryptStreamToFile, decryptFileToFile } from './db-backup.mjs';
import { isMainModule } from './lib/is-main.mjs';

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

/** the purpose of the booking-message consent (api/_utils/rdv-message.js BOOKING_MESSAGE_CONSENT_PURPOSE; a unit test keeps them equal) */
export const MESSAGE_PURPOSE = 'BOOKING_MESSAGE_TRANSMISSION';
/** open non-erasure request statuses (api/_handlers/cron/gdpr-purge.js OPEN_DSR_STATUSES; a unit test keeps them equal) */
export const OPEN_REQUEST_STATUSES = Object.freeze(['RECEIVED', 'IDENTITY_OR_AUTHORITY_CHECK', 'IN_REVIEW']);

/** R45: the withdrawn booking messages, oldest first (subject, appointment, time — never the message) @param {{ query: Function }} client */
export async function readMessageWithdrawals(client) {
  const { rows } = await client.query(`SELECT subject_id, policy_version, policy_hash, COALESCE(withdrawn_at, created_at) AS at FROM "ConsentLog"
    WHERE purpose = $1 AND decision = false ORDER BY COALESCE(withdrawn_at, created_at), id`, [MESSAGE_PURPOSE]);
  return rows.map((r) => ({ subjectId: String(r.subject_id), appointmentId: String(r.policy_hash || '').split(':').at(-1) || '', policyVersion: String(r.policy_version),
    policyHash: String(r.policy_hash), withdrawnAt: new Date(r.at).toISOString() })).filter((w) => w.appointmentId.length > 0);
}

/** R45: what protects data right now — ACTIVE legal holds; ACTIVE restrictions and open access / review requests @param {{ query: Function }} client */
export async function readProtections(client) {
  const holds = (await client.query(`SELECT id, "dataCategory", "recordId", "reasonCode", "createdBy", "createdAt" FROM "LegalHold" WHERE status = 'ACTIVE' ORDER BY "createdAt", id`)).rows;
  const requests = (await client.query(`SELECT id, "subjectType", "subjectId", "requestType", status, "executionMode", "affectedDomains", "reasonCode", "createdAt" FROM "DSRRequest"
    WHERE ("requestType" = 'RESTRICT' AND status = 'ACTIVE') OR ("requestType" <> 'DELETE' AND status = ANY($1::text[])) ORDER BY "createdAt", id`, [OPEN_REQUEST_STATUSES])).rows;
  return {
    legalHolds: holds.map((h) => ({ id: String(h.id), dataCategory: String(h.dataCategory), recordId: String(h.recordId), reasonCode: String(h.reasonCode), createdBy: String(h.createdBy), createdAt: new Date(h.createdAt).toISOString() })),
    requests: requests.map((r) => ({ id: String(r.id), subjectType: String(r.subjectType), subjectId: String(r.subjectId), requestType: String(r.requestType), status: String(r.status),
      executionMode: String(r.executionMode), affectedDomains: Array.isArray(r.affectedDomains) ? r.affectedDomains.map(String) : [], reasonCode: r.reasonCode === null ? null : String(r.reasonCode),
      createdAt: new Date(r.createdAt).toISOString() })),
  };
}

/**
 * @param {{ requestId: string, subjectId: string, completedAt: string, domains: string[] }[]} entries @param {Date} [now]
 * @param {{ messageWithdrawals?: any[], protections?: { legalHolds: any[], requests: any[] } }} [extra] R45: ledger v2 sections
 */
export const ledgerOf = (entries, now = new Date(), extra = {}) => ({ kind: LEDGER_KIND, version: 2, exportedAt: now.toISOString(), entries,
  messageWithdrawals: extra.messageWithdrawals ?? [], protections: extra.protections ?? { legalHolds: [], requests: [] } });

/**
 * R45: everything to replay after restoring a backup taken at `since`: erasures and withdrawals done at or after it; ALL current protections (re-inserting
 * one already present changes nothing). Refuses a ledger exported before the backup. @param {any} ledger @param {string | Date | null} [since]
 */
export function replayPlan(ledger, since = null) {
  const entries = entriesSince(ledger, since);
  const t = since ? new Date(since).getTime() : null;
  if (t !== null && new Date(ledger.exportedAt).getTime() < t) throw new Error('ledger exported before the backup: export the newest ledger');
  const withdrawals = (Array.isArray(ledger.messageWithdrawals) ? ledger.messageWithdrawals : []).filter((w) => t === null || new Date(w.withdrawnAt).getTime() >= t);
  const p = ledger.protections && typeof ledger.protections === 'object' ? ledger.protections : {};
  return { entries, withdrawals, protections: { legalHolds: Array.isArray(p.legalHolds) ? p.legalHolds : [], requests: Array.isArray(p.requests) ? p.requests : [] } };
}

/** the entries completed at or after the backup time (all when no time is given) @param {any} ledger @param {string | Date | null} [since] */
export function entriesSince(ledger, since = null) {
  if (!ledger || ledger.kind !== LEDGER_KIND || !Array.isArray(ledger.entries)) throw new Error('not an erasure ledger');
  if (!since) return ledger.entries;
  const t = new Date(since).getTime();
  if (!Number.isFinite(t)) throw new Error('invalid --since date');
  return ledger.entries.filter((e) => new Date(e.completedAt).getTime() >= t);
}

/** @param {any} ledger @param {string} file @param {Buffer | import('node:crypto').KeyObject} key ADAB1 key, or (V2 cloud backups) the RSA public key → ADAB2 */
export async function writeLedgerFile(ledger, file, key) {
  await encryptStreamToFile(Readable.from([Buffer.from(JSON.stringify(ledger), 'utf8')]), file, key);
  fs.chmodSync(file, 0o600);
}
/** @param {string} file @param {Buffer | import('node:crypto').KeyObject} key */
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

/** R45: which withdrawn messages the target holds again (the appointment of that person still has a message) @param {{ query: Function }} client @param {any[]} list */
export async function inspectWithdrawals(client, list) {
  const out = [];
  for (const w of list) {
    const { rows: [r] } = await client.query(`SELECT count(*)::int AS n FROM "ProAppointment" WHERE id = $1 AND "citizenUserId" = $2 AND notes IS NOT NULL`, [w.appointmentId, w.subjectId]);
    out.push({ ...w, present: Number(r.n) > 0 });
  }
  return out;
}

/** R45: which protections the target lacks (a hold not ACTIVE there, a request missing or in another status) @param {{ query: Function }} client @param {{ legalHolds: any[], requests: any[] }} p */
export async function inspectProtections(client, p) {
  const holds = []; const requests = [];
  for (const h of p.legalHolds) {
    const { rows: [r] } = await client.query(`SELECT status FROM "LegalHold" WHERE id = $1`, [h.id]);
    holds.push({ ...h, state: !r ? 'missing' : (r.status === 'ACTIVE' ? 'present' : 'not_active') });
  }
  for (const q of p.requests) {
    const { rows: [r] } = await client.query(`SELECT status FROM "DSRRequest" WHERE id = $1`, [q.id]);
    requests.push({ ...q, state: !r ? 'missing' : (r.status === q.status ? 'present' : 'other_status') });
  }
  return { legalHolds: holds, requests };
}

export const reinstateHoldSql = `INSERT INTO "LegalHold" (id, "dataCategory", "recordId", "reasonCode", "createdBy", status, "createdAt") VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6)
  ON CONFLICT (id) DO NOTHING`;
export const reinstateRequestSql = `INSERT INTO "DSRRequest" (id, "subjectType", "subjectId", "requestType", status, "executionMode", "affectedDomains", "reasonCode", "createdAt")
  VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status WHERE "DSRRequest".status IN ('RECEIVED', 'IDENTITY_OR_AUTHORITY_CHECK', 'IN_REVIEW', 'APPROVED', 'ACTIVE')`;

/**
 * R45: reinstates the missing protections. A hold present but not ACTIVE in the restored copy is counted for a human decision (never re-activated blindly:
 * its release after the backup is not in the ledger, its release before the backup would be overridden). Idempotent.
 * @param {{ inspected: { legalHolds: any[], requests: any[] }, query: (sql: string, params: any[]) => Promise<{ rowCount?: number | null }> }} deps
 */
export async function reinstateProtections({ inspected, query }) {
  const out = { holdsReinstated: 0, holdsPresent: 0, holdsNotActiveForReview: 0, requestsReinstated: 0, requestsPresent: 0, failed: 0 };
  for (const h of inspected.legalHolds) {
    if (h.state === 'present') { out.holdsPresent += 1; continue; }
    if (h.state === 'not_active') { out.holdsNotActiveForReview += 1; continue; }
    try { await query(reinstateHoldSql, [h.id, h.dataCategory, h.recordId, h.reasonCode, h.createdBy, h.createdAt]); out.holdsReinstated += 1; } catch { out.failed += 1; }
  }
  for (const q of inspected.requests) {
    if (q.state === 'present') { out.requestsPresent += 1; continue; }
    try {
      await query(reinstateRequestSql, [q.id, q.subjectType, q.subjectId, q.requestType, q.status, q.executionMode, JSON.stringify(q.affectedDomains), q.reasonCode, q.createdAt]);
      out.requestsReinstated += 1;
    } catch { out.failed += 1; }
  }
  return out;
}

export const eraseMessageSql = `UPDATE "ProAppointment" SET notes = NULL WHERE id = $1 AND "citizenUserId" = $2 AND notes IS NOT NULL`;
export const recordWithdrawalSql = `INSERT INTO "ConsentLog" (id, policy_version, policy_hash, subject_type, subject_id, purpose, decision, withdrawn_at, created_at, collection_channel, guardian_involved, proof_level)
  SELECT $1, $2, $3, 'CITIZEN_USER', $4, $5, false, $6, $6, 'restore-replay', false, 'EXPLICIT_CHECKBOX'
  WHERE NOT EXISTS (SELECT 1 FROM "ConsentLog" c WHERE c.subject_id = $4 AND c.policy_hash = $3 AND c.decision = false)`;

/**
 * R45: replays the message withdrawals the target holds again: the message erased (same compare-and-set as rdv-message-consent.js), the withdrawal recorded
 * again. Absent ones are counted. @param {{ inspected: any[], query: (sql: string, params: any[]) => Promise<{ rowCount?: number | null }>, newId?: () => string }} deps
 */
export async function replayWithdrawals({ inspected, query, newId = () => crypto.randomUUID() }) {
  const out = { messagesErased: 0, absent: 0, failed: 0 };
  for (const w of inspected) {
    if (!w.present) { out.absent += 1; continue; }
    try {
      const r = await query(eraseMessageSql, [w.appointmentId, w.subjectId]);
      await query(recordWithdrawalSql, [newId(), w.policyVersion, w.policyHash, w.subjectId, MESSAGE_PURPOSE, w.withdrawnAt]);
      if (Number(r?.rowCount ?? 0) > 0) out.messagesErased += 1; else out.absent += 1;
    } catch { out.failed += 1; }
  }
  return out;
}

/** the erasure request, recorded again in the restored database (proof of the erasure; the retention purge counts consents from it, E10) */
export const recordRequestSql = `INSERT INTO "DSRRequest" (id, "subjectType", "subjectId", "requestType", status, "executionMode", "affectedDomains", "createdAt", "completedAt", "reasonCode")
  VALUES ($1, 'CITIZEN_USER', $2, 'DELETE', 'COMPLETED', 'HUMAN_REVIEW_REQUIRED', $3::jsonb, $4, $4, 'REPLAYED_AFTER_RESTORE')
  ON CONFLICT (id) DO UPDATE SET status = 'COMPLETED', "completedAt" = EXCLUDED."completedAt"`;

/** host/database of a connection string, without credentials */
const targetName = (url) => { try { const u = new URL(url); return `${u.hostname}/${decodeURIComponent(u.pathname.replace(/^\//, ''))}`.toLowerCase(); } catch { return ''; } };

async function exportMain() {
  const url = process.env.DATABASE_URL || die('DATABASE_URL absente.');
  // V2 cloud backups: with BACKUP_PUBLIC_KEY the ledger is ADAB2, like the dump — the backup worker can write it but never read it back
  const key = (() => { try { return process.env.BACKUP_PUBLIC_KEY ? backupPublicKey() : backupKey(); } catch (e) { return die(e.message); } })();
  const outDir = arg('out') || die('indiquez --out <dossier>.');
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const c = new pg.Client({ connectionString: url }); await c.connect();
  let entries; let messageWithdrawals; let protections;
  try { entries = await readErasures(c); messageWithdrawals = await readMessageWithdrawals(c); protections = await readProtections(c); } finally { await c.end(); }
  const file = path.join(outDir, `ada_erasures_${stamp()}.json.enc`);
  await writeLedgerFile(ledgerOf(entries, new Date(), { messageWithdrawals, protections }), file, key);
  console.log(JSON.stringify({ file, erasures: entries.length, messageWithdrawals: messageWithdrawals.length, legalHolds: protections.legalHolds.length, protectiveRequests: protections.requests.length }));
}

async function replayMain() {
  const url = process.env.TARGET_DATABASE_URL || die('TARGET_DATABASE_URL absente (la cible est toujours explicite).');
  const want = targetName(url);
  if (String(arg('confirm-target')).toLowerCase() !== want) die(`indiquez --confirm-target ${want} (rien n’est rejoué).`);
  const ledgerFile = arg('ledger') || die('indiquez --ledger <fichier>.');
  if (!fs.existsSync(ledgerFile)) die('registre introuvable.');
  const key = (() => { try { return decryptionKeyFor(ledgerFile); } catch (e) { return die(e.message); } })();   // ADAB1 key or (ADAB2) the private key
  const ledger = await readLedgerFile(ledgerFile, key).catch(() => die('registre illisible (clé différente ou fichier modifié).'));
  let since = arg('since') || null;
  if (arg('since-backup')) { since = backupTimeOf(arg('since-backup')); if (!since) die('--since-backup : le nom du fichier ne porte pas la date de la sauvegarde (ada_<label>_AAAAMMJJTHHMMSSZ.dump.enc).'); }
  let plan;
  try { plan = replayPlan(ledger, since); } catch (e) { return die(`${/** @type {Error} */ (e).message} (rien n’est rejoué).`); }
  const { entries } = plan;
  const execute = process.argv.includes('--execute');
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    const inspected = await inspectTarget(pool, entries);
    const present = inspected.filter((e) => e.present).length;
    const prot = await inspectProtections(pool, plan.protections);
    const withdrawals = await inspectWithdrawals(pool, plan.withdrawals);
    const summary = { ledgerVersion: ledger.version ?? 1, since, ledgerEntries: entries.length, presentAgain: present, withdrawalsSince: withdrawals.length,
      messagesPresentAgain: withdrawals.filter((w) => w.present).length, holdsMissing: prot.legalHolds.filter((h) => h.state === 'missing').length,
      holdsNotActive: prot.legalHolds.filter((h) => h.state === 'not_active').length, requestsMissing: prot.requests.filter((q) => q.state !== 'present').length };
    if (!execute) { console.log(JSON.stringify({ mode: 'dry-run', ...summary })); return; }
    const query = (/** @type {string} */ q, /** @type {any[]} */ p) => pool.query(q, p);
    const protections = await reinstateProtections({ inspected: prot, query });   // FIRST: what protects data is back before anything is erased
    const [{ drizzle }, schema, { createPrivacyRightsService }] = await Promise.all([import('drizzle-orm/node-postgres'), import('../src/db/schema.js'), import('../api/_services/privacy.js')]);
    const privacy = createPrivacyRightsService({ db: drizzle(pool, { schema }), cryptoLib: crypto });
    const out = await replayErasures({ entries: inspected, privacy, recordRequest: (e) => pool.query(recordRequestSql, [e.requestId, e.subjectId, JSON.stringify(e.domains), e.completedAt]) });
    const messages = await replayWithdrawals({ inspected: withdrawals, query });
    console.log(JSON.stringify({ mode: 'execute', ...summary, ...out, protections, messages }));
    if (out.failed > 0 || protections.failed > 0 || messages.failed > 0) process.exitCode = 1;
  } finally { await pool.end(); }
}

if (isMainModule(import.meta.url)) {
  (process.argv.includes('--export') ? exportMain() : replayMain()).catch(() => die('erreur inattendue (aucune donnée affichée).'));
}
