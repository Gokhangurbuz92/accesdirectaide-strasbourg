// @vitest-environment jsdom
/**
 * R20 (Strasbourg V1 closure, 2026-10-28) — the observatory is reachable from the professional menu (any professional role; the API keeps its own rule) and says
 * plainly when the organization is not admitted yet; the veille no longer takes a « help and contact » page that only mentions a product for that product's
 * official page; an institutional account's territory is an official INSEE territory (a label, never a coverage). Invitation rules on real PostgreSQL:
 * tests/integration/r20-invitation-sender-db.test.js. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/NotificationCenter', () => ({ default: () => null }));
vi.mock('@/components/OnboardingTour', () => ({ default: () => null }));
const rdv = vi.hoisted(() => ({ proRdvRequest: vi.fn() }));
vi.mock('@/api/pro-rdv-client', () => rdv);

import ProLayout from '../../src/pages/pro/ProLayout.jsx';
import RegionalDashboard from '../../src/pages/pro/RegionalDashboard.jsx';
import { pageIsAbout } from '../../api/_services/verification/chain.js';
import { officialTerritory } from '../../api/lib/geography/officialTerritory.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); rdv.proRdvRequest.mockReset(); });
const me = (role) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ user: { id: 'u', email: 'a@example.test', role } }) })));
const layout = (path) => render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [path] },
  createElement(Routes, null, createElement(Route, { path: '/pro', element: createElement(ProLayout) },
    createElement(Route, { path: 'dashboard', element: createElement('p', null, 'Tableau') }), createElement(Route, { path: 'regional', element: createElement('p', null, 'Observatoire page') }))))));

describe('R20 the territorial observatory in the professional menu', () => {
  beforeEach(() => { globalThis.localStorage.setItem('pro_token', 't'); globalThis.localStorage.setItem('ada_onboarding_done', '1'); });
  for (const role of ['PRO', 'STRUCTURE_ADMIN']) {
    it(`a ${role} finds it in the menu, reaches it with the keyboard, and the link opens it marked as the current page`, async () => {
      me(role); layout('/pro/dashboard');
      fireEvent.click(await screen.findByTestId('pro-mobile-menu'));
      const nav = screen.getByTestId('pro-mobile-nav');
      const link = nav.querySelector('a[href="/pro/regional"]');
      expect(link).toHaveTextContent('Observatoire territorial');
      link.focus(); expect(globalThis.document.activeElement).toBe(link);   // a real link: focusable, activated by Enter
      fireEvent.click(link);
      expect(await screen.findByText('Observatoire page')).toBeInTheDocument();
      expect(globalThis.document.querySelector('a[href="/pro/regional"][aria-current="page"]')).toBeTruthy();
      // the administrators' pages stay theirs
      expect(Boolean(globalThis.document.querySelector('a[href="/pro/team"]'))).toBe(role === 'STRUCTURE_ADMIN');
    });
  }
  it('an organization the API does not admit is told why, without « Réessayer » nor figures', async () => {
    rdv.proRdvRequest.mockRejectedValue(Object.assign(new Error('Pro API error (403)'), { status: 403 }));
    render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(RegionalDashboard))));
    expect(await screen.findByTestId('regional-refused')).toHaveTextContent('réservé aux structures actives vérifiées par ADA');
    expect(screen.queryByTestId('regional-retry')).toBeNull();
  });
  it('an outage still offers « Réessayer »', async () => {
    rdv.proRdvRequest.mockRejectedValue(Object.assign(new Error('Pro API error (500)'), { status: 500 }));
    render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(RegionalDashboard))));
    expect(await screen.findByTestId('regional-retry')).toBeInTheDocument();
  });
});

describe('R20 the veille takes a page for a record only when the page is about it', () => {
  it('the Fluo « Aide et contact » page (school transport) is not the Carte Solidaire\'s page; the pages named after the record are', () => {
    expect(pageIsAbout({ titre: 'Carte solidaire Grand Est' }, 'Aide et contact - Fluo')).toBe(false);
    expect(pageIsAbout({ titre: 'Carte solidaire Grand Est' }, 'carte solidaire | TER Grand Est')).toBe(true);
    expect(pageIsAbout({ titre: "FAJ'EMS Strasbourg / Eurométropole" }, 'Le fonds d’aide aux jeunes de l’Eurométropole de Strasbourg - FAJ’EMS')).toBe(true);
    expect(pageIsAbout({ titre: 'Accompagnement social en Espace Solidarité' }, "Etre informé et accompagné - Collectivité européenne d'Alsace")).toBe(false);
  });
});

describe('R20 an institutional territory is an official territory', () => {
  it('names and codes resolve to the official label; unknown and ambiguous names are refused', () => {
    expect(officialTerritory('Bas-Rhin')).toMatchObject({ ok: true, label: 'Bas-Rhin', kind: 'departement', code: '67' });
    expect(officialTerritory('bas rhin')).toMatchObject({ ok: true, label: 'Bas-Rhin' });
    expect(officialTerritory('246700488')).toMatchObject({ ok: true, label: 'Eurométropole de Strasbourg', kind: 'epci' });
    expect(officialTerritory('Strasbourg')).toMatchObject({ ok: true, label: 'Strasbourg (67482)', kind: 'commune' });
    expect(officialTerritory('mon secteur')).toEqual({ ok: false, reason: 'UNKNOWN' });
    const amb = officialTerritory('Saint-Martin'); expect(amb.ok).toBe(false); expect(amb.reason).toBe('AMBIGUOUS'); expect(amb.candidates).toContain('Saint-Martin (67426)');
  });
});
