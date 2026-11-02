#!/usr/bin/env node
/**
 * R36 — owner command: the bounded import of the FINESS authorized activities into the records made from FINESS (scripts/lib/finess-activities.mjs says
 * exactly what it may and may not change). It replaces the R35 finess-services-refresh.mjs, which ran the whole verification chain.
 *
 *   DATABASE_URL=… node --import tsx scripts/finess-activities-import.mjs --dry-run --out <plan.json>
 *       reads the register files (latest daily files of data.gouv.fr, SHA-1 checked against the publisher's, cached in ~/.ada-lab/veille-cache) and the
 *       records; writes nothing to the database; prints the counts and the fingerprint, writes the full change set to <plan.json>
 *   DATABASE_URL=… node --import tsx scripts/finess-activities-import.mjs --apply --plan <plan.json> --confirm <first 12 characters of the fingerprint> --backup <file.dump.enc>
 *       only that change set: the same register files, the same database state (same fingerprint), an encrypted backup younger than 24 h whose .sha256 matches
 *   options: --cache-dir <dir>  --offline (the cached files, checked against their recorded SHA-1; dry-run only)  --max-source-age-days 3  --max-backup-age-hours 24  --min-backup-bytes 1048576
 * Exit: 0 done · 1 database failure (the result says what was committed) · 2 usage · 3 source or database changed since the dry-run · 4 precondition
 * (stale or unverifiable source, backup) · 5 partial (records changed since the dry-run were skipped). Never prints a secret or a personal value.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);
const arg = (k, d = null) => (has(k) && argv[argv.indexOf(k) + 1] && !argv[argv.indexOf(k) + 1].startsWith('--') ? argv[argv.indexOf(k) + 1] : d);
const out = (label, v) => process.stdout.write(`${label} ${JSON.stringify(v)}\n`);
const stop = (code, label, v) => { out(label, v); process.exit(code); };
if (has('--dry-run') === has('--apply')) stop(2, 'USAGE', 'choose --dry-run or --apply');
if (has('--apply') && (!arg('--plan') || !arg('--confirm') || !arg('--backup'))) stop(2, 'USAGE', '--apply needs --plan, --confirm and --backup');
if (has('--apply') && has('--offline')) stop(2, 'USAGE', '--offline is for the dry-run only: the apply checks the publisher again');

// the apply's own checks first: the reviewed plan file and the backup checkpoint (before any download or database connection)
let saved;
if (has('--apply')) {
  try { saved = JSON.parse(fs.readFileSync(arg('--plan'), 'utf8')); } catch { stop(2, 'USAGE', 'the --plan file cannot be read'); }
  const backup = arg('--backup');
  try {
    const st = fs.statSync(backup); const minBytes = Number(arg('--min-backup-bytes', 1024 * 1024)); const ageH = (Date.now() - st.mtimeMs) / 3600000;
    const declared = fs.readFileSync(`${backup}.sha256`, 'utf8').trim().split(/\s+/)[0];
    const actual = crypto.createHash('sha256').update(fs.readFileSync(backup)).digest('hex');
    if (st.size < minBytes || ageH > Number(arg('--max-backup-age-hours', 24)) || declared !== actual) stop(4, 'REFUSED', { reason: 'BACKUP_NOT_VALID', sizeOk: st.size >= minBytes, ageHours: Math.round(ageH), checksumOk: declared === actual });
    out('BACKUP', { file: path.basename(backup), ageHours: Math.round(ageH), checksumOk: true });
  } catch (e) { if (e?.code) stop(4, 'REFUSED', { reason: 'BACKUP_NOT_VALID', error: e.code }); throw e; }
}

const cacheDir = arg('--cache-dir', path.join(os.homedir(), '.ada-lab', 'veille-cache'));
const maxSourceDays = Number(arg('--max-source-age-days', 3));
const { fetchFiness, readFiness, DATASETS } = await import('../api/_services/verification/finess.js');
const lib = await import('./lib/finess-activities.mjs');

/** the register files: from the publisher (SHA-1 checked by fetchFiness), or with --offline the cached copies checked against the SHA-1 recorded when fetched */
async function source() {
  if (!has('--offline')) return fetchFiness({ cacheDir });
  const sha1 = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
  const o = {};
  for (const key of Object.keys(DATASETS)) {
    const file = path.join(cacheDir, `finess-${key}.json.gz`);
    let meta; try { meta = JSON.parse(fs.readFileSync(`${file}.json`, 'utf8')); } catch { stop(4, 'SOURCE', { error: 'NO_CACHED_FILE', key }); }
    if (sha1(file) !== meta.sha1) stop(4, 'SOURCE', { error: 'CHECKSUM_MISMATCH', key, title: meta.title });
    o[key] = { ...meta, file, reused: true, offline: true };
  }
  return o;
}

