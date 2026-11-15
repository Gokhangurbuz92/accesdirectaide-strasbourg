// @vitest-environment jsdom
/**
 * Booking audit fixes — the move panel of « Mes rendez-vous » (citizenApi mocked).
 *  A-26  the panel asks the server for the slots of THE appointment being moved (its id and its modality), never the structure-wide list.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ myAppointments: vi.fn(), cancelAppointment: vi.fn(), rescheduleAppointment: vi.fn(), freeSlots: vi.fn(), bookingServices: vi.fn() }));
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api }));
import CompteRendezVous from '../../src/pages/CompteRendezVous.jsx';

const base = { structure: { slug: 'alpha', name: 'Alpha' }, service: { id: 's1', name: 'Entretien' }, status: 'CONFIRMED', canCancel: true, canReschedule: true, reschedule: { count: 0, max: 2 } };
const A = { ...base, id: 'a1', startsAt: '2099-01-10T09:00:00.000Z' };
const V = { ...base, id: 'v1', startsAt: '2099-01-11T09:00:00.000Z', mode: 'VIDEO' };
const DAYS = { days: [{ date: '2099-01-10', slots: [{ startAt: '2099-01-10T09:30:00.000Z' }] }] };
const page = () => render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(CompteRendezVous))));

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.myAppointments.mockResolvedValue({ appointments: [A, V] });
  api.freeSlots.mockResolvedValue(DAYS);
  api.bookingServices.mockResolvedValue({ items: [{ id: 's1', modes: ['IN_PERSON', 'VIDEO'] }] });
});
afterEach(cleanup);

describe('Mes rendez-vous — move panel (booking audit)', () => {
  it('A-26: the slots are asked for the appointment being moved, in its own modality', async () => {
    page();
    const buttons = await screen.findAllByTestId('rdv-move');
    fireEvent.click(buttons[0]);
    await screen.findByTestId('rdv-slot');
    expect(api.freeSlots).toHaveBeenLastCalledWith('alpha', 's1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), 'IN_PERSON', 'a1');
    fireEvent.click(screen.getAllByTestId('rdv-move')[1]);   // a video appointment keeps the video rules (it asked the in-person list before)
    await screen.findByTestId('rdv-slot');
    expect(api.freeSlots).toHaveBeenLastCalledWith('alpha', 's1', expect.any(String), expect.any(String), 'VIDEO', 'v1');
  });
});
