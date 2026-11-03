// @vitest-environment jsdom
/**
 * R41-A — regression protection for the two application defects found by the native browser QA (R40 run 20261103T071549Z-33a459):
 *  - DTA-B69: a funding dossier or an orientation selection opened with an identifier that does not exist (or still loading) had no level-1 heading
 *    (a lone alert / « Chargement… »); it is now a real page with its heading, what happened and the way back to the list.
 *  - P10-A mock journeys: any 2xx answer of GET /api/rdv/guest/structures/:slug/services — even an HTML fallback page — was read as « this structure
 *    takes account-free bookings », which skipped the sign-in path and hid the « not published » screen. Only the API's own answer offers it now.
 * No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const rdv = vi.hoisted(() => ({ proRdvRequest: vi.fn() }));
vi.mock('@/api/pro-rdv-client', () => rdv);
const api = vi.hoisted(() => ({ apiClient: { admin: { k5: vi.fn() } } }));
vi.mock('@/api/client', () => api);

import AdminFunding from '../../src/pages/admin/k5/Funding.jsx';
import ProSelections from '../../src/pages/pro/Selections.jsx';
import { guestGet, offersGuestBooking } from '../../src/lib/guestBooking.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); rdv.proRdvRequest.mockReset(); api.apiClient.admin.k5.mockReset(); });

/** @param {string} pattern @param {string} path @param {import('react').ComponentType} page */
const at = (pattern, path, page) => render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [path] },
  createElement(Routes, null, createElement(Route, { path: pattern, element: createElement(page) })))));
const notFound = (message) => Object.assign(new Error('HTTP 404'), { status: 404, payload: { error: 'not_found', message } });

describe('R41 DTA-B69: a detail page opened with an unknown identifier keeps its level-1 heading', () => {
  it('an unknown funding dossier: heading, the server reason and the way back to the list', async () => {
    api.apiClient.admin.k5.mockImplementation(async (path) => { if (String(path).startsWith('funding?id=')) throw notFound('Dossier introuvable.'); return { dossiers: [], vocab: {} }; });
    at('/admin/financement/:id', '/admin/financement/qa-not-a-real-id', AdminFunding);
    expect(await screen.findByRole('alert')).toHaveTextContent('Dossier introuvable.');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Dossiers de financement');
    expect(screen.getByRole('link', { name: '← Tous les dossiers' })).toHaveAttribute('href', '/admin/financement');
  });
  it('a funding dossier still loading already has its heading', async () => {
    api.apiClient.admin.k5.mockImplementation(() => new Promise(() => {}));
    at('/admin/financement/:id', '/admin/financement/some-id', AdminFunding);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Dossiers de financement');
    expect(screen.getByRole('status')).toHaveTextContent('Chargement…');
  });
  it('an unknown orientation selection: heading, « n’existe pas » and the way back to the list', async () => {
    rdv.proRdvRequest.mockImplementation(async (url) => { if (url === '/api/pro/cases') return { cases: [] }; throw notFound('not found'); });
    at('/pro/selections/:id', '/pro/selections/qa-not-a-real-id', ProSelections);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cette sélection n’existe pas ou ne vous est pas ouverte.');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sélections d’orientation');
    expect(screen.getByRole('link', { name: '← Toutes les sélections' })).toHaveAttribute('href', '/pro/selections');
  });
  it('an orientation selection still loading already has its heading', async () => {
    rdv.proRdvRequest.mockImplementation(() => new Promise(() => {}));
    at('/pro/selections/:id', '/pro/selections/some-id', ProSelections);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sélections d’orientation');
    expect(screen.getByRole('status')).toHaveTextContent('Chargement…');
  });
});

describe('R41 account-free booking is offered only on the API\'s own answer', () => {
  /** @param {number} status @param {string} contentType @param {string} text */
  const answer = (status, contentType, text) => vi.stubGlobal('fetch', vi.fn(async () => new Response(text, { status, headers: { 'Content-Type': contentType } })));
  const services = () => guestGet('structures/structure-test/services');

  it('an HTML page answered 200 (static-host / dev-server fallback, proxy page) is not a success and offers nothing', async () => {
    answer(200, 'text/html', '<!doctype html><html><body>app</body></html>');
    const r = await services();
    expect(r.ok).toBe(false); expect(r.status).toBe(200); expect(r.body).toEqual({});
    expect(offersGuestBooking(r)).toBe(false);
  });
  it('the switched-off service (503 GUEST_BOOKING_DISABLED) and an unknown structure (404) offer nothing', async () => {
    answer(503, 'application/json', JSON.stringify({ error: 'Guest booking disabled', code: 'GUEST_BOOKING_DISABLED' }));
    expect(offersGuestBooking(await services())).toBe(false);
    answer(404, 'application/json', JSON.stringify({ error: 'Not found', code: 'NOT_FOUND' }));
    expect(offersGuestBooking(await services())).toBe(false);
  });
  it('a JSON 2xx of another shape and a network failure offer nothing', async () => {
    answer(200, 'application/json', JSON.stringify({}));
    expect(offersGuestBooking(await services())).toBe(false);
    answer(200, 'application/json', JSON.stringify({ structure: null, items: [] }));
    expect(offersGuestBooking(await services())).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    expect(offersGuestBooking(await services())).toBe(false);
    expect(offersGuestBooking({ ok: false })).toBe(false);
  });
  it('the API\'s services answer offers it (also with no service yet: the guest page then says so)', async () => {
    const structure = { slug: 'structure-test', name: 'Structure Test', location: null, modes: ['IN_PERSON'] };
    answer(200, 'application/json', JSON.stringify({ structure, holdMinutes: 20, items: [{ id: 's1', name: 'Accueil', durationMinutes: 30, modes: ['IN_PERSON'] }] }));
    const r = await services();
    expect(r.ok).toBe(true); expect(offersGuestBooking(r)).toBe(true);
    answer(200, 'application/json', JSON.stringify({ structure, holdMinutes: 20, items: [] }));
    expect(offersGuestBooking(await services())).toBe(true);
  });
});
