/**
 * X04 (expansion) — academy and events, offline: the capability is outside the AIPD and closed in every Production configuration (current one, beta
 * lifted, everything else listed, preview); its surface « events » is opened by nothing and takes its routes away from « citizen » and « admin »; the
 * approval rules (accessibility information required, closed lists, entitlement wording, dates, capacity); the registration window; the notification
 * kinds and the export section. Nothing here touches a database.
 */
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, capabilitiesOfRoute, capabilityState } from '../../api/_utils/capabilities.js';
import { SURFACES, isAllowedInPublicBeta, surfaceOf } from '../../api/_utils/public-beta.js';
import { INBOX_KINDS, listInbox } from '../../api/_services/citizen-inbox.js';
import { EXPORT_SECTION_TABLES } from '../../api/_services/export-account-sections.js';
import { ACCESSIBILITY_NEEDS, approvalProblems, needConsentGiven, normaliseDraft, registrationOpen, REMINDER_WINDOW_HOURS } from '../../api/_services/academy-events.js';
import { routes } from '../../api/routes.js';

const ROUTES = ['events', 'events/un-atelier', 'citizen/events', 'admin/events'];
const PROD_NOW = { VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: 'true', ADA_BETA_OPEN_SURFACES: 'admin,accounts' };
const OTHERS = Object.keys(CAPABILITIES).filter((c) => c !== 'community.events').join(',');
const NOW = new Date('2026-11-19T10:00:00Z');
const ev = (over = {}) => normaliseDraft({ title: 'Atelier numérique', summary: 'Un atelier pour faire ses démarches en ligne.', body: 'Atelier collectif gratuit.',
  organizerName: 'Association X', startsAt: '2026-12-01T14:00:00Z', endsAt: '2026-12-01T16:00:00Z', venueName: 'Médiathèque', venueAddress: '1 rue Exemple', venueCommune: 'Strasbourg',
  capacity: 12, accessibilityFeatures: ['STEP_FREE_ACCESS'], ...over }, 'EVENT');

