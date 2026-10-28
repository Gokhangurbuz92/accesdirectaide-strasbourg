// @vitest-environment jsdom
/**
 * PKG-1 R3 — repair of the R2 native run 20261018T201600Z-8356fd (DTA-B19, last failing step): a SEARCH that matches nothing showed the filtered empty state
 * ("Aucune aide trouvée… réinitialisez") with NO route to the official portals; only the unfiltered empty state carried them. D-5 honest empty state:
 * whatever the reason nothing is listed, the citizen is pointed to the official portals and no record is invented.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/hooks/useAidesListing.ts', () => ({ useAidesListing: () => ({ status: 'success', items: [], pagination: { total: 0, page: 1, totalPages: 0 }, facets: {}, errorMessage: null, refetch: vi.fn() }) }));
vi.mock('../../src/api/client', () => ({ client: { taxonomy: { get: async () => ({}) } } }));
vi.mock('@vercel/analytics', () => ({ track: vi.fn() }));

import Aides from '../../src/pages/Aides.jsx';

const mount = (url) => render(createElement(QueryClientProvider, { client: new QueryClient() },
  createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [url] }, createElement(Aides)))));
afterEach(cleanup);

describe('D-5 honest empty state on /aides', () => {
  it('a search with no match keeps the filtered empty state AND points to the official portals', async () => {
    mount('/aides?q=zzzz-nothing-zzzz');
    const box = await screen.findByTestId('aides-empty-filtered');
    expect(box).toHaveTextContent('Aucune aide trouvée');
    const notice = screen.getByTestId('official-resources-notice');
    expect(box).toContainElement(notice);
    expect(notice.querySelectorAll('a[href^="https://www.service-public.fr"]').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('aides-empty-neutral')).toBeNull();   // not the "catalogue is being updated" message: results exist, they just do not match
  });
  it('no filter at all keeps the neutral empty state with the same official portals', async () => {
    mount('/aides');
    const box = await screen.findByTestId('aides-empty-neutral');
    expect(box).toContainElement(screen.getByTestId('official-resources-notice'));
    expect(screen.queryByTestId('aides-empty-filtered')).toBeNull();
  });
});
