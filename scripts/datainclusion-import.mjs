#!/usr/bin/env node
/**
 * R6 — the open-data import of data·inclusion for the Eurométropole de Strasbourg (scripts/lib/datainclusion-import.mjs says what it may and may not do).
 * DRY-RUN BY DEFAULT: nothing is written unless --apply is given with the reviewed plan, its fingerprint and a backup.
 *
 *   node --import tsx scripts/datainclusion-import.mjs [--dry-run] --out <plan.json> [--report <rapport.md>] [--check-sirene]
 *       source: the latest weekly export of data.gouv.fr (SHA-1 checked against the publisher's, cached in ~/.ada-lab/veille-cache), or the local copies
 *               --structures <file> --services <file> --dataset-meta <data.gouv.fr dataset JSON> (SHA-1 checked against that metadata)
 *       reference: DATABASE_URL (every record: exact plan), or --reference-public <https://www.accesdirectaide.fr> (published records only, read through the
 *               public API — an approximation for a report; no apply from it) [--reference-cache <file.json>]
 *   DATABASE_URL=… node --import tsx scripts/datainclusion-import.mjs --apply --plan <plan.json> --confirm <first 12 characters of the fingerprint> --backup <file.dump.enc>
 *       only that plan: the same export, the same database state (same fingerprint), an encrypted backup younger than 24 h whose .sha256 matches.
 *       A disposable LOCAL test database (loopback host, database name ending in « _test ») may use --lab-disposable instead of --backup (and the local files).
 *   options: --cache-dir <dir>  --limit-new 100  --max-source-age-days 10  --max-backup-age-hours 24  --min-backup-bytes 1048576  --sirene-pace-ms 200
 * Exit: 0 done · 1 database failure (the result says what was committed) · 2 usage · 3 source or database changed since the dry-run · 4 precondition
 * (source, licence, backup) · 5 partial (records changed since the dry-run were skipped). Never prints a secret or a personal value.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);
const arg = (k, d = null) => (has(k) && argv[argv.indexOf(k) + 1] && !argv[argv.indexOf(k) + 1].startsWith('--') ? argv[argv.indexOf(k) + 1] : d);
const out = (label, v) => process.stdout.write(`${label} ${JSON.stringify(v)}\n`);
const stop = (code, label, v) => { out(label, v); process.exit(code); };
const apply = has('--apply');
if (apply && has('--dry-run')) stop(2, 'USAGE', 'choose --dry-run or --apply');
if (apply && (!arg('--plan') || !arg('--confirm') || !(arg('--backup') || has('--lab-disposable')))) stop(2, 'USAGE', '--apply needs --plan, --confirm and --backup (or --lab-disposable on a local test database)');
if (apply && arg('--reference-public')) stop(2, 'USAGE', 'the apply reads the database again: no --reference-public');
if (apply && arg('--structures') && !has('--lab-disposable')) stop(2, 'USAGE', 'the apply reads the publisher again: local files only with --lab-disposable');
if (!apply && !process.env.DATABASE_URL && !arg('--reference-public')) stop(2, 'USAGE', 'a reference is needed: DATABASE_URL or --reference-public <base url>');

// the apply's own checks first: the reviewed plan file and the backup (or the disposable local test database)
let saved;
if (apply) {
  try { saved = JSON.parse(fs.readFileSync(arg('--plan'), 'utf8')); } catch { stop(2, 'USAGE', 'the --plan file cannot be read'); }
  if (saved.plan?.referenceKind !== 'database') stop(2, 'USAGE', 'the plan was not made against a database');
  if (has('--lab-disposable')) {
    let u; try { u = new URL(String(process.env.DATABASE_URL || '')); } catch { stop(4, 'REFUSED', { reason: 'NO_DATABASE_URL' }); }
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname); const dbName = u.pathname.replace(/^\//, '');
    if (!local || !/_test$/.test(dbName)) stop(4, 'REFUSED', { reason: 'LAB_DISPOSABLE_ONLY_ON_A_LOCAL_TEST_DATABASE' });
    out('BACKUP', { skipped: 'local disposable test database', database: dbName });
  } else {
    const backup = arg('--backup');
    try {
      const st = fs.statSync(backup); const minBytes = Number(arg('--min-backup-bytes', 1024 * 1024)); const ageH = (Date.now() - st.mtimeMs) / 3600000;
      const declared = fs.readFileSync(`${backup}.sha256`, 'utf8').trim().split(/\s+/)[0];
      const actual = crypto.createHash('sha256').update(fs.readFileSync(backup)).digest('hex');
      if (st.size < minBytes || ageH > Number(arg('--max-backup-age-hours', 24)) || declared !== actual) stop(4, 'REFUSED', { reason: 'BACKUP_NOT_VALID', sizeOk: st.size >= minBytes, ageHours: Math.round(ageH), checksumOk: declared === actual });
      out('BACKUP', { file: path.basename(backup), ageHours: Math.round(ageH), checksumOk: true });
    } catch (e) { if (e?.code) stop(4, 'REFUSED', { reason: 'BACKUP_NOT_VALID', error: e.code }); throw e; }
  }
}

const di = await import('../api/_services/verification/datainclusion.js');
const lib = await import('./lib/datainclusion-import.mjs');
const sha1 = (f) => new Promise((ok, ko) => { const h = crypto.createHash('sha1'); fs.createReadStream(f).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', ko); });

/** the export: local copies checked against the dataset metadata, or the publisher's latest (fetchDataInclusion: SHA-1 checked, cached) */
async function source() {
  const fetchedAt = new Date().toISOString();
  if (arg('--structures')) {
    let meta; try { meta = JSON.parse(fs.readFileSync(arg('--dataset-meta'), 'utf8')); } catch { stop(2, 'USAGE', 'local files need --dataset-meta (the data.gouv.fr dataset JSON they were downloaded with)'); }
    const o = { licence: meta.license || null, publisher: meta.organization?.name || null, fetchedAt: arg('--fetched-at', fs.statSync(arg('--structures')).mtime.toISOString()) };
    for (const key of ['structures', 'services']) {
      const file = arg(`--${key}`); const title = path.basename(file);
      const r = (meta.resources || []).find((x) => x.title === title);
      const m = title.match(/^(structures|services)-inclusion-(\d{4}-\d{2}-\d{2})\.json$/);
      if (!r || !m || m[1] !== key) stop(4, 'SOURCE', { error: 'FILE_NOT_IN_DATASET', key, title });
      const want = String(r.checksum?.value || '').toLowerCase(); const got = await sha1(file);
      if (!want || want !== got) stop(4, 'SOURCE', { error: 'CHECKSUM_MISMATCH', key, title });
      o[key] = { title, url: r.url, sha1: got, file, date: m[2], modifiedAt: r.last_modified || null };
    }
    if (o.structures.date !== o.services.date) stop(4, 'SOURCE', { error: 'FILES_OF_TWO_EXPORTS' });
    return { ...o, date: o.structures.date };
  }
  const f = await di.fetchDataInclusion({ cacheDir: arg('--cache-dir', path.join(os.homedir(), '.ada-lab', 'veille-cache')) });
  let fetched = fetchedAt; try { fetched = JSON.parse(fs.readFileSync(`${f.structures.file}.meta.json`, 'utf8')).fetchedAt || fetchedAt; } catch { /* the time of this run */ }
  return { ...f, fetchedAt: fetched };
}

