// @vitest-environment jsdom
/**
 * UX ecosystem (2026-11-12) — /admin/ws2: the content to compare, the official source and the decision form are in ONE disclosure per record (it took three
 * separate disclosures); the first record of the view is open; after a decision the next record opens and takes the focus; a text search narrows the list.
 * The decision itself stays a person's: nothing is sent without a click on a decision button.
 * No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ apiClient: { admin: { getWs2Queue: vi.fn(), verifyContent: vi.fn(), getVerification: vi.fn() } } }));
vi.mock('@/api/client', () => api);

import AdminWs2Queue from '../../src/pages/admin/Ws2Queue.jsx';

const rec = (slug, title, extra = {}) => ({
  dataset: 'aides', slug, title, state: 'ON_HOLD', entityType: 'aide', entityId: `id-${slug}`, version: `v-${slug}`, hold: 'motif synthétique',
  current: [{ field: 'titre', value: title }], decision: { at: '2026-10-24T10:00:00Z' },
  preparation: { group: 'A_PRET', next: 'Comparer avec la source', check: ['Lire la source'], sourceUrl: 'https://www.service-public.gouv.fr/x', sourceAccepted: true },
  research: { officialSourceCandidate: 'https://www.service-public.gouv.fr/x', findings: 'synthetic', humanValidation: 'synthetic' }, ...extra,
});
const queue = { totals: { records: 3, humanVerified: 0, pending: 0, onHold: 3, rejected: 0, notInDatabase: 0 }, groups: { A_PRET: 3 },
  records: [rec('aide-a', 'Aide synthétique A'), rec('aide-b', 'Aide synthétique B'), rec('aide-c', 'Carte synthétique C')] };

afterEach(() => { cleanup(); Object.values(api.apiClient.admin).forEach((f) => f.mockReset()); });
const mount = () => render(createElement(MemoryRouter, null, createElement(AdminWs2Queue)));
const reviews = () => screen.getAllByTestId('admin-ws2-review');

describe('UX ecosystem: WS2 compare-and-decide', () => {
  it('one disclosure per record holds the content, the source and the decision form; only the first record is open', async () => {
    api.apiClient.admin.getWs2Queue.mockResolvedValue(queue);
    mount();
    await screen.findAllByTestId('admin-ws2-record');
    expect(reviews()).toHaveLength(3);
    await waitFor(() => expect(reviews().map((d) => d.open)).toEqual([true, false, false]));
    const first = reviews()[0];
    expect(within(first).getByTestId('admin-ws2-current')).toHaveTextContent('Aide synthétique A');
    expect(within(first).getByTestId('admin-ws2-decide')).toBeInTheDocument();
    expect(within(first).getAllByRole('link', { name: 'https://www.service-public.gouv.fr/x' }).length).toBeGreaterThan(0);
    expect(api.apiClient.admin.verifyContent).not.toHaveBeenCalled();
  });

  it('after a decision the next record of the view opens and takes the focus', async () => {
    api.apiClient.admin.getWs2Queue.mockResolvedValue(queue);
    api.apiClient.admin.verifyContent.mockResolvedValue({ ok: true });
    mount();
    await screen.findAllByTestId('admin-ws2-record');
    const first = reviews()[0];
    fireEvent.change(within(first).getByRole('textbox', { name: /Ce qui a été contrôlé/ }), { target: { value: 'note synthétique' } });
    fireEvent.click(within(first).getByTestId('admin-ws2-hold'));
    await waitFor(() => expect(reviews().map((d) => d.open)).toEqual([false, true, false]), { timeout: 5000 });
    expect(api.apiClient.admin.verifyContent).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'id-aide-a', action: 'HOLD' }));
    await waitFor(() => expect(globalThis.document.activeElement?.id).toBe('ws2-rec-aides:aide-b'), { timeout: 5000 });
  });

  it('the search narrows the records (accent- and case-insensitive) and says how many are shown', async () => {
    api.apiClient.admin.getWs2Queue.mockResolvedValue(queue);
    mount();
    await screen.findAllByTestId('admin-ws2-record');
    fireEvent.change(screen.getByTestId('admin-ws2-search'), { target: { value: 'CARTE SYNTHETIQUE' } });
    expect(screen.getAllByTestId('admin-ws2-record')).toHaveLength(1);
    expect(screen.getByTestId('admin-ws2-count')).toHaveTextContent('1 fiche(s) affichée(s)');
    await waitFor(() => expect(reviews()[0].open).toBe(true));
  });

  it('a failed load says so with a way to try again — not « no record in this filter »', async () => {
    api.apiClient.admin.getWs2Queue.mockRejectedValueOnce(Object.assign(new Error('Trop de demandes en peu de temps : patientez une minute, puis réessayez.'), { status: 429 }))
      .mockResolvedValueOnce(queue);
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Trop de demandes');
    expect(screen.queryByTestId('admin-ws2-empty')).toBeNull();
    fireEvent.click(screen.getByTestId('admin-ws2-retry'));
    expect(await screen.findAllByTestId('admin-ws2-record')).toHaveLength(3);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
