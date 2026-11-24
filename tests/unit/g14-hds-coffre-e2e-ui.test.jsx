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
const { lockAll } = await import('../../src/lib/hdsKeys.js');

/** @type {{ url: string, method: string, body: string }[]} */ let calls = [];
/** @type {{ keyring: any, docs: any[], contents: Record<string, any>, replaces: any[] }} */ let store;

function hdsFetch() {
  return vi.fn(async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
    const method = init.method || 'GET'; const body = typeof init.body === 'string' ? init.body : '';
    calls.push({ url: String(url), method, body });
    const json = (/** @type {number} */ s, /** @type {any} */ b) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (String(url).startsWith('/api/citizen/hds-ticket')) return json(200, { ticket: 'synthetic.ticket.value', origin: 'https://hds.example.test', expiresAt: new Date().toISOString() });
    if (url === 'https://hds.example.test/v1/vault/documents' && method === 'GET') return json(200, { keyring: store.keyring, healthConsent: null, documents: store.docs, quota: { files: store.docs.length, maxFiles: 20, bytes: 0, maxBytes: 52428800 } });
    if (url === 'https://hds.example.test/v1/vault/keyring' && method === 'PUT') { const b = JSON.parse(body); if (store.keyring && !b.replace) return json(409, { error: 'KEYRING_EXISTS' }); store.replaces.push(b); store.keyring = b.keyring; return json(store.replaces.length > 1 ? 200 : 201, { keyring: store.keyring }); }
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

beforeEach(() => { calls = []; store = { keyring: null, docs: [], contents: {}, replaces: [] }; resetHdsMode(); lockAll(); });
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
    // G14-R4: the one-time recovery code comes first; « Continuer » only once the person says they kept it
    await screen.findByTestId('coffre-recovery-code', {}, { timeout: 10000 });
    const code = screen.getByTestId('coffre-recovery-value').textContent;
    expect(code).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){4}$/);
    expect(screen.getByTestId('coffre-recovery-done')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByTestId('coffre-recovery-kept'));
    fireEvent.click(screen.getByTestId('coffre-recovery-done'));
    await screen.findByTestId('coffre-upload', {}, { timeout: 10000 });
    expect(store.keyring).toMatchObject({ v: 1, kdf: 'PBKDF2-SHA256', iterations: 600000, recovery: { iterations: 600000 }, authHash: expect.any(String) });
    expect(calls.map((c) => c.body).join('\n')).not.toContain(code.replace(/-/g, ''));   // the code never leaves the page

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

  it('G14-R4: forgotten passphrase → the recovery code opens the vault, a new passphrase and a NEW code are set; then a passphrase change keeps the code', async () => {
    vi.stubGlobal('fetch', hdsFetch());
    const vc = await import('../../src/lib/vaultCrypto.js');
    const made = await vc.createKeyring('ancienne phrase oubliée', 600000);
    store.keyring = made.keyring; store.replaces.push({ keyring: made.keyring });
    render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(CompteCoffre))));
    await screen.findByTestId('coffre-unlock');
    fireEvent.click(screen.getByTestId('coffre-forgot'));
    await screen.findByTestId('coffre-recover-form');
    fireEvent.change(screen.getByTestId('coffre-recover-code'), { target: { value: 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE' } });
    fireEvent.change(screen.getByTestId('coffre-recover-pass'), { target: { value: 'nouvelle phrase secrète' } });
    fireEvent.change(screen.getByTestId('coffre-recover-pass2'), { target: { value: 'nouvelle phrase secrète' } });
    fireEvent.click(screen.getByTestId('coffre-recover-submit'));
    await screen.findByText(/Code de secours incorrect/, {}, { timeout: 15000 });
    fireEvent.change(screen.getByTestId('coffre-recover-code'), { target: { value: made.recoveryCode.toLowerCase() } });
    fireEvent.click(screen.getByTestId('coffre-recover-submit'));
    await screen.findByTestId('coffre-recovery-code', {}, { timeout: 15000 });
    const sent = store.replaces.at(-1);
    expect(sent).toMatchObject({ replace: true, reason: 'recovery', authToken: made.authToken });
    expect(sent.keyring.authHash).toBe(made.keyring.authHash);
    expect(await vc.unlockKeyring(store.keyring, 'nouvelle phrase secrète')).not.toBeNull();
    expect(await vc.recoverWithCode(store.keyring, made.recoveryCode, 'x'.repeat(12), 600000)).toBeNull();   // the used code is spent
    const fresh = screen.getByTestId('coffre-recovery-value').textContent;
    expect(fresh).not.toBe(made.recoveryCode);
    fireEvent.click(screen.getByTestId('coffre-recovery-kept'));
    fireEvent.click(screen.getByTestId('coffre-recovery-done'));
    await screen.findByTestId('coffre-security', {}, { timeout: 10000 });
    fireEvent.change(screen.getByTestId('coffre-change-current'), { target: { value: 'nouvelle phrase secrète' } });
    fireEvent.change(screen.getByTestId('coffre-change-new'), { target: { value: 'troisième phrase secrète' } });
    fireEvent.change(screen.getByTestId('coffre-change-new2'), { target: { value: 'troisième phrase secrète' } });
    fireEvent.click(screen.getByTestId('coffre-change-submit'));
    await waitFor(() => expect(store.replaces.at(-1).reason).toBe('passphrase_change'), { timeout: 15000 });
    expect(await vc.unlockKeyring(store.keyring, 'troisième phrase secrète')).not.toBeNull();
    expect(await vc.recoverWithCode(store.keyring, fresh, 'y'.repeat(12), 600000)).not.toBeNull();   // the code survives a passphrase change
    const all = calls.map((c) => c.body).join('\n');
    for (const secret of ['nouvelle phrase', 'troisième phrase', fresh.replace(/-/g, ''), made.recoveryCode.replace(/-/g, '')]) expect(all).not.toContain(secret);
  }, 90000);
});
