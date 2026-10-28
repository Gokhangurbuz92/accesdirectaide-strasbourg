import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { afterEach, describe, expect, it } from 'vitest';
import { getCanonicalOrigin } from '../../api/_utils/site-origin.js';

function createReq(headers = {}) {
  return { headers };
}

const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;

afterEach(() => {
  if (typeof ORIGINAL_VERCEL_ENV === 'undefined') {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV;
  }
});

describe('site origin helper', () => {
  it('forces production canonical origin when VERCEL_ENV=production', () => {
    process.env.VERCEL_ENV = 'production';

    const origin = getCanonicalOrigin(
      createReq({
        host: 'random-preview.vercel.app',
        'x-forwarded-host': 'random-preview.vercel.app',
        'x-forwarded-proto': 'https',
      }),
    );

    expect(origin).toBe('https://www.accesdirectaide.fr');
  });

  it('uses forwarded protocol and host in preview/dev', () => {
    process.env.VERCEL_ENV = 'preview';

    const origin = getCanonicalOrigin(
      createReq({
        host: 'localhost:3000',
        'x-forwarded-host': 'preview-accesdirectaide.vercel.app',
        'x-forwarded-proto': 'https',
      }),
    );

    expect(origin).toBe('https://preview-accesdirectaide.vercel.app');
  });

  it('falls back to https + host when forwarded headers are absent', () => {
    delete process.env.VERCEL_ENV;

    const origin = getCanonicalOrigin(
      createReq({
        host: 'localhost:3000',
      }),
    );

    expect(origin).toBe('https://localhost:3000');
  });
});

