// @vitest-environment jsdom
/**
 * UX ecosystem (2026-11-12) — a structure whose official source publishes no telephone, e-mail or site said « contactez-la directement » (a dead end:
 * 113 verified records in the LAB catalogue). It now says that no contact is published and offers the other structures of its town; a structure with a
 * contact channel keeps the original sentence.
 * No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const S = vi.hoisted(() => ({ row: null }));
vi.mock('../../src/api/client', () => ({ client: { entities: { Structure: { filter: async () => [S.row] } } } }));

import StructureDetail from '../../src/pages/StructureDetail.jsx';

afterEach(() => { cleanup(); S.row = null; });
const base = { id: 's1', slug: 'x', nom: 'Centre synthétique', adresse: '1 rue de test', code_postal: '67000', ville: 'Strasbourg', statut: 'actif', services: [], publics_accueillis: [], categories_aidees: [] };
const show = () => render(createElement(HelmetProvider, null, createElement(QueryClientProvider, { client: new QueryClient() },
  createElement(MemoryRouter, { initialEntries: ['/structures/x'] }, createElement(Routes, null, createElement(Route, { path: '/structures/:slug', element: createElement(StructureDetail) }))))));

describe('UX ecosystem: a structure page never ends on « contact it » without a contact', () => {
  it('no telephone, e-mail or site: says so and links to the other structures of the town', async () => {
    S.row = { ...base }; show();
    const box = await screen.findByTestId('structure-no-contact');
    expect(box).toHaveTextContent('ne publie ni téléphone, ni courriel, ni site');
    expect(screen.getByRole('link', { name: 'Voir les autres structures à Strasbourg' })).toHaveAttribute('href', '/structures?city=Strasbourg');
    expect(screen.queryByTestId('structure-no-online-booking')).toBeNull();
  });
  it('with a telephone: the original sentence and the call button', async () => {
    S.row = { ...base, telephone: '03 00 00 00 00' }; show();
    expect(await screen.findByTestId('structure-no-online-booking')).toHaveTextContent('contactez-la directement');
    expect(screen.queryByTestId('structure-no-contact')).toBeNull();
  });
});
