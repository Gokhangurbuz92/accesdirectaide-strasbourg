// D5 b (owner decision 17/11/2026) — the second, encrypted copy of the erasure tombstones in the K3 object storage. Against a local fake S3 bucket
// (tests/helpers/fake-s3.mjs, loopback, SigV4-signed requests) and an in-memory stand-in for Upstash:
//   - off without its variables = the Upstash-only behaviour (byte for byte the same records);
//   - written to both; refused only when BOTH fail; each store notes the other's failure; a copy failure leaves the health-check marker and a log line
//     without any record content or credential;
//   - encrypted and authenticated: no identifier in clear in the bucket; a modified or swapped object is rejected;
//   - the restore union: disagreement, stale copy, missing copy, complete Upstash loss, tampering → refused (fail closed); explained gaps pass;
//     --accept-single-copy is the only way past a distrusted store;
//   - retention: records older than 40 days are deleted by the health-check inventory.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { startFakeS3 } from '../helpers/fake-s3.mjs';
import { copyConfig, createTombstoneCopy, sealObject, openObject, recordTimeOf } from '../../api/_services/erasure-tombstone-copy.js';
import { createErasureTombstones, combineTombstoneSnapshots, tombstoneStates, TOMBSTONE_COPY_FAILED_KEY, TOMBSTONE_KEY } from '../../api/_services/erasure-tombstones.js';

const BUCKET = 'ada-erasure-tombstones';
const KEY_HEX = crypto.randomBytes(32).toString('hex');
const memoryKv = () => { const m = new Map(); const k = { isRemote: true, fail: false, m,
  _w() { if (k.fail) throw new Error('KV down'); },
  async lpush(key, v) { k._w(); const l = m.get(key) || []; l.unshift(v); m.set(key, l); return l.length; },
  async lrange(key, a, b) { const l = m.get(key) || []; return l.slice(a, b < 0 ? l.length + b + 1 : b + 1); },
  async ltrim() { k._w(); return 'OK'; }, async expire() { k._w(); return 1; },
  async set(key, v) { k._w(); m.set(key, v); return 'OK'; }, async get(key) { return m.get(key) ?? null; }, async del(key) { m.delete(key); return 1; } }; return k; };
const silent = () => { const lines = []; return { lines, error: (o, msg) => lines.push(['error', o, msg]), warn: (o, msg) => lines.push(['warn', o, msg]) }; };

let s3; let cfg;
const envFor = (endpoint, extra = {}) => ({ TOMBSTONE_COPY_S3_ENDPOINT: endpoint, TOMBSTONE_COPY_S3_BUCKET: BUCKET, TOMBSTONE_COPY_S3_ACCESS_KEY_ID: 'tombkey',
  TOMBSTONE_COPY_S3_SECRET_ACCESS_KEY: 'fake-secret', TOMBSTONE_COPY_KEY: KEY_HEX, ...extra });
beforeAll(async () => { s3 = await startFakeS3({ bucket: BUCKET, keys: { tombkey: { write: true }, readonly: { write: false } } }); cfg = copyConfig(envFor(s3.endpoint)); });
afterAll(async () => { await s3?.close(); });
const freshCopy = () => { s3.objects.clear(); return createTombstoneCopy(cfg); };
/** a copy whose writes fail (the bucket refuses the token) */
const deniedCopy = () => createTombstoneCopy(copyConfig(envFor(s3.endpoint, { TOMBSTONE_COPY_S3_ACCESS_KEY_ID: 'readonly' })));
const person = () => ({ requestId: crypto.randomUUID(), subjectId: crypto.randomUUID(), domains: ['account', 'appointments'] });

