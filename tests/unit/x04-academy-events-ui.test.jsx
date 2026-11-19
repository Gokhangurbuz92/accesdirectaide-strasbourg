// @vitest-environment jsdom
/**
 * X04 (expansion) — the academy and event screens in six languages: /evenements, /academie, an event page with its accessibility information and the
 * registration form (optional need, separate agreement, never pre-ticked), the sign-in offer for a visitor, « Mes événements », the administration page
 * (counts only) and the « not open yet » state (503). axe clean (serious / critical), Arabic right-to-left, French record text marked lang="fr" outside
 * French unless translated, no entitlement wording. The screens stay behind the beta notice with the Production surfaces (admin, accounts). No JSX here.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import fs from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';
import { ENTITLEMENT_CLAIMS } from '../../scripts/i18n-check.mjs';
import { eventsOpened, isBetaRestrictedPath } from '../../src/lib/publicBeta.js';
import { setLanguage } from '../../src/i18n/index.js';
import AcademyEvents from '../../src/pages/AcademyEvents.jsx';
import AcademyEventDetail from '../../src/pages/AcademyEventDetail.jsx';
import CompteEvenements from '../../src/pages/CompteEvenements.jsx';
import AcademyEventsAdmin from '../../src/pages/admin/AcademyEventsAdmin.jsx';
import { ACCESSIBILITY_FEATURES, ACCESSIBILITY_NEEDS } from '../../src/lib/academyEvents.js';
import * as service from '../../api/_services/academy-events.js';

const LANGS = ['fr', 'en', 'de', 'tr', 'ar', 'uk'];
const EVENT = { slug: 'atelier-droits-abc123', kind: 'EVENT', status: 'published', title: 'Atelier accès aux droits', summary: 'Un atelier collectif pour comprendre les démarches en ligne.',
  body: 'Atelier gratuit animé par une association du quartier.', translations: { en: { title: 'Rights access workshop', summary: 'A group workshop on online procedures.', body: '' } },
  organizerName: 'Association Exemple', startsAt: '2026-12-10T14:00:00.000Z', endsAt: '2026-12-10T16:00:00.000Z', venueName: 'Médiathèque Exemple', venueAddress: '1 rue de l’Exemple',
  venueCommune: 'Strasbourg', capacity: 20, remaining: 7, accessibilityFeatures: ['STEP_FREE_ACCESS', 'LSF_INTERPRETATION', 'FALC_MATERIALS'], accessibilityNote: 'Entrée côté parc.', registrationOpen: true };
const LESSON = { slug: 'courrier-caf-def456', kind: 'LESSON', status: 'published', title: 'Comprendre un courrier', summary: 'Les rubriques d’un courrier administratif.', body: 'Texte de la page.', translations: {} };
const MINE = { available: true, registrations: [{ itemId: '11111111-1111-4111-8111-111111111111', status: 'REGISTERED', accessibilityNeed: 'LSF_INTERPRETATION', slug: 'autre-atelier-xyz789', title: 'Autre atelier',
  titles: { en: 'Rights access workshop' }, eventStatus: 'published', startsAt: '2099-12-10T14:00:00.000Z', endsAt: '2099-12-10T16:00:00.000Z', venueName: EVENT.venueName, venueCommune: 'Strasbourg' }] };
const ADMIN_LIST = { items: [{ id: '22222222-2222-4222-8222-222222222222', kind: 'EVENT', status: 'published', slug: EVENT.slug, title: EVENT.title, capacity: 20, attendance: { capacity: 20, registered: 13, remaining: 7, needs: { LSF_INTERPRETATION: 2 } } }] };

/** @type {Record<string, { status: number, body: any }>} */
let routes = {};
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
let fetchSpy;
beforeEach(() => {
  routes = { '/api/events?kind=EVENT': { status: 200, body: { items: [EVENT] } }, '/api/events?kind=LESSON': { status: 200, body: { items: [LESSON] } },
    [`/api/events/${EVENT.slug}`]: { status: 200, body: { item: EVENT } }, [`/api/events/${LESSON.slug}`]: { status: 200, body: { item: LESSON } },
    '/api/citizen/events': { status: 200, body: MINE }, '/api/admin/events': { status: 200, body: ADMIN_LIST } };
  fetchSpy = vi.fn(async (url) => { const r = routes[String(url)]; return r ? reply(r.status, r.body) : reply(404, { error: 'NOT_FOUND' }); });
  globalThis.fetch = fetchSpy;
});
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await setLanguage('fr', { persist: false }); });
afterAll(async () => { await setLanguage('fr', { persist: false }); });

