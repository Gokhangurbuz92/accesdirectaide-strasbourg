// @vitest-environment jsdom
/**
 * A-2 (P08) — in the restricted beta the empty search offered « Être orienté pas à pas » → /orientation, a closed screen. The link is offered only when
 * the screen is open (outside the beta, or when the build opens the diagnostic surface); the other next steps and the person to ask stay. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ beta: true }));
vi.mock('@/config/env', async (orig) => {
  const real = await orig();
  return { ...real, frontendEnv: { ...real.frontendEnv, flags: { ...real.frontendEnv.flags, get publicBeta() { return env.beta; } } } };
});
vi.mock('@/lib/searchClient', async (orig) => ({ ...(await orig()), searchAides: vi.fn(async () => ({ results: [], meta: { total: 0, totalAll: 0, message: null } })) }));
vi.mock('@/hooks/useCitizenHistory', () => ({ default: () => () => {} }));

import Recherche from '../../src/pages/Recherche.jsx';

afterEach(() => { cleanup(); vi.unstubAllEnvs(); env.beta = true; });
const show = () => render(h(HelmetProvider, null, h(MemoryRouter, { initialEntries: ['/recherche?q=zzqxw'] }, h(Recherche))));

describe('A-2: an empty search never links to a closed screen', () => {
  it('restricted beta, orientation closed: no link to /orientation; the open next steps and the person to ask remain', async () => {
    show();
    const next = await screen.findByTestId('search-empty-next');
    expect(screen.queryByRole('link', { name: 'Être orienté pas à pas' })).toBeNull();
    expect(next.querySelector('a[href^="/orientation"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Trouver par besoin' })).toHaveAttribute('href', '/besoins');
    expect(screen.getByRole('link', { name: 'Chercher un lieu d’accueil dans l’annuaire' })).toHaveAttribute('href', '/structures?q=zzqxw');
    expect(screen.getByTestId('human-help-block')).toBeInTheDocument();
  });
  it('restricted beta with the diagnostic surface opened by the build: the link is offered', async () => {
    vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', 'diagnostic');
    show();
    await screen.findByTestId('search-empty-next');
    expect(screen.getByRole('link', { name: 'Être orienté pas à pas' })).toHaveAttribute('href', '/orientation');
  });
  it('outside the beta: the link is offered', async () => {
    env.beta = false;
    show();
    await screen.findByTestId('search-empty-next');
    expect(screen.getByRole('link', { name: 'Être orienté pas à pas' })).toHaveAttribute('href', '/orientation');
  });
});
