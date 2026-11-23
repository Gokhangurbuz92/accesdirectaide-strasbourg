// @vitest-environment jsdom
/* global document, Node */
/**
 * G14-FIND (owner 23/11/2026) — « find and book »: the Mon Espace search and quick links, the Annuaire « Rendez-vous en ligne » filter and badge, and the
 * booking block at the top of a place's page. Closed surfaces offer nothing that leads to a closed screen; open ones are shown; the badge follows the
 * server's `online_booking` flag only; the page shows the server's real first free day, or says there is none. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement as h } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ beta: false }));
vi.mock('@/config/env', async (orig) => {
  const real = await orig();
  return { ...real, frontendEnv: { ...real.frontendEnv, flags: { ...real.frontendEnv.flags, get publicBeta() { return env.beta; } } } };
});
const api = vi.hoisted(() => ({ espace: vi.fn() }));
vi.mock('../../src/lib/citizenApi.js', () => ({ citizenApi: api, CitizenApiError: class extends Error {} }));
const dir = vi.hoisted(() => ({ filter: vi.fn() }));
vi.mock('../../src/api/client', () => ({ client: { entities: { Structure: { filter: (...a) => dir.filter(...a) } } } }));
vi.mock('@/components/FavoriteButton', () => ({ default: () => null }));
vi.mock('@/components/account/NotificationCenter', () => ({ default: () => null }));

import MonEspace from '../../src/pages/MonEspace.jsx';
import Annuaire from '../../src/pages/Annuaire.jsx';
import StructureDetail from '../../src/pages/StructureDetail.jsx';
import { communeFromZip, parsePlace, searchTarget } from '../../src/lib/findPlace.js';

const PLACE = { id: 'st-g14f', slug: 'lieu-rdv', nom: 'Lieu RDV', type_structure: 'association', ville: 'Strasbourg', code_postal: '67000', adresse: '1 rue Exemple',
  telephone: '0300000000', is_pro_enabled: true, verification_status: 'VERIFIED', date_verification: '2026-11-01T00:00:00.000Z', source_url: 'https://example.test/lieu' };

/** the current location, to check where a search leads */
function Where() { const l = useLocation(); return h('output', { 'data-testid': 'where' }, `${l.pathname}${l.search}`); }
const mount = (path, routes) => render(h(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
  h(HelmetProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Routes, null, ...routes), h(Where)))));
const espace = () => mount('/compte', [h(Route, { key: 'c', path: '/compte', element: h(MonEspace) }), h(Route, { key: '*', path: '*', element: null })]);
const annuaire = (path = '/structures') => mount(path, [h(Route, { key: 's', path: '/structures', element: h(Annuaire) })]);
const detail = () => mount('/structures/lieu-rdv', [h(Route, { key: 'd', path: '/structures/:slug', element: h(StructureDetail) })]);

beforeEach(() => { dir.filter.mockReset(); api.espace.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); env.beta = false; });

describe('G14-FIND « Où ? »: commune, postal code, or a clear refusal', () => {
  it('a commune of the Eurométropole (any case, accents optional) becomes its INSEE code; a Bas-Rhin postal code stays a postal code', () => {
    expect(parsePlace('strasbourg')).toEqual({ kind: 'commune', code: '67482', name: 'Strasbourg' });
    expect(parsePlace('  SCHILTIGHEIM ')).toMatchObject({ kind: 'commune', code: '67447' });
    expect(parsePlace('67100')).toEqual({ kind: 'zip', zip: '67100' });
    expect(parsePlace('75001')).toEqual({ kind: 'unknown' });
    expect(parsePlace('Colmar')).toEqual({ kind: 'unknown' });
    expect(parsePlace('')).toEqual({ kind: 'none' });
  });
  it('routes to the real search (/recherche, ranked by the server) or the directory; nothing to search → null', () => {
    expect(searchTarget('logement', { kind: 'none' })).toBe('/recherche?q=logement');
    expect(searchTarget('CCAS', parsePlace('Schiltigheim'))).toBe('/recherche?q=CCAS&territoire=67447');
    expect(searchTarget('', parsePlace('Schiltigheim'))).toBe('/structures?city=Schiltigheim');
    expect(searchTarget('CAF', parsePlace('67000'))).toBe('/structures?q=CAF&zip=67000');
    expect(searchTarget('  ', { kind: 'none' })).toBeNull();
  });
});

