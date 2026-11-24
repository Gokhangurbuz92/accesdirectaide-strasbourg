// @vitest-environment jsdom
/**
 * G14-R4b — health documents in Mon Coffre (owner approval 24/11/2026: explicit consent, art. 9.2.a, by a box never ticked in advance). The consent text is
 * versioned (coffre-sante@v1-2026-11-24, PROPOSED until the owner approves this wording), in six languages; the page shows the box only when the HDS service
 * announces HDS_HEALTH_CATEGORY_ENABLED with exactly that version; « Santé » is offered only after the consent; withdrawal is one click and keeps the
 * documents until the person deletes them. fetch is a synthetic double of the HDS service.
 */
import '@testing-library/jest-dom/vitest';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEALTH_CONSENT_TEXT_PROPOSED as FR, HEALTH_CONSENT_VERSION_PROPOSED as V } from '../../src/config/legal-drafts.js';
const { claimsEntitlement } = await import('../../api/lib/entitlementWording.js');

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const { default: CompteCoffre } = await import('../../src/pages/CompteCoffre.jsx');
const { resetHdsMode } = await import('../../src/lib/hdsClient.js');
const { lockAll, setVaultKey } = await import('../../src/lib/hdsKeys.js');
const { encryptDocument } = await import('../../src/lib/vaultCrypto.js');

/** @type {{ url: string, method: string, body: string }[]} */ let calls = [];
/** @type {{ category: any, consent: string | null, docs: any[] }} */ let hds;
const KEYRING = { v: 1, kdf: 'PBKDF2-SHA256', iterations: 600000, recovery: { iterations: 600000 }, authHash: 'x' };

function hdsFetch() {
  return vi.fn(async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
    const method = init.method || 'GET'; const body = typeof init.body === 'string' ? init.body : '';
    calls.push({ url: String(url), method, body });
    const json = (/** @type {number} */ s, /** @type {any} */ b) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (String(url).startsWith('/api/citizen/hds-ticket')) return json(200, { ticket: 'synthetic.ticket.value', origin: 'https://hds.example.test', expiresAt: new Date().toISOString() });
    if (url === 'https://hds.example.test/v1/vault/documents' && method === 'GET') return json(200, { keyring: KEYRING, healthConsent: hds.consent, healthCategory: hds.category, documents: hds.docs, quota: { files: hds.docs.length, maxFiles: 20, bytes: 0, maxBytes: 52428800 } });
    if (url === 'https://hds.example.test/v1/vault/health-consent' && method === 'POST') { const b = JSON.parse(body); if (b.explicit !== true || b.version !== hds.category?.version) return json(400, { error: 'HEALTH_CONSENT_INVALID' }); hds.consent = b.version; return json(201, { healthConsent: b.version }); }
    if (url === 'https://hds.example.test/v1/vault/health-consent' && method === 'DELETE') { hds.consent = null; return json(200, { healthConsent: null }); }
    if (url === 'https://hds.example.test/v1/vault/documents' && method === 'POST') { const b = JSON.parse(body); hds.docs.push({ id: `00000000-0000-4000-8000-00000000000${hds.docs.length + 1}`, meta: b.meta, dek: b.dek, byteLength: 10, expiresAt: null, createdAt: new Date().toISOString(), expired: false }); return json(201, { document: {} }); }
    return json(404, { error: 'not_found' });
  });
}
const show = () => render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(CompteCoffre))));
const options = () => [...screen.getByTestId('coffre-category').querySelectorAll('option')].map((o) => o.value);
let vaultKey;

beforeEach(async () => {
  calls = []; hds = { category: { enabled: false, version: null }, consent: null, docs: [] }; resetHdsMode(); lockAll();
  vaultKey = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  setVaultKey(vaultKey);
  vi.stubGlobal('fetch', hdsFetch());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); lockAll(); });

