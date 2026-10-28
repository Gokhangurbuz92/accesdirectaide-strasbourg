// @vitest-environment jsdom
/**
 * PKG-1 — screens: the account profile (K0), the honest empty-state resources and the D-5 "demonstration content" label.
 * citizenApi is mocked at the module boundary: this proves the screen behaviour (what is shown, what is sent, what is refused client-side), not the server rules (see tests/integration/pkg1-account-core-db.test.js).
 */
/* global document */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getProfile: vi.fn(), saveProfile: vi.fn(), addMember: vi.fn(), removeMember: vi.fn(), setPreference: vi.fn(), listShares: vi.fn(), claimShare: vi.fn() }));
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api, CitizenApiError: class extends Error { constructor(m, s, c) { super(m); this.status = s; this.code = c; } } }));

import CompteProfil from '../../src/pages/CompteProfil.jsx';
import OfficialResourcesNotice from '../../src/components/OfficialResourcesNotice.jsx';
import ProvenanceFreshness from '../../src/components/ProvenanceFreshness.jsx';

const PREFS = { 'email.service': true, 'email.reminder': true, 'email.marketing': false, 'inapp.service': true, 'inapp.reminder': true, 'inapp.marketing': false, 'sms.service': false, 'sms.reminder': false, 'sms.marketing': false, 'push.service': false, 'push.reminder': false, 'push.marketing': false };
const account = (o = {}) => ({ profile: { displayName: null, preferredLanguage: 'fr', ageBand: null, departement: null, accessibilityPrefs: {}, prefillConsent: false }, household: [], preferences: { ...PREFS }, agePolicy: { accountFeatures: 'ALLOWED', allowed: true, status: 'REQUIRES_LEGAL_VALIDATION', publicInformation: 'ALL_AGES' }, ...o });
const mount = () => render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(CompteProfil))));

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); api.listShares.mockResolvedValue({ shares: [] }); });
afterEach(cleanup);