describe('D5 b — configuration', () => {
  it('off without variables, invalid when partial, EU R2 or loopback only, https, 64-hex key', () => {
    expect(copyConfig({})).toEqual({ enabled: false, invalid: false });
    expect(copyConfig({ TOMBSTONE_COPY_S3_BUCKET: BUCKET })).toMatchObject({ enabled: false, invalid: true, reason: 'COPY_CONFIG_INCOMPLETE' });
    expect(copyConfig(envFor('https://abc123.eu.r2.cloudflarestorage.com')).enabled).toBe(true);
    expect(copyConfig(envFor('https://abc123.r2.cloudflarestorage.com')).reason).toBe('COPY_ENDPOINT_NOT_EU_JURISDICTION');
    expect(copyConfig(envFor('https://s3.amazonaws.com')).reason).toBe('COPY_ENDPOINT_NOT_EU_JURISDICTION');
    expect(copyConfig(envFor('http://abc123.eu.r2.cloudflarestorage.com')).reason).toBe('COPY_ENDPOINT_NOT_HTTPS');
    expect(copyConfig(envFor(s3.endpoint, { TOMBSTONE_COPY_KEY: 'abc' })).reason).toBe('COPY_KEY_INVALID');
    expect(copyConfig(envFor(s3.endpoint, { TOMBSTONE_COPY_S3_PREFIX: '../x' })).reason).toBe('COPY_PREFIX_INVALID');
  });
  it('without the copy, the Upstash records are exactly the former ones (no copy field)', async () => {
    const kv = memoryKv(); const p = person();
    await createErasureTombstones({ kv, requireRemote: true, copy: null }).record(p);
    expect(Object.keys(JSON.parse(kv.m.get(TOMBSTONE_KEY)[0])).sort()).toEqual(['completedAt', 'domains', 'kind', 'phase', 'requestId', 'subjectId']);
  });
});

describe('D5 b — writes to both stores', () => {
  it('both written; the bucket holds no identifier in clear; the copy reads back the same records', async () => {
    const copy = freshCopy(); const kv = memoryKv(); const p = person();
    const t = createErasureTombstones({ kv, requireRemote: true, copy, log: silent() });
    await t.record(p); expect(await t.complete(p)).toBe(true);
    expect(s3.objects.size).toBe(3);   // two records + the marker
    for (const [name, o] of s3.objects) { const raw = o.body.toString('utf8'); expect(raw).not.toContain(p.requestId); expect(raw).not.toContain(p.subjectId); expect(name).not.toContain(p.requestId); }
    expect(s3.log.every((r) => r.key === 'tombkey')).toBe(true);
    const snap = await copy.snapshot();
    expect(snap.entries.map((e) => e.phase)).toEqual(['done', 'intent']);
    expect(snap.last).toMatchObject({ requestId: p.requestId, phase: 'done' });
    expect(JSON.parse(kv.m.get(TOMBSTONE_KEY)[0]).copy).toBe('written');
  });
  it('copy down: the erasure goes on with Upstash, the gap is noted, the health marker is set, the log carries no record or secret', async () => {
    const kv = memoryKv(); const log = silent(); const p = person();
    const t = createErasureTombstones({ kv, requireRemote: true, copy: deniedCopy(), log });
    await t.record(p);
    expect(JSON.parse(kv.m.get(TOMBSTONE_KEY)[0]).copy).toBe('failed');
    expect(JSON.parse(kv.m.get(TOMBSTONE_COPY_FAILED_KEY))).toMatchObject({ phase: 'intent' });
    expect(log.lines[0][1].event).toBe('tombstone_copy.write_failed');
    const logged = JSON.stringify(log.lines); for (const v of [p.requestId, p.subjectId, KEY_HEX, 'fake-secret']) expect(logged).not.toContain(v);
  });
  it('Upstash down: the copy holds the record with kv: failed; refused only when BOTH fail', async () => {
    const copy = freshCopy(); const kv = memoryKv(); kv.fail = true; const p = person();
    const t = createErasureTombstones({ kv, requireRemote: true, copy, log: silent() });
    await t.record(p);
    expect((await copy.snapshot()).entries[0]).toMatchObject({ requestId: p.requestId, kv: 'failed' });
    const both = createErasureTombstones({ kv, requireRemote: true, copy: deniedCopy(), log: silent() });
    await expect(both.record(person())).rejects.toMatchObject({ code: 'ERASURE_TOMBSTONE_UNAVAILABLE' });
    expect(await both.complete(person())).toBe(false);
    // Production without a remote KV: the copy alone is enough
    const local = { ...memoryKv(), isRemote: false };
    await expect(createErasureTombstones({ kv: local, requireRemote: true, copy, log: silent() }).record(person())).resolves.toBeUndefined();
  });
});

