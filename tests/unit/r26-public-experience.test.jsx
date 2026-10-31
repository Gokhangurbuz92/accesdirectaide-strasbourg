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

describe('R27 navigation fixes', () => {
  it('an old /situations/<slug> link opens the search of its home tile', async () => {
    const { situationSearchPath } = await import('../../src/config/situations.js');
    expect(situationSearchPath('etudiant')).toBe('/recherche?q=%C3%A9tudiant');
    expect(situationSearchPath('travail')).toBe('/recherche?q=emploi');
    expect(situationSearchPath('senior')).toBe(`/recherche?q=${encodeURIComponent('personnes âgées')}`);
    expect(situationSearchPath('jeunes-actifs')).toBe('/recherche?q=jeunes%20actifs');
    expect(read('src/pages/index.jsx')).toMatch(/path="\/situations\/:slug" element=\{<SituationRedirect \/>\}/);
  });
  it('the phone menu button cannot be squeezed (its icon was 4 px wide)', () => {
    expect(read('src/pages/Layout.jsx')).toMatch(/className="xl:hidden h-11 w-11 min-w-11 shrink-0/);
  });
});

describe('R27 word search', () => {
  it('keeps the meaningful words of a visitor sentence, without accents', async () => {
    const { searchWords, wordTerms } = await import('../../api/lib/search-query.js');
    expect(searchWords('aide pour payer mon loyer')).toEqual(['loyer']);
    expect(searchWords('CCAS Strasbourg')).toEqual(['ccas', 'strasbourg']);
    expect(searchWords('titre de séjour')).toEqual(['titre', 'sejour']);
    expect(searchWords("j'ai besoin d'aide")).toEqual([]);
    expect(searchWords('67000')).toEqual(['67000']);
    expect(searchWords('aide')).toEqual([]);   // nothing meaningful: the whole list, not an empty one
    expect(wordTerms('loyers')).toContain('loyer');
  });
  it('the three public searches use the word plan and keep only the records that match the most words', () => {
    const src = read('api/lib/search-query.js');
    for (const t of ['Aide', 'Demarche', 'Structure']) expect(src).toContain(`if (plan) conditions.push(await bestMatchCondition('${t}', conditions, plan));`);
    expect(src).toMatch(/\['"nom"', '"description_courte"', '"ville"', '"code_postal"', '"type_structure"'\]/);
  });
});

describe('R27 cards', () => {
  it('aide, démarche and lieu cards share the provenance line and the action strip', () => {
    expect(read('src/components/molecules/AidCard.tsx')).toMatch(/<CardActionStrip label="Voir l’aide" \/>/);
    expect(read('src/components/cards/DemarcheCard.jsx')).toMatch(/<CardActionStrip label="Voir la démarche" \/>/);
    expect(read('src/components/cards/StructureCard.jsx')).toMatch(/<CardActionStrip label="Voir le lieu" \/>/);
    for (const f of ['src/components/molecules/AidCard.tsx', 'src/components/cards/DemarcheCard.jsx', 'src/components/cards/StructureCard.jsx']) expect(read(f), f).toMatch(/<RecordProvenance /);
    expect(read('src/components/cards/StructureCard.jsx')).not.toMatch(/Vérifié: \{verifiedAt\}/);
  });
  it('renders « Vérifié le » with its source link, and « À actualiser » for an old check', async () => {
    const { RecordProvenance } = await import('../../src/components/cards/RecordCardParts.jsx');
    const { container } = render(createElement(RecordProvenance, { verifiedAt: '30/10/2026', sourceHost: 'service-public.gouv.fr', sourceUrl: 'https://www.service-public.gouv.fr/x' }));
    expect(container.textContent).toContain('Vérifié le 30/10/2026');
    expect(container.querySelector('a').getAttribute('href')).toBe('https://www.service-public.gouv.fr/x');
    const old = render(createElement(RecordProvenance, { verifiedAt: '01/01/2026', stale: true }));
    expect(old.container.textContent).toContain('À actualiser (vérifié le 01/01/2026)');
  });
  it('the aide page header gives the verification date, not the fetch date', () => {
    const d = read('src/pages/AideDetail.jsx');
    expect(d).toMatch(/Vérifié le \{verifiedAtLabel\}/);
    expect(d).not.toMatch(/Mise à jour : \{fetchedAtLabel\}/);
  });
});

describe('R27 multi-instance evidence', () => {
  it('every API answer names its function instance with a random id (nothing else)', async () => {
    const { applySecurityHeaders, INSTANCE_ID } = await import('../../api/_utils/security.js');
    expect(INSTANCE_ID).toMatch(/^[0-9a-f]{8}$/);
    const h = {}; applySecurityHeaders({ setHeader: (k, v) => { h[k] = v; } }, null);
    expect(h['x-ada-instance']).toBe(INSTANCE_ID);
  });
});

describe('R27 lieu journey', () => {
  it('a click on the address or hours of a lieu card opens the card; the phone link stays clickable', () => {
    expect(read('src/components/cards/StructureCard.jsx')).toMatch(/relative z-20 pointer-events-none \[&_a\]:pointer-events-auto/);
  });
  it('the lieu page links to its place on a map', async () => {
    const { mapUrl } = await import('../../src/pages/StructureDetail.jsx');
    expect(mapUrl({ latitude: 48.58, longitude: 7.75 })).toBe('https://www.openstreetmap.org/?mlat=48.58&mlon=7.75#map=17/48.58/7.75');
    expect(mapUrl({ adresse: '1 parc de l’Étoile', code_postal: '67000', ville: 'Strasbourg' })).toBe(`https://www.openstreetmap.org/search?query=${encodeURIComponent('1 parc de l’Étoile 67000 Strasbourg')}`);
    expect(read('src/pages/StructureDetail.jsx')).toMatch(/data-testid="structure-map-link"/);
  });
});
