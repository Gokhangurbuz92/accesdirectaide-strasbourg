// @vitest-environment jsdom
/**
 * G14-R3 — Mon Coffre through the HDS service, in the page: the main API only hands out tickets; the page protects the vault with a passphrase, encrypts
 * the file in the browser, sends ciphertext to the HDS origin, lists and opens it with the vault key. Nothing readable is sent anywhere, and no
 * document request goes to the main API. Without an HDS service (HDS_GATEWAY_NOT_CONFIGURED) the page keeps the LAB path. fetch is a synthetic double.
 */
import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CANARY = 'CANARY-UI-5e1d';
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const { default: CompteCoffre } = await import('../../src/pages/CompteCoffre.jsx');
const { resetHdsMode } = await import('../../src/lib/hdsClient.js');

/** @type {{ url: string, method: string, body: string }[]} */ let calls = [];
/** @type {{ keyring: any, docs: any[], contents: Record<string, any> }} */ let store;

function hdsFetch() {
  return vi.fn(async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
    const method = init.method || 'GET'; const body = typeof init.body === 'string' ? init.body : '';
    calls.push({ url: String(url), method, body });
    const json = (/** @type {number} */ s, /** @type {any} */ b) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (String(url).startsWith('/api/citizen/hds-ticket')) return json(200, { ticket: 'synthetic.ticket.value', origin: 'https://hds.example.test', expiresAt: new Date().toISOString() });
    if (url === 'https://hds.example.test/v1/vault/documents' && method === 'GET') return json(200, { keyring: store.keyring, healthConsent: null, documents: store.docs, quota: { files: store.docs.length, maxFiles: 20, bytes: 0, maxBytes: 52428800 } });
    if (url === 'https://hds.example.test/v1/vault/keyring' && method === 'PUT') { store.keyring = JSON.parse(body).keyring; return json(201, { keyring: store.keyring }); }
    if (url === 'https://hds.example.test/v1/vault/documents' && method === 'POST') {
      const b = JSON.parse(body); const id = '00000000-0000-4000-8000-000000000001';
      store.docs.push({ id, meta: b.meta, dek: b.dek, byteLength: 10, scanStatus: 'NOT_SCANNED', expiresAt: null, createdAt: new Date().toISOString(), expired: false });
      store.contents[id] = b.content;
      return json(201, { document: { id } });
    }
    if (/\/v1\/vault\/documents\/[^/]+\/content$/.test(String(url))) return json(200, { content: store.contents['00000000-0000-4000-8000-000000000001'] });
    return json(404, { error: 'not_found' });
  });
}

beforeEach(() => { calls = []; store = { keyring: null, docs: [], contents: {} }; resetHdsMode(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Mon Coffre, end-to-end encrypted through the HDS service', () => {
  it('protect with a passphrase → encrypt in the page → upload ciphertext → list decrypted; nothing readable leaves the page, no document call to the main API', async () => {
    vi.stubGlobal('fetch', hdsFetch());
    render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(CompteCoffre))));
    await screen.findByTestId('coffre-protect');
    expect(screen.getByTestId('coffre-e2e-intro')).toBeTruthy();
    fireEvent.change(screen.getByTestId('coffre-passphrase'), { target: { value: 'short' } });
    fireEvent.change(screen.getByTestId('coffre-passphrase-confirm'), { target: { value: 'short' } });
    fireEvent.click(screen.getByTestId('coffre-passphrase-submit'));
    await screen.findByTestId('coffre-problem');
    fireEvent.change(screen.getByTestId('coffre-passphrase'), { target: { value: 'une phrase secrète de test' } });
    fireEvent.change(screen.getByTestId('coffre-passphrase-confirm'), { target: { value: 'une phrase secrète de test' } });
    fireEvent.click(screen.getByTestId('coffre-passphrase-submit'));
    await screen.findByTestId('coffre-upload', {}, { timeout: 10000 });
    expect(store.keyring).toMatchObject({ v: 1, kdf: 'PBKDF2-SHA256', iterations: 600000 });

    const file = new File([new TextEncoder().encode(`%PDF-1.4 ${CANARY}`)], `${CANARY}.pdf`, { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('coffre-file'), { target: { files: [file] } });
    fireEvent.click(screen.getByTestId('coffre-upload'));
    await waitFor(() => expect(screen.getByTestId('coffre-list').textContent).toContain(`${CANARY}.pdf`), { timeout: 10000 });

    const sent = calls.filter((c) => c.method !== 'GET').map((c) => c.body).join('\n');
    expect(sent).not.toContain(CANARY);
    expect(sent).not.toMatch(/identite|application\/pdf|une phrase secrète/);
    expect(calls.some((c) => c.url.startsWith('/api/citizen/coffre'))).toBe(false);
    expect(calls.filter((c) => c.url.startsWith('/api/')).every((c) => c.url.startsWith('/api/citizen/hds-ticket') && c.method === 'GET' && !c.body)).toBe(true);
  }, 30000);

  it('without an HDS service the page keeps the LAB route (no passphrase step)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (/** @type {string} */ url) => {
      calls.push({ url: String(url), method: 'GET', body: '' });
      if (String(url).startsWith('/api/citizen/hds-ticket')) return new Response(JSON.stringify({ error: 'HDS_GATEWAY_NOT_CONFIGURED' }), { status: 503 });
      return new Response(JSON.stringify({ documents: [], quota: { files: 0, maxFiles: 20, bytes: 0, maxBytes: 52428800 } }), { status: 200 });
    }));
    render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(CompteCoffre))));
    await screen.findByTestId('compte-coffre');
    expect(screen.queryByTestId('coffre-protect')).toBeNull();
    expect(screen.getByTestId('coffre-upload')).toBeTruthy();
    expect(calls.map((c) => c.url)).toContain('/api/citizen/coffre');
  });
});
