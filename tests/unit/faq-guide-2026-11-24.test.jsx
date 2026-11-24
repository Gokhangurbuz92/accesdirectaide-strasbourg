// @vitest-environment jsdom
/**
 * 24/11/2026 — the citizen help pages: « Questions fréquentes » (/questions-frequentes, /faq redirects) and « Guide d’utilisation » (/guide public,
 * /compte/guide in the account area). The pages render, the FAQ search filters the questions in the browser, no help text asserts a right
 * (api/lib/entitlementWording.js), every help link points to a real route, the footer, the home page, Mon Espace and the account menu link to them,
 * and /compte/guide opens with the accounts in the beta. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import QuestionsFrequentes from '../../src/pages/QuestionsFrequentes.jsx';
import GuideUtilisation from '../../src/pages/GuideUtilisation.jsx';
import { buildFaq } from '../../src/components/help/faqContent.js';
import { buildGuide } from '../../src/components/help/guideContent.js';
import { HELP_ROUTES, helpLinks } from '../../src/components/help/helpRoutes.js';
import { EMERGENCY_NUMBERS } from '../../src/components/help/EmergencyNumbers.jsx';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';
import { isBetaRestrictedPath } from '../../src/lib/publicBeta.js';

afterEach(() => cleanup());

/** the French defaults, as the components show them without a translation */
const t = (/** @type {string} */ _key, /** @type {string} */ fallback, /** @type {Record<string, unknown>} */ values = {}) =>
  String(fallback).replace(/\{\{(\w+)\}\}/g, (_, k) => String(values[k] ?? ''));
