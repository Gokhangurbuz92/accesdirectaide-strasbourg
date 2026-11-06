// @vitest-environment jsdom
/* global window, document */
/**
 * R47 quality — the defects of the whole-product crawl (e2e-r47/quality) fixed in shared helpers: dates and times in the interface language on the Paris
 * clock, the password rule and the server's not-found sentences in the interface language (French unchanged), the pilot vocabulary and the feature flags
 * translated by code, the profile no longer forcing French on a visitor who chose another language.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import i18n, { setLanguage, formatDateTime, formatTime, formatDate, DATE_SHORT, STORAGE_KEY } from '../../src/i18n/index.js';
import { PASSWORD_RULE, passwordMessage, passwordProblems } from '../../src/lib/passwordPolicy.js';
import { passwordRuleText, passwordMessageText } from '../../src/lib/passwordPolicyText.js';
import { serverText } from '../../src/lib/serverText.js';
import { translatedVocab, pilotKind, pilotReason } from '../../src/pages/admin/k5/pilotVocab.js';

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await setLanguage('fr'); });
const t = (/** @type {string} */ k, /** @type {string} */ d, /** @type {any} */ o) => i18n.t(k, d, o);

describe('R47 dates on the Paris clock, in the interface language', () => {
  it('French keeps the former « fr-FR » forms, other languages their own', async () => {
    const at = '2026-07-10T14:00:00Z';   // 16:00 in Strasbourg (summer time), whatever the computer's zone
    expect(formatDateTime(at)).toBe('10/07/2026 16:00');
    expect(formatTime(at)).toBe('16:00');
    expect(formatDate(at, DATE_SHORT)).toBe('10/07/2026');
    await setLanguage('de');
    expect(formatDateTime(at)).toBe('10.07.2026, 16:00');
    expect(formatDate(at, { day: 'numeric', month: 'long', year: 'numeric' })).toBe('10. Juli 2026');
    expect(formatDateTime(at, undefined, 'fr')).toBe('10/07/2026 16:00');   // the French exports (CSV) keep French
    expect(formatDateTime('not a date')).toBe('');
  });
});

describe('R47 password rule and server sentences', () => {
  it('French is the shared rule, word for word; English is translated', async () => {
    expect(passwordRuleText()).toBe(PASSWORD_RULE);
    expect(passwordMessageText(passwordProblems('abc'))).toBe(passwordMessage(passwordProblems('abc')));
    await setLanguage('en');
    expect(passwordRuleText()).toBe('At least 8 characters, including an upper-case letter, a lower-case letter and a digit.');
    expect(passwordMessageText(['1 chiffre requis'])).toBe('Password too weak: 1 digit required.');
  });
  it('a server sentence is unchanged in French, translated or replaced by the fallback elsewhere', async () => {
    expect(serverText('Conversation introuvable', 'x')).toBe('Conversation introuvable');
    expect(serverText('', 'Repli')).toBe('Repli');
    await setLanguage('uk');
    expect(serverText('Dossier introuvable.', 'x')).toBe('Справу не знайдено.');
    expect(serverText('Ce dossier est introuvable ou n’est pas rattaché à votre compte.')).toBe('Цю справу не знайдено або вона не пов’язана з вашим обліковим записом.');
    expect(serverText('Une phrase inconnue du serveur.', 'Fallback')).toBe('Fallback');
    expect(serverText('Une phrase inconnue du serveur.')).toBe('Une phrase inconnue du serveur.');   // no fallback: nothing is hidden
  });
});

describe('R47 pilot vocabulary by code', () => {
  it('known codes are translated, unknown ones keep the server label; French unchanged', async () => {
    const vocab = { outcomes: { REUSSI: 'Réussi sans aide', NOUVEAU: 'Libellé serveur' }, issues: { TAILLE_TEXTE: 'Taille du texte' } };
    expect(translatedVocab(vocab, t)).toEqual(vocab);
    await setLanguage('tr');
    const v = translatedVocab(vocab, t);
    expect(v.outcomes).toEqual({ REUSSI: 'Yardımsız başarıldı', NOUVEAU: 'Libellé serveur' });
    expect(v.issues.TAILLE_TEXTE).toBe('Metin boyutu');
    expect(pilotKind(t, 'structure', 'Lieux d’accueil')).toBe('Danışma yerleri');
    expect(pilotReason(t, 2, 5, 'x')).toBe('5 oturumdan az: sonuçlar yayımlanmadı');
    expect(pilotReason(t, 0, 5, 'x')).toBe('oturum yok');
  });
});

describe('R47 the profile keeps the language the visitor chose', () => {
  const profile = (preferredLanguage) => ({ profile: { displayName: null, preferredLanguage, ageBand: null, departement: null, accessibilityPrefs: {}, prefillConsent: false }, household: [], preferences: {}, agePolicy: { accountFeatures: 'ALLOWED', allowed: true } });
  const open = async (preferredLanguage) => {
    const api = await import('../../src/lib/citizenApi.js');
    vi.spyOn(api.citizenApi, 'getProfile').mockResolvedValue(profile(preferredLanguage));
    vi.spyOn(api.citizenApi, 'listShares').mockResolvedValue({ shares: [] });
    const { default: CompteProfil } = await import('../../src/pages/CompteProfil.jsx');
    render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(CompteProfil))));
    await waitFor(() => expect(api.citizenApi.getProfile).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
  };
  it('an account at the default « fr » does not switch an Arabic visitor back to French', async () => {
    await setLanguage('ar');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('ar');
    await open('fr');
    expect(i18n.language).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });
  it('a non-French account language still applies (R35)', async () => {
    await setLanguage('en');
    await open('de');
    await waitFor(() => expect(i18n.language).toBe('de'));
    expect(screen.getAllByRole('heading', { level: 1 }).length).toBe(1);
  });
});

describe('R47 professional breadcrumb', () => {
  const crumbs = async (path) => {
    const { default: ProBreadcrumb } = await import('../../src/components/ProBreadcrumb.jsx');
    render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(ProBreadcrumb)));
    return screen.getByRole('navigation');
  };
  it('names the agenda sub-pages in the interface language (no raw « Disponibilites »)', async () => {
    await setLanguage('en');
    const nav = await crumbs('/pro/rdv/disponibilites');
    expect(nav.textContent).toContain('Availability');
    expect(nav.textContent).not.toContain('Disponibilites');
  });
  it('never links a section that has no page of its own', async () => {
    const nav = await crumbs('/pro/attestation/abc');
    expect([...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'))).not.toContain('/pro/attestation');
    expect(nav.textContent).toContain('Récapitulatif officiel');
  });
});
