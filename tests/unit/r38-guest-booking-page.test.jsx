// @vitest-environment jsdom
/**
 * R38 — the account-free booking page: service -> slot -> identity form (labelled fields, health warning on the note, consent) -> code step; errors announced;
 * the hold POST goes through csrfFetch with the minimal identity; an unavailable structure says so (no form).
 * R39: the optional J-1 reminder box is separate, unticked by default, not required; the payload carries reminderConsent (false unless ticked).
 * The booking-mails consent box is now addressed by its name (two checkboxes on the form).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const posts = [];
vi.mock('@/lib/csrf', () => ({ csrfFetch: vi.fn(async (url, init) => {
  posts.push({ url, body: JSON.parse(init.body) });
  // R39: a confirm of a hold the server does not know (no hold was taken: the address already had a booking with this structure)
  if (String(url).endsWith('/confirm')) return new Response(JSON.stringify({ error: 'Appointment not found', code: 'APPOINTMENT_NOT_FOUND' }), { status: 404, headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify({ hold: { id: 'h1', status: 'REQUESTED' }, emailMasked: 'ca***@exemple.fr' }), { status: 202, headers: { 'content-type': 'application/json' } });
}) }));
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
    fireEvent.click(screen.getByRole('checkbox', { name: /J’accepte de recevoir par e-mail les messages de ce rendez-vous/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Recevoir le code' }));
    await screen.findByLabelText('Code reçu par e-mail');
    expect(posts[0].url).toBe('/api/rdv/guest/hold');
    expect(posts[0].body).toMatchObject({ structureSlug: 's1', serviceId: 'svc', startAt: slotAt.toISOString(), name: 'C. D.', email: 'ca@exemple.fr', consent: true });
    expect(posts[0].body.idempotencyKey).toBeTruthy();
    expect(screen.getByText(/ca\*\*\*@exemple\.fr/)).toBeTruthy();
    expect(posts[0].body.reminderConsent).toBe(false);   // R39: never implied by the booking-mails consent
  });

  const toForm = async () => {
    await renderAt(async (url) => (String(url).includes('/services')
      ? json({ structure: { slug: 's1', name: 'Accueil Test' }, items: [{ id: 'svc', name: 'Accueil', durationMinutes: 30 }] })
      : json({ slots: [{ startAt: slotAt.toISOString(), endAt: new Date(slotAt.getTime() + 1_800_000).toISOString() }] })));
    fireEvent.click(await screen.findByRole('radio', { name: /\d{2}:\d{2}/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    await screen.findByLabelText('Nom ou initiales');
    fireEvent.change(screen.getByLabelText('Nom ou initiales'), { target: { value: 'C. D.' } });
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'ca@exemple.fr' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /J’accepte de recevoir/ }));
  };
  it('R39: the J-1 reminder box is a separate, labelled checkbox, unticked by default, with its help text linked; not required', async () => {
    await toForm();
    const box = screen.getByRole('checkbox', { name: 'Recevoir aussi un rappel par e-mail la veille du rendez-vous (facultatif)' });
    expect(box.checked).toBe(false);
    expect(box.required).toBe(false);
    expect(box.getAttribute('aria-describedby')).toBe('guest-reminder-help');
    expect(globalThis.document.getElementById('guest-reminder-help').textContent).toMatch(/lien personnel/);
    expect(box.className).toMatch(/\bh-6\b/); expect(box.className).toMatch(/\bw-6\b/);   // a 24×24 px box inside a 44 px label
    expect(box.closest('label').className).toMatch(/min-h-\[44px\]/);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    // ticking the booking-mails consent never ticks the reminder
    expect(screen.getByRole('checkbox', { name: /J’accepte de recevoir/ }).checked).toBe(true);
    expect(box.checked).toBe(false);
  });
  it('R39: ticked (keyboard: Space on the focused box), the hold payload carries reminderConsent: true', async () => {
    await toForm();
    const box = screen.getByRole('checkbox', { name: /rappel par e-mail la veille/ });
    box.focus(); expect(globalThis.document.activeElement).toBe(box);
    fireEvent.click(box);   // what Space does on a focused native checkbox
    expect(box.checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Recevoir le code' }));
    await screen.findByLabelText('Code reçu par e-mail');
    expect(posts[0].body).toMatchObject({ consent: true, reminderConsent: true });
  });
  it('R39: the code step says what happens when a booking already exists; an unknown hold reads as « no longer active » and the visitor starts again', async () => {
    await toForm();
    fireEvent.click(screen.getByRole('button', { name: 'Recevoir le code' }));
    await screen.findByLabelText('Code reçu par e-mail');
    expect(screen.getByText(/Si vous avez déjà un rendez-vous avec cette structure, vous recevez à la place un e-mail/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Code reçu par e-mail'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le rendez-vous' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Cette demande n’est plus active. Recommencez.');
    expect(screen.getByRole('heading', { name: '1. Motif et créneau' })).toBeTruthy();
  });
  it('a structure without account-free booking shows the refusal, not the form', async () => {
    await renderAt(async () => json({ code: 'GUEST_BOOKING_UNAVAILABLE' }, 404));
    expect((await screen.findByTestId('guest-unavailable')).textContent).toMatch(/ne propose pas de rendez-vous sans compte/);
    expect(screen.queryByLabelText('Adresse e-mail')).toBeNull();
  });
});
