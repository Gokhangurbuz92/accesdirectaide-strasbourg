// @vitest-environment jsdom
/**
 * A-23 (C04) — the account's stored language is applied to the application once at session start, from the header that every page carries (before: only on
 * /compte/profil). French (the column default) does not override a language chosen in this browser; a language in the address is not overridden; after the first
 * application the language switch stays the person's for the rest of the browser session.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const me = vi.hoisted(() => ({ value: null }));
vi.mock('../../src/api/rdv-messaging-client.js', () => ({ rdvMessagingClient: { authMe: async () => me.value } }));

import i18n, { setLanguage, STORAGE_KEY } from '../../src/i18n/index.js';
import { accountLanguageToApply, applyAccountLanguageOnce, APPLIED_KEY } from '../../src/lib/accountLanguage.js';
import { AuthHeaderActions } from '../../src/components/auth/AuthHeaderActions.jsx';

const header = () => render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, null, createElement(AuthHeaderActions))));
const signedIn = (preferredLanguage, id = 'u1') => ({ session: { kind: 'user', authType: 'user_cookie' }, user: { id, email: 'alex.qa@example.test', preferredLanguage } });

beforeEach(async () => { globalThis.window.sessionStorage.clear(); globalThis.window.localStorage.clear(); globalThis.window.history.replaceState({}, '', '/'); await setLanguage('fr', { persist: false }); });
afterEach(() => { cleanup(); });

describe('A-23 rule (pure)', () => {
  it('a non-French account language applies; the same language, an unknown one or none do nothing', () => {
    expect(accountLanguageToApply({ accountLanguage: 'ar', uiLanguage: 'fr' })).toBe('ar');
    expect(accountLanguageToApply({ accountLanguage: 'ar', uiLanguage: 'en', stored: 'en' })).toBe('ar');
    expect(accountLanguageToApply({ accountLanguage: 'tr', uiLanguage: 'tr' })).toBeNull();
    expect(accountLanguageToApply({ accountLanguage: 'xx', uiLanguage: 'fr' })).toBeNull();
    expect(accountLanguageToApply({ accountLanguage: null, uiLanguage: 'fr' })).toBeNull();
  });
  it('French (the default of a person who never chose) does not override a language chosen in this browser, but applies when none was chosen', () => {
    expect(accountLanguageToApply({ accountLanguage: 'fr', uiLanguage: 'en', stored: 'en' })).toBeNull();
    expect(accountLanguageToApply({ accountLanguage: 'fr', uiLanguage: 'en', stored: null })).toBe('fr');
  });
  it('a language carried by the address is not overridden', () => {
    expect(accountLanguageToApply({ accountLanguage: 'ar', uiLanguage: 'en', fromAddress: 'en' })).toBeNull();
  });
});

describe('A-23 the header applies the account language at session start', () => {
  it('signed in on any page with an Arabic account: the interface switches to Arabic (document lang and direction too)', async () => {
    me.value = signedIn('ar');
    header();
    await waitFor(() => expect(i18n.language).toBe('ar'));
    expect(globalThis.document.documentElement.getAttribute('lang')).toBe('ar');
    expect(globalThis.document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(globalThis.window.sessionStorage.getItem(APPLIED_KEY)).toBe('u1');
  });

  it('once per session: after the person switches language themselves, the header does not put the account language back', async () => {
    me.value = signedIn('de');
    header();
    await waitFor(() => expect(i18n.language).toBe('de'));
    await setLanguage('en');
    cleanup();
    header();                                                    // another page of the same browser session
    await new Promise((r) => setTimeout(r, 30));
    expect(i18n.language).toBe('en');
    expect(await applyAccountLanguageOnce({ id: 'u1', preferredLanguage: 'de' }, 'en')).toBeNull();
    expect(await applyAccountLanguageOnce({ id: 'u2', preferredLanguage: 'uk' }, 'en')).toBe('uk');   // another account signing in: its own language applies
  });

  it('a French account does not switch a visitor who chose English in this browser; a signed-out visitor is never switched', async () => {
    globalThis.window.localStorage.setItem(STORAGE_KEY, 'en'); await setLanguage('en');
    me.value = signedIn('fr');
    header();
    await waitFor(() => expect(globalThis.window.sessionStorage.getItem(APPLIED_KEY)).toBe('u1'));
    expect(i18n.language).toBe('en');
    cleanup(); globalThis.window.sessionStorage.clear();
    me.value = { session: null, user: null };
    header();
    await new Promise((r) => setTimeout(r, 30));
    expect(i18n.language).toBe('en');
    expect(globalThis.window.sessionStorage.getItem(APPLIED_KEY)).toBeNull();
  });
});
