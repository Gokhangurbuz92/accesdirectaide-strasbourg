// @vitest-environment jsdom
/**
 * R29 — public journeys, second round: a new page opens at its top, a guide leads to where to act, news names its publisher and licence, the
 * provenance box never shows an empty badge, and inline HTML keeps « 1<sup>er</sup> » in one word.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import { createElement } from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import ScrollToTop from '../../src/components/navigation/ScrollToTop.jsx';
import { guideNextSteps, GUIDE_NEXT_STEPS } from '../../src/config/guideNextSteps.js';
import { newsPublisher, newsSourceLabel, shownNewsCategory } from '../../src/lib/newsSource.js';
import { htmlToPlainText } from '../../src/lib/htmlText.js';
import ProvenanceFreshness from '../../src/components/ProvenanceFreshness.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('a new page opens at its top', () => {
  it('scrolls up on a forward navigation, not on a query-string change', async () => {
    const spy = vi.spyOn(globalThis, 'scrollTo').mockImplementation(() => {});
    let go;
    function Grab() { go = useNavigate(); return null; }
    render(createElement(MemoryRouter, { initialEntries: ['/bonnes-pratiques'] }, createElement(ScrollToTop), createElement(Grab)));
    spy.mockClear();
    await act(async () => { go('/bonnes-pratiques/loyers-impayes-f31272'); });
    expect(spy).toHaveBeenCalledWith(0, 0);
    spy.mockClear();
    await act(async () => { go('/bonnes-pratiques/loyers-impayes-f31272?x=1'); });
    expect(spy).not.toHaveBeenCalled();
    await act(async () => { go(-1); });
    expect(spy).not.toHaveBeenCalled();   // going back keeps the browser's position
  });
  it('is mounted once, around every route', () => {
    expect(fs.readFileSync('src/pages/index.jsx', 'utf8')).toMatch(/<BrowserRouter>\s*<ScrollToTop \/>/);
  });
});

describe('a guide leads to where to act', () => {
  it('every guide category has three next steps that open site lists', () => {
    for (const [cat, steps] of Object.entries(GUIDE_NEXT_STEPS)) {
      expect(steps, cat).toHaveLength(3);
      for (const s of steps) expect(s.to, cat).toMatch(/^\/(aides|demarches|structures|dispositifs|outils)(\?|$)/);
    }
    expect(guideNextSteps({ categorie: 'logement' }).map((s) => s.to)).toEqual(['/aides?theme=logement', '/dispositifs', '/structures?q=ADIL']);
    expect(guideNextSteps({ categorie: 'recours', contexte: ['recours', 'santé'] })[0].to).toBe('/structures?q=CPAM');
    expect(guideNextSteps({ categorie: 'inconnue' }).length).toBe(2);
  });
  it('the guide page uses the shared page header and shows the next steps', () => {
    const src = fs.readFileSync('src/pages/GuideDetail.jsx', 'utf8');
    expect(src).toMatch(/<PageHeader title=\{guide\.titre\}/);
    expect(src).toMatch(/data-testid="guide-next-steps"/);
    expect(src).not.toMatch(/<h1 className/);
  });
});

describe('news names its publisher and its licence', () => {
  it('Service-Public items are attributed to the DILA under Licence Ouverte 2.0; others show their site', () => {
    expect(newsPublisher('https://www.service-public.gouv.fr/particuliers/actualites/A1')).toMatchObject({ name: 'Service-Public.fr', licence: 'Licence Ouverte 2.0' });
    expect(newsSourceLabel('https://www.service-public.gouv.fr/particuliers/actualites/A1')).toBe('Service-Public.fr');
    expect(newsSourceLabel('https://www.exemple.fr/a', 'Exemple')).toBe('exemple.fr');
    expect(newsSourceLabel('pas une adresse', 'Exemple')).toBe('Exemple');
    expect(shownNewsCategory('general')).toBeNull();
    expect(shownNewsCategory('logement')).toBe('logement');
  });
  it('the list and detail pages use the shared card parts and the attribution', () => {
    const list = fs.readFileSync('src/pages/Actualites.jsx', 'utf8');
    expect(list).toMatch(/<RecordProvenance verifiedAt=\{verifiedAt\} sourceHost=\{sourceLabel\}/);
    expect(list).toMatch(/<CardActionStrip label="Lire l’actualité" \/>/);
    expect(fs.readFileSync('src/pages/ActualiteDetail.jsx', 'utf8')).toMatch(/data-testid="news-attribution"/);
    expect(fs.readFileSync('api/_handlers/actualites.js', 'utf8')).toMatch(/verifiedAt: newsVerifiedAt\(safeItem\)/);
  });
});

describe('small display fixes', () => {
  it('inline tags add no space; block tags still separate words', () => {
    expect(htmlToPlainText('au 1<sup>er</sup> novembre')).toBe('au 1er novembre');
    expect(htmlToPlainText('voir <a href="x">la fiche</a> officielle')).toBe('voir la fiche officielle');
    expect(htmlToPlainText('<p>un</p><p>deux</p>')).toBe('un\ndeux');
  });
  it('no empty freshness badge when nothing was verified', () => {
    render(createElement(MemoryRouter, null, createElement(ProvenanceFreshness, { provenance: { verifiedAt: null, fetchedAt: '2026-10-31T00:00:00Z', sourceUrl: 'https://www.service-public.gouv.fr/x' } })));
    expect(screen.queryByTestId('freshness-badge')).toBeNull();
  });
});

describe('N11 map provider', () => {
  it('the map view says that OpenStreetMap receives the IP address, and so does the privacy page (beta and after)', () => {
    expect(fs.readFileSync('src/pages/Annuaire.jsx', 'utf8')).toMatch(/data-testid="map-provider-notice"/);
    const privacy = fs.readFileSync('src/pages/Confidentialite.jsx', 'utf8');
    expect(privacy.match(/fondation OpenStreetMap \(Royaume-Uni\), qui reçoivent votre adresse IP/g)).toHaveLength(2);
    expect(fs.readFileSync('src/components/StructureMap.jsx', 'utf8')).toMatch(/openstreetmap\.org\/copyright/);   // attribution required by the tile policy
  });
});

describe('sitemap: guides and news', () => {
  it('lists the guides and news pages and the two catalogue pages', async () => {
    const { buildSitemapXml } = await import('../../api/_handlers/sitemap.js');
    const xml = buildSitemapXml('https://www.accesdirectaide.fr', [], [], [], [], {
      guides: [{ slug: 'loyers-impayes-f31272', updatedAt: new Date('2026-10-31') }], actualites: [{ slug: 'colis-importes-187812', updatedAt: new Date('2026-10-31') }] });
    for (const loc of ['/bonnes-pratiques', '/outils', '/bonnes-pratiques/loyers-impayes-f31272', '/actualites/colis-importes-187812'])
      expect(xml).toContain(`<loc>https://www.accesdirectaide.fr${loc}</loc>`);
    const src = fs.readFileSync('api/_handlers/sitemap.js', 'utf8');   // only published guides and news are offered to crawlers
    expect(src).toMatch(/Guide\.findMany\(\{ where: eq\(schema\.Guide\.statut, 'publie'\)/);
    expect(src).toMatch(/Actualite\.findMany\(\{ where: eq\(schema\.Actualite\.statut, 'publie'\)/);
  });
});