let src;
try { src = await source(); } catch (e) { stop(4, 'SOURCE', { error: e?.code || 'SOURCE_ERROR', message: String(e?.message || e).slice(0, 300) }); }
const srcLine = Object.fromEntries(Object.entries(src).map(([k, v]) => [k, { title: v.title, date: v.date, sha1: v.sha1, offline: Boolean(v.offline) }]));
const ageDays = Math.max(...Object.values(src).map((v) => (Date.now() - new Date(`${v.date}T00:00:00Z`).getTime()) / 86400000));
const stale = !(ageDays <= maxSourceDays);
out('SOURCE', { ...srcLine, ageDays: Math.floor(ageDays), stale });
if (stale && has('--apply')) stop(4, 'REFUSED', { reason: 'STALE_SOURCE', maxSourceDays });

const register = (await readFiness({ structures: src.structures.file, activites: null })).byFiness;
const activities = await lib.readActivities(src.activites.file);
out('REGISTER', { establishments67: register.size, activityEntries: activities.entries, withActivities: [...activities.byFiness.values()].filter((x) => x.length).length, ambiguous: activities.ambiguous.size });

const { db } = await import('../src/db/index.js');
const before = await lib.finessCounts(db);
out('BEFORE', before);
const plan = lib.planImport({ rows: await lib.finessRows(db), register, activities });
const fp = lib.fingerprint(src, plan);
const s = lib.summary(plan);
const labels = (k) => plan[k].reduce((n, c) => n + c.after.length, 0);
const expected = { ...before, with_services: before.with_services + s.add - s.remove, published_with_services: before.published_with_services + s.add - s.remove,
  activity_labels: before.activity_labels + labels('add') + labels('update') - plan.update.reduce((n, c) => n + c.before.length, 0) - plan.remove.reduce((n, c) => n + c.before.length, 0) };
const reasons = (k) => plan[k].reduce((m, c) => ({ ...m, [c.reason]: (m[c.reason] || 0) + 1 }), {});
out('PLAN', { ...s, heldReasons: reasons('held'), rejectedReasons: reasons('rejected'), labelsAdded: labels('add') });
out('FIELDS', { written: ['services', 'updatedBy', 'updatedAt'], bookkeeping: ['date_verification (VERIFY with the register evidence; verification_status stays VERIFIED)', 'EntityVersion (prior version)', 'ContentVerification', 'AuditLog', 'CronRun'], never: ['nom', 'adresse', 'code_postal', 'ville', 'telephone', 'email', 'horaires', 'statut', 'publication_hold'] });
out('EXPECTED_AFTER', expected);
out('FINGERPRINT', fp);

if (has('--dry-run')) {
  const file = arg('--out');
  if (file) { fs.writeFileSync(file, `${JSON.stringify({ kind: 'finess-activities-plan', createdAt: new Date().toISOString(), source: srcLine, fingerprint: fp, before, expected, summary: s, plan }, null, 1)}\n`, { mode: 0o600 }); out('PLAN_FILE', file); }
  if (stale) out('NOTE', 'the register files are older than --max-source-age-days: the apply would refuse them');
  process.exit(0);
}

// ------------------------------------------------------------------------------------------------------------------------------------ apply
if (saved.fingerprint !== fp) stop(3, 'REFUSED', { reason: 'CHANGED_SINCE_DRY_RUN', detail: 'the register files or the records differ from the dry-run: run the dry-run again and review it' });
if (!fp.startsWith(String(arg('--confirm')).toLowerCase()) || String(arg('--confirm')).length < 12) stop(3, 'REFUSED', { reason: 'CONFIRMATION_MISMATCH' });
const { CronRun } = await import('../src/db/schema.js');
const { eq } = await import('drizzle-orm');
const { recordVerification } = await import('../api/_services/content-verification.js');
const { snapshotRow } = await import('../api/_services/content-versions.js');
const startedAt = new Date();
const [run] = await db.insert(CronRun).values({ job: 'finess-activites', status: 'running', trigger: 'owner', startedAt, metrics: { fingerprint: fp, source: srcLine, planned: s }, updatedAt: startedAt }).returning({ id: CronRun.id });
const r = await lib.applyPlan({ db, plan, source: src, recordVerification, snapshotRow });
const status = r.failure ? 'failure' : r.skipped.length ? 'partial' : 'success';
const committed = r.done.reduce((m, d) => ({ ...m, [d.kind]: (m[d.kind] || 0) + 1 }), {});
const finishedAt = new Date();
await db.update(CronRun).set({ status, finishedAt, durationMs: finishedAt.getTime() - startedAt.getTime(), updatedAt: finishedAt, errorSample: r.failure ? `${r.failure.finess}: ${r.failure.message}` : null,
  metrics: { fingerprint: fp, source: srcLine, planned: s, committed, skipped: r.skipped.length } }).where(eq(CronRun.id, run.id));
out('RESULT', { status, committed, skipped: r.skipped.map((x) => ({ finess: x.finess, reason: x.reason })), failure: r.failure ? { finess: r.failure.finess, kind: r.failure.kind, message: r.failure.message } : null, runId: run.id });
out('AFTER', await lib.finessCounts(db));
if (r.failure) out('NOTE', 'stopped at the first database error: the records listed as committed are written (each with its prior version); nothing else. Do not re-run the same plan: run the dry-run again, it shows what is left.');
process.exit(r.failure ? 1 : r.skipped.length ? 5 : 0);
