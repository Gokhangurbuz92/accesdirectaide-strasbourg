// @vitest-environment jsdom
/**
 * G14 release 3 — interface: the need picker (ADA Pro), the « Rendez-vous sur leur site » block and badge (distinct from AccesDirectAide online booking),
 * the directory need filter, the /situation and /droits « prendre rendez-vous » entry points. No JSX in the body.
 */
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement as h, useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ beta: false }));
vi.mock('@/config/env', async (orig) => {
  const real = await orig();
  return { ...real, frontendEnv: { ...real.frontendEnv, flags: { ...real.frontendEnv.flags, get publicBeta() { return env.beta; } } } };
});
const dir = vi.hoisted(() => ({ filter: vi.fn() }));
vi.mock('../../src/api/client', () => ({ client: { entities: { Structure: { filter: (...a) => dir.filter(...a) } } } }));
vi.mock('@/components/FavoriteButton', () => ({ default: () => null }));

import NeedPicker from '../../src/components/needs/NeedPicker.jsx';
import ExternalBookingBlock from '../../src/components/ExternalBookingBlock.jsx';
import StructureCard from '../../src/components/cards/StructureCard.jsx';
import Annuaire from '../../src/pages/Annuaire.jsx';
import { MAX_NEEDS, NEED_BY_ID, NEED_DOMAINS, needBookingHref } from '../../src/lib/socialNeeds.js';

afterEach(() => { cleanup(); vi.clearAllMocks(); env.beta = false; });

function Where() { const l = useLocation(); return h('output', { 'data-testid': 'where' }, `${l.pathname}${l.search}`); }
const wrap = (el, path = '/') => render(h(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
  h(HelmetProvider, null, h(MemoryRouter, { initialEntries: [path] }, el, h(Where)))));

describe('the taxonomy in the interface', () => {
  it('is the 20 × 86 reference, and a need link goes to the directory need filter', () => {
    expect(NEED_DOMAINS).toHaveLength(20);
    expect(NEED_BY_ID.size).toBe(86);
    expect(needBookingHref('aide-alimentaire')).toBe('/structures?subdomain=aide-alimentaire');
  });
});

describe('NeedPicker (ADA Pro)', () => {
  function Harness({ initial = [] }) { const [v, setV] = useState(initial); return h(NeedPicker, { value: v, onChange: setV, testId: 'np' }); }
  it('is one labelled group of real checkboxes; a choice is listed with its own remove button; the count is announced', () => {
    wrap(h(Harness));
    const group = screen.getByRole('group', { name: /Besoins auxquels répond ce rendez-vous/ });
    fireEvent.click(within(group).getByTestId('np-aide-alimentaire'));
    expect(screen.getByTestId('np-count')).toHaveTextContent('1 besoin(s) choisi(s)');
    const chosen = screen.getByTestId('np-chosen');
    fireEvent.click(within(chosen).getByRole('button', { name: /Retirer le besoin/ }));
    expect(screen.queryByTestId('np-chosen')).toBeNull();
  });
  it('refuses more than the server limit: the other boxes are disabled once reached', () => {
    const eight = [...NEED_BY_ID.keys()].slice(0, MAX_NEEDS);
    wrap(h(Harness, { initial: eight }));
    const ninth = [...NEED_BY_ID.keys()][MAX_NEEDS];
    expect(screen.getByTestId(`np-${ninth}`)).toBeDisabled();
    expect(screen.getByTestId(`np-${eight[0]}`)).not.toBeDisabled();
  });
});

