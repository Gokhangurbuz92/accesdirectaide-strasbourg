// @vitest-environment jsdom
/**
 * UX ecosystem (2026-11-12) — /admin/veille: the routine log (up to 200 events, ~20 000 px) came before « not resolved yet » and « texts refused ».
 * Those two now come first, the log shows 20 events at a time with « show more », and each filter shows its count.
 * No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ apiClient: { admin: { getVeille: vi.fn(), getVeilleHistory: vi.fn() } } }));
vi.mock('@/api/client', () => api);

import AdminVeille from '../../src/pages/admin/Veille.jsx';

afterEach(() => { cleanup(); api.apiClient.admin.getVeille.mockReset(); });
const events = Array.from({ length: 45 }, (_, i) => ({ id: `e${i}`, outcome: i < 30 ? 'UPDATED' : 'PUBLISHED', entityType: 'aide', entityId: `a${i}`, summary: `résumé ${i}`, details: { title: `Fiche ${i}` }, createdAt: '2026-11-12T03:00:00Z' }));

describe('UX ecosystem: veille page puts what may need a person first', () => {
  it('not-resolved and refused texts before the log; the log pages by 20; filters show counts', async () => {
    api.apiClient.admin.getVeille.mockResolvedValue({ status: {}, alerts: [], totals: [], freshness: [], important: [], events,
      unresolved: [{ entity_type: 'aide', entity_id: 'x', title: 'Fiche sans source', summary: 'source introuvable', times: 3 }], textsRejected: [], sources: {}, period: {} });
    render(h(HelmetProvider, null, h(MemoryRouter, null, h(AdminVeille))));
    const unresolved = await screen.findByTestId('admin-veille-unresolved');
    const log = screen.getByTestId('admin-veille-events');
    expect(unresolved.compareDocumentPosition(log) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('admin-veille-texts-rejected').compareDocumentPosition(log) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByTestId('admin-veille-event')).toHaveLength(20);
    expect(screen.getByRole('option', { name: 'Mises à jour (30)' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('admin-veille-more'));
    expect(screen.getAllByTestId('admin-veille-event')).toHaveLength(40);
    fireEvent.click(screen.getByTestId('admin-veille-more'));
    expect(screen.getAllByTestId('admin-veille-event')).toHaveLength(45);
    expect(screen.queryByTestId('admin-veille-more')).toBeNull();
    fireEvent.change(screen.getByTestId('admin-veille-filter'), { target: { value: 'PUBLISHED,CREATED' } });
    expect(screen.getAllByTestId('admin-veille-event')).toHaveLength(15);
  });
});