let src;
try { src = await source(); } catch (e) { stop(4, 'SOURCE', { error: e?.code || 'SOURCE_ERROR', message: String(e?.message || e).slice(0, 300) }); }
const srcLine = { date: src.date, licence: src.licence, publisher: src.publisher, fetchedAt: src.fetchedAt, ...Object.fromEntries(['structures', 'services'].map((k) => [k, { title: src[k].title, sha1: src[k].sha1 }])) };
const ageDays = (Date.now() - new Date(`${src.date}T00:00:00Z`).getTime()) / 86400000;
out('SOURCE', { ...srcLine, ageDays: Math.floor(ageDays) });
if (!lib.ACCEPTED_LICENCES.has(String(src.licence || ''))) stop(4, 'REFUSED', { reason: 'LICENCE_CHANGED', licence: src.licence, accepted: [...lib.ACCEPTED_LICENCES] });
if (apply && !(ageDays <= Number(arg('--max-source-age-days', 10)))) stop(4, 'REFUSED', { reason: 'STALE_SOURCE' });

const read = await di.readDataInclusion({ structures: src.structures.file, services: src.services.file, departement: '67' });
out('EXPORT', { structures: read.counts.structures, services: read.counts.services, departement67: read.counts.inScope, servicesDepartement67: read.counts.servicesInScope, unknownValues: Object.keys(read.unknown).length });

