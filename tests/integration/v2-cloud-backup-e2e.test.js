// V2 C7 — end-to-end LAB proof of the cloud-only backup: producer job → (fake, loopback) S3 bucket → independent verifier → empty disposable database.
// Database: CLOUD_BACKUP_E2E_ADMIN_URL + CLOUD_BACKUP_E2E_SOURCE_DB, or else the integration suite's own DATABASE_URL (a migrated LAB database whose role
// may create the disposable restore databases — the native QA's run database). pg_dump / pg_restore on PATH (or PG_BIN). Synthetic rows only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import pg from 'pg';
import { startFakeS3 } from '../helpers/fake-s3.mjs';
import { generateBackupKeyPair } from '../../scripts/db-backup.mjs';
import { generateSigningKeyPair } from '../../scripts/lib/backup-bucket.mjs';
import { checkEvidence } from '../../scripts/check-restore-evidence.mjs';

const ADMIN = process.env.CLOUD_BACKUP_E2E_ADMIN_URL || process.env.DATABASE_URL;
const SOURCE_DB = process.env.CLOUD_BACKUP_E2E_SOURCE_DB || (process.env.DATABASE_URL ? decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)) : '');
const run = ADMIN && SOURCE_DB ? describe : describe.skip;
const ROOT = path.resolve(__dirname, '../..');
const dbUrl = (name) => { const u = new URL(ADMIN); u.pathname = `/${name}`; return u.toString(); };
const target = (name) => `${new URL(ADMIN).hostname}/${name}`;