describe('CompteProfil', () => {
  it('shows safe defaults: SMS, push and marketing are off; the household and dossier lists say they are empty', async () => {
    api.getProfile.mockResolvedValue(account());
    mount();
    expect(await screen.findByTestId('compte-profil')).toBeInTheDocument();
    expect(screen.getByTestId('pref-sms-service')).not.toBeChecked();
    expect(screen.queryByTestId('pref-push-reminder')).toBeNull();   // launch-readiness item 59: web push does not exist, so it is not offered
    expect(screen.getByTestId('pref-email-marketing')).not.toBeChecked();
    expect(screen.getByTestId('pref-email-service')).toBeChecked();
    expect(screen.getByTestId('household-empty')).toBeInTheDocument();
    expect(screen.getByTestId('shares-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('age-policy-notice')).toBeNull();
  });
  it('enabling SMS without the separate consent is refused on screen and nothing is sent', async () => {
    api.getProfile.mockResolvedValue(account());
    mount();
    fireEvent.click(await screen.findByTestId('pref-sms-service'));
    expect(await screen.findByTestId('profil-error')).toHaveTextContent('Cochez d’abord');
    expect(api.setPreference).not.toHaveBeenCalled();
  });
  it('with the consent ticked, SMS is sent with consentGiven:true; switching an option off never asks for consent', async () => {
    api.getProfile.mockResolvedValue(account());
    api.setPreference.mockResolvedValue({ preferences: { ...PREFS, 'sms.service': true } });
    mount();
    fireEvent.click(await screen.findByTestId('consent-sms-service'));
    fireEvent.click(screen.getByTestId('pref-sms-service'));
    await waitFor(() => expect(api.setPreference).toHaveBeenCalledWith({ channel: 'sms', category: 'service', enabled: true, consentGiven: true }));
    api.setPreference.mockClear();
    fireEvent.click(screen.getByTestId('pref-email-reminder'));
    await waitFor(() => expect(api.setPreference).toHaveBeenCalledWith({ channel: 'email', category: 'reminder', enabled: false, consentGiven: undefined }));
  });
  it('a pending age policy is explained without blocking public information', async () => {
    api.getProfile.mockResolvedValue(account({ agePolicy: { accountFeatures: 'POLICY_PENDING', allowed: false, status: 'REQUIRES_LEGAL_VALIDATION', publicInformation: 'ALL_AGES' } }));
    mount();
    expect(await screen.findByTestId('age-policy-notice')).toHaveTextContent('accessibles à tout âge');
    expect(screen.getByTestId('age-policy-notice')).toHaveTextContent('déclarative');
  });
  it('saves the declared age BAND (never a birth date) and the optional fields', async () => {
    api.getProfile.mockResolvedValue(account());
    api.saveProfile.mockResolvedValue({});
    mount();
    fireEvent.change(await screen.findByTestId('pf-name'), { target: { value: ' Alex ' } });
    fireEvent.change(screen.getByTestId('pf-band'), { target: { value: '25-59' } });
    fireEvent.change(screen.getByTestId('pf-dep'), { target: { value: '67' } });
    fireEvent.click(screen.getByTestId('profil-save'));
    await waitFor(() => expect(api.saveProfile).toHaveBeenCalledTimes(1));
    const sent = api.saveProfile.mock.calls[0][0];
    expect(sent).toMatchObject({ displayName: 'Alex', ageBand: '25-59', departement: '67', prefillConsent: false });
    expect(Object.keys(sent).join()).not.toMatch(/birth|naissance/i);
    expect(await screen.findByTestId('profil-status')).toHaveTextContent('Profil enregistré');
  });
  it('a server refusal is shown with its own message and the screen stays in place', async () => {
    api.getProfile.mockResolvedValue(account());
    api.addMember.mockRejectedValue(Object.assign(new Error('Un foyer compte au plus 12 personnes.'), { status: 409 }));
    mount();
    fireEvent.click(await screen.findByTestId('household-add'));
    expect(await screen.findByTestId('profil-error')).toHaveTextContent('au plus 12 personnes');
    expect(screen.getByTestId('compte-profil')).toBeInTheDocument();   // no unmount/flash: focus and form state survive an action
  });
  it('an expired session shows a sign-in path instead of an empty profile', async () => {
    api.getProfile.mockRejectedValue(Object.assign(new Error('x'), { status: 401 }));
    mount();
    expect(await screen.findByTestId('compte-profil-error')).toHaveTextContent('Connectez-vous');
    expect(screen.getByRole('link', { name: 'Se connecter' })).toHaveAttribute('href', '/login');
    expect(screen.getByTestId('profil-retry')).toBeInTheDocument();
  });
  it('attached dossiers link to their management page', async () => {
    api.getProfile.mockResolvedValue(account());
    api.listShares.mockResolvedValue({ shares: [{ id: 'share-1', createdAt: '2026-10-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z', expired: false, activeOrganizations: 1 }] });
    mount();
    expect(await screen.findByTestId('share-manage')).toHaveAttribute('href', '/compte/partages/share-1');
  });
});

describe('D-5 honest empty state and demonstration label', () => {
  it('OfficialResourcesNotice points to the official portals and invents no record', () => {
    render(createElement(OfficialResourcesNotice));
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['https://www.service-public.fr', 'https://www.caf.fr', 'https://www.francetravail.fr', 'https://www.ameli.fr']));
    expect(screen.getByTestId('official-resources-notice')).toHaveTextContent('Seules les informations vérifiées sont publiées');
    for (const a of screen.getAllByRole('link').filter((x) => x.getAttribute('href').startsWith('https://'))) expect(a).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
  it('a lab fixture is labelled as demonstration content and is never shown as up to date', () => {
    render(createElement(ProvenanceFreshness, { provenance: { contentStatus: 'LAB_UNVERIFIED', verifiedAt: null, sourceUrl: null } }));
    expect(screen.getByTestId('content-status-lab')).toHaveTextContent('Contenu de démonstration');
    expect(document.body.textContent).not.toMatch(/À jour/);
  });
  it('a verified record shows no demonstration notice', () => {
    render(createElement(ProvenanceFreshness, { provenance: { contentStatus: 'VERIFIED', verifiedAt: new Date(Date.now() - 5 * 86400000).toISOString(), sourceUrl: 'https://www.service-public.fr/x' } }));
    expect(screen.queryByTestId('content-status-lab')).toBeNull();
    expect(screen.getByTestId('freshness-badge')).toHaveTextContent('À jour');
  });
});
