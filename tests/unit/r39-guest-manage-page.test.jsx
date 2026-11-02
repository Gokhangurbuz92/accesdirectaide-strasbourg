// @vitest-environment jsdom
/**
 * R39 — the personal link of an account-free booking: the optional J-1 reminder shows its current state and one button turns it on or off; the POST goes
 * through csrfFetch with the capability from the fragment (never a query string); the new state is announced in a role="status" region and the focus stays
 * on the button; a refusal is announced (role="alert"); the e-mail is only shown masked; Arabic renders right to left with the translated controls.
 * (The Pro side — yes / no without the address — is proven through the API in tests/integration/r39-guest-reminder-db.test.js.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const TOKEN = 'A'.repeat(43);
const posts = [];
let reminderReply = null;
const startsAt = new Date(Date.now() + 5 * 86_400_000).toISOString();
const view = (reminderConsent) => ({ id: 'a1', status: 'CONFIRMED', startsAt, structure: { slug: 's1', name: 'Accueil Test' }, service: { id: 'svc', name: 'Accueil' },
  location: { address: '1 rue QA, 67000 Strasbourg' }, canCancel: true, canReschedule: true, rescheduleBlocked: null, reminderConsent, reminderChangeable: true });
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
vi.mock('@/lib/csrf', () => ({ csrfFetch: vi.fn(async (url, init) => {
  const body = JSON.parse(init.body); posts.push({ url, body });
  if (url.endsWith('/manage')) return reply({ appointment: view(false), emailMasked: 'ca***@exemple.fr' });
  if (url.endsWith('/manage/reminder')) return reminderReply ? reminderReply(body) : reply({ appointment: view(body.consent) });
  return reply({}, 404);
}) }));
vi.mock('@/components/SEO', () => ({ default: () => null }));
afterEach(() => { cleanup(); posts.length = 0; reminderReply = null; });

async function renderManage() {
  globalThis.window.history.replaceState(null, '', `/rdv/s1/sans-compte/gerer?appointment=a1#manage=${TOKEN}`);
  const { default: GuestManage } = await import('../../src/pages/GuestManage.jsx');
  render(createElement(MemoryRouter, { initialEntries: ['/rdv/s1/sans-compte/gerer'] }, createElement(Routes, null, createElement(Route, { path: '/rdv/:structureSlug/sans-compte/gerer', element: createElement(GuestManage) }))));
  return screen.findByTestId('guest-manage-reminder');
}

describe('GuestManage — the optional J-1 reminder', () => {
  it('shows the current choice and turns it on then off; the new state is announced and the focus stays on the button', async () => {
    const box = await renderManage();
    expect(globalThis.window.location.hash).toBe('');   // the capability left the address bar
    const state = screen.getByTestId('guest-reminder-state');
    expect(state.getAttribute('role')).toBe('status');
    expect(state.textContent).toMatch(/Rappel désactivé/);
    expect(box.getAttribute('role')).toBe('group');
    expect(screen.getByRole('heading', { name: /Rappel par e-mail la veille/ })).toBeTruthy();
    const on = screen.getByRole('button', { name: 'Recevoir un rappel la veille' });
    expect(on.getAttribute('aria-describedby')).toBe('guest-reminder-state');
    on.focus(); fireEvent.click(on);
    await waitFor(() => expect(screen.getByTestId('guest-reminder-state').textContent).toMatch(/Rappel activé/));
    const sent = posts.find((p) => p.url === '/api/rdv/guest/manage/reminder');
    expect(sent.body).toEqual({ appointmentId: 'a1', token: TOKEN, consent: true });
    const off = screen.getByRole('button', { name: 'Ne plus recevoir de rappel' });
    expect(globalThis.document.activeElement).toBe(off);   // the same button, its label now says the next action
    fireEvent.click(off);
    await waitFor(() => expect(screen.getByTestId('guest-reminder-state').textContent).toMatch(/Rappel désactivé/));
    expect(posts.filter((p) => p.url === '/api/rdv/guest/manage/reminder').map((p) => p.body.consent)).toEqual([true, false]);
    expect(posts.every((p) => !String(p.url).includes(TOKEN))).toBe(true);   // the token travels in POST bodies only
    expect(globalThis.document.body.textContent).toContain('ca***@exemple.fr');
    expect(globalThis.document.body.textContent).not.toContain('ca@exemple.fr');
  });
  it('a refusal is announced (role="alert") and the state is unchanged', async () => {
    await renderManage();
    reminderReply = () => reply({ code: 'APPOINTMENT_NOT_FOUND' }, 404);
    fireEvent.click(screen.getByRole('button', { name: 'Recevoir un rappel la veille' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Ce lien n’est pas \(ou plus\) valable/);
    expect(screen.getByTestId('guest-reminder-state').textContent).toMatch(/Rappel désactivé/);
  });
  it('Arabic: the page renders right-to-left with the translated reminder controls', async () => {
    const { setLanguage } = await import('../../src/i18n/index.js');
    await setLanguage('ar', { persist: false });   // loads the Arabic bundles and sets <html lang="ar" dir="rtl">
    try {
      await renderManage();
      expect(globalThis.document.documentElement.getAttribute('dir')).toBe('rtl');
      expect(globalThis.document.documentElement.getAttribute('lang')).toBe('ar');
      expect(screen.getByTestId('guest-reminder-state').textContent).toBe('التذكير غير مفعَّل: لن تُرسَل أي رسالة تذكير.');
      expect(screen.getByRole('heading', { name: 'تذكير بالبريد الإلكتروني قبل يوم (اختياري)' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'تلقي تذكير قبل يوم' }));
      await waitFor(() => expect(screen.getByTestId('guest-reminder-state').textContent).toBe('التذكير مفعَّل: ستتلقى رسالة بالبريد الإلكتروني قبل يوم من الموعد.'));
      expect(screen.getByRole('button', { name: 'إيقاف التذكير' })).toBeTruthy();
    } finally { await setLanguage('fr', { persist: false }); }
  });
});
