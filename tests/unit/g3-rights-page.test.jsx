// @vitest-environment jsdom
/**
 * G3 (19/11/2026) — the public page /droits (src/pages/Droits.jsx): accessible lists in six languages (axe clean, headings, French official text marked
 * lang="fr" dir="ltr", Arabic page right-to-left), no entitlement wording in any rendered string, no field and no request, links to pages that exist,
 * reachable from /outils, open during the restricted beta and listed in the sitemap. No JSX in the test body.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import fs from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';
import { ENTITLEMENT_CLAIMS } from '../../scripts/i18n-check.mjs';
import { isBetaRestrictedPath } from '../../src/lib/publicBeta.js';
import { setLanguage } from '../../src/i18n/index.js';
import Droits from '../../src/pages/Droits.jsx';
import { NEEDS, inWindow, needLabel } from '../../src/lib/rightsPublicView.js';

const LANGS = ['fr', 'en', 'de', 'tr', 'ar', 'uk'];
const view = JSON.parse(fs.readFileSync('data/reference/rights-public-view.v1.json', 'utf8'));
const routes = fs.readFileSync('src/pages/index.jsx', 'utf8');
let fetchSpy;
beforeEach(() => { fetchSpy = vi.fn(async () => { throw new Error('no request expected'); }); globalThis.fetch = fetchSpy; });
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await setLanguage('fr', { persist: false }); });
afterAll(async () => { await setLanguage('fr', { persist: false }); });

const page = (path) => render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [path] },
  createElement(Routes, null, createElement(Route, { path: '/droits', element: createElement(Droits) }), createElement(Route, { path: '/droits/:need', element: createElement(Droits) })))));
/** every visible string of the page plus the accessible-only ones (sr-only, aria-label) */
const allText = (container) => [container.textContent, ...[...container.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label'))].join('\n');
const serious = async (container) => (await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }))
  .violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`);
/** whether an internal link points at a route of src/pages/index.jsx */
const routeExists = (href) => {
  const p = href.split(/[?#]/)[0];
  if (p === '/droits' || /^\/droits\/[a-z-]+$/.test(p)) return routes.includes('path="/droits"') && routes.includes('path="/droits/:need"');
  if (/^\/bonnes-pratiques\/[a-z0-9-]+$/.test(p)) return routes.includes('path="/bonnes-pratiques/:slug"');
  return routes.includes(`path="${p}"`);
};
const OFFICIAL_HOSTS = /^https:\/\/(www\.)?(service-public\.gouv\.fr|mesdroitssociaux\.gouv\.fr|caf\.fr|1jeune1solution\.gouv\.fr|demande-logement-social\.gouv\.fr|mesaides\.france-renov\.gouv\.fr|lannuaire\.service-public\.gouv\.fr)\//;

describe('G3 /droits — six languages, every need', () => {
  for (const lang of LANGS) {
    it(`${lang}: the index and all ${view.needs.length} needs render without entitlement wording; index and three needs are axe clean`, async () => {
      await setLanguage(lang, { persist: false });
      const idx = page('/droits');
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByTestId('rights-needs').querySelectorAll('a')).toHaveLength(view.needs.length);
      expect(await serious(idx.container)).toEqual([]);
      const texts = [allText(idx.container)];
      cleanup();
      for (const n of NEEDS) {
        const r = page(`/droits/${n.id}`);
        expect(screen.getByTestId(`rights-need-${n.id}`)).toBeInTheDocument();
        texts.push(allText(r.container), globalThis.document.title);
        if (['surendettement', 'crise-suicide', 'isolement'].includes(n.id)) expect(await serious(r.container), `${lang} ${n.id}`).toEqual([]);
        cleanup();
      }
      for (const t of texts) {
        expect(claimsEntitlement(t)).toBe(false);
        if (ENTITLEMENT_CLAIMS[lang]) expect(ENTITLEMENT_CLAIMS[lang].test(t), `${lang}: ${t.match(ENTITLEMENT_CLAIMS[lang])}`).toBe(false);
        expect(t).not.toMatch(/éligible|vous avez droit|undefined|\{\{|rights:/i);
      }
      expect(globalThis.document.documentElement.dir).toBe(lang === 'ar' ? 'rtl' : 'ltr');
      expect(fetchSpy).not.toHaveBeenCalled();
    }, 60000);
  }
});

describe('G3 /droits — content of a need', () => {
  it('surendettement: fiches with source and dates, local guide link, bodies, offices to the directory, Alsace-Moselle procedure', () => {
    page('/droits/surendettement');
    const f = screen.getByTestId('rights-fiche-F134');
    expect(f.querySelector('a[href="https://www.service-public.gouv.fr/particuliers/vosdroits/F134"]')).toBeTruthy();
    expect(f).toHaveTextContent(/Fiche officielle F134 de Service-Public \(DILA\)/);
    expect(f).toHaveTextContent(/Relue dans l’archive officielle le\s*18 novembre 2026/);
    expect(f.querySelector('[data-testid="rights-local-guide"]').getAttribute('href')).toBe(`/bonnes-pratiques/${view.needs.find((n) => n.id === 'surendettement').fiches[0].localGuide}`);
    expect(screen.getByTestId('rights-bodies')).toHaveTextContent('Banque de France');
    expect(screen.getByTestId('rights-aids').querySelector('[data-territory="alsace-moselle"]')).toHaveTextContent(/Faillite civile.*Seulement : Alsace-Moselle/);
    expect(screen.getByTestId('rights-about')).toHaveTextContent('seul l’organisme concerné décide');
  });

  it('a need whose advice states conditions says so instead of showing them; the seasonal rule says whether it is in force', () => {
    page('/droits/sortie-ase');
    expect(screen.getByTestId('rights-omitted')).toHaveTextContent(/ne sont pas reprises ici tant qu’un expert ne les a pas relues/);
    expect(globalThis.document.body.textContent).not.toMatch(/16 à 25 ans/);
    cleanup();
    page('/droits/energie');
    const rule = screen.getByTestId('rights-rule');
    expect(rule).toHaveTextContent(/trêve hivernale/);
    expect(inWindow({ from: '11-01', to: '03-31' }, new Date('2026-11-19T12:00:00Z'))).toBe(true);
    expect(inWindow({ from: '11-01', to: '03-31' }, new Date('2026-07-01T12:00:00Z'))).toBe(false);
    expect(inWindow({ from: '11-01', to: '03-31' }, new Date('2026-10-31T23:30:00Z'))).toBe(true);   // 1 November 00:30 in Paris
  });

  it('every link leads to an existing route of the site or to an official https site; no field, no form, no request', () => {
    for (const path of ['/droits', ...NEEDS.map((n) => `/droits/${n.id}`)]) {
      const { container } = page(path);
      for (const a of container.querySelectorAll('a')) {
        const href = a.getAttribute('href');
        if (href.startsWith('/')) expect(routeExists(href), `${path} → ${href}`).toBe(true);
        else if (href.startsWith('tel:')) expect(href).toMatch(/^tel:\d{2,10}$/);
        else { expect(href, `${path} → ${href}`).toMatch(OFFICIAL_HOSTS); expect(a.getAttribute('target')).toBe('_blank'); expect(a.getAttribute('rel')).toContain('noopener'); }
      }
      expect(container.querySelectorAll('input, textarea, select, form, button')).toHaveLength(0);
      cleanup();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('non-French page: the frame is translated, the official French text is marked lang="fr" dir="ltr"', async () => {
    await setLanguage('ar', { persist: false });
    page('/droits/aides-logement');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('مساعدة لدفع الإيجار');
    const frBlocks = globalThis.document.querySelectorAll('[lang="fr"]');
    expect(frBlocks.length).toBeGreaterThan(3);
    for (const el of frBlocks) expect(el.getAttribute('dir')).toBe('ltr');
  });

  it('an unknown need says so and offers the list', () => {
    page('/droits/inconnu');
    expect(screen.getByTestId('rights-unknown')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tous les besoins' })).toHaveAttribute('href', '/droits');
  });

  it('the French need labels are the orientation’s own labels', () => {
    const t = (_k, fr) => fr;
    for (const n of view.needs) expect(needLabel(n.id, t, '?')).toBe(n.label);
  });
});

describe('G3 /droits — reachable and open in the restricted beta', () => {
  it('is not a beta-restricted screen, with the Production surfaces (admin, accounts narrow) or none', () => {
    for (const open of [[], ['admin'], ['admin', 'accounts']]) {
      expect(isBetaRestrictedPath('/droits', open, { accountsScope: 'booking', proSelfRegistration: false })).toBe(false);
      expect(isBetaRestrictedPath('/droits/surendettement', open, { accountsScope: 'booking', proSelfRegistration: false })).toBe(false);
    }
  });

  it('/outils links to it, and the sitemap lists it with one page per need during the beta', async () => {
    expect(fs.readFileSync('src/pages/Tools.jsx', 'utf8')).toMatch(/<Link to="\/droits"[^>]*data-testid="tools-rights-link"/);
    vi.stubEnv('ADA_PUBLIC_BETA_RESTRICTED', '1');
    const { buildSitemapXml } = await import('../../api/_handlers/sitemap.js');
    const locs = [...buildSitemapXml('https://x.test', [], [], []).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace('https://x.test', ''));
    expect(locs).toEqual(expect.arrayContaining(['/droits', ...view.needs.map((n) => `/droits/${n.id}`)]));
    vi.unstubAllEnvs();
  });
});
