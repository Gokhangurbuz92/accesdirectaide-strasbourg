// V2 data integrity (owner reviews 09/11/2026) — an erasure completed AFTER the newest backup must not come back silently when that backup is
// restored, and an erasure that never completed must never delete anyone during a restore. Synthetic LAB scenarios on a real PostgreSQL:
//   A. DSR erasure between two backups: the ledger misses it, the `done` tombstone names it, the replay erases it;
//   B. tombstone recorded, then the database erasure FAILS: `aborted` → never replayed (the person, still present, is not wrongly deleted);
//   C. intent only (the abort marker could not be written either): UNCONFIRMED → `--execute` refuses; `--skip-unconfirmed` keeps the person;
//   D. the database erasure succeeds but the KV store fails afterwards: `tombstoneDone: false` → the restore REPORTS it (never silent);
//   E. KV unavailable before the erasure: nothing erased, request not completed (fail-closed);
//   F. restore with a lost list (marker younger than 40 days, no record) → `--execute` refuses; with a legitimately expired list → proceeds;
//   G. automatic step 6c (never-confirmed account) between two backups: the restored copy holds it again; the purge re-run (disaster procedure)
//      erases it again — the criterion is in the data, no tombstone is needed.
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
import { createErasureTombstones, TOMBSTONE_TTL_SECONDS } from '../../api/_services/erasure-tombstones.js';
import { approvalEnv, approvedTestPolicy } from '../helpers/gdpr-purge-approval.js';

const ADMIN = process.env.CLOUD_BACKUP_E2E_ADMIN_URL || process.env.DATABASE_URL;
const SOURCE_DB = process.env.CLOUD_BACKUP_E2E_SOURCE_DB || (process.env.DATABASE_URL ? decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)) : '');
const run = ADMIN && SOURCE_DB ? describe : describe.skip;
const ROOT = path.resolve(__dirname, '../..');
const dbUrl = (name) => { const u = new URL(ADMIN); u.pathname = `/${name}`; return u.toString(); };
const target = (name) => `${new URL(ADMIN).hostname}/${name}`;

/** an in-memory KV (stands for Upstash) with switchable failures: `fail` = every write fails; `failAfter(n)` = writes fail after n more */
const memoryKv = (remote = true) => { const m = new Map(); let left = Infinity; const k = { isRemote: remote, fail: false,
  failAfter(n) { left = n; }, heal() { left = Infinity; k.fail = false; },
  _w() { if (k.fail || left <= 0) throw new Error('KV down'); left -= 1; },
  async lpush(key, v) { k._w(); const l = m.get(key) || []; l.unshift(v); m.set(key, l); return l.length; },
  async lrange(key, a, b) { const l = m.get(key) || []; return l.slice(a, b < 0 ? l.length + b + 1 : b + 1); },
  async ltrim() { k._w(); return 'OK'; }, async expire() { k._w(); return 1; },
  async set(key, v) { k._w(); m.set(key, v); return 'OK'; }, async get(key) { return m.get(key) ?? null; },
  dropList(key) { m.delete(key); } }; return k; };

