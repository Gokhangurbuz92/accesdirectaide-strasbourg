// @vitest-environment jsdom
/**
 * G14-LITE — offline Mon Parcours and the service worker's routing rules.
 *  - The worker: only the exact /compte/parcours address may start from the kept static shell; every other page (account pages included) gets the static
 *    offline page; /api (auth included), admin, pro, documents, messages, uploads are never cached; a page may only ask it to keep same-origin static files.
 *  - The device copy (IndexedDB, here an in-memory backend): OFF by default; only what the screen shows is kept (never the note); tied to one account by a
 *    fingerprint; erased on « off », on logout (even when the server cannot be reached), on account switch and when the session is refused.
 *  - The screen: the switch is unticked by default; without network and with a kept copy Mon Parcours is READ-ONLY (no control that changes a step).
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const api = vi.hoisted(() => ({ listParcours: vi.fn(), parcoursHistory: vi.fn(), parcours: vi.fn(), removeParcours: vi.fn(), listShares: vi.fn(), parcoursStructures: vi.fn() }));
const auth = vi.hoisted(() => ({ authMe: vi.fn() }));
const csrf = vi.hoisted(() => ({ csrfFetch: vi.fn() }));
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api, CitizenApiError: class extends Error {} }));
vi.mock('../../src/api/rdv-messaging-client.js', () => ({ rdvMessagingClient: auth }));
vi.mock('../../src/lib/csrf.ts', () => ({ csrfFetch: csrf.csrfFetch, CsrfBootstrapError: class extends Error {} }));
vi.mock('../../src/lib/csrf', () => ({ csrfFetch: csrf.csrfFetch, CsrfBootstrapError: class extends Error {} }));
vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get() { throw new Error('database touched'); } }) }));

import CompteParcours from '../../src/pages/CompteParcours.jsx';
import { logoutOnServer } from '../../src/lib/citizenSession.js';
import {
  __setOfflineParcoursBackend, clearOfflineParcours, enableOfflineParcours, isNetworkFailure, projectParcours, readOfflineParcours, reconcileOfflineOwner,
  refreshOfflineParcours,
} from '../../src/lib/offlineParcours.js';
import { stepCatalogueView } from '../../api/lib/parcours-step-types.js';

// ───────────── the in-memory stand-in for IndexedDB
function memoryBackend() {
  let value; const b = { destroyed: 0, get: async () => value, set: async (v) => { value = structuredClone(v); }, destroy: async () => { value = undefined; b.destroyed += 1; }, peek: () => value };
  return b;
}
let store;
beforeEach(() => {
  store = memoryBackend(); __setOfflineParcoursBackend(store);
  Object.values(api).forEach((f) => f.mockReset()); auth.authMe.mockReset(); csrf.csrfFetch.mockReset();
  api.parcoursHistory.mockResolvedValue({ events: [] }); api.listShares.mockResolvedValue({ shares: [] });
});
afterEach(() => { cleanup(); __setOfflineParcoursBackend(undefined); });

const stepTypes = stepCatalogueView();
const item = { id: 'p1', origin: 'MANUAL', stepKind: 'custom', stepType: 'RSA_DEMANDE', title: 'Demander le RSA', status: 'IN_PROGRESS', closure: null, dueDate: '2026-12-15', note: 'NOTE PRIVÉE',
  itemCodes: ['steptype:RSA_DEMANDE', 'structure:s1'], records: [{ code: 'structure:s1', type: 'structure', available: true, title: 'Caf du Bas-Rhin', href: '/structures/caf-67' }], available: true,
  history: [{ at: 'x' }], createdAt: '2026-11-01T00:00:00Z' };
const answer = { contract: 'limited', stepTypes, items: [item], planSteps: true, planImport: false, emailReminders: false, sensitiveSteps: 'excluded', notes: true };

// ───────────── service worker, loaded like the other PWA contract tests
function sw({ network = 'ok', shell = null } = {}) {
  const listeners = new Map(); const caches = new Map(); const fetched = [];
  const cacheOf = (name) => { if (!caches.has(name)) caches.set(name, new Map()); const m = caches.get(name);
    return { match: async (k) => m.get(typeof k === 'string' ? k : k.url), put: async (k, v) => { m.set(typeof k === 'string' ? k : k.url, v); }, addAll: async () => undefined, keys: async () => [], delete: async () => true }; };
  if (shell) { const m = new Map(Object.entries(shell)); caches.set('ada-offline-parcours-shell-v1', m); }
  caches.set('ada-static-shell-v1', new Map([['/offline.html', 'OFFLINE_PAGE']]));
  const ok = (body) => ({ ok: true, type: 'basic', body, headers: { get: () => '' }, clone() { return this; } });
  const ctx = { URL, Promise, console,
    self: { location: { origin: 'https://ada.local' }, addEventListener: (t, fn) => listeners.set(t, fn), skipWaiting: vi.fn() },
    caches: { open: async (n) => cacheOf(n), has: async (n) => caches.has(n), keys: async () => [...caches.keys()], delete: async (n) => caches.delete(n) },
    fetch: vi.fn(async (r) => { const u = typeof r === 'string' ? r : r.url; fetched.push(u); if (network === 'down') throw new TypeError('offline'); return ok(`NET:${u}`); }) };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync('public/sw.js', 'utf8'), ctx);
  const fire = async (type, data) => { let p; listeners.get(type)({ ...data, respondWith: (x) => { p = x; }, waitUntil: (x) => { p = x; } }); return p; };
  return { ctx, fire, caches, fetched };
}
const req = (path, extra = {}) => ({ method: 'GET', url: `https://ada.local${path}`, mode: 'cors', headers: { get: () => null }, ...extra });
const nav = (path) => req(path, { mode: 'navigate' });

describe('G14-LITE — service worker routing rules', () => {
  it('offline, /compte/parcours starts from the kept shell only when the person kept it; otherwise the static offline page', async () => {
    const kept = sw({ network: 'down', shell: { '/__ada/offline-parcours-shell': 'SHELL' } });
    expect(await kept.fire('fetch', { request: nav('/compte/parcours') })).toBe('SHELL');
    const none = sw({ network: 'down' });
    expect(await none.fire('fetch', { request: nav('/compte/parcours') })).toBe('OFFLINE_PAGE');
    expect(none.caches.has('ada-offline-parcours-shell-v1')).toBe(false);   // looking never creates the cache
  });

  it('offline, the browser-only /passeport-social starts from the same kept shell (g14-r2), otherwise the static offline page; nothing is stored for it', async () => {
    const kept = sw({ network: 'down', shell: { '/__ada/offline-parcours-shell': 'SHELL' } });
    expect(await kept.fire('fetch', { request: nav('/passeport-social') })).toBe('SHELL');
    const none = sw({ network: 'down' });
    expect(await none.fire('fetch', { request: nav('/passeport-social') })).toBe('OFFLINE_PAGE');
    expect(none.caches.has('ada-offline-parcours-shell-v1')).toBe(false);
  });

  it.each(['/compte', '/compte/messages', '/compte/coffre', '/compte/parcours/autre', '/pro/dossiers', '/admin', '/auth/login', '/aides'])(
    'offline, %s never gets the kept shell (static offline page)', async (p) => {
      const w = sw({ network: 'down', shell: { '/__ada/offline-parcours-shell': 'SHELL' } });
      expect(await w.fire('fetch', { request: nav(p) })).toBe('OFFLINE_PAGE');
    });

  it('online, /compte/parcours goes to the network and is not cached', async () => {
    const w = sw(); const r = await w.fire('fetch', { request: nav('/compte/parcours') });
    expect(r.body).toBe('NET:https://ada.local/compte/parcours');
    expect([...w.caches.get('ada-static-shell-v1').keys()]).toEqual(['/offline.html']);
  });

  it.each(['/api/auth/me', '/api/auth/login', '/api/citizen/parcours', '/api/citizen/dossier', '/api/messages', '/api/admin/x', '/api/pro/x', '/compte/messages', '/compte/parcours',
    '/documents/a.pdf', '/uploads/a.pdf', '/admin/x', '/pro/x', '/auth/x'])('%s is never cached nor accepted as a shell file', (p) => {
    const w = sw();
    expect(w.ctx.shouldBypass(req(p))).toBe(true);
    expect(w.ctx.isStaticAssetRequest(req(p))).toBe(false);
    expect(w.ctx.isShellAssetUrl(`https://ada.local${p}`)).toBe(false);
  });

  it('accepts as shell files only same-origin static files without a query', () => {
    const w = sw();
    expect(w.ctx.isShellAssetUrl('https://ada.local/assets/index-abc.js')).toBe(true);
    expect(w.ctx.isShellAssetUrl('/fonts/Inter-Regular.woff2')).toBe(true);
    expect(w.ctx.isShellAssetUrl('https://ada.local/assets/index-abc.js?x=1')).toBe(false);
    expect(w.ctx.isShellAssetUrl('https://cdn.example/assets/a.js')).toBe(false);
    expect(w.ctx.isShellAssetUrl('https://ada.local/index.html')).toBe(false);
  });

  it('KEEP stores /index.html under the private key and only the allowed files; DROP deletes the whole shell cache', async () => {
    const w = sw();
    await w.fire('message', { origin: 'https://ada.local', data: { type: 'ADA_OFFLINE_PARCOURS_KEEP', assets: ['https://ada.local/assets/a.js', '/fonts/b.woff2', '/api/citizen/parcours', 'https://evil.example/x.js', '/compte/parcours'] } });
    expect(w.fetched).toEqual(['/index.html', 'https://ada.local/assets/a.js', 'https://ada.local/fonts/b.woff2']);
    expect([...w.caches.get('ada-offline-parcours-shell-v1').keys()].sort()).toEqual(['/__ada/offline-parcours-shell', 'https://ada.local/assets/a.js', 'https://ada.local/fonts/b.woff2']);
    await w.fire('message', { origin: 'https://ada.local', data: { type: 'ADA_OFFLINE_PARCOURS_DROP' } });
    expect(w.caches.has('ada-offline-parcours-shell-v1')).toBe(false);
  });

  it('a message from another origin is ignored', async () => {
    const w = sw();
    await w.fire('message', { origin: 'https://evil.example', data: { type: 'ADA_OFFLINE_PARCOURS_KEEP', assets: ['/assets/a.js'] } });
    expect(w.fetched).toEqual([]);
  });

  it('offline, a static file of the kept shell is served from it', async () => {
    const w = sw({ network: 'down', shell: { 'https://ada.local/assets/a.js': 'KEPT_JS' } });
    expect(await w.fire('fetch', { request: req('/assets/a.js') })).toBe('KEPT_JS');
  });
});

describe('G14-LITE — the copy kept on the device', () => {
  it('is OFF by default: nothing is kept until the person switches it on', async () => {
    expect(await readOfflineParcours()).toBeNull();
    expect(await refreshOfflineParcours('u1', answer)).toBe('off');
    expect(store.peek()).toBeUndefined();
  });

  it('keeps only what the screen shows — never the note, the history, the item codes — and a fingerprint, not the account id', async () => {
    await enableOfflineParcours('user-123', answer);
    const r = await readOfflineParcours();
    expect(r.enabled).toBe(true);
    expect(r.owner).toMatch(/^[0-9a-f]{64}$/);
    const json = JSON.stringify(r);
    expect(json).not.toContain('user-123'); expect(json).not.toContain('NOTE PRIVÉE'); expect(json).not.toContain('itemCodes'); expect(json).not.toContain('history');
    expect(r.data.items).toEqual([{ id: 'p1', stepType: 'RSA_DEMANDE', title: 'Demander le RSA', status: 'IN_PROGRESS', closure: null, dueDate: '2026-12-15',
      place: { title: 'Caf du Bas-Rhin', href: '/structures/caf-67', available: true } }]);
    expect(r.data.stepTypes.map((t) => t.code)).toEqual(['RSA_DEMANDE']);
    expect(r.data.stepTypes[0].sources.every((s) => s.url.startsWith('https://'))).toBe(true);
  });

  it('projection drops unsafe links (external or protocol-relative place links, non-https sources)', () => {
    const p = projectParcours({ items: [{ id: 'x', stepType: 'T', records: [{ type: 'structure', available: true, title: 'X', href: '//evil.example' }] }],
      stepTypes: { types: [{ code: 'T', label: 'T', sources: [{ title: 's', url: 'javascript:alert(1)' }, { title: 'ok', url: 'https://www.service-public.fr/x' }] }] } });
    expect(p.items[0].place.href).toBeNull();
    expect(p.stepTypes[0].sources).toEqual([{ title: 'ok', url: 'https://www.service-public.fr/x' }]);
  });

  it('is erased on « off »', async () => {
    await enableOfflineParcours('u1', answer); await clearOfflineParcours();
    expect(await readOfflineParcours()).toBeNull();
  });

  it('is erased on logout, first — even when the server cannot be reached', async () => {
    await enableOfflineParcours('u1', answer);
    csrf.csrfFetch.mockRejectedValue(new TypeError('offline'));
    await logoutOnServer();
    expect(await readOfflineParcours()).toBeNull();
    await enableOfflineParcours('u1', answer);
    csrf.csrfFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    expect(await logoutOnServer()).toBe(true);
    expect(await readOfflineParcours()).toBeNull();
  });

  it('belongs to one account: another account, or none, erases it (account switch); the same account keeps it', async () => {
    await enableOfflineParcours('u1', answer);
    expect(await reconcileOfflineOwner('u1')).toBe(false); expect(await readOfflineParcours()).not.toBeNull();
    expect(await reconcileOfflineOwner('u2')).toBe(true); expect(await readOfflineParcours()).toBeNull();
    await enableOfflineParcours('u1', answer);
    expect(await reconcileOfflineOwner(null)).toBe(true); expect(await readOfflineParcours()).toBeNull();
    await enableOfflineParcours('u1', answer);
    expect(await refreshOfflineParcours('u2', answer)).toBe('cleared'); expect(await readOfflineParcours()).toBeNull();
  });

  it('only a network failure counts as « offline » (a refusal or a server error does not)', () => {
    expect(isNetworkFailure({ code: 'network', status: 0 })).toBe(true);
    expect(isNetworkFailure({ code: 'csrf_bootstrap', status: 0 })).toBe(false);
    expect(isNetworkFailure({ status: 401 })).toBe(false);
    expect(isNetworkFailure({ status: 503 })).toBe(false);
  });
});

const wrap = (el) => render(h(QueryClientProvider, { client: new QueryClient() }, h(HelmetProvider, null, h(MemoryRouter, null, el))));
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const netErr = () => Object.assign(new Error('Connexion impossible.'), { status: 0, code: 'network' });

describe('G14-LITE — Mon Parcours screen', () => {
  it('shows the switch UNTICKED by default, explained; ticking keeps the copy for this account, unticking erases it', async () => {
    auth.authMe.mockResolvedValue({ session: { kind: 'user' }, user: { id: 'u1' } });
    api.listParcours.mockResolvedValue(answer);
    wrap(h(CompteParcours)); await tick(); await tick();
    const box = screen.getByTestId('parcours-offline-toggle');
    expect(box).not.toBeChecked();
    expect(screen.getByLabelText('Garder Mon Parcours sur cet appareil')).toBe(box);
    expect(screen.getByTestId('parcours-offline-switch')).toHaveTextContent(/appareil que d’autres personnes utilisent/);
    expect(screen.getByTestId('parcours-offline-state')).toHaveTextContent('n’est pas gardé');
    expect(store.peek()).toBeUndefined();
    await act(async () => { fireEvent.click(box); }); await tick();
    expect(screen.getByTestId('parcours-offline-toggle')).toBeChecked();
    expect((await readOfflineParcours()).data.items).toHaveLength(1);
    await act(async () => { fireEvent.click(screen.getByTestId('parcours-offline-toggle')); }); await tick();
    expect(await readOfflineParcours()).toBeNull();
    expect(screen.getByTestId('parcours-offline-toggle')).not.toBeChecked();
  });

  it('no switch without a recognised citizen account', async () => {
    auth.authMe.mockResolvedValue({ authenticated: false, session: null });
    api.listParcours.mockResolvedValue(answer);
    wrap(h(CompteParcours)); await tick();
    expect(screen.queryByTestId('parcours-offline-toggle')).toBeNull();
  });

  it('without network and with a kept copy: READ-ONLY copy with the offline notice — no control that changes a step', async () => {
    await enableOfflineParcours('u1', answer);
    auth.authMe.mockRejectedValue(netErr());
    api.listParcours.mockRejectedValue(netErr());
    wrap(h(CompteParcours)); await tick();
    expect(screen.getByTestId('parcours-offline-banner')).toHaveTextContent('Vous n’êtes pas connecté à Internet.');
    expect(screen.getByTestId('parcours-offline-banner')).toHaveTextContent('Pour changer une étape, reconnectez-vous à Internet.');
    expect(screen.getAllByTestId('parcours-offline-item')).toHaveLength(1);
    expect(screen.getByText('Caf du Bas-Rhin')).toBeInTheDocument();
    expect(screen.queryByTestId('parcours-add')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('Mettre à jour')).toBeNull();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Réessayer']);
    expect(api.parcours).not.toHaveBeenCalled();
  });

  it('without network and WITHOUT a kept copy: the former error (nothing shown from the device)', async () => {
    auth.authMe.mockRejectedValue(netErr());
    api.listParcours.mockRejectedValue(netErr());
    wrap(h(CompteParcours)); await tick();
    expect(screen.getByTestId('parcours-error')).toBeInTheDocument();
    expect(screen.queryByTestId('parcours-offline')).toBeNull();
  });

  it('a refused session (401) erases the kept copy', async () => {
    await enableOfflineParcours('u1', answer);
    api.listParcours.mockRejectedValue(Object.assign(new Error('401'), { status: 401 }));
    auth.authMe.mockResolvedValue({ authenticated: false, session: null });
    wrap(h(CompteParcours)); await tick();
    expect(await readOfflineParcours()).toBeNull();
  });
});