describe('X04 — closed by default (fail-closed)', () => {
  it('« community.events » is a known capability OUTSIDE the AIPD, on its own surface « events », not HDS-bound', () => {
    expect(CAPABILITIES['community.events']).toMatchObject({ aipd: 'out', surface: 'events', requiresHds: false });
    expect(Object.keys(SURFACES)).toContain('events');
  });
  it('closed in the current Production configuration, without the beta, with every other capability listed, in preview — and open only when named AND its surface opened', () => {
    for (const env of [PROD_NOW, { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'production', ADA_CAPABILITIES_OPEN: OTHERS }, { ...PROD_NOW, ADA_CAPABILITIES_OPEN: OTHERS, ADA_BETA_ACCOUNTS_SCOPE: 'full' },
      { VERCEL_ENV: 'preview' }, { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,events' }, { ...PROD_NOW, ADA_CAPABILITIES_OPEN: 'community.events' },
      { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,events', ADA_CAPABILITIES_OPEN: 'community.*' }]) {
      expect(capabilityState('community.events', env).open, JSON.stringify(env)).toBe(false);
    }
    expect(capabilityState('community.events', { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,events', ADA_CAPABILITIES_OPEN: 'community.events' }).open).toBe(true);
    expect(capabilityState('community.events', { VERCEL_ENV: 'production', ADA_CAPABILITIES_OPEN: 'community.events' }).open).toBe(true);   // beta lifted: the capability switch alone
  });
  it('every route of the surface needs the capability, and the beta gate refuses them all with the Production surfaces (citizen and admin sessions included)', () => {
    for (const r of ROUTES) {
      expect(surfaceOf(r), r).toBe('events');
      expect(capabilitiesOfRoute(r), r).toEqual(['community.events']);
      for (const m of ['GET', 'POST']) expect(isAllowedInPublicBeta(m, r, PROD_NOW), `${m} ${r}`).toBe(false);
    }
    // the neighbouring routes keep their own surface
    expect(surfaceOf('citizen/notifications')).toBe('accounts'); expect(surfaceOf('admin/resources')).toBe('admin');
    const table = routes.map((r) => r.path);
    for (const p of ['events', 'citizen/events', 'admin/events']) expect(table).toContain(p);
  });
});

describe('X04 — approval rules', () => {
  it('a complete event has no problem; closed lists drop anything unknown', () => {
    const d = ev({ accessibilityFeatures: ['STEP_FREE_ACCESS', 'TELEPORTATION', 'STEP_FREE_ACCESS'] });
    expect(d.accessibilityFeatures).toEqual(['STEP_FREE_ACCESS']);
    expect(approvalProblems(d, 'EVENT', NOW)).toEqual([]);
  });
  it('the accessibility information is required: a feature or a note of at least 10 characters (« not accessible » must be said)', () => {
    expect(approvalProblems(ev({ accessibilityFeatures: [] }), 'EVENT', NOW)).toContain('ACCESSIBILITY_INFORMATION_REQUIRED');
    expect(approvalProblems(ev({ accessibilityFeatures: [], accessibilityNote: 'Lieu non accessible en fauteuil.' }), 'EVENT', NOW)).toEqual([]);
  });
  it('dates, capacity, venue, organizer; markup removed; entitlement wording refused in any text and translation', () => {
    const p = approvalProblems(ev({ startsAt: '2026-11-01T10:00:00Z', endsAt: '2026-10-01T10:00:00Z', capacity: 0, venueName: '', organizerName: '' }), 'EVENT', NOW);
    expect(p).toEqual(expect.arrayContaining(['START_IN_THE_PAST', 'END_AFTER_START_REQUIRED', 'CAPACITY_REQUIRED', 'VENUE_REQUIRED', 'ORGANIZER_REQUIRED']));
    expect(approvalProblems(ev({ capacity: 5001 }), 'EVENT', NOW)).toContain('CAPACITY_REQUIRED');
    expect(ev({ title: '<b>Atelier</b> numérique' }).title).toBe('Atelier numérique');
    expect(approvalProblems(ev({ summary: 'Vous avez droit au RSA : venez à cet atelier gratuit.' }), 'EVENT', NOW)).toContain('ENTITLEMENT_WORDING');
    expect(approvalProblems(ev({ translations: { en: { title: 'Digital workshop', summary: 'A workshop to do procedures online.', body: '' }, xx: { title: 'ignored' } } }), 'EVENT', NOW)).toEqual([]);
    expect(approvalProblems(ev({ translations: { de: { title: 'Kurz', summary: '' } } }), 'EVENT', NOW)).toContain('TRANSLATION_INCOMPLETE_DE');
    const lesson = normaliseDraft({ title: 'Comprendre un courrier', summary: 'Les rubriques d’un courrier administratif.', body: 'court' }, 'LESSON');
    expect(approvalProblems(lesson, 'LESSON', NOW)).toEqual(['BODY_TOO_SHORT']);
    expect(lesson).not.toHaveProperty('capacity');
  });
  it('registration window: published, before the start and before the closing date; a need only with consent === true', () => {
    const r = { kind: 'EVENT', status: 'published', startsAt: '2026-12-01T14:00:00Z', registrationClosesAt: null };
    expect(registrationOpen(r, NOW)).toBe(true);
    expect(registrationOpen({ ...r, registrationClosesAt: '2026-11-18T00:00:00Z' }, NOW)).toBe(false);
    expect(registrationOpen({ ...r, status: 'cancelled' }, NOW)).toBe(false);
    expect(registrationOpen({ ...r, startsAt: '2026-11-19T09:00:00Z' }, NOW)).toBe(false);
    expect(registrationOpen({ ...r, kind: 'LESSON' }, NOW)).toBe(false);
    for (const v of [undefined, 'true', 1, 'on', {}]) expect(needConsentGiven(v)).toBe(false);
    expect(needConsentGiven(true)).toBe(true);
    expect(ACCESSIBILITY_NEEDS).not.toContain('OTHER');   // no free-text escape hatch
  });
});

describe('X04 — notification centre and export', () => {
  it('two kinds in the centre (48 h reminder, cancellation); none read while the capability is closed', async () => {
    expect(INBOX_KINDS).toEqual(expect.arrayContaining(['EVENT_REMINDER', 'EVENT_CANCELLED']));
    expect(REMINDER_WINDOW_HOURS).toBe(48);
    const seen = [];
    const db = { execute: async (q) => { seen.push(q); return { rows: [] }; }, select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) };
    const out = await listInbox('u1', db, { isOpen: () => false });
    expect(out.notifications).toEqual([]); expect(seen).toHaveLength(0);
  });
  it('the export has an eventRegistrations section (EventRegistration)', () => {
    expect(EXPORT_SECTION_TABLES.eventRegistrations).toBe('EventRegistration');
  });
});
