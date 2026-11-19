// @vitest-environment jsdom
/**
 * G4 — the Mon Parcours screen in the « narrow accounts + parcours » opening: the page does not depend on the shared dossiers (closed, HDS-bound), never
 * offers the plan import the server would refuse, says honestly how deadlines are reminded, and asks — without blocking anything — not to write health
 * information in the free-text note (six languages, length limit stated and enforced by the field).
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listParcours: vi.fn(), parcoursHistory: vi.fn(), parcours: vi.fn(), removeParcours: vi.fn(), listShares: vi.fn() }));
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api, CitizenApiError: class extends Error {} }));
vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get() { throw new Error('database touched'); } }) }));

import CompteParcours from '../../src/pages/CompteParcours.jsx';
import { MAX_PARCOURS_NOTE } from '../../api/_services/mon-espace.js';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';

const mount = () => render(h(QueryClientProvider, { client: new QueryClient() }, h(HelmetProvider, null, h(MemoryRouter, null, h(CompteParcours)))));
const item = { id: 'p1', origin: 'MANUAL', stepKind: 'custom', title: 'Aide au logement', status: 'NOT_STARTED', closure: null, dueDate: null, note: null, itemCodes: [], records: [], available: true,
  plan: null, step: null, dependsOn: null, waiting: false };
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const refused = Object.assign(new Error('Cette fonction n’est pas encore ouverte'), { status: 503 });

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); api.parcoursHistory.mockResolvedValue({ events: [] }); });
afterEach(() => { cleanup(); });

describe('G4 — Mon Parcours screen when only Mon Parcours is open', () => {
  it('planImport:false — the shared dossiers are never asked for and no import is offered; the steps are shown', async () => {
    api.listParcours.mockResolvedValue({ items: [item], planSteps: true, planImport: false, emailReminders: false });
    api.listShares.mockRejectedValue(refused);
    mount(); await tick();
    expect(api.listShares).not.toHaveBeenCalled();
    expect(screen.getByTestId('compte-parcours')).toBeInTheDocument();
    expect(screen.queryByTestId('parcours-error')).toBeNull();
    expect(screen.queryByTestId('parcours-import')).toBeNull();
    expect(screen.getAllByTestId('parcours-item')).toHaveLength(1);
  });

  it('a refused dossier list never hides Mon Parcours (server without the flag, or capability closed)', async () => {
    api.listParcours.mockResolvedValue({ items: [item], planSteps: true });
    api.listShares.mockRejectedValue(refused);
    mount(); await tick();
    expect(api.listShares).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('parcours-error')).toBeNull();
    expect(screen.getAllByTestId('parcours-item')).toHaveLength(1);
    expect(screen.queryByTestId('parcours-import')).toBeNull();
  });

  it('planImport:true keeps the former import offer', async () => {
    api.listParcours.mockResolvedValue({ items: [], planSteps: true, planImport: true, emailReminders: true });
    api.listShares.mockResolvedValue({ shares: [{ id: 's1', createdAt: '2026-11-01T10:00:00Z' }] });
    mount(); await tick();
    expect(screen.getByTestId('parcours-import')).toBeInTheDocument();
  });

  it('the note: a visible, linked « no health information » notice, a 500-character limit, and typing is never blocked by content', async () => {
    api.listParcours.mockResolvedValue({ items: [item], planSteps: true, planImport: false, emailReminders: false });
    api.parcours.mockResolvedValue({ item });
    mount(); await tick();
    fireEvent.click(screen.getByRole('button', { name: /Mettre à jour/ })); await tick();
    const hint = screen.getByTestId('parcours-note-hint');
    expect(hint).toHaveTextContent(/N’écrivez pas d’informations sur votre santé/);
    expect(hint).toHaveTextContent(/500 caractères/);
    const note = screen.getByTestId('parcours-note');
    expect(note).toHaveAttribute('aria-describedby', hint.id);
    expect(note).toHaveAttribute('maxLength', String(MAX_PARCOURS_NOTE));
    fireEvent.change(note, { target: { value: 'diabète, traitement' } }); fireEvent.blur(note); await tick();
    expect(api.parcours).toHaveBeenCalledWith({ action: 'note', id: 'p1', note: 'diabète, traitement' });   // a warning, never a filter
    expect(screen.getByTestId('parcours-reminder-channels')).toHaveTextContent(/notifications de Mon Espace/);
    expect(screen.getByTestId('parcours-reminder-channels')).not.toHaveTextContent(/par e-mail, selon/);
  });

  it('emailReminders:true keeps the e-mail wording', async () => {
    api.listParcours.mockResolvedValue({ items: [item], planSteps: true, planImport: false, emailReminders: true });
    mount(); await tick();
    fireEvent.click(screen.getByRole('button', { name: /Mettre à jour/ })); await tick();
    expect(screen.getByTestId('parcours-reminder-channels')).toHaveTextContent(/par e-mail, selon vos réglages/);
  });

  it('the two new texts exist in the five translated languages, state no entitlement, and the server keeps the same note limit', () => {
    expect(MAX_PARCOURS_NOTE).toBe(500);
    for (const l of ['en', 'de', 'tr', 'ar', 'uk']) {
      const j = JSON.parse(fs.readFileSync(`src/i18n/locales/${l}/compte.json`, 'utf8'));
      for (const k of ['parcours.note_no_health', 'parcours.reminder_channels_inapp']) {
        expect(j[k], `${l} ${k}`).toBeTruthy();
        expect(claimsEntitlement(j[k]), `${l} ${k}`).toBe(false);
      }
      expect(j['parcours.note_no_health'], l).toMatch(/500/);
    }
  });
});
