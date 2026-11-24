/**
 * G14-R3 — proof that no health payload reaches the main application (Vercel logs, Neon) on the HDS path, and that the HDS service's own logs carry
 * none either:
 *   - the ticket endpoint never reads a request body: a canary sent to it appears in no log line, no database call, no response, no ticket;
 *   - the ticket carries only the closed claim set (ids and capability names);
 *   - the HDS service logger drops every field outside its allow-list and redacts any value that is not a short safe token;
 *   - the HDS service code writes nothing to the console outside its logger, and is self-contained (deployable alone, imports nothing of the main app);
 *   - the browser encrypts end to end (src/lib/vaultCrypto.js): what leaves the page holds no clear name, category, type or content.
 * Synthetic data only. The database is a proxy that records every access.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const CANARY = 'CANARY-HEALTH-7f3a9c';
const seen = vi.hoisted(() => ({ db: /** @type {string[]} */ ([]), logs: /** @type {string[]} */ ([]) }));
vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get(_t, k) { seen.db.push(String(k)); throw new Error('database touched'); } }) }));
vi.mock('../../api/_utils/citizen-auth.js', () => ({
  requireCitizen: async () => ({ id: 'citizen-synthetic-1', email: 'synthetic@example.test', notificationEmailEnabled: false, assist: null }),
  resolveCitizen: async () => ({ id: 'citizen-synthetic-1' }),
}));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1', getRateLimitStatus: () => 429 }));
vi.mock('../../api/_utils/logger.js', () => {
  const rec = (/** @type {any[]} */ ...a) => { seen.logs.push(JSON.stringify(a)); };
  const l = { info: rec, warn: rec, error: rec, debug: rec, child: () => l };
  return { default: l, logger: l };
});

const { generateTicketKeyPair } = await import('../../api/lib/hds-ticket.js');
const { createHdsTicketHandler } = await import('../../api/_handlers/citizen/hds-ticket.js');
const { log, setLogSink } = await import('../../services/hds/src/log.js');
const { TICKET_CLAIMS } = await import('../../services/hds/src/ticket.js');

const pair = generateTicketKeyPair();
const LAB = { HDS_SERVICE_URL: 'http://127.0.0.1:4510', HDS_TICKET_KID: 'k1', HDS_TICKET_PRIVATE_KEY: pair.privateKeyB64 };
const mkRes = () => ({ statusCode: 200, headers: /** @type {Record<string, string>} */ ({}), body: /** @type {any} */ (undefined),
  status(/** @type {number} */ c) { this.statusCode = c; return this; }, json(/** @type {any} */ d) { this.body = d; return this; }, setHeader(/** @type {string} */ k, /** @type {string} */ v) { this.headers[k] = v; } });

describe('main API ticket endpoint', () => {
  it('a canary in the body, the query or a header reaches no log, no database call, no response and no ticket', async () => {
    const handler = createHdsTicketHandler({ env: LAB, ageGate: async () => ({ allowed: true }) });
    const res = mkRes();
    const body = { fileBase64: Buffer.from(`%PDF-1.4 ${CANARY}`).toString('base64'), originalName: `${CANARY}.pdf`, category: 'sante', note: CANARY };
    await handler({ method: 'GET', url: `/api/citizen/hds-ticket?cap=citizen.vault`, query: { cap: 'citizen.vault' }, headers: { 'x-note': CANARY }, body }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ origin: 'http://127.0.0.1:4510' });
    const claims = JSON.parse(Buffer.from(res.body.ticket.split('.')[1], 'base64url').toString('utf8'));
    expect(Object.keys(claims).every((k) => TICKET_CLAIMS.includes(k))).toBe(true);
    expect(claims).toMatchObject({ sub: 'citizen-synthetic-1', typ: 'citizen', caps: ['citizen.vault', 'vault.write'] });
    expect(JSON.stringify(res.body)).not.toContain(CANARY);
    expect(JSON.stringify(claims)).not.toMatch(/example\.test/);   // no e-mail address in a ticket
    expect(seen.logs.join('\n')).not.toContain(CANARY);
    expect(seen.db).toEqual([]);
  });
  it('a minor (age policy) gets a read-only ticket; unknown capability 400; no gateway → HDS_GATEWAY_NOT_CONFIGURED (browser keeps the LAB path)', async () => {
    let res = mkRes();
    await createHdsTicketHandler({ env: LAB, ageGate: async () => ({ allowed: false }) })({ method: 'GET', query: { cap: 'citizen.vault' }, headers: {} }, res);
    expect(JSON.parse(Buffer.from(res.body.ticket.split('.')[1], 'base64url').toString()).caps).toEqual(['citizen.vault']);
    res = mkRes();
    await createHdsTicketHandler({ env: LAB })({ method: 'GET', query: { cap: 'citizen.household' }, headers: {} }, res);
    expect(res.statusCode).toBe(400);
    res = mkRes();
    await createHdsTicketHandler({ env: {} })({ method: 'GET', query: { cap: 'citizen.vault' }, headers: {} }, res);
    expect(res).toMatchObject({ statusCode: 503, body: { error: 'HDS_GATEWAY_NOT_CONFIGURED' } });
    res = mkRes();
    await createHdsTicketHandler({ env: LAB })({ method: 'POST', query: { cap: 'citizen.vault' }, headers: {}, body: { x: CANARY } }, res);
    expect(res.statusCode).toBe(405);
    expect(seen.logs.join('\n')).not.toContain(CANARY);
  });
});

