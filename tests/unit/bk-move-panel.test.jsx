// @vitest-environment jsdom
/**
 * Booking audit fixes — the move panel of « Mes rendez-vous » (citizenApi mocked).
 *  A-26  the panel asks the server for the slots of THE appointment being moved (its id and its modality), never the structure-wide list.
 *  A-30  when the server says the move needs the separate art. 9 agreement, the panel shows the (never pre-ticked) box, refuses to send without it —
 *        said on the field, which takes the focus — and sends sensitiveConsent: true with it; a server SENSITIVE_CONSENT_REQUIRED shows the box too.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('A-30: the art. 9 box is shown when the server expects it, is never pre-ticked, blocks the move while unticked and travels as sensitiveConsent: true', async () => {
    api.freeSlots.mockResolvedValue({ ...DAYS, move: { appointmentId: 'a1', sensitiveConsentRequired: true } });
    api.rescheduleAppointment.mockResolvedValue({});
    page();
    fireEvent.click((await screen.findAllByTestId('rdv-move'))[0]);
    fireEvent.click(await screen.findByTestId('rdv-slot'));
    const box = screen.getByTestId('booking-sensitive-consent-checkbox');
    expect(box).not.toBeChecked();
    fireEvent.click(screen.getByTestId('rdv-move-confirm'));
    expect(await screen.findByTestId('booking-sensitive-consent-error')).toHaveAttribute('role', 'alert');
    expect(api.rescheduleAppointment).not.toHaveBeenCalled();
    await waitFor(() => expect(box).toHaveFocus());
    expect(box).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(box);
    expect(screen.queryByTestId('booking-sensitive-consent-error')).toBeNull();
    fireEvent.click(screen.getByTestId('rdv-move-confirm'));
    await waitFor(() => expect(api.rescheduleAppointment).toHaveBeenCalledWith('a1', '2099-01-10T09:30:00.000Z', { sensitiveConsent: true }));
  });

  it('A-30: no box when the server does not ask for it; a server SENSITIVE_CONSENT_REQUIRED shows the box (not « contact the structure ») and keeps the chosen slot', async () => {
    api.freeSlots.mockResolvedValue({ ...DAYS, move: { appointmentId: 'a1', sensitiveConsentRequired: false } });
    api.rescheduleAppointment.mockRejectedValueOnce(Object.assign(new Error('Pour déplacer ce rendez-vous en ligne, cochez la case d’accord.'), { status: 400, code: 'SENSITIVE_CONSENT_REQUIRED' }));
    api.rescheduleAppointment.mockResolvedValueOnce({});
    page();
    fireEvent.click((await screen.findAllByTestId('rdv-move'))[0]);
    fireEvent.click(await screen.findByTestId('rdv-slot'));
    expect(screen.queryByTestId('booking-sensitive-consent')).toBeNull();
    fireEvent.click(screen.getByTestId('rdv-move-confirm'));
    const box = await screen.findByTestId('booking-sensitive-consent-checkbox');
    expect(screen.getByTestId('booking-sensitive-consent-error')).toBeInTheDocument();
    expect(screen.queryByTestId('rdv-problem')).toBeNull();
    expect(screen.getByTestId('rdv-slot')).toBeChecked();
    fireEvent.click(box); fireEvent.click(screen.getByTestId('rdv-move-confirm'));
    await waitFor(() => expect(api.rescheduleAppointment).toHaveBeenLastCalledWith('a1', '2099-01-10T09:30:00.000Z', { sensitiveConsent: true }));
  });
});
