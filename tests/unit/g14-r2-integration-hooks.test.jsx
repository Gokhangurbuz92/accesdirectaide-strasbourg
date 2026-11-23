// @vitest-environment jsdom
/* global document */
/**
 * G14 release 2 (g14-r2) — the hooks wired between branches at the integration:
 *   - Mon Espace: « Ma situation » tile (public, always), « Mes orientations sociales » only when the « social_referrals » surface is open in the beta,
 *     « Passeport Social » only when the build sets VITE_PASSEPORT_SOCIAL=local; the « Pour commencer » guide still shows while no ACCOUNT screen is open;
 *   - /situation: the Observatoire opt-in (g14-obs) is absent unless the build opens it, unticked by default; a chosen situation is sent ONLY when ticked,
 *     with its id in the body (never in the address);
 *   - the social referral SENT counts its closed reasons through recordSocialReferral (g14-obs), after the transaction;
 *   - the loading states of Mon Espace and of a place's page are a screen tall (g14-lite CLS note).
 * No JSX in the test body.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ beta: false }));
vi.mock('@/config/env', async (orig) => {
  const real = await orig();
  return { ...real, frontendEnv: { ...real.frontendEnv, flags: { ...real.frontendEnv.flags, get publicBeta() { return env.beta; } } } };
});
const api = vi.hoisted(() => ({ espace: vi.fn() }));
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api, CitizenApiError: class extends Error {} }));
vi.mock('@/components/account/NotificationCenter', () => ({ default: () => null }));
const csrf = vi.hoisted(() => ({ csrfFetch: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/csrf', () => csrf);

import MonEspace from '../../src/pages/MonEspace.jsx';
import Situation from '../../src/pages/Situation.jsx';

const mount = (path, el) => render(h(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
  h(HelmetProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Routes, null, h(Route, { path: '/compte', element: el }), h(Route, { path: '/situation', element: el }), h(Route, { path: '/situation/:id', element: el }))))));

beforeEach(() => { api.espace.mockReset(); api.espace.mockResolvedValue({}); csrf.csrfFetch.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); env.beta = false; });

describe('Mon Espace tiles added at the integration', () => {
  it('outside the beta: « Ma situation » and « Mes orientations sociales »; no Passeport Social without VITE_PASSEPORT_SOCIAL=local', async () => {
    mount('/compte', h(MonEspace));
    expect(await screen.findByTestId('tile-situation')).toHaveAttribute('href', '/situation');
    expect(screen.getByTestId('tile-situation')).toHaveTextContent('Aides à vérifier, démarches et lieux, selon ce qui vous arrive.');
    expect(screen.getByTestId('tile-orientations-sociales')).toHaveAttribute('href', '/compte/orientations-sociales');
    expect(screen.queryByTestId('tile-passeport')).toBeNull();
  });
  it('VITE_PASSEPORT_SOCIAL=local (exact) offers the Passeport Social; another value does not', async () => {
    vi.stubEnv('VITE_PASSEPORT_SOCIAL', 'local');
    mount('/compte', h(MonEspace));
    expect(await screen.findByTestId('tile-passeport')).toHaveAttribute('href', '/passeport-social');
    cleanup(); vi.stubEnv('VITE_PASSEPORT_SOCIAL', 'Local ');
    mount('/compte', h(MonEspace));
    await screen.findByTestId('tile-situation');
    expect(screen.queryByTestId('tile-passeport')).toBeNull();
  });
  it('restricted beta, social_referrals closed: no orientations-sociales tile; the public « Ma situation » tile does not hide the guide', async () => {
    env.beta = true;
    mount('/compte', h(MonEspace));
    await screen.findByTestId('find-and-book');
    expect(screen.queryByTestId('tile-orientations-sociales')).toBeNull();
    expect(screen.getByTestId('find-guide')).toBeInTheDocument();
  });
  it('the loading states are a screen tall (no footer jump)', () => {
    expect(fs.readFileSync('src/pages/MonEspace.jsx', 'utf8')).toMatch(/state\.loading\) return <div className="[^"]*\bmin-h-screen\b/);
    expect(fs.readFileSync('src/pages/StructureDetail.jsx', 'utf8')).toMatch(/<div className="min-h-screen w-full p-4"><SkeletonList/);
  });
});

describe('/situation and the Observatoire opt-in', () => {
  it('closed by default: no box, choosing a situation sends nothing', async () => {
    mount('/situation', h(Situation));
    expect(screen.queryByTestId('situation-signal-optin')).toBeNull();
    fireEvent.click(document.querySelector('[data-testid="situation-list"] a[data-situation="dettes"]'));
    expect(csrf.csrfFetch).not.toHaveBeenCalled();
  });
  it('opened (VITE_DEMAND_SIGNALS ∋ situation): unticked by default — nothing sent; ticked — only { situation } in the body', async () => {
    vi.stubEnv('VITE_DEMAND_SIGNALS', 'situation');
    mount('/situation', h(Situation));
    const box = screen.getByTestId('situation-signal-optin').querySelector('input[type="checkbox"]');
    expect(box).not.toBeChecked();
    expect(screen.getByTestId('situation-about')).toHaveTextContent('seulement si vous cochez la case');
    fireEvent.click(document.querySelector('[data-testid="situation-list"] a[data-situation="dettes"]'));
    expect(csrf.csrfFetch).not.toHaveBeenCalled();
    cleanup();
    mount('/situation', h(Situation));
    fireEvent.click(screen.getByTestId('situation-signal-optin').querySelector('input[type="checkbox"]'));
    fireEvent.click(document.querySelector('[data-testid="situation-list"] a[data-situation="dettes"]'));
    expect(csrf.csrfFetch).toHaveBeenCalledTimes(1);
    const [url, init] = csrf.csrfFetch.mock.calls[0];
    expect(url).toBe('/api/public/signal');
    expect(JSON.parse(init.body)).toEqual({ situation: 'dettes' });
  });
});

describe('social referral SENT → demand signal', () => {
  it('decideAs counts the closed reasons through recordSocialReferral, after the transaction (never inside it)', () => {
    const src = fs.readFileSync('api/_services/social-referrals.js', 'utf8');
    expect(src).toContain("import { recordSocialReferral } from './demand-signals.js';");
    const then = src.indexOf('}).then(async (out) => {', src.indexOf('async function decideAs'));
    expect(then).toBeGreaterThan(0);
    expect(src.slice(then, then + 400)).toMatch(/await recordSocialReferral\(Array\.isArray\(r\.reasonCodes\) \? r\.reasonCodes : \[\], \{ db, now: t \}\)/);
  });
});
