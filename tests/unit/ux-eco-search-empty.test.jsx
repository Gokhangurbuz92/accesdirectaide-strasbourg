// @vitest-environment jsdom
/**
 * UX ecosystem (2026-11-12) — an empty search offered only « Relancer la recherche », which re-ran the same query (same empty answer). The empty state now
 * offers the next steps: the same words without the category, the guided paths (by need, orientation) and the directory with the same words.
 * No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/searchClient', async (orig) => ({ ...(await orig()), searchAides: vi.fn(async () => ({ results: [], meta: { total: 0, totalAll: 0, message: null } })) }));
vi.mock('@/hooks/useCitizenHistory', () => ({ default: () => () => {} }));

import Recherche from '../../src/pages/Recherche.jsx';

afterEach(() => cleanup());
const show = (path) => render(h(HelmetProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Recherche))));

describe('UX ecosystem: an empty search is not a dead end', () => {
  it('offers the guided paths and the directory with the same words, never the same query again', async () => {
    show('/recherche?q=zzqxw');
    const next = await screen.findByTestId('search-empty-next');
    expect(screen.getByRole('link', { name: 'Trouver par besoin' })).toHaveAttribute('href', '/besoins');
    expect(screen.getByRole('link', { name: 'Être orienté pas à pas' })).toHaveAttribute('href', '/orientation');
    expect(screen.getByRole('link', { name: 'Chercher un lieu d’accueil dans l’annuaire' })).toHaveAttribute('href', '/structures?q=zzqxw');
    expect(next).not.toHaveTextContent('Relancer la recherche');
    expect(screen.queryByRole('link', { name: 'Chercher dans toutes les catégories' })).toBeNull();
  });
  it('with a category: the same words in every category', async () => {
    show('/recherche?q=zzqxw&category=logement');
    await screen.findByTestId('search-empty-next');
    expect(screen.getByRole('link', { name: 'Chercher dans toutes les catégories' })).toHaveAttribute('href', '/recherche?q=zzqxw');
  });
});
