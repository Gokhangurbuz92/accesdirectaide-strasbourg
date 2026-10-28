// @vitest-environment jsdom
/**
 * R21 (Strasbourg V1, 2026-10-28) — the institutional space: a temporary password is replaced before anything else is shown; « Mon mot de passe » states the
 * shared rule, checks it before sending and announces the result; an ended session says so; « Se déconnecter » ends the sessions on the server; a lost password
 * is asked for through ADA. The professional sign-in page says why a refused session sent the person there and keeps the page asked for. Server side on real
 * PostgreSQL: tests/integration/r21-institution-password-db.test.js. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/csrf', () => ({ csrfFetch: (...a) => globalThis.fetch(...a), getCsrfHeaders: () => ({}), ensureCsrfHeaders: async () => ({}) }));
vi.mock('@/components/NotificationCenter', () => ({ default: () => null }));
vi.mock('@/components/OnboardingTour', () => ({ default: () => null }));

import InstitutionEspace from '../../src/pages/institution/Espace.jsx';
import ProLayout from '../../src/pages/pro/ProLayout.jsx';
import ProLogin from '../../src/pages/pro/Login.jsx';

const json = (status, body) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body });
const OBS = { window: { from: '2026-07-01', to: '2026-10-01' }, totals: { sent: 12, unmet: 3, note: 'n' }, byNeed: [], byCommune: [], methodology: { a: 'Valeurs inférieures à 5 masquées.' } };
const space = () => render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(InstitutionEspace))));
const calls = () => globalThis.fetch.mock.calls.map(([u, o]) => `${(o && o.method) || 'GET'} ${u}`);

afterEach(() => { cleanup(); vi.unstubAllGlobals(); globalThis.sessionStorage.clear(); globalThis.localStorage.clear(); });

describe('R21 institutional space: password and session', () => {
  beforeEach(() => globalThis.sessionStorage.setItem('institution_token', 'old'));

  it('a temporary password: only the password form is shown; weak and mismatched entries are refused before sending; the change opens the statistics', async () => {
    let temporary = true;
    vi.stubGlobal('fetch', vi.fn(async (url, o) => {
      if (url === '/api/institution/me') return json(200, { organisation: 'QA Collectivité', territory: 'Bas-Rhin', email: 'p@example.test', temporaryPassword: temporary });
      if (url === '/api/institution/observatoire') return json(200, OBS);
      if (url === '/api/institution/password') { temporary = false; expect(JSON.parse(o.body)).toEqual({ currentPassword: 'Provisoire-1x', newPassword: 'Choisi-Par-Moi-21' }); return json(200, { token: 'new', message: 'Mot de passe modifié. Vos autres sessions ont été fermées.' }); }
      return json(404, {});
    }));
    space();
    expect(await screen.findByTestId('institution-temporary')).toHaveTextContent('mot de passe provisoire');
    expect(screen.queryByTestId('institution-method')).toBeNull(); expect(screen.queryByText('Télécharger (CSV)')).toBeNull();
    const nouveau = screen.getByLabelText('Nouveau mot de passe');
    expect(nouveau).toHaveAttribute('autocomplete', 'new-password'); expect(nouveau).toHaveAccessibleDescription('Au moins 8 caractères, dont une majuscule, une minuscule et un chiffre.');
    expect(screen.getByLabelText('Mot de passe actuel')).toHaveAttribute('autocomplete', 'current-password');
    fireEvent.change(screen.getByLabelText('Mot de passe actuel'), { target: { value: 'Provisoire-1x' } });
    fireEvent.change(nouveau, { target: { value: 'motdepasse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Changer le mot de passe' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mot de passe trop faible : 1 majuscule requise, 1 chiffre requis.');
    fireEvent.change(nouveau, { target: { value: 'Choisi-Par-Moi-21' } });
    fireEvent.change(screen.getByLabelText('Confirmer le nouveau mot de passe'), { target: { value: 'Choisi-Par-Moi-22' } });
    fireEvent.click(screen.getByRole('button', { name: 'Changer le mot de passe' }));
    expect(await screen.findByText('Les deux saisies du nouveau mot de passe sont différentes.')).toBeInTheDocument();
    expect(calls()).not.toContain('POST /api/institution/password');
    fireEvent.change(screen.getByLabelText('Confirmer le nouveau mot de passe'), { target: { value: 'Choisi-Par-Moi-21' } });
    fireEvent.click(screen.getByRole('button', { name: 'Changer le mot de passe' }));
    expect(await screen.findByTestId('institution-method')).toHaveTextContent('inférieures à 5');
    expect(globalThis.sessionStorage.getItem('institution_token')).toBe('new');
    expect(screen.getByRole('heading', { name: 'Mon mot de passe' })).toBeInTheDocument();
  });

  it('a wrong current password is said in French; an ended session sends back to the sign-in and says why', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === '/api/institution/me') return json(200, { organisation: 'QA', territory: 'Bas-Rhin', temporaryPassword: false });
      if (url === '/api/institution/observatoire') return json(200, OBS);
      if (url === '/api/institution/password') return json(400, { error: 'WRONG_CURRENT_PASSWORD', message: 'Le mot de passe actuel est incorrect.' });
      if (url.startsWith('/api/institution/export')) return json(401, { error: 'Unauthorized' });
      return json(404, {});
    }));
    space();
    await screen.findByTestId('institution-method');
    fireEvent.change(screen.getByLabelText('Mot de passe actuel'), { target: { value: 'Faux-Mot-1' } });
    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: 'Choisi-Par-Moi-21' } });
    fireEvent.change(screen.getByLabelText('Confirmer le nouveau mot de passe'), { target: { value: 'Choisi-Par-Moi-21' } });
    fireEvent.click(screen.getByRole('button', { name: 'Changer le mot de passe' }));
    expect(await screen.findByTestId('institution-password-error')).toHaveTextContent('Le mot de passe actuel est incorrect.');
    fireEvent.click(screen.getByRole('button', { name: 'Télécharger (CSV)' }));
    expect(await screen.findByTestId('institution-notice')).toHaveTextContent('Votre session a pris fin');
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeInTheDocument();
    expect(globalThis.sessionStorage.getItem('institution_token')).toBeNull();
  });

  it('« Se déconnecter » ends the sessions on the server; the sign-in page says how to recover a lost password', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === '/api/institution/me') return json(200, { organisation: 'QA', territory: 'Bas-Rhin', temporaryPassword: false });
      if (url === '/api/institution/observatoire') return json(200, OBS);
      if (url === '/api/institution/logout') return json(200, { ok: true });
      return json(404, {});
    }));
    space();
    await screen.findByTestId('institution-method');
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(await screen.findByTestId('institution-notice')).toHaveTextContent('Vous êtes déconnecté sur tous vos appareils.');
    expect(calls()).toContain('POST /api/institution/logout');
    expect(screen.getByTestId('institution-forgot')).toHaveTextContent('un administrateur vous remet un mot de passe provisoire');
    expect(screen.getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '/contact');
  });
});

describe('R21 professional sign-in after a refused session', () => {
  const Where = () => { const l = useLocation(); return createElement('p', { 'data-testid': 'where' }, l.pathname + l.search); };
  it('a refused session on a deep page goes to the sign-in with the page kept, and the sign-in says the session ended', async () => {
    globalThis.localStorage.setItem('pro_token', 'revoked');
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'Unauthorized' })));
    render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: ['/pro/audit'] }, createElement(Routes, null,
      createElement(Route, { path: '/pro', element: createElement(ProLayout) }, createElement(Route, { path: 'audit', element: createElement('p', null, 'Journal') })),
      createElement(Route, { path: '/pro/login', element: createElement('div', null, createElement(Where), createElement(ProLogin)) })))));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/pro/login?next=%2Fpro%2Faudit'));
    expect(screen.getByTestId('pro-session-ended')).toHaveTextContent('Votre session a pris fin');
    expect(globalThis.localStorage.getItem('pro_token')).toBeNull();
  });
  it('a plain visit to the sign-in shows no such message', () => {
    render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: ['/pro/login'] }, createElement(ProLogin))));
    expect(screen.queryByTestId('pro-session-ended')).toBeNull();
  });
});