describe('« Rendez-vous sur leur site »', () => {
  const booking = { url: 'https://rdv.anct.gouv.fr/org/12', host: 'rdv.anct.gouv.fr', platform: 'rdv-service-public', platformLabel: 'RDV Service Public', subdomains: ['aide-alimentaire'] };
  it('the block says the person leaves AccesDirectAide; the link sends nothing about the visitor', () => {
    wrap(h(ExternalBookingBlock, { booking }));
    const link = screen.getByTestId('structure-external-booking-link');
    expect(link).toHaveAttribute('href', booking.url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(link).toHaveAttribute('aria-describedby', 'external-booking-leave');
    expect(screen.getByTestId('structure-external-booking-leave')).toHaveTextContent(/Vous quittez AccesDirectAide/);
    expect(screen.getByTestId('structure-external-booking')).toHaveTextContent(/Ce n’est pas une prise de rendez-vous sur AccesDirectAide/);
    expect(screen.getByTestId('structure-external-booking-platform')).toHaveTextContent('RDV Service Public');
  });
  it('shows nothing for a non-https or missing link', () => {
    const { container } = wrap(h(ExternalBookingBlock, { booking: { ...booking, url: 'http://x.fr' } }));
    expect(container.querySelector('[data-testid="structure-external-booking"]')).toBeNull();
  });
  it('the card badge is distinct and never the « RDV en ligne » one', () => {
    wrap(h(StructureCard, { structure: { id: 's', slug: 's', nom: 'Lieu', type_structure: 'association', online_booking: false, external_booking: booking } }));
    expect(screen.getByTestId('structure-external-booking-badge')).toHaveTextContent('Rendez-vous sur leur site');
    expect(screen.queryByTestId('structure-online-booking-badge')).toBeNull();
  });
  it('the StructureDetail page renders the block only from the server field', () => {
    const src = fs.readFileSync('src/pages/StructureDetail.jsx', 'utf8');
    expect(src).toMatch(/structure\.external_booking \? <ExternalBookingBlock booking=\{structure\.external_booking\} \/> : null/);
  });
});

describe('the directory need filter', () => {
  beforeEach(() => { dir.filter.mockResolvedValue({ items: [], pagination: { total: 0 } }); });
  it('a need link sends the subdomain to the server and shows a removable chip; an unknown id is not sent', async () => {
    wrap(h(Routes, null, h(Route, { path: '/structures', element: h(Annuaire) })), '/structures?subdomain=aide-alimentaire');
    await waitFor(() => expect(dir.filter).toHaveBeenCalled());
    expect(dir.filter.mock.calls.at(-1)[0]).toMatchObject({ subdomain: 'aide-alimentaire' });
    cleanup(); dir.filter.mockClear();
    wrap(h(Routes, null, h(Route, { path: '/structures', element: h(Annuaire) })), '/structures?subdomain=inconnu');
    await waitFor(() => expect(dir.filter).toHaveBeenCalled());
    expect(dir.filter.mock.calls.at(-1)[0].subdomain).toBeUndefined();
  });
  it('the « bookable=1 » links of /situation are the same filter as « rdv=1 »', async () => {
    wrap(h(Routes, null, h(Route, { path: '/structures', element: h(Annuaire) })), '/structures?bookable=1');
    await waitFor(() => expect(dir.filter).toHaveBeenCalled());
    expect(dir.filter.mock.calls.at(-1)[0]).toMatchObject({ bookable: '1' });
  });
  it('the need select is offered while booking is open, and lists the taxonomy by domain', async () => {
    wrap(h(Routes, null, h(Route, { path: '/structures', element: h(Annuaire) })), '/structures');
    const select = (await screen.findAllByTestId('structures-need-filter'))[0];
    expect(select.querySelectorAll('optgroup')).toHaveLength(20);
    expect(select.querySelectorAll('option')).toHaveLength(87);
    fireEvent.change(select, { target: { value: 'psy' } });
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('subdomain=psy'));
  });
  it('/situation and /droits link to it only while booking is open', () => {
    const situation = fs.readFileSync('src/pages/Situation.jsx', 'utf8');
    expect(situation).toMatch(/const booking = bookingOpened\(beta\) && \(s\.structures\.length > 0 \|\| bookingNeeds\.length > 0\)/);
    expect(situation).toMatch(/needBookingHref\(id\)/);
    const droits = fs.readFileSync('src/pages/Droits.jsx', 'utf8');
    expect(droits).toMatch(/bookingOpened\(frontendEnv\.flags\.publicBeta\) && NEED_BY_ID\.has\(need\.id\)/);
  });
  it('no new wording claims a partnership or a guaranteed appointment', () => {
    const fr = [fs.readFileSync('src/components/ExternalBookingBlock.jsx', 'utf8'), fs.readFileSync('src/components/rdv/ExternalBookingPanel.jsx', 'utf8')].join('\n');
    expect(fr).not.toMatch(/partenaire de|partenariat avec|garanti/i);
    for (const lang of ['en', 'de', 'tr', 'ar', 'uk']) {
      const s = JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/structures.json`, 'utf8'));
      for (const k of ['ownbooking.title', 'ownbooking.leave', 'card.external_booking', 'filters.need', 'filters.need_hint']) expect(s[k], `${lang} ${k}`).toBeTruthy();
    }
  });
});
