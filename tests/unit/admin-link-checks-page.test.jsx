// @vitest-environment jsdom
/**
 * RA-06 — the administrator page of the official-link check (src/pages/admin/k5/LinkChecks.jsx, /admin/liens): the broken links first, the address checked,
 * the result in words, the date of the last check and a link to the record; an honest empty state when the check never ran; reachable from the menu. No JSX.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import axe from 'axe-core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ apiClient: { admin: { k5: vi.fn() } } }));
vi.mock('@/api/client', () => api);
import AdminLinkChecks from '../../src/pages/admin/k5/LinkChecks.jsx';
import { linkClass, linkRows } from '../../src/pages/admin/k5/linkChecksModel.js';

afterEach(() => { cleanup(); api.apiClient.admin.k5.mockReset(); });
const U = (p) => `https://www.service-public.fr/test/${p}`;
const ITEMS = [
  { entity_type: 'Aide', entity_id: 'aide-1', checks: [{ fetched_at: '2026-11-14T03:00:00.000Z', http_status: 404, final_url: U('gone'), url: U('gone') }, { fetched_at: '2026-11-07T03:00:00.000Z', http_status: 404, final_url: U('gone'), url: U('gone') }] },
  { entity_type: 'Structure', entity_id: 'str-9', checks: [{ fetched_at: '2026-11-14T03:00:01.000Z', http_status: 0, final_url: U('down'), url: U('down') }] },
];
const page = () => render(createElement(MemoryRouter, {}, createElement(AdminLinkChecks)));

describe('official link check — administrator page', () => {
  it('reads a result as the link check classifies it, and keeps one line per record and address', () => {
    expect([null, 0, 404, 410, 403, 429, 503, 200, 302].map((s) => linkClass({ http_status: s, url: 'a', final_url: 'a' }))).toEqual(['OUTSIDE', 'NETWORK', 'BROKEN', 'BROKEN', 'BLOCKED', 'BLOCKED', 'SERVER', 'OK', 'OTHER']);
    expect(linkClass({ http_status: 200, url: 'a', final_url: 'b' })).toBe('REDIRECTED');
    const rows = linkRows([...ITEMS, { entity_type: 'Aide', entity_id: 'x', checks: [{ http_status: 500, url: null }] }]);
    expect(rows.map((r) => [r.entityId, r.cls, r.results, r.fetched_at])).toEqual([['aide-1', 'BROKEN', 2, '2026-11-14T03:00:00.000Z'], ['str-9', 'NETWORK', 1, '2026-11-14T03:00:01.000Z']]);
  });

  it('lists the links with an error: record link, address, result, last check; « tous les résultats » asks the server again', async () => {
    api.apiClient.admin.k5.mockImplementation(async (path) => (path.includes('limit=1&') || path.endsWith('limit=1') ? { items: [ITEMS[1]] }
      : path.includes('is_broken=true') ? { items: ITEMS } : { items: [...ITEMS, { entity_type: 'Demarche', entity_id: 'dem-2', checks: [{ fetched_at: '2026-11-14T03:00:02.000Z', http_status: 200, final_url: U('new'), url: U('old') }] }] }));
    const { container } = page();
    await waitFor(() => expect(screen.getAllByTestId('admin-links-row')).toHaveLength(2));
    expect(api.apiClient.admin.k5).toHaveBeenCalledWith('link-checks?kind=link&limit=100&is_broken=true');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Liens officiels (contrôle)');
    expect(screen.getByTestId('admin-links-last')).toHaveTextContent('Dernier contrôle enregistré :');
    const table = screen.getByRole('table', { name: /Liens contrôlés/ });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Fiche', 'Adresse contrôlée', 'Résultat', 'Dernier contrôle']);
    const [broken, down] = screen.getAllByTestId('admin-links-row');
    expect(within(broken).getByRole('link', { name: 'Aide aide-1' })).toHaveAttribute('href', '/admin/aides/aide-1');
    expect(within(broken).getByRole('link', { name: U('gone') })).toHaveAttribute('href', U('gone'));
    expect(broken).toHaveTextContent('Introuvable (lien cassé) (HTTP 404)'); expect(broken).toHaveTextContent('2 résultats dans cette liste');
    expect(within(down).getByRole('link', { name: 'Structure str-9' })).toHaveAttribute('href', '/admin/structures/str-9');
    expect(down).toHaveTextContent('Site injoignable');
    expect(screen.getByRole('link', { name: 'File qualité des données' })).toHaveAttribute('href', '/admin/review-queue');

    fireEvent.change(screen.getByLabelText('Afficher'), { target: { value: 'all' } });
    await waitFor(() => expect(screen.getAllByTestId('admin-links-row')).toHaveLength(3));
    expect(api.apiClient.admin.k5).toHaveBeenCalledWith('link-checks?kind=link&limit=100');
    expect(screen.getAllByTestId('admin-links-row')[2]).toHaveTextContent(`Accessible après redirection (HTTP 200)`);
    expect(screen.getAllByTestId('admin-links-row')[2]).toHaveTextContent(`Adresse finale : ${U('new')}`);
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it('says that no check was ever recorded instead of « no broken link », and shows a failure to load', async () => {
    api.apiClient.admin.k5.mockResolvedValue({ total: 0, items: [] });
    page();
    expect(await screen.findByText(/Aucun contrôle enregistré\. Le contrôle des liens ne tourne que lorsque le propriétaire l’active/)).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('Aucun résultat.');
    expect(screen.queryByText(/Aucun lien en erreur/)).toBeNull();
    cleanup();
    api.apiClient.admin.k5.mockRejectedValue({ status: 401 });
    page();
    expect(await screen.findByRole('alert')).toHaveTextContent('Session expirée');
    expect(screen.queryByText(/Aucun contrôle enregistré/)).toBeNull();
  });

  it('is routed at /admin/liens and listed in the administration menu', () => {
    expect(fs.readFileSync('src/pages/index.jsx', 'utf8')).toMatch(/<Route path="liens" element=\{<AdminLinkChecks \/>\} \/>/);
    const layout = fs.readFileSync('src/pages/admin/AdminLayout.jsx', 'utf8');
    expect(layout).toMatch(/\{ label: 'Liens officiels \(contrôle\)', to: '\/admin\/liens'/);
    expect(layout).toMatch(/'Liens officiels \(contrôle\)': t\('admin:layout\.nav\.link_checks'/);
  });
});
