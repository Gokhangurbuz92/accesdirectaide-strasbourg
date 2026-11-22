// @vitest-environment jsdom
/**
 * G14 — the limited Mon Parcours screen: a closed list (select with labelled options grouped by domain), no free title, no free organisation name, no
 * consent dialog, no import; the place is chosen among the server's results (radio buttons in a fieldset with a legend); the deadline source is a select
 * of the step's official fiches; the note exists only where the server opens it. Keyboard: every control is a native, labelled form element.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listParcours: vi.fn(), parcoursHistory: vi.fn(), parcours: vi.fn(), removeParcours: vi.fn(), listShares: vi.fn(), parcoursStructures: vi.fn() }));
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api, CitizenApiError: class extends Error {} }));
vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get() { throw new Error('database touched'); } }) }));

import CompteParcours from '../../src/pages/CompteParcours.jsx';
import { ParcoursAccessGate } from '../../src/components/AddToParcoursButton.jsx';
import { PARCOURS_RECORD_STEPS } from '../../src/lib/parcoursRecordSteps.js';
import { stepCatalogueView } from '../../api/lib/parcours-step-types.js';

const wrap = (el) => render(h(QueryClientProvider, { client: new QueryClient() }, h(HelmetProvider, null, h(MemoryRouter, null, el))));
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const stepTypes = stepCatalogueView();
const base = { contract: 'limited', stepTypes, items: [], planSteps: true, planImport: false, emailReminders: false, sensitiveSteps: 'excluded', notes: false };
const item = { id: 'p1', origin: 'MANUAL', stepKind: 'custom', stepType: 'RSA_DEMANDE', title: 'Demander le RSA', status: 'NOT_STARTED', closure: null, dueDate: null, note: null,
  itemCodes: ['steptype:RSA_DEMANDE', 'structure:s1'], records: [{ code: 'structure:s1', type: 'structure', available: true, title: 'Caf du Bas-Rhin', href: '/structures/caf-67' }], available: true };

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); api.parcoursHistory.mockResolvedValue({ events: [] }); api.listShares.mockResolvedValue({ shares: [] }); });
afterEach(() => { cleanup(); });

describe('G14 — limited Mon Parcours screen', () => {
  it('offers the closed list only: a labelled select with every type, grouped by domain; no free title, no consent, no import, no organise form', async () => {
    api.listParcours.mockResolvedValue(base);
    wrap(h(CompteParcours)); await tick();
    expect(screen.getByTestId('compte-parcours')).toHaveAttribute('data-contract', 'limited');
    const select = screen.getByLabelText('Démarche');
    expect(select.tagName).toBe('SELECT');
    expect(within(select).getAllByRole('option')).toHaveLength(stepTypes.types.length + 1);
    expect(select.querySelectorAll('optgroup').length).toBe(Object.keys(stepTypes.domains).length);
    expect(screen.queryByTestId('parcours-new-title')).toBeNull();
    expect(screen.queryByTestId('parcours-consent')).toBeNull();
    expect(screen.queryByTestId('parcours-import')).toBeNull();
    expect(screen.queryByTestId('parcours-organise')).toBeNull();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.getByTestId('parcours-add')).toBeDisabled();
    expect(screen.getByTestId('parcours-limited-notice')).toHaveTextContent(/aucun texte libre/);
    expect(screen.getByTestId('parcours-limited-notice')).toHaveTextContent(/visibles que par vous/);
  });

  it('adds a step with stepType (and the chosen place) only', async () => {
    api.listParcours.mockResolvedValue(base);
    api.parcoursStructures.mockResolvedValue({ structures: [{ id: 's1', name: 'Caf du Bas-Rhin', town: 'Strasbourg' }] });
    api.parcours.mockResolvedValue({ added: true, item: { id: 'p1' } });
    wrap(h(CompteParcours)); await tick();
    fireEvent.change(screen.getByLabelText('Démarche'), { target: { value: 'RSA_DEMANDE' } });
    fireEvent.change(screen.getByLabelText('Nom du lieu ou de la commune'), { target: { value: 'Caf' } });
    await act(async () => { fireEvent.click(screen.getByTestId('parcours-place-find')); }); await tick();
    expect(api.parcoursStructures).toHaveBeenCalledWith('RSA_DEMANDE', 'Caf');
    const group = screen.getByRole('group', { name: 'Choisissez un lieu' });
    fireEvent.click(within(group).getByLabelText(/Caf du Bas-Rhin/));
    await act(async () => { fireEvent.click(screen.getByTestId('parcours-add')); }); await tick();
    expect(api.parcours).toHaveBeenCalledWith({ action: 'add', stepType: 'RSA_DEMANDE', structureId: 's1' });
  });

  it('a step shows its label, its place and its official fiches; the deadline source is a select of those fiches; the note is hidden while closed', async () => {
    api.listParcours.mockResolvedValue({ ...base, items: [item] });
    api.parcours.mockResolvedValue({ ok: true });
    wrap(h(CompteParcours)); await tick();
    expect(screen.getByTestId('parcours-item-title')).toHaveTextContent('Demander le RSA');
    expect(screen.getByTestId('parcours-item-place')).toHaveTextContent('Caf du Bas-Rhin');
    expect(screen.getByTestId('parcours-official-sources').querySelectorAll('a[target="_blank"]').length).toBe(2);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour' })); }); await tick();
    const source = screen.getByLabelText('Fiche officielle de référence');
    expect(source.tagName).toBe('SELECT');
    expect(within(source).getAllByRole('option')).toHaveLength(2);
    expect(screen.queryByTestId('parcours-note')).toBeNull();
    fireEvent.change(screen.getByLabelText('Échéance'), { target: { value: '2027-03-01' } });
    await act(async () => { fireEvent.click(screen.getByTestId('parcours-due-save')); }); await tick();
    expect(api.parcours).toHaveBeenCalledWith({ action: 'deadline', id: 'p1', dueDate: '2027-03-01' });
    expect(screen.getByTestId('parcours-reminder-channels')).toHaveTextContent(/Aucun rappel n’est envoyé par e-mail ni par SMS/);
  });

  it('the note appears (labelled, described, 500 characters) only where the server opens it', async () => {
    api.listParcours.mockResolvedValue({ ...base, notes: true, items: [item] });
    wrap(h(CompteParcours)); await tick();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour' })); }); await tick();
    const note = screen.getByLabelText('Note personnelle (visible par vous seul)');
    expect(note).toHaveAttribute('maxLength', '500');
    expect(note).toHaveAttribute('aria-describedby', 'nt-hint-p1');
  });

  it('« Ajouter à mon parcours » is no longer offered on record pages (records are refused by the limited contract)', () => {
    expect(PARCOURS_RECORD_STEPS.offered).toBe(false);
    const { container } = wrap(h(ParcoursAccessGate, null, h('span', { 'data-testid': 'inside' }, 'x')));
    expect(container.querySelector('[data-testid="inside"]')).toBeNull();
  });
});
