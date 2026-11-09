// V2 C7 — cloud-only backup: configuration, naming, retention and freshness rules (pure), and the job image contents.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bucketConfig, bucketPlan, ledgerForDump, objectTime, pingUrl } from '../../scripts/lib/backup-bucket.mjs';
import { producerConfig } from '../../scripts/cloud-backup.mjs';

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const at = (hoursAgo) => new Date(NOW - hoursAgo * 3600000).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const pub = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
const bucketEnv = { BACKUP_S3_ENDPOINT: 'https://abc123.eu.r2.cloudflarestorage.com', BACKUP_S3_BUCKET: 'ada-db-backups', BACKUP_S3_ACCESS_KEY_ID: 'k', BACKUP_S3_SECRET_ACCESS_KEY: 's' };
const producerEnv = { ...bucketEnv, DATABASE_URL: 'postgresql://ada_backup_ro:x@ep-a.eu-central-1.aws.neon.tech/neondb?sslmode=require', BACKUP_PUBLIC_KEY: pub };

describe('bucket configuration', () => {
  it('accepts an R2 EU endpoint and flags the jurisdiction', () => {
    expect(bucketConfig(bucketEnv)).toMatchObject({ ok: true, region: 'auto', prefix: 'prod/', euJurisdiction: true });
    expect(bucketConfig({ ...bucketEnv, BACKUP_S3_ENDPOINT: 'https://abc123.r2.cloudflarestorage.com' })).toMatchObject({ ok: false, reason: 'BUCKET_ENDPOINT_NOT_EU_JURISDICTION' });
    expect(bucketConfig({ ...bucketEnv, BACKUP_S3_ENDPOINT: 'https://abc123.eu.r2.cloudflarestorage.com.evil.example' })).toMatchObject({ ok: false, reason: 'BUCKET_ENDPOINT_NOT_EU_JURISDICTION' });
    expect(bucketConfig({ ...bucketEnv, BACKUP_S3_ENDPOINT: 'https://s3.fr-par.scw.cloud' })).toMatchObject({ ok: false, reason: 'BUCKET_ENDPOINT_NOT_EU_JURISDICTION' });
  });
  it('refuses plain http (except loopback), credentials or paths in the endpoint, bad names, and names missing variables', () => {
    expect(bucketConfig({ ...bucketEnv, BACKUP_S3_ENDPOINT: 'http://abc.example.org' })).toMatchObject({ ok: false, reason: 'BUCKET_ENDPOINT_NOT_HTTPS' });
    expect(bucketConfig({ ...bucketEnv, BACKUP_S3_ENDPOINT: 'http://127.0.0.1:9000' }).ok).toBe(true);
    expect(bucketConfig({ ...bucketEnv, BACKUP_S3_ENDPOINT: 'https://u:p@abc.example.org' })).toMatchObject({ ok: false, reason: 'BUCKET_ENDPOINT_INVALID' });
    expect(bucketConfig({ ...bucketEnv, BACKUP_S3_ENDPOINT: 'https://abc.example.org/bucket' })).toMatchObject({ ok: false, reason: 'BUCKET_ENDPOINT_INVALID' });
    expect(bucketConfig({ ...bucketEnv, BACKUP_S3_BUCKET: 'Bad_Name' })).toMatchObject({ ok: false, reason: 'BUCKET_NAME_INVALID' });
    expect(bucketConfig({ ...bucketEnv, BACKUP_S3_PREFIX: '../x' })).toMatchObject({ ok: false, reason: 'BUCKET_PREFIX_INVALID' });
    const r = bucketConfig({ BACKUP_S3_BUCKET: 'ada-db-backups', BACKUP_S3_SECRET_ACCESS_KEY: 'very-secret-value' });
    expect(r).toMatchObject({ ok: false, missing: ['BACKUP_S3_ENDPOINT', 'BACKUP_S3_ACCESS_KEY_ID'] });
    expect(JSON.stringify(r)).not.toContain('very-secret-value');
  });
});

describe('producer configuration', () => {
  it('passes with a read-only unpooled TLS connection and a public key', () => { expect(producerConfig(producerEnv)).toMatchObject({ ok: true, problems: [], keepDays: 35 }); });
  it('refuses a producer whose environment holds a cloud API key (its identity could reach other secrets)', () => {
    for (const k of ['SCW_SECRET_KEY', 'AWS_SECRET_ACCESS_KEY', 'CLOUDFLARE_API_TOKEN']) expect(producerConfig({ ...producerEnv, [k]: 'x' }).problems).toContain('CLOUD_API_KEY_PRESENT_IN_PRODUCER');
  });
  it('refuses a decryption key in the producer, a pooled host, no TLS, a short key, a bad ping URL — by name only', () => {
    const r = producerConfig({ ...producerEnv, BACKUP_PRIVATE_KEY_PASSPHRASE: 'pass-phrase-value-123',
      DATABASE_URL: 'postgresql://u:pw-value@ep-a-pooler.eu-central-1.aws.neon.tech/neondb', BACKUP_HEALTHCHECK_URL: 'ftp://x' });
    expect(r.problems).toEqual(expect.arrayContaining(['DECRYPTION_KEY_PRESENT_IN_PRODUCER', 'DATABASE_URL_SSLMODE_REQUIRED', 'DATABASE_URL_POOLED_HOST', 'BACKUP_HEALTHCHECK_URL_INVALID']));
    expect(JSON.stringify(r)).not.toMatch(/pass-phrase-value|pw-value/);
    const weak = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(producerConfig({ ...producerEnv, BACKUP_PUBLIC_KEY: weak }).problems).toContain('BACKUP_PUBLIC_KEY_INVALID');
  });
});

