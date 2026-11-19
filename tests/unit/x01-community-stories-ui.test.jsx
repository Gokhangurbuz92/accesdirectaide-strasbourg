// @vitest-environment jsdom
/**
 * X01 (expansion) — the community story screens in six languages: /histoires (published list: title, PSEUDONYM, text in its own language, date; report form,
 * sign-in needed to report; no image, no comment form), « Mes histoires » (join with a pseudonym never prefilled; the story form: health / disability /
 * other-people warning next to the text field and linked to it, « text only » notice, consent box never pre-ticked, no file field; withdrawal; leaving) and the
 * moderation page (queues, problems, counts per reason — never an account). axe clean (serious / critical), Arabic right-to-left, each story marked with ITS
 * language, no entitlement wording, « not open yet » on 503. The screens stay behind the beta notice with the Production surfaces (admin, accounts).
 * FIXTURES: every story below is a SYNTHETIC TEST FIXTURE (no real person); none of them exists outside this file.
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
import { isBetaRestrictedPath, storiesOpened } from '../../src/lib/publicBeta.js';
import { setLanguage } from '../../src/i18n/index.js';
import CommunityStories from '../../src/pages/CommunityStories.jsx';
import CompteHistoires from '../../src/pages/CompteHistoires.jsx';
import StoriesAdmin from '../../src/pages/admin/StoriesAdmin.jsx';
import { STORY_CONSENT_VERSION } from '../../src/lib/communityStories.js';

const LANGS = ['fr', 'en', 'de', 'tr', 'ar', 'uk'];
// SYNTHETIC TEST FIXTURES — not real stories
const PUBLISHED = { items: [
  { id: '11111111-1111-4111-8111-111111111111', pseudonym: 'Fixture_A', title: 'FIXTURE — titre de test', body: 'FIXTURE SYNTHÉTIQUE — texte de test, aucune personne réelle, pour vérifier l’affichage des histoires.', lang: 'fr', publishedAt: '2026-11-10T10:00:00.000Z' },
  { id: '22222222-2222-4222-8222-222222222222', pseudonym: 'Fixture_B', title: 'عنوان اختباري', body: 'نص اختباري اصطناعي — ليس قصة حقيقية، لاختبار الاتجاه من اليمين إلى اليسار في صفحة القصص.', lang: 'ar', publishedAt: '2026-11-09T10:00:00.000Z' }] };
const MINE_NOT_MEMBER = { available: true, member: null, canSubmit: false, consentVersion: STORY_CONSENT_VERSION, stories: [] };
const MINE_MEMBER = { available: true, member: { pseudonym: 'Fixture_C', createdAt: '2026-11-01T10:00:00.000Z' }, canSubmit: true, consentVersion: STORY_CONSENT_VERSION, stories: [
  { id: '33333333-3333-4333-8333-333333333333', status: 'published', title: 'FIXTURE — publiée', body: 'FIXTURE SYNTHÉTIQUE — mon histoire de test, publiée, assez longue pour la règle.', lang: 'fr', moderationReason: null, submittedAt: '2026-11-01T10:00:00.000Z' },
  { id: '44444444-4444-4444-8444-444444444444', status: 'taken_down', title: null, body: null, lang: 'fr', moderationReason: 'HEALTH_DETAIL', submittedAt: '2026-10-01T10:00:00.000Z' }] };
const ADMIN_PENDING = { items: [{ id: '55555555-5555-4555-8555-555555555555', status: 'pending', pseudonym: 'Fixture_D', title: 'FIXTURE — à refuser', body: 'FIXTURE SYNTHÉTIQUE — vous avez droit à tout, texte de test refusé.', lang: 'fr',
  submittedAt: '2026-11-18T10:00:00.000Z', problems: ['ENTITLEMENT_WORDING'], reports: { total: 0, reasons: {} } }] };
const ADMIN_REPORTED = { items: [{ ...PUBLISHED.items[0], status: 'published', submittedAt: '2026-11-08T10:00:00.000Z', problems: [], reports: { total: 3, reasons: { HEALTH_DETAIL: 2, OFFENSIVE: 1 } } }] };
const FIXTURE_BODY = 'FIXTURE SYNTHÉTIQUE — une histoire de test, assez longue pour être envoyée au service.';

/** @type {Record<string, { status: number, body: any }>} */
let routes = {};
const posted = [];
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
beforeEach(() => {
  posted.length = 0;
  globalThis.document.cookie = '__csrf=x01-test-token; path=/';   // the double-submit cookie the server would have set
  routes = { '/api/stories': { status: 200, body: PUBLISHED }, '/api/citizen/stories': { status: 200, body: MINE_MEMBER },
    '/api/admin/stories?queue=pending': { status: 200, body: ADMIN_PENDING }, '/api/admin/stories?queue=reported': { status: 200, body: ADMIN_REPORTED },
    'POST /api/citizen/stories': { status: 201, body: { id: 'x' } } };
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
  createElement(Route, { path: '/histoires', element: createElement(CommunityStories) }),
  createElement(Route, { path: '/compte/histoires', element: createElement(CompteHistoires) }),
  createElement(Route, { path: '/admin/histoires', element: createElement(StoriesAdmin) })))));
