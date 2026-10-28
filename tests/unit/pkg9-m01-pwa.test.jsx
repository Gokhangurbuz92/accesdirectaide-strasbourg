// @vitest-environment jsdom
/**
 * PKG-9 / M01 — PWA installability (PNG 192 / 512 + maskable, no orientation lock), offline page (static, emergency numbers equal to the app's fallback list,
 * no script, nothing personal), offline navigation for every same-origin page without caching it, and an update flow the person controls. No JSX in the test body.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import fs from 'node:fs';
import vm from 'node:vm';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UpdatePrompt from '../../src/components/pwa/UpdatePrompt.jsx';
import { EMERGENCY_FALLBACK } from '../../src/lib/emergencyNumbers.js';

afterEach(cleanup);
const pngSize = (f) => { const b = fs.readFileSync(f); expect(b.subarray(1, 4).toString()).toBe('PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

function sw({ network = 'ok' } = {}) {
  const listeners = new Map(); const put = vi.fn(); const matched = []; const addAll = vi.fn(async () => undefined);
  const ctx = { URL, Promise, console,
    self: { location: { origin: 'https://ada.local' }, addEventListener: (t, h) => listeners.set(t, h), skipWaiting: vi.fn() },
    caches: { open: async () => ({ match: async (k) => { matched.push(k); return k === '/offline.html' ? 'OFFLINE_PAGE' : undefined; }, put, addAll }), keys: async () => [], delete: async () => true },
    fetch: vi.fn(async () => { if (network === 'down') throw new TypeError('offline'); return { ok: true, type: 'basic', headers: { get: () => '' }, clone() { return this; } }; }) };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync('public/sw.js', 'utf8'), ctx);
  const fire = async (type, data) => { let p; listeners.get(type)({ ...data, respondWith: (x) => { p = x; }, waitUntil: (x) => { p = x; } }); return p; };
  return { ctx, fire, put, matched, addAll };
}
const nav = (path) => ({ method: 'GET', url: `https://ada.local${path}`, mode: 'navigate', headers: { get: () => null } });

describe('PKG-9 / M01 installability and offline page', () => {
  it('the manifest declares PNG 192 and 512 (any) and a maskable 512 that exist with those sizes, and does not lock the orientation', () => {
    const m = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
    expect(m).toMatchObject({ start_url: '/', scope: '/', display: 'standalone', lang: 'fr' }); expect(m.orientation).toBeUndefined();
    const png = m.icons.filter((i) => i.type === 'image/png');
    expect(png.map((i) => [i.sizes, i.purpose])).toEqual([['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]);
    for (const i of png) expect(pngSize(`public${i.src}`)).toEqual(i.sizes.split('x').map(Number));
  });
  it('the offline page is static French, shows exactly the app\'s emergency numbers as tel: links, loads nothing and says nothing personal is kept', () => {
    const html = fs.readFileSync('public/offline.html', 'utf8');
    expect(html).toMatch(/<html lang="fr">/); expect(html).not.toMatch(/<script|src=|@import|https?:\/\//i);
    const nums = [...html.matchAll(/href="tel:(\d+)"><span>([^<]+)<\/span><strong>(\d+)<\/strong>/g)].map((x) => ({ phone: x[1], title: x[2], shown: x[3] }));
    expect(nums.map(({ phone, title }) => ({ phone, title }))).toEqual(EMERGENCY_FALLBACK.map(({ phone, title }) => ({ phone, title })));
    expect(nums.every((n) => n.phone === n.shown)).toBe(true);
    expect(html).toMatch(/Vos informations ne sont pas gardées sur cet appareil/);
  });
});

describe('PKG-9 / M01 service worker', () => {
  it('R12: activation drops the static files a previous version cached and keeps the precached shell', async () => {
    const w = sw(); const deleted = [];
    const entries = ['https://ada.local/assets/index-OLD.js', 'https://ada.local/index.html', 'https://ada.local/offline.html', 'https://ada.local/assets/old.css'].map((url) => ({ url }));
    w.ctx.caches.open = async () => ({ keys: async () => entries, delete: async (r) => { deleted.push(r.url); return true; } });
    await w.fire('activate', {});
    expect(deleted.sort()).toEqual(['https://ada.local/assets/index-OLD.js', 'https://ada.local/assets/old.css']);
  });
  it('install precaches the offline page and the icon', async () => {
    const w = sw(); await w.fire('install', {});
    expect(w.addAll.mock.calls[0][0]).toEqual(expect.arrayContaining(['/offline.html', '/icons/icon-192.png', '/index.html']));
  });
  it.each(['/aides', '/compte/messages', '/pro/dossiers', '/admin'])('offline navigation to %s shows the offline page; nothing is cached', async (p) => {
    const w = sw({ network: 'down' });
    expect(await w.fire('fetch', { request: nav(p) })).toBe('OFFLINE_PAGE');
    expect(w.put).not.toHaveBeenCalled();
  });
  it('online navigation (including private pages) goes to the network and is not cached', async () => {
    const w = sw(); const r = await w.fire('fetch', { request: nav('/compte') });
    expect(r.ok).toBe(true); expect(w.ctx.fetch).toHaveBeenCalledTimes(1); expect(w.put).not.toHaveBeenCalled();
  });
  it('a waiting version takes over only on the SKIP_WAITING message', async () => {
    const w = sw(); await w.fire('message', { data: { type: 'other' } }); expect(w.ctx.self.skipWaiting).not.toHaveBeenCalled();
    await w.fire('message', { data: { type: 'SKIP_WAITING' } }); expect(w.ctx.self.skipWaiting).toHaveBeenCalledTimes(1);
  });
});

describe('PKG-9 / M01 update prompt', () => {
  it('hidden until a new version waits; « Plus tard » hides it; « Mettre à jour » asks the waiting worker to take over; axe clean', async () => {
    const { container } = render(createElement(UpdatePrompt));
    expect(screen.queryByTestId('pwa-update')).toBeNull();
    const worker = { postMessage: vi.fn() };
    act(() => { globalThis.dispatchEvent(new CustomEvent('ada:sw-update', { detail: worker })); });
    expect(screen.getByTestId('pwa-update')).toHaveTextContent('Une nouvelle version d\'AccesDirectAide est disponible');
    expect(screen.getByTestId('pwa-update')).toHaveAttribute('role', 'status');
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Plus tard' })); expect(screen.queryByTestId('pwa-update')).toBeNull(); expect(worker.postMessage).not.toHaveBeenCalled();
    act(() => { globalThis.dispatchEvent(new CustomEvent('ada:sw-update', { detail: worker })); });
    fireEvent.click(screen.getByTestId('pwa-update-apply'));
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });
  it('the registration announces a waiting worker only when a version is already in control (first install stays silent)', () => {
    const main = fs.readFileSync('src/main.jsx', 'utf8');
    expect(main).toMatch(/if \(worker && window\.navigator\.serviceWorker\.controller\) window\.dispatchEvent\(new CustomEvent\('ada:sw-update'/);
    expect(main).toContain('<UpdatePrompt />');
  });
});
