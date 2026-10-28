/**
 * Monitor, Health & Rate Limit Utilities — Integration Tests
 *
 * Tests for health handler, rate limit utilities, and client IP extraction
 */
import { describe, it, expect, vi } from 'vitest';

vi.stubEnv('KV_REST_API_URL', 'http://localhost');
vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.getHeader = vi.fn();
  res.setHeader = vi.fn().mockReturnThis();
  res.writeHead = vi.fn();
  res.end = vi.fn();
  res.status = vi.fn(function(code) { res.statusCode = code; return res; });
  res.json = vi.fn().mockReturnThis();
  res.send = vi.fn().mockReturnThis();
  return res;
}

describe('Health endpoint', () => {
  it('returns ok:true for GET /api/health', async () => {
    const { default: handler } = await import('../../api/_handlers/health.js');
    const req = { method: 'GET', headers: {} };
    const res = mockRes();
    await handler(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
    );
  });

  it('includes service name in health response', async () => {
    const { default: handler } = await import('../../api/_handlers/health.js');
    const req = { method: 'GET', headers: {} };
    const res = mockRes();
    await handler(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.service).toBe('acces-direct-aide');
  });
});

describe('Rate Limit utility', () => {
  it('getClientIp extracts first IP from x-forwarded-for header', async () => {
    const { getClientIp } = await import('../../api/_utils/rateLimit.js');
    const req = { headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } };
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('getClientIp handles single IP in x-forwarded-for', async () => {
    const { getClientIp } = await import('../../api/_utils/rateLimit.js');
    const req = { headers: { 'x-forwarded-for': '5.6.7.8' } };
    expect(getClientIp(req)).toBe('5.6.7.8');
  });

  it('getClientIp falls back to socket.remoteAddress', async () => {
    const { getClientIp } = await import('../../api/_utils/rateLimit.js');
    const req = { headers: {}, socket: { remoteAddress: '192.168.1.1' } };
    expect(getClientIp(req)).toBe('192.168.1.1');
  });

  it('getClientIp falls back to 127.0.0.1 when nothing is available', async () => {
    const { getClientIp } = await import('../../api/_utils/rateLimit.js');
    const req = { headers: {} };
    expect(getClientIp(req)).toBe('127.0.0.1');
  });

  it('getRateLimitStatus returns custom status when provided', async () => {
    const { getRateLimitStatus } = await import('../../api/_utils/rateLimit.js');
    expect(getRateLimitStatus({ status: 503 })).toBe(503);
    expect(getRateLimitStatus({ status: 429 })).toBe(429);
    expect(getRateLimitStatus({ status: 200 })).toBe(200);
  });

  it('getRateLimitStatus defaults to 429 for null/undefined/empty', async () => {
    const { getRateLimitStatus } = await import('../../api/_utils/rateLimit.js');
    expect(getRateLimitStatus(null)).toBe(429);
    expect(getRateLimitStatus(undefined)).toBe(429);
    expect(getRateLimitStatus({})).toBe(429);
  });

  it('checkRateLimit allows first request within limit (memory fallback)', async () => {
    const { checkRateLimit } = await import('../../api/_utils/rateLimit.js');
    // In test env without real KV, it falls back to in-memory store
    const result = await checkRateLimit('ADMIN_API', `test-user-${Date.now()}`);
    expect(result.allowed).toBe(true);
  });


});