const src = (/** @type {string} */ p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const show = (/** @type {import('react').ReactElement} */ el, path = '/') => render(h(HelmetProvider, null, h(MemoryRouter, { initialEntries: [path] }, el)));

describe('the help pages render', () => {
  it('« Questions fréquentes »: one h1, every section and question, the emergency numbers', () => {
    show(h(QuestionsFrequentes), '/questions-frequentes');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Questions fréquentes');
    const sections = buildFaq(t);
    const total = sections.reduce((n, s) => n + s.items.length, 0);
    expect(total).toBeGreaterThanOrEqual(40);
    expect(screen.getAllByTestId('faq-section')).toHaveLength(sections.length);
    expect(screen.getAllByTestId('faq-item')).toHaveLength(total);
    // native accordions: each question is a <summary> of a <details>
    for (const d of screen.getAllByTestId('faq-item')) { expect(d.tagName).toBe('DETAILS'); expect(d.querySelector('summary')).not.toBeNull(); }
    const numbers = within(screen.getByTestId('faq-emergency')).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(numbers).toEqual(EMERGENCY_NUMBERS.map((n) => `tel:${n}`));
  });

  it('the search filters the questions in the browser, and says when nothing matches', () => {
    show(h(QuestionsFrequentes), '/questions-frequentes');
    const all = screen.getAllByTestId('faq-item').length;
    fireEvent.change(screen.getByTestId('faq-search'), { target: { value: 'mot de passe' } });
    const found = screen.getAllByTestId('faq-item');
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThan(all);
    for (const d of found) expect(d.textContent.toLowerCase()).toContain('mot de passe');
    expect(found.every((d) => d.open)).toBe(true);   // the matching answers are shown open
    expect(screen.getByTestId('faq-count')).toHaveTextContent(`${found.length} question(s) sur ${all}`);
    // accents and case do not matter
    fireEvent.change(screen.getByTestId('faq-search'), { target: { value: 'ACCESSIBILITE' } });
    expect(screen.getAllByTestId('faq-item').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByTestId('faq-search'), { target: { value: 'zzzz introuvable' } });
    expect(screen.queryAllByTestId('faq-item')).toHaveLength(0);
    expect(screen.getByTestId('faq-empty')).toBeInTheDocument();
  });

  it('« Guide d’utilisation » public: one h1, a table of contents, the account steps marked « Après connexion »', () => {
    show(h(GuideUtilisation), '/guide');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const sections = buildGuide(t);
    expect(screen.getAllByTestId('guide-section')).toHaveLength(sections.length);
    const toc = screen.getByRole('navigation', { name: 'Sommaire' });
    expect(within(toc).getAllByRole('link')).toHaveLength(sections.length);
    expect(screen.getByTestId('guide-account-note')).toBeInTheDocument();
    expect(screen.getAllByText('Après connexion').length).toBe(sections.filter((s) => s.account).length + 1);
    expect(sections.reduce((n, s) => n + s.steps.length, 0)).toBeGreaterThanOrEqual(40);
  });

  it('/compte/guide: the same guide without the « Après connexion » marks', () => {
    show(h(GuideUtilisation, { account: true }), '/compte/guide');
    expect(screen.getByTestId('guide-page-account')).toBeInTheDocument();
    expect(screen.queryByText('Après connexion')).toBeNull();
    expect(screen.getAllByTestId('guide-link').some((a) => a.getAttribute('href') === '/compte/parcours')).toBe(true);
  });
});

describe('the help texts', () => {
  const faq = buildFaq(t);
  const guide = buildGuide(t);
  const texts = [...faq.flatMap((s) => [s.title, ...s.items.flatMap((it) => [it.q, it.a])]), ...guide.flatMap((s) => [s.title, ...s.steps])];

  it('never assert a right (entitlement wording guard), and say who decides', () => {
    for (const x of texts) expect(claimsEntitlement(x), x).toBe(false);
    expect(texts.join(' ')).toMatch(/seul l’organisme concerné décide/);
    // the French translations of these texts are checked by scripts/i18n-check.mjs (tests/unit/r32-i18n-completeness.test.js)
  });

  it('every link points to a route of the application', () => {
    const index = src('src/pages/index.jsx');
    const routes = new Set([...index.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]));
    // the ADA Pro screens are children of <Route path="/pro"> (relative paths)
    const pro = index.slice(index.indexOf('<Route path="/pro" element'), index.indexOf('</Route>', index.indexOf('<Route path="/pro" element')));
    for (const m of pro.matchAll(/<Route path="([a-z][^"]*)"/g)) routes.add(`/pro/${m[1]}`);
    for (const p of HELP_ROUTES) expect(routes.has(p), p).toBe(true);
    for (const p of ['/questions-frequentes', '/faq', '/guide', '/compte/guide']) expect(routes.has(p), p).toBe(true);
    const used = [...faq.flatMap((s) => s.items.flatMap((it) => it.links || [])), ...guide.flatMap((s) => s.where || [])];
    for (const p of used) expect(HELP_ROUTES, p).toContain(p);
    // during the beta, a closed screen is not offered as a link (same rule as the footer)
    expect(helpLinks(t, ['/aides', '/contact'], true).map((l) => l.to)).toEqual(isBetaRestrictedPath('/contact') ? ['/aides'] : ['/aides', '/contact']);
  });
});

describe('where the help pages are offered', () => {
  it('the footer « À propos » column, the home page, Mon Espace and the account menu link to them', () => {
    const layout = src('src/pages/Layout.jsx');
    const about = layout.slice(layout.indexOf('const FOOTER_ABOUT'), layout.indexOf('const FOOTER_LEGAL'));
    expect(about).toContain("href: '/questions-frequentes'");
    expect(about).toContain("href: '/guide'");
    expect(src('src/pages/Home.jsx')).toContain('to="/questions-frequentes"');
    expect(src('src/pages/MonEspace.jsx')).toContain("to: '/compte/guide'");
    expect(src('src/components/auth/AuthHeaderActions.jsx').match(/to="\/compte\/guide"/g)).toHaveLength(2);
  });

  it('beta: /questions-frequentes and /guide are public; /compte/guide opens with the accounts, in the narrow scope too', () => {
    const narrow = { accountsScope: /** @type {'booking'} */ ('booking'), proSelfRegistration: false };
    expect(isBetaRestrictedPath('/questions-frequentes', [], narrow)).toBe(false);
    expect(isBetaRestrictedPath('/guide', [], narrow)).toBe(false);
    expect(isBetaRestrictedPath('/compte/guide', [], narrow)).toBe(true);
    expect(isBetaRestrictedPath('/compte/guide', ['accounts'], narrow)).toBe(false);
    expect(isBetaRestrictedPath('/compte/guide', ['accounts'], { ...narrow, accountsScope: 'full' })).toBe(false);
  });
});
