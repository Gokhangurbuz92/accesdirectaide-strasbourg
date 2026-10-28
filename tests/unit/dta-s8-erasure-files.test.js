/**
 * DTA S8 — erasing a dossier must erase its encrypted documents in object storage.
 * Before S8 dossier-revoke, the retention purge (cron gdpr-purge) and the DSR deletion removed the SharedDiagnostic row (grants / threads / messages cascade) but never the blobs
 * referenced by results._files[].storageKey: the "erased" person's encrypted files stayed in storage indefinitely.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const S = vi.hoisted(() => ({ deleted: [], failKeys: new Set(), row: null, rowAfterDelete: [] }));
vi.mock('../../api/lib/storage.js', () => ({ storage: { delete: async (k) => { if (S.failKeys.has(k)) throw new Error('storage down'); S.deleted.push(k); } } }));
vi.mock('../../api/_utils/logger.js', () => { const m = () => {}; return { default: { info: m, warn: m, error: m, debug: m } }; });
vi.mock('../../src/db/index.js', () => ({
  db: {
    query: { SharedDiagnostic: { findFirst: async () => S.row } },
    delete: () => ({ where: () => ({ returning: async () => S.rowAfterDelete }) }),
  },
}));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1', getRateLimitStatus: () => 429 }));
vi.mock('../../api/_utils/auth.js', () => ({ logProAudit: async () => {} }));
vi.mock('../../api/_utils/share-access.js', () => ({ readOwnerSecret: () => 'owner', holdsOwnerSecret: () => true, holdsOwnership: () => true }));

import { purgeDossierFiles, storageKeysOf } from '../../api/_services/dossier-files.js';
import revoke from '../../api/_handlers/public/dossier-revoke.js';

const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });
beforeEach(() => { S.deleted.length = 0; S.failKeys.clear(); S.row = { id: 'sd1', rightsSecretHash: 'h', shareTokenHash: 't' }; S.rowAfterDelete = [{ id: 'sd1', results: { _files: [{ id: 'a', storageKey: 'k1' }, { id: 'b', storageKey: 'k2' }, { id: 'c' }, null] } }]; });

describe('storageKeysOf', () => {
  it('keeps only string keys of well-formed entries', () => {
    expect(storageKeysOf({ _files: [{ storageKey: 'k1' }, { storageKey: '' }, { storageKey: 5 }, {}, null, 'x'] })).toEqual(['k1']);
    for (const bad of [null, undefined, 'str', 3, {}, { _files: 'nope' }, { _files: {} }]) expect(storageKeysOf(bad)).toEqual([]);
  });
});

describe('purgeDossierFiles', () => {
  it('deletes each distinct key once', async () => {
    const calls = [];
    const r = await purgeDossierFiles(['a', 'b', 'a', '', null], { storage: { delete: async (k) => { calls.push(k); } } });
    expect(calls).toEqual(['a', 'b']);
    expect(r).toEqual({ requested: 2, deleted: 2, failed: [] });
  });
  it('is best effort: one failure is reported and the others are still deleted; it never throws', async () => {
    const calls = [];
    const r = await purgeDossierFiles(['a', 'bad', 'c'], { storage: { delete: async (k) => { if (k === 'bad') throw new Error('x'); calls.push(k); } } });
    expect(calls).toEqual(['a', 'c']);
    expect(r).toEqual({ requested: 3, deleted: 2, failed: ['bad'] });
  });
  it('nothing to delete: storage is not even loaded', async () => {
    expect(await purgeDossierFiles([])).toEqual({ requested: 0, deleted: 0, failed: [] });
    expect(await purgeDossierFiles(undefined)).toEqual({ requested: 0, deleted: 0, failed: [] });
  });
});

describe('citizen erasure (POST /api/public/dossier-revoke)', () => {
  const call = async () => { const r = mk(); await revoke({ method: 'POST', body: { shareId: 'sd1' }, headers: {} }, r); return r; };
  it('after the row is deleted the dossier documents are deleted from storage', async () => {
    const r = await call();
    expect(r.statusCode).toBe(200);
    expect(S.deleted.sort()).toEqual(['k1', 'k2']);
  });
  it('a storage failure never turns a successful erasure into an error', async () => {
    S.failKeys.add('k1');
    const r = await call();
    expect(r.statusCode).toBe(200);
    expect(S.deleted).toEqual(['k2']);
  });
  it('a refused erasure (nothing deleted) touches no file', async () => {
    S.rowAfterDelete = [];
    const r = await call();
    expect(r.statusCode).toBe(404);
    expect(S.deleted).toEqual([]);
  });
});

describe('the other two erasure paths call the same purge after the delete', () => {
  it('cron gdpr-purge: returning(results) then purgeDossierFiles', () => {
    const src = readFileSync('api/_handlers/cron/gdpr-purge.js', 'utf8');
    const del = src.indexOf('db.delete(SharedDiagnostic)');
    const ret = src.indexOf('.returning({ id: SharedDiagnostic.id, results: SharedDiagnostic.results })', del);
    const purge = src.indexOf('purgeDossierFiles(', ret);
    expect(del).toBeGreaterThan(-1); expect(ret).toBeGreaterThan(del); expect(purge).toBeGreaterThan(ret);
  });
  it('DSR deletion: keys are collected inside the transaction and purged only after it commits', () => {
    const src = readFileSync('api/_services/privacy.js', 'utf8');
    const collect = src.indexOf('dossierStorageKeys.push(...storageKeysOf(row?.results))');
    const commit = src.indexOf('await executeWithTransaction(db,');
    const purge = src.indexOf('await purgeDossierFiles(dossierStorageKeys)');
    expect(commit).toBeGreaterThan(-1); expect(collect).toBeGreaterThan(commit); expect(purge).toBeGreaterThan(collect);
  });
});
