/**
 * CronAuth Utility — Unit Tests
 *
 * Tests for getCronAuth (validates CRON_SECRET from header, bearer, or query)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getCronAuth, getCronToken, getHeader, getBearer } from '../../api/_utils/cronAuth.js';

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
});

function makeReq(overrides = {}) {
  return {
    headers: {},
    query: {},
    url: '/api/cron/test',
    ...overrides,
  };
}

describe('getCronAuth', () => {
  it('returns ok:true for valid x-cron-secret header', () => {
    process.env.CRON_SECRET = 'my-cron-secret';
    const result = getCronAuth(makeReq({
      headers: { 'x-cron-secret': 'my-cron-secret' },
    }));
    expect(result.ok).toBe(true);
  });

  it('returns ok:true for valid Bearer token', () => {
    process.env.CRON_SECRET = 'my-cron-secret';
    const result = getCronAuth(makeReq({
      headers: { authorization: 'Bearer my-cron-secret' },
    }));
    expect(result.ok).toBe(true);
  });

  it('returns ok:true for legacy ?secret= query param', () => {
    process.env.CRON_SECRET = 'my-cron-secret';
    const result = getCronAuth(makeReq({
      query: { secret: 'my-cron-secret' },
    }));
    expect(result.ok).toBe(true);
  });

  it('rejects wrong secret', () => {
    process.env.CRON_SECRET = 'my-cron-secret';
    const result = getCronAuth(makeReq({
      headers: { 'x-cron-secret': 'wrong-secret' },
    }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unauthorized');
  });

  it('rejects wrong secret of SAME length (timing-safe)', () => {
    process.env.CRON_SECRET = 'my-cron-secret';
    const result = getCronAuth(makeReq({
      headers: { 'x-cron-secret': 'xx-cron-secret' }, // same length, different content
    }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unauthorized');
  });

  it('rejects when no secret is provided at all', () => {
    process.env.CRON_SECRET = 'my-cron-secret';
    const result = getCronAuth(makeReq({}));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unauthorized');
  });

  it('returns reason:missing_secret when CRON_SECRET env is not set', () => {
    delete process.env.CRON_SECRET;
    const result = getCronAuth(makeReq({
      headers: { 'x-cron-secret': 'any-secret' },
    }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_secret');
  });

  it('prioritizes x-cron-secret header over query params', () => {
    process.env.CRON_SECRET = 'correct-secret';
    const result = getCronAuth(makeReq({
      headers: { 'x-cron-secret': 'correct-secret' },
      query: { secret: 'wrong-secret' },
    }));
    expect(result.ok).toBe(true);
  });

  it('rejects empty string secret header', () => {
    process.env.CRON_SECRET = 'my-cron-secret';
    const result = getCronAuth(makeReq({
      headers: { 'x-cron-secret': '' },
    }));
    expect(result.ok).toBe(false);
  });
});

describe('getCronToken', () => {
  it('extracts token from x-cron-secret header', () => {
    expect(getCronToken(makeReq({
      headers: { 'x-cron-secret': 'abc123' },
    }))).toBe('abc123');
  });

  it('extracts token from Bearer auth', () => {
    expect(getCronToken(makeReq({
      headers: { authorization: 'Bearer token-xyz' },
    }))).toBe('token-xyz');
  });

  it('extracts token from ?secret= query', () => {
    expect(getCronToken(makeReq({
      query: { secret: 'query-secret' },
    }))).toBe('query-secret');
  });

  it('returns null when nothing is provided', () => {
    expect(getCronToken(makeReq())).toBeNull();
  });
});

describe('getHeader', () => {
  it('returns header value with lowercase keys (Node.js convention)', () => {
    expect(getHeader({ headers: { 'x-custom': 'val' } }, 'x-custom')).toBe('val');
    expect(getHeader({ headers: { 'x-custom': 'val' } }, 'X-Custom')).toBe('val');
  });

  it('returns undefined for missing header', () => {
    expect(getHeader({ headers: {} }, 'x-missing')).toBeUndefined();
  });

  it('handles null req', () => {
    expect(getHeader(null, 'test')).toBeUndefined();
  });
});

describe('getBearer', () => {
  it('extracts Bearer token from Authorization header', () => {
    expect(getBearer({ headers: { authorization: 'Bearer mytoken' } })).toBe('mytoken');
  });

  it('returns null when no Authorization header', () => {
    expect(getBearer({ headers: {} })).toBeNull();
  });

  it('returns null for non-Bearer schemes', () => {
    expect(getBearer({ headers: { authorization: 'Basic abc123' } })).toBeNull();
  });
});