run('V2 C7 cloud backup (LAB, fake bucket)', () => {
  let s3; let hc; const pings = []; let keyDir; let pubPem; const signing = generateSigningKeyPair(); const passphrase = crypto.randomBytes(24).toString('hex');
  const rw = { id: 'AKLABWRITER0000001', secret: crypto.randomBytes(20).toString('hex') };
  const ro = { id: 'AKLABREADER0000001', secret: crypto.randomBytes(20).toString('hex') };
  const sub = crypto.randomUUID();
  const restoreDbs = [];
  let migrations = 0;   // the source's own history length (Production at 0042 would be 43)

  const producerEnv = (extra = {}) => ({ PATH: process.env.PATH, HOME: os.homedir(), TZ: 'UTC', PG_BIN: process.env.PG_BIN || '', DATABASE_URL: dbUrl(SOURCE_DB),
    BACKUP_PUBLIC_KEY: pubPem, BACKUP_S3_ENDPOINT: s3.endpoint, BACKUP_S3_BUCKET: 'ada-backups-lab', BACKUP_S3_ACCESS_KEY_ID: rw.id,
    BACKUP_S3_SECRET_ACCESS_KEY: rw.secret, BACKUP_HEALTHCHECK_URL: `${hc.url}/producer`, BACKUP_SIGNING_KEY: signing.privatePem, ...extra });
  const verifierEnv = (db, extra = {}) => ({ PATH: process.env.PATH, HOME: os.homedir(), TZ: 'UTC', PG_BIN: process.env.PG_BIN || '', TARGET_DATABASE_URL: dbUrl(db),
    BACKUP_PRIVATE_KEY_FILE: path.join(keyDir, 'backup-private.pem'), BACKUP_PRIVATE_KEY_PASSPHRASE: passphrase, BACKUP_S3_ENDPOINT: s3.endpoint,
    BACKUP_S3_BUCKET: 'ada-backups-lab', BACKUP_S3_ACCESS_KEY_ID: ro.id, BACKUP_S3_SECRET_ACCESS_KEY: ro.secret, RESTORE_HEALTHCHECK_URL: `${hc.url}/verifier`, BACKUP_SIGNING_PUBLIC_KEY: signing.publicPem, ...extra });
  // async on purpose: the fake bucket and the healthcheck server live in THIS process (a sync spawn would block them)
  const node = (script, args, env) => new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { env, cwd: ROOT });
    let stdout = ''; let stderr = '';
    c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (status) => {
      let out = {}; try { out = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() || '{}'); } catch { out = {}; }
      resolve({ status, out, all: `${stdout}\n${stderr}` });
    });
  });
  const admin = async (sql) => { const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); try { return await c.query(sql); } finally { await c.end(); } };
  const src = async (sql, params) => { const c = new pg.Client({ connectionString: dbUrl(SOURCE_DB) }); await c.connect(); try { return await c.query(sql, params); } finally { await c.end(); } };
  const freshDb = async () => { const n = `ada_cb_restore_${crypto.randomBytes(4).toString('hex')}`; await admin(`CREATE DATABASE ${n}`); restoreDbs.push(n); return n; };
  const secretsIn = (text) => [rw.secret, ro.secret, passphrase, signing.privatePem.split('\n')[1]].filter((s) => text.includes(s));

  beforeAll(async () => {
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-cb-keys-'));
    const pair = generateBackupKeyPair(passphrase);
    fs.writeFileSync(path.join(keyDir, 'backup-private.pem'), pair.privatePem, { mode: 0o600 });
    pubPem = pair.publicPem;
    s3 = await startFakeS3({ bucket: 'ada-backups-lab', keys: { [rw.id]: { write: true }, [ro.id]: { write: false } } });
    const server = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { pings.push({ path: req.url, body: b }); res.end('OK'); }); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    hc = { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
    await src(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', now())`, [sub, `synthetic-${sub}@example.invalid`]);
    migrations = (await src('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).rows[0].n;
  }, 60000);

  afterAll(async () => {
    await src('DELETE FROM "DSRRequest" WHERE "subjectId" = $1', [sub]).catch(() => {});
    await src('DELETE FROM "CitizenUser" WHERE id = $1', [sub]).catch(() => {});
    for (const n of restoreDbs) await admin(`DROP DATABASE IF EXISTS ${n} WITH (FORCE)`).catch(() => {});
    await s3?.close(); await hc?.close();
    fs.rmSync(keyDir, { recursive: true, force: true });
  });

  it('refuses a producer that holds a decryption key, and names variables only', async () => {
    const r = await node('cloud-backup.mjs', ['--check-config'], producerEnv({ BACKUP_PRIVATE_KEY_PASSPHRASE: passphrase }));
    expect(r.status).toBe(1);
    expect(r.out.problems).toContain('DECRYPTION_KEY_PRESENT_IN_PRODUCER');
    expect(secretsIn(r.all)).toEqual([]);
  });

  let firstDump;
  it('producer: dump (ADAB2) + sidecar + erasure ledger uploaded and confirmed; healthcheck /start then success', async () => {
    const r = await node('cloud-backup.mjs', ['--run'], producerEnv());
    expect(r.status, r.all).toBe(0);
    expect(r.out.ok).toBe(true);
    expect(r.out.format).toBe('ADAB2');
    expect(r.out.uploaded.map((u) => u.key.replace(/\d{8}T\d{6}Z/, 'T'))).toEqual(['prod/ada_prod_T.dump.enc', 'prod/ada_prod_T.dump.enc.sha256', 'prod/ada_erasures_T.json.enc']);
    firstDump = r.out.uploaded[0].key;
    expect([...s3.objects.keys()].length).toBe(3);
    expect(pings.map((p) => p.path)).toEqual(['/producer/start', '/producer']);
    expect(secretsIn(r.all + JSON.stringify(pings))).toEqual([]);
    // nothing stored in clear: the object starts with the ADAB2 magic and does not contain the synthetic e-mail
    const body = s3.objects.get(firstDump).body;
    expect(body.subarray(0, 5).toString()).toBe('ADAB2');
    expect(body.includes(Buffer.from(`synthetic-${sub}`))).toBe(false);
  }, 120000);

  it('the producer cannot read its own backup (no private key in its environment)', async () => {
    const r = await node('db-backup.mjs', ['--verify', '/nonexistent'], producerEnv());
    expect(r.status).not.toBe(0);
  });

  it('verifier (read-only token, private key): restores into an empty database; structure, migrations and ledger checked', async () => {
    // the person is erased AFTER the first backup; the next run's ledger knows it
    await new Promise((r) => setTimeout(r, 1100));
    await src('DELETE FROM "CitizenUser" WHERE id = $1', [sub]);
    await src(`INSERT INTO "DSRRequest" (id, "subjectType", "subjectId", "requestType", status, "executionMode", "affectedDomains", "completedAt")
      VALUES ($1, 'CITIZEN', $2, 'DELETE', 'COMPLETED', 'AUTOMATED', '["account"]'::jsonb, now())`, [crypto.randomUUID(), sub]);
    const second = await node('cloud-backup.mjs', ['--run'], producerEnv());
    expect(second.status, second.all).toBe(0);
    const db = await freshDb();
    // a wrong expected history length is a failure (Production at 0042 is --expect-migrations 43)
    const wrong = await node('cloud-restore-verify.mjs', ['--key', firstDump, '--confirm-target', target(db), '--expect-migrations', String(migrations - 1)], verifierEnv(db));
    expect(wrong.status).toBe(1);
    expect(wrong.out.failures).toContain('MIGRATIONS_MISMATCH');
    const db2 = await freshDb();
    const r = await node('cloud-restore-verify.mjs', ['--key', firstDump, '--confirm-target', target(db2), '--expect-migrations', String(migrations)], verifierEnv(db2));
    expect(r.status, r.all).toBe(0);
    expect(r.out.ok).toBe(true);
    expect(r.out.checks.migrationsMatch).toBe(true);
    expect(r.out.checks.coreTablesMissing).toEqual([]);
    expect(r.out.restoredTables).toBeGreaterThan(50);
    // the restored copy holds the erased person again: the dry run says so (the replay must run before any use of the copy)
    expect(r.out.erasureReplay.presentAgain).toBe(1);
    // data minimisation: the restored copy is gone at the end (and was gone after the failing run too)
    expect(r.out.wiped).toBe(true);
    const left = async (n) => { const c = new pg.Client({ connectionString: dbUrl(n) }); await c.connect(); try { return (await c.query(`SELECT count(*)::int n FROM pg_tables WHERE schemaname IN ('public','drizzle')`)).rows[0].n; } finally { await c.end(); } };
    expect(await left(db2)).toBe(0);
    expect(await left(db)).toBe(0);
    // the same target can be used again next month
    const again = await node('cloud-restore-verify.mjs', ['--key', firstDump, '--confirm-target', target(db2), '--expect-migrations', String(migrations)], verifierEnv(db2));
    expect(again.status, again.all).toBe(0);
    expect(secretsIn(r.all)).toEqual([]);
    expect(r.all).not.toContain(`synthetic-${sub}`);
    const vp = pings.filter((p) => p.path.startsWith('/verifier'));
    expect(vp.map((p) => p.path)).toEqual(['/verifier/start', '/verifier/fail', '/verifier/start', '/verifier', '/verifier/start', '/verifier']);
    // durable record: the Healthchecks ping body IS the evidence (the job container is ephemeral); the checker accepts it and refuses the failed run
    const durable = JSON.parse(vp[3].body);
    expect(durable).toEqual(r.out);
    expect(checkEvidence(durable)).toMatchObject({ accepted: true, problems: [], summary: { wiped: true, erasedPeoplePresentAgain: 1 } });
    expect(durable.dumpSha256).toBe(crypto.createHash('sha256').update(s3.objects.get(firstDump).body).digest('hex'));
    const failed = checkEvidence(JSON.parse(vp[1].body));
    expect(failed.accepted).toBe(false);
    expect(failed.problems).toEqual(expect.arrayContaining(['NOT_OK', 'FAILURES_PRESENT', 'MIGRATIONS_NOT_MATCHED']));
    expect(JSON.parse(vp[1].body).wiped).toBe(true);
    expect(secretsIn(vp.map((p) => p.body).join('\n'))).toEqual([]);
  }, 180000);

  it('a tampered object is refused before anything is restored', async () => {
    const o = s3.objects.get(firstDump);
    const copy = Buffer.from(o.body); copy[copy.length - 40] ^= 0xff;
    s3.objects.set(firstDump, { ...o, body: copy });
    const db = await freshDb();
    const r = await node('cloud-restore-verify.mjs', ['--key', firstDump, '--confirm-target', target(db)], verifierEnv(db));
    expect(r.status).toBe(1);
    expect(r.out.code).toBe('OBJECT_DIGEST_MISMATCH');
    expect(r.out.wiped).toBe(null);   // nothing was restored, so nothing to wipe — stated in the durable failure record too
    expect(JSON.parse(pings.filter((p) => p.path === '/verifier/fail').pop().body)).toMatchObject({ ok: false, code: 'OBJECT_DIGEST_MISMATCH', wiped: null });
    const t = await (async () => { const c = new pg.Client({ connectionString: dbUrl(db) }); await c.connect(); try { return (await c.query(`SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'`)).rows[0].n; } finally { await c.end(); } })();
    expect(t).toBe(0);
    s3.objects.set(firstDump, o);
  }, 120000);

  it('the verifier refuses to run next to the live database, and its token cannot write', async () => {
    const db = await freshDb();
    const r = await node('cloud-restore-verify.mjs', ['--confirm-target', target(db)], verifierEnv(db, { DATABASE_URL: dbUrl(SOURCE_DB) }));
    expect(r.out.code).toBe('DATABASE_URL_PRESENT');
    const w = await node('cloud-backup.mjs', ['--run'], producerEnv({ BACKUP_S3_ACCESS_KEY_ID: ro.id, BACKUP_S3_SECRET_ACCESS_KEY: ro.secret }));
    expect(w.status).toBe(1);
    expect(w.out.code).toBe('BUCKET_ACCESS_DENIED');
    expect(pings.at(-1).path).toBe('/producer/fail');
  }, 120000);

  it('provenance (owner review 09/11/2026): a backup forged with ONLY the producer token + the public key is refused before any restore', async () => {
    // the attacker: no database access, no signing key — they encrypt a database of their choice (here: the LAB source with a planted row) with the
    // PUBLIC key, export a ledger the same way, and upload all three with the producer's write token, newer than every real backup
    const planted = crypto.randomUUID();
    await src(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', now())`, [planted, `planted-${planted}@example.invalid`]);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-forge-'));
    const attackerEnv = { PATH: process.env.PATH, HOME: os.homedir(), TZ: 'UTC', PG_BIN: process.env.PG_BIN || '', DATABASE_URL: dbUrl(SOURCE_DB), BACKUP_PUBLIC_KEY: pubPem };
    try {
      await new Promise((r) => setTimeout(r, 1100));
      expect((await node('db-backup.mjs', ['--out', out, '--label', 'prod'], attackerEnv)).status).toBe(0);
      expect((await node('db-erasure-replay.mjs', ['--export', '--out', out], attackerEnv)).status).toBe(0);
    } finally { await src('DELETE FROM "CitizenUser" WHERE id = $1', [planted]); }
    const { bucketConfig: bc, putFile: put, s3Client: mk } = await import('../../scripts/lib/backup-bucket.mjs');
    const { sha256OfFile: sha } = await import('../../scripts/db-backup.mjs');
    const cfg = bc({ BACKUP_S3_ENDPOINT: s3.endpoint, BACKUP_S3_BUCKET: 'ada-backups-lab', BACKUP_S3_ACCESS_KEY_ID: rw.id, BACKUP_S3_SECRET_ACCESS_KEY: rw.secret });
    const client = await mk(cfg);
    const forged = [];
    for (const f of fs.readdirSync(out)) { const key = `prod/${f}`; await put(client, cfg, path.join(out, f), key, await sha(path.join(out, f))); forged.push(key); }
    fs.rmSync(out, { recursive: true, force: true });
    const forgedDump = forged.find((k) => k.endsWith('.dump.enc'));
    try {
      const db = await freshDb();
      const r = await node('cloud-restore-verify.mjs', ['--confirm-target', target(db), '--expect-migrations', String(migrations), '--keep-restored'], verifierEnv(db));
      const left = async () => { const c = new pg.Client({ connectionString: dbUrl(db) }); await c.connect(); try { return (await c.query(`SELECT count(*)::int n FROM pg_tables WHERE schemaname = 'public'`)).rows[0].n; } finally { await c.end(); } };
      expect({ status: r.status, ok: r.out.ok, code: r.out.code, dump: r.out.dump ?? null }).toEqual({ status: 1, ok: false, code: 'DUMP_SIGNATURE_INVALID', dump: null });
      expect(await left()).toBe(0);   // nothing was restored from the forged object
      // a forged ledger next to a REAL dump is refused too (it could hide erasures from the replay)
      const db2 = await freshDb();
      const r2 = await node('cloud-restore-verify.mjs', ['--key', firstDump, '--confirm-target', target(db2), '--expect-migrations', String(migrations)], verifierEnv(db2));
      expect(r2.out.code).toBe('LEDGER_SIGNATURE_INVALID');
      // a REAL signed dump copied under a newer name is refused (the signature binds the object name, so an old backup cannot pose as the newest)
      const real = s3.objects.get(firstDump); const renamed = forgedDump.replace('.dump.enc', '.dump.enc').replace(/(\d{8}T\d{6})Z/, (m, t) => `${t.slice(0, -1)}${(Number(t.at(-1)) + 1) % 10}Z`);
      for (const k of forged) s3.objects.delete(k);
      s3.objects.set(renamed, real);
      const db3 = await freshDb();
      const r3 = await node('cloud-restore-verify.mjs', ['--key', renamed, '--confirm-target', target(db3), '--expect-migrations', String(migrations)], verifierEnv(db3));
      expect(r3.out.code).toBe('DUMP_SIGNATURE_INVALID');
      s3.objects.delete(renamed);
    } finally { for (const k of forged) s3.objects.delete(k); }
  }, 180000);

  it('missed run and overdue retention are alerts (after the new backup is stored)', async () => {
    // move every stored object 3 days back (names carry the time)
    const shift = (k, days) => k.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, (...m) => {
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - days * 86400000);
      return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    });
    for (const [k, o] of [...s3.objects.entries()]) { s3.objects.delete(k); s3.objects.set(shift(k, 3), o); }
    const old = [...s3.objects.entries()][0];
    s3.objects.set(shift(old[0], 40), old[1]);
    const r = await node('cloud-backup.mjs', ['--run'], producerEnv());
    expect(r.status).toBe(1);
    expect(r.out.alerts).toEqual(expect.arrayContaining(['PREVIOUS_RUN_MISSED', 'RETENTION_OVERDUE']));
    expect(pings.at(-1).path).toBe('/producer/fail');
    const p = await node('cloud-backup.mjs', ['--run', '--prune'], producerEnv());
    expect(p.out.pruned).toBeGreaterThanOrEqual(1);
    expect([...s3.objects.keys()].some((k) => k.includes(shift(old[0], 40).split('/').pop()))).toBe(false);
  }, 180000);
});
