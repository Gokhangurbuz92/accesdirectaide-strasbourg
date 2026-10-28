// @vitest-environment jsdom
/**
 * DTA S8 — secure document journey (professional side), UI + response shape.
 * Before S8 the vault posted multipart FormData without the professional's Authorization header to a JSON-only handler (401 in a real browser), encrypted the bytes with a
 * key derived from the server-known shareId (so a download returned an unreadable blob), accepted webp which the server refuses, and nothing listed or downloaded documents.
 * Contract now: JSON + Bearer upload of the raw file (server encrypts at rest), the same limits as the server, a list built from GET /api/pro/dossier `documents`,
 * download by POST of the signed capability (never in a URL), honest error messages per HTTP status, and no end-to-end claim.
 */
/* global window, document, File */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FileVault from '../../src/components/FileVault.jsx';
import { ALLOWED_TYPES, MAX_SIZE } from '../../src/lib/fileVaultLimits.js';

const mount = (props = {}) => render(createElement(FileVault, { shareId: 'share-1', documents: [], onUploadSuccess: () => {}, ...props }));
const pick = (file) => fireEvent.change(screen.getByTestId('file-vault-input'), { target: { files: [file] } });
const pdf = (name = 'justificatif-synthetique.pdf', bytes = '%PDF-1.4 synthetic') => new File([bytes], name, { type: 'application/pdf' });

beforeEach(() => { window.localStorage.setItem('pro_token', 'SYNTHETIC-PRO-TOKEN'); document.cookie = '__csrf=csrf-synthetic'; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); window.localStorage.clear(); });

describe('FileVault upload', () => {
  it('the accepted types and size are exactly what the server takes (no webp, <= 3 MB so the base64 body fits a serverless request)', () => {
    expect(ALLOWED_TYPES).toEqual(['application/pdf', 'image/jpeg', 'image/png']);
    expect(MAX_SIZE).toBe(3 * 1024 * 1024);
    const handler = readFileSync('api/_handlers/pro/dossier/upload-secure.js', 'utf8');
    for (const t of ALLOWED_TYPES) expect(handler).toContain(`'${t}'`);
    expect(handler).not.toContain('image/webp');
  });
  it('sends JSON with the professional Bearer token and the raw file as base64, never multipart and never a client-side ciphertext', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    mount();
    pick(pdf());
    fireEvent.click(screen.getByTestId('file-vault-send'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/pro/dossier/upload-secure');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer SYNTHETIC-PRO-TOKEN');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(typeof init.body).toBe('string');
    const body = JSON.parse(init.body);
    expect(body.shareId).toBe('share-1');
    expect(body.originalName).toBe('justificatif-synthetique.pdf');
    expect(body.mimeType).toBe('application/pdf');
    expect(Buffer.from(body.fileBase64, 'base64').toString()).toBe('%PDF-1.4 synthetic');
    await waitFor(() => expect(screen.getByText('Document enregistré')).toBeInTheDocument());
  });
  it('refuses a format or size the server would refuse, before any request', () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    mount();
    pick(new File(['x'], 'photo.webp', { type: 'image/webp' }));
    expect(screen.getByTestId('file-vault-error')).toHaveTextContent('Format non accepté');
    pick(new File([new Uint8Array(MAX_SIZE + 1)], 'gros.pdf', { type: 'application/pdf' }));
    expect(screen.getByTestId('file-vault-error')).toHaveTextContent('max 3 Mo');
    pick(new File([], 'vide.pdf', { type: 'application/pdf' }));
    expect(screen.getByTestId('file-vault-error')).toHaveTextContent('vide ou trop volumineux');
    expect(screen.queryByTestId('file-vault-send')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    [401, 'session a expiré'], [403, 'pas l’autorisation'], [404, 'plus accessible à votre structure'], [410, 'a expiré'], [413, 'trop volumineux'], [415, 'Format non accepté'], [429, 'Trop de demandes'],
  ])('HTTP %i: an honest, specific message in an alert, and the file stays selected for a retry', async (status, text) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status, json: async () => ({ error: 'raw server text' }) })));
    mount();
    pick(pdf());
    fireEvent.click(screen.getByTestId('file-vault-send'));
    await waitFor(() => expect(screen.getByTestId('file-vault-error')).toHaveTextContent(text));
    expect(screen.getByTestId('file-vault-error')).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('file-vault-send')).toBeEnabled();
  });
  it('a network failure is reported, not swallowed', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
    mount();
    pick(pdf());
    fireEvent.click(screen.getByTestId('file-vault-send'));
    await waitFor(() => expect(screen.getByTestId('file-vault-error')).toBeInTheDocument());
  });
  it('makes no end-to-end claim and does not use the shareId-derived client encryption any more', () => {
    const src = readFileSync('src/components/FileVault.jsx', 'utf8');
    expect(src).not.toMatch(/crypto-files|encryptFile|FormData/);
    render(createElement(FileVault, { shareId: 's', documents: [] }));
    const text = document.body.textContent;
    expect(text).toMatch(/chiffré sur le serveur/);
    expect(text).toMatch(/Ce n’est pas un chiffrement de bout en bout/);
    expect(text).not.toMatch(/chiffré sur votre appareil|Seul votre accompagnateur/);
  });
});

