// Y2 (owner, 18/11/2026) — the privacy notice says an erasure trace is kept « 40 jours » (§ 4). The Upstash list used to carry ONE whole-key TTL,
// refreshed by every write: with erasures less than 40 days apart, old traces stayed indefinitely, and the `…:last` marker (request id, no TTL) forever.
// Now every entry expires on its own: entries older than 40 days are dropped on every write AND by the hourly health check; a marker older than 40 days
// keeps no request id; the second copy's marker likewise.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { createErasureTombstones, pruneTombstones, tombstoneCoverage, parseTombstones, TOMBSTONE_KEY, TOMBSTONE_LAST_KEY, TOMBSTONE_TTL_SECONDS } from '../../api/_services/erasure-tombstones.js';
import { copyConfig, createTombstoneCopy } from '../../api/_services/erasure-tombstone-copy.js';
import { startFakeS3 } from '../helpers/fake-s3.mjs';

const DAY = 86400000;
/** a Redis-like list store with a real whole-key TTL (expire), to show that the TTL alone never removed old entries */
const redisLike = () => { const m = new Map(); const ttl = new Map(); const alive = (k) => !ttl.has(k) || ttl.get(k) > Date.now();
  const cut = (l, a, b) => l.slice(a, b < 0 ? l.length + b + 1 : b + 1);
  return { isRemote: true, m,
    async lpush(k, v) { const l = alive(k) ? m.get(k) || [] : []; l.unshift(v); m.set(k, l); return l.length; },
    async lrange(k, a, b) { return alive(k) ? cut(m.get(k) || [], a, b) : []; },
    async ltrim(k, a, b) { m.set(k, cut(m.get(k) || [], a, b)); return 'OK'; },
    async expire(k, s) { ttl.set(k, Date.now() + s * 1000); return 1; },
    async set(k, v) { m.set(k, v); return 'OK'; }, async get(k) { return m.get(k) ?? null; } }; };
const person = (ageDays = 0) => ({ requestId: crypto.randomUUID(), subjectId: crypto.randomUUID(), domains: ['account'], at: new Date(Date.now() - ageDays * DAY) });
const ages = async (kv) => parseTombstones(await kv.lrange(TOMBSTONE_KEY, 0, -1)).map((e) => Math.floor((Date.now() - Date.parse(e.completedAt)) / DAY));

describe('Y2 — Upstash: every entry expires at 40 days, whatever the write rhythm', () => {
  it('a write drops the entries older than 40 days (the whole-key TTL no longer extends them)', async () => {
    const kv = redisLike(); const t = createErasureTombstones({ kv, requireRemote: true, copy: null });
    await t.record(person(45)); await t.complete(person(41)); await t.record(person(39)); await t.record(person(1));
    // the list is newest-first; the two old entries, written before the young ones, are gone after the last write
    expect(await ages(kv)).toEqual([1, 39]);
  });
  it('erasures every few days for months: no entry ever older than 40 days', async () => {
    const kv = redisLike(); const t = createErasureTombstones({ kv, requireRemote: true, copy: null });
    for (let d = 200; d >= 0; d -= 3) await t.record(person(d));
    expect(Math.max(...(await ages(kv)))).toBeLessThanOrEqual(40);
  });
  it('the hourly prune (health check) drops them without any new write, and scrubs an old marker (no request id kept)', async () => {
    const kv = redisLike(); const t = createErasureTombstones({ kv, requireRemote: true, copy: null });
    const old = person(39); await t.record(old);
    expect(await pruneTombstones(kv)).toMatchObject({ removed: 0, kept: 1, markerScrubbed: false });
    const later = Date.now() + 2 * DAY;   // two days later, nothing written meanwhile
    expect(await pruneTombstones(kv, later)).toMatchObject({ removed: 1, kept: 0, markerScrubbed: true });
    expect(await kv.lrange(TOMBSTONE_KEY, 0, -1)).toEqual([]);
    const marker = JSON.parse(kv.m.get(TOMBSTONE_LAST_KEY));
    expect(marker.requestId).toBe(null); expect(JSON.stringify(marker)).not.toContain(old.requestId);
    // the restore's coverage check still works: an expired marker without a list is the normal expiry, not a loss
    expect(tombstoneCoverage({ entries: [], last: marker }, null, later)).toEqual([]);
  });
  it('a marker younger than 40 days is kept intact (it still reveals a lost list)', async () => {
    const kv = redisLike(); const t = createErasureTombstones({ kv, requireRemote: true, copy: null });
    const p = person(10); await t.record(p);
    await pruneTombstones(kv);
    expect(JSON.parse(kv.m.get(TOMBSTONE_LAST_KEY)).requestId).toBe(p.requestId);
    kv.m.delete(TOMBSTONE_KEY);
    expect(tombstoneCoverage({ entries: [], last: JSON.parse(kv.m.get(TOMBSTONE_LAST_KEY)) })).toEqual(['TOMBSTONE_LAST_RECORD_MISSING']);
  });
  it('a prune failure never refuses the erasure (the hourly prune catches up); a store without lists is skipped', async () => {
    const kv = redisLike(); const t = createErasureTombstones({ kv, requireRemote: true, copy: null });
    const lr = kv.lrange; kv.lrange = async () => { throw new Error('read refused'); };
    await expect(t.record(person(0))).resolves.toBeUndefined();
    kv.lrange = lr;
    expect(await pruneTombstones({ get: async () => null })).toEqual({ skipped: 'KV_NO_LIST' });
    expect(TOMBSTONE_TTL_SECONDS).toBe(40 * 86400);
  });
});

describe('Y2 — second copy: its marker keeps no request id after 40 days', () => {
  let s3; let cfg;
  beforeAll(async () => { s3 = await startFakeS3({ bucket: 'ada-erasure-tombstones', keys: { k: { write: true } } });
    cfg = copyConfig({ TOMBSTONE_COPY_S3_ENDPOINT: s3.endpoint, TOMBSTONE_COPY_S3_BUCKET: 'ada-erasure-tombstones', TOMBSTONE_COPY_S3_ACCESS_KEY_ID: 'k',
      TOMBSTONE_COPY_S3_SECRET_ACCESS_KEY: 's', TOMBSTONE_COPY_KEY: 'cd'.repeat(32) }); });
  afterAll(async () => { await s3?.close(); });
  it('inventory() deletes the old records and scrubs the old marker; a young marker is untouched', async () => {
    const copy = createTombstoneCopy(cfg); const p = person(39);
    await createErasureTombstones({ kv: redisLike(), requireRemote: true, copy, log: { error() {}, warn() {} } }).record(p);
    expect((await copy.inventory()).markerScrubbed).toBe(false);
    expect((await copy.snapshot()).last.requestId).toBe(p.requestId);
    const inv = await copy.inventory(Date.now() + 2 * DAY);
    expect(inv).toMatchObject({ deleted: 1, markerScrubbed: true });
    const snap = await copy.snapshot();
    expect(snap.entries).toEqual([]); expect(snap.last.requestId).toBe(null); expect(snap.tampered).toBe(0);
  });
});
