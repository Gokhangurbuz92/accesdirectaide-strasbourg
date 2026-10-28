/**
 * Launch-readiness item 52 on REAL PostgreSQL — the encrypted backup really restores (scripts/db-backup.mjs / db-restore.mjs), on two temporary databases of the
 * test cluster (created and dropped here; the test database itself is never dumped nor restored):
 *  - the file never contains the data in clear, and --verify checks the tag and the archive;
 *  - a modified file, a wrong key, an unconfirmed or mistyped target, a non-empty target: refused, nothing restored;
 *  - the restore into an empty database gives back the rows.
 * Synthetic data only; skipped without DATABASE_URL or without pg_dump / pg_restore.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const tool = (t) => (process.env.PG_BIN ? path.join(process.env.PG_BIN, t) : t);
const hasTools = ['pg_dump', 'pg_restore'].every((t) => spawnSync(tool(t), ['--version']).status === 0);
const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const SRC = `ada_bkp_src_${TS}`; const DST = `ada_bkp_dst_${TS}`;
const PLANTED = `PLANTED-ROW-${TS}`;
const KEY = crypto.randomBytes(32).toString('hex');
const withDb = (url, name) => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
const run = (script, args, env) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 120000,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, ...(process.env.PG_BIN ? { PG_BIN: process.env.PG_BIN } : {}), ...env } });

describe.skipIf(!hasDatabase || !hasTools)('encrypted backup and restore (real DB)', () => {
  let admin; let dir; let file; let host;
  const q = async (name, sqlText, params = []) => { const c = new pg.Client({ connectionString: withDb(process.env.DATABASE_URL, name) }); await c.connect(); try { return (await c.query(sqlText, params)).rows; } finally { await c.end(); } };
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL }); await admin.connect();
    await admin.query(`CREATE DATABASE "${SRC}"`); await admin.query(`CREATE DATABASE "${DST}"`);
    await q(SRC, 'CREATE TABLE fiche (id int PRIMARY KEY, texte text NOT NULL)');
    await q(SRC, 'INSERT INTO fiche (id, texte) SELECT g, $1 || g FROM generate_series(1, 250) g', [PLANTED]);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-bkp-test-'));
    host = new URL(process.env.DATABASE_URL).hostname;
  }, 60000);
  afterAll(async () => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    if (!admin) return;
    for (const d of [SRC, DST]) await admin.query(`DROP DATABASE IF EXISTS "${d}" WITH (FORCE)`).catch(() => {});
    await admin.end();
  });

  it('writes an encrypted file that never contains the data in clear, and verifies it', () => {
    const r = run('scripts/db-backup.mjs', ['--out', dir, '--label', 'test'], { DATABASE_URL: withDb(process.env.DATABASE_URL, SRC), BACKUP_ENCRYPTION_KEY: KEY });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    file = JSON.parse(r.stdout).file;
    expect((fs.statSync(file).mode & 0o777).toString(8)).toBe('600');
    expect(fs.readFileSync(file).includes(Buffer.from(PLANTED))).toBe(false);
    expect(r.stdout).not.toContain(process.env.DATABASE_URL);
    const v = run('scripts/db-backup.mjs', ['--verify', file], { BACKUP_ENCRYPTION_KEY: KEY });
    expect(v.status).toBe(0);
    expect(JSON.parse(v.stdout)).toMatchObject({ ok: true });
  });

  it('refuses a modified file, a wrong key, an unconfirmed or mistyped target', async () => {
    const bad = path.join(dir, 'tampered.dump.enc'); const buf = fs.readFileSync(file); buf[Math.floor(buf.length / 2)] ^= 1; fs.writeFileSync(bad, buf);
    expect(run('scripts/db-backup.mjs', ['--verify', bad], { BACKUP_ENCRYPTION_KEY: KEY }).status).toBe(1);
    expect(run('scripts/db-backup.mjs', ['--verify', file], { BACKUP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') }).status).toBe(1);
    const target = withDb(process.env.DATABASE_URL, DST);
    for (const args of [['--file', bad, '--confirm-target', `${host}/${DST}`], ['--file', file], ['--file', file, '--confirm-target', `${host}/autre`]]) {
      const r = run('scripts/db-restore.mjs', args, { TARGET_DATABASE_URL: target, BACKUP_ENCRYPTION_KEY: KEY });
      expect(r.status, args.join(' ')).toBe(1);
    }
    expect((await q(DST, `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`))[0].n).toBe(0);   // nothing restored
  });

  it('restores into an empty database; a non-empty one needs --into-nonempty', async () => {
    const target = withDb(process.env.DATABASE_URL, DST);
    const r = run('scripts/db-restore.mjs', ['--file', file, '--confirm-target', `${host}/${DST}`], { TARGET_DATABASE_URL: target, BACKUP_ENCRYPTION_KEY: KEY });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect((await q(DST, 'SELECT count(*)::int AS n, min(texte) AS t FROM fiche'))[0]).toEqual({ n: 250, t: `${PLANTED}1` });
    const again = run('scripts/db-restore.mjs', ['--file', file, '--confirm-target', `${host}/${DST}`], { TARGET_DATABASE_URL: target, BACKUP_ENCRYPTION_KEY: KEY });
    expect(again.status).toBe(1);
    expect(again.stderr).toContain('--into-nonempty');
  });
});
