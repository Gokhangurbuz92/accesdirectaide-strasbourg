// @vitest-environment jsdom
/**
 * G14 (local citizen acceptance 22/11/2026, steps 7 and 10): in the narrow accounts scope the server serves citizen/profile and citizen/preferences
 * but answers 503 PUBLIC_BETA_RESTRICTED for the shares list. The profile screen must open (preferences editable) and hide the shares section,
 * instead of showing an error; and the browser must not show the closed-beta page for /compte/profil.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getProfile: vi.fn(), saveProfile: vi.fn(), addMember: vi.fn(), removeMember: vi.fn(), setPreference: vi.fn(), listShares: vi.fn(), claimShare: vi.fn() }));
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api, CitizenApiError: class extends Error { constructor(m, s, c) { super(m); this.status = s; this.code = c; } } }));

import CompteProfil from '../../src/pages/CompteProfil.jsx';
import { isBetaRestrictedPath } from '../../src/lib/publicBeta.js';

const PREFS = { 'email.service': true, 'email.reminder': true, 'email.marketing': false, 'inapp.service': true, 'inapp.reminder': true, 'inapp.marketing': false, 'sms.service': false, 'sms.reminder': false, 'sms.marketing': false, 'push.service': false, 'push.reminder': false, 'push.marketing': false };
const account = { profile: { displayName: null, preferredLanguage: 'fr', ageBand: null, departement: null, accessibilityPrefs: {}, prefillConsent: false }, household: [], preferences: { ...PREFS }, agePolicy: { accountFeatures: 'ALLOWED', allowed: true, status: 'REQUIRES_LEGAL_VALIDATION', publicInformation: 'ALL_AGES' } };
const mount = () => render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(CompteProfil))));

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); });
afterEach(cleanup);

describe('G14 — profile in the narrow accounts scope', () => {
  it('/compte/profil is an open screen of the narrow scope; the other closed account screens stay closed', () => {
    const narrow = { accountsScope: 'booking', proSelfRegistration: false };
    expect(isBetaRestrictedPath('/compte/profil', ['accounts'], narrow)).toBe(false);
    for (const p of ['/compte/parcours', '/compte/coffre', '/compte/messages', '/compte/partages/abc']) expect(isBetaRestrictedPath(p, ['accounts'], narrow), p).toBe(true);
    expect(isBetaRestrictedPath('/compte/profil', [], narrow)).toBe(true);   // the accounts surface itself closed → still closed
  });
  it('the screen opens with editable preferences when the shares list answers 503 PUBLIC_BETA_RESTRICTED', async () => {
    api.getProfile.mockResolvedValue(account);
    const err = Object.assign(new Error('closed'), { status: 503, code: 'PUBLIC_BETA_RESTRICTED' });
    api.listShares.mockRejectedValue(err);
    mount();
    expect(await screen.findByTestId('compte-profil')).toBeInTheDocument();
    expect(screen.getByTestId('pref-email-service')).toBeChecked();
    expect(screen.queryByTestId('shares-empty')).toBeNull();
  });
  it('another error of the shares list is still reported (not silently hidden)', async () => {
    api.getProfile.mockResolvedValue(account);
    api.listShares.mockRejectedValue(Object.assign(new Error('boom'), { status: 500, code: 'INTERNAL' }));
    mount();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
