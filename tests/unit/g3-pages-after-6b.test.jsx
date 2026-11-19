// @vitest-environment jsdom
/**
 * 19/11/2026 (campaign G3) — after the 6B opening the live /cgu said « La création de compte … ne sont pas encore ouvertes » and /impact said « aucun compte
 * n'est ouvert » (both checked in the browser 19/11). With accounts open the CGU states the adult-only account rule as in force (appointments still planned)
 * and /impact keeps « a created account is not a person helped »; with accounts closed both texts are unchanged. Six locales carry the new keys.
 */
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
const show = async (page, open) => {
  if (open !== undefined) vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', open);
  vi.resetModules();
  const Page = (await import(`../../src/pages/${page}.jsx`)).default;
  const { container } = render(createElement(HelmetProvider, null, createElement(MemoryRouter, null, createElement(Page))));
  return container.textContent;
};

describe('CGU and Impact follow the accounts opening', () => {
  it('accounts closed: the planned wording is unchanged', async () => {
    const cgu = await show('CGU', '');
    expect(cgu).toContain('La création de compte et la prise de rendez-vous ne sont pas encore ouvertes');
    cleanup();
    const impact = await show('Impact', '');
    expect(impact).toContain('aucun compte n’est ouvert');
  });
  it('accounts open (6B): no « not open » claim about accounts; appointments still planned; an account is not a person helped', async () => {
    const cgu = await show('CGU', 'admin,accounts');
    expect(cgu).not.toContain('La création de compte et la prise de rendez-vous ne sont pas encore ouvertes');
    expect(cgu).toContain('Les personnes majeures peuvent créer un compte personnel');
    expect(cgu).toContain('La prise de rendez-vous n\'est pas encore ouverte');
    cleanup();
    const impact = await show('Impact', 'admin,accounts');
    expect(impact).not.toContain('aucun compte n’est ouvert');
    expect(impact).toContain('un compte créé n’est pas une personne aidée');
  });
  it('the two new keys exist in the five translated locales', () => {
    for (const lang of ['en', 'de', 'tr', 'ar', 'uk']) {
      const legal = JSON.parse(readFileSync(resolve(process.cwd(), `src/i18n/locales/${lang}/legal.json`), 'utf8'));
      const about = JSON.parse(readFileSync(resolve(process.cwd(), `src/i18n/locales/${lang}/about.json`), 'utf8'));
      expect(legal['terms.service.accountsOpen'], lang).toBeTruthy(); expect(about['impact.not_measured.text_accounts'], lang).toBeTruthy();
    }
  });
});
