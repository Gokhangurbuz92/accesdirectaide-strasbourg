// @vitest-environment jsdom
/**
 * R38 — the account-free booking page: service -> slot -> identity form (labelled fields, health warning on the note, consent) -> code step; errors announced;
 * the hold POST goes through csrfFetch with the minimal identity; an unavailable structure says so (no form).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const posts = [];
vi.mock('@/lib/csrf', () => ({ csrfFetch: vi.fn(async (url, init) => { posts.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ hold: { id: 'h1', status: 'REQUESTED' }, emailMasked: 'ca***@exemple.fr' }), { status: 202, headers: { 'content-type': 'application/json' } }); }) }));
vi.mock('@/components/SEO', () => ({ default: () => null }));

const slotAt = new Date(Date.now() + 3 * 86_400_000); slotAt.setUTCHours(8, 0, 0, 0);
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); posts.length = 0; });

async function renderAt(fetchImpl) {
  vi.stubGlobal('fetch', vi.fn(fetchImpl));
  const { default: GuestBooking } = await import('../../src/pages/GuestBooking.jsx');
  render(createElement(MemoryRouter, { initialEntries: ['/rdv/s1/sans-compte'] }, createElement(Routes, null, createElement(Route, { path: '/rdv/:structureSlug/sans-compte', element: createElement(GuestBooking) }))));
}

describe('GuestBooking page', () => {
  it('walks service -> slot -> form -> code, with labelled fields, the health warning and an announced error', async () => {
    await renderAt(async (url) => (String(url).includes('/services')
      ? json({ structure: { slug: 's1', name: 'Accueil Test' }, items: [{ id: 'svc', name: 'Accueil', durationMinutes: 30 }] })
      : json({ slots: [{ startAt: slotAt.toISOString(), endAt: new Date(slotAt.getTime() + 1_800_000).toISOString() }] })));
    await screen.findByText('Accueil Test');
    const slotRadio = await screen.findByRole('radio', { name: /\d{2}:\d{2}/ });
    fireEvent.click(slotRadio);
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    await waitFor(() => expect(globalThis.document.activeElement?.textContent).toBe('2. Vos coordonnées'));
    expect(screen.getByLabelText('Nom ou initiales')).toBeTruthy();
    expect(screen.getByLabelText('Adresse e-mail')).toBeTruthy();
    expect(screen.getByLabelText('Téléphone (facultatif)')).toBeTruthy();
    const note = screen.getByLabelText('Message court pour la structure (facultatif)');
    expect(note.getAttribute('maxLength')).toBe('300');
    expect(note.getAttribute('aria-describedby')).toContain('guest-note-warning');
    expect(screen.getByText(/aucune information de santé/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Recevoir le code' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Corrigez/);
    expect(posts).toEqual([]);
    fireEvent.change(screen.getByLabelText('Nom ou initiales'), { target: { value: 'C. D.' } });
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'ca@exemple.fr' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Recevoir le code' }));
    await screen.findByLabelText('Code reçu par e-mail');
    expect(posts[0].url).toBe('/api/rdv/guest/hold');
    expect(posts[0].body).toMatchObject({ structureSlug: 's1', serviceId: 'svc', startAt: slotAt.toISOString(), name: 'C. D.', email: 'ca@exemple.fr', consent: true });
    expect(posts[0].body.idempotencyKey).toBeTruthy();
    expect(screen.getByText(/ca\*\*\*@exemple\.fr/)).toBeTruthy();
  });
  it('a structure without account-free booking shows the refusal, not the form', async () => {
    await renderAt(async () => json({ code: 'GUEST_BOOKING_UNAVAILABLE' }, 404));
    expect((await screen.findByTestId('guest-unavailable')).textContent).toMatch(/ne propose pas de rendez-vous sans compte/);
    expect(screen.queryByLabelText('Adresse e-mail')).toBeNull();
  });
});
