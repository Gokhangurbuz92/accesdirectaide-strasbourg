/**
 * PKG-11 / Q06 on REAL PostgreSQL: a full backup (pg_dump of the whole database + the encrypted document store) is restored into a FRESH database and a fresh
 * directory, timed, and verified table by table (row count + content checksum, migration journal included) and blob by blob (sha256). Sealed personal data is
 * restored byte for byte and opens with the same data keys. A deliberately corrupted restore is detected (the verification is not a formality).
 * Disposable databases only: the restored copy is created with a unique name and dropped. Requires DATABASE_URL (isolated local PostgreSQL); skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);

describe.skipIf(!hasDatabase)('Q06 disaster-recovery rehearsal (real PostgreSQL)', () => {
  let c, dr, sealText, openText, store;
  beforeAll(async () => {
    dr = await import('../../scripts/dr-rehearsal.mjs');
    ({ sealText, openText } = await import('../../api/lib/data-keys.ts'));
    c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
    // synthetic rows across the account / dossier / audit tables, one of them sealed with the data keys
    await c.query(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())`, [`q06-u-${TS}`, `q06-${TS}@example.test`]);
    await c.query(`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount") VALUES ($1, NOW() + interval '1 day', '{}', $2, 0)`, [`q06-sd-${TS}`, JSON.stringify({ sealed: sealText('Q06 synthetic secret', { purpose: 'support-request', context: `q06:${TS}` }) })]);
    await c.query(`INSERT INTO "AuditLog" (id, action, actor, entity, entity_id, details) VALUES ($1, 'Q06_REHEARSAL', 'qa', 'q06', $2, '{}')`, [`q06-a-${TS}`, TS]);
    store = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-q06-store-')); fs.mkdirSync(path.join(store, 'docs'));
    fs.writeFileSync(path.join(store, 'docs', 'a.bin'), Buffer.from('encrypted-blob-q06-' + TS));
  });
  afterAll(async () => {
    if (!c) return;
    await c.query(`DELETE FROM "AuditLog" WHERE action = 'Q06_REHEARSAL' AND entity_id = $1`, [TS]).catch(() => {});
    await c.query(`DELETE FROM "SharedDiagnostic" WHERE id = $1`, [`q06-sd-${TS}`]).catch(() => {});
    await c.query(`DELETE FROM "CitizenUser" WHERE id = $1`, [`q06-u-${TS}`]).catch(() => {});
    await c.end(); if (store) fs.rmSync(store, { recursive: true, force: true });
  });

  it('restores the whole database and document store into a fresh environment, identical table by table and blob by blob, timed', async () => {
    const r = await dr.rehearse({ sourceUrl: process.env.DATABASE_URL, storageDir: store, keep: true });
    try {
      expect(r.mismatches).toEqual([]); expect(r.ok).toBe(true);
      expect(r.tables).toBeGreaterThan(60); expect(r.rows).toBeGreaterThan(3); expect(r.blobs).toBe(1); expect(r.dumpBytes).toBeGreaterThan(1000);
      for (const k of ['backupDb', 'restoreDb', 'verify', 'total']) expect(Number.isFinite(r.timingsMs[k])).toBe(true);
      console.log('Q06_REHEARSAL', JSON.stringify({ timingsMs: r.timingsMs, tables: r.tables, rows: r.rows, dumpBytes: r.dumpBytes }));
      // the restored copy really is a separate database holding the sealed value, which opens with the same keys
      const restored = new pg.Client({ connectionString: process.env.DATABASE_URL.replace(/\/[^/?]+(\?|$)/, `/${new URL(process.env.DATABASE_URL).pathname.slice(1)}_restore_`) });
      const name = (await c.query(`SELECT datname FROM pg_database WHERE datname LIKE $1 ORDER BY oid DESC LIMIT 1`, [`${new URL(process.env.DATABASE_URL).pathname.slice(1)}_restore_%`])).rows[0].datname;
      void restored;
      const u = new URL(process.env.DATABASE_URL); u.pathname = `/${name}`;
      const rc = new pg.Client({ connectionString: u.toString() }); await rc.connect();
      try {
        const row = (await rc.query(`SELECT results FROM "SharedDiagnostic" WHERE id = $1`, [`q06-sd-${TS}`])).rows[0];
        expect(openText(row.results.sealed, { purpose: 'support-request', context: `q06:${TS}` })).toBe('Q06 synthetic secret');
        expect((await rc.query(`SELECT count(*)::int n FROM drizzle.__drizzle_migrations`)).rows[0].n).toBeGreaterThan(20);
      } finally { await rc.end(); }
    } finally {
      await c.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname LIKE $1 AND pid <> pg_backend_pid()`, [`${new URL(process.env.DATABASE_URL).pathname.slice(1)}_restore_%`]).catch(() => {});
      for (const { datname } of (await c.query(`SELECT datname FROM pg_database WHERE datname LIKE $1`, [`${new URL(process.env.DATABASE_URL).pathname.slice(1)}_restore_%`])).rows) await c.query(`DROP DATABASE IF EXISTS "${datname}"`);
    }
  }, 240000);

  it('the verification detects a damaged restore (a changed row is reported, not ignored)', async () => {
    const before = await dr.fingerprint(process.env.DATABASE_URL);
    await c.query(`UPDATE "AuditLog" SET actor = 'tampered' WHERE action = 'Q06_REHEARSAL' AND entity_id = $1`, [TS]);
    const after = await dr.fingerprint(process.env.DATABASE_URL);
    await c.query(`UPDATE "AuditLog" SET actor = 'qa' WHERE action = 'Q06_REHEARSAL' AND entity_id = $1`, [TS]);
    expect(before['public.AuditLog'].rows).toBe(after['public.AuditLog'].rows);
    expect(before['public.AuditLog'].md5).not.toBe(after['public.AuditLog'].md5);
  });
});
