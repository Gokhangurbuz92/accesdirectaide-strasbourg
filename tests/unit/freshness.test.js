import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, expect, it } from 'vitest';
import { getFreshnessBadge, getFreshnessState } from '../../src/lib/provenance.js';

describe('freshness helpers', () => {
  const now = new Date('2026-02-18T00:00:00.000Z');

  it('returns to review label when verification date is missing', () => {
    expect(getFreshnessState(null, now)).toBe('not_verified');
    expect(getFreshnessBadge(null, now).label).toBeNull();
  });

  it('returns up to date when verification is <= 90 days', () => {
    expect(getFreshnessState('2026-01-01T00:00:00.000Z', now)).toBe('up_to_date');
    expect(getFreshnessBadge('2026-01-01T00:00:00.000Z', now).label).toBe('À jour');
  });

  it('returns to review when verification is between 91 and 180 days', () => {
    expect(getFreshnessState('2025-10-10T00:00:00.000Z', now)).toBe('to_review');
    expect(getFreshnessBadge('2025-10-10T00:00:00.000Z', now).label).toBe('À actualiser');
  });

  it('returns at risk when verification is older than 180 days', () => {
    expect(getFreshnessState('2025-01-01T00:00:00.000Z', now)).toBe('at_risk');
    expect(getFreshnessBadge('2025-01-01T00:00:00.000Z', now).label).toBe('À risque');
  });

  it('treats future dates as up to date', () => {
    expect(getFreshnessState('2027-01-01T00:00:00.000Z', now)).toBe('up_to_date');
  });
});
