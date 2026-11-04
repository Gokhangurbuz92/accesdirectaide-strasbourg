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
import fs from 'node:fs';

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

describe('R42 (DEC-R42-01): no account-free booking is offered anywhere in the client', () => {
  it('the guest booking module and pages are gone; an old « sans compte » link opens the account-based journey', () => {
    for (const f of ['src/lib/guestBooking.js', 'src/pages/GuestBooking.jsx', 'src/pages/GuestManage.jsx', 'src/pages/AppointmentRequest.jsx']) expect(fs.existsSync(f)).toBe(false);
    const index = fs.readFileSync('src/pages/index.jsx', 'utf8');
    expect(index).toMatch(/path="\/rdv\/:structureSlug\/sans-compte" element={<RetiredGuestBookingLink \/>}/);
    for (const f of ['src/pages/StructureDetail.jsx', 'src/pages/PublicRdvEntry.jsx', 'src/pages/PublicBookingAccessGate.jsx']) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/guestBooking|sans-compte|rendez-vous sans compte/i);
  });
});
