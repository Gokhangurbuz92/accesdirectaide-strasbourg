// V2 C7 (final data-integrity review, 09/11/2026) — the cloud jobs run the release's scripts from a MINIMAL file set: exactly the files that
// ops/cloud-backup/job-entrypoint.sh extracts from the pinned archive, plus the two npm packages it installs (pg, @aws-sdk/client-s3). A module that
// only the full repository has makes the job fail in the cloud while every repository test passes (found: db-erasure-replay imported the KV module
// unconditionally → the verifier's replay dry run would always fail). This test rebuilds that file set and runs the job code paths in it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(__dirname, '../..');
const ep = fs.readFileSync(path.join(ROOT, 'ops/cloud-backup/job-entrypoint.sh'), 'utf8');
const SELECTED = [...ep.slice(ep.indexOf('tar -xzf'), ep.indexOf('cd "$W/app"')).matchAll(/'\*\/([^']+)'/g)].map((m) => m[1]);
const BARE_ALLOWED = new Set(['pg', '@aws-sdk/client-s3']);
// imports of files OUTSIDE the job set, allowed only on operator paths that never run in a job (each one is lazy and behind its flag)
const OPERATOR_ONLY = new Set(['scripts/db-erasure-replay.mjs → ../api/_services/erasure-tombstones.js (--kv / --tombstones-file)',
  'scripts/db-erasure-replay.mjs → drizzle-orm/node-postgres (--execute)', 'scripts/db-erasure-replay.mjs → ../src/db/schema.js (--execute)',
  'scripts/db-erasure-replay.mjs → ../api/_services/privacy.js (--execute)']);

let dir;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-job-set-'));
  for (const rel of SELECTED) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.copyFileSync(path.join(ROOT, rel), path.join(dir, rel)); }
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'node_modules/@aws-sdk'), { recursive: true });   // only what the entrypoint installs
  fs.symlinkSync(path.join(ROOT, 'node_modules/pg'), path.join(dir, 'node_modules/pg'));
  fs.symlinkSync(path.join(ROOT, 'node_modules/@aws-sdk/client-s3'), path.join(dir, 'node_modules/@aws-sdk/client-s3'));
  for (const dep of ['pg-pool', 'pg-protocol', 'pg-types', 'pg-connection-string', 'pgpass', 'pg-int8', 'postgres-array', 'postgres-bytea', 'postgres-date', 'postgres-interval', 'xtend', 'split2', 'pg-cloudflare']) {
    if (fs.existsSync(path.join(ROOT, 'node_modules', dep))) fs.symlinkSync(path.join(ROOT, 'node_modules', dep), path.join(dir, 'node_modules', dep));
  }
  for (const d of fs.readdirSync(path.join(ROOT, 'node_modules/@aws-sdk'))) if (d !== 'client-s3') fs.symlinkSync(path.join(ROOT, 'node_modules/@aws-sdk', d), path.join(dir, 'node_modules/@aws-sdk', d));
  for (const d of ['@smithy', '@aws-crypto', 'tslib', 'fast-xml-parser', 'strnum', 'bowser', 'uuid', '@types']) if (fs.existsSync(path.join(ROOT, 'node_modules', d)) && !fs.existsSync(path.join(dir, 'node_modules', d))) fs.symlinkSync(path.join(ROOT, 'node_modules', d), path.join(dir, 'node_modules', d));
});
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

describe('cloud job file set (job-entrypoint.sh) — dependency closure', () => {
  it('every import of the job scripts resolves inside the set or to an installed package; the exceptions are the listed operator-only paths', () => {
    const outside = [];
    for (const rel of SELECTED.filter((f) => /\.(m?js)$/.test(f))) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const specs = [...src.matchAll(/(?:^|\n)\s*import\s[^'"]*?from\s+['"]([^'"]+)['"]/g), ...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
      for (const s of specs) {
        if (s.startsWith('node:')) continue;
        if (!s.startsWith('.')) { if (!BARE_ALLOWED.has(s)) outside.push(`${rel} → ${s}`); continue; }
        const target = path.normalize(path.join(path.dirname(rel), s));
        if (!SELECTED.includes(target)) outside.push(`${rel} → ${s}`);
      }
    }
    expect([...new Set(outside)].sort()).toEqual([...OPERATOR_ONLY].map((x) => x.replace(/ \(.*\)$/, '')).sort());
  });
  it('the job code paths run in the set: producer config check, verifier config check, replay dry run (reaches the database, no missing module)', () => {
    const env = { PATH: process.env.PATH, HOME: os.homedir(), TZ: 'UTC' };
    const cb = spawnSync(process.execPath, ['scripts/cloud-backup.mjs', '--check-config'], { cwd: dir, env, encoding: 'utf8' });
    expect(cb.stdout).toMatch(/"problems"/); expect(`${cb.stdout}${cb.stderr}`).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find/);
    const vr = spawnSync(process.execPath, ['scripts/cloud-restore-verify.mjs', '--confirm-target', '127.0.0.1/x'], { cwd: dir, env, encoding: 'utf8' });
    expect(vr.stdout).toMatch(/"code":"CONFIG"/); expect(`${vr.stdout}${vr.stderr}`).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find/);
    // a valid (ADAB1, synthetic) ledger, then the verifier's exact replay call against an unreachable database
    const key = crypto.randomBytes(32).toString('hex');
    const mk = spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import('./scripts/db-erasure-replay.mjs'); const b = await import('./scripts/db-backup.mjs');
      await m.writeLedgerFile(m.ledgerOf([{ requestId: 'r-1', subjectId: '00000000-0000-4000-8000-000000000001', completedAt: new Date().toISOString(), domains: ['CitizenProfile'] }], new Date()), 'ledger.json.enc', b.backupKey());`], { cwd: dir, env: { ...env, BACKUP_ENCRYPTION_KEY: key }, encoding: 'utf8' });
    expect(mk.status, mk.stderr).toBe(0);
    const rp = spawnSync(process.execPath, ['scripts/db-erasure-replay.mjs', '--ledger', 'ledger.json.enc', '--since', '2000-01-01T00:00:00Z', '--confirm-target', '127.0.0.1/x'],
      { cwd: dir, env: { ...env, BACKUP_ENCRYPTION_KEY: key, TARGET_DATABASE_URL: 'postgres://u@127.0.0.1:1/x' }, encoding: 'utf8' });
    expect(rp.status).not.toBe(0);
    expect(rp.stderr).toMatch(/ECONNREFUSED/);          // it got as far as the database
    expect(rp.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND/);
  });
});
