// @vitest-environment jsdom
/**
 * Release 3 (owner approval 24/11/2026: « değişiklik hesap sahiplerine Mon Espace bildirimiyle duyurulur ») — the one-time Mon Espace notice that the
 * citizen terms changed. Shown only when the build puts cgu-citoyen v13-2026-11-24 in force (VITE_LEGAL_DOCS_APPROVED_VERSION), never for a draft;
 * links to both documents; dismissible once per version (localStorage, storage failure tolerated); RGAA: labelled region, real links and button,
 * focus moved after dismissal, no axe violation; six languages.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TermsChangeNotice from '../../src/components/account/TermsChangeNotice.jsx';
import { TERMS_CHANGE_NOTICES, termsChangeStorageKey, termsChangeVersion } from '../../src/lib/termsChange.js';
import { LEGAL_DRAFTS_R3_CGU } from '../../src/config/legal-drafts.js';

const R2 = 'cgu-citoyen@v12-2026-11-23,notice-confidentialite@v13-2026-11-23,cgu-professionnel@v10-2026-11-23,conditions-structures@v9-2026-11-23';
const R3 = 'cgu-citoyen@v13-2026-11-24,notice-confidentialite@v14-2026-11-24,cgu-professionnel@v11-2026-11-24,conditions-structures@v9-2026-11-23';
const mount = (/** @type {any} */ props) => render(createElement(MemoryRouter, null, createElement(TermsChangeNotice, props)));

beforeEach(() => { globalThis.localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Mon Espace — notice of the citizen terms change (release 3)', () => {
  it('covers cgu-citoyen v13-2026-11-24 and only versions the build puts in force', () => {
    expect(Object.keys(TERMS_CHANGE_NOTICES)).toEqual([LEGAL_DRAFTS_R3_CGU]);
    expect(termsChangeVersion({ approved: R3 })).toBe('v13-2026-11-24');
    expect(termsChangeVersion({ approved: R2 })).toBeNull();
    expect(termsChangeVersion({ approved: '' })).toBeNull();
  });
  it('hidden while the release-2 terms (or none) are in force', () => {
    mount({ approved: R2 }); expect(screen.queryByTestId('terms-change-notice')).toBeNull(); cleanup();
    mount({ approved: '' }); expect(screen.queryByTestId('terms-change-notice')).toBeNull();
  });
  it('shown once v13 is in force: a labelled region with the date and links to both documents, no axe violation', async () => {
    const { container } = mount({ approved: R3 });
    const region = screen.getByRole('region', { name: 'Nos conditions d’utilisation ont changé' });
    expect(region).toHaveTextContent(/en vigueur depuis le 24 novembre 2026/);
    expect(screen.getByRole('link', { name: 'Lire les conditions d’utilisation' })).toHaveAttribute('href', '/cgu/citoyen');
    expect(screen.getByRole('link', { name: 'Lire la notice de confidentialité' })).toHaveAttribute('href', '/confidentialite/notice');
    expect(screen.queryByRole('alert')).toBeNull();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
  it('« J’ai compris » hides it for that version, moves the focus, and it stays hidden on the next visit', () => {
    const focus = vi.fn();
    mount({ approved: R3, focusAfterDismiss: focus });
    fireEvent.click(screen.getByRole('button', { name: 'J’ai compris' }));
    expect(screen.queryByTestId('terms-change-notice')).toBeNull();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(globalThis.localStorage.getItem(termsChangeStorageKey('v13-2026-11-24'))).toBe('1');
    cleanup(); mount({ approved: R3 });
    expect(screen.queryByTestId('terms-change-notice')).toBeNull();
  });
  it('a blocked storage never breaks the page: the notice shows and can still be dismissed for the visit', () => {
    vi.spyOn(globalThis.Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(globalThis.Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    mount({ approved: R3 });
    fireEvent.click(screen.getByTestId('terms-change-dismiss'));
    expect(screen.queryByTestId('terms-change-notice')).toBeNull();
  });
  it('six languages: the five keys exist in en, de, tr, ar, uk and keep the {{date}} placeholder', () => {
    for (const lang of ['en', 'de', 'tr', 'ar', 'uk']) {
      const loc = JSON.parse(readFileSync(`src/i18n/locales/${lang}/compte.json`, 'utf8'));
      for (const k of ['title', 'body', 'link_cgu', 'link_notice', 'dismiss']) expect(loc[`terms_change.${k}`], `${lang} ${k}`).toBeTypeOf('string');
      expect(loc['terms_change.body'], lang).toContain('{{date}}');
    }
  });
  it('Mon Espace renders the notice under its heading', () => {
    const src = readFileSync('src/pages/MonEspace.jsx', 'utf8');
    expect(src).toMatch(/<TermsChangeNotice focusAfterDismiss=\{\(\) => headingRef\.current\?\.focus\(\)\} \/>/);
    expect(src).toMatch(/<h1 ref=\{headingRef\} tabIndex=\{-1\}/);
  });
});
