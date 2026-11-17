// @vitest-environment jsdom
/* global window */
/**
 * C12 — the public /ressources pages show, for every published document, its official source (publisher) and the date a person verified it; an aging
 * verification says so; the detail page links the source (new tab, announced) and keeps the « official source prevails » rule; a withdrawn document
 * says it was withdrawn; with nothing published the honest empty state stays. The administration page says plainly when migration 0050 is missing.
 * axe (color-contrast off in jsdom) on each. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({ apiClient: { admin: { listResources: vi.fn(), getResource: vi.fn(), resourceAction: vi.fn() } } }));
import { apiClient } from '@/api/client';
import Ressources from '../../src/pages/Ressources.jsx';
import RessourceDetail from '../../src/pages/RessourceDetail.jsx';
import ResourcePublication from '../../src/pages/admin/ResourcePublication.jsx';

const DOC = { id: 'r1', slug: 'guide-caf', title: 'Guide des services en ligne de la Caf', type: 'guide', content: 'Présentation officielle.\nDeuxième ligne.',
  source_url: 'https://www.caf.fr/allocataires/mes-services-en-ligne', source_publisher: 'Caf', verified_at: '2026-11-01T10:00:00.000Z', published_at: '2026-11-02T10:00:00.000Z', freshness: 'current' };
const answer = (status, body) => vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: status < 400, status, json: async () => body })));
const page = (el, path) => { window.history.pushState({}, '', path); return render(h(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, h(HelmetProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Routes, null, h(Route, { path: '/ressources', element: h(Ressources) }), h(Route, { path: '/ressources/:slug', element: h(RessourceDetail) }), h(Route, { path: '/admin/r', element: el })))))); };
const clean = async (container) => { const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } }); expect(r.violations.map((v) => v.id)).toEqual([]); };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.pushState({}, '', '/'); });

describe('C12 public list', () => {
  it('each card shows the official source and the verification date; an aging verification says so', async () => {
    answer(200, { items: [DOC, { ...DOC, id: 'r2', slug: 'b', title: 'Simulateur officiel', type: 'tool', freshness: 'update_needed' }] });
    const { container } = page(null, '/ressources');
    await waitFor(() => expect(screen.getAllByTestId('ressource-card')).toHaveLength(2));
    expect(screen.getAllByTestId('ressource-source')[0]).toHaveTextContent('Source officielle : Caf');
    expect(screen.getAllByTestId('ressource-verified')[0]).toHaveTextContent(/Vérifié le 1(er)? novembre 2026/);
    expect(screen.getAllByTestId('ressource-update-needed')).toHaveLength(1);
    expect(screen.getByText('Outil')).toBeInTheDocument();
    await clean(container);
  });
  it('nothing published: the honest empty state and the emergency numbers (unchanged)', async () => {
    answer(200, { items: [] });
    page(null, '/ressources');
    await waitFor(() => expect(screen.getByTestId('ressources-none-published')).toBeInTheDocument());
    expect(screen.getByTestId('emergency-resource-112')).toHaveAttribute('href', 'tel:112');
  });
});

describe('C12 public detail', () => {
  it('shows the source block (publisher, link in a new tab announced, verification date) and the text as plain text', async () => {
    answer(200, DOC);
    const { container } = page(null, '/ressources/guide-caf');
    await waitFor(() => expect(screen.getByTestId('ressource-source-block')).toBeInTheDocument());
    const link = screen.getByRole('link', { name: /caf\.fr.*nouvel onglet/ });
    expect(link).toHaveAttribute('href', DOC.source_url); expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByTestId('ressource-verified')).toHaveTextContent(/Vérifié le :\s*1(er)? novembre 2026/);
    expect(screen.getByTestId('ressource-source-block')).toHaveTextContent('la source officielle fait foi');
    expect(container.querySelector('img, script, iframe')).toBeNull();
    await clean(container);
  });
  it('a withdrawn document (410) says it was withdrawn, without its old content', async () => {
    answer(410, { error: 'WITHDRAWN', withdrawn: true });
    page(null, '/ressources/guide-caf');
    await waitFor(() => expect(screen.getByTestId('ressource-withdrawn')).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Document retiré');
  });
});

describe('C12 administration page', () => {
  it('without migration 0050 it says the tool is not available and that the public page shows no document', async () => {
    apiClient.admin.listResources.mockResolvedValue({ available: false, items: [{ id: 'old', title: 'Ancien' }] });
    const { container } = page(h(ResourcePublication), '/admin/r');
    await waitFor(() => expect(screen.getByTestId('resources-unavailable')).toHaveTextContent('migration 0050 non appliquée'));
    expect(screen.getByText('Lignes existantes (non publiques) : 1')).toBeInTheDocument();
    await clean(container);
  });
  it('with 0050 it lists the documents, marks a legacy row, and every field of the editor has a label', async () => {
    apiClient.admin.listResources.mockResolvedValue({ available: true, items: [{ id: 'old', title: 'Ancien document', status: 'published', legacy: true, publicDecision: { visible: false, reasons: ['NOT_VERIFIED'] } }] });
    const { container } = page(h(ResourcePublication), '/admin/r');
    await waitFor(() => expect(screen.getByTestId('resources-admin-list')).toHaveTextContent('Ancienne ligne : source et vérification à compléter'));
    screen.getByRole('button', { name: 'Nouveau document' }).click();
    await waitFor(() => expect(screen.getByLabelText('Adresse de la source officielle (https)')).toBeInTheDocument());
    for (const l of ['Titre', 'Type', 'Description (texte simple, sans HTML)', 'Éditeur de la source', 'Territoire (facultatif)']) expect(screen.getByLabelText(l)).toBeInTheDocument();
    await clean(container);
  });
});