const allText = (c) => [c.textContent, ...[...c.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label'))].join('\n');
const serious = async (c) => (await axe.run(c, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }))
  .violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`);

describe('X01 screens — six languages', () => {
  for (const lang of LANGS) {
    it(`${lang}: public list, join form, Mes histoires (story form with the warning) and moderation render, axe clean, no entitlement wording`, async () => {
      await setLanguage(lang, { persist: false });
      const texts = [];
      const steps = [['/histoires', 'stories-list', null], ['/compte/histoires', 'story-join-form', MINE_NOT_MEMBER], ['/compte/histoires', 'story-form', MINE_MEMBER], ['/admin/histoires', 'story-admin-queue', null]];
      for (const [p, ready, mine] of steps) {
        if (mine) routes['/api/citizen/stories'] = { status: 200, body: mine };
        const { container } = page(p);
        await screen.findByTestId(ready);
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(await serious(container), `${lang} ${p} ${ready}`).toEqual([]);
        // the fixture texts are excluded from the wording check (the admin fixture deliberately contains a refused sentence)
        texts.push(allText(container).split(ADMIN_PENDING.items[0].body).join(''));
        if (ready === 'story-form') {
          const warning = screen.getByTestId('story-health-warning');
          expect(warning.textContent.length, lang).toBeGreaterThan(40);
          expect(container.querySelector('textarea').getAttribute('aria-describedby')).toContain(warning.id);
        }
        if (ready === 'story-join-form') expect(container.querySelector('#story-pseudonym').getAttribute('aria-describedby')).toBe('story-pseudonym-help');
        cleanup();
      }
      for (const t of texts) {
        expect(claimsEntitlement(t)).toBe(false);
        if (ENTITLEMENT_CLAIMS[lang]) expect(ENTITLEMENT_CLAIMS[lang].test(t)).toBe(false);
        expect(t).not.toMatch(/undefined|\{\{|stories:/);
      }
      expect(globalThis.document.documentElement.dir).toBe(lang === 'ar' ? 'rtl' : 'ltr');
    }, 60000);
  }
});

describe('X01 public list', () => {
  it('each story shows its title, pseudonym, text in its own language and direction, a date — nothing else about the person; no image; no comment form', async () => {
    await setLanguage('en', { persist: false });
    const { container } = page('/histoires');
    await screen.findByTestId('stories-list');
    const items = container.querySelectorAll('article');
    expect(items).toHaveLength(2);
    expect(screen.getByRole('heading', { level: 2, name: 'FIXTURE — titre de test' })).toHaveAttribute('lang', 'fr');
    const ar = screen.getByRole('heading', { level: 2, name: 'عنوان اختباري' });
    expect(ar).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText('Fixture_A')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.textContent).not.toMatch(/comment|reply|répondre/i);
  });
  it('an empty list says so (no sample); 503 says « not open yet »', async () => {
    routes['/api/stories'] = { status: 200, body: { items: [] } };
    page('/histoires');
    expect(await screen.findByTestId('stories-empty')).toHaveTextContent('Aucune histoire publiée pour le moment.');
    cleanup();
    routes['/api/stories'] = { status: 503, body: { error: 'CAPABILITY_NOT_OPEN' } };
    const { container } = page('/histoires');
    expect(await screen.findByTestId('stories-closed')).toHaveTextContent('n’est pas encore ouverte');
    expect(await serious(container)).toEqual([]);
  });
  it('reporting: a reason from the closed list is required; without a session the page says an account is needed', async () => {
    routes['POST /api/citizen/stories'] = { status: 401, body: { error: 'Unauthorized' } };
    page('/histoires');
    await screen.findByTestId('stories-list');
    fireEvent.click(screen.getAllByRole('button', { name: 'Signaler cette histoire' })[0]);
    const form = screen.getByTestId('story-report-form');
    expect(form.querySelector('textarea, input[type="text"]')).toBeNull();
    const send = screen.getByRole('button', { name: 'Envoyer le signalement' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Motif du signalement'), { target: { value: 'PERSONAL_DATA' } });
    fireEvent.click(send);
    expect(await screen.findByText(/un compte est nécessaire/)).toBeInTheDocument();
    expect(posted.at(-1).body).toEqual({ action: 'report', id: PUBLISHED.items[0].id, reason: 'PERSONAL_DATA' });
  });
});

describe('X01 Mes histoires', () => {
  it('joining: the pseudonym field is empty (never prefilled from the e-mail); a refusal code is shown in words', async () => {
    routes['/api/citizen/stories'] = { status: 200, body: MINE_NOT_MEMBER };
    routes['POST /api/citizen/stories'] = { status: 400, body: { error: 'PSEUDONYM_FROM_EMAIL', message: 'x' } };
    page('/compte/histoires');
    await screen.findByTestId('story-join-form');
    const input = screen.getByLabelText('Pseudonyme');
    expect(input).toHaveValue('');
    expect(screen.queryByTestId('story-form')).toBeNull();
    fireEvent.change(input, { target: { value: 'jean_dupont' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rejoindre la communauté' }));
    expect(await screen.findByText('N’utilisez pas le début de votre adresse e-mail comme pseudonyme.')).toBeInTheDocument();
    expect(posted.at(-1).body).toEqual({ action: 'join', pseudonym: 'jean_dupont' });
  });
  it('the story form: consent never pre-ticked, submit disabled until consent; no file field; the consent version and the language travel', async () => {
    page('/compte/histoires');
    const form = await screen.findByTestId('story-form');
    expect(screen.getByTestId('story-pseudonym')).toHaveTextContent('Fixture_C');
    expect(form.querySelector('input[type="file"]')).toBeNull();
    const consent = screen.getByTestId('story-consent').querySelector('input');
    expect(consent).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Titre'), { target: { value: 'FIXTURE — un titre' } });
    fireEvent.change(screen.getByLabelText('Votre histoire'), { target: { value: FIXTURE_BODY } });
    const submit = screen.getByRole('button', { name: 'Envoyer pour relecture' });
    expect(submit).toBeDisabled();
    fireEvent.click(consent);
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(posted.some((p) => p.body?.action === 'submit')).toBe(true));
    expect(posted.find((p) => p.body?.action === 'submit').body).toEqual({ action: 'submit', title: 'FIXTURE — un titre', body: FIXTURE_BODY, lang: 'fr', consent: true, consentVersion: STORY_CONSENT_VERSION });
  });
  it('the person’s stories: states, an erased one shows its reason and no text; withdrawal; leaving needs a confirmation', async () => {
    page('/compte/histoires');
    const list = await screen.findByTestId('mine-stories');
    expect(list).toHaveTextContent('Publiée');
    expect(list).toHaveTextContent('Retirée par la modération');
    expect(list).toHaveTextContent('Motif : Détail sur la santé ou un handicap');
    expect(list).toHaveTextContent('Le texte de cette histoire a été effacé.');
    fireEvent.click(screen.getByRole('button', { name: 'Retirer cette histoire' }));
    await waitFor(() => expect(posted.some((p) => p.body?.action === 'withdraw')).toBe(true));
    expect(posted.find((p) => p.body?.action === 'withdraw').body).toEqual({ action: 'withdraw', id: MINE_MEMBER.stories[0].id });
    fireEvent.click(await screen.findByRole('button', { name: 'Quitter la communauté' }));
    expect(posted.some((p) => p.body?.action === 'leave')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer : quitter et tout retirer' }));
    await waitFor(() => expect(posted.some((p) => p.body?.action === 'leave')).toBe(true));
  });
  it('the pending limit hides the form; closed (503) and signed out (401) say so and show no form', async () => {
    routes['/api/citizen/stories'] = { status: 200, body: { ...MINE_MEMBER, canSubmit: false } };
    page('/compte/histoires');
    expect(await screen.findByTestId('story-pending-max')).toBeInTheDocument();
    expect(screen.queryByTestId('story-form')).toBeNull();
    cleanup();
    for (const [status, testId] of [[503, 'stories-closed'], [401, null]]) {
      routes['/api/citizen/stories'] = { status, body: { error: status === 503 ? 'CAPABILITY_NOT_OPEN' : 'Unauthorized' } };
      page('/compte/histoires');
      if (testId) expect(await screen.findByTestId(testId)).toBeInTheDocument(); else expect(await screen.findByRole('alert')).toHaveTextContent('Connectez-vous');
      expect(screen.queryByTestId('story-form')).toBeNull(); expect(screen.queryByTestId('story-join-form')).toBeNull();
      cleanup();
    }
  });
});

describe('X01 moderation page', () => {
  it('pending: the problems block the publication button; a rejection needs a reason; the reported queue shows counts per reason — never an account', async () => {
    page('/admin/histoires');
    await screen.findByTestId('story-admin-queue');
    expect(screen.getByTestId('story-admin-problems')).toHaveTextContent('ENTITLEMENT_WORDING');
    expect(screen.getByRole('button', { name: 'Publier' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refuser (le texte est effacé)' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Signalées' }));
    const reports = await screen.findByTestId('story-admin-reports');
    expect(reports).toHaveTextContent('3 signalement(s) : Détail sur la santé ou un handicap (2), Propos injurieux ou discriminatoires (1)');
    expect(globalThis.document.body.textContent).not.toMatch(/@|citizenUserId|memberId|reporter/);
  });
  it('closed (503) says « not open yet »', async () => {
    routes['/api/admin/stories?queue=pending'] = { status: 503, body: { error: 'CAPABILITY_NOT_OPEN' } };
    page('/admin/histoires');
    expect(await screen.findByTestId('stories-closed')).toBeInTheDocument();
  });
});

describe('X01 screens behind the beta notice', () => {
  it('with the Production surfaces every story screen is restricted; only « stories » opens them; the neighbours are unchanged', () => {
    const screens = ['/histoires', '/compte/histoires', '/admin/histoires'];
    for (const open of [[], ['admin'], ['admin', 'accounts'], ['admin', 'accounts', 'events', 'testimonials']]) {
      for (const scope of ['booking', 'full']) for (const s of screens) expect(isBetaRestrictedPath(s, open, { accountsScope: scope, proSelfRegistration: false }), `${open} ${scope} ${s}`).toBe(true);
    }
    for (const s of screens) expect(isBetaRestrictedPath(s, ['stories'], { accountsScope: 'booking', proSelfRegistration: false })).toBe(false);
    expect(isBetaRestrictedPath('/compte', ['admin', 'accounts'], { accountsScope: 'booking', proSelfRegistration: false })).toBe(false);
    expect(isBetaRestrictedPath('/temoignages', ['stories'], { accountsScope: 'booking', proSelfRegistration: false })).toBe(true);
    expect(storiesOpened(true, ['admin', 'accounts'], { accountsScope: 'full', proSelfRegistration: false })).toBe(false);
    expect(storiesOpened(false, [], { accountsScope: 'booking', proSelfRegistration: false })).toBe(true);
  });
  it('the routes exist in the router; every key has a label in each language file', () => {
    const src = fs.readFileSync('src/pages/index.jsx', 'utf8');
    for (const p of ['/histoires', '/compte/histoires']) expect(src).toContain(`path="${p}"`);
    expect(src).toContain('path="histoires"');
    const en = Object.keys(JSON.parse(fs.readFileSync('src/i18n/locales/en/stories.json', 'utf8'))).sort();
    for (const lang of ['de', 'tr', 'ar', 'uk']) expect(Object.keys(JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/stories.json`, 'utf8'))).sort(), lang).toEqual(en);
    expect(en).toContain('form.health_warning');
  });
});
