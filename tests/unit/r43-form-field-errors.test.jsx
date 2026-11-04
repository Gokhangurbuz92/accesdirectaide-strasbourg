// @vitest-environment jsdom
/* global document, window */
/**
 * R43 (A5, RGAA 11.10 / 11.11) — field-level error semantics on the remaining back-office and account forms, with the R42 components (ErrorSummary,
 * FieldError, fieldA11y) and the shared useFormErrors hook:
 *   pro dossier follow-up (Cases: note, orientation, closure), the dossier synthesis review note (ExpertTools, in the shared dossier), the shared dossier's
 *   status save, the catalogue editor, the organisations' activity reason, the institutional sign-in and password forms, « Ma structure » (proposal,
 *   closure), the team invitation, « Rattacher un dossier » (Mon profil), the professional settings' loading and saving states.
 * On a refused submit: nothing is sent, every field in error has aria-invalid and aria-describedby → its own message, the summary (role="alert") is
 * focused and links to the fields; fixing a field removes its error; a save in progress is aria-busy and announced; the messages follow the interface
 * language (Arabic included). jsdom: no layout. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rdv = vi.hoisted(() => ({ proRdvRequest: vi.fn() }));
vi.mock('@/api/pro-rdv-client', () => rdv);
const admin = vi.hoisted(() => ({ apiClient: { admin: { getOrganizations: vi.fn(), setOrganizationActivity: vi.fn(), content: { get: vi.fn(), create: vi.fn(), update: vi.fn() } } } }));
vi.mock('@/api/client', () => admin);
const citizen = vi.hoisted(() => ({ citizenApi: { getProfile: vi.fn(), listShares: vi.fn(), claimShare: vi.fn() } }));
vi.mock('@/lib/citizenApi', () => citizen);
vi.mock('@/components/admin/EntityHistory', () => ({ default: () => null }));
vi.mock('@/components/admin/VerificationPanel', () => ({ default: () => null }));
vi.mock('@/components/account/GuardianLinks', () => ({ default: () => null }));
vi.mock('@/components/DevicePush', () => ({ default: () => null }));
vi.mock('@/components/Messaging/SecureChat', () => ({ default: () => null }));
vi.mock('@/components/FileVault', () => ({ default: () => null }));
const sonner = vi.hoisted(() => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('sonner', () => sonner);

import ProCases from '../../src/pages/pro/Cases.jsx';
import ExpertTools from '../../src/components/ExpertTools.jsx';
import SharedDossier from '../../src/pages/pro/SharedDossier.jsx';
import CatalogueEditor from '../../src/components/admin/CatalogueEditor.jsx';
import AdminOrganizations from '../../src/pages/admin/Organizations.jsx';
import InstitutionEspace from '../../src/pages/institution/Espace.jsx';
import ProStructure from '../../src/pages/pro/Structure.jsx';
import ProTeam from '../../src/pages/pro/Team.jsx';
import CompteProfil from '../../src/pages/CompteProfil.jsx';
import { useFormErrors } from '../../src/components/forms/useFormErrors.js';
import { chooseMessage, httpsUrlMessage, looksLikeHttpsUrl, minLengthMessage, requiredMessage, withoutError } from '../../src/lib/fieldErrors.js';
import { setLanguage } from '../../src/i18n/index.js';
import i18n from '../../src/i18n/index.js';

beforeEach(() => {
  window.localStorage.clear(); window.sessionStorage.clear();
  window.HTMLElement.prototype.scrollIntoView = () => {}; window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.releasePointerCapture = () => {};
});
afterEach(async () => {
  cleanup(); vi.unstubAllGlobals(); rdv.proRdvRequest.mockReset();
  for (const f of [admin.apiClient.admin.getOrganizations, admin.apiClient.admin.setOrganizationActivity, admin.apiClient.admin.content.create, citizen.citizenApi.claimShare]) f.mockReset();
  await act(async () => { await setLanguage('fr', { persist: false }); });
});
const lang = async (code) => { await act(async () => { await setLanguage(code, { persist: false }); }); };
const wrap = (el, path = '/', route = '*') => h(HelmetProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Routes, null, h(Route, { path: route, element: el }))));
const json = (status, body) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body });
const describedText = (el) => (el.getAttribute('aria-describedby') || '').split(' ').map((id) => document.getElementById(id)?.textContent || '').join(' ');
const submitForm = (form) => act(async () => { fireEvent.submit(form); });
/** the R42/R43 contract for one field in error, and a summary focused with a link to it */
function expectFieldError(id, re, summaryTestId) {
  const field = document.getElementById(id);
  expect(field, id).toHaveAttribute('aria-invalid', 'true');
  expect(describedText(field), id).toMatch(re);
  const summary = screen.getByTestId(summaryTestId);
  expect(summary).toHaveAttribute('role', 'alert');
  expect(document.activeElement).toBe(summary);
  const link = summary.querySelector(`a[href="#${id}"]`);
  expect(link, `summary link to ${id}`).not.toBeNull();
  fireEvent.click(link);
  expect(document.activeElement).toBe(field);
}

