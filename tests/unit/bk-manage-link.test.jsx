// @vitest-environment jsdom
/* global document, window */
/**
 * A-28 — the « gérer mon rendez-vous » link of the e-mail when it no longer opens the appointment (24-hour token expired, altered or incomplete): a
 * translated explanation and a working way to reach the appointment (sign in → « Mes rendez-vous »), never the raw server text « Appointment not found »,
 * never the new-booking service list nor its « retry » that fails with 401. A passing failure offers a retry of the same link.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/analytics', () => ({ track: vi.fn() }));
vi.mock('@/components/SEO', () => ({ default: () => null }));
const csrf = vi.hoisted(() => ({ csrfFetch: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ csrfFetch: csrf.csrfFetch, ensureCsrfHeaders: async () => ({}), getCsrfHeaders: () => ({}) }));

import PublicBooking from '../../src/pages/PublicBooking.jsx';
import { setLanguage } from '../../src/i18n/index.js';

const TOKEN = 'a'.repeat(40);
const open = (hash = `#token=${TOKEN}`) => {
  window.history.replaceState(null, '', `/rdv/cdgg/booking?appointment=apt-1${hash}`);
  return render(h(MemoryRouter, { initialEntries: ['/rdv/cdgg/booking?appointment=apt-1'] }, h(Routes, null, h(Route, { path: '/rdv/:structureSlug/booking', element: h('main', null, h(PublicBooking)) }))));
};
const answer = (status, body) => ({ ok: status < 300, status, json: async () => body });
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); csrf.csrfFetch.mockReset(); await act(async () => { await setLanguage('fr', { persist: false }); }); });

describe('A-28: a manage link that no longer opens the appointment', () => {
  it('expired (404): translated explanation, sign-in to « Mes rendez-vous », no raw server text, no service list', async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    csrf.csrfFetch.mockResolvedValue(answer(404, { error: 'Appointment not found' }));
    open();
    const block = await screen.findByTestId('booking-manage-link-problem');
    expect(block).toHaveAttribute('data-reason', 'invalid');
    expect(block).toHaveTextContent('Ce lien ne permet plus d’ouvrir le rendez-vous');
    expect(block).toHaveTextContent('valable 24 heures');
    expect(screen.getByTestId('booking-manage-link-signin')).toHaveAttribute('href', '/auth/login?next=%2Fcompte%2Frendez-vous');
    expect(document.body).not.toHaveTextContent('Appointment not found');
    expect(screen.queryByTestId('booking-services-retry')).toBeNull();
    expect(screen.queryByTestId('booking-services-empty')).toBeNull();
    expect(screen.queryByTestId('booking-manage-link-retry')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();   // no services call for a manage link (it answered 401 to a signed-out person)
    expect(csrf.csrfFetch.mock.calls[0][1].body).toBe(JSON.stringify({ token: TOKEN }));
  });

  it('in another language (Arabic): the explanation is translated', async () => {
    await act(async () => { await setLanguage('ar', { persist: false }); });
    vi.stubGlobal('fetch', vi.fn());
    csrf.csrfFetch.mockResolvedValue(answer(404, { error: 'Appointment not found' }));
    open();
    expect(await screen.findByTestId('booking-manage-link-problem')).toHaveTextContent('لم يعد هذا الرابط يفتح الموعد');
    expect(screen.getByTestId('booking-manage-link-signin')).toHaveTextContent('تسجيل الدخول وعرض مواعيدي');
  });

  it('a link without its token: the same explanation, nothing sent', async () => {
    vi.stubGlobal('fetch', vi.fn());
    open('');
    expect(await screen.findByTestId('booking-manage-link-problem')).toHaveAttribute('data-reason', 'invalid');
    expect(csrf.csrfFetch).not.toHaveBeenCalled();
  });

  it('a passing failure (500 / network): « Réessayer » reloads the same link and shows the appointment', async () => {
    vi.stubGlobal('fetch', vi.fn());
    csrf.csrfFetch.mockResolvedValueOnce(answer(500, { error: 'Internal Server Error' }))
      .mockResolvedValueOnce(answer(200, { id: 'apt-12345678', status: 'CONFIRMED', state: 'CONFIRMED', mode: 'IN_PERSON', location: null }));
    open();
    expect(await screen.findByTestId('booking-manage-link-problem')).toHaveAttribute('data-reason', 'unavailable');
    expect(document.body).not.toHaveTextContent('Internal Server Error');
    fireEvent.click(screen.getByTestId('booking-manage-link-retry'));
    expect(await screen.findByTestId('booking-success')).toBeInTheDocument();
    expect(csrf.csrfFetch).toHaveBeenCalledTimes(2);
    expect(csrf.csrfFetch.mock.calls[1][1].body).toBe(JSON.stringify({ token: TOKEN }));
  });
});
