// D5 b — scripts/db-erasure-replay.mjs reads the second copy (--copy) and refuses `--execute` while the tombstone history cannot be trusted. The
// tombstone checks run BEFORE any database contact, so an unreachable target proves how far the replay got: TOMBSTONES_INCOMPLETE = refused at the
// tombstones; ECONNREFUSED = past them. Local fake S3 bucket (loopback); async child processes (the fake bucket runs in this process).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { startFakeS3 } from '../helpers/fake-s3.mjs';
import { copyConfig, createTombstoneCopy, sealObject } from '../../api/_services/erasure-tombstone-copy.js';
import { createErasureTombstones } from '../../api/_services/erasure-tombstones.js';
import { writeLedgerFile, ledgerOf } from '../../scripts/db-erasure-replay.mjs';

const ROOT = path.resolve(__dirname, '../..');
const BUCKET = 'ada-erasure-tombstones';
const COPY_KEY = crypto.randomBytes(32).toString('hex');
const BACKUP_KEY = crypto.randomBytes(32).toString('hex');
let s3; let work; let ledger; let env;
const run = (args, extra = {}) => new Promise((resolve) => {
  execFile(process.execPath, ['scripts/db-erasure-replay.mjs', '--ledger', ledger, '--since', '2000-01-01T00:00:00Z', '--confirm-target', '127.0.0.1/x', ...args],
    { cwd: ROOT, env: { ...env, ...extra }, encoding: 'utf8', timeout: 60000 }, (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, out: `${stdout}\n${stderr}` }));
});
const kvStub = () => { const m = new Map(); return { isRemote: true, async lpush(k, v) { const l = m.get(k) || []; l.unshift(v); m.set(k, l); }, async ltrim() {}, async expire() {},
  async set(k, v) { m.set(k, v); }, async get(k) { return m.get(k) ?? null; }, async lrange(k) { return m.get(k) || []; } }; };

beforeAll(async () => {
  s3 = await startFakeS3({ bucket: BUCKET, keys: { tombkey: { write: true } } });
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-d5b-')); ledger = path.join(work, 'ledger.json.enc');
  await writeLedgerFile(ledgerOf([], new Date()), ledger, Buffer.from(BACKUP_KEY, 'hex'));
  env = { PATH: process.env.PATH, HOME: os.homedir(), TZ: 'UTC', BACKUP_ENCRYPTION_KEY: BACKUP_KEY, TARGET_DATABASE_URL: 'postgres://u@127.0.0.1:1/x',
    TOMBSTONE_COPY_S3_ENDPOINT: s3.endpoint, TOMBSTONE_COPY_S3_BUCKET: BUCKET, TOMBSTONE_COPY_S3_ACCESS_KEY_ID: 'tombkey', TOMBSTONE_COPY_S3_SECRET_ACCESS_KEY: 'fake-secret',
    TOMBSTONE_COPY_KEY: COPY_KEY };
  const copy = createTombstoneCopy(copyConfig(env));
  const t = createErasureTombstones({ kv: kvStub(), requireRemote: true, copy, log: { error() {}, warn() {} } });
  const p = { requestId: crypto.randomUUID(), subjectId: crypto.randomUUID(), domains: ['account'] };
  await t.record(p); await t.complete(p);
}, 60000);
afterAll(async () => { await s3?.close(); if (work) fs.rmSync(work, { recursive: true, force: true }); });

describe('D5 b — replay with the second copy', () => {
  it('--copy alone: refused (Upstash not read) unless the operator accepts the copy alone; then it goes on to the database', async () => {
    const a = await run(['--copy', '--execute']);
    expect(a.code).not.toBe(0); expect(a.out).toMatch(/TOMBSTONES_INCOMPLETE/); expect(a.out).toMatch(/KV:NOT_READ/);
    const b = await run(['--copy', '--accept-single-copy', 'copy', '--execute']);
    expect(b.code).not.toBe(0); expect(b.out).not.toMatch(/TOMBSTONES_INCOMPLETE/); expect(b.out).toMatch(/ECONNREFUSED|erreur inattendue/);
  }, 90000);
  it('the output never shows the copy key, the bucket secret or an identifier', async () => {
    const b = await run(['--copy', '--accept-single-copy', 'copy', '--execute']);
    for (const v of [COPY_KEY, 'fake-secret', BACKUP_KEY]) expect(b.out).not.toContain(v);
  }, 60000);
  it('a forged object refuses even with the copy accepted alone', async () => {
    const name = [...s3.objects.keys()].find((n) => n.includes('/t/'));
    const saved = s3.objects.get(name);
    s3.objects.set(name, { ...saved, body: Buffer.from(sealObject(crypto.randomBytes(32), name, { forged: true })) });
    const r = await run(['--copy', '--accept-single-copy', 'copy', '--execute']);
    s3.objects.set(name, saved);
    expect(r.out).toMatch(/TOMBSTONES_INCOMPLETE/); expect(r.out).toMatch(/COPY:TOMBSTONE_COPY_TAMPERED/);
  }, 60000);
  it('invalid copy variables, or --copy without them, refuse', async () => {
    const r = await run(['--copy', '--execute'], { TOMBSTONE_COPY_KEY: 'short' });
    expect(r.out).toMatch(/COPY_KEY_INVALID/);
    const r2 = await run(['--copy', '--execute'], { TOMBSTONE_COPY_S3_ENDPOINT: '', TOMBSTONE_COPY_S3_BUCKET: '', TOMBSTONE_COPY_S3_ACCESS_KEY_ID: '', TOMBSTONE_COPY_S3_SECRET_ACCESS_KEY: '', TOMBSTONE_COPY_KEY: '' });
    expect(r2.out).toMatch(/--copy : les variables TOMBSTONE_COPY_\* sont nécessaires/);
    const r3 = await run(['--copy', '--accept-single-copy', 'both', '--execute']);
    expect(r3.out).toMatch(/--accept-single-copy : kv ou copy/);
  }, 60000);
});
