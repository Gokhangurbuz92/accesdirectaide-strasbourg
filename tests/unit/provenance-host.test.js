import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, expect, it } from 'vitest';
import { extractSourceHost } from '../../src/lib/provenance.js';

describe('extractSourceHost', () => {
  it('returns hostname for a valid URL', () => {
    expect(extractSourceHost('https://www.service-public.fr/path')).toBe('www.service-public.fr');
  });

  it('returns null for invalid URL strings', () => {
    expect(extractSourceHost('not-a-url')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractSourceHost('')).toBeNull();
    expect(extractSourceHost(null)).toBeNull();
  });
});
