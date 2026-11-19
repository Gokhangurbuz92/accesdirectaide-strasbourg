// @vitest-environment jsdom
/**
 * X03 (expansion) — the Entraide screens in six languages: « Entraide » (/compte/entraide: SAFETY GUIDANCE always shown with the emergency numbers; join
 * with a pseudonym never prefilled and the charter marked « projet », box never pre-ticked; anonymous offers browsed by category and area; the logistics note
 * with its health / sensitive-data warning linked to the field; requests without any pseudonym until accepted; the e-mail box only on an accepted request,
 * never pre-ticked; report / block; no message field, no file field) and the moderation page (pseudonyms, counts per reason — never an account or an e-mail).
 * axe clean (serious / critical), Arabic right-to-left, no entitlement wording, « not open yet » on 503. The screens stay behind the beta notice with the
 * Production surfaces (admin, accounts — « full » included).
 * FIXTURES: every pseudonym, note and address below is a SYNTHETIC TEST FIXTURE (no real person).
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
import { entraideOpened, isBetaRestrictedPath } from '../../src/lib/publicBeta.js';
import { setLanguage } from '../../src/i18n/index.js';
import CompteEntraide from '../../src/pages/CompteEntraide.jsx';
import EntraideAdmin from '../../src/pages/admin/EntraideAdmin.jsx';
import { CHARTER_VERSION, CONTACT_VERSION } from '../../src/lib/entraide.js';

const LANGS = ['fr', 'en', 'de', 'tr', 'ar', 'uk'];
const BASE = { available: true, charterVersion: CHARTER_VERSION, contactVersion: CONTACT_VERSION, limits: { openOffersMax: 3, pendingRequestsMax: 3, noteMax: 280 } };
// SYNTHETIC TEST FIXTURES
const NOT_MEMBER = { ...BASE, member: null, offers: [], sent: [], received: [], blocks: [] };
const R_PENDING = { id: '11111111-1111-4111-8111-111111111111', offerId: 'o1', category: 'SHOPPING', area: 'OSTWALD', note: 'FIXTURE — le mardi matin', status: 'pending',
  createdAt: '2026-11-18T10:00:00.000Z', partner: null, contacts: null };
const R_ACCEPTED = { id: '22222222-2222-4222-8222-222222222222', offerId: 'o1', category: 'SHOPPING', area: 'OSTWALD', note: null, status: 'accepted',
  createdAt: '2026-11-17T10:00:00.000Z', partner: 'Fixture_Lune', contacts: { mine: null, theirs: 'fixture-lune@example.test' } };
const MEMBER = { ...BASE, member: { pseudonym: 'Fixture_Soleil', status: 'active', suspensionReason: null, charterCurrent: true, createdAt: '2026-11-01T10:00:00.000Z' },
  offers: [{ id: 'o1', category: 'SHOPPING', area: 'OSTWALD', note: null, status: 'open', createdAt: '2026-11-01T10:00:00.000Z' }],
  received: [R_PENDING, R_ACCEPTED], sent: [], blocks: [{ id: '33333333-3333-4333-8333-333333333333', createdAt: '2026-11-10T10:00:00.000Z' }] };
const BROWSE = { items: [{ id: '44444444-4444-4444-8444-444444444444', category: 'DIGITAL_HELP', area: 'SCHILTIGHEIM', note: 'FIXTURE — le samedi', createdOn: '2026-11-18', requested: false }] };
const ADMIN = { items: [{ pseudonym: 'Fixture_Orage', status: 'active', suspensionReason: null, memberSince: '2026-10', reports: { total: 2, reasons: { MONEY_REQUEST: 2 } },
  offers: [{ id: '55555555-5555-4555-8555-555555555555', category: 'PET_CARE', area: 'BISCHHEIM', note: null, status: 'open' }] }] };
const BROWSE_URL = '/api/citizen/entraide?view=browse&category=&area=';

/** @type {Record<string, { status: number, body: any }>} */
let routes = {};
const posted = [];
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
beforeEach(() => {
  posted.length = 0;
  globalThis.document.cookie = '__csrf=x03-test-token; path=/';
  routes = { '/api/citizen/entraide': { status: 200, body: MEMBER }, [BROWSE_URL]: { status: 200, body: BROWSE },
    '/api/admin/entraide?queue=reported': { status: 200, body: ADMIN }, 'POST /api/citizen/entraide': { status: 201, body: { ok: true } } };
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
  createElement(Route, { path: '/compte/entraide', element: createElement(CompteEntraide) }),
  createElement(Route, { path: '/admin/entraide', element: createElement(EntraideAdmin) })))));
