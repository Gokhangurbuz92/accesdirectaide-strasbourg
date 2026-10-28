// @vitest-environment jsdom
/**
 * DTA S5A — the booking page must not present a FAILED load as "nothing available", must offer a retry, and must always lead back to the structure's own page.
 * (Before: a failed services request showed the error AND the empty state "Aucun service disponible".)
 */
/* global document */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/analytics', () => ({ track: vi.fn() }));
vi.mock('@/components/SEO', () => ({ default: () => null }));
import PublicBooking from '../../src/pages/PublicBooking.jsx';

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const mount = () => render(createElement(MemoryRouter, { initialEntries: ['/rdv/ma-structure/booking'] }, createElement(Routes, null, createElement(Route, { path: '/rdv/:structureSlug/booking', element: createElement(PublicBooking) }))));
let calls;
beforeEach(() => { calls = []; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const stubFetch = (handler) => vi.stubGlobal('fetch', vi.fn(async (url) => { calls.push(String(url)); return handler(String(url)); }));

describe('services step', () => {
  it('a failed load is an error with a retry and a way back, never the empty state; retry then shows the services', async () => {
    let n = 0;
    stubFetch(() => (++n === 1 ? json(500, { error: 'x' }) : json(200, { items: [{ id: 7, name: 'Accompagnement', durationMinutes: 30 }] })));
    mount();
    expect(await screen.findByTestId('booking-services-error')).toHaveTextContent(/Ce n.est pas une absence de service/);
    expect(screen.queryByTestId('booking-services-empty')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Aucun service n.est proposé/);
    expect(screen.getByText('Revenir à la fiche de la structure').closest('a')).toHaveAttribute('href', '/structures/ma-structure');
    fireEvent.click(screen.getByTestId('booking-services-retry'));
    expect(await screen.findByTestId('booking-service-7')).toBeInTheDocument();
    expect(screen.queryByTestId('booking-services-error')).toBeNull();
  });
  it('an empty list is stated honestly (online only), without claiming the structure offers nothing, and links back', async () => {
    stubFetch(() => json(200, { items: [] }));
    mount();
    const empty = await screen.findByTestId('booking-services-empty');
    expect(empty).toHaveTextContent(/pas proposé en ligne|proposé en ligne/); expect(empty).toHaveTextContent(/ne dit rien/);
    expect(screen.queryByTestId('booking-services-error')).toBeNull();
    expect(screen.getByText('Revenir à la fiche de la structure').closest('a')).toHaveAttribute('href', '/structures/ma-structure');
  });
});

describe('slots step', () => {
  const open = async () => { mount(); fireEvent.click(await screen.findByTestId('booking-service-7')); };
  it('a failed slots load shows an error with a retry (not "no slot"), then the empty state is honest', async () => {
    let slotCalls = 0;
    stubFetch((u) => (u.includes('/services') ? json(200, { items: [{ id: 7, name: 'Accompagnement', durationMinutes: 30 }] }) : (++slotCalls === 1 ? json(500, {}) : json(200, { days: [] }))));
    await open();
    expect(await screen.findByTestId('booking-slots-error')).toHaveTextContent(/pas une absence de créneau/);
    expect(screen.queryByTestId('booking-slots-empty')).toBeNull();
    fireEvent.click(screen.getByTestId('booking-slots-retry'));
    await waitFor(() => expect(screen.getByTestId('booking-slots-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('booking-slots-error')).toBeNull();
    expect(calls.filter((c) => c.includes('/slots')).length).toBe(2);
  });
});
