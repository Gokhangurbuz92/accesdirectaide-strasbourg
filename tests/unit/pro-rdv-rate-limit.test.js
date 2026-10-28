import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, expect, it } from 'vitest';

import {
  buildProRdvRateLimitKey,
  buildRateLimitSubjectKey,
  computeRetryAfterSeconds,
  isWriteMethod,
} from '../../api/_utils/pro-rdv-rate-limit.js';

describe('pro rdv rate limit helpers', () => {
  it('builds deterministic tenant-scoped subject keys', () => {
    const first = buildRateLimitSubjectKey({ userId: 'user-1', structureId: 'structure-1' });
    const second = buildRateLimitSubjectKey({ userId: 'user-1', structureId: 'structure-1' });
    const other = buildRateLimitSubjectKey({ userId: 'user-2', structureId: 'structure-1' });

    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).toMatch(/^[a-f0-9]{24}:[a-f0-9]{24}$/);
  });

  it('builds stable keys with scope and bucket', () => {
    const subject = buildRateLimitSubjectKey({ userId: 'u', structureId: 's' });
    const key = buildProRdvRateLimitKey({ scope: 'write', subject, bucket: 'm:12345' });

    expect(key).toContain('rl:pro-rdv:write:');
    expect(key).toContain(':m:12345');
  });

  it('computes retry-after within the current window', () => {
    const windowSeconds = 60;
    const nowMs = 123_456;
    const retry = computeRetryAfterSeconds(windowSeconds, nowMs);

    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(windowSeconds);
  });

  it('classifies write methods correctly', () => {
    expect(isWriteMethod('GET')).toBe(false);
    expect(isWriteMethod('POST')).toBe(true);
    expect(isWriteMethod('PATCH')).toBe(true);
  });
});
