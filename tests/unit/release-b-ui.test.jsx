// @vitest-environment jsdom
/* global document, Node */
/**
 * Release B (D2 V2) — interface: the sign-up says, right above « Créer mon compte », that creating the account accepts the linked terms of use; the notice
 * is information, not an agreement; nothing is sent before the person presses the button; the body then carries termsAccepted: true together with the
 * adult declaration; the sign-in never sends it; the wording never calls it a consent. Settings: while phone collection is closed no phone field is offered;
 * a stored number can only be removed.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { setPhone, getProfile, saveProfile } = vi.hoisted(() => ({
  setPhone: vi.fn(async () => ({ ok: true, phone: null })),
  getProfile: vi.fn(),
  saveProfile: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../src/lib/citizenApi.js', async (orig) => { const m = await orig(); return { ...m, citizenApi: { ...m.citizenApi, setPhone, getProfile, saveProfile, listShares: async () => ({ shares: [] }) } }; });
import AuthRdvAccess from '../../src/pages/AuthRdvAccess.jsx';
import { ContactChange } from '../../src/pages/CompteParametres.jsx';
import CompteProfil from '../../src/pages/CompteProfil.jsx';
import { setLanguage } from '../../src/i18n/index.js';

const lang = async (code) => { await act(async () => { await setLanguage(code, { persist: false }); }); };
let calls;
beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => { calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null }); return { ok: true, status: 200, json: async () => ({ ok: true, message: 'ok' }), headers: { get: () => null } }; }));
});
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); await lang('fr'); });
const authPage = (mode) => render(h(HelmetProvider, null, h(MemoryRouter, { initialEntries: [`/auth/${mode}?next=/compte`] }, h('main', null, h(AuthRdvAccess, { mode })))));
const signupPosts = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/api/auth/signup'));

describe('Release B — sign-up: acceptance of the terms by a clear action', () => {
  it('shows the terms sentence with its link right above the button, and the notice as information; the button is described by it', () => {
    authPage('signup');
    const box = screen.getByTestId('auth-terms-statement');
    expect(box).toHaveTextContent('En créant mon compte, j’accepte les conditions d’utilisation.');
    expect(within(box).getByRole('link', { name: 'conditions d’utilisation' })).toHaveAttribute('href', '/cgu/citoyen');
    expect(within(box).getByRole('link', { name: 'notice de confidentialité' })).toHaveAttribute('href', '/confidentialite/notice');
    expect(box.textContent).not.toMatch(/consen/i);   // a contract acceptance and an information — never called a consent
    const button = screen.getByRole('button', { name: 'Créer mon compte' });
    expect(button).toHaveAttribute('aria-describedby', 'auth-terms');
    // the sentence comes before the button in the reading order
    expect(box.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('nothing is sent before the person presses the button; then the body carries termsAccepted: true with the adult declaration', async () => {
    authPage('signup');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nom@exemple.fr' } });
    fireEvent.change(screen.getByLabelText('Mot de passe', { exact: true }), { target: { value: 'Qa-Passw0rd-1' } });
    fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), { target: { value: 'Qa-Passw0rd-1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'J’ai 18 ans ou plus' }));
    expect(signupPosts(), 'no request before the button').toEqual([]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' })); });
    const posts = signupPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({ email: 'nom@exemple.fr', adultDeclaration: true, termsAccepted: true });
    expect(posts[0].body.phone, 'no phone is ever sent by the form').toBeUndefined();
  });

  it('the sign-in shows no terms sentence and never sends termsAccepted', async () => {
    authPage('login');
    expect(screen.queryByTestId('auth-terms-statement')).toBeNull();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nom@exemple.fr' } });
    fireEvent.change(screen.getByLabelText('Mot de passe', { exact: true }), { target: { value: 'Qa-Passw0rd-1' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Se connecter' })); });
    for (const c of calls.filter((x) => x.method === 'POST')) expect(c.body?.termsAccepted).toBeUndefined();
  });

  it.each(['en', 'tr', 'ar', 'de', 'uk'])('%s: the terms sentence is translated and keeps its two links', async (code) => {
    await lang(code);
    authPage('signup');
    const box = screen.getByTestId('auth-terms-statement');
    expect(box.textContent).not.toContain('En créant mon compte');
    expect(within(box).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/cgu/citoyen', '/confidentialite/notice']);
  });
});

describe('Release B — settings: no phone field while its collection is closed', () => {
  const settings = (user) => render(h(HelmetProvider, null, h(MemoryRouter, null, h(ContactChange, { user }))));
  it('closed and no number stored: no phone field at all', () => {
    settings({ email: 'nom@exemple.fr', phone: null, phoneCollection: false });
    expect(screen.queryByRole('textbox', { name: /Numéro/ })).toBeNull();
    expect(document.querySelector('#cc-phone')).toBeNull();
    expect(screen.queryByTestId('cc-phone-submit')).toBeNull();
    expect(screen.queryByTestId('cc-phone-closed')).toBeNull();
  });
  it('closed with a number stored earlier: only its removal is offered', async () => {
    settings({ email: 'nom@exemple.fr', phone: '0611111111', phoneCollection: false });
    expect(document.querySelector('#cc-phone')).toBeNull();
    expect(screen.getByTestId('cc-phone-closed')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByTestId('cc-phone-remove')); });
    expect(setPhone).toHaveBeenCalledTimes(1); expect(setPhone).toHaveBeenCalledWith(null);   // removal only — no new number can be entered
  });
  it('open (LAB): the field is offered as before', () => {
    settings({ email: 'nom@exemple.fr', phone: null, phoneCollection: true });
    expect(document.querySelector('#cc-phone')).not.toBeNull();
  });
});

describe('Release B — profile: no age band or département in the narrow V2 scope', () => {
  const account = (collect) => ({ profile: { displayName: 'Personne fictive', preferredLanguage: 'fr', ageBand: null, departement: null, accessibilityPrefs: {}, prefillConsent: false },
    household: [], preferences: [], collect, agePolicy: { accountFeatures: true, allowed: true, status: 'CONFIGURED', publicInformation: 'ALL_AGES', adultAccount: true } });
  const page = () => render(h(HelmetProvider, null, h(MemoryRouter, null, h(CompteProfil))));
  it('closed: neither field is offered, the accessibility settings are; saving sends neither field', async () => {
    getProfile.mockResolvedValue(account({ ageBand: false, departement: false, phone: false }));
    page();
    expect(await screen.findByTestId('pf-falc')).toBeInTheDocument();
    expect(screen.queryByTestId('pf-band')).toBeNull();
    expect(screen.queryByTestId('pf-dep')).toBeNull();
    const form = screen.getByTestId('pf-falc').closest('form');
    await act(async () => { fireEvent.submit(form); });
    expect(saveProfile).toHaveBeenCalled();
    const body = saveProfile.mock.calls.at(-1)[0];
    expect(body).not.toHaveProperty('ageBand'); expect(body).not.toHaveProperty('departement');
    expect(body.accessibilityPrefs).toBeTruthy();
  });
  it('open (LAB): both fields are offered as before', async () => {
    getProfile.mockResolvedValue(account({ ageBand: true, departement: true, phone: true }));
    page();
    expect(await screen.findByTestId('pf-band')).toBeInTheDocument();
    expect(screen.getByTestId('pf-dep')).toBeInTheDocument();
  });
});
