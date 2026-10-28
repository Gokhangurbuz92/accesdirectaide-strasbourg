#!/usr/bin/env node
/**
 * PKG-11 / Q06 — disaster-recovery REHEARSAL: full backup → restore into a FRESH database (+ the document store into a fresh directory) → verify → time.
 *   - Backup  = pg_dump custom format of the WHOLE database (schema, data, migration journal) + a byte copy of the encrypted object store (ADA_LOCAL_STORAGE_DIR).
 *     The cron « backup-db » JSON export covers only 9 content tables (no accounts, dossiers, grants, appointments, documents): it is a content snapshot,
 *     NOT a disaster-recovery backup.
 *   - Verify  = every table: same row count AND same content checksum (md5 of the rows in primary-key order); same migration journal; every stored blob:
 *     same sha256. Ciphertext is restored byte for byte, so it opens only with the SAME data keys — keys are backed up separately (never in the dump).
 *   - Only disposable databases: the target is created fresh with a unique name and dropped at the end unless keep=true. Never point this at a shared
 *     or production database.
 *   node scripts/dr-rehearsal.mjs --source <postgresql url> [--storage <dir>] [--out report.json] [--keep]
 */
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';

const run = promisify(execFile);
const now = () => Number(process.hrtime.bigint() / 1000000n);

export function pgBinDir() {
  for (const d of [process.env.PG_BIN, '/opt/homebrew/opt/postgresql@17/bin', '/usr/local/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin']) {
    if (d && fs.existsSync(path.join(d, 'pg_dump'))) return d;
  }
  throw new Error('pg_dump (PostgreSQL 17) not found: set PG_BIN');
}

/** Per-table row count + content checksum (rows ordered by the primary key, else by the whole row). */
export async function fingerprint(url) {
  const c = new pg.Client({ connectionString: url }); await c.connect();
  try {
    const tables = (await c.query(`SELECT table_schema s, table_name t FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema IN ('public', 'drizzle') ORDER BY 1, 2`)).rows;
    const out = {};
    for (const { s, t } of tables) {
      const pk = (await c.query(`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY a.attnum`, [`"${s}"."${t}"`])).rows.map((r) => `"${r.attname}"`);
      const order = pk.length ? pk.join(', ') : 'x::text';
      const r = (await c.query(`SELECT count(*)::int n, coalesce(md5(string_agg(x::text, '|' ORDER BY ${order})), '') h FROM "${s}"."${t}" x`)).rows[0];
      out[`${s}.${t}`] = { rows: r.n, md5: r.h };
    }
    return out;
  } finally { await c.end(); }
}

function blobs(dir) {
  const out = {};
  if (!dir || !fs.existsSync(dir)) return out;
  const walk = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else out[path.relative(dir, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } };
  walk(dir); return out;
}

/**
 * @param {{ sourceUrl: string, storageDir?: string|null, keep?: boolean, workDir?: string }} o
 * @returns {Promise<{ ok: boolean, timingsMs: Record<string, number>, tables: number, rows: number, mismatches: string[], blobs: number, dumpBytes: number, target: string|null }>}
 */
export async function rehearse({ sourceUrl, storageDir = null, keep = false, workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-dr-')) }) {
  const bin = pgBinDir(); const t = {}; const mismatches = [];
  const src = new URL(sourceUrl); const targetName = `${src.pathname.slice(1)}_restore_${Date.now().toString(36)}`.slice(0, 63);
  const target = new URL(sourceUrl); target.pathname = `/${targetName}`;
  const dump = path.join(workDir, 'backup.dump'); const storeCopy = path.join(workDir, 'store');
  let t0 = now();
  const before = await fingerprint(sourceUrl); t.fingerprintSource = now() - t0;
  t0 = now(); await run(path.join(bin, 'pg_dump'), ['--format=custom', '--no-owner', '--no-privileges', '--file', dump, sourceUrl]); t.backupDb = now() - t0;
  t0 = now(); if (storageDir && fs.existsSync(storageDir)) fs.cpSync(storageDir, storeCopy, { recursive: true }); t.backupStore = now() - t0;
  const admin = new pg.Client({ connectionString: (() => { const u = new URL(sourceUrl); u.pathname = '/postgres'; return u.toString(); })() }); await admin.connect();
  try {
    t0 = now();
    await admin.query(`CREATE DATABASE "${targetName}"`);
    for (const e of (await (async () => { const c = new pg.Client({ connectionString: sourceUrl }); await c.connect(); try { return (await c.query(`SELECT extname FROM pg_extension WHERE extname <> 'plpgsql'`)).rows.map((r) => r.extname); } finally { await c.end(); } })())) {
      const c = new pg.Client({ connectionString: target.toString() }); await c.connect(); try { await c.query(`CREATE EXTENSION IF NOT EXISTS "${e}"`); } finally { await c.end(); }
    }
    await run(path.join(bin, 'pg_restore'), ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', target.toString(), dump]).catch(async (e) => {
      // an extension already created above may be re-declared by the dump: retry without exit-on-error and rely on the fingerprint comparison below
      if (!/already exists/.test(String(e.stderr || ''))) throw e;
      await run(path.join(bin, 'pg_restore'), ['--no-owner', '--no-privileges', '--dbname', target.toString(), dump]).catch(() => {});
    });
    t.restoreDb = now() - t0;
    t0 = now(); const restoredStore = path.join(workDir, 'store-restored'); if (fs.existsSync(storeCopy)) fs.cpSync(storeCopy, restoredStore, { recursive: true }); t.restoreStore = now() - t0;
    t0 = now();
    const after = await fingerprint(target.toString());
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!after[k]) mismatches.push(`${k}: missing after restore`);
      else if (!before[k]) mismatches.push(`${k}: unexpected after restore`);
      else if (before[k].rows !== after[k].rows || before[k].md5 !== after[k].md5) mismatches.push(`${k}: rows ${before[k].rows}->${after[k].rows}${before[k].md5 !== after[k].md5 ? ', content differs' : ''}`);
    }
    const b1 = blobs(storageDir); const b2 = blobs(path.join(workDir, 'store-restored'));
    for (const k of Object.keys(b1)) if (b1[k] !== b2[k]) mismatches.push(`blob ${k}: differs after restore`);
    t.verify = now() - t0;
    t.total = Object.values(t).reduce((a, b) => a + b, 0);
    return { ok: mismatches.length === 0, timingsMs: t, tables: Object.keys(before).length, rows: Object.values(before).reduce((a, b) => a + b.rows, 0), mismatches,
      blobs: Object.keys(b1).length, dumpBytes: fs.statSync(dump).size, target: keep ? target.toString().replace(/\/\/[^@]*@/, '//***@') : null };
  } finally {
    if (!keep) await admin.query(`DROP DATABASE IF EXISTS "${targetName}" WITH (FORCE)`).catch(() => {});
    await admin.end();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
  const sourceUrl = arg('source'); if (!sourceUrl) { process.stderr.write('--source <disposable postgresql url> required\n'); process.exit(2); }
  const report = { schema: 'ada.dr-rehearsal.v1', at: new Date().toISOString(), ...(await rehearse({ sourceUrl, storageDir: arg('storage'), keep: process.argv.includes('--keep') })) };
  if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(report, null, 1));
  process.stdout.write(JSON.stringify(report, null, 1) + '\n'); process.exit(report.ok ? 0 : 1);
}