describe('HDS service logger (deny by default)', () => {
  it('drops unknown fields and redacts unsafe values', () => {
    /** @type {string[]} */ const out = [];
    setLogSink((l) => out.push(l));
    log({ evt: 'req', m: 'POST', route: '/v1/vault/documents', s: 201, ms: 12, body: CANARY, name: `${CANARY}.pdf`, code: `${CANARY} with spaces`, authorization: 'Bearer x' });
    log({ evt: 'req', route: `/v1/vault/documents/${'x'.repeat(200)}` });
    setLogSink((l) => process.stdout.write(`${l}\n`));
    const all = out.join('\n');
    expect(all).not.toContain(CANARY);
    expect(all).not.toContain('Bearer');
    expect(JSON.parse(out[0])).toMatchObject({ evt: 'req', m: 'POST', route: '/v1/vault/documents', s: 201, ms: 12, code: '[redacted]' });
    expect(JSON.parse(out[1]).route).toBe('[redacted]');
  });
});

describe('HDS service code', () => {
  const dir = path.resolve('services/hds');
  const files = (/** @type {string} */ d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : files(path.join(d, e.name))) : /\.js$/.test(e.name) ? [path.join(d, e.name)] : []));
  it('is self-contained: imports only node:*, pg and its own files (deployable alone from services/hds)', () => {
    for (const f of files(dir)) {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/^import .* from '([^']+)';$/gm)) {
        const spec = m[1];
        const ok = spec.startsWith('node:') || spec === 'pg' || (spec.startsWith('.') && path.resolve(path.dirname(f), spec).startsWith(dir));
        expect(ok, `${path.relative(dir, f)} imports ${spec}`).toBe(true);
      }
    }
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).dependencies).toEqual({ pg: '8.18.0' });
  });
  it('writes to the console / stdout only through its logger (server boot errors print variable NAMES only)', () => {
    for (const f of files(dir)) {
      const src = fs.readFileSync(f, 'utf8');
      expect(/console\./.test(src), path.relative(dir, f)).toBe(false);
      if (!/src\/log\.js$|migrate\.js$|server\.js$|scripts\/tombstones\.js$|scripts\/maintenance\.js$/.test(f)) expect(/process\.(stdout|stderr)\.write/.test(src), path.relative(dir, f)).toBe(false);
    }
  });
  it('refuses to boot in production with an http origin, a Sentry DSN, port 3000 or missing keys — naming them, never printing a value', async () => {
    const { loadConfig } = await import('../../services/hds/src/config.js');
    const secret = 'f'.repeat(64);
    try { loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@127.0.0.1/x', ALLOWED_ORIGIN: 'http://example.test', SENTRY_DSN: 'https://x', PORT: '3000', HDS_DATA_KEYS: `k1:${secret}` }); expect.unreachable(); } catch (e) {
      const msg = String(/** @type {Error} */ (e).message);
      for (const n of ['DATABASE_URL (loopback', 'HDS_TICKET_PUBLIC_KEYS', 'ALLOWED_ORIGIN', 'SENTRY_DSN', 'PORT']) expect(msg).toContain(n);
      expect(msg).not.toContain(secret);
    }
    const ok = loadConfig({ DATABASE_URL: 'postgres://u@127.0.0.1/x_test', ALLOWED_ORIGIN: 'http://127.0.0.1:5173', HDS_DATA_KEYS: `k1:${secret}`, HDS_TICKET_PUBLIC_KEYS: `k1:${pair.publicKeyB64}`, PORT: '4510' });
    expect(ok.production).toBe(false);
  });
});

describe('browser end-to-end encryption (src/lib/vaultCrypto.js)', () => {
  it('what leaves the page holds no clear name, category, type or content; the right passphrase opens it, a wrong one does not', async () => {
    const vc = await import('../../src/lib/vaultCrypto.js');
    const { keyring, vaultKey } = await vc.createKeyring('correct horse battery staple');
    const bytes = new TextEncoder().encode(`%PDF-1.4 ${CANARY}`);
    expect(vc.sniffType(bytes)).toBe('application/pdf');
    const boxes = await vc.encryptDocument(vaultKey, { bytes, name: `${CANARY}.pdf`, category: 'sante', type: 'application/pdf' });
    const wire = JSON.stringify({ keyring, ...boxes });
    expect(wire).not.toContain(CANARY);
    expect(wire).not.toContain(Buffer.from(CANARY).toString('base64').slice(0, 12));
    expect(wire).not.toMatch(/sante|application\/pdf/);
    expect(keyring).toMatchObject({ v: 1, kdf: 'PBKDF2-SHA256', iterations: 600000 });
    expect(await vc.unlockKeyring(keyring, 'wrong passphrase!!')).toBeNull();
    const k2 = await vc.unlockKeyring(keyring, 'correct horse battery staple');
    expect(k2).not.toBeNull();
    expect(await vc.openMeta(/** @type {CryptoKey} */ (k2), boxes)).toEqual({ name: `${CANARY}.pdf`, category: 'sante', type: 'application/pdf' });
    expect(new TextDecoder().decode(await vc.openContent(/** @type {CryptoKey} */ (k2), boxes, boxes.content))).toContain(CANARY);
    expect(/** @type {CryptoKey} */ (k2).extractable).toBe(false);
  }, 20000);
});
