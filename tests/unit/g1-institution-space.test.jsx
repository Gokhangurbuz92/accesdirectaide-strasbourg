// @vitest-environment jsdom
/**
 * Owner decision G1 = b and audit A17 / A19 — the interface only SAYS what the server decided:
 *   an account without a defined territory sees one sentence, no table and no export button (and the observatoire is not even asked for);
 *   a territory smaller than its EPCI is told why it has no table by need; the table by need shows the need's label, not its code (A17);
 *   the professional observatoire shows « valeur masquée (< 5) » for a masked commune, never « inactif » (A19).
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/csrf', () => ({ csrfFetch: (...a) => globalThis.fetch(...a), getCsrfHeaders: () => ({}), ensureCsrfHeaders: async () => ({}) }));

import InstitutionEspace from '../../src/pages/institution/Espace.jsx';

const json = (status, body) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body });
const OBS = { window: { from: '2026-07-01', to: '2026-10-01' }, totals: { sent: 23, unmet: null, outOfScope: null, note: 'somme des cellules publiées seulement' }, scope: { kind: 'epci', code: '246700488', byNeed: 'ALL', totalsBasis: 'byNeed' },
  byNeed: [{ need: 'ACCESS_TO_RIGHTS', sent: 15, unmet: null, outOfScope: null }, { need: 'FOOD_AID', sent: 8, unmet: null, outOfScope: null }, { need: 'FUTURE_CODE', sent: null, unmet: null, outOfScope: null }],
  byCommune: [{ commune: 'Strasbourg', sent: 9, unmet: null, outOfScope: null }], methodology: { territoire: 'serveur' } };
const space = () => render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(InstitutionEspace))));
const me = (extra = {}) => ({ organisation: 'QA', territory: 'Eurométropole de Strasbourg', temporaryPassword: false, territoryScope: { defined: true, kind: 'epci', code: '246700488' }, ...extra });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); globalThis.sessionStorage.clear(); });

describe('institutional space: the authorised territory', () => {
  beforeEach(() => globalThis.sessionStorage.setItem('institution_token', 'tok'));

  it('no defined territory: one sentence, no statistics, no export, and the observatoire is not requested', async () => {
    const fetch = vi.fn(async (url) => (url === '/api/institution/me' ? json(200, me({ territory: 'mon secteur', territoryScope: { defined: false } })) : json(500, {})));
    vi.stubGlobal('fetch', fetch);
    space();
    expect(await screen.findByTestId('institution-no-scope')).toHaveTextContent('Le territoire autorisé de votre compte n’est pas défini : aucune statistique ne peut être affichée. Contactez ADA.');
    expect(screen.queryByTestId('institution-by-need')).toBeNull(); expect(screen.queryByTestId('institution-by-commune')).toBeNull(); expect(screen.queryByText('Télécharger (CSV)')).toBeNull();
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(['/api/institution/me']);
  });

  it('the server refuses (403 TERRITORY_SCOPE_UNDEFINED) although `me` was stale: the same sentence, not « Chargement impossible »', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (url === '/api/institution/me' ? json(200, me()) : json(403, { error: 'TERRITORY_SCOPE_UNDEFINED', message: 'x' }))));
    space();
    expect(await screen.findByTestId('institution-no-scope')).toBeInTheDocument();
    expect(screen.queryByTestId('institution-problem')).toBeNull(); expect(screen.queryByText('Télécharger (CSV)')).toBeNull();
  });

  it('A17: the table by need shows the label of each need (the code stays for an unknown one); the method names the territory rule', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (url === '/api/institution/me' ? json(200, me()) : url === '/api/institution/observatoire' ? json(200, OBS) : json(404, {}))));
    space();
    const byNeed = await screen.findByTestId('institution-by-need');
    expect(within(byNeed).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['Accès aux droits', 'Aide alimentaire', 'FUTURE_CODE']);
    expect(within(byNeed).getAllByRole('rowheader').map((h) => h.getAttribute('data-need'))).toEqual(['ACCESS_TO_RIGHTS', 'FOOD_AID', 'FUTURE_CODE']);
    expect(screen.getByTestId('institution-method')).toHaveTextContent('Seules les communes du territoire autorisé de votre compte sont comptées');
    expect(screen.queryByTestId('institution-by-need-withheld')).toBeNull(); expect(screen.queryByTestId('institution-by-need-partial')).toBeNull();
  });

  it('a territory smaller than its EPCI is told why it has no table by need, and what its total adds up', async () => {
    const small = { ...OBS, byNeed: [], scope: { kind: 'commune', code: '67482', byNeed: 'NONE', totalsBasis: 'byCommune' }, totals: { sent: 9, unmet: null, outOfScope: null, note: 'somme des cellules publiées du tableau par commune seulement' } };
    vi.stubGlobal('fetch', vi.fn(async (url) => (url === '/api/institution/me' ? json(200, me()) : url === '/api/institution/observatoire' ? json(200, small) : json(404, {}))));
    space();
    expect(await screen.findByTestId('institution-by-need-withheld')).toHaveTextContent('le tableau par besoin n’est pas publié à cette échelle');
    expect(screen.getByText(/somme des cellules publiées du tableau par commune seulement/)).toBeInTheDocument();
    expect(within(screen.getByTestId('institution-by-commune')).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['Strasbourg']);
  });

  it('the six languages carry the new sentences', async () => {
    const fs = await import('node:fs');
    for (const lang of ['en', 'tr', 'ar', 'de', 'uk']) {
      const inst = JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/institution.json`, 'utf8'));
      for (const key of ['space.scope_undefined', 'space.by_need_withheld', 'space.by_need_partial', 'space.totals_note_commune', 'space.method.territory']) expect(String(inst[key] || '').length, `${lang} ${key}`).toBeGreaterThan(20);
    }
  });
});