describe('object names, retention and freshness', () => {
  it('reads the time from the name, never from the bucket', () => {
    expect(objectTime(`prod/ada_prod_${at(0)}.dump.enc`)).toEqual({ kind: 'dump', t: NOW });
    expect(objectTime(`prod/ada_prod_${at(0)}.dump.enc.sha256`).kind).toBe('sidecar');
    expect(objectTime(`prod/ada_erasures_${at(0)}.json.enc`).kind).toBe('ledger');
    expect(objectTime('prod/ada_prod_20261331T000000Z.dump.enc').t).toBeNull();
    expect(objectTime('prod/notes.txt').kind).toBe('other');
  });
  const objs = (hours) => hours.flatMap((h) => [{ key: `prod/ada_prod_${at(h)}.dump.enc`, size: 100 }, { key: `prod/ada_prod_${at(h)}.dump.enc.sha256`, size: 1 }, { key: `prod/ada_erasures_${at(h)}.json.enc`, size: 2 }]);
  it('keeps 35 days, always the newest dump, and flags objects the lifecycle should already have deleted', () => {
    const p = bucketPlan(objs([1, 13, 24 * 34, 24 * 36, 24 * 40]), { keepDays: 35, maxAgeHours: 36, now: NOW });
    expect(p).toMatchObject({ dumps: 5, ledgers: 5, fresh: true, ageHours: 1, overdue: 3, dumpsWithoutSidecar: 0 });
    expect(p.prune).toHaveLength(6);
    expect(p.prune.every((k) => k.includes(at(24 * 36)) || k.includes(at(24 * 40)))).toBe(true);
    const lone = bucketPlan(objs([24 * 50]), { keepDays: 35, maxAgeHours: 36, now: NOW });
    expect(lone.prune).toEqual([`prod/ada_erasures_${at(24 * 50)}.json.enc`]);   // the only dump (and its sidecar) is never pruned
    expect(lone.fresh).toBe(false);
  });
  it('a missed run is a stale newest dump; an empty bucket is not fresh', () => {
    expect(bucketPlan(objs([40]), { keepDays: 35, maxAgeHours: 36, now: NOW }).fresh).toBe(false);
    expect(bucketPlan([], { keepDays: 35, maxAgeHours: 36, now: NOW })).toMatchObject({ fresh: false, newestDump: null, ageHours: null });
  });
  it('the ledger replayed after a restore is the newest one exported at or after the dump', () => {
    const o = objs([48, 24, 1]);
    expect(ledgerForDump(o, `prod/ada_prod_${at(48)}.dump.enc`)).toBe(`prod/ada_erasures_${at(1)}.json.enc`);
    expect(ledgerForDump(objs([48]), `prod/ada_prod_${at(1)}.dump.enc`)).toBeNull();
  });
  it('ping URLs: https only (loopback http for the LAB), no credentials', () => {
    expect(pingUrl('https://hc-ping.com/abc/')).toBe('https://hc-ping.com/abc');
    expect(pingUrl('')).toBeNull();
    expect(pingUrl('http://hc-ping.com/abc')).toBe(false);
    expect(pingUrl('https://u:p@hc-ping.com/abc')).toBe(false);
  });
});

describe('job image and retired templates', () => {
  const df = fs.readFileSync('ops/cloud-backup/Dockerfile', 'utf8');
  it('copies every module the jobs import, and no secret or environment file', () => {
    for (const f of ['scripts/db-backup.mjs', 'scripts/db-restore.mjs', 'scripts/db-erasure-replay.mjs', 'scripts/cloud-backup.mjs', 'scripts/cloud-restore-verify.mjs',
      'scripts/lib/is-main.mjs', 'scripts/lib/backup-bucket.mjs', 'api/_services/retention-policy.js', 'drizzle/meta/_journal.json']) expect(df).toContain(f.split('/').pop());
    expect(df).not.toMatch(/\.env|PRIVATE_KEY|SECRET/);
    expect(df).toMatch(/postgresql-client-\$\{PG_MAJOR\}/);
    expect(df).toMatch(/ARG PG_MAJOR=18/);
    expect(df).toMatch(/USER node/);
  });
  it('no backup depends on the owner’s computer or on the public repository', () => {
    expect(fs.existsSync('ops/backup-mac')).toBe(false);
    expect(fs.existsSync('ops/private-backup')).toBe(false);
    expect(fs.existsSync('.github/workflows/db-backup.yml')).toBe(false);
  });
});
