// @vitest-environment jsdom
/**
 * A-1 (P08) — the territory pre-filter of the universal search existed on the server (api/_handlers/search.js) and in the client library
 * (src/lib/searchClient.js) but no page could reach it. /recherche now has a labelled commune control; the INSEE code lives in the URL
 * (`territoire=`) and is passed to searchAides. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ search: /** @type {any} */ (null) }));
vi.mock('@/lib/searchClient', async (orig) => {
  calls.search = vi.fn(async () => ({ results: [], meta: { total: 0, totalAll: 0, message: null } }));
  return { ...(await orig()), searchAides: calls.search };
});
vi.mock('@/hooks/useCitizenHistory', () => ({ default: () => () => {} }));

import Recherche from '../../src/pages/Recherche.jsx';

let where = '';
const Where = () => { const l = useLocation(); where = `${l.pathname}${l.search}`; return null; };
const show = (path) => render(h(HelmetProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Recherche), h(Where))));
beforeEach(() => { calls.search.mockClear(); where = ''; });
afterEach(() => cleanup());

describe('A-1: the commune pre-filter of /recherche', () => {
  it('has a labelled control, described by its help text, listing the communes of the service territory', () => {
    show('/recherche');
    const select = screen.getByLabelText('Commune');
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveValue('');
    expect(select).toHaveAccessibleDescription(/les aides réservées à un autre territoire ne sont pas affichées/);
    expect(screen.getByRole('option', { name: 'Toutes les communes' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Strasbourg' })).toHaveValue('67482');
  });

  it('sends the INSEE code of the URL to the search and shows it in the control', async () => {
    show('/recherche?q=loyer&territoire=67482');
    await waitFor(() => expect(calls.search).toHaveBeenCalled());
    expect(calls.search.mock.calls[0][0]).toMatchObject({ query: 'loyer', territory: '67482' });
    expect(screen.getByLabelText('Commune')).toHaveValue('67482');
  });

  it('a submitted commune goes to the URL, then to the search; « Toutes les communes » removes it', async () => {
    show('/recherche?q=loyer');
    await waitFor(() => expect(calls.search).toHaveBeenCalledTimes(1));
    expect(calls.search.mock.calls[0][0].territory).toBeUndefined();
    fireEvent.change(screen.getByLabelText('Commune'), { target: { value: '67043' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }));
    await waitFor(() => expect(calls.search).toHaveBeenCalledTimes(2));
    expect(calls.search.mock.calls[1][0]).toMatchObject({ query: 'loyer', territory: '67043' });
    expect(where).toContain('territoire=67043');
    fireEvent.change(screen.getByLabelText('Commune'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }));
    await waitFor(() => expect(calls.search).toHaveBeenCalledTimes(3));
    expect(calls.search.mock.calls[2][0].territory).toBeUndefined();
    expect(where).not.toContain('territoire');
  });

  it('ignores a value that is not an INSEE commune code; keeps a valid code outside the list selectable', async () => {
    show('/recherche?q=loyer&territoire=Strasbourg%27--');
    await waitFor(() => expect(calls.search).toHaveBeenCalled());
    expect(calls.search.mock.calls[0][0].territory).toBeUndefined();
    cleanup(); calls.search.mockClear();
    show('/recherche?q=loyer&territoire=2a004');
    await waitFor(() => expect(calls.search).toHaveBeenCalled());
    expect(calls.search.mock.calls[0][0].territory).toBe('2A004');
    expect(screen.getByLabelText('Commune')).toHaveValue('2A004');
  });
});
