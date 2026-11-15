// @vitest-environment jsdom
/**
 * A-25 — one idempotency key per booking attempt on /rdv/:slug/booking (fetch doubled; the server replay itself is in tests/integration/bk-booking-fixes-db).
 *   - a lost answer (network failure, 5xx) keeps the key: the next click sends the SAME key, the server's replay (200) is shown as the confirmed booking,
 *     and the person is told the truth meanwhile (never « this slot was just taken », never a raw « Failed to fetch »);
 *   - a definitive refusal (409 slot taken) or another selection is another attempt: a new key.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/analytics', () => ({ track: vi.fn() }));
vi.mock('@/components/SEO', () => ({ default: () => null }));
vi.mock('@/lib/csrf', () => ({ csrfFetch: vi.fn(), ensureCsrfHeaders: async () => ({}), getCsrfHeaders: () => ({}) }));

import PublicBooking from '../../src/pages/PublicBooking.jsx';
import { attemptKey, attemptSignature, isDefinitiveAnswer, resetAttempts, settleAttempt } from '../../src/lib/bookingAttempt.js';

const LOC = { address: '1 rue Fictive, 67000 Strasbourg', verified: false, stepFreeAccess: true };
const PAYLOAD = { teamChoice: false, structure: { slug: 'cdgg', name: 'CDGG Conseil (fictif)', bookingMode: 'IN_PERSON', modes: ['IN_PERSON'], location: LOC }, video: { available: false },
  items: [{ id: 'ip', name: 'Accueil', durationMinutes: 30, modes: ['IN_PERSON'], confirmation: 'DIRECT' }] };
const S1 = '2030-01-07T08:00:00.000Z'; const S2 = '2030-01-07T08:30:00.000Z';
const CONFIRMED = { id: 'apt-12345678', state: 'CONFIRMED', status: 'CONFIRMED', mode: 'IN_PERSON', location: LOC };
const LOST = Symbol('lost');

/** a fetch double: services, two slots, then the booking answers in order (LOST = the answer never arrives) */
function stubApi(bookings) {
  const posts = [];
  const queue = [...bookings];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/services')) return { ok: true, status: 200, json: async () => PAYLOAD };
    if (u.includes('/slots')) return { ok: true, status: 200, json: async () => ({ confirmation: 'DIRECT', days: [{ date: '2030-01-07', slots: [{ startAt: S1 }, { startAt: S2 }] }] }) };
    if (u === '/api/rdv/appointments') {
      posts.push(JSON.parse(init.body));
      const b = queue.shift();
      if (b === LOST) throw new TypeError('Failed to fetch');
      return { ok: b.status < 300, status: b.status, json: async () => b.body };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }));
  return posts;
}
const page = () => render(h(MemoryRouter, { initialEntries: ['/rdv/cdgg/booking'] }, h(Routes, null, h(Route, { path: '/rdv/:structureSlug/booking', element: h('main', null, h(PublicBooking)) }))));
const toRecap = async (index = 0) => { fireEvent.click((await screen.findAllByTestId('booking-slot'))[index]); return screen.findByTestId('booking-confirm'); };
const confirm = async () => { const b = screen.getByTestId('booking-confirm'); await waitFor(() => expect(b).not.toBeDisabled()); fireEvent.click(b); };

beforeEach(() => resetAttempts());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('A-25: one idempotency key per booking attempt', () => {
  it('replay: the answer is lost, the person clicks again — same key, the confirmed booking is shown (never « slot taken »)', async () => {
    const posts = stubApi([LOST, { status: 200, body: CONFIRMED }]);   // 200 = the server replays the booking made by the first request
    page();
    fireEvent.click(await screen.findByTestId('booking-service-ip'));
    await toRecap();
    await confirm();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('votre demande est peut-être déjà enregistrée');
    expect(alert).toHaveTextContent('elle ne sera pas enregistrée deux fois');
    expect(alert).not.toHaveTextContent('Failed to fetch');
    expect(screen.queryByTestId('booking-slot-notice')).toBeNull();
    await confirm();
    expect(await screen.findByTestId('booking-success')).toBeInTheDocument();
    expect(screen.getByTestId('booking-state')).toHaveAttribute('data-state', 'CONFIRMED');
    expect(posts).toHaveLength(2);
    expect(posts[0].idempotencyKey).toBeTruthy();
    expect(posts[1].idempotencyKey).toBe(posts[0].idempotencyKey);
    expect(posts[1].startAt).toBe(S1);
  });

  it('a server error is not a definitive answer either: the key is kept for the retry', async () => {
    const posts = stubApi([{ status: 500, body: { error: 'Internal Server Error' } }, { status: 200, body: CONFIRMED }]);
    page();
    fireEvent.click(await screen.findByTestId('booking-service-ip'));
    await toRecap();
    await confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent('Nous n’avons pas reçu de réponse sûre');
    await confirm();
    await screen.findByTestId('booking-success');
    expect(posts[1].idempotencyKey).toBe(posts[0].idempotencyKey);
  });

  it('a definitive refusal ends the attempt, and another slot is another attempt: new keys', async () => {
    const posts = stubApi([{ status: 409, body: { error: 'Slot no longer available' } }, LOST, { status: 201, body: CONFIRMED }]);
    page();
    fireEvent.click(await screen.findByTestId('booking-service-ip'));
    await toRecap(0);
    await confirm();
    expect(await screen.findByTestId('booking-slot-notice')).toHaveTextContent('Ce créneau vient d’être réservé');   // really taken by someone else
    await toRecap(0);   // the same slot again after the refusal: a new attempt
    await confirm();
    await screen.findByRole('alert');
    fireEvent.click(screen.getByText('Retour'));
    await toRecap(1);   // another slot after a lost answer: never the first slot's key (the server would replay the first booking)
    await confirm();
    await screen.findByTestId('booking-success');
    expect(new Set(posts.map((p) => p.idempotencyKey)).size).toBe(3);
    expect(posts.map((p) => p.startAt)).toEqual([S1, S1, S2]);
  });

  it('the attempt helper: same selection → same key until settled; what counts as a definitive answer', () => {
    let n = 0; const create = () => `k${++n}`;
    const a = attemptSignature({ structureSlug: 's', serviceId: 'v', startAt: S1, mode: 'IN_PERSON', professional: '' });
    const b = attemptSignature({ structureSlug: 's', serviceId: 'v', startAt: S2, mode: 'IN_PERSON', professional: '' });
    expect(a).not.toBe(b);
    expect([attemptKey(a, create), attemptKey(a, create)]).toEqual(['k1', 'k1']);
    expect(attemptKey(b, create)).toBe('k2');
    expect(attemptKey(a, create)).toBe('k3');   // one attempt at a time
    settleAttempt(a);
    expect(attemptKey(a, create)).toBe('k4');
    expect([200, 201, 400, 401, 404, 409].map(isDefinitiveAnswer)).toEqual([true, true, true, true, true, true]);
    expect([408, 429, 500, 502, 503, 504].map(isDefinitiveAnswer)).toEqual([false, false, false, false, false, false]);
  });
});
