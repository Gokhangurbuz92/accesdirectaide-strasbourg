// @vitest-environment jsdom
/* global document */
/**
 * VIS — no dead end without a person to ask. HumanHelpBlock (France services, CCAS, mairie: official locators, no phone number, no promise) is shown on
 * an empty search, the empty lists of aides, démarches and lieux, the not-found pages (page, record, guide, unknown address) and the withdrawn page.
 * A record that cannot be shown says so honestly (« elle n'existe pas, ou elle est en cours de vérification ») and offers search and the list by need.
 * In another interface language, « Votre situation » says that its detailed advice is French official text. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import axe from 'axe-core';
import { cleanup, render, screen, within } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const S = vi.hoisted(() => ({ structureFilter: async () => ({ data: [], pagination: { total: 0, page: 1, totalPages: 0 } }) }));
vi.mock('@/lib/searchClient', async (orig) => ({ ...(await orig()), searchAides: vi.fn(async () => ({ results: [], meta: { total: 0, totalAll: 0, message: null } })) }));
vi.mock('@/hooks/useCitizenHistory', () => ({ default: () => () => {} }));
vi.mock('../../src/lib/hooks/useAidesListing.ts', () => ({ useAidesListing: () => ({ status: 'success', items: [], pagination: { total: 0, page: 1, totalPages: 0 }, facets: {}, errorMessage: null, refetch: vi.fn() }) }));
vi.mock('../../src/api/client', () => ({ client: { taxonomy: { get: async () => ({}) }, entities: { Structure: { filter: (...a) => S.structureFilter(...a) } } } }));
vi.mock('@vercel/analytics', () => ({ track: vi.fn() }));

import { setLanguage } from '../../src/i18n/index.js';
import HumanHelpBlock, { HUMAN_HELP_URLS, HUMAN_HELP_DIRECTORY } from '../../src/components/HumanHelpBlock.jsx';
import OrientationPanel from '../../src/components/search/OrientationPanel.jsx';
import NotFound from '../../src/pages/NotFound.jsx';
import Gone from '../../src/pages/Gone.jsx';
import ServiceError from '../../src/pages/ServiceError.jsx';
import Recherche from '../../src/pages/Recherche.jsx';
import Aides from '../../src/pages/Aides.jsx';
import Annuaire from '../../src/pages/Annuaire.jsx';
import StructureDetail from '../../src/pages/StructureDetail.jsx';

afterEach(async () => { cleanup(); await setLanguage('fr'); S.structureFilter = async () => ({ data: [], pagination: { total: 0, page: 1, totalPages: 0 } }); });
const page = (el, path = '/') => render(h(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
  h(HelmetProvider, null, h(MemoryRouter, { initialEntries: [path] }, el))));
const block = () => screen.getByTestId('human-help-block');
const LANGS = ['en', 'tr', 'ar', 'de', 'uk'];
const KEYS = ['humanHelp.title', 'humanHelp.text', 'humanHelp.franceServices', 'humanHelp.ccas', 'humanHelp.mairie', 'humanHelp.directory'];

describe('HumanHelpBlock', () => {
  it('a titled region with the three official locators (new window, named) and the site directory filtered on France services', () => {
    page(h(HumanHelpBlock));
    const region = screen.getByRole('region', { name: 'Parler à une personne' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Parler à une personne' })).toBeInTheDocument();
    expect(region).toHaveTextContent('Vous pouvez demander de l’aide sur place : dans une France services, au CCAS ou à la mairie de votre commune.');
    const links = within(region).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([HUMAN_HELP_URLS.franceServices, HUMAN_HELP_URLS.ccas, HUMAN_HELP_URLS.mairie, HUMAN_HELP_DIRECTORY]);
    expect(HUMAN_HELP_DIRECTORY).toBe('/structures?type=france_services');
    for (const a of links.slice(0, 3)) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a.getAttribute('rel')).toMatch(/noopener/);
      expect(a).toHaveAccessibleName(/^Trouver .+\(nouvelle fenêtre\)$/);
    }
    expect(links[3]).toHaveAccessibleName('Voir les France services dans notre annuaire');
    expect(links[3]).not.toHaveAttribute('target');
  });
  it('only official hosts, no phone number, no promise of a result', () => {
    for (const u of Object.values(HUMAN_HELP_URLS)) expect(new URL(u).hostname).toMatch(/^(www\.france-services\.gouv\.fr|lannuaire\.service-public\.gouv\.fr)$/);
    const { container } = page(h(HumanHelpBlock));
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(container.textContent).not.toMatch(/\d{2}[ .]?\d{2}[ .]?\d{2}/);
    expect(container.textContent).not.toMatch(/vous avez droit|vous obtiendrez|garanti/i);
  });
  it('heading level 3 on request; no directory link on the directory’s own France services list; a second block has its own id', () => {
    page(h('div', null, h(HumanHelpBlock, { headingLevel: 3, directoryLink: false }), h(HumanHelpBlock, { id: 'other' })));
    const [first, second] = screen.getAllByTestId('human-help-block');
    expect(within(first).getByRole('heading', { level: 3 })).toBeInTheDocument();
    expect(within(first).getAllByRole('link')).toHaveLength(3);
    expect(first.getAttribute('aria-labelledby')).not.toBe(second.getAttribute('aria-labelledby'));
  });
  it('axe clean', async () => {
    const { container } = page(h('main', null, h('h1', null, 'Page'), h(HumanHelpBlock)));
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
  it('is translated in the five other languages (the names of the services stay French); logical alignment for Arabic', async () => {
    for (const lang of LANGS) {
      const dict = JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/shared.json`, 'utf8'));
      for (const k of KEYS) expect(dict[k], `${lang} ${k}`).toBeTruthy();
      expect(dict['humanHelp.text']).toMatch(/France.services/);
      expect(dict['humanHelp.text']).toMatch(/CCAS/);
      await setLanguage(lang);
      page(h(HumanHelpBlock));
      expect(screen.getByRole('heading', { level: 2, name: dict['humanHelp.title'] })).toBeInTheDocument();
      expect(block()).toHaveTextContent(dict['humanHelp.text']);
      cleanup();
    }
    await setLanguage('ar');
    page(h(HumanHelpBlock));
    expect(document.documentElement.dir).toBe('rtl');
    expect(block().className).toMatch(/\btext-start\b/);
    expect(block().className).not.toMatch(/\btext-(left|right)\b|\b[mp][lr]-/);
  });
});

describe('not-found and withdrawn pages', () => {
  it('page not found: title kept, search, list by need, aides, home, and a person to ask', () => {
    page(h(NotFound));
    expect(screen.getByRole('heading', { level: 1, name: 'Page introuvable' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Chercher sur le site' })).toHaveAttribute('href', '/recherche');
    expect(screen.getByRole('link', { name: 'Voir la liste par besoin' })).toHaveAttribute('href', '/besoins');
    expect(screen.getByRole('link', { name: "Retour à l'accueil" })).toBeInTheDocument();
    expect(block()).toBeInTheDocument();
  });
  it('record not available: one honest sentence for « unknown » and « being checked », nothing about the record, the same next steps', () => {
    page(h(NotFound, { kind: 'record' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Fiche non disponible' })).toBeInTheDocument();
    expect(screen.getByTestId('record-not-available')).toHaveTextContent("Cette fiche n'est pas disponible pour le moment. Elle n'existe pas, ou elle est en cours de vérification.");
    expect(screen.getByRole('link', { name: 'Chercher sur le site' })).toHaveAttribute('href', '/recherche');
    expect(screen.getByRole('link', { name: 'Voir la liste par besoin' })).toHaveAttribute('href', '/besoins');
    expect(block()).toBeInTheDocument();
  });
  it('a record page whose API answers 404 shows « Fiche non disponible » with the person to ask', async () => {
    S.structureFilter = async () => { const e = new Error('API Error: 404'); e.status = 404; throw e; };
    page(h(Routes, null, h(Route, { path: '/structures/:slug', element: h(StructureDetail) })), '/structures/ccas-inconnu');
    expect(await screen.findByRole('heading', { level: 1, name: 'Fiche non disponible' })).toBeInTheDocument();
    expect(block()).toBeInTheDocument();
  });
  it('every record page uses the record variant', () => {
    for (const f of ['AideDetail', 'DemarcheDetail', 'DispositifDetail', 'StructureDetail', 'RessourceDetail']) {
      const src = fs.readFileSync(`src/pages/${f}.jsx`, 'utf8');
      expect(src, f).toMatch(/<NotFound kind="record" \/>/);
      expect(src, f).not.toMatch(/<NotFound \/>/);
    }
    expect(fs.readFileSync('src/pages/GuideDetail.jsx', 'utf8')).toMatch(/<HumanHelpBlock \/>/);
    expect(fs.readFileSync('src/pages/Demarches.jsx', 'utf8')).toMatch(/<HumanHelpBlock \/>/);
  });
  it('withdrawn content: French defaults with their accents, next steps and a person to ask', () => {
    page(h(Gone));
    expect(screen.getByRole('heading', { level: 1, name: 'Contenu retiré' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: "Retour à l'accueil" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Chercher sur le site' })).toHaveAttribute('href', '/recherche');
    expect(block()).toBeInTheDocument();
    const src = fs.readFileSync('src/pages/Gone.jsx', 'utf8');
    expect(src).not.toMatch(/Contenu retire'|a ete retire|Retour a l'accueil/);
    expect(src).toMatch(/Ce contenu a été retiré et n'est plus disponible\./);
  });
  it('unknown address (404): a person to ask; a technical error keeps its own page', () => {
    page(h(ServiceError, { code: 404 }));
    expect(within(screen.getByTestId('page-not-found')).getByTestId('human-help-block')).toBeInTheDocument();
    cleanup();
    page(h(ServiceError, { code: 500 }));
    expect(screen.queryByTestId('human-help-block')).toBeNull();
  });
  it('axe clean on the two pages', async () => {
    for (const el of [h(NotFound, { kind: 'record' }), h(Gone)]) {
      const { container } = page(h('main', null, el));
      const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
      expect(r.violations.map((v) => v.id)).toEqual([]);
      cleanup();
    }
  });
});

describe('empty results', () => {
  it('search with no result: the person to ask, even when no need was recognised', async () => {
    page(h(Recherche), '/recherche?q=zzqxw');
    await screen.findByTestId('search-empty-state');
    expect(screen.queryByTestId('search-orientation')).toBeNull();
    expect(block()).toBeInTheDocument();
  });
  it('aides: both empty states (with and without filters)', async () => {
    page(h(Aides), '/aides?q=zzzz-nothing-zzzz');
    expect(await screen.findByTestId('aides-empty-filtered')).toContainElement(block());
    cleanup();
    page(h(Aides), '/aides');
    expect(await screen.findByTestId('aides-empty-neutral')).toContainElement(block());
  });
  it('directory: the person to ask; on the empty France services list the block does not link back to that list', async () => {
    page(h(Annuaire), '/structures?q=zzqxw');
    await screen.findByTestId('annuaire-empty');
    expect(within(block()).getByRole('link', { name: 'Voir les France services dans notre annuaire' })).toBeInTheDocument();
    cleanup();
    page(h(Annuaire), '/structures?type=france_services');
    await screen.findByTestId('annuaire-empty');
    expect(within(block()).queryByRole('link', { name: 'Voir les France services dans notre annuaire' })).toBeNull();
    expect(within(block()).getAllByRole('link')).toHaveLength(3);
  });
});

describe('« Votre situation » in another interface language', () => {
  const orientation = { needs: [{ id: 'n1', label: 'Hébergement d’urgence', urgent: true, numbers: [], actions: ['Appelez le 115.'], rules: [], sheets: [], topic: 'hébergement' }], cautions: [], questions: [], sources: {} };
  it('French: no notice; the advice is the interface language', () => {
    page(h(OrientationPanel, { orientation, query: 'q' }));
    expect(screen.queryByTestId('orientation-french-notice')).toBeNull();
  });
  it('the five other languages: a translated notice that the detailed advice is French official text; the advice stays French, marked lang="fr"', async () => {
    for (const lang of LANGS) {
      const dict = JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/search.json`, 'utf8'));
      await setLanguage(lang);
      page(h(OrientationPanel, { orientation, query: 'q' }));
      expect(screen.getByTestId('orientation-french-notice')).toHaveTextContent(dict['orientation.french_notice']);
      expect(screen.getByText('Appelez le 115.').closest('[lang="fr"]')).not.toBeNull();
      cleanup();
    }
  });
});
