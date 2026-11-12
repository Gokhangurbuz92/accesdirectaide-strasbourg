// @vitest-environment jsdom
/**
 * 12/11/2026 (Production fc0e40b) — /dispositifs is public while its catalogue is not published yet (a separate owner gate): the page announced
 * « 0 dispositif ou guide ». With nothing published and no search or filter, it now says the list is being prepared from official sources and links to
 * /aides, /demarches and the official online services; with a search or filter, a normal « no result » message with a way to clear them. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client', () => ({ client: { taxonomy: { get: async () => ({ categories: [] }) } } }));

import Dispositifs from '../../src/pages/Dispositifs.jsx';

const Where = () => { const l = useLocation(); return h('output', { 'data-testid': 'where' }, `${l.pathname}${l.search}`); };
const mount = (url) => render(h(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
  h(HelmetProvider, null, h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: '/dispositifs', element: h('div', null, h(Dispositifs), h(Where)) }))))));
const answer = (total) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [], pagination: { total, totalPages: Math.max(1, Math.ceil(total / 20)), hasNext: false } }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('/dispositifs while nothing is published', () => {
  it('says the list is being prepared, never a bare zero count, and links to aides, démarches and the official services', async () => {
    answer(0);
    mount('/dispositifs');
    const box = await screen.findByTestId('dispositifs-preparing');
    expect(box).toHaveAttribute('role', 'status');
    expect(screen.getByRole('heading', { name: 'La liste des dispositifs et guides est en préparation' })).toBeInTheDocument();
    expect(box).toHaveTextContent('à partir des sources officielles');
    expect(screen.getByRole('link', { name: 'Aides' })).toHaveAttribute('href', '/aides');
    expect(screen.getByRole('link', { name: 'Démarches' })).toHaveAttribute('href', '/demarches');
    expect(screen.getByRole('link', { name: /Services en ligne officiels/ })).toHaveAttribute('href', '/outils#services-officiels');
    for (const a of screen.getByTestId('dispositifs-preparing-links').querySelectorAll('a')) expect(a.className).toMatch(/min-h-11/);
    expect(globalThis.document.body).not.toHaveTextContent(/\b0 dispositif/);
    expect(screen.queryByTestId('dispositifs-scope')).toBeNull();   // no filters over nothing
    expect(screen.queryByTestId('dispositifs-empty')).toBeNull();
    expect(globalThis.document.body.textContent).not.toMatch(/vous avez droit/i);
  });
  it('with a search: a normal « no result » message and a way to clear the search and filters', async () => {
    answer(0);
    mount('/dispositifs?q=zzqxw&scope=local');
    const box = await screen.findByTestId('dispositifs-empty');
    expect(box).toHaveTextContent('Aucun dispositif trouvé pour ces critères.');
    expect(screen.queryByTestId('dispositifs-preparing')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Effacer la recherche et les filtres' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/dispositifs$/);
  });
  it('records exist but this page is past the end: back to the first page, not « being prepared »', async () => {
    answer(30);
    mount('/dispositifs?page=9');
    const box = await screen.findByTestId('dispositifs-empty');
    expect(box).toHaveTextContent('Aucun résultat sur cette page.');
    expect(screen.queryByTestId('dispositifs-preparing')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Revenir à la première page' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/dispositifs$/);
  });
});
