// @vitest-environment jsdom
/**
 * G14 (owner 23/11/2026: ADA Pro opens without a pilot structure) — the screens of the structure's own sign-up request:
 *  - /pro/register asks for the SIRET, states the professional terms above « Envoyer ma demande », sends termsAccepted: true, and says « demande reçue »
 *    (no session is stored, nothing navigates into the space);
 *  - /admin/organizations shows the pending requests (badge, SIRET, filter) and, in « Agir », « Vérifier et activer » (source, note, territory, version read —
 *    checked before any request) and « Refuser » (the card's reason).
 * No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ apiClient: { admin: { getOrganizations: vi.fn(), setOrganizationActivity: vi.fn(), getOrganizationMembers: vi.fn(), administerProAccount: vi.fn(),
  getVerification: vi.fn(), verifyAndActivateProRegistration: vi.fn(), refuseProRegistration: vi.fn() } } }));
vi.mock('@/api/client', () => api);
vi.mock('@/components/admin/VerificationPanel', () => ({ default: () => null }));
vi.mock('@/lib/csrf', () => ({ ensureCsrfHeaders: async () => ({ 'x-csrf-token': 't' }), getCsrfHeaders: () => ({}) }));
vi.mock('@/components/SEO', () => ({ default: () => null }));

import AdminOrganizations from '../../src/pages/admin/Organizations.jsx';
import ProRegister from '../../src/pages/pro/Register.jsx';

afterEach(() => { cleanup(); Object.values(api.apiClient.admin).forEach((f) => f.mockReset()); vi.unstubAllGlobals(); });

describe('G14 — /pro/register is a request', () => {
  it('asks for the SIRET, states the terms, sends termsAccepted: true and shows « demande reçue » without storing a session', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202, json: async () => ({ ok: true, status: 'PENDING_VERIFICATION' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const setItem = vi.spyOn(globalThis.Storage.prototype, 'setItem');
    render(h(MemoryRouter, { initialEntries: ['/pro/register'] }, h(Routes, null, h(Route, { path: '/pro/register', element: h(ProRegister) }))));
    expect(screen.getByTestId('pro-register-terms-statement')).toHaveTextContent(/En envoyant ma demande, j’accepte les conditions d’utilisation des professionnels et, pour ma structure, les conditions pour les structures/);
    fireEvent.change(screen.getByLabelText('Nom de la structure'), { target: { value: 'Association Synthétique' } });
    fireEvent.change(screen.getByLabelText('Numéro SIRET de la structure'), { target: { value: '73282932000074' } });
    fireEvent.change(screen.getByLabelText('Email professionnel'), { target: { value: 'g14@example.test' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'Synthetic-QA-pass-0001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer ma demande' }));
    const done = await screen.findByTestId('pro-register-received');
    expect(done).toHaveTextContent('Demande reçue — votre structure sera vérifiée sur une source officielle avant l’ouverture de votre espace.');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ structureName: 'Association Synthétique', siret: '73282932000074', email: 'g14@example.test', password: 'Synthetic-QA-pass-0001', termsAccepted: true });
    expect(setItem).not.toHaveBeenCalledWith('pro_token', expect.anything());
  });
});

describe('G14 — /admin/organizations: pending ADA Pro sign-up requests', () => {
  const ORG = { id: 'org-new', slug: 'org-new', nom: 'Association nouvelle', ville: null, statut: 'brouillon', identity: 'UNVERIFIED', public: { visible: false, reasons: [] }, activeMembers: 0,
    canReceiveNew: false, publicationHold: null, siret: '73282932000074', pendingRegistrations: 1 };
  const page = () => render(h(MemoryRouter, { initialEntries: ['/admin/organizations?decision=pro_pending'] }, h(Routes, null, h(Route, { path: '/admin/organizations', element: h(AdminOrganizations) }))));
  const open = async () => {
    api.apiClient.admin.getOrganizations.mockResolvedValue({ organizations: [ORG], total: 1, limit: 200 });
    api.apiClient.admin.getOrganizationMembers.mockResolvedValue({ members: [{ id: 'u-new', email: 'new@example.test', role: 'STRUCTURE_ADMIN', status: 'pending_verification', erased: false }] });
    api.apiClient.admin.getVerification.mockResolvedValue({ version: 'a'.repeat(64), content: [] });
    page();
    const card = await screen.findByTestId('admin-org');
    expect(api.apiClient.admin.getOrganizations).toHaveBeenCalledWith('', 'pro_pending');
    expect(within(card).getByTestId('admin-org-pro-pending')).toHaveTextContent('1 inscription(s) ADA Pro à vérifier');
    expect(within(card).getByTestId('admin-org-siret')).toHaveTextContent('73282932000074');
    const details = card.querySelector('details'); details.open = true; fireEvent(details, new Event('toggle'));
    const panel = await screen.findByTestId('admin-org-pro-registration');
    await waitFor(() => expect(within(panel).getByTestId('admin-org-pro-registration-activate')).toBeEnabled());
    return { card, panel };
  };

  it('« Vérifier et activer »: source, note and territory are checked first, then one request bound to the version read', async () => {
    api.apiClient.admin.verifyAndActivateProRegistration.mockResolvedValue({ ok: true });
    const { panel } = await open();
    expect(screen.getByTestId('admin-org-member')).toHaveTextContent('inscription à vérifier');
    expect(within(panel).queryByTestId('admin-org-member-disable')).toBeNull();
    fireEvent.click(within(panel).getByTestId('admin-org-pro-registration-activate'));
    expect(api.apiClient.admin.verifyAndActivateProRegistration).not.toHaveBeenCalled();
    expect((await within(panel).findAllByText(/Confirmez le territoire/)).length).toBeGreaterThan(0);
    fireEvent.change(within(panel).getByLabelText('Source officielle consultée (adresse https)'), { target: { value: 'https://annuaire-entreprises.data.gouv.fr/etablissement/73282932000074' } });
    fireEvent.change(within(panel).getByLabelText('Ce que la source montre (au moins 20 caractères)'), { target: { value: 'SIRET et dénomination vérifiés sur l’annuaire.' } });
    fireEvent.click(within(panel).getByLabelText('Je confirme le territoire de la structure'));
    fireEvent.click(within(panel).getByTestId('admin-org-pro-registration-activate'));
    await waitFor(() => expect(api.apiClient.admin.verifyAndActivateProRegistration).toHaveBeenCalledWith('u-new', {
      sourceUrl: 'https://annuaire-entreprises.data.gouv.fr/etablissement/73282932000074', evidenceNote: 'SIRET et dénomination vérifiés sur l’annuaire.', territoryConfirmed: true, expectedVersion: 'a'.repeat(64) }));
    expect(await screen.findByTestId('admin-org-status')).toHaveTextContent('Structure vérifiée et activée');
  });

  it('« Refuser » needs the card\'s reason, then refuses that request', async () => {
    api.apiClient.admin.refuseProRegistration.mockResolvedValue({ ok: true });
    const { card, panel } = await open();
    fireEvent.click(within(panel).getByTestId('admin-org-pro-registration-refuse'));
    expect(api.apiClient.admin.refuseProRegistration).not.toHaveBeenCalled();
    fireEvent.change(card.querySelector(`#why-${ORG.id}`), { target: { value: 'Aucun lien avec la structure.' } });
    fireEvent.click(within(panel).getByTestId('admin-org-pro-registration-refuse'));
    await waitFor(() => expect(api.apiClient.admin.refuseProRegistration).toHaveBeenCalledWith('u-new', 'Aucun lien avec la structure.'));
  });
});
