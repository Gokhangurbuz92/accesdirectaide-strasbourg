// @vitest-environment jsdom
/**
 * R43 — the booking page asks for 14 PARIS days starting today in Paris: at 23:30 UTC (00:30 or 01:30 in Paris, the next Paris day) and at 00:30 Paris
 * the window starts on the Paris day, never on the UTC « yesterday », and ends 13 days later (the API's 14-day maximum, last day counted to its end).
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/analytics', () => ({ track: vi.fn() }));
vi.mock('@/components/SEO', () => ({ default: () => null }));
vi.mock('@/lib/csrf', () => ({ csrfFetch: vi.fn(), ensureCsrfHeaders: async () => ({}), getCsrfHeaders: () => ({}) }));
import { addCalendarDays, parisBookingWindow, parisDate } from '../../src/lib/parisCalendar.js';
import PublicBooking from '../../src/pages/PublicBooking.jsx';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Paris booking window', () => {
  it('23:30 UTC is already the next Paris day (winter and summer); 00:30 Paris too; mid-day unchanged', () => {
    expect(parisBookingWindow(new Date('2026-11-04T23:30:00Z'))).toEqual({ from: '2026-11-05', to: '2026-11-18' });   // 00:30 CET
    expect(parisBookingWindow(new Date('2027-06-30T23:30:00Z'))).toEqual({ from: '2027-07-01', to: '2027-07-14' });   // 01:30 CEST
    expect(parisBookingWindow(new Date('2027-06-30T22:30:00Z'))).toEqual({ from: '2027-07-01', to: '2027-07-14' });   // 00:30 CEST
    expect(parisBookingWindow(new Date('2026-11-05T11:00:00Z'))).toEqual({ from: '2026-11-05', to: '2026-11-18' });
    expect(parisDate(new Date('2026-11-04T22:59:59Z'))).toBe('2026-11-04');   // 23:59:59 CET: still the 4th
  });
  it('calendar arithmetic across month ends and the DST changes', () => {
    expect(addCalendarDays('2027-10-25', 13)).toBe('2027-11-07');
    expect(addCalendarDays('2027-03-20', 13)).toBe('2027-04-02');
    expect(addCalendarDays('2026-12-25', 13)).toBe('2027-01-07');
  });
  it('the booking page requests the slots of the Paris window (00:30 Paris = 23:30 UTC the day before)', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T23:30:00Z') });
    const urls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url); urls.push(u);
      if (u.includes('/services')) return { ok: true, status: 200, json: async () => ({ teamChoice: false, items: [{ id: 's1', name: 'Accueil social', durationMinutes: 30, modes: ['IN_PERSON'] }] }) };
      if (u.includes('/slots')) return { ok: true, status: 200, json: async () => ({ confirmation: 'DIRECT', days: [] }) };
      return { ok: false, status: 404, json: async () => ({}) };
    }));
    render(h(MemoryRouter, { initialEntries: ['/rdv/structure-fictive/booking?serviceId=s1'] }, h(Routes, null, h(Route, { path: '/rdv/:structureSlug/booking', element: h(PublicBooking) }))));
    await screen.findByText(/Aucun créneau|créneau/i).catch(() => null);
    await vi.waitFor(() => expect(urls.some((u) => u.includes('/slots'))).toBe(true));
    const slots = new URL(urls.find((u) => u.includes('/slots')), 'http://x');
    expect([slots.searchParams.get('from'), slots.searchParams.get('to')]).toEqual(['2026-11-05', '2026-11-18']);
  });
});
