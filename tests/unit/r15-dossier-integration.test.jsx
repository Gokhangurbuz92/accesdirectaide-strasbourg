// @vitest-environment jsdom
/**
 * R15 — product controls found by reconciling the revised legal dossier (27/10/2026) with the code:
 *   - HDS fail-closed (ASSO-056 / ASSO-066, CMP-30): Mon Coffre offered a « Santé » category with no qualified health-data hosting;
 *   - association vocabulary (B-009, CMP-04/07): a local-law association is « inscrite » at the tribunal judiciaire, never « immatriculée », and is not yet inscrite;
 *   - AI synthesis wording (CMP-51 / A11): the consent text promised a human review that only happens when a professional reviews the draft.
 * The server refusals (upload, and share-from-Coffre of a document filed under « Santé » before R15) are proven on real PostgreSQL in
 * tests/integration/pkg2-mon-espace-db.test.js and tests/integration/pkg2-batch2-db.test.js.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listCoffre: vi.fn(), uploadCoffre: vi.fn(), deleteCoffre: vi.fn(), coffreDownloadUrl: (id) => `/api/citizen/coffre?download=${id}`,
  dossierAccess: vi.fn(), dossierDocuments: vi.fn(), dossierGrants: vi.fn(), shareFromCoffre: vi.fn(), dossierDocumentUrl: (s, f) => `/api/citizen/dossier?shareId=${s}&download=${f}` }));
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api, CitizenApiError: class extends Error {} }));

import CompteCoffre from '../../src/pages/CompteCoffre.jsx';
import DossierTransparency from '../../src/components/sharing/DossierTransparency.jsx';
import { COFFRE_UPLOAD_CATEGORIES as UI_CATEGORIES, COFFRE_CATEGORY_LABELS } from '../../src/lib/monEspace.js';
import { COFFRE_CATEGORIES, COFFRE_UPLOAD_CATEGORIES, uploadCoffre } from '../../api/_services/mon-espace.js';
import brand from '../../src/lib/brand-config.js';

const mount = (C) => render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(C)))));
afterEach(cleanup);

describe('R15: Mon Coffre refuses health documents until HDS is qualified', () => {
  it('the server refuses « sante » before touching storage or the database; every other category is still accepted', async () => {
    const trap = new Proxy({}, { get() { throw new Error('storage or database touched'); } });
    const r = await uploadCoffre('u1', { category: 'sante', originalName: 'certificat.pdf', fileBase64: Buffer.from('%PDF-1.4 x').toString('base64') }, { db: trap, storage: trap });
    expect(r).toMatchObject({ ok: false, status: 422, code: 'HEALTH_DOCUMENTS_NOT_ACCEPTED' });
    expect(COFFRE_UPLOAD_CATEGORIES).toEqual(COFFRE_CATEGORIES.filter((c) => c !== 'sante'));
    expect([...UI_CATEGORIES]).toEqual(COFFRE_UPLOAD_CATEGORIES);
  });

  it('the screen offers no « Santé » choice, says why, and still shows a document filed under it before', async () => {
    api.listCoffre.mockResolvedValue({ documents: [{ id: 'd1', category: 'sante', name: 'ancien.pdf', mimeType: 'application/pdf', byteLength: 10, scanStatus: 'NOT_SCANNED', expiresAt: null, createdAt: '2026-10-01T00:00:00Z' }],
      quota: { files: 1, maxFiles: 20, bytes: 10, maxBytes: 52428800 } });
    mount(CompteCoffre);
    expect(await screen.findByTestId('coffre-health-notice')).toHaveTextContent('hébergeur agréé pour les données de santé');
    const values = [...screen.getByTestId('coffre-category').querySelectorAll('option')].map((o) => o.value);
    expect(values).not.toContain('sante');
    expect(await screen.findByTestId('coffre-item')).toHaveTextContent(COFFRE_CATEGORY_LABELS.sante);
  });

  it('a document filed under « Santé » is not offered for sending to an organisation', async () => {
    api.dossierAccess.mockResolvedValue({ events: [] }); api.dossierDocuments.mockResolvedValue({ documents: [] });
    api.dossierGrants.mockResolvedValue({ grants: [{ structureId: 's1', structureName: 'Structure Alpha', revoked: false }] });
    api.listCoffre.mockResolvedValue({ documents: [{ id: 'c1', name: 'bail.pdf', category: 'logement' }, { id: 'c2', name: 'certificat.pdf', category: 'sante' }] });
    render(createElement(DossierTransparency, { shareId: 'sh1' }));
    const options = [...(await screen.findByTestId('share-coffre-doc')).querySelectorAll('option')].map((o) => o.value);
    expect(options).toEqual(['', 'c1']);
  });
});

describe('R15: association vocabulary and AI wording', () => {
  it('no public text says the association is registered, and « immatriculation » (RCS / Sirene vocabulary) is not used for it', () => {
    const legal = readFileSync('src/pages/MentionsLegales.jsx', 'utf8') + readFileSync('src/config/legal-documents.js', 'utf8');
    expect(legal).not.toMatch(/immatricul/i);
    expect(legal).toContain('inscrite au registre des associations du tribunal judiciaire de Strasbourg');
    expect(brand.legal.legalStatus).not.toMatch(/^Association inscrite|immatricul/i);
    expect(brand.legal.legalStatus).toMatch(/pas encore inscrite/);
  });

  it('the AI-synthesis consent text no longer promises a human review that the draft does not yet have', () => {
    const panel = readFileSync('src/components/sharing/CitizenSharingPanel.jsx', 'utf8');
    expect(panel).not.toContain('le résumé est relu par une personne de la structure');
    expect(panel).toContain('brouillon marqué « non relu »');
  });
});
