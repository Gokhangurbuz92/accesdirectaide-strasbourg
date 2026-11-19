// @vitest-environment jsdom
/**
 * X05 (expansion) — the job board screens in six languages: /offres-emploi (published listings: post, employer, contract, place, accommodations, the
 * employer's own way to apply; the notice that ADA receives and keeps nothing about applicants and that no health / disability detail is needed; no form),
 * /pro/offres-emploi (the employer form: required fields only, the L1132-1 rule and the « never ask for health details » rule linked to the fields, closed
 * lists as checkboxes / radios, no field for a selection criterion, no file field; the organization's listings with their state and the review reason) and
 * /admin/offres-emploi (queues, problems, employer verification). axe clean (serious / critical), Arabic right-to-left, the employer's French texts marked
 * lang="fr", no entitlement wording, « not open yet » on 503. The screens stay behind the beta notice with the Production surfaces, « pro » included.
 * FIXTURES: every listing below is a SYNTHETIC TEST FIXTURE (no real employer); none of them exists outside this file.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';
import { ENTITLEMENT_CLAIMS } from '../../scripts/i18n-check.mjs';
import { isBetaRestrictedPath } from '../../src/lib/publicBeta.js';
import { setLanguage } from '../../src/i18n/index.js';
import JobBoard from '../../src/pages/JobBoard.jsx';
import JobListings from '../../src/pages/pro/JobListings.jsx';
import JobBoardAdmin from '../../src/pages/admin/JobBoardAdmin.jsx';

const LANGS = ['fr', 'en', 'de', 'tr', 'ar', 'uk'];
// SYNTHETIC TEST FIXTURES — not real listings
const L1 = { id: '11111111-1111-4111-8111-111111111111', title: 'FIXTURE — agent d’accueil', contractType: 'CDI', city: 'Strasbourg', postalCode: '67000',
  description: 'FIXTURE SYNTHÉTIQUE — description de test, aucun employeur réel, pour vérifier l’affichage des offres.', accommodations: ['STEP_FREE_ACCESS', 'FLEXIBLE_HOURS'],
  applyMethod: 'url', applyTarget: 'https://employeur.example.test/candidature', expiresOn: '2026-12-19', publishedAt: '2026-11-19T10:00:00.000Z', employerName: 'FIXTURE employeur A' };
const L2 = { ...L1, id: '22222222-2222-4222-8222-222222222222', contractType: 'CDDI', applyMethod: 'email', applyTarget: 'recrutement@employeur.example.test', employerName: 'FIXTURE employeur B' };
const MINE = { available: true, canManage: true, employerVerified: true, employer: { name: 'FIXTURE employeur A' }, limits: { openMax: 30, expiryMaxDays: 90 }, listings: [
  { ...L1, status: 'draft', moderationReason: null }, { ...L2, status: 'rejected', moderationReason: 'HEALTH_DATA_REQUESTED' }] };
const ADMIN_PENDING = { items: [{ ...L1, status: 'pending', submittedAt: '2026-11-18T10:00:00.000Z', employerVerified: false, problems: ['EMPLOYER_NOT_VERIFIED'] }] };

let routes = {};
const posted = [];
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
beforeEach(() => {
  posted.length = 0;
  globalThis.document.cookie = '__csrf=x05-test-token; path=/';
  globalThis.localStorage.setItem('pro_token', 'SYNTHETIC');
  routes = { '/api/employment': { status: 200, body: { items: [L1, L2] } }, '/api/pro/employment': { status: 200, body: MINE },
    '/api/admin/employment?queue=pending': { status: 200, body: ADMIN_PENDING }, '/api/admin/employment?queue=published': { status: 200, body: { items: [] } },
    'POST /api/pro/employment': { status: 201, body: { id: 'x' } } };
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (method !== 'GET') posted.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    const r = routes[method === 'GET' ? String(url) : `${method} ${url}`] || routes[String(url)];
    return r ? reply(r.status, r.body) : reply(404, { error: 'NOT_FOUND' });
  });
});
afterEach(async () => { cleanup(); vi.restoreAllMocks(); globalThis.localStorage.removeItem('pro_token'); await setLanguage('fr', { persist: false }); });
afterAll(async () => { await setLanguage('fr', { persist: false }); });

const page = (p) => render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [p] }, createElement(Routes, null,
  createElement(Route, { path: '/offres-emploi', element: createElement(JobBoard) }),
  createElement(Route, { path: '/pro/offres-emploi', element: createElement(JobListings) }),
  createElement(Route, { path: '/admin/offres-emploi', element: createElement(JobBoardAdmin) })))));
const allText = (c) => [c.textContent, ...[...c.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label'))].join('\n');
const serious = async (c) => (await axe.run(c, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }))
  .violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`);

describe('X05 screens — six languages', () => {
  for (const lang of LANGS) {
    it(`${lang}: public board, employer form and review render, axe clean, no entitlement wording`, async () => {
      await setLanguage(lang, { persist: false });
      const texts = [];
      for (const [p, ready] of [['/offres-emploi', 'jobs-list'], ['/pro/offres-emploi', 'job-form'], ['/admin/offres-emploi', 'job-admin-queue']]) {
        const { container } = page(p);
        await screen.findByTestId(ready);
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(await serious(container), `${lang} ${p}`).toEqual([]);
        texts.push(allText(container));
        if (ready === 'jobs-list') expect(screen.getByTestId('jobs-privacy-notice').textContent.length, lang).toBeGreaterThan(80);
        if (ready === 'job-form') {
          expect(screen.getByTestId('job-rules').textContent).toContain('L1132-1');
          expect(container.querySelector('#job-description').getAttribute('aria-describedby')).toContain('job-rules');
        }
        cleanup();
      }
      for (const t of texts) {
        expect(claimsEntitlement(t)).toBe(false);
        if (ENTITLEMENT_CLAIMS[lang]) expect(ENTITLEMENT_CLAIMS[lang].test(t)).toBe(false);
        expect(t).not.toMatch(/undefined|\{\{|employment:/);
      }
      expect(globalThis.document.documentElement.dir).toBe(lang === 'ar' ? 'rtl' : 'ltr');
    }, 60000);
  }
});

describe('X05 public board', () => {
  it('each listing: title, employer, contract, place, accommodations, the employer’s own channel (new tab without referrer, or mailto); French texts marked lang="fr"; no form', async () => {
    await setLanguage('en', { persist: false });
    const { container } = page('/offres-emploi');
    await screen.findByTestId('jobs-list');
    expect(container.querySelectorAll('article')).toHaveLength(2);
    const h = screen.getAllByRole('heading', { level: 2 })[0];
    expect(h).toHaveTextContent(L1.title); expect(h).toHaveAttribute('lang', 'fr');
    const link = container.querySelector(`a[href="${L1.applyTarget}"]`);
    expect(link).toHaveAttribute('target', '_blank'); expect(link.getAttribute('rel')).toContain('noreferrer');
    expect(container.querySelector(`a[href="mailto:${L2.applyTarget}"]`)).not.toBeNull();
    expect(container.textContent).toContain('Premises with step-free or lift access');
    expect(container.querySelector('form, input, textarea, select')).toBeNull();
  });
  it('an empty board says so; a closed one says « not open yet »', async () => {
    routes['/api/employment'] = { status: 200, body: { items: [] } };
    page('/offres-emploi'); await screen.findByTestId('jobs-empty'); cleanup();
    routes['/api/employment'] = { status: 503, body: { error: 'CAPABILITY_NOT_OPEN' } };
    page('/offres-emploi'); await screen.findByTestId('jobs-closed');
  });
});

describe('X05 employer screen', () => {
  it('the form has the required fields only: no field for a selection criterion, no file; the listings show their state and the review reason', async () => {
    const { container } = page('/pro/offres-emploi');
    await screen.findByTestId('job-form');
    const names = [...container.querySelectorAll('input, select, textarea')].map((e) => `${e.id} ${e.name} ${e.type}`).join(' ');
    expect(names).not.toMatch(/age|sex|gender|nation|origin|health|sante|handicap|disab|file|photo/i);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(10);
    expect(screen.getByTestId('job-mine-list').textContent).toContain('Demande d’informations sur la santé ou un handicap');
  });
  it('saving sends exactly the listing fields; a server refusal is shown', async () => {
    const { container } = page('/pro/offres-emploi');
    await screen.findByTestId('job-form');
    fireEvent.change(container.querySelector('#job-title'), { target: { value: 'FIXTURE poste' } });
    fireEvent.click(container.querySelectorAll('input[type="checkbox"]')[2]);
    routes['POST /api/pro/employment'] = { status: 400, body: { error: 'CONTRACT_TYPE_REQUIRED', problems: ['CONTRACT_TYPE_REQUIRED'] } };
    fireEvent.submit(screen.getByTestId('job-form'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(Object.keys(posted[0].body).sort()).toEqual(['accommodations', 'action', 'applyMethod', 'applyTarget', 'city', 'contractType', 'description', 'expiresOn', 'postalCode', 'title']);
    expect(posted[0].body).toMatchObject({ action: 'create', title: 'FIXTURE poste', accommodations: ['FLEXIBLE_HOURS'] });
    await screen.findByText('Choisissez le type de contrat.');
  });
  it('an organization not verified sees why it cannot send; a member without the role sees it is reserved; closed says « not open yet »', async () => {
    routes['/api/pro/employment'] = { status: 200, body: { ...MINE, employerVerified: false } };
    page('/pro/offres-emploi'); await screen.findByTestId('jobs-not-verified'); cleanup();
    routes['/api/pro/employment'] = { status: 200, body: { ...MINE, canManage: false, listings: [] } };
    page('/pro/offres-emploi'); await screen.findByTestId('jobs-not-manager'); cleanup();
    routes['/api/pro/employment'] = { status: 503, body: { error: 'CAPABILITY_NOT_OPEN' } };
    page('/pro/offres-emploi'); await screen.findByTestId('jobs-closed');
  });
});

describe('X05 review screen and the beta notice', () => {
  it('a pending listing of an unverified employer shows the problem and cannot be published', async () => {
    page('/admin/offres-emploi');
    await screen.findByTestId('job-admin-problems');
    expect(screen.getByRole('button', { name: 'Publier' })).toBeDisabled();
  });
  it('the three screens stay behind the beta notice with the Production surfaces (admin, accounts — and pro)', () => {
    for (const p of ['/offres-emploi', '/pro/offres-emploi', '/admin/offres-emploi']) expect(isBetaRestrictedPath(p, ['admin', 'accounts', 'pro'], { accountsScope: 'booking', proSelfRegistration: false }), p).toBe(true);
  });
});
