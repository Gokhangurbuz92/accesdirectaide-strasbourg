// @vitest-environment jsdom
/**
 * A-7 (P08, P11) — the search computes glossary matches (api/_handlers/search.js, `glossaire`) and the page never showed them: a query that only matched
 * a glossary term said « Aucun résultat ». The client keeps them, the page shows a « Définitions » group and counts it. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useCitizenHistory', () => ({ default: () => () => {} }));

import Recherche from '../../src/pages/Recherche.jsx';
import { __resetSearchClientForTests, searchAides } from '../../src/lib/searchClient.js';

const GLOSSARY = [{ id: 'RSA', title: 'RSA', description: 'Revenu de Solidarité Active. Revenu minimum.', category: 'INSERTION', url: '/glossaire#RSA', type: 'glossaire' }];
const answer = (body) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
const show = (path) => render(h(HelmetProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Recherche))));

beforeEach(() => { __resetSearchClientForTests(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('A-7: glossary matches of the search are shown', () => {
  it('the client library keeps the well-formed glossary entries and counts them', async () => {
    vi.stubGlobal('fetch', answer({ items: [], total: 0, demarches: [], structures: [], actualites: [], guides: [], dispositifs: [], glossaire: [...GLOSSARY, { id: 'x' }, null] }));
    const r = await searchAides({ query: 'rsa' });
    expect(r.glossaire).toEqual([{ id: 'RSA', title: 'RSA', description: 'Revenu de Solidarité Active. Revenu minimum.' }]);
    expect(r.meta.totalAll).toBe(1);
  });

  it('a glossary-only match is a result: the « Définitions » group, not « Aucun résultat »', async () => {
    vi.stubGlobal('fetch', answer({ items: [], total: 0, demarches: [], structures: [], actualites: [], guides: [], dispositifs: [], glossaire: GLOSSARY }));
    show('/recherche?q=rsa');
    const group = await screen.findByTestId('search-glossary');
    expect(within(group).getByRole('heading', { level: 2, name: 'Définitions (1)' })).toBeInTheDocument();
    expect(within(group).getByRole('term')).toHaveTextContent('RSA');
    expect(within(group).getByRole('definition')).toHaveTextContent('Revenu de Solidarité Active. Revenu minimum.');
    expect(within(group).getByRole('link', { name: 'Voir tout le glossaire' })).toHaveAttribute('href', '/glossaire');
    expect(screen.queryByTestId('search-empty-state')).toBeNull();
    expect(screen.getByTestId('search-success-state')).toHaveTextContent('1 résultat affiché.');
  });

  it('no glossary match: no group', async () => {
    vi.stubGlobal('fetch', answer({ items: [], total: 0, demarches: [], structures: [], actualites: [], guides: [], dispositifs: [], glossaire: [] }));
    show('/recherche?q=zzqxw');
    await screen.findByTestId('search-empty-state');
    expect(screen.queryByTestId('search-glossary')).toBeNull();
  });
});