describe('FileVault documents list and download', () => {
  const docs = [{ id: 'f1', name: 'attestation-synthetique.pdf', mimeType: 'application/pdf', byteLength: 2048, uploadedAt: '2026-10-18T10:00:00.000Z', downloadToken: 'SYNTHETIC-CAPABILITY' }];
  it('shows an empty state, then the list from the API', () => {
    const { rerender } = mount();
    expect(screen.getByTestId('file-vault-empty')).toBeInTheDocument();
    rerender(createElement(FileVault, { shareId: 'share-1', documents: docs }));
    expect(screen.getByTestId('file-vault-item-name')).toHaveTextContent('attestation-synthetique.pdf');
    expect(screen.getByRole('button', { name: 'Télécharger attestation-synthetique.pdf' })).toBeInTheDocument();
  });
  it('downloads by POSTing the capability in the body (never in the URL) and saves the answer as a file', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, blob: async () => new Blob(['%PDF']) }));
    vi.stubGlobal('fetch', fetchMock);
    const created = []; window.URL.createObjectURL = vi.fn(() => { created.push(1); return 'blob:synthetic'; }); window.URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mount({ documents: docs });
    fireEvent.click(screen.getByRole('button', { name: 'Télécharger attestation-synthetique.pdf' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/download');
    expect(url).not.toMatch(/SYNTHETIC-CAPABILITY|token/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ token: 'SYNTHETIC-CAPABILITY' });
    expect(init.headers['x-csrf-token']).toBe('csrf-synthetic');
    expect(created).toHaveLength(1);
  });
  it.each([[404, 'plus accessible'], [410, 'a expiré'], [500, 'Téléchargement impossible']])('download HTTP %i: honest message in an alert', async (status, text) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status })));
    mount({ documents: docs });
    fireEvent.click(screen.getByRole('button', { name: 'Télécharger attestation-synthetique.pdf' }));
    await waitFor(() => expect(screen.getByTestId('file-vault-download-error')).toHaveTextContent(text));
  });
});

describe('GET /api/pro/dossier: documents are a safe projection', () => {
  it('lists id, decrypted name, type, size, date and a capability; never the storage key, encrypted name or checksum; skips unencrypted/unknown entries', async () => {
    vi.resetModules();
    vi.doMock('../../src/db/index.js', () => ({ db: {} }));
    vi.doMock('../../api/_utils/logger.js', () => { const m = () => {}; return { default: { info: m, warn: m, error: m, debug: m } }; });
    vi.doMock('../../api/lib/data-keys.js', () => ({ openText: (value) => (value === 'enc-name' ? 'nom "clair".pdf' : null) }));
    vi.doMock('../../api/lib/crypto.js', () => ({ generateAttachmentToken: (binding, ttl) => `cap(${binding};${ttl})` }));
    vi.doMock('../../api/_utils/auth.js', () => ({ requireProAuth: (h) => h, requireProStructureContext: () => null, logProAudit: async () => {} }));
    vi.doMock('../../api/_utils/share-access.js', () => ({ resolveDossierForStructure: async () => ({}), activeGrantExists: () => null, projectResultsForStructure: (r) => r }));
    const { documentsOf } = await import('../../api/_handlers/pro/dossier.js');
    const out = documentsOf({ _files: [
      { id: 'f1', encrypted: true, storageKey: 'STORAGE-KEY', filenameEncrypted: 'enc-name', mimeType: 'application/pdf', byteLength: 12, uploadedAt: '2026-10-18T10:00:00.000Z', checksumSha256: 'a'.repeat(64), structureId: 'S1' },
      { id: 'f2', encrypted: false, storageKey: 'PLAIN' },
      { storageKey: 'NO-ID', encrypted: true },
      { id: 'f3', encrypted: true, filenameEncrypted: 'unreadable', mimeType: 'image/png', byteLength: 5 },
    ] }, 'share-9');
    expect(out.map((d) => d.id)).toEqual(['f1', 'f3']);
    expect(out[0]).toEqual({ id: 'f1', name: 'nom _clair_.pdf', mimeType: 'application/pdf', byteLength: 12, uploadedAt: '2026-10-18T10:00:00.000Z', downloadToken: 'cap(share-9:f1;3600)' });
    expect(out[1].name).toBe('document');
    expect(JSON.stringify(out)).not.toMatch(/STORAGE-KEY|enc-name|checksum|structureId|PLAIN|NO-ID/);
    expect(documentsOf({}, 'x')).toEqual([]);
    expect(documentsOf(null, 'x')).toEqual([]);
  });
  it('the handler removes the raw _files from results and answers no-store', () => {
    const src = readFileSync('api/_handlers/pro/dossier.js', 'utf8');
    expect(src).toMatch(/delete projected\._files/);
    expect(src).toMatch(/setHeader\('Cache-Control', 'no-store'\)/);
    expect(src).toMatch(/results: projected/);
  });
});
