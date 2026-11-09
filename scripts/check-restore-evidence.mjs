#!/usr/bin/env node
/**
 * V2 C7 — checks a restore-verification evidence record (the JSON that scripts/cloud-restore-verify.mjs prints and sends as its Healthchecks.io
 * ping body). The verifier job's container is ephemeral: the durable copy is the Healthchecks log entry (and the job log), which the operator saves
 * as CONTROL/v2/c7/EVIDENCE_<date>.json. This script needs no credential and touches no database or bucket.
 *
 *   node scripts/check-restore-evidence.mjs <evidence.json>
 *
 * Accepted only when: ok, wiped, migration history equal to the expected count, sidecar + object digest + producer signatures checked, core tables present, erasure ledger
 * replayed (dry run). Privacy: only the known fields are allowed (counts, codes, digests, object names); anything else is refused, so a record that
 * carried row content or a credential fails. The record's own SHA-256 is printed so the stored file can be cited.
 * Independent cross-checks for the owner (no secret needed): `dump` and `encryptedBytes` against the object list in the Cloudflare R2 console,
 * `dumpSha256` against the `<dump>.sha256` sidecar object, and `verifiedAt` against the Healthchecks.io event time and the Scaleway job-run history.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { objectTime } from './lib/backup-bucket.mjs';
import { isMainModule } from './lib/is-main.mjs';

const TOP = new Set(['kind', 'ok', 'failures', 'verifiedAt', 'dump', 'backupTakenAt', 'backupAgeHours', 'encryptedBytes', 'dumpSha256', 'restoredTables', 'checks',
  'erasureReplay', 'seconds', 'wiped', 'code', 'stage', 'problems', 'attestation', 'evidenceStored']);
const CHECKS = new Set(['sidecar', 'objectDigest', 'signatures', 'coreTablesMissing', 'migrationRows', 'expectedMigrations', 'journalEntries', 'migrationsMatch', 'migrationsPlausible', 'ledger']);
const REPLAY = new Set(['mode', 'ledgerEntries', 'presentAgain', 'holdsMissing']);
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const isCount = (v) => Number.isInteger(v) && v >= 0;

/** @returns {{ accepted: boolean, problems: string[], summary: Record<string, unknown> }} */
export function checkEvidence(ev) {
  const problems = [];
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return { accepted: false, problems: ['NOT_AN_OBJECT'], summary: {} };
  for (const k of Object.keys(ev)) if (!TOP.has(k)) problems.push(`UNKNOWN_FIELD:${k.slice(0, 40)}`);
  if (ev.checks && typeof ev.checks === 'object') for (const k of Object.keys(ev.checks)) if (!CHECKS.has(k)) problems.push(`UNKNOWN_FIELD:checks.${k.slice(0, 40)}`);
  if (ev.erasureReplay && typeof ev.erasureReplay === 'object') for (const k of Object.keys(ev.erasureReplay)) if (!REPLAY.has(k)) problems.push(`UNKNOWN_FIELD:erasureReplay.${k.slice(0, 40)}`);
  if (ev.kind !== 'ada-restore-verification') problems.push('KIND');
  if (ev.ok !== true) problems.push(ev.code && CODE.test(ev.code) ? `NOT_OK:${ev.code}` : 'NOT_OK');
  if (Array.isArray(ev.failures)) { for (const f of ev.failures) if (typeof f !== 'string' || !CODE.test(f)) problems.push('FAILURE_CODE_FORMAT'); if (ev.failures.length) problems.push('FAILURES_PRESENT'); }
  else if (ev.ok === true) problems.push('FAILURES_MISSING');
  if (ev.wiped !== true) problems.push('NOT_WIPED');
  if (typeof ev.verifiedAt !== 'string' || Number.isNaN(Date.parse(ev.verifiedAt))) problems.push('VERIFIED_AT');
  if (typeof ev.dump !== 'string' || !/^[A-Za-z0-9/_.-]{1,200}$/.test(ev.dump) || objectTime(ev.dump).kind !== 'dump') problems.push('DUMP_NAME');
  if (typeof ev.dumpSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(ev.dumpSha256)) problems.push('DUMP_SHA256');
  if (!isCount(ev.encryptedBytes) || ev.encryptedBytes === 0) problems.push('ENCRYPTED_BYTES');
  if (!isCount(ev.restoredTables) || ev.restoredTables === 0) problems.push('RESTORED_TABLES');
  const c = ev.checks || {};
  if (c.sidecar !== true) problems.push('SIDECAR_NOT_CHECKED');
  if (c.objectDigest !== true) problems.push('OBJECT_DIGEST_NOT_CHECKED');
  if (c.signatures !== true) problems.push('SIGNATURES_NOT_CHECKED');
  // what the record says was verified cryptographically, versus measured or merely read from the signed name (cloud-restore-verify.mjs ATTESTATION)
  const att = ev.attestation;
  const verified = Array.isArray(att?.verified) ? att.verified : [];
  if (!['dumpSha256', 'dumpSignature', 'ledgerSignature', 'gcmTag'].every((x) => verified.includes(x))) problems.push('ATTESTATION_MISSING');
  if (att && typeof att === 'object') for (const k of Object.keys(att)) if (!['verified', 'measured', 'fromSignedName', 'notProven'].includes(k)) problems.push(`UNKNOWN_FIELD:attestation.${k.slice(0, 40)}`);
  if (ev.evidenceStored !== undefined && ev.evidenceStored !== null && !/^evidence\/ada_restore_evidence_\d{8}T\d{9}Z_[0-9a-f]{8}_(ok|fail)\.json$/.test(String(ev.evidenceStored))) problems.push('EVIDENCE_KEY_FORMAT');
  if (!Array.isArray(c.coreTablesMissing) || c.coreTablesMissing.length) problems.push('CORE_TABLES');
  if (c.migrationsMatch !== true || !isCount(c.expectedMigrations) || c.migrationRows !== c.expectedMigrations) problems.push('MIGRATIONS_NOT_MATCHED');
  if (c.ledger !== true) problems.push('LEDGER_MISSING');
  const r = ev.erasureReplay;
  if (!r || r.mode !== 'dry-run' || !isCount(r.ledgerEntries) || !isCount(r.presentAgain) || !isCount(r.holdsMissing)) problems.push('ERASURE_REPLAY');
  const summary = { verifiedAt: ev.verifiedAt ?? null, dump: ev.dump ?? null, dumpSha256: ev.dumpSha256 ?? null, encryptedBytes: ev.encryptedBytes ?? null,
    restoredTables: ev.restoredTables ?? null, migrations: c.migrationRows ?? null, expectedMigrations: c.expectedMigrations ?? null,
    erasedPeoplePresentAgain: r?.presentAgain ?? null, legalHoldsMissing: r?.holdsMissing ?? null, wiped: ev.wiped ?? null, seconds: ev.seconds ?? null,
    cryptographicallyVerified: verified, measured: Array.isArray(att?.measured) ? att.measured : [], fromSignedName: Array.isArray(att?.fromSignedName) ? att.fromSignedName : [],
    notProven: Array.isArray(att?.notProven) ? att.notProven : [], storedAt: ev.evidenceStored ?? null };
  return { accepted: problems.length === 0, problems, summary };
}

if (isMainModule(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.log(JSON.stringify({ accepted: false, problems: ['USAGE: node scripts/check-restore-evidence.mjs <evidence.json>'] })); process.exit(2); }
  const raw = fs.readFileSync(file);
  let ev; try { ev = JSON.parse(raw.toString('utf8')); } catch { console.log(JSON.stringify({ accepted: false, problems: ['NOT_JSON'] })); process.exit(1); }
  const out = checkEvidence(ev);
  console.log(JSON.stringify({ ...out, fileSha256: crypto.createHash('sha256').update(raw).digest('hex') }, null, 2));
  process.exitCode = out.accepted ? 0 : 1;
}
