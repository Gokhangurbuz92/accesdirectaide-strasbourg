// @vitest-environment jsdom
/**
 * R12 (P06) — the structure page says « introuvable » only when the server says the structure does not exist (404); a withdrawn one is « retirée » (410);
 * a server error, a rate limit or a lost connection is an error with « Réessayer », never a false « this structure does not exist ».
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const S = vi.hoisted(() => ({ fail: null }));
vi.mock('../../src/api/client', () => ({ client: { entities: { Structure: { filter: async () => {
  if (S.fail === 'network') throw new TypeError('Failed to fetch');
  const e = new Error(`API Error: ${S.fail}`); e.status = S.fail; throw e;
} } } } }));
vi.mock('../../src/pages/NotFound', () => ({ default: () => createElement('p', { 'data-testid': 'not-found' }, 'introuvable') }));
vi.mock('../../src/pages/Gone', () => ({ default: () => createElement('p', { 'data-testid': 'gone' }, 'retirée') }));

import StructureDetail from '../../src/pages/StructureDetail.jsx';

afterEach(() => { cleanup(); S.fail = null; });
const show = () => render(createElement(HelmetProvider, null, createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } }) },
  createElement(MemoryRouter, { initialEntries: ['/structures/x'] }, createElement(Routes, null, createElement(Route, { path: '/structures/:slug', element: createElement(StructureDetail) }))))));

describe('structure page error states', () => {
  it('404: introuvable', async () => { S.fail = 404; show(); expect(await screen.findByTestId('not-found')).toBeInTheDocument(); });
  it('410: retirée', async () => { S.fail = 410; show(); expect(await screen.findByTestId('gone')).toBeInTheDocument(); });
  for (const fail of [500, 429, 'network']) {
    it(`${fail}: an error with Réessayer, never « introuvable »`, async () => {
      S.fail = fail; show();
      expect(await screen.findByTestId('structure-detail-error')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
      expect(screen.queryByTestId('not-found')).toBeNull();
    });
  }
});
