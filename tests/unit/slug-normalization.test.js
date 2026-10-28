import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, expect, it } from 'vitest';

import { ensureSlugOrNull, isValidSlug, normalizeSlug } from '../../api/_utils/slug.js';

describe('slug normalization helpers', () => {
  it('normalizes accented and spaced strings to stable slugs', () => {
    expect(normalizeSlug('  Àide Été 2026 !!! ')).toBe('aide-ete-2026');
    expect(ensureSlugOrNull('  Àide Été 2026 !!! ')).toBe('aide-ete-2026');
  });

  it('returns null for invalid/empty slug values', () => {
    expect(ensureSlugOrNull('###')).toBeNull();
    expect(ensureSlugOrNull('')).toBeNull();
    expect(isValidSlug('Invalid Slug')).toBe(false);
  });
});
