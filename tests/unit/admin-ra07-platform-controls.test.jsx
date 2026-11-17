// @vitest-environment jsdom
/**
 * RA-07 — the two administrator operations that existed only as an API now have controls: the lift of an e-mail suppression on the support page
 * (POST admin/mail-suppressions, status / lift with a reason) and the review of the sensitivity of a structure's bookable services
 * (/admin/sensibilite-services, POST admin/service-sensitivity, list / review with a reason). Both are platform operations: the elevation refusal is explained.
 * Synthetic data. No JSX.
 */
/* global window */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import axe from 'axe-core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ apiClient: { admin: { k5: vi.fn() } } }));
vi.mock('@/api/client', () => api);
import AdminSupport from '../../src/pages/admin/k5/Support.jsx';
import AdminServiceSensitivity from '../../src/pages/admin/k5/ServiceSensitivity.jsx';

afterEach(() => { cleanup(); api.apiClient.admin.k5.mockReset(); window.history.replaceState({}, '', '/'); });
const inRouter = (c) => render(createElement(MemoryRouter, {}, createElement(c)));
const ELEVATION = Object.assign(new Error('403'), { status: 403, payload: { error: 'ELEVATION_REQUIRED' } });

describe('RA-07 — e-mail suppression lift (support page)', () => {
  it('checks the state, refuses a lift without a reason, lifts with one and forgets the address; the elevation refusal is explained', async () => {
    api.apiClient.admin.k5.mockImplementation(async (path, body) => {
      if (path === 'support') return { requests: [] };
      if (body?.action === 'status') return { suppressed: 'hard_bounce' };
      if (body?.action === 'lift') return { lifted: true, previous: 'hard_bounce' };
      throw new Error('unexpected');
    });
    const { container } = inRouter(AdminSupport);
    const box = await screen.findByTestId('admin-mailsup');
    expect(within(box).getByRole('heading', { level: 2 })).toHaveTextContent('Lever une suppression d’envoi d’e-mails');
    fireEvent.change(within(box).getByLabelText('Adresse e-mail concernée'), { target: { value: 'personne@example.test' } });
    fireEvent.click(within(box).getByTestId('admin-mailsup-status'));
    await waitFor(() => expect(within(box).getByTestId('admin-mailsup-result')).toHaveTextContent('Envois suspendus pour cette adresse : adresse rejetée définitivement par le serveur de messagerie.'));
    expect(api.apiClient.admin.k5).toHaveBeenCalledWith('mail-suppressions', { action: 'status', email: 'personne@example.test' });

    fireEvent.click(within(box).getByTestId('admin-mailsup-lift'));
    expect(await within(box).findByRole('alert')).toHaveTextContent('Indiquez la raison de la levée (10 à 500 caractères).');
    expect(api.apiClient.admin.k5).not.toHaveBeenCalledWith('mail-suppressions', expect.objectContaining({ action: 'lift' }));

    fireEvent.change(within(box).getByLabelText(/^Motif de la levée/), { target: { value: 'La personne confirme que sa boîte fonctionne.' } });
    fireEvent.click(within(box).getByTestId('admin-mailsup-lift'));
    await waitFor(() => expect(within(box).getByTestId('admin-mailsup-result')).toHaveTextContent('Suppression levée (adresse rejetée définitivement par le serveur de messagerie) et journalisée.'));
    expect(api.apiClient.admin.k5).toHaveBeenCalledWith('mail-suppressions', { action: 'lift', email: 'personne@example.test', reason: 'La personne confirme que sa boîte fonctionne.' });
    expect(within(box).getByLabelText('Adresse e-mail concernée')).toHaveValue('');
    expect(container.textContent).not.toContain('personne@example.test');

    api.apiClient.admin.k5.mockImplementation(async (path) => { if (path === 'support') return { requests: [] }; throw ELEVATION; });
    fireEvent.change(within(box).getByLabelText('Adresse e-mail concernée'), { target: { value: 'autre@example.test' } });
    fireEvent.click(within(box).getByTestId('admin-mailsup-status'));
    expect(await within(box).findByRole('alert')).toHaveTextContent('Opération de plateforme : demandez d’abord une élévation temporaire');
    expect(within(box).getByRole('link', { name: 'Demander une élévation (page Opérations)' })).toHaveAttribute('href', '/admin/operations');
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it('says when there was nothing to lift', async () => {
    api.apiClient.admin.k5.mockImplementation(async (path, body) => (path === 'support' ? { requests: [] } : body.action === 'lift' ? { lifted: false, previous: null } : null));
    inRouter(AdminSupport);
    const box = await screen.findByTestId('admin-mailsup');
    fireEvent.change(within(box).getByLabelText('Adresse e-mail concernée'), { target: { value: 'x@example.test' } });
    fireEvent.change(within(box).getByLabelText(/^Motif de la levée/), { target: { value: 'Demande de la personne au support.' } });
    fireEvent.click(within(box).getByTestId('admin-mailsup-lift'));
    await waitFor(() => expect(within(box).getByTestId('admin-mailsup-result')).toHaveTextContent('Aucune suppression n’existait pour cette adresse : rien n’a été modifié.'));
  });
});

describe('RA-07 — service sensitivity review', () => {
  const LIST = { structure: { id: 'st-1', name: 'Centre médico-social Test' }, reviewComplete: false, gate: { sensitiveBookingOpen: false, reviewEnforced: true },
    items: [{ id: 'svc-a', name: 'Consultation CMP', active: true, value: 'unknown', reviewedAt: null, reviewedBy: null, suggestion: 'sensitive', matched: ['cmp'] },
      { id: 'svc-b', name: 'Accueil administratif', active: true, value: 'ordinary', reviewedAt: '2026-11-01T10:00:00.000Z', reviewedBy: 'admin@example.test', suggestion: 'no_signal', matched: [] }] };

  it('lists the services from ?structure=, shows the suggestion as an aid, and saves a review with a reason', async () => {
    window.history.replaceState({}, '', '/admin/sensibilite-services?structure=st-1');
    api.apiClient.admin.k5.mockImplementation(async (path, body) => (body.action === 'list' ? LIST : { ok: true, previous: 'unknown', value: 'sensitive', reviewedAt: '2026-11-17T10:00:00.000Z' }));
    const { container } = inRouter(AdminServiceSensitivity);
    const table = await screen.findByRole('table', { name: /Services de la structure/ });
    expect(api.apiClient.admin.k5).toHaveBeenCalledWith('service-sensitivity', { action: 'list', structureId: 'st-1' });
    expect(screen.getByTestId('admin-sensitivity-summary')).toHaveTextContent('Au moins un service réservable n’est pas revu. La réservation des services sensibles reste fermée par la configuration, quelle que soit la revue.');
    const [cmp, admin] = within(table).getAllByTestId('admin-sensitivity-row');
    expect(within(cmp).getByRole('rowheader')).toHaveTextContent('Consultation CMP');
    expect(cmp).toHaveTextContent('Non revu'); expect(cmp).toHaveTextContent('Peut-être sensible (cmp)');
    expect(admin).toHaveTextContent('Ordinaire'); expect(admin).toHaveTextContent('admin@example.test');
    expect(within(cmp).getByLabelText('Nouvelle valeur pour Consultation CMP')).toHaveValue('unknown');   // the suggestion never sets the value

    fireEvent.change(within(cmp).getByLabelText('Nouvelle valeur pour Consultation CMP'), { target: { value: 'sensitive' } });
    fireEvent.click(within(cmp).getByTestId('admin-sensitivity-save'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Indiquez la raison de la classification de « Consultation CMP »');
    fireEvent.change(within(cmp).getByLabelText(/^Motif/), { target: { value: 'Consultation de santé mentale : donnée de santé.' } });
    fireEvent.click(within(cmp).getByTestId('admin-sensitivity-save'));
    await waitFor(() => expect(screen.getByTestId('admin-sensitivity-status')).toHaveTextContent('« Consultation CMP » : Non revu → Sensible (art. 9). Revue journalisée.'));
    expect(api.apiClient.admin.k5).toHaveBeenCalledWith('service-sensitivity', { action: 'review', structureId: 'st-1', serviceId: 'svc-a', value: 'sensitive', reason: 'Consultation de santé mentale : donnée de santé.' });
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it('an unknown structure and a missing elevation are explained', async () => {
    api.apiClient.admin.k5.mockRejectedValueOnce(Object.assign(new Error('404'), { status: 404, payload: { error: 'structure_not_found' } }));
    inRouter(AdminServiceSensitivity);
    fireEvent.change(screen.getByLabelText('Identifiant de la structure'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByTestId('admin-sensitivity-load'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Structure introuvable.');
    api.apiClient.admin.k5.mockRejectedValueOnce(ELEVATION);
    fireEvent.click(screen.getByTestId('admin-sensitivity-load'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('demandez d’abord une élévation temporaire'));
  });

  it('is routed at /admin/sensibilite-services and listed in the menu', () => {
    expect(fs.readFileSync('src/pages/index.jsx', 'utf8')).toMatch(/<Route path="sensibilite-services" element=\{<AdminServiceSensitivity \/>\} \/>/);
    expect(fs.readFileSync('src/pages/admin/AdminLayout.jsx', 'utf8')).toMatch(/to: '\/admin\/sensibilite-services'/);
  });
});
