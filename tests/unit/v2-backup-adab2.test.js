/**
 * V2 (Neon Free) — unattended backups: ADAB2 (public-key) format, key handling, runner-side header check, missed-run detection, workflow template.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, beforeAll } from 'vitest';
import { backupPublicKey, backupPrivateKey, decryptFileToFile, decryptionKeyFor, encryptStreamToFile, generateBackupKeyPair, readHeader } from '../../scripts/db-backup.mjs';

const PASS = 'correct horse battery staple 42';
let dir; let pair; let privFile;
const payload = crypto.randomBytes(200_000);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adab2-'));
  pair = generateBackupKeyPair(PASS);
  privFile = path.join(dir, 'backup-private.pem');
  fs.writeFileSync(privFile, pair.privatePem, { mode: 0o600 });
}, 60_000);

const enc = async (name, key) => { const f = path.join(dir, name); await encryptStreamToFile(Readable.from([payload.subarray(0, 70_000), payload.subarray(70_000)]), f, key); return f; };

describe('ADAB2 — the runner can write a backup it cannot read', () => {
  it('round-trips with the private key; the file never contains the data key or the clear archive', async () => {
    const f = await enc('a.dump.enc', backupPublicKey(pair.publicPem));
    expect(readHeader(f).v).toBe(2);
    const raw = fs.readFileSync(f);
    expect(raw.includes(payload.subarray(0, 64))).toBe(false);
    const out = path.join(dir, 'a.out');
    await decryptFileToFile(f, out, backupPrivateKey(privFile, PASS));
    expect(fs.readFileSync(out).equals(payload)).toBe(true);
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
  });
  it('refuses a wrong passphrase, another key pair, a modified header and a modified body', async () => {
    expect(() => backupPrivateKey(privFile, 'wrong passphrase 0000')).toThrow(/refused/);
    const f = await enc('b.dump.enc', backupPublicKey(pair.publicPem));
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 }).privateKey;
    await expect(decryptFileToFile(f, path.join(dir, 'b1'), other)).rejects.toThrow();
    for (const [name, at] of [['hdr', 5 + 2 + 600], ['body', 2000]]) {
      const g = path.join(dir, `b-${name}.dump.enc`); const buf = fs.readFileSync(f); buf[at] ^= 1; fs.writeFileSync(g, buf);
      await expect(decryptFileToFile(g, path.join(dir, `b-${name}.out`), backupPrivateKey(privFile, PASS))).rejects.toThrow();
      expect(fs.existsSync(path.join(dir, `b-${name}.out`))).toBe(false);
      expect(fs.existsSync(path.join(dir, `b-${name}.out.partial`))).toBe(false);
    }
  });
  it('keeps ADAB1 working and never mixes the formats', async () => {
    const k = crypto.randomBytes(32);
    const f1 = await enc('c.dump.enc', k);
    expect(readHeader(f1).v).toBe(1);
    await decryptFileToFile(f1, path.join(dir, 'c.out'), k);
    expect(fs.readFileSync(path.join(dir, 'c.out')).equals(payload)).toBe(true);
    const f2 = await enc('d.dump.enc', backupPublicKey(pair.publicPem));
    await expect(decryptFileToFile(f2, path.join(dir, 'd.out'), k)).rejects.toThrow(/private key/);
    await expect(decryptFileToFile(f1, path.join(dir, 'c2.out'), backupPrivateKey(privFile, PASS))).rejects.toThrow(/BACKUP_ENCRYPTION_KEY/);
  });
  it('selects the key by format (decryptionKeyFor)', async () => {
    const f = await enc('e.dump.enc', backupPublicKey(pair.publicPem));
    const saved = { ...process.env };
    process.env.BACKUP_PRIVATE_KEY_FILE = privFile; process.env.BACKUP_PRIVATE_KEY_PASSPHRASE = PASS; delete process.env.BACKUP_ENCRYPTION_KEY;
    try { expect(decryptionKeyFor(f).type).toBe('private'); } finally { process.env = saved; }
  });
  it('rejects weak or malformed keys and short passphrases', () => {
    expect(() => generateBackupKeyPair('short')).toThrow(/16/);
    const small = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' });
    expect(() => backupPublicKey(small)).toThrow(/3072/);
    expect(() => backupPublicKey('not a key')).toThrow(/PEM/);
    expect(backupPublicKey(pair.publicPem.replace(/\n/g, '\\n')).type).toBe('public');   // pasted as one line in a CI secret
    expect(pair.privatePem).toMatch(/BEGIN ENCRYPTED PRIVATE KEY/);
  });
  it('--check-header needs no key and fails on a changed file', async () => {
    const f = await enc('f_20261108T021700Z.dump.enc', backupPublicKey(pair.publicPem));
    const sha = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    fs.writeFileSync(`${f}.sha256`, `${sha}  ${path.basename(f)}\n`);
    const env = { PATH: process.env.PATH, HOME: process.env.HOME };
    const ok = spawnSync(process.execPath, ['scripts/db-backup.mjs', '--check-header', f], { encoding: 'utf8', env });
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout)).toMatchObject({ ok: true, format: 'ADAB2', takenAt: '2026-11-08T02:17:00.000Z' });
    const buf = fs.readFileSync(f); buf[buf.length - 1] ^= 1; fs.writeFileSync(f, buf);
    expect(spawnSync(process.execPath, ['scripts/db-backup.mjs', '--check-header', f], { encoding: 'utf8', env }).status).toBe(1);
  });
});