describe('G14-FIND a postal code with words: the commune from the directory\'s own addresses', () => {
  const answer = (items, ok = true) => vi.fn(async () => ({ ok, json: async () => ({ items }) }));
  it('the most frequent recorded town for that postal code, when it is in the covered territory', async () => {
    const f = answer([{ ville: 'Strasbourg' }, { ville: 'Strasbourg' }, { ville: 'Schiltigheim' }]);
    expect(await communeFromZip('67000', f)).toEqual({ kind: 'commune', code: '67482', name: 'Strasbourg' });
    expect(f.mock.calls[0][0]).toBe('/api/structures?zip=67000&limit=20&sort=quality');
  });
  it('no recorded place, a town outside the territory, or a failed read → null (the directory filter on the postal code is used instead)', async () => {
    expect(await communeFromZip('67999', answer([]))).toBeNull();
    expect(await communeFromZip('67600', answer([{ ville: 'Sélestat' }]))).toBeNull();
    expect(await communeFromZip('67000', answer([], false))).toBeNull();
    expect(await communeFromZip('67000', vi.fn(async () => { throw new Error('offline'); }))).toBeNull();
  });
  it('Mon Espace: « CAF » + 67000 searches aides, démarches and places in Strasbourg', async () => {
    vi.stubGlobal('fetch', answer([{ ville: 'Strasbourg' }]));
    api.espace.mockResolvedValue({});
    espace();
    fireEvent.change(await screen.findByTestId('find-q'), { target: { value: 'CAF' } });
    fireEvent.change(screen.getByTestId('find-where'), { target: { value: '67000' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/recherche?q=CAF&territoire=67482'));
  });
});

describe('G14-FIND Mon Espace: « Que cherchez-vous ? » and open quick links only', () => {
  it('restricted beta, every surface closed: the search, the always-public links and the « Pour commencer » guide; no booking, Parcours or closed orientation link', async () => {
    env.beta = true;
    api.espace.mockResolvedValue({});
    espace();
    const block = await screen.findByTestId('find-and-book');
    expect(within(block).getByRole('heading', { level: 2, name: 'Que cherchez-vous ?' })).toBeInTheDocument();
    expect(within(block).getByRole('search')).toBeInTheDocument();
    expect(screen.getByLabelText('Une aide, une démarche ou une structure')).toBeInTheDocument();
    expect(screen.getByLabelText('Où ? (facultatif)')).toHaveAttribute('aria-describedby');
    expect(screen.getByTestId('find-link-structures')).toHaveAttribute('href', '/structures');
    expect(screen.getByTestId('find-link-demarches')).toHaveAttribute('href', '/demarches');
    for (const id of ['find-link-rdv', 'find-link-parcours', 'find-link-orientation']) expect(screen.queryByTestId(id), id).toBeNull();
    expect(screen.getByTestId('find-guide')).toHaveTextContent('Pour commencer');
    expect(screen.getByTestId('find-guide-emergency')).toHaveAttribute('href', '/ressources?emergency=1');
    expect(document.querySelector('a[href^="/rdv"], a[href*="rdv=1"]')).toBeNull();
  });
  it('the browser-only orientation (G4) is open in the beta: « Vérifier mes droits » is offered', async () => {
    env.beta = true; vi.stubEnv('VITE_ORIENTATION_BROWSER_ONLY', '1');
    api.espace.mockResolvedValue({});
    espace();
    expect(await screen.findByTestId('find-link-orientation')).toHaveAttribute('href', '/orientation');
  });
  it('booking opened by the build (appointments + accounts): « Prendre rendez-vous » leads to the filtered directory', async () => {
    env.beta = true; vi.stubEnv('VITE_PUBLIC_BETA_OPEN_SURFACES', 'accounts,appointments');
    api.espace.mockResolvedValue({ nextAppointment: null });
    espace();
    expect(await screen.findByTestId('find-link-rdv')).toHaveAttribute('href', '/structures?rdv=1');
    expect(screen.queryByTestId('find-link-parcours')).toBeNull();   // the narrow accounts scope keeps Mon Parcours closed
    expect(screen.queryByTestId('find-guide')).toBeNull();           // tiles are shown (appointments, profile…): no guide
  });
  it('outside the beta: every link, and the tiles replace the guide', async () => {
    api.espace.mockResolvedValue({ parcours: { total: 0, open: 0, nextDue: null }, documents: 0, favorites: 0, dossiers: 0, nextAppointment: null });
    espace();
    for (const id of ['find-link-orientation', 'find-link-structures', 'find-link-demarches', 'find-link-parcours', 'find-link-rdv']) expect(await screen.findByTestId(id), id).toBeInTheDocument();
    expect(screen.getByTestId('tile-parcours')).toBeInTheDocument();
    expect(screen.queryByTestId('find-guide')).toBeNull();
  });
  it('the search leads to real results; an unknown place is refused with an explanation and the focus on the field', async () => {
    api.espace.mockResolvedValue({});
    espace();
    const q = await screen.findByTestId('find-q'); const where = screen.getByTestId('find-where');
    fireEvent.change(q, { target: { value: 'logement' } }); fireEvent.change(where, { target: { value: 'Paris' } });
    fireEvent.click(screen.getByTestId('find-submit'));
    expect(screen.getByTestId('find-error')).toHaveTextContent('Nous ne reconnaissons pas ce lieu');
    expect(where).toHaveAttribute('aria-invalid', 'true'); expect(where).toHaveFocus();
    expect(screen.getByTestId('where')).toHaveTextContent('/compte');
    fireEvent.change(where, { target: { value: 'Illkirch-Graffenstaden' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/recherche?q=logement&territoire=67218'));
  });
  it('an empty search asks for words instead of opening an empty page', async () => {
    api.espace.mockResolvedValue({});
    espace();
    fireEvent.click(await screen.findByTestId('find-submit'));
    expect(screen.getByTestId('find-error')).toHaveTextContent('Écrivez ce que vous cherchez');
    expect(screen.getByTestId('find-q')).toHaveFocus();
  });
});

describe('G14-FIND Annuaire: « Rendez-vous en ligne » filter and badge', () => {
  const page = (items) => ({ items, pagination: { total: items.length, totalPages: 1, hasNext: false } });
  it('restricted beta, booking closed: no filter, the parameter is ignored and never sent, no badge even on a flagged item', async () => {
    env.beta = true;
    dir.filter.mockResolvedValue(page([{ ...PLACE, online_booking: true }]));
    annuaire('/structures?rdv=1');
    await screen.findAllByTestId('structure-card');
    expect(screen.queryByTestId('structures-rdv-filter')).toBeNull();
    expect(dir.filter.mock.calls[0][0].bookable).toBeUndefined();
    expect(screen.queryByTestId('structure-online-booking-badge')).toBeNull();
  });
  it('booking open: the filter is offered with its non-partnership hint, sends bookable=1, shows a chip, and the badge follows online_booking', async () => {
    dir.filter.mockResolvedValue(page([{ ...PLACE, online_booking: true }, { ...PLACE, id: 'st-2', slug: 'autre', nom: 'Autre lieu', online_booking: false }]));
    annuaire('/structures?rdv=1');
    const cards = await screen.findAllByTestId('structure-card');
    expect(dir.filter.mock.calls.at(-1)[0].bookable).toBe('1');
    const box = screen.getAllByTestId('structures-rdv-filter')[0];
    expect(box).toBeChecked();
    expect(screen.getAllByText(/Ce n’est pas un partenariat/)[0]).toBeInTheDocument();
    expect(within(cards[0]).getByTestId('structure-online-booking-badge')).toHaveTextContent('RDV en ligne');
    expect(within(cards[1]).queryByTestId('structure-online-booking-badge')).toBeNull();
  });
  it('an empty filtered result proposes concrete next steps (drop the filter, widen the place), never a bare « no result »', async () => {
    dir.filter.mockResolvedValue(page([]));
    annuaire('/structures?rdv=1&zip=67100');
    const actions = await screen.findByTestId('annuaire-empty-actions');
    expect(dir.filter.mock.calls.at(-1)[0]).toMatchObject({ bookable: '1', zip: '67100' });
    expect(within(actions).getByRole('button', { name: 'Voir aussi les lieux sans rendez-vous en ligne' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Chercher dans tout le Bas-Rhin' })).toBeInTheDocument();
    expect(screen.getByText('Code postal 67100')).toBeInTheDocument();
  });
});

describe('G14-FIND StructureDetail: the booking block first, with the server\'s real availability', () => {
  const profile = (body, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 404, json: async () => body }));
  it('booking closed: no block and no profile request', async () => {
    env.beta = true; const f = profile({}); vi.stubGlobal('fetch', f);
    dir.filter.mockResolvedValue([PLACE]);
    detail();
    await screen.findByRole('heading', { level: 1, name: 'Lieu RDV' });
    expect(screen.queryByTestId('structure-booking-block')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it('open services and the first free day as computed by the server; the block comes before the contact details', async () => {
    vi.stubGlobal('fetch', profile({ services: [{ id: 'a', name: 'Accueil social', durationMinutes: 30, onlineBooking: 'OPEN' }, { id: 'b', name: 'Écoute', durationMinutes: 45, onlineBooking: 'CONTACT_STRUCTURE' }], nextAvailableDay: '2026-11-26' }));
    dir.filter.mockResolvedValue([PLACE]);
    detail();
    const block = await screen.findByTestId('structure-booking-block');
    await waitFor(() => expect(within(block).getByTestId('structure-booking-services')).toHaveTextContent('Accueil social'));
    expect(within(block).getByTestId('structure-booking-services')).not.toHaveTextContent('Écoute');
    expect(within(block).getByTestId('structure-booking-next-day')).toHaveTextContent('jeudi 26 novembre');
    expect(within(block).getByRole('link', { name: 'Voir les créneaux disponibles' })).toHaveAttribute('href', '/rdv/lieu-rdv/booking');
    const contact = screen.getByRole('heading', { level: 2, name: 'Coordonnées' });
    expect(block.compareDocumentPosition(contact) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(block).getByTestId('structure-not-partner')).toBeInTheDocument();
  });
  it('no free slot in 14 days is said as such (no invented date)', async () => {
    vi.stubGlobal('fetch', profile({ services: [{ id: 'a', name: 'Accueil social', durationMinutes: 30, onlineBooking: 'OPEN' }], nextAvailableDay: null }));
    dir.filter.mockResolvedValue([PLACE]);
    detail();
    expect(await screen.findByText(/Aucun créneau libre dans les 14 prochains jours/)).toBeInTheDocument();
  });
  it('no service open to an online request: no booking button anywhere, the page points to the contact details', async () => {
    vi.stubGlobal('fetch', profile({ services: [{ id: 'b', name: 'Écoute', durationMinutes: 45, onlineBooking: 'CONTACT_STRUCTURE' }], nextAvailableDay: null }));
    dir.filter.mockResolvedValue([PLACE]);
    const { container } = detail();
    expect(await screen.findByTestId('structure-booking-contact-only')).toBeInTheDocument();
    expect(container.querySelector('a[href^="/rdv"]')).toBeNull();
    expect(screen.getByTestId('structure-no-online-booking')).toBeInTheDocument();
  });
  it('the profile cannot be read (404 / network): the plain booking entry stays, unchanged (DTA-B12 / B14 contract)', async () => {
    vi.stubGlobal('fetch', profile({}, false));
    dir.filter.mockResolvedValue([PLACE]);
    const { container } = detail();
    expect(await screen.findByRole('link', { name: 'Voir les créneaux disponibles' })).toBeInTheDocument();
    expect(container.querySelector('a[href="/rdv/lieu-rdv/booking"]')).not.toBeNull();
    expect(screen.getByTestId('structure-booking-account-required')).toHaveTextContent('Un compte particulier est nécessaire pour demander un rendez-vous. Les informations de cette page restent consultables sans compte.');
  });
});

describe('G14-FIND wording and languages', () => {
  const read = (lang, ns) => JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/${ns}.json`, 'utf8'));
  const keysIn = (file, ns) => [...fs.readFileSync(file, 'utf8').matchAll(new RegExp(`t\\('${ns}:((?:find|filters\\.(?:rdv|zip)|empty\\.(?:description_rdv|remove|check)|card\\.online_booking_hint|detail\\.booking\\.(?:contact_only|services_title|duration|next_day|no_slot_14|loading))[^']*)'`, 'g'))].map((m) => m[1]);
  it('every new key exists in the five translated languages', () => {
    const compte = keysIn('src/components/account/FindAndBook.jsx', 'compte');
    const structures = [...keysIn('src/pages/Annuaire.jsx', 'structures'), ...keysIn('src/components/cards/StructureCard.jsx', 'structures'), ...keysIn('src/components/StructureBookingBlock.jsx', 'structures')];
    expect(compte.length).toBeGreaterThan(20); expect(structures.length).toBeGreaterThan(10);
    for (const lang of ['en', 'de', 'tr', 'ar', 'uk']) {
      for (const k of compte) expect(read(lang, 'compte')[k], `${lang} compte:${k}`).toBeTruthy();
      for (const k of structures) expect(read(lang, 'structures')[k], `${lang} structures:${k}`).toBeTruthy();
    }
  });
  it('the badge and filter wording never claims a partnership or a guaranteed appointment', () => {
    const texts = [];
    for (const lang of ['en', 'de', 'tr', 'ar', 'uk']) { const j = read(lang, 'structures'); texts.push(j['filters.rdv_hint'], j['card.online_booking_hint'], j['card.online_booking'], j['filters.rdv_only']); }
    texts.push(...[...fs.readFileSync('src/pages/Annuaire.jsx', 'utf8').matchAll(/'structures:filters\.rdv_[a-z]+', '([^']+)'/g)].map((m) => m[1]));
    for (const s of texts) expect(s).not.toMatch(/garanti|guarantee|partenaire officiel|official partner|certifi/i);
  });
});
