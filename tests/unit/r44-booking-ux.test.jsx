// @vitest-environment jsdom
/* global document, window */
/**
 * R44-BOOK — the account booking journey (/rdv/:slug/booking) without a database:
 *   - the modality is chosen BEFORE the slots (two-modality service), required (A5: aria-invalid + described + focus), with the recorded address and its
 *     verification state, the true video state (a LAB sandbox is said to be a test), video not active / telephone shown as not bookable;
 *   - a single-modality service goes straight to its slots (the native QA path DTA-B88), the slots are requested for that modality, and the place is
 *     shown on the slot step, the recap and the confirmation;
 *   - stale state: a slot taken meanwhile (409) reloads the SAME modality's slots with an announced reason, a modality withdrawn (MODE_UNAVAILABLE) goes
 *     back to the choice; an ended session (401) goes to sign-in with the service and modality kept (same-origin path);
 *   - the video agreement is said on its field (no silent disabled button);
 *   - the refusal reason: the agenda panel sends the optional fixed code, the person reads its sentence in their language;
 *   - A5 on the citizen sign-in / sign-up, forgotten and new password forms (the native QA contracts of DTA-B21 kept);
 *   - French, English and Arabic (RTL) texts; axe rules.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/analytics', () => ({ track: vi.fn() }));
vi.mock('@/components/SEO', () => ({ default: () => null }));
vi.mock('@/lib/csrf', () => ({ csrfFetch: vi.fn(), ensureCsrfHeaders: async () => ({}), getCsrfHeaders: () => ({}) }));
const pro = vi.hoisted(() => ({ decide: vi.fn(), list: vi.fn(), services: vi.fn() }));
vi.mock('@/api/pro-rdv-client', () => ({
  buildProAuthHeaders: () => ({}), getProToken: () => 'x',
  proRdvClient: { appointments: { decide: pro.decide, list: pro.list, update: vi.fn(), cancelLegacy: vi.fn() }, services: { list: pro.services } },
}));
const api = vi.hoisted(() => ({ myAppointments: vi.fn(), withdrawAppointmentMessage: vi.fn() }));
vi.mock('@/lib/citizenApi', () => ({ citizenApi: api }));
vi.mock('@/api/rdv-messaging-client', () => ({ rdvMessagingClient: { user: { getOrCreateFromAppointment: vi.fn() } } }));
vi.mock('@/components/Visio/VisioWindow', () => ({ default: () => null }));

import { acceptedMode, bookingContextQuery, bookingLocation, bookingRefusal, modalityOptions, serviceModes } from '../../src/lib/bookingModalities.js';
import { REFUSAL_REASON_CODES, refusalCode, refusalReasonText } from '../../src/lib/refusalReasons.js';
import { REFUSAL_REASON_TEXTS, refusalReasonMail } from '../../api/_utils/mail-catalogue.js';
import { REFUSAL_REASONS } from '../../api/_services/rdv-requests.js';
import PublicBooking from '../../src/pages/PublicBooking.jsx';
import ProAppointments from '../../src/pages/pro/Appointments.jsx';
import CompteRendezVous from '../../src/pages/CompteRendezVous.jsx';
import AuthRdvAccess from '../../src/pages/AuthRdvAccess.jsx';
import AuthForgotPassword from '../../src/pages/AuthForgotPassword.jsx';
import AuthResetPassword from '../../src/pages/AuthResetPassword.jsx';
import i18n, { setLanguage } from '../../src/i18n/index.js';

const lang = async (code) => { await act(async () => { await setLanguage(code, { persist: false }); }); };
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); await lang('fr'); });
const axeOk = async (ctx = document.body) => { const r = await axe.run(ctx, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }); expect(r.violations.map((v) => v.id)).toEqual([]); };

const LOC = { address: '1 rue Fictive, 67000 Strasbourg', verified: false, stepFreeAccess: true };
const PAYLOAD = (over = {}) => ({ teamChoice: false, structure: { slug: 'cdgg', name: 'CDGG Conseil (fictif)', bookingMode: 'BOTH', modes: ['IN_PERSON', 'VIDEO'], location: LOC }, video: { available: true, sandbox: true },
  items: [{ id: 'both', name: 'Entretien', durationMinutes: 30, modes: ['IN_PERSON', 'VIDEO'], confirmation: 'DIRECT' }, { id: 'ip', name: 'Accueil', durationMinutes: 30, modes: ['IN_PERSON'], confirmation: 'DIRECT' }], ...over });
const SLOT = '2030-01-07T08:00:00.000Z';

/** a fetch double: services, slots (per mode), the booking answer(s) in order */
function stubApi({ payload = PAYLOAD(), bookings = [{ status: 201, body: { id: 'apt-12345678', state: 'CONFIRMED', status: 'CONFIRMED', mode: 'IN_PERSON', location: LOC } }] } = {}) {
  const calls = [];
  const queue = [...bookings];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const u = String(url); calls.push({ url: u, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (u.includes('/services')) return { ok: true, status: 200, json: async () => payload };
    if (u.includes('/slots')) return { ok: true, status: 200, json: async () => ({ confirmation: 'DIRECT', days: [{ date: '2030-01-07', slots: [{ startAt: SLOT, endAt: '2030-01-07T08:30:00.000Z' }] }] }) };
    if (u === '/api/rdv/appointments') { const b = queue.shift() || { status: 500, body: {} }; return { ok: b.status < 300, status: b.status, json: async () => b.body }; }
    return { ok: false, status: 404, json: async () => ({}) };
  }));
  return calls;
}
const bookingPage = (q = '') => render(h(MemoryRouter, { initialEntries: [`/rdv/cdgg/booking${q}`] }, h(Routes, null, h(Route, { path: '/rdv/:structureSlug/booking', element: h('main', null, h(PublicBooking)) }))));
const slotsCalls = (calls) => calls.filter((c) => c.url.includes('/slots'));

