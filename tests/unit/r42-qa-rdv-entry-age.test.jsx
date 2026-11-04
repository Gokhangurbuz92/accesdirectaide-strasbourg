// @vitest-environment jsdom
/**
 * R42-QA — regression protection for an application defect found by the native browser QA (DTA-B26 / DTA-B27 on r42-int c91e927):
 * the slot screen /rdv/:slug/creneaux (PublicRdvEntry) books on a slot click, but R42-BOOK added the age step (R42-A07) and the approval mode (R42-A03)
 * only to /rdv/:slug/booking. On this screen an account without an age statement got 409 AGE_DECLARATION_REQUIRED and read « Ce creneau n'est plus
 * disponible » (wrong reason, the slot list reloaded, no way to declare); a stated minor read the raw code « ADULT_ACCOUNT_REQUIRED »; and a Mode B
 * request (state REQUESTED) was announced « Rendez-vous … confirmé » / « RDV confirme ». No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ client: { entities: { Structure: { filter: vi.fn() } } } }));
vi.mock('@/api/client', () => api);
vi.mock('@/lib/csrf', () => {
  class CsrfBootstrapError extends Error {}
  return { CsrfBootstrapError, csrfFetch: (/** @type {string} */ url, /** @type {RequestInit} */ init) => fetch(url, init), getCsrfHeaders: () => ({}), ensureCsrfHeaders: async () => ({}) };
});

import PublicRdvEntry from '../../src/pages/PublicRdvEntry.jsx';

const SLOT = '2026-11-20T09:00:00.000Z';
/** @param {number} status @param {unknown} body */
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * @param {{ booking: Array<[number, unknown]>, appointment?: Record<string, unknown> }} plan the successive answers of POST /api/rdv/appointments
 * @returns {{ calls: Array<{ method: string, path: string, body: unknown }> }}
 */
function stubApi(plan) {
  const calls = /** @type {Array<{ method: string, path: string, body: unknown }>} */ ([]);
  vi.stubGlobal('fetch', vi.fn(async (/** @type {string} */ url, /** @type {RequestInit | undefined} */ init) => {
    const u = new URL(url, 'http://localhost'); const method = String(init?.method || 'GET').toUpperCase();
    calls.push({ method, path: u.pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (u.pathname === '/api/auth/me') return json(200, { session: { kind: 'user' }, user: { id: 'c1', email: 'c1@example.test' } });
    if (u.pathname === '/api/rdv/structures/qa-s/services') return json(200, { structure: { modes: ['IN_PERSON'] }, items: [{ id: 'svc', name: 'Accueil', modes: ['IN_PERSON'] }] });
    if (u.pathname === '/api/rdv/structures/qa-s/slots') return json(200, { days: [{ date: '2026-11-20', slots: [{ startAt: SLOT }] }] });
    if (u.pathname === '/api/citizen/age-declaration' && method === 'POST') return json(200, { ok: true, adultAccount: true });
    if (u.pathname === '/api/rdv/appointments' && method === 'POST') { const next = plan.booking.shift(); return next ? json(next[0], next[1]) : json(500, {}); }
    if (u.pathname === '/api/rdv/appointments/a1') return json(200, plan.appointment || {});
    return json(404, { error: 'not_found' });
  }));
  return { calls };
}

function renderSlots() {
  api.client.entities.Structure.filter.mockResolvedValue([{ slug: 'qa-s', nom: 'QA', is_pro_enabled: true, rdv: { isPublished: true } }]);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client: qc }, createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: ['/rdv/qa-s/creneaux?serviceId=svc&mode=IN_PERSON'] },
    createElement(Routes, null, createElement(Route, { path: '/rdv/:structureSlug/creneaux', element: createElement(PublicRdvEntry, { view: 'creneaux' }) }))))));
}
const slotButton = async () => screen.findByTestId(`rdv-slot-${SLOT.replace(/[^a-zA-Z0-9]/g, '-')}`, {}, { timeout: 5000 });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); api.client.entities.Structure.filter.mockReset(); });

describe('R42-QA: the slot screen follows the R42 booking contract', () => {
  it('409 AGE_DECLARATION_REQUIRED asks for the age statement (never « créneau plus disponible »), then books the SAME slot', async () => {
    const appt = { id: 'a1', state: 'CONFIRMED', status: 'confirmed', mode: 'IN_PERSON', startsAt: SLOT, service: { name: 'Accueil' } };
    const { calls } = stubApi({ booking: [[409, { error: 'AGE_DECLARATION_REQUIRED', code: 'AGE_DECLARATION_REQUIRED', message: 'Avant de demander un rendez-vous, confirmez…' }], [201, { id: 'a1', state: 'CONFIRMED', status: 'confirmed' }]], appointment: appt });
    renderSlots();
    fireEvent.click(await slotButton());
    const prompt = await screen.findByTestId('booking-age-declaration');
    expect(screen.queryByText(/n'est plus disponible/)).toBeNull();
    const box = /** @type {HTMLInputElement} */ (screen.getByTestId('booking-age-checkbox'));
    expect(box.checked).toBe(false); expect(screen.getByTestId('booking-age-submit')).toBeDisabled();
    fireEvent.click(box); fireEvent.click(screen.getByTestId('booking-age-submit'));
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/rdv/appointments' && c.method === 'POST')).toHaveLength(2));
    expect(calls.find((c) => c.path === '/api/citizen/age-declaration')?.body).toEqual({ adult: true });
    const posts = calls.filter((c) => c.path === '/api/rdv/appointments' && c.method === 'POST').map((c) => /** @type {{ startAt: string }} */ (c.body).startAt);
    expect(posts).toEqual([SLOT, SLOT]);
    await waitFor(() => expect(prompt).not.toBeInTheDocument());
    expect(await screen.findByTestId('rdv-booking-state')).toHaveTextContent('RDV confirme');
  });

  it('403 ADULT_ACCOUNT_REQUIRED shows the server explanation, not the code', async () => {
    stubApi({ booking: [[403, { error: 'ADULT_ACCOUNT_REQUIRED', code: 'ADULT_ACCOUNT_REQUIRED', message: 'La prise de rendez-vous en ligne est réservée aux personnes de 18 ans ou plus. 119 ; 112.' }]] });
    renderSlots();
    fireEvent.click(await slotButton());
    expect(await screen.findByText(/réservée aux personnes de 18 ans ou plus/)).toBeInTheDocument();
    expect(screen.queryByText('ADULT_ACCOUNT_REQUIRED')).toBeNull();
    expect(screen.queryByTestId('booking-age-declaration')).toBeNull();
  });

  it('a Mode B request (state REQUESTED) is never announced as confirmed', async () => {
    const appt = { id: 'a1', state: 'REQUESTED', awaitingApproval: true, status: 'requested', mode: 'IN_PERSON', startsAt: SLOT, service: { name: 'Accueil' } };
    stubApi({ booking: [[201, { id: 'a1', state: 'REQUESTED', awaitingApproval: true, status: 'requested' }]], appointment: appt });
    renderSlots();
    fireEvent.click(await slotButton());
    expect(await screen.findByTestId('rdv-booking-state')).toHaveTextContent('Demande envoyée : en attente de la structure');
    expect(screen.getByTestId('rdv-booking-state')).toHaveAttribute('data-state', 'REQUESTED');
    expect(screen.getByTestId('rdv-requested-note')).toHaveTextContent('pas encore confirmé');
    expect(screen.queryByText(/RDV confirme|Rendez-vous en présentiel confirmé/)).toBeNull();
  });
});
