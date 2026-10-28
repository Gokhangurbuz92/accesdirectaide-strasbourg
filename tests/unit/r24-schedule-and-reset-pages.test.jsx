// @vitest-environment jsdom
/**
 * R24 (owner decisions R18.5 and R21.1, 2026-10-28) — the screens:
 *   - Absences: a member records their own absence (no choice offered, the request carries no scope) and sees a colleague's absence without edit buttons;
 *     a schedule manager chooses « toute la structure », « moi-même » or a colleague; a refusal (403) is said in French.
 *   - Disponibilités: read-only for a member (no save, no add, no remove), editable for a schedule manager.
 *   - Institutional « mot de passe oublié » and the reset page: the answer announced, the token read from the fragment and removed from the address bar,
 *     the shared rule and the mismatch refused before sending, ADA's hand-over as fallback.
 * Server side on real PostgreSQL: tests/integration/r24-schedule-permissions-db.test.js and r24-institution-reset-db.test.js. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/csrf', () => ({ csrfFetch: (...a) => globalThis.fetch(...a), getCsrfHeaders: () => ({}), ensureCsrfHeaders: async () => ({}) }));

import ProRdvAbsences from '../../src/pages/pro/RdvAbsences.jsx';
import Availability from '../../src/pages/pro/Availability.jsx';
import { InstitutionForgot, InstitutionReset } from '../../src/pages/institution/Recuperation.jsx';

const json = (status, body) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const mount = (el, path = '/') => render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [path] }, el)));
const bodies = (path) => globalThis.fetch.mock.calls.filter(([u, o]) => String(u).startsWith(path) && o && o.method === 'POST').map(([, o]) => JSON.parse(o.body));
const ITEM = (o) => ({ id: 'a1', structureId: 's', startAt: '2026-11-10T08:00:00.000Z', endAt: '2026-11-10T12:00:00.000Z', reason: 'Formation', ...o });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); globalThis.localStorage.clear(); });

describe('R24 absences and opening hours (owner decision R18.5)', () => {
  beforeEach(() => globalThis.localStorage.setItem('pro_token', 'qa-token'));
  it('a member records their own absence and sees a colleague\'s without edit buttons', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, o) => {
      if (String(url).startsWith('/api/pro/timeoff') && (!o || !o.method || o.method === 'GET')) return json(200, { items: [ITEM({ scope: 'member', memberEmail: 'anna@example.test', mine: false, canEdit: false })], canManageOthers: false, members: [] });
      if (String(url).startsWith('/api/pro/timeoff')) return json(201, { ok: true, item: ITEM({ id: 'a2' }), overlappingAppointments: [] });
      return json(404, {});
    }));
    mount(createElement(ProRdvAbsences));
    expect(await screen.findByText('Absence de anna@example.test')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Modifier/ })).toBeNull(); expect(screen.queryByRole('button', { name: /Supprimer/ })).toBeNull();
    expect(screen.queryByTestId('pro-timeoff-target'), 'no choice for an ordinary member').toBeNull();
    expect(screen.getByTestId('pro-timeoff-scope-help')).toHaveTextContent('votre propre absence');
    fireEvent.change(screen.getByLabelText('Début'), { target: { value: '2026-11-12T09:00' } });
    fireEvent.change(screen.getByLabelText('Fin', { exact: true }), { target: { value: '2026-11-12T12:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    await waitFor(() => expect(bodies('/api/pro/timeoff')).toHaveLength(1));
    expect(bodies('/api/pro/timeoff')[0]).not.toHaveProperty('scope'); expect(bodies('/api/pro/timeoff')[0]).not.toHaveProperty('proUserId');
  });

  it('a schedule manager chooses whom the absence concerns; a refusal is said', async () => {
    let status = 201;
    vi.stubGlobal('fetch', vi.fn(async (url, o) => {
      if (String(url).startsWith('/api/pro/timeoff') && (!o || !o.method || o.method === 'GET')) return json(200, { items: [ITEM({ scope: 'structure', mine: false, canEdit: true })], canManageOthers: true, members: [{ id: 'u-anna', email: 'anna@example.test' }] });
      if (String(url).startsWith('/api/pro/timeoff')) return status === 201 ? json(201, { ok: true, item: ITEM({ id: 'a3' }), overlappingAppointments: [] }) : json(403, { error: 'x' });
      return json(404, {});
    }));
    mount(createElement(ProRdvAbsences));
    expect(await screen.findByText('Fermeture de toute la structure')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Supprimer/ })).toBeInTheDocument();
    const target = screen.getByLabelText('Concerne');
    expect([...target.querySelectorAll('option')].map((x) => x.textContent)).toEqual(['Toute la structure (fermeture : plus de créneaux en ligne)', 'Moi-même', 'anna@example.test']);
    fireEvent.change(target, { target: { value: 'u-anna' } });
    fireEvent.change(screen.getByLabelText('Début'), { target: { value: '2026-11-12T09:00' } });
    fireEvent.change(screen.getByLabelText('Fin', { exact: true }), { target: { value: '2026-11-12T12:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    await waitFor(() => expect(bodies('/api/pro/timeoff')).toHaveLength(1));
    expect(bodies('/api/pro/timeoff')[0]).toMatchObject({ scope: 'member', proUserId: 'u-anna' });
    status = 403; fireEvent.change(screen.getByLabelText('Concerne'), { target: { value: 'structure' } });
    fireEvent.change(screen.getByLabelText('Début'), { target: { value: '2026-11-13T09:00' } });
    fireEvent.change(screen.getByLabelText('Fin', { exact: true }), { target: { value: '2026-11-13T12:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(await screen.findByTestId('pro-timeoff-error')).toHaveTextContent('Seuls l’administrateur ou un membre désigné');
    expect(bodies('/api/pro/timeoff')[1]).toMatchObject({ scope: 'structure' });
  });

  it('opening hours: read-only for a member, editable for a schedule manager', async () => {
    let canEdit = false;
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { rules: [], slots_json: { mon: ['09:00-12:00'] }, timezone: 'Europe/Paris', canEdit })));
    mount(createElement(Availability));
    expect(await screen.findByTestId('availability-readonly')).toHaveTextContent('lecture seule');
    expect(screen.queryByTestId('availability-save')).toBeNull(); expect(screen.queryByRole('button', { name: /Ajouter une plage/ })).toBeNull();
    expect(screen.getByLabelText('Lundi, plage 1 (HH:MM-HH:MM)')).toHaveAttribute('readonly');
    cleanup(); canEdit = true;
    mount(createElement(Availability));
    expect(await screen.findByTestId('availability-save')).toBeInTheDocument(); expect(screen.queryByTestId('availability-readonly')).toBeNull();
  });
});

describe('R24 institutional self-service reset (owner decision R21.1)', () => {
  it('« mot de passe oublié » announces the neutral answer and keeps ADA\'s hand-over as fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { emailDelivery: 'SENT_IF_VALID', message: 'Si un compte institutionnel actif correspond à cette adresse, un lien valable 30 minutes vient de lui être envoyé.' })));
    mount(createElement(InstitutionForgot));
    expect(screen.getByTestId('institution-forgot-fallback')).toHaveTextContent('un administrateur vous remet un mot de passe provisoire');
    fireEvent.click(screen.getByRole('button', { name: 'Recevoir un lien' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Indiquez l’adresse e-mail'); expect(globalThis.fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'partenaire@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Recevoir un lien' }));
    await waitFor(() => expect(screen.getByTestId('institution-forgot-done')).toHaveTextContent('vient de lui être envoyé'));
    expect(screen.getByTestId('institution-forgot-done')).toHaveAttribute('role', 'status');
    expect(bodies('/api/institution/forgot')).toEqual([{ email: 'partenaire@example.test' }]);
  });

  it('the reset page reads the token from the fragment, removes it from the address bar, refuses a weak or mismatched password before sending', async () => {
    const token = 'a'.repeat(64);
    const replace = vi.spyOn(globalThis.history, "replaceState");
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { ok: true, message: 'Mot de passe enregistré. Toutes vos sessions ont été fermées : connectez-vous avec le nouveau mot de passe.' })));
    mount(createElement(InstitutionReset), `/institution/reinitialiser#token=${token}`);
    await waitFor(() => expect(replace).toHaveBeenCalled());
    const pw = screen.getByLabelText('Nouveau mot de passe'); expect(pw).toHaveAccessibleDescription('Au moins 8 caractères, dont une majuscule, une minuscule et un chiffre.');
    fireEvent.change(pw, { target: { value: 'motdepasse' } }); fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mot de passe trop faible');
    fireEvent.change(pw, { target: { value: 'Choisi-Par-Lien-24' } }); fireEvent.change(screen.getByLabelText('Confirmer le nouveau mot de passe'), { target: { value: 'Autre-Chose-24' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('différentes'); expect(globalThis.fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Confirmer le nouveau mot de passe'), { target: { value: 'Choisi-Par-Lien-24' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }));
    expect(await screen.findByTestId('institution-reset-login')).toBeInTheDocument();
    expect(bodies('/api/institution/reset')).toEqual([{ token, password: 'Choisi-Par-Lien-24' }]);
    replace.mockRestore();
  });

  it('a link without its token says so', async () => {
    vi.stubGlobal('fetch', vi.fn());
    mount(createElement(InstitutionReset), '/institution/reinitialiser');
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce lien est incomplet');
  });
});
