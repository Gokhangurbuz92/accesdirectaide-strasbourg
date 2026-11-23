// @vitest-environment jsdom
/**
 * A-8 (P06) — the booking entry of a place (« Voir les créneaux disponibles », « RDV en ligne ») is offered only when booking is open in this build:
 * in the restricted beta it led to the closed notice. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ beta: false }));
vi.mock('@/config/env', async (orig) => {
  const real = await orig();
  return { ...real, frontendEnv: { ...real.frontendEnv, flags: { ...real.frontendEnv.flags, get publicBeta() { return env.beta; } } } };
});
const PLACE = { id: 'st-pu-1', slug: 'lieu-exemple', nom: 'Lieu Exemple', type_structure: 'ASSOCIATION', ville: 'Strasbourg', code_postal: '67000', adresse: '1 rue Exemple',
  telephone: '0300000000', is_pro_enabled: true, verification_status: 'VERIFIED', date_verification: '2026-11-01T00:00:00.000Z', source_url: 'https://example.test/lieu' };
vi.mock('../../src/api/client', () => ({ client: { entities: { Structure: { filter: async () => [PLACE] } } } }));
vi.mock('@/components/FavoriteButton', () => ({ default: () => null }));

import StructureDetail from '../../src/pages/StructureDetail.jsx';
import StructureCard from '../../src/components/cards/StructureCard.jsx';
import { bookingOpened } from '../../src/lib/publicBeta.js';

afterEach(() => { cleanup(); vi.unstubAllEnvs(); env.beta = false; });
const wrap = (el, path = '/structures/lieu-exemple') => render(h(HelmetProvider, null, h(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
  h(MemoryRouter, { initialEntries: [path] }, el))));
const page = () => wrap(h(Routes, null, h(Route, { path: '/structures/:slug', element: h(StructureDetail) })));

describe('A-8: the booking entry respects the closed booking capability', () => {
  it('bookingOpened: outside the beta, or when the build opens the appointments surface', () => {
    expect(bookingOpened(false, [])).toBe(true);
    expect(bookingOpened(true, [])).toBe(false);
    expect(bookingOpened(true, ['appointments'])).toBe(true);
    expect(bookingOpened(true, ['accounts'])).toBe(false);
  });
  it('restricted beta: no « Voir les créneaux disponibles », no link to /rdv; the contact channels stay', async () => {
    env.beta = true;
    const { container } = page();
    await screen.findByRole('heading', { level: 1, name: 'Lieu Exemple' });
    expect(screen.queryByRole('link', { name: 'Voir les créneaux disponibles' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Prendre rendez-vous' })).toBeNull();
    expect(container.querySelector('a[href^="/rdv"]')).toBeNull();
    expect(screen.getByTestId('structure-no-online-booking')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Appeler' })).toHaveAttribute('href', 'tel:0300000000');
  });
  it('booking open (outside the beta): the entry is offered', async () => {
    const { container } = page();
    expect(await screen.findByRole('link', { name: 'Voir les créneaux disponibles' })).toBeInTheDocument();
    expect(container.querySelector('a[href^="/rdv"]')).not.toBeNull();
  });
  it('restricted beta with appointments opened by the build: the entry is offered', async () => {
    env.beta = true; vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', 'appointments');
    page();
    expect(await screen.findByRole('link', { name: 'Voir les créneaux disponibles' })).toBeInTheDocument();
  });
  it('the directory card: no « RDV en ligne » badge or booking link in the restricted beta', () => {
    env.beta = true;
    // G14-FIND: the card follows the server's `online_booking` flag (api/lib/bookable-structures.js), not the legacy is_pro_enabled flag
    const BOOKABLE = { ...PLACE, online_booking: true };
    const closed = wrap(h(StructureCard, { structure: BOOKABLE }), '/structures');
    expect(closed.container).not.toHaveTextContent('RDV en ligne');
    expect(closed.container.querySelector('a[href^="/rdv"]')).toBeNull();
    cleanup(); env.beta = false;
    const open = wrap(h(StructureCard, { structure: BOOKABLE }), '/structures');
    expect(open.container).toHaveTextContent('RDV en ligne');
    cleanup();
    // G14-FIND: is_pro_enabled alone (no verified organisation / reviewed service / agenda behind it) no longer earns the badge
    const legacy = wrap(h(StructureCard, { structure: PLACE }), '/structures');
    expect(legacy.container).not.toHaveTextContent('RDV en ligne');
    expect(legacy.container.querySelector('a[href^="/rdv"]')).toBeNull();
  });
});
