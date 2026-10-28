/**
 * PKG-11 / PUB-6 — public dossier creation is bounded per address: the router wraps the byte-pinned create.js with api/_utils/share-create-limit.js, which
 * rate-limits and then hands every accepted request to create.js (stubbed here: this test is about the gate, the creation itself is covered by the real-DB suites).
 */
import fs from 'node:fs';
import { vi, describe, expect, it } from 'vitest';

const created = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../api/_handlers/share/create.js', () => ({ default: async (req, res) => { created.n += 1; return res.status(200).json({ ok: true }); } }));

const mkRes = () => ({ statusCode: 200, headers: {}, body: undefined, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; return this; } });
const req = (ip, method = 'POST') => ({ method, url: '/api/share/create', query: {}, body: {}, headers: { host: 'localhost', 'x-forwarded-for': ip }, socket: { remoteAddress: ip } });

describe('PUB-6 share/create rate limit', () => {
  it('routes share/create through the limiter; create.js itself is unchanged and still the handler of every accepted request', async () => {
    const { routes } = await import('../../api/routes.js');
    const r = routes.find((x) => x.path === 'share/create');
    const line = fs.readFileSync('api/routes.js', 'utf8').split('\n').find((l) => l.includes("path: 'share/create'"));
    expect(line).toContain("import('./_handlers/share/create.js')"); expect(line).toContain("import('./_utils/share-create-limit.js')"); expect(line).toContain('withShareCreateLimit(m.default)');
    const mod = await r.handler(); const res = mkRes(); await mod.default(req('203.0.113.99'), res);
    expect(res.statusCode).toBe(200); expect(created.n).toBeGreaterThan(0);   // the routed handler is the gate in front of (the stubbed) create.js
    expect(fs.readFileSync('api/_utils/share-create-limit.js', 'utf8')).not.toMatch(/import .*create\.js/);
  });

  it('accepts 60 creations per address in 10 minutes, then answers 429 in French without calling create.js; another address is not affected; GET is not counted', async () => {
    const createStub = (await import('../../api/_handlers/share/create.js')).default;
    const handler = (await import('../../api/_utils/share-create-limit.js')).withShareCreateLimit(createStub);
    created.n = 0;
    for (let i = 0; i < 60; i += 1) { const res = mkRes(); await handler(req('203.0.113.7'), res); expect(res.statusCode).toBe(200); }
    const over = mkRes(); await handler(req('203.0.113.7'), over);
    expect(over.statusCode).toBe(429); expect(over.body.code).toBe('RATE_LIMITED'); expect(over.body.error).toBe('Trop de tentatives.'); expect(over.headers['Retry-After']).toBe('600');
    expect(created.n).toBe(60);
    const other = mkRes(); await handler(req('203.0.113.8'), other); expect(other.statusCode).toBe(200);
    const get = mkRes(); await handler(req('203.0.113.7', 'GET'), get); expect(created.n).toBe(62);   // GET goes to create.js (its own 405), never counted
  });
});
