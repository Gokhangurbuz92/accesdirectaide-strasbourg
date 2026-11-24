// @vitest-environment jsdom
/**
 * Guide ADA Pro (24/11/2026) — /pro/guide in the console and /pro/guide-public before sign-in (src/pages/pro/Guide.jsx).
 * The guide renders with one h1 and ordered headings, the console menu offers it, every link it carries opens a /pro route the router declares, the public
 * version marks the account steps « après activation » without linking them, and the modules the beta keeps closed are said « pas encore ouvert » (no link).
 * No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ProGuide from '../../src/pages/pro/Guide.jsx';
import ProLayout from '../../src/pages/pro/ProLayout.jsx';
import { isBetaRestrictedPath } from '../../src/lib/publicBeta.js';

const ROOT = path.resolve(__dirname, '../..');
const read = (/** @type {string} */ f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

afterEach(() => { cleanup(); vi.unstubAllGlobals(); globalThis.localStorage.clear(); });

/** the /pro routes declared in src/pages/index.jsx (the pro block, with the nested « rdv » children) */
function proRoutes() {
  const src = read('src/pages/index.jsx');
  const start = src.indexOf('<Route path="/pro" element={<ProLayout />}>');
  const block = src.slice(start, src.indexOf('</Routes>', start));
  const out = new Set(['/pro']);
  let prefix = '/pro/';
  for (const line of block.split('\n').slice(1)) {
    const m = line.match(/<Route (?:index )?path="([^"]+)"/);
    if (m && m[1] === 'rdv') { out.add('/pro/rdv'); prefix = '/pro/rdv/'; continue; }
    if (prefix === '/pro/rdv/' && /<\/Route>/.test(line)) { prefix = '/pro/'; continue; }
    if (m && !m[1].includes(':')) out.add(prefix + m[1]);
  }
  for (const m of src.matchAll(/<Route path="(\/pro\/[^"]+)"/g)) out.add(m[1]);
  return out;
}

const wrap = (/** @type {any} */ el) => render(h(HelmetProvider, null, el));
const showConsole = (role = 'PRO') => wrap(h(MemoryRouter, { initialEntries: ['/pro/guide'] },
  h(Routes, null, h(Route, { path: '/pro', element: h(Outlet, { context: { user: { role, email: 'a@b.fr' }, modules: null } }) },
    h(Route, { path: 'guide', element: h(ProGuide) })))));
const showPublic = () => wrap(h(MemoryRouter, { initialEntries: ['/pro/guide-public'] },
  h(Routes, null, h(Route, { path: '/pro/guide-public', element: h(ProGuide, { publicView: true }) }))));

describe('Guide ADA Pro', () => {
  it('renders one h1, h2 sections with h3 steps, a table of contents and 15–25 questions', () => {
    showConsole();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Guide ADA Pro');
    const h2 = screen.getAllByRole('heading', { level: 2 });
    expect(h2.length).toBeGreaterThanOrEqual(15);
    expect(screen.getAllByTestId('pro-guide-step').length).toBeGreaterThanOrEqual(30);
    const faq = screen.getAllByTestId('pro-guide-faq-item');
    expect(faq.length).toBeGreaterThanOrEqual(15);
    expect(faq.length).toBeLessThanOrEqual(25);
    // every table-of-contents entry points to a section of the page
    const toc = within(screen.getByTestId('pro-guide-toc')).getAllByRole('link');
    for (const a of toc) expect(globalThis.document.getElementById(a.getAttribute('href').slice(1)), a.getAttribute('href')).not.toBeNull();
    // the troubleshooting cards quote the messages the screens show
    expect(screen.getAllByTestId('pro-guide-trouble-item').length).toBeGreaterThanOrEqual(8);
    expect(screen.getByText(/Trop de tentatives : patientez quelques minutes/)).toBeInTheDocument();
  });

  it('every link of the console guide opens a /pro route the router declares', () => {
    showConsole('STRUCTURE_ADMIN');
    const routes = proRoutes();
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href')).filter((x) => x && x.startsWith('/pro'));
    expect(links.length).toBeGreaterThan(10);
    for (const href of links) expect(routes.has(href.split('#')[0]), href).toBe(true);
    expect(screen.getByText(/toutes les étapes vous concernent/)).toBeInTheDocument();
  });

  it('closed modules are said « pas encore ouvert » with the app’s reason, never as links', () => {
    showConsole();
    const closed = screen.getByTestId('pro-guide-closed');
    const items = within(closed).getAllByTestId('pro-guide-closed-module');
    expect(items.map((x) => x.textContent)).toEqual(expect.arrayContaining([
      expect.stringMatching(/Dossiers suivis.*pas encore ouvert/), expect.stringMatching(/Sélections d’orientation.*pas encore ouvert/),
      expect.stringMatching(/^Orientations.*pas encore ouvert/), expect.stringMatching(/Orientations sociales.*pas encore ouvert/)]));
    expect(within(closed).queryAllByRole('link')).toHaveLength(0);
    expect(closed).toHaveTextContent(/cadre de protection des données/);
    for (const p of ['/pro/dossiers', '/pro/selections', '/pro/orientations']) expect(globalThis.document.querySelector(`a[href^="${p}"]`)).toBeNull();
  });

  it('the public version marks account steps « après activation » and links only to sign-up and sign-in', () => {
    showPublic();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(globalThis.document.getElementById('main-content')).not.toBeNull();
    expect(screen.getAllByTestId('pro-guide-after-activation').length).toBeGreaterThan(20);
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href')).filter((x) => x && x.startsWith('/pro'));
    expect(new Set(links)).toEqual(new Set(['/pro/register', '/pro/login']));
  });

  it('is reachable: routes declared, public guide open in the beta, dashboard and breadcrumb link it', () => {
    const idx = read('src/pages/index.jsx');
    expect(idx).toMatch(/<Route path="guide" element={<ProGuard><ProGuide \/><\/ProGuard>} \/>/);
    expect(idx).toMatch(/<Route path="\/pro\/guide-public" element={<ProGuide publicView \/>} \/>/);
    expect(isBetaRestrictedPath('/pro/guide-public', [])).toBe(false);
    expect(isBetaRestrictedPath('/pro/guide', [])).toBe(true);
    expect(read('src/pages/pro/Dashboard.jsx')).toMatch(/to="\/pro\/guide"/);
    expect(read('src/components/ProBreadcrumb.jsx')).toMatch(/guide: t\('pro:breadcrumb.guide'/);
  });

  it('the console menu offers « Guide ADA Pro » to every member', async () => {
    globalThis.localStorage.setItem('pro_token', 'test-token');
    globalThis.localStorage.setItem('ada_onboarding_done', '1');
    vi.stubGlobal('fetch', vi.fn(async (url) => new Response(JSON.stringify(String(url).includes('/api/pro/me')
      ? { user: { id: 'u1', email: 'pro@example.fr', role: 'PRO' }, modules: { cases: false, selections: false, referrals: false, socialReferrals: false } }
      : {}), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    wrap(h(MemoryRouter, { initialEntries: ['/pro/guide'] },
      h(Routes, null, h(Route, { path: '/pro', element: h(ProLayout) }, h(Route, { path: 'guide', element: h(ProGuide) })))));
    const nav = await screen.findByRole('navigation', { name: /Navigation de l'espace pro/ });
    const entry = within(nav).getByRole('link', { name: 'Guide ADA Pro' });
    expect(entry).toHaveAttribute('href', '/pro/guide');
    expect(entry).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByTestId('pro-guide')).toBeInTheDocument();
  });
});