const page = (path) => render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [path] }, createElement(Routes, null,
  createElement(Route, { path: '/evenements', element: createElement(AcademyEvents, { kind: 'EVENT' }) }),
  createElement(Route, { path: '/academie', element: createElement(AcademyEvents, { kind: 'LESSON' }) }),
  createElement(Route, { path: '/evenements/:slug', element: createElement(AcademyEventDetail, { kind: 'EVENT' }) }),
  createElement(Route, { path: '/academie/:slug', element: createElement(AcademyEventDetail, { kind: 'LESSON' }) }),
  createElement(Route, { path: '/compte/evenements', element: createElement(CompteEvenements) }),
  createElement(Route, { path: '/admin/academie-evenements', element: createElement(AcademyEventsAdmin) })))));
const allText = (container) => [container.textContent, ...[...container.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label'))].join('\n');
const serious = async (container) => (await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }))
  .violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`);

describe('X04 screens — six languages', () => {
  for (const lang of LANGS) {
    it(`${lang}: list, event page with registration form, academy, Mes événements and administration render, axe clean, no entitlement wording`, async () => {
      await setLanguage(lang, { persist: false });
      const texts = [];
      for (const [path, ready] of [['/evenements', 'academy-items'], ['/academie', 'academy-items'], [`/evenements/${EVENT.slug}`, 'event-register-form'], [`/academie/${LESSON.slug}`, 'academy-detail'],
        ['/compte/evenements', 'mine-list'], ['/admin/academie-evenements', 'academy-admin-list']]) {
        const { container } = page(path);
        await screen.findByTestId(ready);
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(await serious(container), `${lang} ${path}`).toEqual([]);
        texts.push(allText(container));
        cleanup();
      }
      for (const t of texts) {
        expect(claimsEntitlement(t)).toBe(false);
        if (ENTITLEMENT_CLAIMS[lang]) expect(ENTITLEMENT_CLAIMS[lang].test(t)).toBe(false);
        expect(t).not.toMatch(/undefined|\{\{|events:|compte:/);
      }
      expect(globalThis.document.documentElement.dir).toBe(lang === 'ar' ? 'rtl' : 'ltr');
    }, 60000);
  }
});

describe('X04 event page', () => {
  it('shows date, place, organizer, accessibility information and places left; the need agreement appears only with a need, never ticked; no free-text field', async () => {
    page(`/evenements/${EVENT.slug}`);
    const form = await screen.findByTestId('event-register-form');
    expect(screen.getByTestId('event-accessibility')).toHaveTextContent('Interprétation en langue des signes française (LSF)');
    expect(screen.getByTestId('event-accessibility')).toHaveTextContent('Entrée côté parc.');
    expect(screen.getByTestId('event-remaining')).toHaveTextContent('Places restantes : 7 sur 20');
    expect(form.querySelectorAll('input[type="radio"]')).toHaveLength(ACCESSIBILITY_NEEDS.length + 1);
    expect(form.querySelector('input[type="radio"][value=""]')).toBeChecked();
    expect(screen.queryByTestId('event-need-consent')).toBeNull();
    fireEvent.click(form.querySelector('input[value="LSF_INTERPRETATION"]'));
    const consent = screen.getByTestId('event-need-consent').querySelector('input');
    expect(consent).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'M’inscrire' })).toBeDisabled();
    fireEvent.click(consent);
    expect(screen.getByRole('button', { name: 'M’inscrire' })).toBeEnabled();
    expect(form.querySelector('textarea, input[type="text"]')).toBeNull();   // no free text anywhere
  });
  it('a visitor without a session is offered sign-in, not a form', async () => {
    routes['/api/citizen/events'] = { status: 401, body: { error: 'Unauthorized' } };
    page(`/evenements/${EVENT.slug}`);
    expect(await screen.findByTestId('event-signin')).toHaveTextContent('personnes de 18 ans ou plus');
    expect(screen.queryByTestId('event-register-form')).toBeNull();
  });
  it('outside French: the translated title is in the interface language, untranslated French text is marked lang="fr" dir="ltr"', async () => {
    await setLanguage('ar', { persist: false });
    page(`/evenements/${EVENT.slug}`);
    await screen.findByTestId('academy-detail');
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Atelier accès aux droits'); expect(h1).toHaveAttribute('lang', 'fr'); expect(h1).toHaveAttribute('dir', 'ltr');
    cleanup();
    await setLanguage('en', { persist: false });
    page(`/evenements/${EVENT.slug}`);
    await screen.findByTestId('academy-detail');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Rights access workshop');
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveAttribute('lang');
    expect(screen.getByText('Atelier gratuit animé par une association du quartier.')).toHaveAttribute('lang', 'fr');
  });
  it('503 (closed), 404 and 410 each say what happened', async () => {
    for (const [status, text] of [[503, 'pas encore ouverte'], [404, 'n’existe pas'], [410, 'retirée']]) {
      routes[`/api/events/${EVENT.slug}`] = { status, body: {} };
      page(`/evenements/${EVENT.slug}`);
      expect(await screen.findByTestId('academy-detail-unavailable')).toHaveTextContent(text);
      cleanup();
    }
  });
});

describe('X04 lists, Mes événements, administration', () => {
  it('closed (503): the list, Mes événements and the administration say « not open yet » and show nothing else', async () => {
    for (const k of Object.keys(routes)) routes[k] = { status: 503, body: { error: 'CAPABILITY_NOT_OPEN' } };
    for (const path of ['/evenements', '/compte/evenements', '/admin/academie-evenements']) {
      const { container } = page(path);
      expect(await screen.findByTestId('academy-closed')).toHaveTextContent('n’est pas encore ouverte');
      expect(await serious(container)).toEqual([]);
      cleanup();
    }
  });
  it('Mes événements: the person’s need, a need change needs the agreement, cancellation', async () => {
    page('/compte/evenements');
    const list = await screen.findByTestId('mine-list');
    expect(list).toHaveTextContent('Votre besoin d’accessibilité : Interprétation en langue des signes française (LSF)');
    expect(screen.getByRole('button', { name: 'Annuler mon inscription' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Besoin d’accessibilité (facultatif)'), { target: { value: 'QUIET_SPACE' } });
    expect(screen.getByRole('button', { name: 'Enregistrer le besoin' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Enregistrer le besoin' })).toBeEnabled();
  });
  it('administration: the organizer sees counts per event and per need, never a person', async () => {
    page('/admin/academie-evenements');
    const list = await screen.findByTestId('academy-admin-list');
    expect(list).toHaveTextContent('13 inscrits sur 20');
    expect(list.textContent).not.toMatch(/@|example/);
  });
  it('every accessibility feature and need has a label in each language file', () => {
    for (const lang of LANGS.filter((l) => l !== 'fr')) {
      const json = JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/events.json`, 'utf8'));
      for (const k of ['a11y.step_free', 'a11y.toilets', 'a11y.lsf', 'a11y.captions', 'a11y.loop', 'a11y.falc', 'a11y.large_print', 'a11y.quiet', 'a11y.animals', 'a11y.companion']) expect(json[k], `${lang} ${k}`).toBeTruthy();
    }
    expect([...ACCESSIBILITY_FEATURES]).toEqual([...service.ACCESSIBILITY_FEATURES]);
    expect([...ACCESSIBILITY_NEEDS]).toEqual([...service.ACCESSIBILITY_NEEDS]);
  });
});

