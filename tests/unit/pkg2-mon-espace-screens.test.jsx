// @vitest-environment jsdom
/**
 * PKG-2 / K2 screens with citizenApi mocked at the module boundary: what is shown, what is sent, what is refused on screen. The server rules themselves are proven on real
 * PostgreSQL in tests/integration/pkg2-mon-espace-db.test.js.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ espace: vi.fn(), listParcours: vi.fn(), parcoursHistory: vi.fn(), parcours: vi.fn(), removeParcours: vi.fn(), listShares: vi.fn(), listFavorites: vi.fn(), addFavorite: vi.fn(), removeFavorite: vi.fn(),
  getHistory: vi.fn(), setHistoryEnabled: vi.fn(), addHistory: vi.fn(), clearHistory: vi.fn(), listCoffre: vi.fn(), uploadCoffre: vi.fn(), deleteCoffre: vi.fn(), coffreDownloadUrl: (id) => `/api/citizen/coffre?download=${id}` }));
const authMe = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api, CitizenApiError: class extends Error {} }));
vi.mock('../../src/api/rdv-messaging-client.js', () => ({ rdvMessagingClient: { authMe } }));

import MonEspace from '../../src/pages/MonEspace.jsx';
import CompteParcours from '../../src/pages/CompteParcours.jsx';
import CompteCoffre from '../../src/pages/CompteCoffre.jsx';
import CompteHistorique from '../../src/pages/CompteHistorique.jsx';
import CompteFavoris from '../../src/pages/CompteFavoris.jsx';
import FavoriteButton from '../../src/components/FavoriteButton.jsx';

const mount = (C, props = {}) => render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(C, props)))));
const item = (o = {}) => ({ id: 'p1', origin: 'PLAN', stepKind: 'verify', title: 'Faire vérifier votre situation pour RSA auprès de la CAF', status: 'NOT_STARTED', dueDate: null, note: null, ...o });
beforeEach(() => { Object.values(api).forEach((f) => typeof f?.mockReset === 'function' && f.mockReset()); authMe.mockReset(); api.listShares.mockResolvedValue({ shares: [] }); api.parcoursHistory.mockResolvedValue({ events: [] }); });
afterEach(cleanup);

describe('Mon Espace home', () => {
  it('one summary call; tiles link to each area; an honest empty deadline', async () => {
    api.espace.mockResolvedValue({ parcours: { total: 3, open: 2, nextDue: null }, documents: 1, favorites: 0, dossiers: 1, nextAppointment: null });
    mount(MonEspace);
    expect(await screen.findByTestId('mon-espace')).toBeInTheDocument();
    expect(screen.getByTestId('tile-parcours')).toHaveAttribute('href', '/compte/parcours');
    expect(screen.getByTestId('tile-parcours')).toHaveTextContent('2 étape(s) en cours sur 3');
    expect(screen.getByTestId('tile-coffre')).toHaveAttribute('href', '/compte/coffre');
    expect(screen.getByTestId('espace-next-due')).toHaveTextContent('Une échéance n’est ajoutée qu’avec sa source officielle');
    expect(api.espace).toHaveBeenCalledTimes(1);
  });
  it('an expired session gives a sign-in path, not an empty space', async () => {
    api.espace.mockRejectedValue(Object.assign(new Error('x'), { status: 401 }));
    mount(MonEspace);
    expect(await screen.findByTestId('mon-espace-error')).toHaveTextContent('Connectez-vous');
  });
});

describe('Mon Parcours', () => {
  it('imports the plan of an attached dossier and says how many steps were added', async () => {
    api.listParcours.mockResolvedValue({ items: [] }); api.listShares.mockResolvedValue({ shares: [{ id: 's1', createdAt: '2026-10-01T00:00:00Z' }] });
    api.parcours.mockResolvedValue({ added: 4 });
    mount(CompteParcours);
    fireEvent.click(await screen.findByTestId('parcours-import'));
    await waitFor(() => expect(api.parcours).toHaveBeenCalledWith({ action: 'import', shareId: 's1' }));
    expect(await screen.findByTestId('parcours-status')).toHaveTextContent('4 étape(s) ajoutée(s)');
  });
  it('the person records the status; the labels never claim a decision by ADA', async () => {
    api.listParcours.mockResolvedValue({ items: [item()] }); api.parcours.mockResolvedValue({});
    mount(CompteParcours);
    fireEvent.click(await screen.findByRole('button', { name: 'Mettre à jour' }));
    const sel = await screen.findByTestId('parcours-status-select');
    expect([...sel.options].map((o) => o.textContent).filter((t) => /favorable|défavorable/.test(t)).every((t) => /indiquée par vous/.test(t))).toBe(true);
    fireEvent.change(sel, { target: { value: 'SUBMITTED' } });
    await waitFor(() => expect(api.parcours).toHaveBeenCalledWith({ action: 'status', id: 'p1', status: 'SUBMITTED' }));
  });
  it('a deadline is sent with its source; a server refusal is shown with its own message', async () => {
    api.listParcours.mockResolvedValue({ items: [item()] });
    api.parcours.mockRejectedValue(new Error('Une échéance doit citer sa source officielle (adresse https d’un site public reconnu).'));
    mount(CompteParcours);
    fireEvent.click(await screen.findByRole('button', { name: 'Mettre à jour' }));
    fireEvent.change(await screen.findByTestId('parcours-due-date'), { target: { value: '2099-01-31' } });
    fireEvent.change(screen.getByTestId('parcours-due-source'), { target: { value: 'https://evil.example/x' } });
    fireEvent.click(screen.getByTestId('parcours-due-save'));
    await waitFor(() => expect(api.parcours).toHaveBeenCalledWith({ action: 'deadline', id: 'p1', dueDate: '2099-01-31', dueSourceUrl: 'https://evil.example/x' }));
    expect(await screen.findByTestId('parcours-problem')).toHaveTextContent('source officielle');
  });
});

describe('Mon Coffre', () => {
  it('says plainly that files are not scanned; lists documents with download links; shows the quota', async () => {
    api.listCoffre.mockResolvedValue({ documents: [{ id: 'd1', category: 'identite', name: 'CNI.pdf', mimeType: 'application/pdf', byteLength: 2048, scanStatus: 'NOT_SCANNED', expiresAt: null, createdAt: '2026-10-01T00:00:00Z' }], quota: { files: 1, maxFiles: 20, bytes: 2048, maxBytes: 52428800 } });
    mount(CompteCoffre);
    expect(await screen.findByTestId('coffre-scan-notice')).toHaveTextContent('pas encore analysés par un antivirus');
    expect(screen.getByTestId('coffre-download')).toHaveAttribute('href', '/api/citizen/coffre?download=d1');
    expect(screen.getByTestId('coffre-quota')).toHaveTextContent('1 / 20 documents');
  });
  it('refuses a file over 10 Mo on screen without sending it', async () => {
    api.listCoffre.mockResolvedValue({ documents: [], quota: { files: 0, maxFiles: 20, bytes: 0, maxBytes: 52428800 } });
    mount(CompteCoffre);
    const input = await screen.findByTestId('coffre-file');
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'gros.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [big] } });
    fireEvent.click(screen.getByTestId('coffre-upload'));
    expect(await screen.findByTestId('coffre-problem')).toHaveTextContent('3 Mo au plus');   // PKG-11 audit: the on-screen limit is 3 Mo (title unchanged: a file over 10 Mo is refused too)
    expect(api.uploadCoffre).not.toHaveBeenCalled();
  });
});

describe('opt-in history and favourites', () => {
  it('history is off by default; switching it off says how much was erased', async () => {
    api.getHistory.mockResolvedValueOnce({ enabled: true, entries: [{ id: 'h1', kind: 'search', label: 'rsa', createdAt: '2026-10-01T00:00:00Z' }] }).mockResolvedValue({ enabled: false, entries: [] });
    api.setHistoryEnabled.mockResolvedValue({ enabled: false, erased: 1 });
    mount(CompteHistorique);
    const t = await screen.findByTestId('historique-toggle'); expect(t).toBeChecked();
    fireEvent.click(t);
    expect(await screen.findByTestId('historique-status')).toHaveTextContent('désactivé et effacé (1 entrée(s)');
  });
  it('the favourite button renders nothing and calls no account API for an anonymous visitor', async () => {
    authMe.mockRejectedValue(Object.assign(new Error('401'), { status: 401 }));
    mount(FavoriteButton, { entityType: 'aide', entityId: 'a1', label: 'RSA' });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByTestId('favorite-toggle')).toBeNull();
    expect(api.listFavorites).not.toHaveBeenCalled(); expect(api.addHistory).not.toHaveBeenCalled();
  });
  it('for a signed-in person it toggles the favourite and records the (opt-in) history entry', async () => {
    authMe.mockResolvedValue({ session: { kind: 'user' }, user: { email: 'x@example.test' } });
    api.listFavorites.mockResolvedValue({ favorites: [] }); api.addFavorite.mockResolvedValue({}); api.addHistory.mockResolvedValue({ recorded: false });
    mount(FavoriteButton, { entityType: 'aide', entityId: 'a1', label: 'RSA' });
    const b = await screen.findByTestId('favorite-toggle'); expect(b).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(b);
    await waitFor(() => expect(api.addFavorite).toHaveBeenCalledWith('aide', 'a1'));
    await waitFor(() => expect(screen.getByTestId('favorite-toggle')).toHaveAttribute('aria-pressed', 'true'));
    expect(api.addHistory).toHaveBeenCalledWith({ kind: 'aide', label: 'RSA', ref: 'a1' });
  });
});

describe('R12 (C10 / C11) error states', () => {
  it('favourites: a failed load says so with « Réessayer », never « Aucun favori »', async () => {
    api.listFavorites.mockRejectedValueOnce(Object.assign(new Error('Le service est momentanément injoignable.'), { status: 0 }));
    api.listFavorites.mockResolvedValueOnce({ favorites: [] });
    mount(CompteFavoris);
    expect(await screen.findByTestId('favoris-error')).toHaveTextContent('injoignable');
    expect(screen.queryByTestId('favoris-empty')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByTestId('favoris-empty')).toBeInTheDocument();
  });
  it('history: a failed load disables the switch (it is not shown as « off »)', async () => {
    api.getHistory.mockRejectedValueOnce(Object.assign(new Error('Le service est momentanément injoignable.'), { status: 0 }));
    mount(CompteHistorique);
    expect(await screen.findByTestId('historique-error')).toBeInTheDocument();
    expect(screen.getByTestId('historique-toggle')).toBeDisabled();
  });
});