const allText = (c) => [c.textContent, ...[...c.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label'))].join('\n');
const serious = async (c) => (await axe.run(c, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }))
  .violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`);

describe('X03 screens — six languages', () => {
  for (const lang of LANGS) {
    it(`${lang}: join form, member page (offers browsed, received requests, offer form) and moderation render, axe clean, no entitlement wording, safety guidance`, async () => {
      await setLanguage(lang, { persist: false });
      const texts = [];
      for (const [p, ready, mine] of [['/compte/entraide', 'entraide-join-form', NOT_MEMBER], ['/compte/entraide', 'entraide-offer-form', MEMBER], ['/admin/entraide', 'entraide-admin-queue', null]]) {
        if (mine) routes['/api/citizen/entraide'] = { status: 200, body: mine };
        const { container } = page(p);
        await screen.findByTestId(ready);
        if (ready === 'entraide-offer-form') {
          fireEvent.submit(screen.getByTestId('entraide-browse-form'));
          await screen.findByTestId('entraide-offers');
          const warning = container.querySelector('#entraide-offer-note-warning');
          expect(warning.textContent.length, lang).toBeGreaterThan(40);
          expect(container.querySelector('#entraide-offer-note').getAttribute('aria-describedby')).toContain('entraide-offer-note-warning');
        }
        if (p === '/compte/entraide') {
          const safety = screen.getByTestId('entraide-safety');
          for (const num of ['112', '17', '114', '3919', '119']) expect(safety.textContent, `${lang} ${num}`).toContain(num);
          expect(safety.textContent.length, lang).toBeGreaterThan(200);
        }
        if (ready === 'entraide-join-form') expect(screen.getByTestId('entraide-charter').textContent).toContain(CHARTER_VERSION);
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(await serious(container), `${lang} ${p} ${ready}`).toEqual([]);
        texts.push(allText(container));
        cleanup();
      }
      for (const t of texts) {
        expect(claimsEntitlement(t)).toBe(false);
        if (ENTITLEMENT_CLAIMS[lang]) expect(ENTITLEMENT_CLAIMS[lang].test(t)).toBe(false);
        expect(t).not.toMatch(/undefined|\{\{|entraide:/);
      }
      expect(globalThis.document.documentElement.dir).toBe(lang === 'ar' ? 'rtl' : 'ltr');
    }, 60000);
  }
});

describe('X03 joining', () => {
  it('the pseudonym is never prefilled, the charter box never pre-ticked; joining sends the current charter version', async () => {
    routes['/api/citizen/entraide'] = { status: 200, body: NOT_MEMBER };
    const { container } = page('/compte/entraide');
    await screen.findByTestId('entraide-join-form');
    const input = container.querySelector('#entraide-pseudonym');
    expect(input).toHaveValue(''); expect(input.getAttribute('aria-describedby')).toBe('entraide-pseudonym-help');
    const box = screen.getByTestId('entraide-charter-consent').querySelector('input[type="checkbox"]');
    expect(box).not.toBeChecked();
    expect(screen.getByTestId('entraide-charter')).toHaveTextContent('PROJET');
    const submit = screen.getByRole('button', { name: 'Rejoindre l’entraide' });
    fireEvent.change(input, { target: { value: 'Fixture_Etoile' } });
    expect(submit).toBeDisabled();
    fireEvent.click(box);
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(posted.at(-1)?.body).toEqual({ action: 'join', pseudonym: 'Fixture_Etoile', charter: true, charterVersion: CHARTER_VERSION }));
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });
  it('503: « not open yet », the safety guidance is still shown, axe clean', async () => {
    routes['/api/citizen/entraide'] = { status: 503, body: { error: 'CAPABILITY_NOT_OPEN' } };
    const { container } = page('/compte/entraide');
    expect(await screen.findByTestId('entraide-closed')).toHaveTextContent('analyse d’impact');
    expect(screen.getByTestId('entraide-safety')).toBeInTheDocument();
    expect(screen.queryByTestId('entraide-join-form')).toBeNull();
    expect(await serious(container)).toEqual([]);
  });
});

describe('X03 browsing, the double opt-in and the contact reveal', () => {
  it('offers are anonymous; asking sends one request with the optional note; there is no message field', async () => {
    const { container } = page('/compte/entraide');
    await screen.findByTestId('entraide-offer-form');
    fireEvent.click(screen.getByRole('button', { name: 'Afficher les offres' }));
    const list = await screen.findByTestId('entraide-offers');
    expect(list).toHaveTextContent('Aide numérique'); expect(list).toHaveTextContent('Schiltigheim');
    expect(list.textContent).not.toMatch(/Fixture_(?!—)|pseudonyme/i);
    fireEvent.click(screen.getByRole('button', { name: 'Demander ce coup de main' }));
    const note = container.querySelector(`#entraide-ask-${BROWSE.items[0].id}`);
    expect(note.getAttribute('aria-describedby')).toContain(`entraide-ask-${BROWSE.items[0].id}-warning`);
    fireEvent.change(note, { target: { value: 'FIXTURE — plutôt le matin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer ma demande' }));
    await waitFor(() => expect(posted.at(-1)?.body).toEqual({ action: 'request_create', offerId: BROWSE.items[0].id, note: 'FIXTURE — plutôt le matin' }));
    expect(container.textContent).not.toMatch(/messagerie interne|envoyer un message/i);
  });
  it('a pending request shows no pseudonym; an accepted one shows the other pseudonym, the address they chose to show, and an e-mail box never pre-ticked', async () => {
    page('/compte/entraide');
    const received = await screen.findByTestId('entraide-received');
    const [pending, accepted] = received.querySelectorAll(':scope > li');
    expect(pending).toHaveTextContent('n’apparaît qu’après votre accord');
    expect(pending.querySelector('[data-testid="entraide-partner"]')).toBeNull();
    expect(pending.querySelector('[data-testid="entraide-contact"]')).toBeNull();
    expect(accepted.querySelector('[data-testid="entraide-partner"]')).toHaveTextContent('Fixture_Lune');
    const contact = accepted.querySelector('[data-testid="entraide-contact"]');
    expect(contact).toHaveTextContent('fixture-lune@example.test');
    const box = contact.querySelector('input[type="checkbox"]'); expect(box).not.toBeChecked();
    const email = contact.querySelector('input[type="email"]'); expect(email).toHaveValue('');
    const share = screen.getByRole('button', { name: 'Communiquer mon adresse' });
    fireEvent.change(email, { target: { value: 'fixture-soleil@example.test' } });
    expect(share).toBeDisabled();
    fireEvent.click(box);
    fireEvent.click(share);
    await waitFor(() => expect(posted.at(-1)?.body).toEqual({ action: 'contact_share', requestId: R_ACCEPTED.id, email: 'fixture-soleil@example.test', consent: true, consentVersion: CONTACT_VERSION }));
  });
  it('report needs a reason from the closed list (no free text); block asks for a confirmation', async () => {
    page('/compte/entraide');
    await screen.findByTestId('entraide-received');
    fireEvent.click(screen.getAllByRole('button', { name: 'Signaler' })[0]);
    const form = screen.getAllByTestId('entraide-report-form')[0];
    expect(form.querySelector('textarea, input[type="text"]')).toBeNull();
    const send = screen.getAllByRole('button', { name: 'Envoyer le signalement' })[0];
    expect(send).toBeDisabled();
    fireEvent.change(screen.getAllByLabelText('Motif du signalement')[0], { target: { value: 'MONEY_REQUEST' } });
    fireEvent.click(send);
    await waitFor(() => expect(posted.at(-1)?.body).toMatchObject({ action: 'report', reason: 'MONEY_REQUEST' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Bloquer' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le blocage' }));
    await waitFor(() => expect(posted.at(-1)?.body).toMatchObject({ action: 'block' }));
  });
});

describe('X03 moderation and beta', () => {
  it('the moderation page names pseudonyms and counts per reason — never an account or an e-mail', async () => {
    const { container } = page('/admin/entraide');
    await screen.findByTestId('entraide-admin-queue');
    expect(screen.getByTestId('entraide-admin-reports')).toHaveTextContent('Demande d’argent ou de paiement (2)');
    expect(container.textContent).toContain('Fixture_Orage');
    expect(container.textContent).not.toMatch(/@/);
  });
  it('the screens stay behind the beta notice with the Production surfaces (accounts « full » included); only the « entraide » surface opens them', () => {
    for (const p of ['/compte/entraide', '/admin/entraide']) {
      expect(isBetaRestrictedPath(p, ['admin', 'accounts'], { accountsScope: 'full', proSelfRegistration: false }), p).toBe(true);
      expect(isBetaRestrictedPath(p, ['entraide']), p).toBe(false);
    }
    expect(entraideOpened(true, ['admin', 'accounts'])).toBe(false);
  });
});