describe('modalities (src/lib/bookingModalities.js)', () => {
  it('in person / video / telephone: only what the service offers is bookable; video not active and telephone are said, never offered', () => {
    expect(modalityOptions(PAYLOAD(), PAYLOAD().items[0])).toEqual([
      { mode: 'IN_PERSON', bookable: true, reason: '', sandbox: false }, { mode: 'VIDEO', bookable: true, reason: '', sandbox: true }, { mode: 'PHONE', bookable: false, reason: 'NOT_OFFERED_ONLINE', sandbox: false }]);
    const off = PAYLOAD({ video: { available: false, sandbox: false } });
    expect(modalityOptions(off, { modes: ['IN_PERSON'] })[1]).toEqual({ mode: 'VIDEO', bookable: false, reason: 'VIDEO_NOT_ACTIVE', sandbox: false });
    expect(modalityOptions({ structure: { bookingMode: 'IN_PERSON' } }, { modes: ['IN_PERSON'] })[1].reason).toBe('NOT_FOR_SERVICE');
    expect(serviceModes({})).toEqual(['IN_PERSON']);   // an older answer is in person, never video
    expect(serviceModes({ modes: ['PHONE', 'VIDEO'] })).toEqual(['VIDEO']);
    expect(acceptedMode('video', { modes: ['IN_PERSON', 'VIDEO'] })).toBe('VIDEO');
    expect(acceptedMode('VIDEO', { modes: ['IN_PERSON'] })).toBe('');
    expect(acceptedMode('PHONE', { modes: ['IN_PERSON'] })).toBe('');
  });
  it('the location is the recorded address only (none → null, never invented)', () => {
    expect(bookingLocation(PAYLOAD())).toEqual(LOC);
    expect(bookingLocation({ structure: { location: { address: '  ' } } })).toBeNull();
    expect(bookingLocation({ structure: {} })).toBeNull();
    expect(bookingLocation({ structure: { location: { address: 'x', verified: 'yes' } } })).toEqual({ address: 'x', verified: false, stepFreeAccess: false });
  });
  it('refusals of a booking map to the journey (the existing 409 codes)', () => {
    expect(bookingRefusal(401, {})).toBe('AUTH');
    expect(bookingRefusal(409, { code: 'AGE_DECLARATION_REQUIRED' })).toBe('AGE_DECLARATION');
    expect(bookingRefusal(409, { code: 'MODE_UNAVAILABLE' })).toBe('MODE');
    expect(bookingRefusal(409, { error: 'Slot no longer available' })).toBe('SLOT_TAKEN');
    expect(bookingRefusal(409, { code: 'SLOT_TAKEN' })).toBe('SLOT_TAKEN');
    expect(bookingRefusal(400, { code: 'VIDEO_CONSENT_REQUIRED' })).toBe('VIDEO_CONSENT');
    expect(bookingRefusal(500, {})).toBe('OTHER');
  });
  it('the context kept through sign-in: service and modality only, validated; never an appointment or a token', () => {
    expect(bookingContextQuery('?aide=x&appointment=a1&token=t', { serviceId: 's1', mode: 'VIDEO' })).toBe('?aide=x&serviceId=s1&mode=VIDEO');
    expect(bookingContextQuery('', { serviceId: '../x', mode: 'PHONE' })).toBe('');
    expect(bookingContextQuery('?serviceId=old', { serviceId: 'https://evil.example', mode: '' })).toBe('');
  });
});