describe('helpers and hook', () => {
  it('messages name their field; https addresses only; withoutError keeps the others', () => {
    const t = i18n.t.bind(i18n);
    expect(requiredMessage(t, 'Note *')).toBe('Note : ce champ est obligatoire.');
    expect(minLengthMessage(t, 'Motif', 5)).toBe('Motif : saisissez au moins 5 caractères.');
    expect(chooseMessage(t, 'Résultat')).toMatch(/^Résultat : choisissez/);
    expect(httpsUrlMessage(t, 'Adresse 1')).toMatch(/https:\/\//);
    expect(looksLikeHttpsUrl('https://www.service-public.fr/x')).toBe(true);
    for (const v of ['', 'http://exemple.fr', 'www.exemple.fr', 'javascript:alert(1)', 'https://']) expect(looksLikeHttpsUrl(v), v).toBe(false);
    expect(withoutError({ a: '1', b: '2' }, 'a')).toEqual({ b: '2' });
    const same = { a: '1' }; expect(withoutError(same, 'z')).toBe(same);
  });

  it('useFormErrors: check() returns false and focuses the summary only when there is an error', async () => {
    let api;
    function Probe() { api = useFormErrors(); return h('div', { ref: api.summaryRef, tabIndex: -1, 'data-testid': 'probe' }); }
    render(h(Probe));
    let ok; act(() => { ok = api.check({}); }); expect(ok).toBe(true); expect(document.activeElement).not.toBe(screen.getByTestId('probe'));
    act(() => { ok = api.check({ x: 'X' }); }); expect(ok).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('probe')));
    act(() => api.clear('x')); expect(api.errors).toEqual({});
  });
});

