import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function loadVercelConfig() {
  const vercelPath = path.resolve(process.cwd(), 'vercel.json');
  const raw = fs.readFileSync(vercelPath, 'utf8');
  return JSON.parse(raw);
}

describe('P7-C redirects config contract', () => {
  it('contains canonical host redirect from apex to www (permanent)', () => {
    const config = loadVercelConfig();
    const redirects = Array.isArray(config.redirects) ? config.redirects : [];

    const hostRedirect = redirects.find((entry) => {
      const has = Array.isArray(entry?.has) ? entry.has : [];
      return (
        entry?.source === '/:path*' &&
        entry?.destination === 'https://www.accesdirectaide.fr/:path*' &&
        has.some((condition) => condition?.type === 'host' && condition?.value === 'accesdirectaide.fr')
      );
    });

    expect(hostRedirect).toBeTruthy();
    expect(hostRedirect.permanent).toBe(true);
  });

  it('contains trailing slash normalization redirect (permanent)', () => {
    const config = loadVercelConfig();
    const redirects = Array.isArray(config.redirects) ? config.redirects : [];

    const trailingSlashRedirect = redirects.find(
      (entry) => entry?.source === '/(.+)/' && entry?.destination === '/$1'
    );

    expect(trailingSlashRedirect).toBeTruthy();
    expect(trailingSlashRedirect.permanent).toBe(true);
  });

  it('keeps canonical host rule before trailing slash normalization', () => {
    const config = loadVercelConfig();
    const redirects = Array.isArray(config.redirects) ? config.redirects : [];

    const hostIndex = redirects.findIndex((entry) => {
      const has = Array.isArray(entry?.has) ? entry.has : [];
      return (
        entry?.source === '/:path*' &&
        has.some((condition) => condition?.type === 'host' && condition?.value === 'accesdirectaide.fr')
      );
    });

    const trailingIndex = redirects.findIndex(
      (entry) => entry?.source === '/(.+)/' && entry?.destination === '/$1'
    );

    expect(hostIndex).toBeGreaterThanOrEqual(0);
    expect(trailingIndex).toBeGreaterThanOrEqual(0);
    expect(hostIndex).toBeLessThan(trailingIndex);
  });
});

