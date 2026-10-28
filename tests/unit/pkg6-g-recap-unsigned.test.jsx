// @vitest-environment jsdom
/**
 * PKG-6 / G — no surface may present a dossier document as signed or certified: the product has no electronic signature (it needs a qualified trust service
 * and an identity check). Before: ExpertTools simulated a 2.5 s « signature » ending in « PDF signé », and /pro/attestation/:shareId showed « Certifié »,
 * « Signataire autorisé », « Sceau numérique », a QR « integrity check » on a non-existent portal, a CRPA « document probant » notice — and DEMO data when
 * the request failed. No JSX in the test body.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OfficialAttestation from '../../src/pages/pro/OfficialAttestation.jsx';
import ExpertTools from '../../src/components/ExpertTools.jsx';

const FALSE_CLAIMS = /certifi|sign[ée]\b|signataire|sceau|probant|L\.114-8|E2EE|scannez|DEMO|souverain/i;
const item = { code: 'rsa', label: 'RSA', state: 'CHECK_REQUIRED', authoritative: false, amount: null, explanation: 'x', whoToAsk: 'CAF du Bas-Rhin',
  provenance: { display: { source: 's', verifiedAt: 'v', territory: 't', rule: 'r', uncertainty: 'u' } } };
const page = () => render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: ['/pro/attestation/abc12345xyz'] },
  createElement(Routes, null, createElement(Route, { path: '/pro/attestation/:shareId', element: createElement(OfficialAttestation) })))));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('PKG-6 / G: the dossier recap is honest about being unsigned', () => {
  it('a loaded recap says « non signé », lists the orientation items, shows the content fingerprint, and makes no signature / certification claim; axe clean', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, attestation: { kind: 'RECAP_NON_SIGNE', signed: false, reference: 'ADA-0123456789AB', date: '21/10/2026',
      expiresAt: '2026-11-20T00:00:00Z', usagerToken: 'ABC12345', results: { assessment: { items: [item] } }, professional: { name: 'agent', role: 'Agent' }, fingerprint: 'f'.repeat(64) } }) }));
    vi.stubGlobal('fetch', fetchMock);
    globalThis.localStorage.setItem('pro_token', 'tok-g');
    const { container } = page();
    await screen.findByTestId('dossier-recap');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok-g');   // the pro session (before: cookie only → refused → DEMO data)
    expect(screen.getByTestId('recap-unsigned-notice')).toHaveTextContent(/Document non signé, sans valeur d'attestation officielle/);
    expect(screen.getByTestId('recap-items')).toHaveTextContent(/RSA — À faire vérifier \(à demander à : CAF du Bas-Rhin\)/);
    expect(container.textContent).toContain('f'.repeat(64));
    expect(container.textContent.replace(/non signé|Aucune \(document non signé\)|signature électronique|attestation signée|identité du signataire/g, '')).not.toMatch(FALSE_CLAIMS);
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
  });

  it.each([[404, /introuvable/], [410, /expiré/], [401, /reconnectez-vous/]])('a %i shows an error and NO invented (demo) document', async (status, msg) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status, json: async () => ({}) })));
    const { container } = page();
    await waitFor(() => expect(screen.getByTestId('recap-error')).toHaveTextContent(msg));
    expect(screen.queryByTestId('dossier-recap')).toBeNull();
    expect(container.textContent).not.toMatch(/DEMO|ADA-DEMO|Certifi/);
  });

  it('a network failure shows an error, not a document', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    page();
    await waitFor(() => expect(screen.getByTestId('recap-error')).toHaveTextContent(/n’a pas pu être chargé/));
  });

  it('ExpertTools has no signing action any more: only a link to the unsigned recap', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ drafts: [] }) })));
    const { container } = render(createElement(MemoryRouter, null, createElement(ExpertTools, { shareId: 'abc', aiAllowed: false })));
    expect(screen.queryByRole('button', { name: /signer/i })).toBeNull();
    expect(container.textContent).not.toMatch(/PDF signé|Certificat souverain|Signer l/);
    expect(screen.getByRole('link', { name: 'Ouvrir le récapitulatif' })).toHaveAttribute('href', '/pro/attestation/abc');
    expect(screen.getByTestId('recap-card')).toHaveTextContent(/n'est pas signé et n'a pas valeur d'attestation officielle/);
  });
});
