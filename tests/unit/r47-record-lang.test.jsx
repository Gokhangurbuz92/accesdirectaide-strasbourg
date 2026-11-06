// @vitest-environment jsdom
/**
 * R47 langfr — RGAA 8.7 / WCAG 3.1.2 (language of parts): French record text (names, titles, towns, the server's French notes) carries lang="fr" (and
 * dir="ltr", so it keeps its direction on an Arabic page) when the interface is not French, nothing on a French page, and nothing when the text shown is a
 * checked translation. The helper (src/lib/recordLang.js), the RecordText element, and two screens that list records: the administrator catalogue list
 * and the organisations list, in French, English and Arabic.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/admin/VerificationPanel', () => ({ default: () => null }));
vi.mock('@/api/client', () => ({
  apiClient: { admin: {
    content: { list: vi.fn(async () => ({ items: [{ id: 'a1', label: 'Aide synthétique au logement', categorie: 'Logement', statut: 'publie', verification_status: 'VERIFIED', updatedAt: '2026-10-01T10:00:00Z' }] })) },
    getOrganizations: vi.fn(async () => ({ organizations: [{ id: 'o1', nom: 'Centre social fictif', ville: 'Sélestat', identity: 'VERIFIED', statut: 'actif', public: { visible: true, reasons: [] }, canReceiveNew: true, activeMembers: 2 }] })),
  } },
}));
import { frAttrs, FR_ATTRS } from '../../src/lib/recordLang.js';
import RecordText from '../../src/components/i18n/RecordText.jsx';
import CatalogueList from '../../src/components/admin/CatalogueList.jsx';
import AdminOrganizations from '../../src/pages/admin/Organizations.jsx';
import { setLanguage } from '../../src/i18n/index.js';

afterEach(async () => { cleanup(); await act(async () => { await setLanguage('fr', { persist: false }); }); });
const lang = async (/** @type {string} */ code) => { await act(async () => { await setLanguage(code, { persist: false }); }); };

describe('frAttrs', () => {
  it('nothing on a French page (fr, fr-FR, missing code)', () => {
    expect(frAttrs('fr')).toEqual({}); expect(frAttrs('fr-FR')).toEqual({}); expect(frAttrs(undefined)).toEqual({}); expect(frAttrs(null)).toEqual({});
  });
  it('lang="fr" dir="ltr" in every other interface language, the right-to-left one included', () => {
    for (const c of ['en', 'tr', 'ar', 'de', 'uk']) expect(frAttrs(c)).toEqual({ lang: 'fr', dir: 'ltr' });
    expect(frAttrs('ar')).toBe(FR_ATTRS);
  });
  it('nothing when the text shown is a checked translation (it is then in the interface language)', () => {
    expect(frAttrs('en', { translated: true })).toEqual({}); expect(frAttrs('ar', { translated: true })).toEqual({});
    expect(frAttrs('en', { translated: false })).toEqual({ lang: 'fr', dir: 'ltr' });
  });
  it('a frozen object: a caller cannot change it for the others', () => { expect(Object.isFrozen(frAttrs('en'))).toBe(true); expect(Object.isFrozen(frAttrs('fr'))).toBe(true); });
});

describe('RecordText', () => {
  it('French page: a plain span, same text', () => {
    render(h(RecordText, { 'data-testid': 'rt' }, 'Maison des solidarités'));
    const el = screen.getByTestId('rt'); expect(el.tagName).toBe('SPAN'); expect(el).toHaveTextContent('Maison des solidarités'); expect(el).not.toHaveAttribute('lang'); expect(el).not.toHaveAttribute('dir');
  });
  it('Arabic page: lang="fr" dir="ltr"; translated text: no mark; a chosen element', async () => {
    await lang('ar');
    render(h('div', null, h(RecordText, { 'data-testid': 'rt' }, 'Maison des solidarités'), h(RecordText, { 'data-testid': 'tr', translated: true }, 'House of solidarity'), h(RecordText, { as: 'p', 'data-testid': 'p' }, 'Sélestat')));
    expect(screen.getByTestId('rt')).toHaveAttribute('lang', 'fr'); expect(screen.getByTestId('rt')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByTestId('tr')).not.toHaveAttribute('lang');
    expect(screen.getByTestId('p').tagName).toBe('P'); expect(screen.getByTestId('p')).toHaveAttribute('lang', 'fr');
  });
});

const catalogue = () => h(MemoryRouter, null, h(CatalogueList, { kind: 'aide', title: 'Aides', published: 'publie', newPath: '/admin/aides/new', editPath: (/** @type {string} */ id) => `/admin/aides/${id}`, createLabel: 'Créer' }));
const organisations = () => h(MemoryRouter, null, h(AdminOrganizations));

describe('administrator catalogue list', () => {
  it('French: the record title and category carry no lang mark (the page is French)', async () => {
    render(catalogue());
    const title = await screen.findByText('Aide synthétique au logement'); expect(title).not.toHaveAttribute('lang');
    expect(screen.getByText('Logement')).not.toHaveAttribute('lang');
  });
  it('English: the record title and category are marked French, the interface text around them is not', async () => {
    await lang('en'); render(catalogue());
    const title = await screen.findByText('Aide synthétique au logement'); expect(title).toHaveAttribute('lang', 'fr'); expect(title).toHaveAttribute('dir', 'ltr');
    const cat = screen.getByText('Logement'); expect(cat).toHaveAttribute('lang', 'fr');
    expect(cat.parentElement).not.toHaveAttribute('lang');   // « modified on … » is in the interface language
    expect(cat.parentElement?.textContent).toMatch(/^Logement — /);   // same visible text as before
  });
  it('Arabic: marked French and left-to-right inside the right-to-left page', async () => {
    await lang('ar'); render(catalogue());
    const title = await screen.findByText('Aide synthétique au logement'); expect(title).toHaveAttribute('lang', 'fr'); expect(title).toHaveAttribute('dir', 'ltr');
  });
});

describe('administrator organisations list', () => {
  it('English: the structure name and its town are marked French', async () => {
    await lang('en'); render(organisations());
    const name = await screen.findByText('Centre social fictif'); expect(name).toHaveAttribute('lang', 'fr');
    expect(screen.getByText('Sélestat')).toHaveAttribute('lang', 'fr');
    expect(name.closest('p')).toHaveTextContent('Centre social fictif — Sélestat');
  });
  it('Arabic: marked French, left-to-right; French page: no mark', async () => {
    await lang('ar'); render(organisations());
    const name = await screen.findByText('Centre social fictif'); expect(name).toHaveAttribute('lang', 'fr'); expect(name).toHaveAttribute('dir', 'ltr');
    cleanup(); await lang('fr'); render(organisations());
    expect(await screen.findByText('Centre social fictif')).not.toHaveAttribute('lang');
  });
});