// ---------------------------------------------------------------------------------------------------------------------------------- reference
let rows; let db = null; let referenceLabel; const referenceKind = arg('--reference-public') && !process.env.DATABASE_URL ? 'public-api' : 'database';
if (referenceKind === 'database') {
  ({ db } = await import('../src/db/index.js'));
  rows = await lib.referenceRows(db);
  referenceLabel = (() => { try { const u = new URL(String(process.env.DATABASE_URL)); return `${u.hostname === '127.0.0.1' || u.hostname === 'localhost' ? 'yerel' : 'uzak'} veritabanı ${u.pathname.replace(/^\//, '')}`; } catch { return 'veritabanı'; } })();
  out('BEFORE', await lib.importCounts(db));
} else {
  const base = String(arg('--reference-public')).replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) stop(2, 'USAGE', '--reference-public must be an https URL');
  referenceLabel = base;
  const cache = arg('--reference-cache');
  if (cache && fs.existsSync(cache)) rows = JSON.parse(fs.readFileSync(cache, 'utf8')).rows;
  else {
    const pace = Number(arg('--reference-pace-ms', 400));
    const get = async (p) => {
      for (let i = 0; i < 6; i += 1) {
        const r = await fetch(`${base}${p}`, { headers: { Accept: 'application/json', 'User-Agent': 'ada-datainclusion-import (reference read)' }, signal: AbortSignal.timeout(30000) });
        if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 15000 * (i + 1))); continue; }
        if (!r.ok) throw new Error(`HTTP ${r.status} ${p}`);
        await new Promise((ok) => setTimeout(ok, pace));
        return r.json();
      }
      throw new Error(`rate limited ${p}`);
    };
    const list = [];
    for (let page = 1; page < 400; page += 1) { const j = await get(`/api/structures?page=${page}&limit=50`); list.push(...j.items); if (!j.pagination?.hasNext) break; }
    rows = [];
    for (const it of list) {
      const d = await get(`/api/structures/${encodeURIComponent(it.slug)}`); const x = d.item || d;
      rows.push({ id: x.id, slug: x.slug, nom: x.nom, adresse: x.adresse, code_postal: x.code_postal, ville: x.ville, siret: x.siret || null, numero_finess: x.numero_finess || null, statut: x.statut,
        verification_status: x.verification_status, publication_hold: null, services_externes: x.services_externes || null, categories_aidees: x.categories_aidees || [] });
    }
    if (cache) fs.writeFileSync(cache, JSON.stringify({ base, readAt: new Date().toISOString(), rows }), { mode: 0o600 });
  }
  out('REFERENCE', { kind: 'public-api', base, rows: rows.length });
}

const territory = lib.loadTerritory();
const plan = lib.planImport({ read, rows, source: src, territory, fetchedAt: src.fetchedAt, referenceKind });
const fp = lib.fingerprint(src, plan);
out('PLAN', plan.counts);
out('SKIPPED', plan.skipped);
out('WRITES', { written: ['Structure.services_externes (records NOT shown to the public, prior version in EntityVersion)', 'Structure (new DRAFT records: statut brouillon, UNVERIFIED, import_batch)', 'ReviewQueueItem (uncertain matches)', 'CronRun'],
  never: ['statut of an existing record', 'verification_status', 'publication_hold', 'nom/adresse/telephone/email of an existing record', 'any public record (the veille writes those)'] });
out('FINGERPRINT', fp);

