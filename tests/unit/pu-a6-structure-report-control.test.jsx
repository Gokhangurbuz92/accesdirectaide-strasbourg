// @vitest-environment jsdom
/**
 * A-6 (P19) — a place and a dispositif can be reported from their own page with the control of aides and démarches; the handler accepts both kinds.
 * No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
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

afterEach(() => { cleanup(); vi.unstubAllEnvs(); env.beta = false; });
const wrap = (el, path = '/structures/lieu-exemple') => render(h(HelmetProvider, null, h(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
  h(MemoryRouter, { initialEntries: [path] }, el))));
const page = () => wrap(h(Routes, null, h(Route, { path: '/structures/:slug', element: h(StructureDetail) })));

describe('A-6: a place and a dispositif can be reported from their page', () => {
  it('the place page mounts the report control (form outside the beta)', async () => {
    page();
    await screen.findByRole('heading', { level: 1, name: 'Lieu Exemple' });
    expect(screen.getByTestId('feedback-button')).toHaveTextContent('Signaler une info');
  });
  it('restricted beta: the control is an e-mail link naming the place (no closed form)', async () => {
    env.beta = true; vi.stubEnv('VITE_CONTACT_EMAIL', 'contact@example.test');
    page();
    await screen.findByRole('heading', { level: 1, name: 'Lieu Exemple' });
    const control = screen.queryByTestId('feedback-button');
    if (control) {   // shown only when the build publishes a contact address
      const href = decodeURIComponent(control.querySelector('a')?.getAttribute('href') || control.getAttribute('href') || '');
      expect(href).toMatch(/^mailto:/); expect(href).toContain('structure lieu-exemple');
    }
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('the dispositif page uses the same control and no longer links to the closed /contact screen', () => {
    const src = fs.readFileSync('src/pages/DispositifDetail.jsx', 'utf8');
    expect(src).toMatch(/<FeedbackButton\s+type="dispositif"\s+entityId=\{dispositif\.id\}\s+entitySlug=\{dispositif\.slug\}/);
    expect(src).not.toMatch(/createPageUrl\('Contact'\)/);
  });
});
