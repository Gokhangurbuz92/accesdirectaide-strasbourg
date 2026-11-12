// @vitest-environment jsdom
/**
 * UX ecosystem (2026-11-12) — the « À traiter » card counts organisations « sans décision » and linked to /admin/organizations, which showed the first 200
 * of ~1 650 by name. The card now opens ?decision=never; the page filters by decision (server side), says how many match and when the list is cut.
 * No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const api = vi.hoisted(() => ({ apiClient: { admin: { getOrganizations: vi.fn(), setOrganizationActivity: vi.fn() } } }));
vi.mock('@/api/client', () => api);
vi.mock('@/components/admin/VerificationPanel', () => ({ default: () => null }));

import AdminOrganizations from '../../src/pages/admin/Organizations.jsx';

afterEach(() => { cleanup(); api.apiClient.admin.getOrganizations.mockReset(); });
const org = (id) => ({ id, nom: `Organisation ${id}`, ville: 'Strasbourg', statut: 'actif', identity: 'UNVERIFIED', public: { visible: false, reasons: [] }, activeMembers: 0, canReceiveNew: false, publicationHold: null });

describe('UX ecosystem: organisations by decision', () => {
  it('opens on the decision given in the address, shows the count and the cut notice, and changes the filter', async () => {
    api.apiClient.admin.getOrganizations.mockResolvedValue({ organizations: [org('a'), org('b')], total: 412, limit: 200 });
    render(h(MemoryRouter, { initialEntries: ['/admin/organizations?decision=never'] }, h(Routes, null, h(Route, { path: '/admin/organizations', element: h(AdminOrganizations) }))));
    await screen.findAllByTestId('admin-org');
    expect(api.apiClient.admin.getOrganizations).toHaveBeenLastCalledWith('', 'never');
    expect(screen.getByTestId('admin-org-decision')).toHaveValue('never');
    expect(screen.getByTestId('admin-org-count')).toHaveTextContent('2 affichée(s) sur 412');
    expect(screen.getByTestId('admin-org-truncated')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('admin-org-decision'), { target: { value: 'hold' } });
    await waitFor(() => expect(api.apiClient.admin.getOrganizations).toHaveBeenLastCalledWith('', 'hold'));
  });

  it('the dashboard card « sans décision » links to that filter', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/pages/AdminDashboard.jsx'), 'utf8');
    expect(src).toMatch(/key: 'orgs'[^\n]*to: '\/admin\/organizations\?decision=never'/);
  });
});