describe('the booking page: modality before the slots', () => {
  it('a two-modality service asks how; continuing without a choice is said on the group (A5), nothing is loaded', async () => {
    const calls = stubApi();
    bookingPage();
    fireEvent.click(await screen.findByTestId('booking-service-both'));
    expect(await screen.findByTestId('booking-modality')).toBeInTheDocument();
    expect(slotsCalls(calls)).toHaveLength(0);
    // what is known before any commitment: the recorded address, unverified, step-free; the video is a test environment; telephone not bookable
    expect(screen.getByTestId('booking-modality-location')).toHaveTextContent('1 rue Fictive, 67000 Strasbourg');
    expect(screen.getByTestId('booking-modality-location')).toHaveTextContent('adresse non encore vérifiée');
    expect(screen.getByTestId('booking-video-sandbox')).toHaveTextContent('Ce n’est pas un service de visio en fonctionnement.');
    expect(screen.getByTestId('booking-modality-unavailable-PHONE')).toHaveTextContent('Pas proposé en ligne');
    expect(screen.queryByRole('radio', { name: /téléphone/i })).toBeNull();
    fireEvent.click(screen.getByTestId('booking-modality-continue'));
    const group = screen.getByRole('radiogroup');
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group.getAttribute('aria-describedby')).toBe(screen.getByTestId('booking-modality-error').id);
    expect(group).toHaveFocus();
    expect(slotsCalls(calls)).toHaveLength(0);
    await axeOk();
    fireEvent.click(screen.getByTestId('booking-modality-VIDEO'));
    expect(screen.queryByTestId('booking-modality-error')).toBeNull();
    fireEvent.click(screen.getByTestId('booking-modality-continue'));
    await screen.findAllByTestId('booking-slot');
    expect(slotsCalls(calls)[0].url).toContain('mode=VIDEO');
    expect(screen.getByTestId('booking-slot-mode')).toHaveTextContent('À distance, en visio');
  });

  it('video: the agreement is said on its field (no disabled button), focused, nothing sent; then the booking carries it', async () => {
    const calls = stubApi({ bookings: [{ status: 201, body: { id: 'apt-1', state: 'CONFIRMED', status: 'CONFIRMED', mode: 'VIDEO', video: { service: { sandbox: true } } } }] });
    bookingPage('?serviceId=both&mode=VIDEO');
    fireEvent.click((await screen.findAllByTestId('booking-slot'))[0]);
    expect(screen.getByTestId('booking-recap-video')).toHaveTextContent('Aucun lien n’est envoyé par e-mail.');
    expect(screen.queryByText(/Jitsi/)).toBeNull();
    const confirm = screen.getByTestId('booking-confirm');
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    const box = screen.getByTestId('booking-video-consent-checkbox');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box.getAttribute('aria-describedby')).toBe('booking-video-consent-error');
    expect(box).toHaveFocus();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    await axeOk();
    fireEvent.click(box);
    fireEvent.click(confirm);
    expect(await screen.findByTestId('booking-success')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST').body).toMatchObject({ mode: 'VIDEO', videoConsent: true, serviceId: 'both', startAt: SLOT });
    expect(screen.getByTestId('booking-confirmation-video')).toHaveTextContent('Environnement de test');
  });

  it('a single-modality service goes straight to its slots (DTA-B88 path); the place is shown on the slots, the recap and the confirmation', async () => {
    const calls = stubApi();
    bookingPage();
    fireEvent.click(await screen.findByTestId('booking-service-ip'));
    fireEvent.click((await screen.findAllByTestId('booking-slot'))[0]);
    expect(screen.queryByTestId('booking-modality')).toBeNull();
    expect(slotsCalls(calls)[0].url).toContain('mode=IN_PERSON');
    expect(screen.getByTestId('booking-recap-location')).toHaveTextContent('1 rue Fictive');
    // the native QA clicks « Sur place » on the recap: still a button with that name; the same modality reloads nothing
    fireEvent.click(screen.getByRole('button', { name: /Sur place/ }));
    expect(slotsCalls(calls)).toHaveLength(1);
    fireEvent.click(screen.getByTestId('booking-confirm'));
    expect(await screen.findByTestId('booking-state')).toHaveTextContent('C’est confirmé !');
    expect(screen.getByTestId('booking-confirmation-location')).toHaveTextContent('1 rue Fictive');
    await axeOk();
  });

  it('a structure without a recorded address says « to confirm », never an invented one', async () => {
    stubApi({ payload: PAYLOAD({ structure: { slug: 'cdgg', bookingMode: 'IN_PERSON', modes: ['IN_PERSON'], location: null } }) });
    bookingPage('?serviceId=ip');
    expect(await screen.findByTestId('booking-slot-location')).toHaveTextContent('Adresse : à confirmer auprès de la structure');
  });

  it('stale slot: a 409 reloads the slots of the SAME modality and says why; nothing is shown as booked', async () => {
    const calls = stubApi({ bookings: [{ status: 409, body: { error: 'Slot no longer available' } }] });
    bookingPage('?serviceId=both&mode=IN_PERSON');
    fireEvent.click((await screen.findAllByTestId('booking-slot'))[0]);
    fireEvent.click(screen.getByTestId('booking-confirm'));
    expect(await screen.findByTestId('booking-slot-notice')).toHaveTextContent('Ce créneau vient d’être réservé.');
    expect(screen.getByTestId('booking-slot-notice')).toHaveAttribute('role', 'status');
    expect(screen.queryByTestId('booking-success')).toBeNull();
    expect(slotsCalls(calls)).toHaveLength(2);
    expect(slotsCalls(calls).every((c) => c.url.includes('mode=IN_PERSON'))).toBe(true);
  });

  it('a modality withdrawn meanwhile (MODE_UNAVAILABLE) goes back to the choice with the reason', async () => {
    stubApi({ bookings: [{ status: 409, body: { code: 'MODE_UNAVAILABLE' } }] });
    bookingPage('?serviceId=both&mode=VIDEO');
    fireEvent.click((await screen.findAllByTestId('booking-slot'))[0]);
    fireEvent.click(screen.getByTestId('booking-video-consent-checkbox'));
    fireEvent.click(screen.getByTestId('booking-confirm'));
    expect(await screen.findByTestId('booking-modality-error')).toHaveTextContent('rien n’a été réservé');
  });

  it('an ended session (401) goes to sign-in with the service and modality kept in a same-origin path', async () => {
    stubApi({ bookings: [{ status: 401, body: { error: 'Unauthorized' } }] });
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign, search: '?aide=rsa', pathname: '/rdv/cdgg/booking' } });
    try {
      bookingPage('?serviceId=ip');
      fireEvent.click((await screen.findAllByTestId('booking-slot'))[0]);
      fireEvent.click(screen.getByTestId('booking-confirm'));
      await waitFor(() => expect(assign).toHaveBeenCalled());
      const target = new URL(assign.mock.calls[0][0], 'http://x');
      expect(target.pathname).toBe('/auth/login');
      expect(target.searchParams.get('next')).toBe('/rdv/cdgg/booking?aide=rsa&serviceId=ip&mode=IN_PERSON');
    } finally { Object.defineProperty(window, 'location', { configurable: true, value: original }); }
  });

  it('the progress is an ordered list with the current step marked', async () => {
    stubApi();
    bookingPage();
    await screen.findByTestId('booking-service-both');
    const steps = within(screen.getByTestId('booking-progress')).getAllByRole('listitem');
    expect(steps).toHaveLength(5);
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
  });

  for (const [code, legend, phone] of [['en', 'How would you like to be received?', 'Not offered online'], ['ar', 'كيف تفضّل أن يتم استقبالك؟', 'غير متاح عبر الإنترنت']]) {
    it(`${code}: the modality step is translated (no French sentence left)${code === 'ar' ? ', the document reads right to left' : ''}`, async () => {
      await lang(code);
      stubApi();
      bookingPage();
      fireEvent.click(await screen.findByTestId('booking-service-both'));
      expect(await screen.findByText(legend)).toBeInTheDocument();
      expect(screen.getByTestId('booking-modality-unavailable-PHONE')).toHaveTextContent(phone);
      expect(screen.getByTestId('booking-modality')).not.toHaveTextContent('Comment souhaitez-vous');
      if (code === 'ar') expect(document.documentElement.dir).toBe('rtl');
      await axeOk();
    });
  }
});

