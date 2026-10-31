// @vitest-environment jsdom
/**
 * R26 public experience package (owner directive 31/10/2026): empty catalogues lead to real content, the menu highlights the right entry, the beta
 * offers no closed action, the official tools are official, the Aides topics find their records, the legal pages say what is processed today.
 */
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { navActive } from '../../src/lib/navActive.js';
import { OFFICIAL_TOOLS } from '../../src/config/officialTools.js';

vi.stubEnv('KV_REST_API_URL', 'http://localhost');
vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
const read = (f) => fs.readFileSync(f, 'utf8');

describe('main menu', () => {
  it('highlights the section of the address, not « Accueil » for every page without its own entry', () => {
    expect(navActive('/', 'Home')).toBe(true);
    expect(navActive('/aides/apl', 'Home')).toBe(false);
    expect(navActive('/aides/apl', 'Aides')).toBe(true);
    expect(navActive('/structures', 'Annuaire')).toBe(true);
    expect(navActive('/structures/mairie-x', 'Annuaire')).toBe(true);
    expect(navActive('/outils', 'Tools')).toBe(true);
    expect(navActive('/mentions-legales', 'Home')).toBe(false);
    expect(navActive('/dispositifs', 'Home')).toBe(false);
    expect(navActive('/aidesx', 'Aides')).toBe(false);
  });
  it('in the beta, no « Se connecter » / « S’inscrire » and no assistant button; « Outils » replaces the empty « Actualités »', () => {
    const layout = read('src/pages/Layout.jsx');
    expect(layout).toMatch(/!frontendEnv\.flags\.publicBeta && <AuthHeaderActions \/>/);
    expect(layout).toMatch(/!frontendEnv\.flags\.publicBeta && <AuthMobileActions/);
    expect(layout).toMatch(/\{ label: 'Outils', page: 'Tools'/);
    expect(layout).not.toMatch(/\{ label: 'Actualités', page: 'Actualites', icon/);
    expect(layout).not.toMatch(/currentPageName === item\.page/);
  });
});

describe('Boîte à outils', () => {
  it('lists only official services over https, each with a purpose', () => {
    expect(OFFICIAL_TOOLS.length).toBeGreaterThanOrEqual(8);
    const official = /(\.gouv\.fr|^caf\.fr|\.caf\.fr|^ameli\.fr|\.ameli\.fr|info-retraite\.fr|\.justice\.fr|france-renov\.gouv\.fr)$/;
    for (const t of OFFICIAL_TOOLS) {
      const u = new URL(t.url);
      expect(u.protocol, t.id).toBe('https:');
      expect(u.hostname, t.id).toMatch(official);
      expect(t.description.length, t.id).toBeGreaterThan(20);
    }
    expect(new Set(OFFICIAL_TOOLS.map((t) => t.id)).size).toBe(OFFICIAL_TOOLS.length);
  });
});

describe('empty catalogues', () => {
  it('outils, bonnes pratiques, dispositifs, ressources and actualités show what to use instead of filters over nothing', () => {
    expect(read('src/pages/Tools.jsx')).toMatch(/<OfficialTools \/>/);
    expect(read('src/pages/Tools.jsx')).toMatch(/\(tools\.length > 0 \|\| hasFilter\) && !failed/);
    for (const f of ['Guides', 'Dispositifs', 'Ressources', 'Actualites']) expect(read(`src/pages/${f}.jsx`), f).toMatch(/<EmptyCatalogue /);
    expect(read('src/pages/Dispositifs.jsx')).not.toMatch(/to="\/diagnostic"/);
  });
  it('the impact page shows the live published counts and says what is not measured; it no longer calls the refused figures endpoint', () => {
    const impact = read('src/pages/Impact.jsx');
    expect(impact).toMatch(/<VerifiedCatalogue /);
    expect(impact).toMatch(/Ce que nous ne mesurons pas encore/);
    expect(impact).not.toMatch(/\/api\/public\/stats/);
  });
});

describe('beta accuracy', () => {
  it('the partners page offers the directory and the published e-mail in the beta, never the closed account creation', () => {
    const p = read('src/pages/Partners.jsx');
    expect(p).toMatch(/\{beta && \(/);
    expect(p).toMatch(/mailtoWithSubject\(email, 'Partenariat AccesDirectAide'\)/);
    expect(p).toMatch(/\{!beta && \(\n\s+<Card className="bg-slate-900/);
  });
  it('the privacy, security, cookie and terms pages say what is processed today', () => {
    for (const f of ['Confidentialite', 'Security', 'Cookies', 'CGU']) expect(read(`src/pages/${f}.jsx`), f).toMatch(/<BetaProcessingNotice \/>/);
    expect(read('src/components/beta/BetaProcessingNotice.jsx')).toMatch(/Ne sont <strong>pas<\/strong> ouverts/);
  });
  it('the beta banner is one short line; the hide-screen control says what it does', () => {
    const banner = read('src/components/beta/PublicBeta.jsx').match(/<strong>Bêta publique<\/strong>[\s\S]*?<\/p>/)[0];
    expect(banner.replace(/\s+/g, ' ').length).toBeLessThan(220);
    const hide = read('src/components/ui/HideScreenButton.jsx');
    expect(hide).toMatch(/Masquer l’écran<\/span>/);
    expect(hide).toMatch(/aria-label="Masquer l’écran immédiatement/);
    expect(hide).not.toMatch(/bg-red-600/);
  });
  it('every information page uses the shared page header (no centered dark block with a card pulled over it)', () => {
    for (const f of ['MentionsLegales', 'Confidentialite', 'Cookies', 'Security', 'CGU', 'APropos', 'SourcesMethode', 'Sources', 'Method', 'Mission', 'Accessibilite',
      'Tools', 'Guides', 'Dispositifs', 'Ressources', 'Actualites', 'Partners', 'Impact']) {
      const s = read(`src/pages/${f}.jsx`);
      expect(s, f).toMatch(/<PageHeader /);
      expect(s, f).not.toMatch(/-mt-(10|20) relative z-10/);
    }
  });
});

describe('Aides topics', () => {
  it('a topic of the menu has words that find its records, written without accents', async () => {
    const { THEME_WORDS, themePattern, foldAccents } = await import('../../api/lib/search-query.js');
    for (const t of ['logement', 'sante', 'handicap', 'emploi', 'famille']) {
      expect(THEME_WORDS[t], t).toBeTruthy();
      for (const w of THEME_WORDS[t]) expect(w).toBe(foldAccents(w));
    }
    expect(themePattern('handicap')).toBe('\\m(handicap)');
    expect(themePattern('inconnu')).toBeNull();
    expect(foldAccents('Santé')).toBe('sante');
  });
});

describe('home page in the beta', () => {
  it('shows the live catalogue counts (no number when a list cannot be read)', async () => {
    const { loadCatalogueCounts, resetCatalogueCounts } = await import('../../src/hooks/useCatalogueCounts.js');
    resetCatalogueCounts();
    const fake = async (url) => ({ ok: !url.includes('structures'), json: async () => ({ pagination: { total: url.includes('aides') ? 17 : 13 } }) });
    expect(await loadCatalogueCounts(fake)).toEqual({ aides: 17, demarches: 13, structures: null });
    resetCatalogueCounts();
  });
  it('renders the four entries, with their links', async () => {
    const { default: VerifiedCatalogue } = await import('../../src/components/layout/VerifiedCatalogue.jsx');
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ pagination: { total: 5 } }) }));
    render(createElement(MemoryRouter, null, createElement(VerifiedCatalogue)));
    for (const [name, href] of [['Aides', '/aides'], ['Démarches', '/demarches'], ['Lieux d’accueil', '/structures'], ['Outils officiels', '/outils']])
      expect(screen.getByRole('link', { name: new RegExp(`^${name}`) }).getAttribute('href')).toBe(href);
    expect((await screen.findByTestId('count-outils')).textContent).toBe(`${OFFICIAL_TOOLS.length} outils officiels`);
  });
});

describe('official page reader', () => {
  it('reads the main content, not a small teaser <article> that comes first (alsace.eu FSL page read as 49 characters)', async () => {
    const { mainScope, parseOfficialPage } = await import('../../api/_services/verification/pages.js');
    const long = 'Le Fonds de Solidarité pour le Logement peut prendre en charge le dépôt de garantie. '.repeat(20);
    const html = `<html><body><header>menu</header><main><article><h2>Pour aller plus loin</h2><p>Voir aussi.</p></article><h1>FSL</h1><p>${long}</p></main></body></html>`;
    expect(mainScope(html)).toContain('dépôt de garantie');
    expect(parseOfficialPage(html).chars).toBeGreaterThan(1000);
    // a Service-Public sheet: its main article carries most of the page, it is still the one read
    const sp = `<main><nav>x</nav><article><h2>Conditions</h2><p>${long}</p></article><p>Partager</p></main>`;
    expect(mainScope(sp).startsWith('<h2>Conditions</h2>')).toBe(true);
  });
});