describe('pro dossier follow-up (Cases)', () => {
  const CASE = { case: { id: 'c1', dossierId: 'd1234567890', status: 'OPEN', assignee: null }, members: [{ id: 'u1', email: 'a@example.test' }], notes: [], events: [], canAssignOthers: true };
  const setup = () => {
    rdv.proRdvRequest.mockImplementation(async (path, opts = {}) => {
      if (path === '/api/pro/me') return { user: { id: 'u1' } };
      if (path === '/api/pro/cases' && !opts.method) return CASE;
      if (path === '/api/pro/referrals' && opts.query?.box) return { referrals: [] };
      if (path === '/api/pro/referrals' && opts.query?.receivers !== undefined) return { receivers: [{ id: 's9', name: 'Structure vérifiée', city: 'Strasbourg' }] };
      return { ok: true };
    });
    render(wrap(h(ProCases), '/pro/dossiers/c1', '/pro/dossiers/:id'));
  };
  const posts = () => rdv.proRdvRequest.mock.calls.filter(([, o]) => o?.method === 'POST');

  it('note: an empty or one-letter note is refused on the field, nothing is sent; a valid note is sent and announced', async () => {
    setup();
    const form = await screen.findByTestId('pro-case-note-form');
    expect(form).toHaveAttribute('novalidate');
    await submitForm(form);
    expectFieldError('case-note-body', /Note : ce champ est obligatoire/, 'pro-case-note-errors');
    fireEvent.change(document.getElementById('case-note-body'), { target: { value: 'x' } });
    expect(document.getElementById('case-note-body')).not.toHaveAttribute('aria-invalid');
    await submitForm(form);
    expect(describedText(document.getElementById('case-note-body'))).toMatch(/au moins 2 caractères/);
    expect(posts()).toHaveLength(0);
    fireEvent.change(document.getElementById('case-note-body'), { target: { value: 'Appel passé' } });
    await submitForm(form);
    await waitFor(() => expect(screen.getByTestId('pro-case-status-msg')).toHaveTextContent('Note interne ajoutée.'));
    expect(posts()[0][1].body).toMatchObject({ action: 'note', body: 'Appel passé' });
    expect(screen.queryByTestId('pro-case-note-errors')).toBeNull();
  });

  it('orientation: the button is no longer disabled without a reason; the summary says to search first, then to choose a structure and a reason', async () => {
    setup();
    const form = await screen.findByTestId('pro-referral-form');
    expect(screen.getByTestId('pro-referral-propose')).not.toBeDisabled();
    await submitForm(form);
    expectFieldError('case-referral-search', /recherchez une structure vérifiée/, 'pro-referral-errors');
    expect(document.getElementById('case-referral-reason')).toHaveAttribute('aria-invalid', 'true');
    await act(async () => { fireEvent.click(screen.getByTestId('pro-referral-search-btn')); });
    await screen.findByTestId('pro-referral-target');
    await submitForm(form);
    expectFieldError('case-referral-target', /Structure destinataire : choisissez une option/, 'pro-referral-errors');
    expect(posts()).toHaveLength(0);
  });

  it('closure: the outcome is required on the field (the button was disabled until chosen)', async () => {
    setup();
    const form = await screen.findByTestId('pro-case-close-form');
    expect(screen.getByTestId('pro-case-close')).not.toBeDisabled();
    await submitForm(form);
    expectFieldError('case-close-outcome', /Résultat de l’accompagnement : choisissez/, 'pro-case-close-errors');
    expect(posts()).toHaveLength(0);
  });

  it('ar: the messages are in Arabic, the page is right-to-left', async () => {
    await lang('ar');
    setup();
    await submitForm(await screen.findByTestId('pro-case-note-form'));
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('pro-case-note-errors').textContent).not.toMatch(/obligatoire|Corrigez/);
    expect(describedText(document.getElementById('case-note-body'))).toMatch(/[؀-ۿ]/);
  });
});

describe('shared dossier: synthesis review note and status save', () => {
  it('the review note (5 characters, required by the server) is checked first, on the field', async () => {
    const fetchSpy = vi.fn(async (url, o) => (o?.method === 'POST' ? json(200, { ok: true }) : json(200, { drafts: [{ id: 'dr1', status: 'PENDING', model: 'local', points: ['Point'] }] })));
    vi.stubGlobal('fetch', fetchSpy);
    render(wrap(h(ExpertTools, { shareId: 's1', aiAllowed: true })));
    fireEvent.change(await screen.findByLabelText('Ce que vous avez vérifié'), { target: { value: 'ok' } });
    await act(async () => { fireEvent.click(screen.getByTestId('pro-synthesis-approve')); });
    expectFieldError('syn-note-dr1', /Ce que vous avez vérifié : saisissez au moins 5 caractères/, 'pro-synthesis-errors');
    expect(fetchSpy.mock.calls.filter(([, o]) => o?.method === 'POST')).toHaveLength(0);
    fireEvent.change(document.getElementById('syn-note-dr1'), { target: { value: 'Sources relues' } });
    expect(screen.queryByTestId('pro-synthesis-errors')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByTestId('pro-synthesis-reject')); });
    await waitFor(() => expect(screen.getByTestId('pro-synthesis-status')).toHaveTextContent('Brouillon rejeté.'));
  });
});

