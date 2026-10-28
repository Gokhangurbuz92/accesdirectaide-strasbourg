import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE_URL = process.env.WS5_BASE_URL || 'http://127.0.0.1:4175';
const CORE_ROUTES = ['/', '/accessibilite', '/contact'];

function isLoopback(urlString) {
  const url = new URL(urlString);
  return (
    url.protocol === 'data:' ||
    url.protocol === 'blob:' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === 'localhost'
  );
}

for (const routePath of CORE_ROUTES) {
  test(`WS5 axe-core core page ${routePath}`, async ({ page }) => {
    const remoteRequests = [];

    page.on('request', (request) => {
      if (!isLoopback(request.url())) {
        remoteRequests.push(request.url());
      }
    });

    await page.route('**/*', async (route) => {
      if (isLoopback(route.request().url())) {
        await route.continue();
      } else {
        await route.abort();
      }
    });

    await page.goto(`${BASE_URL}${routePath}`, { waitUntil: 'networkidle' });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(
      results.violations,
      JSON.stringify(results.violations, null, 2)
    ).toEqual([]);
    expect(remoteRequests).toEqual([]);
  });
}

test('WS5 service worker never stores dynamic personal routes', async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (isLoopback(route.request().url())) {
      await route.continue();
    } else {
      await route.abort();
    }
  });

  await page.goto(`${BASE_URL}/accessibilite`, { waitUntil: 'networkidle' });

  const proof = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) {
      return { supported: false };
    }

    const registration = await navigator.serviceWorker.ready;

    await fetch('/api/ws5-sensitive-probe').catch(() => undefined);
    await fetch('/uploads/ws5-private-probe.pdf').catch(() => undefined);
    await fetch('/compte/ws5-private-probe').catch(() => undefined);

    const names = await caches.keys();
    const entries = [];

    for (const name of names) {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      for (const request of requests) {
        entries.push(new URL(request.url).pathname);
      }
    }

    return {
      supported: true,
      active: Boolean(registration.active),
      names,
      entries,
    };
  });

  expect(proof.supported).toBe(true);
  expect(proof.active).toBe(true);
  expect(proof.names).toContain('ada-static-shell-v1');

  for (const pathname of proof.entries) {
    expect(pathname.startsWith('/api/')).toBe(false);
    expect(pathname.startsWith('/uploads/')).toBe(false);
    expect(pathname.startsWith('/documents/')).toBe(false);
    expect(pathname.startsWith('/dossiers/')).toBe(false);
    expect(pathname.startsWith('/compte/')).toBe(false);
    expect(pathname.startsWith('/pro/')).toBe(false);
    expect(pathname.startsWith('/admin/')).toBe(false);
    expect(pathname.startsWith('/auth/')).toBe(false);
  }
});

test('WS5 accessibility page has no keyboard trap', async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (isLoopback(route.request().url())) {
      await route.continue();
    } else {
      await route.abort();
    }
  });

  await page.goto(`${BASE_URL}/accessibilite`, { waitUntil: 'networkidle' });

  const focusableCount = await page.locator(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  ).count();

  expect(focusableCount).toBeGreaterThan(0);

  await page.evaluate(() => document.body.focus());

  const seen = new Set();

  for (let i = 0; i < Math.min(focusableCount + 4, 40); i += 1) {
    await page.keyboard.press('Tab');
    const fingerprint = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return 'NONE';
      return `${el.tagName}:${el.id || ''}:${el.getAttribute('href') || ''}:${el.getAttribute('aria-label') || ''}`;
    });
    seen.add(fingerprint);
  }

  expect(seen.size).toBeGreaterThan(1);
});
