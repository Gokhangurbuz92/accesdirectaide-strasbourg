/**
 * R46 — ProtectedStore (api/lib/protected-store): fail-closed driver selection and the certified-host HTTP contract (CONTRACT.md) against a local mock host.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const LAB = new Map();
vi.mock('../../api/lib/storage.js', () => ({ storage: {
  upload: async (b) => { const k = `lab-${LAB.size + 1}`; LAB.set(k, Buffer.from(b)); return k; },
  download: async (k) => { if (!LAB.has(k)) throw new Error('missing'); return LAB.get(k); },
  delete: async (k) => { LAB.delete(k); },
} }));

const { protectedStoreState, createProtectedStore, protectedStoreStatus, PROTECTED_STORE_REFUSED } = await import('../../api/lib/protected-store/index.js');
const { certifiedHostConfig, createCertifiedHostStore, CERTIFIED_KEY_PREFIX } = await import('../../api/lib/protected-store/certified-host.js');

const TOKEN = 'x'.repeat(40);
const HDS = `HDS1:example-host:CERT-2026-0001:2099-12-31:${'a'.repeat(64)}`;
const EXPIRED = `HDS1:example-host:CERT-2020-0001:2020-01-01:${'a'.repeat(64)}`;

// ── mock certified host (CONTRACT.md § 3)
const OBJECTS = new Map();
const H = { failNext: 0, lastAuth: null, lastIdem: null, puts: 0, corruptGet: false, hits: 0 };
let server; let endpoint;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    H.hits += 1;
    H.lastAuth = req.headers.authorization; H.lastIdem = req.headers['idempotency-key'];
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401); res.end(); return; }
    if (H.failNext > 0) { H.failNext -= 1; res.writeHead(503); res.end(); return; }
    const m = /^\/v1\/objects\/([0-9a-f-]{36})$/.exec(req.url || '');
    if (!m) { res.writeHead(404); res.end(); return; }
    const id = m[1];
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const dg = crypto.createHash('sha256').update(body).digest('hex');
      if (req.method === 'PUT') {
        H.puts += 1;
        if (req.headers['x-content-sha256'] !== dg) { res.writeHead(400); res.end(); return; }
        const existed = OBJECTS.has(id);
        if (existed && OBJECTS.get(id).dg !== dg) { res.writeHead(409); res.end(); return; }
        OBJECTS.set(id, { body, dg });
        res.writeHead(existed ? 200 : 201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id, sha256: dg })); return;
      }
      if (req.method === 'GET') {
        const o = OBJECTS.get(id);
        if (!o) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'X-Content-SHA256': H.corruptGet ? '0'.repeat(64) : o.dg }); res.end(o.body); return;
      }
      if (req.method === 'DELETE') { const had = OBJECTS.delete(id); res.writeHead(had ? 204 : 404); res.end(); return; }
      res.writeHead(405); res.end();
    });
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  endpoint = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => { server.close(r); }));

const certEnv = (extra = {}) => ({ ADA_PROTECTED_STORE: 'certified', ADA_PROTECTED_STORE_ENDPOINT: endpoint, ADA_PROTECTED_STORE_TOKEN: TOKEN, ...extra });

describe('driver selection (fail-closed)', () => {
  it('LAB: the lab driver serves by default in development / test', () => {
    expect(protectedStoreState({})).toMatchObject({ ok: true, driver: 'lab', hdsCertified: false });
    expect(protectedStoreState({ VERCEL_ENV: 'development' }).ok).toBe(true);
  });
  it('production / preview: refused without a valid HDS token, and the lab driver is refused there even with one', () => {
    for (const VERCEL_ENV of ['production', 'preview']) {
      expect(protectedStoreState({ VERCEL_ENV })).toMatchObject({ ok: false, reason: 'HDS_ATTESTATION_ABSENT' });
      expect(protectedStoreState({ VERCEL_ENV, ADA_HDS_CERTIFIED_HOSTING: EXPIRED })).toMatchObject({ ok: false, reason: 'HDS_ATTESTATION_EXPIRED' });
      expect(protectedStoreState({ VERCEL_ENV, ADA_HDS_CERTIFIED_HOSTING: 'HDS1:bad' })).toMatchObject({ ok: false, reason: 'HDS_ATTESTATION_MALFORMED' });
      expect(protectedStoreState({ VERCEL_ENV, ADA_HDS_CERTIFIED_HOSTING: HDS })).toMatchObject({ ok: false, reason: 'LAB_DRIVER_NOT_ALLOWED_IN_DEPLOYED_ENVIRONMENT' });
    }
  });
  it('production: the certified driver needs https (loopback http refused there) and a token', () => {
    expect(protectedStoreState(certEnv({ VERCEL_ENV: 'production', ADA_HDS_CERTIFIED_HOSTING: HDS }))).toMatchObject({ ok: false, reason: 'CERTIFIED_ENDPOINT_NOT_HTTPS' });
    expect(protectedStoreState(certEnv({ VERCEL_ENV: 'production', ADA_HDS_CERTIFIED_HOSTING: HDS, ADA_PROTECTED_STORE_ENDPOINT: 'https://hds.example.test' })))
      .toMatchObject({ ok: true, driver: 'certified', hdsCertified: true });
    expect(protectedStoreState({ ADA_PROTECTED_STORE: 'certified', ADA_PROTECTED_STORE_ENDPOINT: 'https://hds.example.test' })).toMatchObject({ ok: false, reason: 'CERTIFIED_TOKEN_MISSING' });
    expect(certifiedHostConfig({ ADA_PROTECTED_STORE_ENDPOINT: 'http://hds.example.test', ADA_PROTECTED_STORE_TOKEN: TOKEN })).toMatchObject({ ok: false, reason: 'CERTIFIED_ENDPOINT_NOT_HTTPS' });
    expect(certifiedHostConfig({ ADA_PROTECTED_STORE_ENDPOINT: 'https://u:p@hds.example.test', ADA_PROTECTED_STORE_TOKEN: TOKEN })).toMatchObject({ ok: false, reason: 'CERTIFIED_ENDPOINT_INVALID' });
  });
  it('an unknown driver opens nothing; the status line never carries a value', () => {
    expect(protectedStoreState({ ADA_PROTECTED_STORE: 's3' })).toMatchObject({ ok: false, reason: 'UNKNOWN_DRIVER' });
    const st = protectedStoreStatus(certEnv());
    expect(JSON.stringify(st)).not.toContain(TOKEN);
    expect(JSON.stringify(st)).not.toContain(endpoint);
  });
});

describe('protected store operations', () => {
  it('lab driver: round trip through the object storage', async () => {
    const ps = createProtectedStore({ env: {} });
    const k = await ps.upload(Buffer.from('sealed-bytes'));
    expect(k.startsWith(CERTIFIED_KEY_PREFIX)).toBe(false);
    expect((await ps.download(k)).toString()).toBe('sealed-bytes');
    await ps.delete(k);
    expect(LAB.has(k)).toBe(false);
  });
  it('production without HDS: put / get refused (503 code), nothing reaches a store; erasure of an existing key still works', async () => {
    LAB.set('legacy-1', Buffer.from('old'));
    const ps = createProtectedStore({ env: { VERCEL_ENV: 'production' } });
    const before = LAB.size;
    await expect(ps.upload(Buffer.from('x'))).rejects.toMatchObject({ code: PROTECTED_STORE_REFUSED, statusCode: 503 });
    await expect(ps.download('legacy-1')).rejects.toMatchObject({ code: PROTECTED_STORE_REFUSED });
    expect(LAB.size).toBe(before);
    await ps.delete('legacy-1');
    expect(LAB.has('legacy-1')).toBe(false);
  });
  it('certified driver: put / get / delete per the contract, with bearer + idempotency key, prefixed key', async () => {
    const ps = createProtectedStore({ env: certEnv() });
    const k = await ps.upload(Buffer.from('cipher'));
    expect(k).toMatch(/^phs1\/[0-9a-f-]{36}$/);
    expect(H.lastAuth).toBe(`Bearer ${TOKEN}`);
    expect(H.lastIdem).toBe(k.slice(5));
    expect((await ps.download(k)).toString()).toBe('cipher');
    await ps.delete(k);
    await ps.delete(k);   // 404 = already gone: idempotent
    expect(OBJECTS.has(k.slice(5))).toBe(false);
  });
  it('a key never crosses drivers', async () => {
    const lab = createProtectedStore({ env: {} });
    const cert = createProtectedStore({ env: certEnv() });
    const lk = await lab.upload(Buffer.from('a'));
    const ck = await cert.upload(Buffer.from('b'));
    await expect(cert.download(lk)).rejects.toMatchObject({ reason: 'KEY_OF_ANOTHER_DRIVER' });
    await expect(lab.download(ck)).rejects.toMatchObject({ reason: 'KEY_OF_ANOTHER_DRIVER' });
    await expect(createProtectedStore({ env: {} }).delete(ck)).rejects.toMatchObject({ reason: 'CERTIFIED_HOST_NOT_CONFIGURED_FOR_ERASURE' });
  });
  it('retries 5xx (PUT is idempotent with the same id) and gives up after 3 attempts', async () => {
    const store = createCertifiedHostStore(certEnv(), { backoffMs: 1 });
    H.failNext = 2; H.puts = 0;
    const k = await store.upload(Buffer.from('retry'));
    expect(H.puts).toBe(1);   // the two 503 were answered before the body was read
    expect((await store.download(k)).toString()).toBe('retry');
    H.failNext = 3;
    await expect(store.download(k)).rejects.toMatchObject({ code: 'GET_REFUSED', status: 503 });
    H.failNext = 0;
  });
  it('integrity: a GET whose digest does not match is an error; a wrong credential is refused', async () => {
    const store = createCertifiedHostStore(certEnv(), { backoffMs: 1 });
    const k = await store.upload(Buffer.from('integrity'));
    H.corruptGet = true;
    await expect(store.download(k)).rejects.toMatchObject({ code: 'GET_DIGEST_MISMATCH' });
    H.corruptGet = false;
    const wrong = createCertifiedHostStore(certEnv({ ADA_PROTECTED_STORE_TOKEN: 'y'.repeat(40) }), { backoffMs: 1 });
    await expect(wrong.upload(Buffer.from('z'))).rejects.toMatchObject({ code: 'PUT_REFUSED', status: 401 });
  });
  it('an unreachable host is an error after the retries, never a silent success', async () => {
    const store = createCertifiedHostStore(certEnv({ ADA_PROTECTED_STORE_ENDPOINT: 'http://127.0.0.1:9' }), { backoffMs: 1 });
    await expect(store.upload(Buffer.from('q'))).rejects.toMatchObject({ code: 'UNREACHABLE' });
  });
});

describe('Mon Coffre uses the boundary', () => {
  it('mon-espace.js and dossier-files.js take the protected store by default', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('api/_services/mon-espace.js', 'utf8')).toMatch(/import \{ protectedStore as defaultStorage \} from '\.\.\/lib\/protected-store\/index\.js'/);
    expect(readFileSync('api/_services/dossier-files.js', 'utf8')).toContain("import('../lib/protected-store/index.js')).protectedStore");
  });
});
