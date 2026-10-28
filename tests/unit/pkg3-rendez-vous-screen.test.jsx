// @vitest-environment jsdom
/** PKG-3 / D-2 — Mes rendez-vous: move (only when allowed, new slot picked, server answer shown), cancel, and the reason when a move is not offered. citizenApi mocked. */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ myAppointments: vi.fn(), cancelAppointment: vi.fn(), rescheduleAppointment: vi.fn(), freeSlots: vi.fn() }));
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api }));
import CompteRendezVous from '../../src/pages/CompteRendezVous.jsx';

const base = { structure: { slug: 'alpha', name: 'Alpha' }, service: { id: 's1', name: 'Entretien' }, status: 'CONFIRMED' };
const A = { ...base, id: 'a1', startsAt: '2099-01-10T09:00:00.000Z', canCancel: true, canReschedule: true, reschedule: { count: 0, max: 2 } };
const LATE = { ...base, id: 'a2', startsAt: '2099-01-11T09:00:00.000Z', canCancel: true, canReschedule: false, reschedule: { count: 0, max: 2 } };
const LIMIT = { ...base, id: 'a3', startsAt: '2099-01-12T09:00:00.000Z', canCancel: true, canReschedule: false, reschedule: { count: 2, max: 2 } };
const page = () => render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(CompteRendezVous))));

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); api.myAppointments.mockResolvedValue({ appointments: [A, LATE, LIMIT] }); });
afterEach(cleanup);

describe('Mes rendez-vous', () => {
  it('states the D-2 policy and why a move is not offered (less than 24 hours / already moved twice)', async () => {
    page();
    expect(await screen.findByTestId('rdv-policy')).toHaveTextContent('24 heures avant, deux fois au plus');
    const reasons = screen.getAllByTestId('rdv-move-unavailable').map((n) => n.textContent);
    expect(reasons).toEqual(['Il reste moins de 24 heures : pour le déplacer, contactez la structure.', 'Ce rendez-vous a déjà été déplacé deux fois.']);
    expect(screen.getAllByTestId('rdv-move')).toHaveLength(1);
  });
  it('moves to the picked free slot (never the current one) and reports success', async () => {
    api.freeSlots.mockResolvedValue({ days: [{ date: '2099-01-10', slots: [{ startAt: '2099-01-10T09:00:00.000Z' }, { startAt: '2099-01-10T09:30:00.000Z' }] }] });
    api.rescheduleAppointment.mockResolvedValue({});
    page();
    fireEvent.click(await screen.findByTestId('rdv-move'));
    const slots = await screen.findAllByTestId('rdv-slot');
    expect(slots.map((s) => s.value)).toEqual(['2099-01-10T09:30:00.000Z']);
    expect(screen.getByTestId('rdv-move-confirm')).toBeDisabled();
    fireEvent.click(slots[0]); fireEvent.click(screen.getByTestId('rdv-move-confirm'));
    await waitFor(() => expect(api.rescheduleAppointment).toHaveBeenCalledWith('a1', '2099-01-10T09:30:00.000Z'));
    expect(await screen.findByTestId('rdv-status')).toHaveTextContent('L’ancien créneau a été libéré');
  });
  it('a refused move shows the server reason; cancel calls the server', async () => {
    api.freeSlots.mockResolvedValue({ days: [{ date: '2099-01-10', slots: [{ startAt: '2099-01-10T10:00:00.000Z' }] }] });
    api.rescheduleAppointment.mockRejectedValue(Object.assign(new Error('Ce rendez-vous a déjà été déplacé 2 fois. Contactez la structure.'), { status: 409, code: 'RESCHEDULE_LIMIT' }));
    api.cancelAppointment.mockResolvedValue({});
    page();
    fireEvent.click(await screen.findByTestId('rdv-move'));
    fireEvent.click(await screen.findByTestId('rdv-slot')); fireEvent.click(screen.getByTestId('rdv-move-confirm'));
    expect(await screen.findByTestId('rdv-problem')).toHaveTextContent('déjà été déplacé 2 fois');
    fireEvent.click(screen.getAllByTestId('rdv-cancel')[0]);
    expect(api.cancelAppointment).not.toHaveBeenCalled();   // R18: cancelling asks for an explicit confirmation first
    fireEvent.click(await screen.findByTestId('rdv-cancel-confirm'));
    await waitFor(() => expect(api.cancelAppointment).toHaveBeenCalledWith('a1'));
  });
});
