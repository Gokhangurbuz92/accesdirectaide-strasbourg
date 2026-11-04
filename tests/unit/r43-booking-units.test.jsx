// @vitest-environment jsdom
/* global document */
/**
 * R43-BOOK — units without a database: the Production migration planner (obsolete 0043 / 0044 never applied, `--only` 0045), the schema-aware notice
 * ledger (a booking kind is written only when the database says its CHECK accepts it; otherwise skipped and counted), the legacy /creneaux → /booking
 * path (same-origin, validated slug, context kept, no open redirect), the booking page opening a preselected service, the optional message consent
 * (French, English, Arabic; never pre-ticked; axe) and the withdrawal of the message from « Mes rendez-vous ».
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import fs from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/analytics', () => ({ track: vi.fn() }));
vi.mock('@/components/SEO', () => ({ default: () => null }));
vi.mock('@/lib/csrf', () => ({ csrfFetch: vi.fn(), ensureCsrfHeaders: async () => ({}), getCsrfHeaders: () => ({}) }));
const api = vi.hoisted(() => ({ myAppointments: vi.fn(), withdrawAppointmentMessage: vi.fn() }));
vi.mock('@/lib/citizenApi', () => ({ citizenApi: api }));
vi.mock('@/api/rdv-messaging-client', () => ({ rdvMessagingClient: { user: { getOrCreateFromAppointment: vi.fn() } } }));
vi.mock('@/components/Visio/VisioWindow', () => ({ default: () => null }));

import { OBSOLETE_MIGRATIONS, planDeploy } from '../../scripts/db-deploy-migrate.mjs';
import { legacyCreneauxBookingPath } from '../../src/lib/rdvRouting.js';
import LegacyCreneauxRedirect from '../../src/pages/LegacyCreneauxRedirect.jsx';
import BookingMessageField from '../../src/components/rdv/BookingMessageField.jsx';
import PublicBooking from '../../src/pages/PublicBooking.jsx';
import CompteRendezVous from '../../src/pages/CompteRendezVous.jsx';
import { setLanguage } from '../../src/i18n/index.js';

afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await act(async () => { await setLanguage('fr', { persist: false }); }); });
const lang = async (code) => { await act(async () => { await setLanguage(code, { persist: false }); }); };
const axeOk = async (ctx = document.body) => { const r = await axe.run(ctx, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }); expect(r.violations.map((v) => v.id)).toEqual([]); };
const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
const when = (tag) => journal.find((e) => e.tag === tag).when;

describe('Production migration plan (scripts/db-deploy-migrate.mjs)', () => {
  const T45 = '0045_r43_appointment_notice_kinds';
  it('the journal has 0045 after 0044 and a rollback file that forgets its journal row', () => {
    const e = journal.find((x) => x.tag === T45);
    expect(e.idx).toBe(45);
    expect(e.when).toBeGreaterThan(when('0044_r39_guest_reminder_consent'));
    expect(fs.readFileSync('drizzle/rollback/0045_down.sql', 'utf8')).toContain(`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${e.when};`);
    expect(OBSOLETE_MIGRATIONS).toEqual(['0043_r38_guest_booking', '0044_r39_guest_reminder_consent']);
  });
  it('a plain run on a 0042 database is refused: it would apply 0043 / 0044 first (drizzle applies every later « when »)', () => {
    const p = planDeploy(journal, when('0042_r31_orientation_funding_pilot'));
    expect(p).toMatchObject({ ok: false, reason: 'OBSOLETE_MIGRATION_PENDING' });
    expect(p.pending).toEqual(['0043_r38_guest_booking', '0044_r39_guest_reminder_consent', T45]);
  });
  it('--only 0045 on 0042 applies exactly 0045; on 0044 too; afterwards nothing is pending and 0043 / 0044 stay unapplied for good', () => {
    expect(planDeploy(journal, when('0042_r31_orientation_funding_pilot'), T45)).toEqual({ ok: true, apply: [journal.find((x) => x.tag === T45)] });
    expect(planDeploy(journal, when('0044_r39_guest_reminder_consent'), T45).ok).toBe(true);
    expect(planDeploy(journal, when(T45))).toEqual({ ok: true, apply: [] });
    expect(planDeploy(journal, when(T45), T45)).toEqual({ ok: false, reason: 'ALREADY_APPLIED' });
  });
  it('refusals: an obsolete tag, an unknown tag, an empty database, an earlier non-obsolete migration still pending', () => {
    expect(planDeploy(journal, when('0042_r31_orientation_funding_pilot'), '0043_r38_guest_booking').reason).toBe('OBSOLETE_MIGRATION_REFUSED');
    expect(planDeploy(journal, when('0042_r31_orientation_funding_pilot'), 'nope').reason).toBe('UNKNOWN_MIGRATION');
    expect(planDeploy(journal, null, T45).reason).toBe('EMPTY_DATABASE');
    const p = planDeploy(journal, when('0041_r24_member_absences'), T45);
    expect(p).toEqual({ ok: false, reason: 'EARLIER_MIGRATION_PENDING', pending: ['0042_r31_orientation_funding_pilot'] });
  });
});

describe('schema-aware notice ledger (api/_services/appointment-notices.js)', () => {
  const fakeDb = (def, { fail = false } = {}) => {
    const rows = [];
    return { rows, execute: vi.fn(async () => { if (fail) throw new Error('down'); return { rows: def ? [{ def }] : [] }; }), insert: () => ({ values: async (v) => { rows.push(v); } }) };
  };
  const DEF_0042 = "CHECK ((kind = ANY (ARRAY['BOOKED_BY_STRUCTURE'::text, 'RESCHEDULED'::text])))";
  const DEF_0045 = "CHECK ((kind = ANY (ARRAY['BOOKED_BY_STRUCTURE'::text, 'BOOKED_BY_CITIZEN'::text, 'REQUEST_RECEIVED'::text, 'REQUEST_ACCEPTED'::text, 'REQUEST_REFUSED'::text])))";
  it('a 0020 kind is written as before, without asking the database', async () => {
    const { recordNotice } = await import('../../api/_services/appointment-notices.js');
    const db = fakeDb(null);
    await recordNotice('a1', 'RESCHEDULED', 'citizen', 'email', 'TEST_RECORDED', db);
    expect(db.rows).toEqual([{ appointmentId: 'a1', kind: 'RESCHEDULED', recipient: 'citizen', channel: 'email', status: 'TEST_RECORDED' }]);
    expect(db.execute).not.toHaveBeenCalled();
  });
  it('a booking kind: written on a 0045 CHECK; skipped and counted before 0045, on an unreadable schema and for an unknown kind — never under another kind', async () => {
    const { recordNotice, ledgerSkipCounts } = await import('../../api/_services/appointment-notices.js');
    const on45 = fakeDb(DEF_0045); const on42 = fakeDb(DEF_0042); const broken = fakeDb(null, { fail: true }); const any = fakeDb(DEF_0045);
    const before = ledgerSkipCounts();
    await recordNotice('a1', 'REQUEST_RECEIVED', 'structure', 'in_app', 'DELIVERED', on45);
    await recordNotice('a1', 'REQUEST_RECEIVED', 'structure', 'in_app', 'DELIVERED', on42);
    await recordNotice('a1', 'REQUEST_ACCEPTED', 'citizen', 'email', 'TEST_RECORDED', broken);
    await recordNotice('a1', 'REQUEST_EXPIRED', 'citizen', 'email', 'TEST_RECORDED', any);
    expect(on45.rows.map((r) => r.kind)).toEqual(['REQUEST_RECEIVED']);
    expect([on42.rows, broken.rows, any.rows]).toEqual([[], [], []]);
    const after = ledgerSkipCounts(); const d = (k) => (after[k] || 0) - (before[k] || 0);
    expect([d('REQUEST_RECEIVED:MIGRATION_0045_NOT_APPLIED'), d('REQUEST_ACCEPTED:LEDGER_SCHEMA_UNKNOWN'), d('REQUEST_EXPIRED:UNKNOWN_KIND')]).toEqual([1, 1, 1]);
    // the read is cached per database; a failed read is not (the next write asks again)
    await recordNotice('a2', 'REQUEST_REFUSED', 'citizen', 'email', 'TEST_RECORDED', on45);
    expect(on45.execute).toHaveBeenCalledTimes(1);
    await recordNotice('a2', 'REQUEST_REFUSED', 'citizen', 'email', 'TEST_RECORDED', broken);
    expect(broken.execute).toHaveBeenCalledTimes(2);
  });
});

describe('legacy /rdv/:slug/creneaux → /rdv/:slug/booking', () => {
  it('keeps the slug, service, modality and journey context; drops the date range and anything unsafe', () => {
    expect(legacyCreneauxBookingPath('cdgg-conseil', '?serviceId=svc_1&mode=video&from=2026-11-05&to=2026-11-18&structureId=x'))
      .toBe('/rdv/cdgg-conseil/booking?serviceId=svc_1&mode=VIDEO');
    expect(legacyCreneauxBookingPath('cdgg-conseil', '')).toBe('/rdv/cdgg-conseil/booking');
    expect(legacyCreneauxBookingPath('cdgg-conseil', '?next=%2Faides%2Fapl&aide=apl&origin=search')).toBe('/rdv/cdgg-conseil/booking?next=%2Faides%2Fapl&aide=apl&origin=search');
    expect(legacyCreneauxBookingPath('cdgg-conseil', '?appointment=a1')).toBe('/compte/rendez-vous');
  });
  it('is never an open redirect: only a same-origin path built from a validated slug', () => {
    for (const slug of ['//evil.example', 'evil.example/x', '..', 'a/b', 'a\\b', 'https:', '', ' ', '%2F%2Fevil', 'x'.repeat(200), 'é']) {
      expect(legacyCreneauxBookingPath(slug, '?serviceId=s')).toBe('/structures');
    }
    for (const next of ['//evil.example', '/\\evil', 'https://evil.example', '%2F%2Fevil.example', '/x\u0000y']) {
      expect(legacyCreneauxBookingPath('s', `?next=${encodeURIComponent(next)}`)).toBe('/rdv/s/booking');
    }
    for (const id of ['../x', 'a b', '<script>', 'x'.repeat(129)]) expect(legacyCreneauxBookingPath('s', `?serviceId=${encodeURIComponent(id)}`)).toBe('/rdv/s/booking');
    expect(legacyCreneauxBookingPath('s', '?mode=PHONE')).toBe('/rdv/s/booking');
  });
  it('the redirect component lands on the booking path (whose own gate asks for a citizen session)', async () => {
    const Where = () => { const l = useLocation(); return h('p', { 'data-testid': 'where' }, `${l.pathname}${l.search}`); };
    render(h(MemoryRouter, { initialEntries: ['/rdv/structure-fictive/creneaux?serviceId=s1&mode=IN_PERSON'] }, h(Routes, null,
      h(Route, { path: '/rdv/:structureSlug/creneaux', element: h(LegacyCreneauxRedirect) }), h(Route, { path: '/rdv/:structureSlug/booking', element: h(Where) }))));
    expect((await screen.findByTestId('where')).textContent).toBe('/rdv/structure-fictive/booking?serviceId=s1&mode=IN_PERSON');
  });
  it('the booking page opens the service named in the link (its slots are loaded); an unknown id is simply not preselected', async () => {
    const urls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url); urls.push(u);
      if (u.includes('/services')) return { ok: true, status: 200, json: async () => ({ teamChoice: false, items: [{ id: 's1', name: 'Accueil social', durationMinutes: 30, modes: ['IN_PERSON'] }] }) };
      if (u.includes('/slots')) return { ok: true, status: 200, json: async () => ({ confirmation: 'DIRECT', days: [{ date: '2030-01-07', slots: [{ startAt: '2030-01-07T08:00:00.000Z', endAt: '2030-01-07T08:30:00.000Z' }] }] }) };
      return { ok: false, status: 404, json: async () => ({}) };
    }));
    const page = (q) => render(h(MemoryRouter, { initialEntries: [`/rdv/structure-fictive/booking${q}`] }, h(Routes, null, h(Route, { path: '/rdv/:structureSlug/booking', element: h(PublicBooking) }))));
    page('?serviceId=s1');
    expect((await screen.findAllByTestId('booking-slot')).length).toBe(1);
    expect(urls.some((u) => u.includes('/slots?serviceId=s1'))).toBe(true);
    cleanup(); urls.length = 0;
    page('?serviceId=unknown');
    expect(await screen.findByTestId('booking-service-s1')).toBeInTheDocument();
    expect(urls.some((u) => u.includes('/slots'))).toBe(false);
  });
});

describe('optional message consent (dossier RGPD § 2.1, E6)', () => {
  it('no box while nothing is written; once written, an unticked box with the dossier wording; the error is announced and linked', async () => {
    const { rerender } = render(h(BookingMessageField, { value: '', onChange: () => {} }));
    expect(screen.queryByTestId('booking-message-consent')).toBeNull();
    rerender(h(BookingMessageField, { value: '  ', onChange: () => {} }));
    expect(screen.queryByTestId('booking-message-consent')).toBeNull();
    rerender(h(BookingMessageField, { value: 'Bonjour', onChange: () => {}, consent: false, consentError: true }));
    const box = screen.getByRole('checkbox', { name: 'J’accepte que ce message soit transmis à l’équipe de la structure choisie. Il peut contenir des informations sur ma situation. Je peux le retirer avant le rendez-vous.' });
    expect(box).not.toBeChecked();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box.getAttribute('aria-describedby')).toBe(screen.getByTestId('booking-message-consent-error').id);
    await axeOk();
  });
  for (const [code, consent] of [['en', 'I agree that this message is passed on to the team of the chosen organisation. It may contain information about my situation. I can withdraw it before the appointment.'],
    ['ar', 'أوافق على نقل هذه الرسالة إلى فريق الجهة المختارة. قد تحتوي على معلومات عن وضعي. يمكنني سحبها قبل الموعد.']]) {
    it(`${code}: the consent and its error are translated (no French left); axe rules pass`, async () => {
      await lang(code);
      render(h('main', null, h(BookingMessageField, { value: 'x', onChange: () => {}, consentError: true })));
      expect(screen.getByRole('checkbox', { name: consent })).not.toBeChecked();
      expect(document.body.textContent).not.toMatch(/J’accepte|Cochez la case|Message à la structure/);
      if (code === 'ar') expect(document.documentElement.getAttribute('dir')).toBe('rtl');
      await axeOk();
    });
  }
  it('« Mes rendez-vous »: the person withdraws the message of an upcoming appointment in two steps; nothing is shown for one without a message', async () => {
    const item = (extra) => ({ id: 'a1', state: 'CONFIRMED', status: 'CONFIRMED', mode: 'IN_PERSON', startsAt: '2030-01-07T08:00:00.000Z', structure: { name: 'Structure fictive', slug: 's' }, service: { id: 's1', name: 'Accueil' }, canCancel: true, canReschedule: true, ...extra });
    api.myAppointments.mockResolvedValueOnce({ appointments: [item({ hasMessage: true, canWithdrawMessage: true })] }).mockResolvedValueOnce({ appointments: [item({ hasMessage: false, canWithdrawMessage: false })] });
    api.withdrawAppointmentMessage.mockResolvedValue({ ok: true, hasMessage: false });
    render(h(MemoryRouter, null, h(CompteRendezVous)));
    const btn = await screen.findByTestId('rdv-message-withdraw');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(screen.getByTestId('rdv-message-withdraw-panel')).toHaveTextContent('Effacer votre message ? La structure ne pourra plus le lire. Le rendez-vous est conservé.');
    expect(api.withdrawAppointmentMessage).not.toHaveBeenCalled();
    await axeOk(screen.getByTestId('rdv-message'));   // the new block (the page's card titles have a pre-existing heading-order finding, unchanged here)
    fireEvent.click(screen.getByTestId('rdv-message-withdraw-confirm'));
    await waitFor(() => expect(api.withdrawAppointmentMessage).toHaveBeenCalledWith('a1'));
    expect(await screen.findByText('Votre message a été effacé. La structure ne le voit plus.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('rdv-message')).toBeNull());
  });
});
