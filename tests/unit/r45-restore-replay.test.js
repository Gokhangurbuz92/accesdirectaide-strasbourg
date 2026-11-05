/**
 * R45 / ENG-LR-7 — restore rehearsal hardening (unit, no database): backup time from the file name; streamed SHA-256 sidecar check; a private work folder
 * for the decrypted archive, removed even when the script stops on an error; erasure ledger v2 (message withdrawals and protections replayed after a
 * restore of an older backup, protections first; a ledger exported before the backup refused). Synthetic values only.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { backupTimeOf, encryptStreamToFile, sha256OfFile, sidecarMatches } from '../../scripts/db-backup.mjs';
import {
  MESSAGE_PURPOSE, inspectProtections, inspectWithdrawals, ledgerOf, readMessageWithdrawals, reinstateProtections, replayPlan, replayWithdrawals,
} from '../../scripts/db-erasure-replay.mjs';
import { BOOKING_MESSAGE_CONSENT_PURPOSE } from '../../api/_utils/rdv-message.js';

const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-r45-')); fs.chmodSync(d, 0o700); return d; };
const KEY = crypto.randomBytes(32);
const run = (args, env = {}) => spawnSync(process.execPath, ['scripts/db-backup.mjs', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });

describe('backup file helpers', () => {
  it('backupTimeOf reads the time the backup was taken from its own name, never from the file time', () => {
    expect(backupTimeOf('/x/ada_prod_20261103T021500Z.dump.enc')).toBe('2026-11-03T02:15:00.000Z');
    expect(backupTimeOf('ada_r45_20260229T000000Z.dump.enc')).toBeNull();   // not a date
    expect(backupTimeOf('ada_prod_latest.dump.enc')).toBeNull();
    expect(backupTimeOf('ada_prod_20261103T021500Z.dump')).toBeNull();
  });
  it('sha256OfFile is streamed and equal to the one-shot hash; sidecarMatches: null without sidecar, false when the file changed', async () => {
    const d = tmp();
    try {
      const f = path.join(d, 'a.dump.enc'); const buf = crypto.randomBytes(300_000); fs.writeFileSync(f, buf);
      expect(await sha256OfFile(f)).toBe(crypto.createHash('sha256').update(buf).digest('hex'));
      expect(await sidecarMatches(f)).toBeNull();
      fs.writeFileSync(`${f}.sha256`, `${await sha256OfFile(f)}  a.dump.enc\n`);
      expect(await sidecarMatches(f)).toBe(true);
      buf[10] ^= 1; fs.writeFileSync(f, buf);
      expect(await sidecarMatches(f)).toBe(false);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
  it('--verify refuses a group/world-writable --work-dir before decrypting anything', () => {
    const d = tmp();
    try {
      const f = path.join(d, 'ada_t_20261105T000000Z.dump.enc'); fs.writeFileSync(f, 'x'.repeat(64));
      const open = path.join(d, 'open'); fs.mkdirSync(open); fs.chmodSync(open, 0o777);
      const r = run(['--verify', f, '--work-dir', open], { BACKUP_ENCRYPTION_KEY: KEY.toString('hex') });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/work-dir/);
      expect(fs.readdirSync(open)).toEqual([]);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
  it('a decrypted file that is not a pg_dump archive is refused AND removed from the work folder (die() used to skip the clean-up)', async () => {
    const d = tmp();
    try {
      const work = path.join(d, 'work'); fs.mkdirSync(work, { mode: 0o700 });
      const f = path.join(d, 'ada_t_20261105T000000Z.dump.enc');
      await encryptStreamToFile(Readable.from([Buffer.from('SYNTHETIC NOT AN ARCHIVE')]), f, KEY);
      const r = run(['--verify', f, '--work-dir', work], { BACKUP_ENCRYPTION_KEY: KEY.toString('hex') });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/illisible|inattendue/);
      expect(fs.readdirSync(work)).toEqual([]);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
});

describe('erasure ledger v2 (R45)', () => {
  const T0 = '2026-11-01T00:00:00.000Z';
  const ledger = ledgerOf(
    [{ requestId: 'r-old', subjectId: 's-old', completedAt: '2026-10-01T00:00:00.000Z', domains: ['CitizenProfile'] },
      { requestId: 'r-new', subjectId: 's-new', completedAt: '2026-11-02T00:00:00.000Z', domains: ['CitizenProfile'] }],
    new Date('2026-11-04T00:00:00Z'),
    { messageWithdrawals: [{ subjectId: 's1', appointmentId: 'a-old', policyVersion: 'v', policyHash: 'v:p:a-old', withdrawnAt: '2026-10-20T00:00:00.000Z' },
      { subjectId: 's1', appointmentId: 'a-new', policyVersion: 'v', policyHash: 'v:p:a-new', withdrawnAt: '2026-11-03T00:00:00.000Z' }],
    protections: { legalHolds: [{ id: 'h1', dataCategory: 'CitizenUser', recordId: 's9', reasonCode: 'LITIGATION', createdBy: 'adm', createdAt: '2026-11-02T00:00:00.000Z' }],
      requests: [{ id: 'q1', subjectType: 'CITIZEN_USER', subjectId: 's8', requestType: 'RESTRICT', status: 'ACTIVE', executionMode: 'HUMAN_REVIEW_REQUIRED', affectedDomains: [], reasonCode: 'a', createdAt: '2026-11-02T00:00:00.000Z' }] } });
  it('the purpose constant is the booking-message consent purpose of the application', () => {
    expect(MESSAGE_PURPOSE).toBe(BOOKING_MESSAGE_CONSENT_PURPOSE);
  });
  it('replayPlan: erasures and withdrawals since the backup, every current protection; a ledger exported before the backup is refused', () => {
    const p = replayPlan(ledger, T0);
    expect(p.entries.map((e) => e.requestId)).toEqual(['r-new']);
    expect(p.withdrawals.map((w) => w.appointmentId)).toEqual(['a-new']);
    expect(p.protections.legalHolds.map((h) => h.id)).toEqual(['h1']);
    expect(p.protections.requests.map((q) => q.id)).toEqual(['q1']);
    expect(() => replayPlan(ledger, '2026-11-05T00:00:00Z')).toThrow(/before the backup/);
    expect(replayPlan(ledger).withdrawals.length).toBe(2);
  });
  it('a version 1 ledger (erasures only) is still read', () => {
    const v1 = { kind: ledger.kind, version: 1, exportedAt: '2026-11-04T00:00:00.000Z', entries: ledger.entries };
    expect(replayPlan(v1, T0)).toEqual({ entries: [ledger.entries[1]], withdrawals: [], protections: { legalHolds: [], requests: [] } });
  });
  it('readMessageWithdrawals keeps subject, appointment id (last « : » part of policy_hash), version and time — and drops a row without an appointment id', async () => {
    const client = { query: async (_q, params) => { expect(params).toEqual([MESSAGE_PURPOSE]); return { rows: [
      { subject_id: 's1', policy_version: 'r43-e6', policy_hash: 'r43-e6:BOOKING_MESSAGE_TRANSMISSION:apt-1', at: new Date(T0) },
      { subject_id: 's2', policy_version: 'r43-e6', policy_hash: '', at: new Date(T0) }] }; } };
    expect(await readMessageWithdrawals(client)).toEqual([{ subjectId: 's1', appointmentId: 'apt-1', policyVersion: 'r43-e6', policyHash: 'r43-e6:BOOKING_MESSAGE_TRANSMISSION:apt-1', withdrawnAt: T0 }]);
  });
  it('protections: missing ones are reinstated, present ones counted, a hold present but not ACTIVE is left for a human; idempotent', async () => {
    const state = { holds: { h2: 'RELEASED' }, reqs: {} };
    const client = { query: async (q, [id]) => (q.includes('"LegalHold"') ? { rows: state.holds[id] ? [{ status: state.holds[id] }] : [] } : { rows: state.reqs[id] ? [{ status: state.reqs[id] }] : [] }) };
    const p = { legalHolds: [...ledger.protections.legalHolds, { ...ledger.protections.legalHolds[0], id: 'h2' }], requests: ledger.protections.requests };
    const writes = [];
    const query = async (q, params) => { writes.push(q.slice(0, 30)); if (q.includes('"LegalHold"')) state.holds[params[0]] = 'ACTIVE'; else state.reqs[params[0]] = params[4]; return { rowCount: 1 }; };
    const first = await reinstateProtections({ inspected: await inspectProtections(client, p), query });
    expect(first).toEqual({ holdsReinstated: 1, holdsPresent: 0, holdsNotActiveForReview: 1, requestsReinstated: 1, requestsPresent: 0, failed: 0 });
    expect(state.holds).toEqual({ h1: 'ACTIVE', h2: 'RELEASED' });
    const again = await reinstateProtections({ inspected: await inspectProtections(client, p), query });
    expect(again).toMatchObject({ holdsReinstated: 0, holdsPresent: 1, holdsNotActiveForReview: 1, requestsReinstated: 0, requestsPresent: 1 });
    expect(writes.length).toBe(2);
  });
  it('withdrawals: the message present again is erased (that person, that appointment) and the withdrawal recorded again; absent ones counted', async () => {
    const notes = { 'a-new': 's1' };
    const client = { query: async (_q, [id, subject]) => ({ rows: [{ n: notes[id] === subject ? 1 : 0 }] }) };
    const calls = [];
    const query = async (q, params) => { calls.push([q.trim().split(/\s+/)[0], params]); if (q.startsWith('UPDATE')) { const hit = notes[params[0]] === params[1]; delete notes[params[0]]; return { rowCount: hit ? 1 : 0 }; } return { rowCount: 1 }; };
    const list = [...ledger.messageWithdrawals, { ...ledger.messageWithdrawals[1], appointmentId: 'a-other', subjectId: 's2' }];
    const out = await replayWithdrawals({ inspected: await inspectWithdrawals(client, list), query, newId: () => 'id-1' });
    expect(out).toEqual({ messagesErased: 1, absent: 2, failed: 0 });
    expect(calls.map((c) => c[0])).toEqual(['UPDATE', 'INSERT']);
    expect(calls[1][1]).toEqual(['id-1', 'v', 'v:p:a-new', 's1', MESSAGE_PURPOSE, '2026-11-03T00:00:00.000Z']);
    expect(await replayWithdrawals({ inspected: await inspectWithdrawals(client, list), query })).toEqual({ messagesErased: 0, absent: 3, failed: 0 });
  });
});