describe('shared dossier status', () => {
  it('the save is aria-busy and announced in a live region; the confirmation stays until the status changes again', async () => {
    window.localStorage.setItem('pro_token', 't');
    let release; const pending = new Promise((r) => { release = r; });
    vi.stubGlobal('fetch', vi.fn(async (url, o) => {
      if (o?.method === 'PATCH') { await pending; return json(200, { ok: true }); }
      return json(200, { dossier: { id: 's1', situation: {}, results: {} }, documents: [], access: { purposes: [] } });
    }));
    const Ctx = () => h(Outlet, { context: { user: { id: 'u1' } } });
    render(h(HelmetProvider, null, h(MemoryRouter, { initialEntries: ['/pro/dossier/s1'] }, h(Routes, null, h(Route, { path: '/pro', element: h(Ctx) }, h(Route, { path: 'dossier/:shareId', element: h(SharedDossier) }))))));
    const button = await screen.findByRole('button', { name: 'Mettre à jour' });
    const live = screen.getByTestId('dossier-status-saved');
    expect(live).toHaveAttribute('role', 'status');
    await act(async () => { fireEvent.click(button); });
    expect(button.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
    expect(live).toHaveTextContent('Enregistrement en cours…');
    await act(async () => { release(); await pending; });
    await waitFor(() => expect(live).toHaveTextContent('Statut mis à jour'));
    expect(button.closest('[aria-busy]')).toBeNull();
  });
});

describe('catalogue editor', () => {
  const FIELDS = [
    { name: 'titre', label: 'Titre', type: 'text', required: true },
    { name: 'categorie', label: 'Catégorie', type: 'select', options: ['logement'], required: true },
    { name: 'liens', label: 'Liens officiels', type: 'links' },
  ];
  it('required fields are checked per field before anything is sent; the native required stays for the acceptance check', async () => {
    render(wrap(h(CatalogueEditor, { kind: 'dispositif', title: 'Dispositif', fields: FIELDS, listPath: '/admin/dispositifs' }), '/admin/dispositifs/new', '/admin/dispositifs/:id'));
    const form = document.querySelector('form');
    expect(form).toHaveAttribute('novalidate');
    expect(document.getElementById('f-titre')).toBeRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un lien' }));
    fireEvent.change(document.getElementById('f-liens-0-url'), { target: { value: 'http://exemple.fr' } });
    await submitForm(form);
    expectFieldError('f-titre', /Titre : ce champ est obligatoire/, 'admin-editor-errors');
    expect(describedText(document.getElementById('f-categorie'))).toMatch(/Catégorie : choisissez/);
    expect(describedText(document.getElementById('f-liens-0-nom'))).toMatch(/Nom du lien 1 : ce champ est obligatoire/);
    expect(document.getElementById('f-liens-0-url')).not.toHaveAttribute('aria-invalid');   // https is the server's rule (next case)
    expect(screen.getByTestId('admin-editor-errors').querySelectorAll('a')).toHaveLength(3);
    expect(admin.apiClient.admin.content.create).not.toHaveBeenCalled();
  });

  it('an address that is not https: the server refusal stays the banner (admin-editor-problem, native QA DTA-B60) and the address field is marked', async () => {
    admin.apiClient.admin.content.create.mockRejectedValue(Object.assign(new Error('api'), { status: 400, payload: { error: 'INVALID_FIELD', message: 'Valeur invalide pour « liens ».' } }));
    render(wrap(h(CatalogueEditor, { kind: 'dispositif', title: 'Dispositif', fields: FIELDS, listPath: '/admin/dispositifs' }), '/admin/dispositifs/new', '/admin/dispositifs/:id'));
    fireEvent.change(document.getElementById('f-titre'), { target: { value: 'Dispositif fictif' } });
    fireEvent.change(document.getElementById('f-categorie'), { target: { value: 'logement' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un lien' }));
    fireEvent.change(document.getElementById('f-liens-0-nom'), { target: { value: 'Service-Public' } });
    fireEvent.change(document.getElementById('f-liens-0-url'), { target: { value: 'http://example.test/' } });
    await submitForm(document.querySelector('form'));
    expect(admin.apiClient.admin.content.create).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('admin-editor-problem')).toHaveTextContent('Valeur invalide pour « liens »');
    expectFieldError('f-liens-0-url', /https:\/\//, 'admin-editor-errors');
  });
});

describe('organisations: activity reason', () => {
  it('suspending without a reason (5 characters) is refused on the field; with one, the request is sent', async () => {
    admin.apiClient.admin.getOrganizations.mockResolvedValue({ organizations: [{ id: 'o1', nom: 'Org', ville: 'Strasbourg', identity: 'VERIFIED', statut: 'actif', public: { visible: true, reasons: [] }, canReceiveNew: true, activeMembers: 1 }] });
    admin.apiClient.admin.setOrganizationActivity.mockResolvedValue({ ok: true });
    render(wrap(h(AdminOrganizations)));
    await screen.findByTestId('admin-org');
    await act(async () => { fireEvent.click(screen.getByTestId('admin-org-suspend')); });
    expectFieldError('why-o1', /Motif \(conservé dans le journal\) : ce champ est obligatoire/, 'admin-org-errors-o1');
    expect(admin.apiClient.admin.setOrganizationActivity).not.toHaveBeenCalled();
    fireEvent.change(document.getElementById('why-o1'), { target: { value: 'Doublon signalé' } });
    await act(async () => { fireEvent.click(screen.getByTestId('admin-org-suspend')); });
    expect(admin.apiClient.admin.setOrganizationActivity).toHaveBeenCalledWith('o1', 'SUSPEND', 'Doublon signalé');
  });
});

describe('institutional space', () => {
  it('sign-in: empty and malformed fields are said on the field, nothing is sent', async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    render(wrap(h(InstitutionEspace)));
    const form = screen.getByRole('button', { name: 'Se connecter' }).closest('form');
    await submitForm(form);
    expectFieldError('inst-email', /Adresse e-mail : ce champ est obligatoire/, 'institution-login-errors');
    expect(document.getElementById('inst-pass')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(document.getElementById('inst-email'), { target: { value: 'nom@' } });
    await submitForm(form);
    expect(describedText(document.getElementById('inst-email'))).toMatch(/adresse e-mail valide/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('password: each field says its own problem; the password rule stays in the description', async () => {
    window.sessionStorage.setItem('institution_token', 't');
    const fetchSpy = vi.fn(async (url) => (url === '/api/institution/me' ? json(200, { organisation: 'QA', territory: '67', temporaryPassword: true }) : json(404, {})));
    vi.stubGlobal('fetch', fetchSpy);
    render(wrap(h(InstitutionEspace)));
    await screen.findByTestId('institution-temporary');
    const form = screen.getByRole('button', { name: 'Changer le mot de passe' }).closest('form');
    await submitForm(form);
    expectFieldError('pw-cur', /Mot de passe actuel : ce champ est obligatoire/, 'institution-password-errors');
    expect(describedText(document.getElementById('pw-new'))).toMatch(/Au moins 8 caractères.*Nouveau mot de passe : ce champ est obligatoire/);
    fireEvent.change(document.getElementById('pw-cur'), { target: { value: 'Provisoire-1x' } });
    fireEvent.change(document.getElementById('pw-new'), { target: { value: 'Choisi-Par-Moi-21' } });
    fireEvent.change(document.getElementById('pw-again'), { target: { value: 'autre' } });
    await submitForm(form);
    expectFieldError('pw-again', /Les deux saisies du nouveau mot de passe sont différentes/, 'institution-password-errors');
    expect(fetchSpy.mock.calls.filter(([u]) => u === '/api/institution/password')).toHaveLength(0);
  });

  it('a weak password keeps the R21 contract (native QA DTA-B111): the rule message is the banner, the field is invalid, keeps « pw-rule » and has the focus', async () => {
    window.sessionStorage.setItem('institution_token', 't');
    const fetchSpy = vi.fn(async (url) => (url === '/api/institution/me' ? json(200, { organisation: 'QA', territory: '67', temporaryPassword: true }) : json(404, {})));
    vi.stubGlobal('fetch', fetchSpy);
    render(wrap(h(InstitutionEspace)));
    await screen.findByTestId('institution-temporary');
    fireEvent.change(document.getElementById('pw-cur'), { target: { value: 'Provisoire-1x' } });
    fireEvent.change(document.getElementById('pw-new'), { target: { value: 'motdepasse' } });
    fireEvent.change(document.getElementById('pw-again'), { target: { value: 'motdepasse' } });
    await submitForm(screen.getByRole('button', { name: 'Changer le mot de passe' }).closest('form'));
    expect(screen.getByTestId('institution-password-error')).toHaveTextContent(/^Mot de passe trop faible : 1 majuscule requise, 1 chiffre requis\.$/);
    const field = document.getElementById('pw-new');
    expect(field).toHaveAttribute('aria-describedby', 'pw-rule');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: 'Choisi-Par-Moi-21' } });
    expect(field).not.toHaveAttribute('aria-invalid');
    expect(fetchSpy.mock.calls.filter(([u]) => u === '/api/institution/password')).toHaveLength(0);
  });
});

describe('Ma structure', () => {
  it('proposal and closure request: the value and the reason (10 characters) are checked per field', async () => {
    rdv.proRdvRequest.mockResolvedValue({ structure: null, proposals: [], canPropose: true, fields: ['horaires'] });
    const confirmSpy = vi.fn(() => true); vi.stubGlobal('confirm', confirmSpy);
    render(wrap(h(ProStructure)));
    await screen.findByTestId('structure-propose');
    await submitForm(screen.getByTestId('structure-propose').closest('form'));
    expectFieldError('structure-value', /Nouvelle valeur : ce champ est obligatoire/, 'structure-propose-errors');
    fireEvent.change(document.getElementById('structure-closure-reason'), { target: { value: 'court' } });
    await submitForm(screen.getByTestId('structure-closure-request').closest('form'));
    expectFieldError('structure-closure-reason', /Raison de la fermeture : saisissez au moins 10 caractères/, 'structure-closure-errors');
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(rdv.proRdvRequest.mock.calls.filter(([, o]) => o?.method === 'POST')).toHaveLength(0);
  });
});

describe('team invitation', () => {
  it('the address is checked in the dialog; a refusal of the server is said in the dialog, not only in a toast', async () => {
    window.localStorage.setItem('pro_token', 't');
    vi.stubGlobal('fetch', vi.fn(async (url) => (url === '/api/pro/invite' ? json(409, { error: 'Une invitation est déjà en attente pour cette adresse.' }) : url.startsWith('/api/pro/team?') ? json(200, { users: [], invitations: [] }) : json(200, {}))));
    const Ctx = () => h(Outlet, { context: { user: { id: 'u1', role: 'STRUCTURE_ADMIN' } } });
    render(h(HelmetProvider, null, h(MemoryRouter, { initialEntries: ['/pro/team'] }, h(Routes, null, h(Route, { path: '/pro', element: h(Ctx) }, h(Route, { path: 'team', element: h(ProTeam) }))))));
    fireEvent.click(await screen.findByRole('button', { name: /Inviter un collaborateur/ }));
    const email = await screen.findByLabelText('Email');
    fireEvent.change(email, { target: { value: 'pas-une-adresse' } });
    await submitForm(email.closest('form'));
    expectFieldError('invite-email', /Email : saisissez une adresse e-mail valide/, 'team-invite-errors');
    expect(globalThis.fetch.mock.calls.filter(([u]) => u === '/api/pro/invite')).toHaveLength(0);
    fireEvent.change(email, { target: { value: 'nouveau@example.test' } });
    await submitForm(email.closest('form'));
    expect(await screen.findByTestId('team-invite-problem')).toHaveTextContent('Une invitation est déjà en attente');
    // said once (native QA DTA-B99: the toast repeated it and getByText found two elements)
    expect(screen.getAllByText('Une invitation est déjà en attente pour cette adresse.')).toHaveLength(1);
    expect(sonner.toast.error).not.toHaveBeenCalled();
  });
});

describe('Mon profil: attach a dossier', () => {
  it('the two fields say what is missing (the button was disabled without a reason)', async () => {
    citizen.citizenApi.getProfile.mockResolvedValue({ profile: { preferredLanguage: 'fr', accessibilityPrefs: {} }, preferences: [], household: [], agePolicy: { allowed: true } });
    citizen.citizenApi.listShares.mockResolvedValue({ shares: [] });
    render(wrap(h(CompteProfil)));
    const submit = await screen.findByTestId('claim-submit');
    expect(submit).not.toBeDisabled();
    await submitForm(submit.closest('form'));
    expectFieldError('cl-id', /Identifiant du dossier : ce champ est obligatoire/, 'claim-errors');
    expect(document.getElementById('cl-secret')).toHaveAttribute('aria-invalid', 'true');
    expect(citizen.citizenApi.claimShare).not.toHaveBeenCalled();
  });
});
