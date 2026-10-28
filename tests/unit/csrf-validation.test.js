/**
 * CSRF Utility — Unit Tests
 *
 * Tests for csrfCheck double-submit cookie validation
 */
import { describe, it, expect, vi } from 'vitest';
import { csrfCheck, ensureCsrfCookie } from '../../api/_utils/csrf.js';

describe('csrfCheck', () => {
  function makeRes() {
    return { setHeader: vi.fn() };
  }

  it('allows GET requests without CSRF token', () => {
    const req = { method: 'GET', url: '/api/aides', headers: {} };
    const result = csrfCheck(req, makeRes());
    expect(result.ok).toBe(true);
  });

  it('allows HEAD requests without CSRF token', () => {
    const req = { method: 'HEAD', url: '/api/aides', headers: {} };
    const result = csrfCheck(req, makeRes());
    expect(result.ok).toBe(true);
  });

  it('allows OPTIONS requests without CSRF token', () => {
    const req = { method: 'OPTIONS', url: '/api/aides', headers: {} };
    const result = csrfCheck(req, makeRes());
    expect(result.ok).toBe(true);
  });

  it('allows requests with Bearer token (API-to-API exempt)', () => {
    const req = {
      method: 'POST',
      url: '/api/admin/aides',
      headers: { authorization: 'Bearer some-jwt-token' },
    };
    const result = csrfCheck(req, makeRes());
    expect(result.ok).toBe(true);
  });

  it('allows health check routes', () => {
    const req = {
      method: 'POST',
      url: '/api/health',
      headers: {},
    };
    const result = csrfCheck(req, makeRes());
    expect(result.ok).toBe(true);
  });

  it('allows cron routes', () => {
    const req = {
      method: 'GET',
      url: '/api/cron/gdpr-purge',
      headers: {},
    };
    const result = csrfCheck(req, makeRes());
    expect(result.ok).toBe(true);
  });

  it('allows monitor routes', () => {
    const req = {
      method: 'GET',
      url: '/api/monitor/core',
      headers: {},
    };
    const result = csrfCheck(req, makeRes());
    expect(result.ok).toBe(true);
  });

  it('rejects POST without CSRF token on non-exempt routes', () => {
    const req = {
      method: 'POST',
      url: '/api/admin/aides',
      headers: {},
    };
    const result = csrfCheck(req, makeRes());
    expect(result.ok).toBe(false);
    expect(result.error).toContain('CSRF');
  });

  it('rejects when cookie and header mismatch', () => {
    const req = {
      method: 'POST',
      url: '/api/admin/aides',
      headers: {
        'x-csrf-token': 'token-a',
        cookie: '__csrf=token-b',
      },
    };
    const result = csrfCheck(req, makeRes());
    expect(result.ok).toBe(false);
    expect(result.error).toContain('mismatch');
  });

  it('accepts when cookie and header match (double-submit)', () => {
    const req = {
      method: 'POST',
      url: '/api/admin/aides',
      headers: {
        'x-csrf-token': 'valid-token-123',
        cookie: '__csrf=valid-token-123',
      },
    };
    const result = csrfCheck(req, makeRes());
    expect(result.ok).toBe(true);
  });

  it('rejects DELETE without CSRF token', () => {
    const req = {
      method: 'DELETE',
      url: '/api/admin/aides/123',
      headers: {},
    };
    const result = csrfCheck(req, makeRes());
    expect(result.ok).toBe(false);
  });

  it('rejects PATCH without CSRF token', () => {
    const req = {
      method: 'PATCH',
      url: '/api/pro/services/1',
      headers: {},
    };
    const result = csrfCheck(req, makeRes());
    expect(result.ok).toBe(false);
  });
});

describe('ensureCsrfCookie', () => {
  it('sets __csrf cookie when not present', () => {
    const req = { headers: {} };
    const res = { setHeader: vi.fn() };
    ensureCsrfCookie(req, res);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.arrayContaining([expect.stringContaining('__csrf=')])
    );
  });

  it('does NOT set cookie when already present', () => {
    const req = { headers: { cookie: '__csrf=existing-token' } };
    const res = { setHeader: vi.fn() };
    ensureCsrfCookie(req, res);
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});
