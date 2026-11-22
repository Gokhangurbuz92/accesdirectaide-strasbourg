// @vitest-environment jsdom
/**
 * G14 — the moderation screens in six languages: « Signaler un contenu » (DSA art. 16: the four elements, name and e-mail optional only for a child-safety
 * notice, the emergency numbers first), « Décisions de modération » (statements and appeals, art. 17 / 20), the moderation desk (staffing, named roles) and
 * the statement fields the four moderation pages now require before a restriction. axe clean (serious / critical), Arabic right-to-left, no entitlement
 * wording, « not open yet » on 503. The notice screens stay behind the beta notice with the Production surfaces (admin, accounts).
 * FIXTURES: every decision, notice and address below is a SYNTHETIC TEST FIXTURE.
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
import { isBetaRestrictedPath, noticesOpened } from '../../src/lib/publicBeta.js';
import { setLanguage } from '../../src/i18n/index.js';
import ContentNotice from '../../src/pages/ContentNotice.jsx';
import CompteModeration from '../../src/pages/CompteModeration.jsx';
import ModerationAdmin from '../../src/pages/admin/ModerationAdmin.jsx';
import TestimonialsAdmin from '../../src/pages/admin/TestimonialsAdmin.jsx';

const LANGS = ['fr', 'en', 'de', 'tr', 'ar', 'uk'];
const DECISION = { id: '66666666-6666-4666-8666-666666666666', role: 'author', contentType: 'testimonial', action: 'taken_down', reasonCode: 'PERSONAL_DATA', decidedAt: '2026-11-20T10:00:00.000Z',
  appealUntil: '2027-05-20T10:00:00.000Z', statement: 'FIXTURE — Décision de modération du 2026-11-20 concernant votre témoignage : a été retiré(e).\n\nMoyens automatisés : aucun.', appeal: null, canAppeal: true };
const STAFFING = { available: true, moderators: 1, safetyOfficers: 0, staff: [{ name: 'Fixture Modératrice', email: 'mod@example.test', role: 'MODERATOR', assignedAt: '2026-11-22T10:00:00.000Z' }],
  features: { testimonials: { staffed: true, reason: null }, stories: { staffed: true, reason: null }, employment: { staffed: true, reason: null }, notices: { staffed: true, reason: null },
    entraide: { staffed: false, reason: 'NO_NAMED_SAFETY_OFFICER' }, events: { staffed: true, reason: null } } };
const ADMIN_REPORTED = { items: [{ id: '77777777-7777-4777-8777-777777777777', status: 'published', displayName: 'Fixture', body: 'FIXTURE SYNTHÉTIQUE — texte publié pour le test de modération.', lang: 'fr',
  submittedAt: '2026-11-08T10:00:00.000Z', problems: [], reports: { total: 1, reasons: { PERSONAL_DATA: 1 } } }] };

let routes = {};
const posted = [];
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
beforeEach(() => {
  posted.length = 0;
  globalThis.document.cookie = '__csrf=g14-test-token; path=/';
  routes = {
    '/api/notices': { status: 200, body: { available: true, staffed: true, categories: [], contentTypes: [] } },
    'POST /api/notices': { status: 201, body: { id: '88888888-8888-4888-8888-888888888888', priority: 'ordinary' } },
    '/api/citizen/moderation': { status: 200, body: { available: true, decisions: [DECISION] } },
    'POST /api/citizen/moderation': { status: 201, body: { id: 'a1' } },
    '/api/admin/moderation?view=staffing': { status: 200, body: STAFFING },
    '/api/admin/moderation?view=appeals': { status: 200, body: { items: [] } },
    '/api/admin/moderation?view=notices': { status: 200, body: { items: [] } },
    '/api/admin/moderation?view=transparency': { status: 200, body: { automatedDecisions: 0 } },
    'POST /api/admin/moderation': { status: 201, body: { id: 'r1' } },
    '/api/admin/testimonials?queue=pending': { status: 200, body: ADMIN_REPORTED },
    '/api/admin/testimonials?queue=reported': { status: 200, body: ADMIN_REPORTED },
    'POST /api/admin/testimonials': { status: 200, body: { id: 'x', status: 'taken_down', decisionId: 'd1' } },
  };
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
  createElement(Route, { path: '/signaler-un-contenu', element: createElement(ContentNotice) }),
  createElement(Route, { path: '/compte/moderation', element: createElement(CompteModeration) }),
  createElement(Route, { path: '/admin/moderation', element: createElement(ModerationAdmin) }),
  createElement(Route, { path: '/admin/temoignages', element: createElement(TestimonialsAdmin) })))));
const allText = (c) => [c.textContent, ...[...c.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label'))].join('\n');
const serious = async (c) => (await axe.run(c, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }))
  .violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`);

describe('G14 moderation screens — six languages', () => {
  for (const lang of LANGS) {
    it(`${lang}: notice form, my decisions and the moderation desk render, axe clean, no entitlement wording, RTL for Arabic`, async () => {
      await setLanguage(lang, { persist: false });
      for (const [p, ready] of [['/signaler-un-contenu', 'notice-form'], ['/compte/moderation', 'moderation-decision'], ['/admin/moderation', 'staffing-entraide']]) {
        const { container } = page(p);
        await screen.findByTestId(ready);
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(await serious(container), `${lang} ${p}`).toEqual([]);
        const text = allText(container).split(DECISION.statement).join('');
        expect(claimsEntitlement(text)).toBe(false);
        if (ENTITLEMENT_CLAIMS[lang]) expect(ENTITLEMENT_CLAIMS[lang].test(text)).toBe(false);
        expect(text).not.toMatch(/undefined|\{\{|moderation:/);
        cleanup();
      }
      expect(globalThis.document.documentElement.dir).toBe(lang === 'ar' ? 'rtl' : 'ltr');
    }, 60000);
  }
});

describe('G14 notice form (DSA art. 16)', () => {
  it('shows the emergency numbers first; submit stays disabled until the four elements are there; name and e-mail optional only for CHILD_SAFETY', async () => {
    page('/signaler-un-contenu');
    const form = await screen.findByTestId('notice-form');
    expect(globalThis.document.body.textContent).toMatch(/112/); expect(globalThis.document.body.textContent).toMatch(/119/);
    const submit = screen.getByRole('button', { name: 'Envoyer le signalement' });
    expect(submit).toBeDisabled();
    const [type, cat] = form.querySelectorAll('select');
    fireEvent.change(type, { target: { value: 'story' } });
    fireEvent.change(cat, { target: { value: 'ILLEGAL_CONTENT' } });
    fireEvent.change(screen.getByLabelText(/Adresse exacte de la page/), { target: { value: 'https://example.test/histoires#x' } });
    fireEvent.change(screen.getByLabelText('Expliquez pourquoi ce contenu pose problème'), { target: { value: 'FIXTURE : ce texte contient une menace explicite.' } });
    fireEvent.click(screen.getByLabelText(/Je déclare de bonne foi/));
    expect(submit).toBeDisabled();   // name and e-mail are still required
    fireEvent.change(cat, { target: { value: 'CHILD_SAFETY' } });
    expect(submit).not.toBeDisabled();
    expect(screen.getByText(/votre nom et votre adresse sont facultatifs/)).toBeInTheDocument();
    fireEvent.change(cat, { target: { value: 'ILLEGAL_CONTENT' } });
    fireEvent.change(screen.getByLabelText('Votre nom'), { target: { value: 'Fixture' } });
    fireEvent.change(screen.getByLabelText('Votre adresse e-mail'), { target: { value: 'fixture@example.test' } });
    fireEvent.click(submit);
    expect(await screen.findByTestId('notice-sent')).toHaveTextContent('88888888-8888-4888-8888-888888888888');
    expect(posted[0].body).toMatchObject({ action: 'submit', contentType: 'story', category: 'ILLEGAL_CONTENT', goodFaith: true, notifierEmail: 'fixture@example.test' });
  });
  it('503 says « not open yet »; a form without a named moderator says « unavailable »', async () => {
    routes['/api/notices'] = { status: 503, body: { error: 'CAPABILITY_NOT_OPEN' } };
    page('/signaler-un-contenu');
    expect(await screen.findByTestId('notice-closed')).toHaveTextContent('pas encore ouvert');
    cleanup();
    routes['/api/notices'] = { status: 200, body: { available: true, staffed: false } };
    page('/signaler-un-contenu');
    expect(await screen.findByTestId('notice-unstaffed')).toBeInTheDocument();
    expect(screen.queryByTestId('notice-form')).toBeNull();
  });
  it('the notice screens stay behind the beta notice with the Production surfaces; the « notices » surface opens them', () => {
    for (const p of ['/signaler-un-contenu', '/compte/moderation']) {
      expect(isBetaRestrictedPath(p, ['admin', 'accounts'], { accountsScope: 'full', proSelfRegistration: false }), p).toBe(true);
      expect(isBetaRestrictedPath(p, ['notices']), p).toBe(false);
    }
    expect(noticesOpened(true, ['admin', 'accounts'])).toBe(false);
    expect(noticesOpened(true, ['notices'])).toBe(true);
  });
});

describe('G14 my decisions (art. 17, 20)', () => {
  it('the statement is readable (French canonical text marked lang="fr"), and the appeal is sent once with its text', async () => {
    await setLanguage('en', { persist: false });
    page('/compte/moderation');
    await screen.findByTestId('moderation-decision');
    expect(globalThis.document.querySelector('p[lang="fr"]').textContent).toContain('Moyens automatisés : aucun');
    fireEvent.click(screen.getByRole('button', { name: /Contest/ }));
    fireEvent.change(globalThis.document.querySelector('textarea'), { target: { value: 'FIXTURE: the first name is invented.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the appeal' }));
    await waitFor(() => expect(posted[0]).toMatchObject({ url: '/api/citizen/moderation', body: { action: 'appeal', decisionId: DECISION.id } }));
  });
  it('503 says « not open yet »', async () => {
    routes['/api/citizen/moderation'] = { status: 503, body: { error: 'CAPABILITY_NOT_OPEN' } };
    page('/compte/moderation');
    expect(await screen.findByTestId('moderation-closed')).toBeInTheDocument();
  });
});

describe('G14 moderation desk and statement fields', () => {
  it('staffing: each function says whether its named person exists; a role is assigned only with the charter acknowledged', async () => {
    page('/admin/moderation');
    expect(await screen.findByTestId('staffing-entraide')).toHaveTextContent('Aucun référent protection nommé');
    expect(screen.getByTestId('staffing-testimonials')).toHaveTextContent('Personne nommée');
    const assign = screen.getByRole('button', { name: 'Attribuer le rôle' });
    fireEvent.change(screen.getByLabelText('Adresse du compte administrateur'), { target: { value: 'safe@example.test' } });
    expect(assign).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Rôle'), { target: { value: 'ENTRAIDE_SAFETY_OFFICER' } });
    fireEvent.click(screen.getByLabelText(/a lu la charte de modération/));
    fireEvent.click(assign);
    await waitFor(() => expect(posted[0]).toMatchObject({ url: '/api/admin/moderation', body: { action: 'role_assign', email: 'safe@example.test', role: 'ENTRAIDE_SAFETY_OFFICER', charterAcknowledged: true } }));
  });
  it('the testimonial takedown stays disabled until the facts of the statement are written; they are sent with the action', async () => {
    page('/admin/temoignages');
    await screen.findByTestId('admin-queue');
    fireEvent.click(screen.getByRole('button', { name: 'Signalés' }));
    const takedown = await screen.findByRole('button', { name: 'Retirer (le texte est effacé)' });
    fireEvent.change(globalThis.document.querySelector('select'), { target: { value: 'PERSONAL_DATA' } });
    expect(takedown).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Faits et circonstances'), { target: { value: 'FIXTURE : le texte nomme une voisine.' } });
    expect(takedown).not.toBeDisabled();
    fireEvent.click(takedown);
    await waitFor(() => expect(posted[0].body).toMatchObject({ action: 'takedown', reason: 'PERSONAL_DATA', facts: 'FIXTURE : le texte nomme une voisine.', manifestlyIllegal: false }));
  });
});