describe('D5 b — encryption and integrity', () => {
  it('a modified object, or one moved under another name, does not authenticate', () => {
    const key = Buffer.from(KEY_HEX, 'hex');
    const sealed = sealObject(key, 'p/t/a.json', { x: 1 });
    expect(openObject(key, 'p/t/a.json', sealed)).toEqual({ x: 1 });
    expect(() => openObject(key, 'p/t/b.json', sealed)).toThrow('COPY_OBJECT_TAMPERED');
    const o = JSON.parse(sealed); const ct = Buffer.from(o.ct, 'base64'); ct[0] ^= 1; o.ct = ct.toString('base64');
    expect(() => openObject(key, 'p/t/a.json', JSON.stringify(o))).toThrow('COPY_OBJECT_TAMPERED');
    expect(() => openObject(crypto.randomBytes(32), 'p/t/a.json', sealed)).toThrow('COPY_OBJECT_TAMPERED');
  });
  it('a tampered object in the bucket refuses the restore', async () => {
    const copy = freshCopy(); const kv = memoryKv(); const p = person();
    await createErasureTombstones({ kv, requireRemote: true, copy, log: silent() }).record(p);
    const [name, o] = [...s3.objects].find(([n]) => n.includes('/t/'));
    s3.objects.set(name, { ...o, body: Buffer.from(sealObject(crypto.randomBytes(32), name, { forged: true })) });
    const snap = await copy.snapshot();
    expect(snap.tampered).toBe(1);
    const r = combineTombstoneSnapshots({ kv: await createErasureTombstones({ kv, copy: null }).snapshot(), copy: snap, copyExpected: true });
    expect(r.problems).toContain('COPY:TOMBSTONE_COPY_TAMPERED');
  });
});

