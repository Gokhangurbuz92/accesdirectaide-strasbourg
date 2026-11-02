#!/usr/bin/env node
/**
 * R38 — owner command: add to the directory the open establishments of ONE official FINESS category that the directory did not take before (e.g. 340, the
 * « Service mandataire judiciaire à la protection des majeurs » of the Bas-Rhin), and nothing else. Insert-only: no existing record is read for change,
 * updated or withdrawn; the records are made and published by the veille's own FINESS step (same fields, texts and verification as the 701 FINESS records),
 * bounded to that category and to the planned count.
 *
 *   DATABASE_URL=… node --import tsx scripts/finess-add-category.mjs --category 340 --dry-run --out <plan.json>
 *       reads the register files (latest daily files of data.gouv.fr, SHA-1 checked, cached in ~/.ada-lab/veille-cache) and the FINESS numbers already in
 *       the directory; writes nothing; prints the establishments that would be added and the fingerprint
 *   DATABASE_URL=… node --import tsx scripts/finess-add-category.mjs --category 340 --apply --plan <plan.json> --confirm <first 12 characters of the fingerprint> --backup <file.dump.enc>
 *       only if the register files and the directory still give the same plan, with an encrypted backup younger than 24 h whose .sha256 matches; then checks
 *       that exactly the planned establishments were added
 *   options: --cache-dir <dir>  --offline (cached files, dry-run only)  --max-backup-age-hours 24  --min-backup-bytes 1048576
 * Exit: 0 done · 1 failure · 2 usage · 3 changed since the dry-run · 4 precondition (source, backup, category outside the scope) · 5 result differs from the plan.
 * Never prints a secret or a personal value (establishment names and towns are public register data).
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
const category = String(arg('--category', ''));
if (!/^\d{3}$/.test(category)) stop(2, 'USAGE', '--category <3-digit official code> is required');
if (has('--dry-run') === has('--apply')) stop(2, 'USAGE', 'choose --dry-run or --apply');
if (has('--apply') && (!arg('--plan') || !arg('--confirm') || !arg('--backup'))) stop(2, 'USAGE', '--apply needs --plan, --confirm and --backup');
if (has('--apply') && has('--offline')) stop(2, 'USAGE', '--offline is for the dry-run only');

let saved;
if (has('--apply')) {
  try { saved = JSON.parse(fs.readFileSync(arg('--plan'), 'utf8')); } catch { stop(2, 'USAGE', 'the --plan file cannot be read'); }
  const backup = arg('--backup');
  try {
    const st = fs.statSync(backup); const ageH = (Date.now() - st.mtimeMs) / 3600000;
    const declared = fs.readFileSync(`${backup}.sha256`, 'utf8').trim().split(/\s+/)[0];
    const actual = crypto.createHash('sha256').update(fs.readFileSync(backup)).digest('hex');
    if (st.size < Number(arg('--min-backup-bytes', 1024 * 1024)) || ageH > Number(arg('--max-backup-age-hours', 24)) || declared !== actual) stop(4, 'REFUSED', { reason: 'BACKUP_NOT_VALID', ageHours: Math.round(ageH), checksumOk: declared === actual });
    out('BACKUP', { file: path.basename(backup), ageHours: Math.round(ageH), checksumOk: true });
  } catch (e) { if (e?.code) stop(4, 'REFUSED', { reason: 'BACKUP_NOT_VALID', error: e.code }); throw e; }
}

const cacheDir = arg('--cache-dir', path.join(os.homedir(), '.ada-lab', 'veille-cache'));
const { fetchFiness, readFiness, SCOPE, DATASETS } = await import('../api/_services/verification/finess.js');
if (!Object.prototype.hasOwnProperty.call(SCOPE, category)) stop(4, 'REFUSED', { reason: 'CATEGORY_NOT_IN_SCOPE', category, detail: 'add it to api/_services/verification/finess-scope.js first (reviewed change)' });
async function source() {
  if (!has('--offline')) return fetchFiness({ cacheDir });
  const sha1 = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex'); const o = {};
  for (const key of Object.keys(DATASETS)) {
    const file = path.join(cacheDir, `finess-${key}.json.gz`);
    let meta; try { meta = JSON.parse(fs.readFileSync(`${file}.json`, 'utf8')); } catch { stop(4, 'SOURCE', { error: 'NO_CACHED_FILE', key }); }
    if (sha1(file) !== meta.sha1) stop(4, 'SOURCE', { error: 'CHECKSUM_MISMATCH', key });
    o[key] = { ...meta, file, reused: true, offline: true };
  }
  return o;
}
const files = await source();
const register = await readFiness({ structures: files.structures.file, activites: files.activites?.file || null, departement: '67' });
const { db } = await import('../src/db/index.js');
const { sql } = await import('drizzle-orm');
const listed = new Set((await db.execute(sql`SELECT numero_finess FROM "Structure" WHERE numero_finess IS NOT NULL`)).rows.map((r) => r.numero_finess));
const totalBefore = (await db.execute(sql`SELECT count(*)::int AS n FROM "Structure"`)).rows[0].n;
// the same selection as the veille's FINESS step (feedFiness), restricted to the category
const plan = [...register.byFiness.values()].filter((e) => e.open && e.scope && String(e.category) === category && !listed.has(e.finess) && e.nom && e.code_postal && String(e.insee || e.code_postal).startsWith('67'))
  .map((e) => ({ finess: e.finess, nom: e.nom, ville: e.ville, code_postal: e.code_postal, contact: Boolean(e.telephone || e.email) })).sort((a, b) => a.finess.localeCompare(b.finess));
const srcLine = { structures: files.structures.title, sha1: files.structures.sha1, date: files.structures.date };
const fp = crypto.createHash('sha256').update(JSON.stringify({ category, src: srcLine.sha1, plan: plan.map((p) => p.finess), totalBefore })).digest('hex');
out('SOURCE', srcLine); out('PLAN', { category, label: SCOPE[category][0], add: plan.length, establishments: plan, totalBefore }); out('FINGERPRINT', fp);

if (has('--dry-run')) {
  const file = arg('--out');
  if (file) { fs.writeFileSync(file, `${JSON.stringify({ kind: 'finess-add-category-plan', createdAt: new Date().toISOString(), category, source: srcLine, fingerprint: fp, totalBefore, plan }, null, 1)}\n`, { mode: 0o600 }); out('PLAN_FILE', file); }
  out('NEXT', plan.length ? `review the plan, then --apply --plan <file> --confirm ${fp.slice(0, 12)} --backup <fresh backup>` : 'nothing to add');
  process.exit(0);
}
if (saved.kind !== 'finess-add-category-plan' || saved.category !== category || saved.fingerprint !== fp) stop(3, 'REFUSED', { reason: 'CHANGED_SINCE_DRY_RUN' });
if (String(arg('--confirm')) !== fp.slice(0, 12)) stop(2, 'REFUSED', { reason: 'CONFIRMATION_MISMATCH' });
if (!plan.length) stop(0, 'DONE', { added: 0 });
const { runVeille } = await import('../api/_services/verification/chain.js');
const r = await runVeille({ db, trigger: 'owner', only: ['finess'], finessFiles: files, texts: false, ignorePause: true, categories: [category], limits: { newFiness: plan.length }, maxMinutes: 20 });
out('VEILLE', { ok: r.ok, status: r.status || r.skipped || null, runId: r.runId || null });
const after = (await db.execute(sql`SELECT numero_finess, statut FROM "Structure" WHERE numero_finess IN (${sql.join(plan.map((p) => sql`${p.finess}`), sql`, `)})`)).rows;
const totalAfter = (await db.execute(sql`SELECT count(*)::int AS n FROM "Structure"`)).rows[0].n;
const result = { added: after.length, published: after.filter((x) => x.statut === 'actif').length, planned: plan.length, totalBefore, totalAfter, onlyPlanned: totalAfter - totalBefore === after.length };
out('AFTER', result);
process.exit(result.added === plan.length && result.onlyPlanned ? 0 : 5);
