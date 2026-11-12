// @vitest-environment jsdom
/**
 * UX ecosystem (2026-11-12) — catalogue editor: the save button was only at the end of a long form. It now sits in a sticky action bar with the save status,
 * an « unsaved changes » flag, and Ctrl/Cmd+S. The save still carries the loaded version (409 on a concurrent change).
 * No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ apiClient: { admin: { content: { get: vi.fn(), update: vi.fn(), create: vi.fn(), list: vi.fn(), archive: vi.fn() } } } }));
vi.mock('@/api/client', () => api);
vi.mock('@/components/admin/EntityHistory', () => ({ default: () => null }));
vi.mock('@/components/admin/VerificationPanel', () => ({ default: () => null }));

import CatalogueEditor from '../../src/components/admin/CatalogueEditor.jsx';
import CatalogueList from '../../src/components/admin/CatalogueList.jsx';

const FIELDS = [{ name: 'titre', label: 'Titre', type: 'text', required: true }, { name: 'cest_quoi', label: 'C’est quoi ?', type: 'textarea' }];
afterEach(() => { cleanup(); Object.values(api.apiClient.admin.content).forEach((f) => f.mockReset()); });
const mount = () => render(h(MemoryRouter, { initialEntries: ['/admin/aides/a1'] }, h(Routes, null, h(Route, { path: '/admin/aides/:id', element: h(CatalogueEditor, { kind: 'aide', title: 'Aide', fields: FIELDS, listPath: '/admin/aides' }) }))));

describe('UX ecosystem: catalogue editor action bar', () => {
  it('the save button, the status and the unsaved-changes flag are in one sticky bar; Ctrl+S saves with the loaded version', async () => {
    let titre = 'Aide synthétique';
    api.apiClient.admin.content.get.mockImplementation(async () => ({ item: { id: 'a1', titre, cest_quoi: 'texte', statut: 'publie' }, version: `v-${titre}` }));
    api.apiClient.admin.content.update.mockImplementation(async (_k, _id, body) => { titre = body.titre; return { changed: ['titre'] }; });
    mount();
    const input = await screen.findByLabelText(/^Titre/);
    const bar = screen.getByTestId('admin-editor-actions');
    expect(bar).toHaveClass('sticky');
    expect(bar).toContainElement(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(bar).toContainElement(screen.getByTestId('admin-editor-status'));
    expect(screen.queryByTestId('admin-editor-dirty')).toBeNull();
    fireEvent.change(input, { target: { value: 'Aide synthétique corrigée' } });
    expect(screen.getByTestId('admin-editor-dirty')).toHaveTextContent('Modifications non enregistrées');
    fireEvent.keyDown(globalThis.window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(api.apiClient.admin.content.update).toHaveBeenCalledWith('aide', 'a1', expect.objectContaining({ titre: 'Aide synthétique corrigée', expectedVersion: 'v-Aide synthétique' })));
    await waitFor(() => expect(screen.getByTestId('admin-editor-status')).toHaveTextContent('Enregistré.'));
    await waitFor(() => expect(screen.queryByTestId('admin-editor-dirty')).toBeNull());
  });
});

describe('UX ecosystem: catalogue list sort and count', () => {
  it('recently changed first by default, by name on request, with the number shown under the filter', async () => {
    api.apiClient.admin.content.list.mockResolvedValue({ items: [
      { id: 'b', label: 'Bêta', statut: 'publie', verification_status: 'VERIFIED', updatedAt: '2026-11-01T00:00:00Z' },
      { id: 'a', label: 'alpha', statut: 'publie', verification_status: 'VERIFIED', updatedAt: '2026-11-10T00:00:00Z' },
      { id: 'c', label: 'Ça', statut: 'brouillon', verification_status: null, updatedAt: '2026-10-01T00:00:00Z' }] });
    render(h(MemoryRouter, null, h(CatalogueList, { kind: 'aide', title: 'Aides', published: 'publie', newPath: '/admin/aides/new', editPath: (id) => `/admin/aides/${id}`, createLabel: 'Créer' })));
    await screen.findAllByTestId('admin-catalogue-row');
    const order = () => screen.getAllByTestId('admin-catalogue-row').map((r) => r.getAttribute('data-id'));
    expect(order()).toEqual(['a', 'b', 'c']);
    fireEvent.change(screen.getByTestId('admin-catalogue-sort'), { target: { value: 'name' } });
    expect(order()).toEqual(['a', 'b', 'c'].sort((x, y) => ({ a: 'alpha', b: 'Bêta', c: 'Ça' })[x].localeCompare(({ a: 'alpha', b: 'Bêta', c: 'Ça' })[y], 'fr', { sensitivity: 'base' })));
    fireEvent.change(screen.getByLabelText('Afficher'), { target: { value: 'verified' } });
    expect(screen.getByTestId('admin-catalogue-count')).toHaveTextContent('2 fiche(s) affichée(s)');
  });
});

describe('UX ecosystem: catalogue list beyond the first 500 records', () => {
  it('says that only part of the catalogue is shown, counts over the whole catalogue, and asks the server for a status', async () => {
    api.apiClient.admin.content.list.mockResolvedValue({ total: 1653, limit: 500, counts: { verified: 1610, never: 40, hold: 3 },
      items: [{ id: 's1', label: 'Structure synthétique', statut: 'actif', verification_status: 'VERIFIED', updatedAt: '2026-11-10T00:00:00Z' }] });
    render(h(MemoryRouter, null, h(CatalogueList, { kind: 'structure', title: 'Structures', published: 'actif', newPath: '/admin/structures/new', editPath: (id) => `/admin/structures/${id}`, createLabel: 'Créer' })));
    expect(await screen.findByTestId('admin-catalogue-truncated')).toHaveTextContent('Seules les 1 fiches les plus récemment modifiées sur 1653');
    expect(screen.getByTestId('admin-catalogue-summary')).toHaveTextContent('1653 fiches : 40 non vérifiées · 3 en attente (décision)');
    expect(api.apiClient.admin.content.list).toHaveBeenLastCalledWith('structure', '', 'all');
    fireEvent.change(screen.getByLabelText('Afficher'), { target: { value: 'never' } });
    await waitFor(() => expect(api.apiClient.admin.content.list).toHaveBeenLastCalledWith('structure', '', 'never'));
  });
});
