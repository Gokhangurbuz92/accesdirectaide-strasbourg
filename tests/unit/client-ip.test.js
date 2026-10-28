/**
 * Launch-readiness item 48 — one client address for rate limits, consent proofs and audit lines (api/_utils/client-ip.js), and a constant-time debug token.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientIp } from '../../api/_utils/client-ip.js';

afterEach(() => { vi.unstubAllEnvs(); });

describe('client address', () => {
  it('outside Vercel (LAB, tests): the first x-forwarded-for hop, then the socket', () => {
    vi.stubEnv('VERCEL', '');
    expect(clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } })).toBe('1.2.3.4');
    expect(clientIp({ headers: {}, socket: { remoteAddress: '::ffff:127.0.0.1' } })).toBe('::ffff:127.0.0.1');
    expect(clientIp({ headers: { 'x-vercel-forwarded-for': '9.9.9.9' }, socket: { remoteAddress: '127.0.0.1' } })).toBe('127.0.0.1');   // not on Vercel: not trusted
  });
  it('on Vercel: the platform header first (the edge overwrites what a client sends)', () => {
    vi.stubEnv('VERCEL', '1');
    expect(clientIp({ headers: { 'x-vercel-forwarded-for': '203.0.113.7', 'x-real-ip': '203.0.113.8', 'x-forwarded-for': '198.51.100.1' } })).toBe('203.0.113.7');
    expect(clientIp({ headers: { 'x-real-ip': '203.0.113.8', 'x-forwarded-for': '198.51.100.1' } })).toBe('203.0.113.8');
    expect(clientIp({ headers: { 'x-forwarded-for': '198.51.100.1, 10.0.0.2' } })).toBe('198.51.100.1');
  });
  it('only an address-shaped value: header text never becomes a rate-limit key or a log line', () => {
    vi.stubEnv('VERCEL', '');
    expect(clientIp({ headers: { 'x-forwarded-for': '<script>alert(1)</script>' } })).toBe('unknown');
    expect(clientIp({ headers: { 'x-forwarded-for': 'a'.repeat(200) } }, '127.0.0.1')).toBe('127.0.0.1');
    expect(clientIp(undefined)).toBe('unknown');
  });
});

describe('debug token (version endpoint)', () => {
  it('compares in constant time and refuses a missing or wrong token', async () => {
    vi.stubEnv('DEBUG_TOKEN', 'd'.repeat(32));
    const { default: handler } = await import('../../api/_handlers/version.js');
    const mk = () => ({ statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
    for (const t of [undefined, '', 'd'.repeat(31), 'd'.repeat(32) + 'x', 'e'.repeat(32)]) {
      const r = mk(); await handler({ headers: { 'x-debug-token': t, host: 'x' } }, r);
      expect(r.statusCode, String(t)).toBe(401);
    }
    const ok = mk(); await handler({ headers: { 'x-debug-token': 'd'.repeat(32), host: 'x' } }, ok);
    expect(ok.statusCode).toBe(200);
  });
});