describe('the refusal reason (API contract REFUSAL_REASONS, proposal awaiting the owner)', () => {
  it('the same three fixed codes on both sides; the French sentences are the API ones; every language has each sentence', () => {
    expect([...REFUSAL_REASON_CODES]).toEqual(Object.keys(REFUSAL_REASONS));
    for (const c of REFUSAL_REASON_CODES) {
      expect(REFUSAL_REASON_TEXTS[c].fr).toBe(REFUSAL_REASONS[c]);
      expect(refusalReasonText((k, f) => f, c)).toBe(REFUSAL_REASONS[c]);
      for (const l of ['fr', 'en', 'tr', 'ar', 'de', 'uk']) expect(REFUSAL_REASON_TEXTS[c][l]).toMatch(/\S/);
    }
    expect(refusalReasonMail('NOPE', 'de')).toBe(REFUSAL_REASON_TEXTS.OTHER.de);
    expect(refusalReasonMail('NO_CAPACITY', 'xx')).toBe(REFUSAL_REASONS.NO_CAPACITY);
    expect(refusalCode('<script>')).toBe('');
  });

  it('the agenda: no browser confirm; an optional reason, the sentence the person will read; the chosen code is sent; the notice status is announced', async () => {
    const confirmSpy = vi.fn(() => true); vi.stubGlobal('confirm', confirmSpy);
    const start = new Date(Date.now() + 3 * 86400000).toISOString();
    pro.services.mockResolvedValue([]);
    pro.list.mockResolvedValue({ items: [{ id: 'r1', status: 'requested', awaitingDecision: true, startAt: start, mode: 'IN_PERSON', serviceName: 'Accueil' }], totalPages: 1 });
    pro.decide.mockResolvedValue({ ok: true, status: 'refused', notification: { citizenEmail: 'TEST_RECORDED' } });
    render(h(MemoryRouter, null, h('main', null, h(ProAppointments))));
    fireEvent.click(await screen.findByTestId('pro-agenda-refuse'));
    const panel = screen.getByTestId('pro-agenda-refusal-panel');
    expect(screen.getByTestId('pro-agenda-refuse')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('pro-agenda-refusal-reason-NONE')).toBeChecked();   // optional: nothing chosen = the neutral sentence
    expect(screen.getByTestId('pro-agenda-refusal-preview')).toHaveTextContent(REFUSAL_REASONS.OTHER);
    expect(within(panel).queryByRole('textbox')).toBeNull();   // no free text can reach the person
    fireEvent.click(screen.getByTestId('pro-agenda-refusal-reason-NO_CAPACITY'));
    expect(screen.getByTestId('pro-agenda-refusal-preview')).toHaveTextContent(REFUSAL_REASONS.NO_CAPACITY);
    await axeOk();
    fireEvent.click(screen.getByTestId('pro-agenda-refusal-confirm'));
    await waitFor(() => expect(pro.decide).toHaveBeenCalledWith('r1', 'REFUSE', 'NO_CAPACITY', start));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(await screen.findByTestId('pro-agenda-decision-status')).toHaveTextContent('enregistré (environnement de test)');
  });

  it('the agenda: « without a reason » sends no code (the API records the neutral OTHER); « keep » sends nothing', async () => {
    const start = new Date(Date.now() + 3 * 86400000).toISOString();
    pro.services.mockResolvedValue([]);
    pro.list.mockResolvedValue({ items: [{ id: 'r2', status: 'requested', awaitingDecision: true, startAt: start, mode: 'IN_PERSON' }], totalPages: 1 });
    pro.decide.mockResolvedValue({ ok: true, notification: { citizenEmail: 'NO_RECIPIENT' } });
    render(h(MemoryRouter, null, h('main', null, h(ProAppointments))));
    fireEvent.click(await screen.findByTestId('pro-agenda-refuse'));
    fireEvent.click(screen.getByTestId('pro-agenda-refusal-cancel'));
    expect(screen.queryByTestId('pro-agenda-refusal-panel')).toBeNull();
    expect(pro.decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('pro-agenda-refuse'));
    fireEvent.click(screen.getByTestId('pro-agenda-refusal-confirm'));
    await waitFor(() => expect(pro.decide).toHaveBeenCalledWith('r2', 'REFUSE', undefined, start));
  });

  for (const [code, text] of [['fr', REFUSAL_REASONS.NOT_SUITABLE], ['ar', REFUSAL_REASON_TEXTS.NOT_SUITABLE.ar], ['uk', REFUSAL_REASON_TEXTS.NOT_SUITABLE.uk]]) {
    it(`${code}: « Mes rendez-vous » shows the structure's reason in the person's language`, async () => {
      await lang(code);
      api.myAppointments.mockResolvedValue({ appointments: [{ id: 'a1', state: 'REFUSED', status: 'REFUSED', mode: 'IN_PERSON', startsAt: '2030-01-07T08:00:00.000Z', structure: { name: 'S' }, service: { name: 'X' }, refusal: { reasonCode: 'NOT_SUITABLE' } }] });
      render(h(MemoryRouter, null, h(CompteRendezVous)));
      expect(await screen.findByTestId('rdv-refusal-reason')).toHaveTextContent(text);
    });
  }
});