describe('D5 b — the restore union fails closed when the history cannot be trusted', () => {
  /** n people erased with both stores; returns the two snapshots */
  const history = async (n = 2, { kvFailFor = -1, copyFailFor = -1 } = {}) => {
    const copy = freshCopy(); const kv = memoryKv(); const ok = createTombstoneCopy(cfg); const denied = deniedCopy();
    const ids = [];
    for (let i = 0; i < n; i += 1) {
      const p = person(); ids.push(p);
      kv.fail = i === kvFailFor;
      const t = createErasureTombstones({ kv, requireRemote: true, copy: i === copyFailFor ? denied : ok, log: silent() });
      await t.record(p); await t.complete(p);
    }
    kv.fail = false;
    return { kv, copy, ids, kvSnap: async () => createErasureTombstones({ kv, copy: null }).snapshot(), copySnap: () => copy.snapshot() };
  };
  it('agreement: no problem, every done erasure in the union once', async () => {
    const h = await history(3);
    const r = combineTombstoneSnapshots({ kv: await h.kvSnap(), copy: await h.copySnap(), copyExpected: true });
    expect(r.problems).toEqual([]);
    expect(tombstoneStates(r.entries).filter((s) => s.state === 'done').map((s) => s.requestId).sort()).toEqual(h.ids.map((p) => p.requestId).sort());
  });
  it('explained gaps pass: a copy write failure noted in Upstash, an Upstash failure noted in the copy — the union has both', async () => {
    const h = await history(3, { kvFailFor: 0, copyFailFor: 2 });
    const r = combineTombstoneSnapshots({ kv: await h.kvSnap(), copy: await h.copySnap(), copyExpected: true });
    expect(r.problems).toEqual([]);
    expect(tombstoneStates(r.entries).filter((s) => s.state === 'done')).toHaveLength(3);
  });
  it('disagreement: a record in Upstash the copy lost (stale or emptied bucket) → COPY:TOMBSTONE_RECORDS_MISSING', async () => {
    const h = await history(2);
    const newest = [...s3.objects.keys()].filter((n) => n.includes('/t/')).sort().pop(); s3.objects.delete(newest);
    const r = combineTombstoneSnapshots({ kv: await h.kvSnap(), copy: await h.copySnap(), copyExpected: true });
    expect(r.problems).toContain('COPY:TOMBSTONE_RECORDS_MISSING');
  });
  it('stale copy: the bucket restored to an older state (marker and records behind Upstash) → refused', async () => {
    const h = await history(1);
    const before = new Map(s3.objects);
    const t = createErasureTombstones({ kv: h.kv, requireRemote: true, copy: createTombstoneCopy(cfg), log: silent() }); const p = person(); await t.record(p); await t.complete(p);
    s3.objects.clear(); for (const [k, v] of before) s3.objects.set(k, v);
    const r = combineTombstoneSnapshots({ kv: await h.kvSnap(), copy: await h.copySnap(), copyExpected: true });
    expect(r.problems).toEqual(['COPY:TOMBSTONE_RECORDS_MISSING']);
  });
  it('missing copy: configured but unreadable, or not given although Upstash records say it was on → COPY:NOT_READ', async () => {
    const h = await history(1);
    expect(combineTombstoneSnapshots({ kv: await h.kvSnap(), copy: null, copyExpected: true }).problems).toEqual(['COPY:NOT_READ']);
    expect(combineTombstoneSnapshots({ kv: await h.kvSnap(), copy: null, copyExpected: false }).problems).toEqual(['COPY:NOT_READ']);
    expect(combineTombstoneSnapshots({ kv: await h.kvSnap(), copy: null }, null, { acceptSingle: 'kv' }).problems).toEqual([]);
  });
  it('complete Upstash loss (list AND marker gone): refused by default; the copy alone only with --accept-single-copy copy', async () => {
    const h = await history(2);
    const empty = { entries: [], last: null, length: 0 };
    const r = combineTombstoneSnapshots({ kv: empty, copy: await h.copySnap(), copyExpected: true });
    expect(r.problems).toEqual(['KV:TOMBSTONE_RECORDS_MISSING']);
    const a = combineTombstoneSnapshots({ kv: empty, copy: await h.copySnap(), copyExpected: true }, null, { acceptSingle: 'copy' });
    expect(a.problems).toEqual([]); expect(a.acceptedSingle).toBe('copy');
    expect(tombstoneStates(a.entries).filter((s) => s.state === 'done')).toHaveLength(2);
    // Upstash not readable at all: same rule
    expect(combineTombstoneSnapshots({ kv: null, copy: await h.copySnap(), copyExpected: true }).problems).toContain('KV:NOT_READ');
  });
  it('Upstash list lost but marker kept: KV problem; accepting the copy still requires the copy itself to be clean', async () => {
    const h = await history(1);
    const snap = await h.kvSnap();
    const r = combineTombstoneSnapshots({ kv: { ...snap, entries: [], length: 0 }, copy: await h.copySnap(), copyExpected: true });
    expect(r.problems).toEqual(expect.arrayContaining(['KV:TOMBSTONE_LAST_RECORD_MISSING', 'KV:TOMBSTONE_RECORDS_MISSING']));
    s3.objects.delete(`${cfg.prefix}last.json`);
    const c = combineTombstoneSnapshots({ kv: { ...snap, entries: [], length: 0 }, copy: await h.copySnap(), copyExpected: true }, null, { acceptSingle: 'copy' });
    expect(c.problems).toEqual(['COPY:TOMBSTONE_LAST_MARKER_MISSING']);
  });
  it('records written before the copy existed are not expected in it; records older than the window are ignored', async () => {
    const kv = memoryKv(); const p = person();
    await createErasureTombstones({ kv, requireRemote: true, copy: null }).record(p);
    const copy = freshCopy();
    const r = combineTombstoneSnapshots({ kv: await createErasureTombstones({ kv, copy: null }).snapshot(), copy: await copy.snapshot(), copyExpected: true });
    expect(r.problems).toEqual([]);
  });
  it('same-millisecond intent and abort keep their order in the union (aborted, never replayed)', () => {
    const at = '2026-11-17T10:00:00.000Z';
    const rec = (phase) => ({ kind: 'ada-erasure-tombstone', phase, requestId: 'r1', subjectId: 's1', domains: ['account'], completedAt: at, copy: 'written' });
    const kvSnap = { entries: [rec('aborted'), rec('intent')], last: { requestId: 'r1', phase: 'aborted', completedAt: at }, length: 2 };
    const copySnap = { entries: [rec('aborted'), rec('intent')], last: { requestId: 'r1', phase: 'aborted', completedAt: at } };
    const r = combineTombstoneSnapshots({ kv: kvSnap, copy: copySnap }, null, { now: Date.parse(at) + 1000 });
    expect(r.problems).toEqual([]); expect(tombstoneStates(r.entries)[0].state).toBe('aborted');
  });
});

