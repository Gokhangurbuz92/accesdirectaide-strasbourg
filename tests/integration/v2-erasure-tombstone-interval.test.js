// V2 (owner review 09/11/2026) — an erasure completed AFTER the newest backup must not come back silently when that backup is restored.
// Synthetic LAB scenario: backup B + its ledger L → a person is erased (through the real DSR erasure engine) → the database is « lost » → B is restored into
// an empty database. Shown: L alone does not name the person (the gap); the erasure tombstone (written before the erasure, outside the database) does,
// and the replay erases them; a real replay refuses to run without tombstones; no tombstone ⇒ no erasure (fail-closed).
// Database: CLOUD_BACKUP_E2E_ADMIN_URL + CLOUD_BACKUP_E2E_SOURCE_DB, or the integration suite's own DATABASE_URL (as v2-cloud-backup-e2e).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/db/schema.js';
import { createPrivacyRightsService } from '../../api/_services/privacy.js';
import { createErasureTombstones } from '../../api/_services/erasure-tombstones.js';

const ADMIN = process.env.CLOUD_BACKUP_E2E_ADMIN_URL || process.env.DATABASE_URL;
const SOURCE_DB = process.env.CLOUD_BACKUP_E2E_SOURCE_DB || (process.env.DATABASE_URL ? decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)) : '');
const run = ADMIN && SOURCE_DB ? describe : describe.skip;
const ROOT = path.resolve(__dirname, '../..');
const dbUrl = (name) => { const u = new URL(ADMIN); u.pathname = `/${name}`; return u.toString(); };
const target = (name) => `${new URL(ADMIN).hostname}/${name}`;

/** an in-memory KV with the list operations the tombstones use (stands for Upstash; `remote` says whether it counts as the real store) */
const memoryKv = (remote = true) => { const m = new Map(); return { isRemote: remote,
  async lpush(k, v) { const l = m.get(k) || []; l.unshift(v); m.set(k, l); return l.length; },
  async lrange(k, a, b) { const l = m.get(k) || []; return l.slice(a, b < 0 ? l.length + b + 1 : b + 1); },
  async ltrim() { return 'OK'; }, async expire() { return 1; } }; };