describe('Mon Coffre — health documents behind an explicit, versioned, withdrawable consent', () => {
  it('the HDS service does not accept health documents: no box, no « Santé », a plain notice (not « no certified host »)', async () => {
    show();
    await screen.findByTestId('coffre-upload');
    expect(screen.queryByTestId('coffre-health-consent')).toBeNull();
    expect(options()).not.toContain('sante');
    expect(screen.getByTestId('coffre-health-notice')).toHaveTextContent(/ne sont pas encore acceptés dans Mon Coffre/);
    expect(screen.getByTestId('coffre-health-notice')).not.toHaveTextContent(/pas encore en place/);
  });
  it('enabled with ANOTHER version than the text this build shows: fail closed (no box, no « Santé »)', async () => {
    hds.category = { enabled: true, version: 'coffre-sante@v0-2026-01-01' };
    show();
    await screen.findByTestId('coffre-upload');
    expect(screen.queryByTestId('coffre-health-consent')).toBeNull();
    expect(options()).not.toContain('sante');
  });
  it('enabled with the proposed version: the text, a separate box never ticked; « Santé » only after consent; withdrawal keeps the documents', async () => {
    hds.category = { enabled: true, version: V };
    show();
    const card = await screen.findByTestId('coffre-health-consent');
    for (const s of [FR.title, FR.intro, ...FR.points, FR.checkbox]) expect(card).toHaveTextContent(s);
    expect(card).toHaveTextContent(V);
    const box = within(card).getByTestId('coffre-health-checkbox');
    expect(box).not.toBeChecked();
    expect(options()).not.toContain('sante');
    fireEvent.click(within(card).getByTestId('coffre-health-give'));   // not ticked: nothing sent
    expect(await within(card).findByRole('alert')).toHaveTextContent(/Cochez la case/);
    expect(calls.some((c) => c.url.endsWith('/v1/vault/health-consent'))).toBe(false);
    fireEvent.click(box);
    fireEvent.click(within(card).getByTestId('coffre-health-give'));
    await screen.findByTestId('coffre-health-given');
    const post = calls.find((c) => c.url.endsWith('/v1/vault/health-consent') && c.method === 'POST');
    expect(JSON.parse(post.body)).toEqual({ explicit: true, version: V });
    await waitFor(() => expect(options()).toContain('sante'));

    // a health document, then withdrawal: the category disappears, the document stays, the person is told
    hds.docs.push({ id: '00000000-0000-4000-8000-000000000009', ...(await encryptDocument(vaultKey, { bytes: new TextEncoder().encode('%PDF-1.4'), name: 'certificat.pdf', category: 'sante', type: 'application/pdf' })), byteLength: 10, expiresAt: null, createdAt: new Date().toISOString(), expired: false });
    fireEvent.click(screen.getByTestId('coffre-health-withdraw'));
    await screen.findByTestId('coffre-health-withdrawn');
    expect(calls.some((c) => c.url.endsWith('/v1/vault/health-consent') && c.method === 'DELETE')).toBe(true);
    expect(options()).not.toContain('sante');
    expect(screen.getByTestId('coffre-list')).toHaveTextContent('certificat.pdf');
    expect(screen.getByTestId('coffre-health-checkbox')).not.toBeChecked();
  }, 20000);
  it('the version format is the one the HDS service accepts; six languages carry every sentence; no entitlement wording', () => {
    expect(V).toBe('coffre-sante@v1-2026-11-24');
    expect(V).toMatch(/^[a-z0-9-]+@v[0-9][A-Za-z0-9.-]{0,40}$/);   // services/hds/src/config.js
    const KEYS = ['title', 'intro', 'point1', 'point2', 'point3', 'point4', 'point5', 'checkbox', 'tick_required', 'given', 'withdraw', 'withdrawn_keep', 'version', 'give', 'given_saved', 'withdrawn_saved', 'consent_needed', 'not_yet'];
    for (const l of ['en', 'de', 'tr', 'ar', 'uk']) {
      const d = JSON.parse(readFileSync(`src/i18n/locales/${l}/compte.json`, 'utf8'));
      for (const k of KEYS) expect(d[`coffre_sante.${k}`], `${l} ${k}`).toBeTruthy();
      expect(d['coffre_sante.version'], l).toContain('{{v}}');
      expect(d['coffre_sante.point2'], l).toMatch(/Scalingo/);
      expect(d['coffre_sante.point2'], l).toMatch(/HDS/);
    }
    for (const s of [FR.title, FR.intro, ...FR.points, FR.checkbox]) expect(claimsEntitlement(s)).toBe(false);
  });
});
