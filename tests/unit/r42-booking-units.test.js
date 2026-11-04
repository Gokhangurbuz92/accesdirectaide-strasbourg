// R42-BOOK — the pure pieces of the account-required booking: age rule, optional message, booking configuration, Outlook free/busy parsing and scope.
import { describe, expect, it } from 'vitest';
import { accountAge, bookingAgeRefusal, isAdultAccount } from '../../api/_utils/age-policy.js';
import { BOOKING_MESSAGE_LABEL, BOOKING_MESSAGE_NOTICE, BOOKING_MESSAGE_MAX_LENGTH, validateBookingMessage } from '../../api/_utils/rdv-message.js';
import { confirmationModeFor, memberServes, parseBookingConfig } from '../../api/_services/rdv-booking-config.js';
import { busyFromView } from '../../api/_services/rdv-calendar-busy.js';
import { OUTLOOK_SCOPES, authorizeUrl } from '../../api/_services/calendar-outlook.js';

describe('age rule (api/_utils/age-policy.js, shared with R42-AUTH)', () => {
  it('only a declared adult band may book; a minor is refused; no declaration is never inferred as adult', () => {
    for (const b of ['18-24', '25-59', '60-et-plus']) expect([b, isAdultAccount({ ageBand: b }), bookingAgeRefusal({ ageBand: b })]).toEqual([b, true, null]);
    expect(accountAge({ ageBand: 'moins-de-18' })).toBe('MINOR');
    expect(bookingAgeRefusal({ ageBand: 'moins-de-18' })?.body.code).toBe('ADULT_ACCOUNT_REQUIRED');
    for (const u of [{ ageBand: null }, {}, null, { ageBand: '17' }]) {
      expect(isAdultAccount(u)).toBe(false);
      expect(bookingAgeRefusal(u || {})?.body.code).toBe('AGE_DECLARATION_REQUIRED');
    }
  });
});

describe('optional message (R42-A06)', () => {
  it('keeps the owner wording', () => {
    expect(BOOKING_MESSAGE_LABEL).toBe('Précisez brièvement le motif de votre rendez-vous (facultatif)');
    expect(BOOKING_MESSAGE_NOTICE).toBe('Indiquez uniquement les informations nécessaires à votre demande. Ne transmettez pas de diagnostic ni de document médical dans ce champ.');
  });
  it('absent / blank = no message; trimmed plain text accepted; bounded; markup, entities, controls and bidi overrides refused', () => {
    expect(validateBookingMessage(undefined)).toEqual({ ok: true, value: null });
    expect(validateBookingMessage('   ')).toEqual({ ok: true, value: null });
    expect(validateBookingMessage('  Dossier APL : 2 < 3 ans, R&D  ')).toEqual({ ok: true, value: 'Dossier APL : 2 < 3 ans, R&D' });
    expect(validateBookingMessage('é'.repeat(BOOKING_MESSAGE_MAX_LENGTH)).ok).toBe(true);
    expect(validateBookingMessage('é'.repeat(BOOKING_MESSAGE_MAX_LENGTH + 1))).toEqual({ ok: false, code: 'MESSAGE_TOO_LONG' });
    for (const bad of ['<b>x</b>', '< script>', '</p>', '<!-- -->', '&amp;', '&#60;', '&#x3c;']) expect([bad, validateBookingMessage(bad)]).toEqual([bad, { ok: false, code: 'MESSAGE_MARKUP_REFUSED' }]);
    for (const bad of ['a\u0000b', 'a\u0007b', 'a‮b', 'a⁦b', 'a\u0085b']) expect(validateBookingMessage(bad)).toEqual({ ok: false, code: 'MESSAGE_INVALID' });
    expect(validateBookingMessage(42)).toEqual({ ok: false, code: 'MESSAGE_INVALID' });
    expect(validateBookingMessage('a\r\n\r\n\r\n\r\nb')).toEqual({ ok: true, value: 'a\n\nb' });
  });
});

describe('booking configuration (Structure.settings_json.rdvBooking)', () => {
  it('defaults to Mode A without team choice; malformed content reads as the defaults', () => {
    for (const raw of [null, 'x', [], { confirmation: 'MAYBE', team: 'yes' }]) {
      const c = parseBookingConfig(raw);
      expect([c.confirmation, c.team.enabled, c.team.members]).toEqual(['DIRECT', false, {}]);
    }
  });
  it('per service override; a selectable member always takes bookings; services filter', () => {
    const c = parseBookingConfig({ confirmation: 'APPROVAL', services: { s1: { confirmation: 'DIRECT' }, 'bad id!': { confirmation: 'DIRECT' } },
      team: { enabled: true, members: { p1: { bookable: false, selectable: true }, p2: { bookable: true, serviceIds: ['s1', 5] } } } });
    expect(confirmationModeFor(c, 's1')).toBe('DIRECT');
    expect(confirmationModeFor(c, 's2')).toBe('APPROVAL');
    expect(Object.keys(c.services)).toEqual(['s1']);
    expect(c.team.members.p1).toEqual({ bookable: false, selectable: false, serviceIds: [] });
    expect(memberServes(c.team.members.p2, 's1')).toBe(true);
    expect(memberServes(c.team.members.p2, 's2')).toBe(false);
    expect(memberServes(c.team.members.p1, 'anything')).toBe(true);
  });
});

describe('Outlook free/busy (least privilege)', () => {
  it('asks only for Calendars.ReadBasic (the least privileged delegated permission of getSchedule), never a write scope', () => {
    expect(OUTLOOK_SCOPES.split(' ')).toContain('Calendars.ReadBasic');
    expect(OUTLOOK_SCOPES).not.toMatch(/Calendars\.(ReadWrite|Read\b)|\.Shared/);
    const url = new URL(authorizeUrl({ userId: 'u', structureId: 's' }, { OUTLOOK_CLIENT_ID: 'c', OUTLOOK_REDIRECT_URI: 'https://lab.invalid/cb', AUTH_SECRET: 'x'.repeat(40), OUTLOOK_AUTHORITY_URL: 'https://login.lab.invalid/t' }));
    expect(url.searchParams.get('scope')).toBe(OUTLOOK_SCOPES);
  });
  it('maps each availabilityView digit to an exact UTC interval; anything but 0 is busy (fail safe); adjacent intervals merge', () => {
    const from = new Date('2027-03-28T00:45:00Z');   // across the Paris spring change: UTC arithmetic only
    const busy = busyFromView('0220004', from);
    expect(busy.map((w) => [w.start.toISOString(), w.end.toISOString()])).toEqual([
      ['2027-03-28T01:00:00.000Z', '2027-03-28T01:30:00.000Z'], ['2027-03-28T02:15:00.000Z', '2027-03-28T02:30:00.000Z']]);
    expect(busyFromView('0000', from)).toEqual([]);
  });
});
