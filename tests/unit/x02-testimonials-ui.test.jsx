// @vitest-environment jsdom
/**
 * X02 (expansion) — the testimonial screens in six languages: /temoignages (published list, report form, sign-in needed to report), « Mes témoignages »
 * (the form: name never prefilled, the health / disability warning next to the text field and linked to it, the consent box never pre-ticked, no photo or
 * file field; the person's own testimonials and the withdrawal) and the moderation page (queues, problems, counts per reason — never an account). axe clean
 * (serious / critical), Arabic right-to-left, each testimonial marked with ITS language, no entitlement wording, « not open yet » on 503. The screens stay
 * behind the beta notice with the Production surfaces (admin, accounts). No JSX here.
 * FIXTURES: every testimonial below is a SYNTHETIC TEST FIXTURE (no real person); none of them exists outside this file.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import fs from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';
import { ENTITLEMENT_CLAIMS } from '../../scripts/i18n-check.mjs';
import { isBetaRestrictedPath, testimonialsOpened } from '../../src/lib/publicBeta.js';
import { setLanguage } from '../../src/i18n/index.js';
import Testimonials from '../../src/pages/Testimonials.jsx';
import CompteTemoignages from '../../src/pages/CompteTemoignages.jsx';
import TestimonialsAdmin from '../../src/pages/admin/TestimonialsAdmin.jsx';
import { TESTIMONIAL_CONSENT_VERSION } from '../../src/lib/testimonials.js';

const LANGS = ['fr', 'en', 'de', 'tr', 'ar', 'uk'];
// SYNTHETIC TEST FIXTURES — not real testimonials
const PUBLISHED = { items: [
  { id: '11111111-1111-4111-8111-111111111111', displayName: 'Fixture-A', body: 'FIXTURE SYNTHÉTIQUE — texte de test, aucune personne réelle, pour vérifier l’affichage.', lang: 'fr', publishedAt: '2026-11-10T10:00:00.000Z' },
  { id: '22222222-2222-4222-8222-222222222222', displayName: 'Fixture-B', body: 'نص اختباري اصطناعي — ليس شهادة حقيقية، لاختبار الاتجاه من اليمين إلى اليسار.', lang: 'ar', publishedAt: '2026-11-09T10:00:00.000Z' }] };
const MINE_EMPTY = { available: true, canSubmit: true, consentVersion: TESTIMONIAL_CONSENT_VERSION, testimonials: [] };
const MINE_ACTIVE = { available: true, canSubmit: false, consentVersion: TESTIMONIAL_CONSENT_VERSION, testimonials: [
  { id: '33333333-3333-4333-8333-333333333333', status: 'published', displayName: 'Fixture-C', body: 'FIXTURE SYNTHÉTIQUE — mon témoignage de test, publié.', lang: 'fr', moderationReason: null, submittedAt: '2026-11-01T10:00:00.000Z' },
  { id: '44444444-4444-4444-8444-444444444444', status: 'taken_down', displayName: null, body: null, lang: 'fr', moderationReason: 'HEALTH_DETAIL', submittedAt: '2026-10-01T10:00:00.000Z' }] };
const ADMIN_PENDING = { items: [{ id: '55555555-5555-4555-8555-555555555555', status: 'pending', displayName: 'Fixture-D', body: 'FIXTURE SYNTHÉTIQUE — vous avez droit à tout, texte de test refusé.', lang: 'fr',
  submittedAt: '2026-11-18T10:00:00.000Z', problems: ['ENTITLEMENT_WORDING'], reports: { total: 0, reasons: {} } }] };
const ADMIN_REPORTED = { items: [{ ...PUBLISHED.items[0], status: 'published', submittedAt: '2026-11-08T10:00:00.000Z', problems: [], reports: { total: 3, reasons: { HEALTH_DETAIL: 2, OFFENSIVE: 1 } } }] };

/** @type {Record<string, { status: number, body: any }>} */
let routes = {};
const posted = [];
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
beforeEach(() => {
  posted.length = 0;
  globalThis.document.cookie = '__csrf=x02-test-token; path=/';   // the double-submit cookie the server would have set
  routes = { '/api/testimonials': { status: 200, body: PUBLISHED }, '/api/citizen/testimonials': { status: 200, body: MINE_EMPTY },
    '/api/admin/testimonials?queue=pending': { status: 200, body: ADMIN_PENDING }, '/api/admin/testimonials?queue=reported': { status: 200, body: ADMIN_REPORTED },
    'POST /api/citizen/testimonials': { status: 201, body: { id: 'x' } } };
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (method !== 'GET') posted.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    const r = routes[method === 'GET' ? String(url) : `${method} ${url}`] || routes[String(url)];
    return r ? reply(r.status, r.body) : reply(404, { error: 'NOT_FOUND' });
  });
});
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await setLanguage('fr', { persist: false }); });
afterAll(async () => { await setLanguage('fr', { persist: false }); });

const page = (p) => render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [p] }, createElement(Routes, null,
  createElement(Route, { path: '/temoignages', element: createElement(Testimonials) }),
  createElement(Route, { path: '/compte/temoignages', element: createElement(CompteTemoignages) }),
  createElement(Route, { path: '/admin/temoignages', element: createElement(TestimonialsAdmin) })))));
