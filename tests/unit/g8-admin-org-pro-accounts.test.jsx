// @vitest-environment jsdom
/**
 * G8 (pilot onboarding acceptance) — /admin/organizations:
 *  - the card gives the identifier and the short address that the platform invitation of the first ADA Pro administrator asks for (the SUPERADMIN's
 *    « Structure partenaire » field) — they were shown nowhere, the only trace was the editor link's URL;
 *  - « Agir » lists the organization's ADA Pro accounts and offers ADA's two actions on one account: disable an active one, erase a disabled one — both with
 *    the mandatory reason, checked before any request.
 * No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ apiClient: { admin: { getOrganizations: vi.fn(), setOrganizationActivity: vi.fn(), getOrganizationMembers: vi.fn(), administerProAccount: vi.fn() } } }));
vi.mock('@/api/client', () => api);
vi.mock('@/components/admin/VerificationPanel', () => ({ default: () => null }));

import AdminOrganizations from '../../src/pages/admin/Organizations.jsx';

afterEach(() => { cleanup(); Object.values(api.apiClient.admin).forEach((f) => f.mockReset()); });
const ORG = { id: 'org-pilote-1', slug: 'association-pilote', nom: 'Association pilote', ville: 'Strasbourg', statut: 'actif', identity: 'VERIFIED', public: { visible: true, reasons: [] }, activeMembers: 1, canReceiveNew: true, publicationHold: null };
const MEMBERS = [
  { id: 'u-admin', email: 'admin@example.test', role: 'STRUCTURE_ADMIN', status: 'active', erased: false },
  { id: 'u-gone', email: 'ancien@example.test', role: 'PRO', status: 'disabled', erased: false },
  { id: 'u-erased', email: null, role: 'PRO', status: 'disabled', erased: true },
];
const page = () => render(h(MemoryRouter, { initialEntries: ['/admin/organizations'] }, h(Routes, null, h(Route, { path: '/admin/organizations', element: h(AdminOrganizations) }))));

describe('G8 — organisations: identifier for the platform invitation, ADA Pro accounts', () => {
  it('shows the identifier and the short address of each organisation', async () => {
    api.apiClient.admin.getOrganizations.mockResolvedValue({ organizations: [ORG], total: 1, limit: 200 });
    page();
    const idLine = await screen.findByTestId('admin-org-identifier');
    expect(idLine).toHaveTextContent('org-pilote-1');
    expect(idLine).toHaveTextContent('association-pilote');
    expect(idLine).toHaveTextContent(/inviter le premier administrateur ADA Pro/);
  });

  it('lists the accounts; disable for an active one, erase for a disabled one, nothing for an erased one; the reason comes first', async () => {
    api.apiClient.admin.getOrganizations.mockResolvedValue({ organizations: [ORG], total: 1, limit: 200 });
    api.apiClient.admin.getOrganizationMembers.mockResolvedValue({ members: MEMBERS });
    api.apiClient.admin.administerProAccount.mockResolvedValue({ ok: true });
    page();
    const card = await screen.findByTestId('admin-org');
    const details = card.querySelector('details');
    details.open = true; fireEvent(details, new Event('toggle'));
    const rows = await screen.findAllByTestId('admin-org-member');
    expect(api.apiClient.admin.getOrganizationMembers).toHaveBeenCalledWith('org-pilote-1');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByTestId('admin-org-member-disable')).toBeInTheDocument();
    expect(within(rows[0]).queryByTestId('admin-org-member-erase')).toBeNull();
    expect(within(rows[1]).getByTestId('admin-org-member-erase')).toBeInTheDocument();
    expect(within(rows[2]).queryByRole('button')).toBeNull();
    expect(rows[2]).toHaveTextContent('Compte effacé');
    // no reason: nothing is sent
    fireEvent.click(within(rows[1]).getByTestId('admin-org-member-erase'));
    expect(api.apiClient.admin.administerProAccount).not.toHaveBeenCalled();
    fireEvent.change(card.querySelector('textarea'), { target: { value: 'Demande d’effacement du 19/11.' } });
    fireEvent.click(within(rows[1]).getByTestId('admin-org-member-erase'));
    await waitFor(() => expect(api.apiClient.admin.administerProAccount).toHaveBeenCalledWith('u-gone', 'ERASE_PRO_ACCOUNT', 'Demande d’effacement du 19/11.'));
    fireEvent.click(within((await screen.findAllByTestId('admin-org-member'))[0]).getByTestId('admin-org-member-disable'));
    await waitFor(() => expect(api.apiClient.admin.administerProAccount).toHaveBeenCalledWith('u-admin', 'DISABLE_PRO_ACCOUNT', 'Demande d’effacement du 19/11.'));
  });

  it('a refusal of the server (work to hand over) is said on the page', async () => {
    api.apiClient.admin.getOrganizations.mockResolvedValue({ organizations: [ORG], total: 1, limit: 200 });
    api.apiClient.admin.getOrganizationMembers.mockResolvedValue({ members: MEMBERS.slice(0, 1) });
    api.apiClient.admin.administerProAccount.mockRejectedValue(Object.assign(new Error('x'), { status: 409, payload: { error: 'handover_required', message: 'Ce membre a encore des dossiers.' } }));
    page();
    const card = await screen.findByTestId('admin-org');
    const details = card.querySelector('details'); details.open = true; fireEvent(details, new Event('toggle'));
    fireEvent.change(card.querySelector('textarea'), { target: { value: 'Appareil perdu signalé.' } });
    fireEvent.click(await screen.findByTestId('admin-org-member-disable'));
    expect(await screen.findByTestId('admin-org-problem')).toHaveTextContent('Ce membre a encore des dossiers.');
  });
});
