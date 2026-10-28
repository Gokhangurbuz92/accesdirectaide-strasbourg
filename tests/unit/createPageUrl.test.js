import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, expect, it } from 'vitest';
import { createPageUrl } from '../../src/utils/index.js';

describe('createPageUrl', () => {
  it('maps known public routes to explicit paths', () => {
    expect(createPageUrl('Home')).toBe('/');
    expect(createPageUrl('Aides')).toBe('/aides');
    expect(createPageUrl('AppointmentRequest')).toBe('/appointments/request');
  });

  it('fills dynamic route params when provided', () => {
    expect(createPageUrl('AdminAideEdit', { id: '123' })).toBe('/admin/aides/123');
    expect(createPageUrl('AdminDemarcheEdit', { id: 'abc' })).toBe('/admin/demarches/abc');
  });

  it('uses "new" fallback for missing dynamic params', () => {
    expect(createPageUrl('AdminAideEdit')).toBe('/admin/aides/new');
    expect(createPageUrl('AdminDemarcheEdit', { id: '' })).toBe('/admin/demarches/new');
  });

  it('keeps fallback slug behavior for unknown page names', () => {
    expect(createPageUrl('UnknownPage')).toBe('/unknownpage');
  });
});
