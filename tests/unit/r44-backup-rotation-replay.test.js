/**
 * R44 / E15 — backup rotation (scripts/db-backup.mjs rotationPlan, defaults from the PROPOSED retention policy) and the erasure replay after a restore
 * (scripts/db-erasure-replay.mjs): ledger selection by backup time, encrypted ledger file, replay outcomes (idempotent, legal hold, absent subject).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { rotationPlan } from '../../scripts/db-backup.mjs';
import { LEDGER_KIND, entriesSince, ledgerOf, readLedgerFile, replayErasures, writeLedgerFile } from '../../scripts/db-erasure-replay.mjs';

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 4, 12);   // Wednesday 4 November 2026

describe('rotationPlan (E15)', () => {
  it('keeps every backup of the last keepDays days, then the newest of each of keepWeekly older weeks; prunes the rest', () => {
    const files = Array.from({ length: 90 }, (_, i) => ({ f: `d${String(i).padStart(2, '0')}`, t: NOW - i * DAY }));   // one per day for 90 days
    const { keep, prune } = rotationPlan(files, { keepDays: 30, keepWeekly: 4, now: NOW });
    const recent = files.filter((x) => NOW - x.t <= 30 * DAY).map((x) => x.f);
    expect(keep.slice(0, recent.length)).toEqual(recent);
    expect(keep.length).toBe(recent.length + 4);
    expect(new Set([...keep, ...prune]).size).toBe(90);
    expect(prune.length).toBe(90 - keep.length);
  });
  it('never prunes the newest backup, even when it is old', () => {
    expect(rotationPlan([{ f: 'only', t: NOW - 400 * DAY }], { keepDays: 30, keepWeekly: 0, now: NOW })).toEqual({ keep: ['only'], prune: [] });
  });
  it('rejects invalid parameters', () => {
    expect(() => rotationPlan([], { keepDays: 0, keepWeekly: 4 })).toThrow();
    expect(() => rotationPlan([], { keepDays: 30, keepWeekly: -1 })).toThrow();
  });
  it('the CLI: --list reports the PROPOSED policy; --prune refuses without an explicit --keep-days while the policy is not approved, and prunes with it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-rot-'));
    try {
      const old = path.join(dir, 'ada_t_old.dump.enc'); fs.writeFileSync(old, 'x'); fs.writeFileSync(`${old}.sha256`, 'x');
      const t = (NOW - 200 * DAY) / 1000; fs.utimesSync(old, t, t);
      fs.writeFileSync(path.join(dir, 'ada_t_new.dump.enc'), 'x');
      const run = (...a) => spawnSync(process.execPath, ['scripts/db-backup.mjs', '--list', dir, ...a], { encoding: 'utf8', env: { PATH: process.env.PATH } });
      const list = JSON.parse(run().stdout);
      expect(list).toMatchObject({ total: 2, keepDays: 35, keepWeekly: 0, pruned: 0, policy: { status: 'PROPOSED — NOT APPROVED' } });
      const refused = run('--prune');
      expect(refused.status).toBe(1);
      expect(fs.existsSync(old)).toBe(true);
      const pruned = JSON.parse(run('--prune', '--keep-days', '30', '--keep-weekly', '0').stdout);
      expect(pruned.pruned).toBe(1);
      expect(fs.existsSync(old) || fs.existsSync(`${old}.sha256`)).toBe(false);
      expect(fs.existsSync(path.join(dir, 'ada_t_new.dump.enc'))).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('erasure ledger and replay (E15)', () => {
  const entries = [
    { requestId: 'r1', subjectId: 's1', completedAt: '2026-10-01T00:00:00.000Z', domains: ['CitizenProfile'] },
    { requestId: 'r2', subjectId: 's2', completedAt: '2026-11-01T00:00:00.000Z', domains: ['CitizenProfile'] },
  ];
  it('selects the erasures completed at or after the backup time; refuses something that is not a ledger', () => {
    const l = ledgerOf(entries, new Date(NOW));
    expect(l.kind).toBe(LEDGER_KIND);
    expect(entriesSince(l, '2026-10-15T00:00:00Z').map((e) => e.requestId)).toEqual(['r2']);
    expect(entriesSince(l).length).toBe(2);
    expect(() => entriesSince({ entries: [] })).toThrow();
    expect(() => entriesSince(l, 'not a date')).toThrow();
  });
  it('the ledger file is encrypted (no subject id in clear) and reads back only with the key', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-ledger-test-'));
    try {
      const key = crypto.randomBytes(32); const file = path.join(dir, 'l.json.enc');
      await writeLedgerFile(ledgerOf(entries), file, key);
      expect(fs.readFileSync(file).includes(Buffer.from('s1'))).toBe(false);
      expect((fs.statSync(file).mode & 0o777).toString(8)).toBe('600');
      expect((await readLedgerFile(file, key)).entries).toEqual(entries);
      await expect(readLedgerFile(file, crypto.randomBytes(32))).rejects.toThrow();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('replays present subjects through the DSR engine and records the request; absent, held and failed are counted, never thrown', async () => {
    const recorded = [];
    const privacy = { deleteDataDomains: async (subjectId) => {
      if (subjectId === 'gone') throw Object.assign(new Error('x'), { code: 'SUBJECT_NOT_FOUND' });
      if (subjectId === 'held') throw Object.assign(new Error('x'), { code: 'LEGAL_HOLD_ACTIVE' });
      if (subjectId === 'boom') throw new Error('db down');
      return {};
    } };
    const e = (subjectId, present = true, domains = ['CitizenProfile']) => ({ requestId: `r-${subjectId}`, subjectId, completedAt: '2026-11-01T00:00:00.000Z', domains, present });
    const out = await replayErasures({ entries: [e('a'), e('b', false), e('gone'), e('held'), e('boom'), e('nod', true, [])], privacy, recordRequest: async (x) => { recorded.push(x.requestId); } });
    expect(out).toEqual({ replayed: 1, absent: 2, blockedLegalHold: 1, noDomains: 1, failed: 1 });
    expect(recorded).toEqual(['r-a', 'r-gone']);
  });
});
