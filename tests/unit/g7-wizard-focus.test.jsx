// @vitest-environment jsdom
/* global document */
/**
 * G7 (19/11/2026) — live keyboard check of /orientation on Production (G4): after « Logement » was chosen with Enter, the activated button unmounted with
 * its step and focus fell back to <body>. Now focus goes to the questionnaire container after every step change made by the user, never on page load.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({ client: { entities: { Structure: { filter: async () => [] } } } }));
vi.mock('@/lib/assistant/client', () => ({ postRecommendations: async () => ({ items: [] }) }));
vi.mock('@/lib/csrf', () => ({ csrfFetch: async () => { throw new Error('no request expected'); } }));
vi.mock('@/config/env', async (orig) => {
  const m = await orig();
  return { ...m, frontendEnv: { ...m.frontendEnv, flags: { ...m.frontendEnv.flags, publicBeta: true } } };
});

import Wizard from '../../src/components/assistant/Wizard.jsx';

describe('G7: keyboard focus follows the wizard steps', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ORIENTATION_BROWSER_ONLY', '1');
    vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', 'admin,accounts');
  });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

  it('no focus is taken on page load', () => {
    render(h(MemoryRouter, null, h(Wizard)));
    expect(document.activeElement).toBe(document.body);
  });

  it('after each step change (forward and back) focus is on the questionnaire, not on <body>', () => {
    render(h(MemoryRouter, null, h(Wizard)));
    const region = () => screen.getByRole('region', { name: /Questionnaire d.orientation/ });
    fireEvent.click(screen.getByRole('button', { name: 'Logement' }));
    expect(document.activeElement).toBe(region());
    fireEvent.click(screen.getByRole('button', { name: /^(Continuer|Passer cette étape)$/ }));
    expect(document.activeElement).toBe(region());
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    expect(document.activeElement).toBe(region());
  });
});