if (!apply) {
  if (has('--check-sirene')) {
    const { lookupSiret } = await import('../api/_services/verification/registries.js');
    const verdicts = {}; const pace = Number(arg('--sirene-pace-ms', 200));
    for (const c of plan.candidates) {
      let v;
      try { const s = await lookupSiret(c.siret); v = di.growthRefusal(s, c, '67') || (s.communeInsee && !territory.communes.has(String(s.communeInsee)) ? 'adresse SIRENE hors de l’Eurométropole' : null) || 'accepté (taslak açılır)'; } catch (e) { v = `SIRENE okunamadı (${e?.code || 'hata'})`; }
      c.sirene = v; verdicts[v] = (verdicts[v] || 0) + 1;
      await new Promise((ok) => setTimeout(ok, pace));
    }
    out('SIRENE', verdicts);
    plan.sireneVerdicts = verdicts;
  }
  const file = arg('--out');
  if (file) { fs.writeFileSync(file, `${JSON.stringify({ kind: 'datainclusion-import-plan', createdAt: new Date().toISOString(), source: srcLine, fingerprint: fp, plan }, null, 1)}\n`, { mode: 0o600 }); out('PLAN_FILE', file); }
  const report = arg('--report');
  if (report) {
    let commit = null; try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { commit = null; }
    const cmd = ['env -u OPENAI_API_KEY node --import tsx scripts/datainclusion-import.mjs --dry-run \\',
      arg('--structures') ? `  --structures <dir>/${src.structures.title} --services <dir>/${src.services.title} --dataset-meta <dir>/dataset.json \\` : '  \\',
      referenceKind === 'database' ? '  --out plan.json --report rapport.md   # DATABASE_URL=<veritabanı>' : `  --reference-public ${referenceLabel} --reference-cache ref.json --out plan.json --report rapport.md${has('--check-sirene') ? ' --check-sirene' : ''}`];
    fs.writeFileSync(report, lib.renderReportTr(plan, { generatedAt: new Date().toISOString(), commit, fingerprint: fp, publisher: src.publisher, licenceId: src.licence, licenceCheckedAt: arg('--licence-checked-at', new Date().toISOString().slice(0, 10)),
      files: ['structures', 'services'].map((k) => ({ title: src[k].title, sha1: src[k].sha1 })), referenceLabel, referenceRows: rows.length, sirene: plan.sireneVerdicts || null, commands: cmd }));
    out('REPORT_FILE', report);
  }
  if (db) await (await import('../src/db/index.js')).db.$client?.end?.();
  process.exit(0);
}

// ------------------------------------------------------------------------------------------------------------------------------------ apply
if (saved.fingerprint !== fp) stop(3, 'REFUSED', { reason: 'CHANGED_SINCE_DRY_RUN', detail: 'the export or the records differ from the dry-run: run the dry-run again and review it' });
if (!fp.startsWith(String(arg('--confirm')).toLowerCase()) || String(arg('--confirm')).length < 12) stop(3, 'REFUSED', { reason: 'CONFIRMATION_MISMATCH' });
const { lookupSiret } = await import('../api/_services/verification/registries.js');
const { snapshotRow } = await import('../api/_services/content-versions.js');
const { sql } = await import('drizzle-orm');
const startedAt = new Date(); const runId = crypto.randomUUID();
await db.execute(sql`INSERT INTO "CronRun" (id, job, status, trigger, "startedAt", metrics, "createdAt", "updatedAt") VALUES (${runId}, 'datainclusion-import', 'running', 'owner', ${startedAt},
  ${JSON.stringify({ fingerprint: fp, source: srcLine, planned: plan.counts })}::jsonb, ${startedAt}, ${startedAt})`);
const r = await lib.applyPlan({ db, plan, source: src, territory, lookup: (s) => lookupSiret(s), snapshotRow, limitNew: Number(arg('--limit-new', 100)), paceMs: Number(arg('--sirene-pace-ms', 200)) });
const status = r.failure ? 'failure' : r.skipped.length ? 'partial' : 'success';
const committed = { updated: r.updated.length, created: r.created.length, queued: r.queued.length, refusedBySirene: r.refused.length, later: r.later };
const refusedReasons = r.refused.reduce((m, x) => ({ ...m, [x.reason]: (m[x.reason] || 0) + 1 }), {});
const finishedAt = new Date();
await db.execute(sql`UPDATE "CronRun" SET status = ${status}, "finishedAt" = ${finishedAt}, "durationMs" = ${finishedAt.getTime() - startedAt.getTime()}, "updatedAt" = ${finishedAt},
  "errorSample" = ${r.failure ? r.failure.message : null}, metrics = ${JSON.stringify({ fingerprint: fp, source: srcLine, planned: plan.counts, committed, refusedReasons, skipped: r.skipped.length, batch: `${lib.BATCH_PREFIX}${plan.version}` })}::jsonb
  WHERE id = ${runId}`);
out('RESULT', { status, committed, refusedReasons, skipped: r.skipped.map((x) => x.reason), failure: r.failure, runId, batch: `${lib.BATCH_PREFIX}${plan.version}` });
out('AFTER', await lib.importCounts(db));
if (r.failure) out('NOTE', 'stopped at the first database error: what is listed as committed is written; nothing else. Run the dry-run again: it shows what is left.');
await db.$client?.end?.();
process.exit(r.failure ? 1 : r.skipped.length ? 5 : 0);