run('V2 erasure tombstones and restoration (LAB, synthetic)', () => {
  const key = crypto.randomBytes(32).toString('hex');
  let work; let pool; let db; const people = {}; const restoreDbs = [];
  const env = (extra) => ({ PATH: process.env.PATH, HOME: os.homedir(), TZ: 'UTC', PG_BIN: process.env.PG_BIN || '', BACKUP_ENCRYPTION_KEY: key, ...extra });
  const node = (args, extra, pre = []) => { const r = spawnSync(process.execPath, [...pre, ...args], { cwd: ROOT, env: env(extra), encoding: 'utf8' });
    let out = {}; try { out = JSON.parse(String(r.stdout).trim().split('\n').filter(Boolean).pop() || '{}'); } catch { out = {}; }
    return { status: r.status, out, all: `${r.stdout}\n${r.stderr}` }; };
  const admin = async (q) => { const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); try { return await c.query(q); } finally { await c.end(); } };
  const count = async (dbName, id) => { const c = new pg.Client({ connectionString: dbUrl(dbName) }); await c.connect(); try { return (await c.query(`SELECT count(*)::int n FROM "CitizenUser" WHERE id = $1`, [id])).rows[0].n; } finally { await c.end(); } };
  const addPerson = async (name, { verified = true, ageDays = 0 } = {}) => { const id = crypto.randomUUID(); people[name] = id;
    await pool.query(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "createdAt", "updatedAt") VALUES ($1, $2, 'x', ${verified ? 'now()' : 'NULL'}, now() - make_interval(days => $3), now())`,
      [id, `synthetic-tomb-${id}@example.invalid`, ageDays]); return id; };
  const svcWith = (kv) => createPrivacyRightsService({ db, cryptoLib: crypto, tombstones: createErasureTombstones({ kv, requireRemote: true }) });
  const approved = async (svc, id) => { const r = await svc.requestDeletion(id); await svc.updateDsrRequestStatus(r.id, 'APPROVED'); return r.id; };
  const backup = (dir) => { const b = node(['scripts/db-backup.mjs', '--out', dir, '--label', 'lab'], { DATABASE_URL: dbUrl(SOURCE_DB) }); expect(b.status, b.all).toBe(0);
    return path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.dump.enc'))); };
  const ledger = (dir) => { const l = node(['scripts/db-erasure-replay.mjs', '--export', '--out', dir], { DATABASE_URL: dbUrl(SOURCE_DB) }); expect(l.status, l.all).toBe(0);
    return path.join(dir, fs.readdirSync(dir).find((f) => f.startsWith('ada_erasures_'))); };
  const restore = async (dump) => { const n = `ada_tomb_restore_${crypto.randomBytes(4).toString('hex')}`; await admin(`CREATE DATABASE ${n}`); restoreDbs.push(n);
    const r = node(['scripts/db-restore.mjs', '--file', dump, '--confirm-target', target(n), '--work-dir', work], { TARGET_DATABASE_URL: dbUrl(n) }); expect(r.status, r.all).toBe(0); return n; };
  const snapFile = async (kv, name) => { const f = path.join(work, `${name}.json`); fs.writeFileSync(f, JSON.stringify(await createErasureTombstones({ kv }).snapshot()), { mode: 0o600 }); return f; };
  const replay = (n, dump, led, extra = [], tsx = false) => node(['scripts/db-erasure-replay.mjs', '--ledger', led, '--since-backup', dump, '--confirm-target', target(n), ...extra],
    { TARGET_DATABASE_URL: dbUrl(n) }, tsx ? ['--import', 'tsx'] : []);

  let B; let L; let main;
  beforeAll(async () => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-tomb-')); fs.chmodSync(work, 0o700);
    pool = new pg.Pool({ connectionString: dbUrl(SOURCE_DB), max: 3 }); db = drizzle(pool, { schema });
    for (const n of ['erasedAfter', 'failedErasure', 'unconfirmed', 'kvDiesAfterCommit', 'kvDown']) await addPerson(n);
    await addPerson('neverConfirmed', { verified: false, ageDays: 8 });
    const d1 = fs.mkdtempSync(path.join(work, 'b1-'));
    B = backup(d1); await new Promise((r) => setTimeout(r, 1100)); L = ledger(d1);
    main = await restore(B);   // restored once more per scenario below where needed
    await admin(`DROP DATABASE ${main}`); restoreDbs.pop();
  }, 180000);
  afterAll(async () => {
    for (const id of Object.values(people)) await pool?.query(`DELETE FROM "CitizenUser" WHERE id = $1`, [id]).catch(() => {});
    await pool?.end();
    for (const n of restoreDbs) await admin(`DROP DATABASE IF EXISTS ${n} WITH (FORCE)`).catch(() => {});
    if (work) fs.rmSync(work, { recursive: true, force: true });
  });

  it('A–D: done is replayed, aborted is not, intent-only blocks --execute, a lost done marker is reported (never silent, never wrongful)', async () => {
    const kv = memoryKv(true);
    // A. completed erasure after B
    await svcWith(kv).executeApprovedDeletion(await approved(svcWith(kv), people.erasedAfter));
    // B. tombstone recorded, database erasure fails → aborted, person still present
    const s = svcWith(kv); const reqB = await approved(s, people.failedErasure);
    s.deleteDataDomains = async () => { throw Object.assign(new Error('DB_DOWN'), { code: 'DB_DOWN' }); };
    await expect(s.executeApprovedDeletion(reqB)).rejects.toMatchObject({ code: 'DB_DOWN' });
    expect(await count(SOURCE_DB, people.failedErasure)).toBe(1);
    // C. intent recorded, then the KV dies before the abort marker and the erasure fails → intent only
    const s2 = svcWith(kv); const reqC = await approved(s2, people.unconfirmed);
    s2.deleteDataDomains = async () => { kv.fail = true; throw Object.assign(new Error('DB_DOWN'), { code: 'DB_DOWN' }); };
    await expect(s2.executeApprovedDeletion(reqC)).rejects.toMatchObject({ code: 'DB_DOWN' }); kv.heal();
    expect(await count(SOURCE_DB, people.unconfirmed)).toBe(1);
    // D. erasure commits, the KV fails right after (done marker lost)
    const s3 = svcWith(kv); const reqD = await approved(s3, people.kvDiesAfterCommit);
    const realDelete = s3.deleteDataDomains.bind(s3);
    s3.deleteDataDomains = async (...a) => { const out = await realDelete(...a); kv.fail = true; return out; };
    const sum = await s3.executeApprovedDeletion(reqD); kv.heal();
    expect(sum.tombstoneDone).toBe(false);
    expect(await count(SOURCE_DB, people.kvDiesAfterCommit)).toBe(0);

    // disaster: B restored (all four people back)
    const n = await restore(B);
    for (const p of ['erasedAfter', 'failedErasure', 'unconfirmed', 'kvDiesAfterCommit']) expect(await count(n, people[p]), p).toBe(1);
    const tf = await snapFile(kv, 'snapAD');
    const dry = replay(n, B, L, ['--tombstones-file', tf]);
    expect(dry.out).toMatchObject({ mode: 'dry-run', tombstoneSource: 'file', tombstonesAdded: 1, tombstonesAborted: 1, tombstonesUnconfirmed: 2, tombstoneProblems: [] });
    // C + D: --execute refuses while unconfirmed erasures exist (nothing replayed)
    const refused = replay(n, B, L, ['--tombstones-file', tf, '--execute'], true);
    expect(refused.status).not.toBe(0);
    expect(refused.all).toMatch(/UNCONFIRMED_TOMBSTONES/);
    expect(await count(n, people.erasedAfter)).toBe(1);
    // operator: skip the unconfirmed ones → only the done erasure is replayed; the failed and unconfirmed people stay
    const ex = replay(n, B, L, ['--tombstones-file', tf, '--execute', '--skip-unconfirmed'], true);
    expect(ex.status, ex.all).toBe(0);
    expect(ex.out).toMatchObject({ mode: 'execute', replayed: 1, failed: 0 });
    expect(await count(n, people.erasedAfter)).toBe(0);
    expect(await count(n, people.failedErasure)).toBe(1);
    expect(await count(n, people.unconfirmed)).toBe(1);
    expect(await count(n, people.kvDiesAfterCommit)).toBe(1);   // reported as unconfirmed (dry run above), left to the operator's decision
  }, 240000);

  it('E: KV unavailable before the erasure → nothing erased, request not completed', async () => {
    const kv = memoryKv(true); kv.fail = true;
    const s = svcWith(kv); const req = await approved(s, people.kvDown);
    await expect(s.executeApprovedDeletion(req)).rejects.toMatchObject({ code: 'ERASURE_TOMBSTONE_UNAVAILABLE' });
    expect(await count(SOURCE_DB, people.kvDown)).toBe(1);
    expect((await pool.query(`SELECT status FROM "DSRRequest" WHERE id = $1`, [req])).rows[0].status).toBe('APPROVED');
  });

  it('F: a lost tombstone list (marker younger than 40 days) blocks --execute; a legitimately expired list does not', async () => {
    const n = await restore(B);
    const kv = memoryKv(true);
    await createErasureTombstones({ kv }).record({ requestId: crypto.randomUUID(), subjectId: crypto.randomUUID(), domains: ['CitizenProfile'] });
    kv.dropList('ada:erasure-tombstones:v1');   // eviction / flush: the list is gone, the TTL-less marker remains
    const lost = await snapFile(kv, 'lost');
    expect(replay(n, B, L, ['--tombstones-file', lost]).out.tombstoneProblems).toEqual(['TOMBSTONE_LAST_RECORD_MISSING']);
    const r = replay(n, B, L, ['--tombstones-file', lost, '--execute'], true);
    expect(r.status).not.toBe(0); expect(r.all).toMatch(/TOMBSTONES_INCOMPLETE/);
    // expired: the marker is older than the 40-day TTL and the list has expired with it → no erasure in that window, proceed
    const old = JSON.parse(fs.readFileSync(lost, 'utf8')); old.last.completedAt = new Date(Date.now() - (TOMBSTONE_TTL_SECONDS + 3600) * 1000).toISOString();
    const expired = path.join(work, 'expired.json'); fs.writeFileSync(expired, JSON.stringify(old), { mode: 0o600 });
    expect(replay(n, B, L, ['--tombstones-file', expired]).out.tombstoneProblems).toEqual([]);
    // missing altogether: --execute without any tombstone source refuses
    const none = replay(n, B, L, ['--execute'], true);
    expect(none.status).not.toBe(0); expect(none.all).toMatch(/--execute exige --kv ou --tombstones-file/);
  }, 180000);

  it('G: automatic step 6c between two backups — the restored copy holds the account again; the purge re-run erases it again', async () => {
    if (!process.env.DATABASE_URL) process.env.DATABASE_URL = dbUrl(SOURCE_DB);
    const { runGdprPurge } = await import('../../api/_handlers/cron/gdpr-purge.js');
    const policy = approvedTestPolicy({ a7: 365, steps: ['unverifiedAccountsDeleted'] });
    const penv = approvalEnv(['unverifiedAccountsDeleted'], { a7: 365 });
    const first = await runGdprPurge({ database: db, policy, env: penv });
    expect(first.execute ?? first.executed ?? true).toBeTruthy();
    expect(await count(SOURCE_DB, people.neverConfirmed)).toBe(0);   // erased by 6c after B
    const n = await restore(B);
    expect(await count(n, people.neverConfirmed)).toBe(1);             // back with the restore
    const rpool = new pg.Pool({ connectionString: dbUrl(n), max: 2 });
    try { await runGdprPurge({ database: drizzle(rpool, { schema }), policy, env: penv }); } finally { await rpool.end(); }
    expect(await count(n, people.neverConfirmed)).toBe(0);             // the criterion is in the data: the re-run erases it again
    // and a confirmed account of the same age is never touched by 6c
    expect(await count(n, people.failedErasure)).toBe(1);
  }, 180000);
});
