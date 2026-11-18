// @vitest-environment jsdom
/**
 * Visibility audit (2026-11) — the institutional space and the server-side temporary-password gate: a 403 PASSWORD_CHANGE_REQUIRED (observatoire or export)
 * shows the password form, not an error; the tables carry the « Hors périmètre » column and the period sentence its total. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/csrf', () => ({ csrfFetch: (...a) => globalThis.fetch(...a), getCsrfHeaders: () => ({}), ensureCsrfHeaders: async () => ({}) }));

import InstitutionEspace from '../../src/pages/institution/Espace.jsx';

const json = (status, body) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body });
const REQUIRED = { error: 'PASSWORD_CHANGE_REQUIRED', message: 'Choisissez d’abord votre propre mot de passe : le mot de passe provisoire n’ouvre pas les statistiques.' };
const OBS = { window: { from: '2026-07-01', to: '2026-10-01' }, totals: { sent: 23, unmet: 6, outOfScope: null, note: 'somme des cellules publiées seulement' },
  byNeed: [{ need: 'HOUSING', sent: 15, unmet: null, outOfScope: 6 }], byCommune: [{ commune: 'Commune QA', sent: 9, unmet: null, outOfScope: null }],
  methodology: { horsPerimetre: 'serveur', totaux: 'serveur' } };
const space = () => render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(InstitutionEspace))));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); globalThis.sessionStorage.clear(); });

describe('institutional space: the server gate and the out-of-scope indicator', () => {
  beforeEach(() => globalThis.sessionStorage.setItem('institution_token', 'tok'));

  it('403 PASSWORD_CHANGE_REQUIRED on the observatoire: the password form is shown, no error, no statistics', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === '/api/institution/me') return json(200, { organisation: 'QA', territory: 'Bas-Rhin', temporaryPassword: false });   // a stale answer: the server decides
      if (url === '/api/institution/observatoire') return json(403, REQUIRED);
      return json(404, {});
    }));
    space();
    expect(await screen.findByTestId('institution-temporary')).toHaveTextContent('mot de passe provisoire');
    expect(screen.queryByTestId('institution-problem')).toBeNull(); expect(screen.queryByTestId('institution-method')).toBeNull(); expect(screen.queryByText('Télécharger (CSV)')).toBeNull();
  });

  it('the tables show « Hors périmètre » apart from « Refusées faute de capacité » (FA-D9: not « Non couverts »); a 403 PASSWORD_CHANGE_REQUIRED on the export brings the password form', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === '/api/institution/me') return json(200, { organisation: 'QA', territory: 'Bas-Rhin', temporaryPassword: false });
      if (url === '/api/institution/observatoire') return json(200, OBS);
      if (String(url).startsWith('/api/institution/export')) return json(403, REQUIRED);
      return json(404, {});
    }));
    space();
    const byNeed = await screen.findByTestId('institution-by-need');
    expect(within(byNeed).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Besoin', 'Orientations', 'Refusées faute de capacité', 'Hors périmètre']);
    expect(within(byNeed).getAllByRole('cell').map((c) => c.textContent)).toEqual(['15', '< 5', '6']);
    expect(within(screen.getByTestId('institution-by-commune')).getAllByRole('cell').map((c) => c.textContent)).toEqual(['9', '< 5', '< 5']);
    expect(screen.getByText(/orientations refusées faute de capacité : 6 ; orientations hors périmètre : < 5/)).toBeInTheDocument();
    const method = screen.getByTestId('institution-method');
    expect(method).toHaveTextContent('une orientation mal adressée, comptée à part'); expect(method).toHaveTextContent('Aucun total réel n’est publié');
    fireEvent.click(screen.getByText('Télécharger (CSV)'));
    await waitFor(() => expect(screen.getByTestId('institution-temporary')).toBeInTheDocument());
    expect(screen.queryByTestId('institution-problem')).toBeNull(); expect(screen.queryByText('Télécharger (CSV)')).toBeNull();
  });
});