describe('X04 screens behind the beta notice', () => {
  it('with the Production surfaces (none, admin, admin + accounts narrow or full) every academy / event screen is restricted; only « events » opens them', () => {
    const screens = ['/academie', '/academie/x', '/evenements', '/evenements/x', '/compte/evenements', '/admin/academie-evenements'];
    for (const open of [[], ['admin'], ['admin', 'accounts']]) {
      for (const scope of ['booking', 'full']) for (const s of screens) expect(isBetaRestrictedPath(s, open, { accountsScope: scope, proSelfRegistration: false }), `${open} ${scope} ${s}`).toBe(true);
    }
    for (const s of screens) expect(isBetaRestrictedPath(s, ['events'], { accountsScope: 'booking', proSelfRegistration: false })).toBe(false);
    // the neighbours are not changed by it
    expect(isBetaRestrictedPath('/compte', ['admin', 'accounts'], { accountsScope: 'booking', proSelfRegistration: false })).toBe(false);
    expect(isBetaRestrictedPath('/admin/ressources-publication', ['admin'], { accountsScope: 'booking', proSelfRegistration: false })).toBe(false);
    expect(eventsOpened(true, ['admin', 'accounts'], { accountsScope: 'full', proSelfRegistration: false })).toBe(false);
    expect(eventsOpened(false, [], { accountsScope: 'booking', proSelfRegistration: false })).toBe(true);
  });
  it('the routes exist in the router', () => {
    const routesSrc = fs.readFileSync('src/pages/index.jsx', 'utf8');
    for (const p of ['/academie', '/academie/:slug', '/evenements', '/evenements/:slug', '/compte/evenements']) expect(routesSrc).toContain(`path="${p}"`);
    expect(routesSrc).toContain('path="academie-evenements"');
  });
});
