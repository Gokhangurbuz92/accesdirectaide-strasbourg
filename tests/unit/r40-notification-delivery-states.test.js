/**
 * R40 — notification delivery states and the service worker's click (offline: the real public/sw.js in a VM, the real ledger mappers, no network):
 *  - a push notification click sends the open tab to the in-site link, then focuses it; a tab the worker does not control gets a new window at the link
 *    (before: navigate()'s rejection was unhandled and the old page was focused); a link outside the site is never opened;
 *  - the push ledger never says DELIVERED: an accepted message is PROVIDER_ACCEPTED, a refused one FAILED, nothing attempted / all ended NOT_DELIVERED;
 *  - the mail ledger never counts the noop mailer or the LAB test outbox as a provider acceptance.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { pushLedgerStatus, sendToUser } from '../../api/_services/web-push.js';
import { mailLedgerStatus } from '../../api/_utils/mailer.js';

function worker(clients) {
  const listeners = new Map();
  const openWindow = vi.fn(async (u) => ({ url: u }));
  const ctx = { URL, Promise, console, caches: {}, fetch: vi.fn(),
    self: { location: { origin: 'https://ada.local' }, addEventListener: (t, h) => listeners.set(t, h), skipWaiting: vi.fn(),
      clients: { matchAll: vi.fn(async () => clients), openWindow }, registration: { showNotification: vi.fn(async () => undefined) } } };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync('public/sw.js', 'utf8'), ctx);
  const click = async (url) => { let p; const close = vi.fn(); listeners.get('notificationclick')({ notification: { close, data: { url } }, waitUntil: (x) => { p = x; } }); await p; return { close }; };
  const fire = async (type, data) => { let p; listeners.get(type)({ ...data, waitUntil: (x) => { p = x; } }); await p; };
  return { click, fire, openWindow, ctx };
}
const tab = ({ controlled = true } = {}) => {
  const t = { url: 'https://ada.local/aides', focus: vi.fn(async () => t), navigate: vi.fn(async (u) => { if (!controlled) throw new TypeError('not controlled'); t.url = u; return t; }) };
  return t;
};

describe('R40 service worker notification click', () => {
  it('an open, controlled tab goes to the link first, then is focused; no new window', async () => {
    const t = tab(); const w = worker([t]);
    const { close } = await w.click('/compte/parcours');
    expect(close).toHaveBeenCalled();
    expect(t.navigate).toHaveBeenCalledWith('https://ada.local/compte/parcours');
    expect(t.focus).toHaveBeenCalled();
    expect(t.navigate.mock.invocationCallOrder[0]).toBeLessThan(t.focus.mock.invocationCallOrder[0]);
    expect(w.openWindow).not.toHaveBeenCalled();
  });
  it('a tab the worker does not control: a new window at the link (no unhandled rejection, not the old page)', async () => {
    const t = tab({ controlled: false }); const w = worker([t]);
    await w.click('/compte');
    expect(w.openWindow).toHaveBeenCalledWith('https://ada.local/compte');
    expect(t.focus).not.toHaveBeenCalled();
  });
  it('no tab open: a new window; a link outside the site is never opened', async () => {
    const w = worker([]);
    await w.click('/compte');
    expect(w.openWindow).toHaveBeenCalledWith('https://ada.local/compte');
    const w2 = worker([]);
    await w2.click('https://evil.example/');
    expect(w2.openWindow).not.toHaveBeenCalled();
  });
  it('the push event shows the generic notification with an in-site link only', async () => {
    const w = worker([]);
    await w.fire('push', { data: { json: () => ({ title: 'Rappel AccesDirectAide', body: 'b', url: '//evil.example/x' }) } });
    expect(w.ctx.self.registration.showNotification).toHaveBeenCalledWith('Rappel AccesDirectAide', expect.objectContaining({ body: 'b', data: { url: '/compte' } }));
  });
});

describe('R40 delivery-state ledgers', () => {
  it('push: accepted → PROVIDER_ACCEPTED, refused → FAILED, nothing attempted or every subscription ended → NOT_DELIVERED; never DELIVERED', () => {
    expect(pushLedgerStatus({ status: 'ACCEPTED' })).toBe('PROVIDER_ACCEPTED');
    expect(pushLedgerStatus({ status: 'FAILED' })).toBe('FAILED');
    for (const s of ['EXPIRED', 'NO_SUBSCRIPTION', 'NOT_CONFIGURED', undefined]) expect(pushLedgerStatus(s ? { status: s } : null)).toBe('NOT_DELIVERED');
  });
  it('push without keys attempts nothing', async () => {
    const fetchImpl = vi.fn();
    expect(await sendToUser('u', { title: 't', body: 'b', url: '/' }, { env: {}, fetchImpl })).toEqual({ status: 'NOT_CONFIGURED', accepted: 0, failed: 0, expired: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('mail: the noop mailer and a refused provider are NOT_DELIVERED, the LAB outbox TEST_RECORDED, only a real provider PROVIDER_ACCEPTED', () => {
    expect(mailLedgerStatus({ accepted: true, delivered: false, provider: 'noop', outcome: 'NOT_SENT' })).toBe('NOT_DELIVERED');
    expect(mailLedgerStatus({ accepted: true, delivered: true, provider: 'test', outcome: 'TEST_RECORDED' })).toBe('TEST_RECORDED');
    expect(mailLedgerStatus({ accepted: true, delivered: false, provider: 'resend', outcome: 'NOT_DELIVERED' })).toBe('NOT_DELIVERED');
    expect(mailLedgerStatus({ accepted: true, delivered: true, provider: 'resend', outcome: 'PROVIDER_ACCEPTED' })).toBe('PROVIDER_ACCEPTED');
    expect(mailLedgerStatus(null)).toBe('NOT_DELIVERED');
  });
});