describe('A5 — citizen sign-in, sign-up, forgotten and new password', () => {
  let posts;
  beforeEach(() => {
    posts = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => { posts.push(String(url)); return { ok: false, status: 401, json: async () => ({ message: 'Adresse ou mot de passe incorrect.' }) }; }));
  });
  const authPage = (mode) => render(h(MemoryRouter, { initialEntries: [`/auth/${mode}?next=/rdv/cdgg/booking`] }, h('main', null, h(AuthRdvAccess, { mode }))));

  it('sign-in: an empty submit is not blocked by a disabled button; each field says what is missing, the summary takes the focus and links to it; nothing sent', async () => {
    authPage('login');
    const submit = screen.getByRole('button', { name: 'Se connecter' });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    const email = screen.getByLabelText('Email'); const pw = screen.getByLabelText('Mot de passe', { exact: true });
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email.getAttribute('aria-describedby')).toContain('auth-email-error');
    expect(screen.getByText('Email : ce champ est obligatoire.', { selector: '#auth-email-error' })).toBeInTheDocument();
    expect(pw).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('auth-error-summary')).toHaveFocus();
    const link = within(screen.getByTestId('auth-error-summary')).getAllByRole('link')[0];
    fireEvent.click(link);
    expect(email).toHaveFocus();
    expect(posts).toEqual([]);
    await axeOk();
    fireEvent.change(email, { target: { value: 'nom@exemple' } });
    expect(email).not.toHaveAttribute('aria-invalid');
    fireEvent.click(submit);
    expect(screen.getByText(/saisissez une adresse e-mail valide/, { selector: '#auth-email-error' })).toBeInTheDocument();
    expect(posts).toEqual([]);
  });

  it('sign-in: a server refusal stays one banner (not attributed to a field)', async () => {
    authPage('login');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nom@exemple.fr' } });
    fireEvent.change(screen.getByLabelText('Mot de passe', { exact: true }), { target: { value: 'Wrong-Passw0rd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(within(await screen.findByTestId('auth-error-summary')).getByRole('alert')).toHaveTextContent('Adresse ou mot de passe incorrect.');
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(posts).toEqual(['/api/auth/login']);
  });

  it('sign-up: DTA-B21 contract kept — the adult statement alone in error: the summary alert carries its message, is focused, #auth-adult-error describes the box', async () => {
    authPage('signup');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nom@exemple.fr' } });
    fireEvent.change(screen.getByLabelText('Mot de passe', { exact: true }), { target: { value: 'Qa-Passw0rd-1' } });
    fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), { target: { value: 'Qa-Passw0rd-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    const msg = 'Cochez la déclaration « J’ai 18 ans ou plus » pour créer un compte.';
    expect(within(screen.getByTestId('auth-error-summary')).getByRole('alert')).toHaveTextContent(msg);
    expect(screen.getByTestId('auth-error-summary')).toHaveFocus();
    const adult = screen.getByRole('checkbox', { name: 'J’ai 18 ans ou plus' });
    expect(adult).toHaveAttribute('aria-invalid', 'true');
    expect(adult.getAttribute('aria-describedby').split(' ')).toContain('auth-adult-error');
    expect(document.querySelector('#auth-adult-error')).toHaveTextContent(msg);
    expect(posts).toEqual([]);
  });

  it('sign-up: an empty confirmation and a mismatch are said on the confirmation field', async () => {
    authPage('signup');
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    const confirm = screen.getByLabelText('Confirmer le mot de passe');
    expect(confirm).toHaveAttribute('aria-invalid', 'true');
    expect(document.querySelector('#auth-confirm-error')).toHaveTextContent('Confirmer le mot de passe : ce champ est obligatoire.');
    fireEvent.change(screen.getByLabelText('Mot de passe', { exact: true }), { target: { value: 'Qa-Passw0rd-1' } });
    fireEvent.change(confirm, { target: { value: 'Qa-Passw0rd-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    expect(document.querySelector('#auth-confirm-error')).toHaveTextContent('Les mots de passe ne correspondent pas.');
    expect(posts).toEqual([]);
  });

  it('ar: the sign-in messages are translated and the page reads right to left', async () => {
    await lang('ar');
    authPage('login');
    fireEvent.click(screen.getAllByRole('button')[0].closest('form').querySelector('button[type="submit"]'));
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.querySelector('#auth-email-error').textContent).not.toMatch(/ce champ est obligatoire/);
    expect(document.querySelector('#auth-email-error').textContent).toMatch(/[؀-ۿ]/);
  });

  it('forgotten password: empty / malformed address said on the field, summary focused, nothing sent; the R35 label is kept', async () => {
    render(h(MemoryRouter, { initialEntries: ['/auth/forgot'] }, h('main', null, h(AuthForgotPassword))));
    const field = screen.getByLabelText('Adresse e-mail', { exact: true });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le lien' }));
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby')).toBe('forgot-email-error');
    expect(screen.getByTestId('forgot-error-summary')).toHaveFocus();
    fireEvent.change(field, { target: { value: 'pas-une-adresse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le lien' }));
    expect(screen.getByTestId('forgot-email-error')).toHaveTextContent('saisissez une adresse e-mail valide');
    expect(posts).toEqual([]);
    await axeOk();
  });

  it('new password: the rule stays in the description; each field has its own message; nothing sent', async () => {
    render(h(MemoryRouter, { initialEntries: ['/auth/reset?token=abc'] }, h('main', null, h(AuthResetPassword))));
    fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour' }));
    const pw = screen.getByLabelText('Nouveau mot de passe'); const confirm = screen.getByLabelText('Confirmer le mot de passe');
    expect(pw.getAttribute('aria-describedby').split(' ')).toEqual(['reset-password-rule', 'reset-password-error']);
    expect(confirm).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('reset-error-summary')).toHaveFocus();
    fireEvent.change(pw, { target: { value: 'Qa-Passw0rd-1' } });
    fireEvent.change(confirm, { target: { value: 'Qa-Passw0rd-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour' }));
    expect(screen.getByTestId('reset-password-confirm-error')).toHaveTextContent('Les mots de passe ne correspondent pas.');
    expect(pw).not.toHaveAttribute('aria-invalid');
    expect(posts).toEqual([]);
  });
});

// i18n is imported for its side effects on the language of the tests (setLanguage); keep the binding used
void i18n;