const allText = (c) => [c.textContent, ...[...c.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label'))].join('\n');
const serious = async (c) => (await axe.run(c, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }))
  .violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`);

describe('X02 screens — six languages', () => {
  for (const lang of LANGS) {
    it(`${lang}: public list, Mes témoignages (form with the health warning) and moderation render, axe clean, no entitlement wording`, async () => {
      await setLanguage(lang, { persist: false });
      const texts = [];
      for (const [p, ready] of [['/temoignages', 'testimonials-list'], ['/compte/temoignages', 'testimonial-form'], ['/admin/temoignages', 'admin-queue']]) {
        const { container } = page(p);
        await screen.findByTestId(ready);
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(await serious(container), `${lang} ${p}`).toEqual([]);
        // the fixture texts are excluded from the wording check (the admin fixture deliberately contains a refused sentence)
        texts.push(allText(container).split(ADMIN_PENDING.items[0].body).join(''));
        if (p === '/compte/temoignages') {
          const warning = screen.getByTestId('health-warning');
          expect(warning.textContent.length, lang).toBeGreaterThan(40);
          expect(container.querySelector('textarea').getAttribute('aria-describedby')).toContain(warning.id);
        }
        cleanup();
      }
      for (const t of texts) {
        expect(claimsEntitlement(t)).toBe(false);
        if (ENTITLEMENT_CLAIMS[lang]) expect(ENTITLEMENT_CLAIMS[lang].test(t)).toBe(false);
        expect(t).not.toMatch(/undefined|\{\{|testimonials:/);
      }
      expect(globalThis.document.documentElement.dir).toBe(lang === 'ar' ? 'rtl' : 'ltr');
    }, 60000);
  }
});

describe('X02 public list', () => {
  it('each testimonial shows its chosen name, its text in its own language and direction, a date — and nothing else about the person', async () => {
    await setLanguage('en', { persist: false });
    page('/temoignages');
    await screen.findByTestId('testimonials-list');
    const quotes = globalThis.document.querySelectorAll('blockquote');
    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toHaveAttribute('lang', 'fr'); expect(quotes[0]).toHaveAttribute('dir', 'ltr');
    expect(quotes[1]).toHaveAttribute('lang', 'ar'); expect(quotes[1]).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText('Fixture-A')).toBeInTheDocument();
    expect(globalThis.document.querySelector('img')).toBeNull();
  });
  it('an empty list says so (no sample); 503 says « not open yet »', async () => {
    routes['/api/testimonials'] = { status: 200, body: { items: [] } };
    page('/temoignages');
    expect(await screen.findByTestId('testimonials-empty')).toHaveTextContent('Aucun témoignage publié pour le moment.');
    cleanup();
    routes['/api/testimonials'] = { status: 503, body: { error: 'CAPABILITY_NOT_OPEN' } };
    const { container } = page('/temoignages');
    expect(await screen.findByTestId('testimonials-closed')).toHaveTextContent('n’est pas encore ouverte');
    expect(await serious(container)).toEqual([]);
  });
  it('reporting: a reason from the closed list is required; without a session the page says an account is needed', async () => {
    routes['POST /api/citizen/testimonials'] = { status: 401, body: { error: 'Unauthorized' } };
    page('/temoignages');
    await screen.findByTestId('testimonials-list');
    fireEvent.click(screen.getAllByRole('button', { name: 'Signaler ce témoignage' })[0]);
    const form = screen.getByTestId('report-form');
    expect(form.querySelector('textarea, input[type="text"]')).toBeNull();
    const send = screen.getByRole('button', { name: 'Envoyer le signalement' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Motif du signalement'), { target: { value: 'HEALTH_DETAIL' } });
    fireEvent.click(send);
    expect(await screen.findByText(/un compte est nécessaire/)).toBeInTheDocument();
    expect(posted.at(-1).body).toEqual({ action: 'report', id: PUBLISHED.items[0].id, reason: 'HEALTH_DETAIL' });
  });
});

describe('X02 Mes témoignages', () => {
  it('the form: name empty (never prefilled), consent never pre-ticked, submit disabled until consent; no file field; the consent version travels', async () => {
    page('/compte/temoignages');
    const form = await screen.findByTestId('testimonial-form');
    expect(screen.getByLabelText('Prénom ou pseudonyme')).toHaveValue('');
    expect(form.querySelector('input[type="file"]')).toBeNull();
    const consent = screen.getByTestId('testimonial-consent').querySelector('input');
    expect(consent).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Prénom ou pseudonyme'), { target: { value: 'Fixture' } });
    fireEvent.change(screen.getByLabelText('Votre témoignage'), { target: { value: 'FIXTURE SYNTHÉTIQUE — un texte de test assez long pour être envoyé.' } });
    const submit = screen.getByRole('button', { name: 'Envoyer pour relecture' });
    expect(submit).toBeDisabled();
    fireEvent.click(consent);
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(posted.some((p) => p.body?.action === 'submit')).toBe(true));
    expect(posted.find((p) => p.body?.action === 'submit').body).toEqual({ action: 'submit', displayName: 'Fixture', body: 'FIXTURE SYNTHÉTIQUE — un texte de test assez long pour être envoyé.',
      lang: 'fr', consent: true, consentVersion: TESTIMONIAL_CONSENT_VERSION });
  });
  it('an active testimonial: its state, the withdrawal button (immediate, text erased); an erased one shows its reason and no text; no second form', async () => {
    routes['/api/citizen/testimonials'] = { status: 200, body: MINE_ACTIVE };
    page('/compte/temoignages');
    const list = await screen.findByTestId('mine-testimonials');
    expect(list).toHaveTextContent('Publié');
    expect(list).toHaveTextContent('Retiré par la modération');
    expect(list).toHaveTextContent('Motif : Détail sur la santé ou un handicap');
    expect(list).toHaveTextContent('Le texte de ce témoignage a été effacé.');
    expect(screen.getByTestId('one-active')).toBeInTheDocument();
    expect(screen.queryByTestId('testimonial-form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retirer mon témoignage' }));
    await waitFor(() => expect(posted.some((p) => p.body?.action === 'withdraw')).toBe(true));
    expect(posted.find((p) => p.body?.action === 'withdraw').body).toEqual({ action: 'withdraw', id: MINE_ACTIVE.testimonials[0].id });
  });
  it('closed (503) and signed out (401) say so and show no form', async () => {
    for (const [status, testId] of [[503, 'testimonials-closed'], [401, null]]) {
      routes['/api/citizen/testimonials'] = { status, body: { error: status === 503 ? 'CAPABILITY_NOT_OPEN' : 'Unauthorized' } };
      page('/compte/temoignages');
      if (testId) expect(await screen.findByTestId(testId)).toBeInTheDocument(); else expect(await screen.findByRole('alert')).toHaveTextContent('Connectez-vous');
      expect(screen.queryByTestId('testimonial-form')).toBeNull();
      cleanup();
    }
  });
});

describe('X02 moderation page', () => {
  it('pending: the problems block the publication button; a rejection needs a reason; the reported queue shows counts per reason — never an account', async () => {
    page('/admin/temoignages');
    await screen.findByTestId('admin-queue');
    expect(screen.getByTestId('admin-problems')).toHaveTextContent('ENTITLEMENT_WORDING');
    expect(screen.getByRole('button', { name: 'Publier' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refuser (le texte est effacé)' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Signalés' }));
    const reports = await screen.findByTestId('admin-reports');
    expect(reports).toHaveTextContent('3 signalement(s) : Détail sur la santé ou un handicap (2), Propos injurieux ou discriminatoires (1)');
    expect(globalThis.document.body.textContent).not.toMatch(/@|citizenUserId|reporter/);
  });
  it('closed (503) says « not open yet »', async () => {
    routes['/api/admin/testimonials?queue=pending'] = { status: 503, body: { error: 'CAPABILITY_NOT_OPEN' } };
    page('/admin/temoignages');
    expect(await screen.findByTestId('testimonials-closed')).toBeInTheDocument();
  });
});

describe('X02 screens behind the beta notice', () => {
  it('with the Production surfaces every testimonial screen is restricted; only « testimonials » opens them; the neighbours are unchanged', () => {
    const screens = ['/temoignages', '/compte/temoignages', '/admin/temoignages'];
    for (const open of [[], ['admin'], ['admin', 'accounts'], ['admin', 'accounts', 'events']]) {
      for (const scope of ['booking', 'full']) for (const s of screens) expect(isBetaRestrictedPath(s, open, { accountsScope: scope, proSelfRegistration: false }), `${open} ${scope} ${s}`).toBe(true);
    }
    for (const s of screens) expect(isBetaRestrictedPath(s, ['testimonials'], { accountsScope: 'booking', proSelfRegistration: false })).toBe(false);
    expect(isBetaRestrictedPath('/compte', ['admin', 'accounts'], { accountsScope: 'booking', proSelfRegistration: false })).toBe(false);
    expect(isBetaRestrictedPath('/evenements', ['testimonials'], { accountsScope: 'booking', proSelfRegistration: false })).toBe(true);
    expect(testimonialsOpened(true, ['admin', 'accounts'], { accountsScope: 'full', proSelfRegistration: false })).toBe(false);
    expect(testimonialsOpened(false, [], { accountsScope: 'booking', proSelfRegistration: false })).toBe(true);
  });
  it('the routes exist in the router; every key has a label in each language file', () => {
    const src = fs.readFileSync('src/pages/index.jsx', 'utf8');
    for (const p of ['/temoignages', '/compte/temoignages']) expect(src).toContain(`path="${p}"`);
    expect(src).toContain('path="temoignages"');
    const en = Object.keys(JSON.parse(fs.readFileSync('src/i18n/locales/en/testimonials.json', 'utf8'))).sort();
    for (const lang of ['de', 'tr', 'ar', 'uk']) expect(Object.keys(JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/testimonials.json`, 'utf8'))).sort(), lang).toEqual(en);
    expect(en).toContain('form.health_warning');
  });
});