run('V2 erasure between two backups (LAB, synthetic)', () => {
  const key = crypto.randomBytes(32).toString('hex');
  let work; let pool; let restoreDb; const person = crypto.randomUUID(); const kvStore = memoryKv(true);
  const env = (extra) => ({ PATH: process.env.PATH, HOME: os.homedir(), TZ: 'UTC', PG_BIN: process.env.PG_BIN || '', BACKUP_ENCRYPTION_KEY: key, ...extra });
  const node = (args, extra) => { const r = spawnSync(process.execPath, args, { cwd: ROOT, env: env(extra), encoding: 'utf8' });
    let out = {}; try { out = JSON.parse(String(r.stdout).trim().split('\n').filter(Boolean).pop() || '{}'); } catch { out = {}; }
    return { status: r.status, out, all: `${r.stdout}\n${r.stderr}` }; };
  const admin = async (q) => { const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); try { return await c.query(q); } finally { await c.end(); } };
  let dump; let ledger;

  beforeAll(async () => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-tomb-')); fs.chmodSync(work, 0o700);
    pool = new pg.Pool({ connectionString: dbUrl(SOURCE_DB), max: 2 });
    await pool.query(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES ($1, $2, 'x', now(), now())`, [person, `synthetic-tomb-${person}@example.invalid`]);
    // backup B and the ledger exported with it (what the producer job uploads)
    const b = node(['scripts/db-backup.mjs', '--out', work, '--label', 'lab'], { DATABASE_URL: dbUrl(SOURCE_DB) });
    expect(b.status, b.all).toBe(0);
    dump = fs.readdirSync(work).find((f) => f.endsWith('.dump.enc'));
    await new Promise((r) => setTimeout(r, 1100));
    const l = node(['scripts/db-erasure-replay.mjs', '--export', '--out', work], { DATABASE_URL: dbUrl(SOURCE_DB) });
    expect(l.status, l.all).toBe(0);
    ledger = fs.readdirSync(work).find((f) => f.startsWith('ada_erasures_'));
    restoreDb = `ada_tomb_restore_${crypto.randomBytes(4).toString('hex')}`;
    await admin(`CREATE DATABASE ${restoreDb}`);
  }, 120000);
  afterAll(async () => {
    await pool?.query(`DELETE FROM "CitizenUser" WHERE id = $1`, [person]).catch(() => {});
    await pool?.end();
    if (restoreDb) await admin(`DROP DATABASE IF EXISTS ${restoreDb}`).catch(() => {});
    if (work) fs.rmSync(work, { recursive: true, force: true });
  });

  it('fail-closed: without a real tombstone store in Production, nothing is erased and the request is not completed', async () => {
    const svc = createPrivacyRightsService({ db: drizzle(pool, { schema }), cryptoLib: crypto, tombstones: createErasureTombstones({ kv: memoryKv(false), requireRemote: true }) });
    const req = await svc.requestDeletion(person);
    await svc.updateDsrRequestStatus(req.id, 'APPROVED');
    await expect(svc.executeApprovedDeletion(req.id)).rejects.toMatchObject({ code: 'ERASURE_TOMBSTONE_UNAVAILABLE' });
    expect((await pool.query(`SELECT count(*)::int n FROM "CitizenUser" WHERE id = $1`, [person])).rows[0].n).toBe(1);
    expect((await pool.query(`SELECT status FROM "DSRRequest" WHERE id = $1`, [req.id])).rows[0].status).not.toBe('COMPLETED');
    await pool.query(`UPDATE "DSRRequest" SET status = 'REJECTED' WHERE id = $1`, [req.id]);
  });

  it('erasure AFTER the backup: the ledger misses it, the tombstone names it, the replay erases it', async () => {
    // 1. the person is erased after B (real DSR engine; the tombstone is written first)
    const svc = createPrivacyRightsService({ db: drizzle(pool, { schema }), cryptoLib: crypto, tombstones: createErasureTombstones({ kv: kvStore, requireRemote: true }) });
    const req = await svc.requestDeletion(person);
    await svc.updateDsrRequestStatus(req.id, 'APPROVED');
    await svc.executeApprovedDeletion(req.id);
    expect((await pool.query(`SELECT count(*)::int n FROM "CitizenUser" WHERE id = $1`, [person])).rows[0].n).toBe(0);
    const tombs = await createErasureTombstones({ kv: kvStore }).list();
    expect(tombs.filter((t) => t.requestId === req.id)).toEqual([expect.objectContaining({ subjectId: person, kind: 'ada-erasure-tombstone' })]);
    expect(JSON.stringify(tombs)).not.toContain('example.invalid');   // no e-mail in a tombstone
    // 2. « disaster »: B is restored into an empty database — the person is back
    const r = node(['scripts/db-restore.mjs', '--file', path.join(work, dump), '--confirm-target', target(restoreDb), '--work-dir', work], { TARGET_DATABASE_URL: dbUrl(restoreDb) });
    expect(r.status, r.all).toBe(0);
    const back = async () => { const c = new pg.Client({ connectionString: dbUrl(restoreDb) }); await c.connect(); try { return (await c.query(`SELECT count(*)::int n FROM "CitizenUser" WHERE id = $1`, [person])).rows[0].n; } finally { await c.end(); } };
    expect(await back()).toBe(1);
    const base = ['scripts/db-erasure-replay.mjs', '--ledger', path.join(work, ledger), '--since-backup', path.join(work, dump), '--confirm-target', target(restoreDb)];
    const renv = { TARGET_DATABASE_URL: dbUrl(restoreDb) };
    // 3. THE GAP: the ledger exported with B does not know this erasure → presentAgain 0 although the person is in the restored copy
    const gap = node(base, renv);
    expect(gap.status, gap.all).toBe(0);
    expect(gap.out).toMatchObject({ mode: 'dry-run', presentAgain: 0, tombstoneSource: 'none' });
    // 4. a real replay refuses to run without the tombstones
    const refused = node([...base, '--execute'], renv);
    expect(refused.status).not.toBe(0);
    expect(refused.all).toMatch(/--execute exige --kv ou --tombstones-file/);
    expect(await back()).toBe(1);
    // 5. with the tombstones: named, then erased
    const tf = path.join(work, 'tombstones.json'); fs.writeFileSync(tf, JSON.stringify(tombs), { mode: 0o600 });
    const dry = node([...base, '--tombstones-file', tf], renv);
    expect(dry.out).toMatchObject({ mode: 'dry-run', presentAgain: 1, tombstoneSource: 'file', tombstonesAdded: 1 });
    const ex = spawnSync(process.execPath, ['--import', 'tsx', ...base, '--tombstones-file', tf, '--execute'], { cwd: ROOT, env: env(renv), encoding: 'utf8' });
    expect(ex.status, `${ex.stdout}\n${ex.stderr}`).toBe(0);
    expect(JSON.parse(String(ex.stdout).trim().split('\n').pop())).toMatchObject({ mode: 'execute', replayed: 1, failed: 0 });
    expect(await back()).toBe(0);
  }, 180000);
});
