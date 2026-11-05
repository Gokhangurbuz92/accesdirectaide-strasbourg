// @vitest-environment jsdom
/**
 * R45 / ENG-LR-6 — the Mon Espace home with a minimised summary (the server omits every part whose capability is closed, api/_services/mon-espace.js):
 * no tile, no card and no crash for a missing part; the booking parts stay.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ espace: vi.fn() }));
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api, CitizenApiError: class extends Error {} }));

import MonEspace from '../../src/pages/MonEspace.jsx';

const mount = () => render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(MonEspace)))));
afterEach(cleanup);

describe('Mon Espace with closed capabilities', () => {
  it('shows only the parts the server returned (booking scope): no parcours, vault, favourites or dossiers tile or card', async () => {
    api.espace.mockResolvedValue({ nextAppointment: null, messages: { conversations: 0, lastMessageAt: null, lastFromStructure: false } });
    mount();
    expect(await screen.findByTestId('mon-espace')).toBeInTheDocument();
    for (const id of ['tile-parcours', 'tile-coffre', 'tile-favoris', 'tile-dossiers', 'espace-next-due']) expect(screen.queryByTestId(id), id).toBeNull();
    for (const id of ['tile-rdv', 'tile-messages', 'espace-next-appointment']) expect(screen.getByTestId(id), id).toBeInTheDocument();
  });
  it('the full summary (LAB) keeps every tile', async () => {
    api.espace.mockResolvedValue({ parcours: { total: 1, open: 1, nextDue: null }, documents: 0, favorites: 0, dossiers: 0, nextAppointment: null,
      messages: { conversations: 0, lastMessageAt: null, lastFromStructure: false } });
    mount();
    expect(await screen.findByTestId('mon-espace')).toBeInTheDocument();
    for (const id of ['tile-parcours', 'tile-coffre', 'tile-favoris', 'tile-dossiers', 'tile-rdv', 'tile-messages', 'espace-next-due', 'espace-next-appointment'])
      expect(screen.getByTestId(id), id).toBeInTheDocument();
  });
});