describe('D5 b — retention (40 days, explicit delete by the health check)', () => {
  it('records older than 40 days are deleted; younger ones and the marker stay', async () => {
    const copy = freshCopy(); const kv = memoryKv();
    const t = createErasureTombstones({ kv, requireRemote: true, copy, log: silent() });
    const old = { ...person(), at: new Date(Date.now() - 41 * 86400000) }; const young = { ...person(), at: new Date(Date.now() - 39 * 86400000) };
    await t.record(old); await t.record(young);
    const inv = await copy.inventory();
    expect(inv).toMatchObject({ overdue: 1, deleted: 1, deleteFailed: 0, objects: 1, truncated: false });
    expect(s3.objects.has(`${cfg.prefix}last.json`)).toBe(true);
    expect([...s3.objects.keys()].filter((n) => n.includes('/t/')).map(recordTimeOf).every((x) => Date.now() - x < 40 * 86400000)).toBe(true);
  });
  it('a token without delete right is reported, not ignored', async () => {
    freshCopy(); const kv = memoryKv();
    await createErasureTombstones({ kv, requireRemote: true, copy: createTombstoneCopy(cfg), log: silent() }).record({ ...person(), at: new Date(Date.now() - 41 * 86400000) });
    expect(await deniedCopy().inventory()).toMatchObject({ overdue: 1, deleted: 0, deleteFailed: 1 });
  });
});

describe('D5 b — token probe (scripts/tombstone-copy-probe.mjs)', () => {
  it('the right token: put / get / list / delete allowed, ListBuckets refused, nothing left behind; a read-only token fails the probe', async () => {
    const { probe } = await import('../../scripts/tombstone-copy-probe.mjs');
    s3.objects.clear();
    const good = await probe(envFor(s3.endpoint));
    expect(good).toMatchObject({ ok: true, put: 'ALLOWED', get: 'ALLOWED', roundTrip: true, list: 'ALLOWED', delete: 'ALLOWED', listBuckets: 'REFUSED' });
    expect(good.otherBucket).not.toBe('ALLOWED');
    expect(s3.objects.size).toBe(0);
    expect((await probe(envFor(s3.endpoint, { TOMBSTONE_COPY_S3_ACCESS_KEY_ID: 'readonly' }))).ok).toBe(false);
    expect(await probe({})).toEqual({ ok: false, config: 'COPY_CONFIG_MISSING' });
    expect(JSON.stringify(good)).not.toContain(KEY_HEX);
  });
});
