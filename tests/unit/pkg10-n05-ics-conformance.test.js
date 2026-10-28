/**
 * PKG-10 / N05 — the .ics files (appointment invitation, move, cancellation, professional agenda export) against RFC 5545 rules that calendar clients rely on:
 * CRLF line ends; content lines ≤ 75 OCTETS with folding (CRLF + space) that never splits a UTF-8 character; required VCALENDAR / VEVENT properties; UTC dates;
 * text escaping that UNFOLDS and UNESCAPES back to the original; stable UID with growing SEQUENCE; cancellation = STATUS:CANCELLED (+ METHOD:CANCEL in an e-mail).
 * R13 (N05, after a validation with ical.js 2.2.1 — evidence N05_ICAL_VALIDATION_2026-10-26.md): no CONTROL character in a content line; METHOD only in an e-mail
 * from a real sending address, with ORGANIZER (and the ATTENDEE of a cancellation) as RFC 5546 requires and the same `method` in the Content-Type (RFC 5545
 * §3.7.2); a downloaded file / the agenda export is a snapshot without METHOD. No calendar application runs here (real clients = external validation).
 */
import { describe, expect, it } from 'vitest';
import { buildAppointmentIcs, buildCalendarIcs, calendarContentType, foldIcsLine, mailAddress } from '../../api/_utils/ics.js';

const unfold = (ics) => ics.replace(/\r\n[ \t]/g, '');
const props = (ics, name) => unfold(ics).split('\r\n').filter((l) => l.startsWith(name + ':') || l.startsWith(name + ';')).map((l) => l.slice(l.indexOf(':') + 1));
const unescape = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
function conforms(ics) {
  expect(ics.endsWith('\r\n')).toBe(true);
  expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);   // only CRLF line ends
  for (const line of ics.split('\r\n').slice(0, -1)) {
    expect(Buffer.byteLength(line, 'utf8'), line).toBeLessThanOrEqual(75);
    expect(Buffer.from(line, 'utf8').toString('utf8')).toBe(line);   // no broken UTF-8 sequence at a fold
  }
  const u = unfold(ics).split('\r\n');
  expect(u[0]).toBe('BEGIN:VCALENDAR'); expect(u).toContain('VERSION:2.0'); expect(u.some((l) => l.startsWith('PRODID:'))).toBe(true); expect(u.at(-2)).toBe('END:VCALENDAR');
  const events = unfold(ics).split('BEGIN:VEVENT').length - 1; expect(events).toBeGreaterThan(0);
  for (const p of ['UID', 'DTSTAMP', 'DTSTART']) expect(props(ics, p).length, p).toBe(events);
  for (const d of [...props(ics, 'DTSTAMP'), ...props(ics, 'DTSTART'), ...props(ics, 'DTEND')]) expect(d).toMatch(/^\d{8}T\d{6}Z$/);
  // eslint-disable-next-line no-control-regex
  for (const line of ics.split('\r\n')) expect(line).not.toMatch(/[\u0000-\u0008\u000a-\u001f\u007f]/);
  const method = unfold(ics).match(/\r\nMETHOD:([A-Z]+)\r\n/)?.[1];
  expect(calendarContentType(ics).match(/method=([A-Z]+)/)?.[1]).toBe(method);
  if (method) expect(props(ics, 'ORGANIZER').length).toBe(events);
  if (method === 'CANCEL') expect(props(ics, 'ATTENDEE').length).toBe(events);
  if (method === 'PUBLISH') expect(props(ics, 'ATTENDEE')).toEqual([]);
  if (!method) { expect(props(ics, 'ORGANIZER')).toEqual([]); expect(props(ics, 'ATTENDEE')).toEqual([]); }
  return method || null;
}
const ITIP = { organizer: 'Accès Direct Aide <rdv@example.test>', attendee: 'personne@example.test' };

const base = { appointmentId: 'ap-n05-1', startAt: new Date('2026-11-03T08:30:00Z'), endAt: new Date('2026-11-03T09:00:00Z'), structureName: 'Centre social « Les Écrivains », Strasbourg',
  serviceName: 'Accompagnement; dossier CAF, logement\nsuite', location: '12 rue de la Mésange, 67000 Strasbourg — 2ᵉ étage, porte B (accès PMR par la cour intérieure)',
  manageUrl: 'https://www.accesdirectaide.fr/compte/rendez-vous?ref=ap-n05-1&tab=details&lang=fr-FR' };

describe('PKG-10 / N05 RFC 5545 conformance', () => {
  it('an invitation with long French text (accents, guillemets, emoji-free UTF-8) folds at ≤ 75 octets and round-trips exactly', () => {
    const ics = buildAppointmentIcs({ ...base, sequence: 0, itip: ITIP });
    expect(conforms(ics)).toBe('PUBLISH');
    expect(unescape(props(ics, 'LOCATION')[0])).toBe(base.location);
    expect(unescape(props(ics, 'DESCRIPTION')[0])).toBe(`Service: ${base.serviceName}\nGestion du RDV: ${base.manageUrl}`);
    expect(unescape(props(ics, 'SUMMARY')[0])).toBe(`RDV - ${base.structureName}`);
    expect(props(ics, 'STATUS')[0]).toBe('CONFIRMED');
    expect(props(ics, 'ORGANIZER')[0]).toBe('mailto:rdv@example.test'); expect(unfold(ics)).toContain(`ORGANIZER;CN="${base.structureName}":mailto:rdv@example.test`);
    expect(calendarContentType(ics)).toBe('text/calendar; method=PUBLISH; charset=utf-8');
  });
  it('a move keeps the UID and raises SEQUENCE; a cancellation is METHOD:CANCEL + STATUS:CANCELLED with the same UID, ORGANIZER and ATTENDEE', () => {
    const a = buildAppointmentIcs({ ...base, sequence: 0, itip: ITIP }); const b = buildAppointmentIcs({ ...base, sequence: 2, itip: ITIP }); const c = buildAppointmentIcs({ ...base, sequence: 3, cancelled: true, itip: ITIP });
    expect(conforms(b)).toBe('PUBLISH'); expect(conforms(c)).toBe('CANCEL');
    expect(props(b, 'UID')).toEqual(props(a, 'UID')); expect(props(c, 'UID')).toEqual(props(a, 'UID'));
    expect(Number(props(b, 'SEQUENCE')[0])).toBeGreaterThan(Number(props(a, 'SEQUENCE')[0]));
    expect(props(c, 'STATUS')[0]).toBe('CANCELLED'); expect(props(c, 'ATTENDEE')).toEqual(['mailto:personne@example.test']);
    expect(calendarContentType(c)).toBe('text/calendar; method=CANCEL; charset=utf-8');
  });
  it('a downloaded file and the professional agenda export are snapshots: no METHOD, no ORGANIZER, a cancelled event is STATUS:CANCELLED', () => {
    expect(conforms(buildAppointmentIcs({ ...base, sequence: 1 }))).toBeNull();
    const cancelled = buildAppointmentIcs({ ...base, sequence: 2, cancelled: true }); expect(conforms(cancelled)).toBeNull(); expect(props(cancelled, 'STATUS')).toEqual(['CANCELLED']);
    const ics = buildCalendarIcs([{ ...base, sequence: 1 }, { ...base, appointmentId: 'ap-n05-2', serviceName: 'Visio', location: 'À distance (visio)', cancelled: true }]);
    expect(conforms(ics)).toBeNull(); expect(props(ics, 'UID')).toEqual(['ap-n05-1@accesdirectaide.fr', 'ap-n05-2@accesdirectaide.fr']);
    expect(calendarContentType(ics)).toBe('text/calendar; charset=utf-8');
  });
  it('never half an iTIP message: without a sending address, or a cancellation without its recipient, the file is a snapshot', () => {
    expect(conforms(buildAppointmentIcs({ ...base, cancelled: true, itip: { organizer: '', attendee: 'personne@example.test' } }))).toBeNull();
    expect(conforms(buildAppointmentIcs({ ...base, cancelled: true, itip: { organizer: 'rdv@example.test' } }))).toBeNull();
    expect(conforms(buildAppointmentIcs({ ...base, itip: { organizer: 'not an address' } }))).toBeNull();
    expect([mailAddress('AccesDirectAide <rdv@accesdirectaide.fr>'), mailAddress('rdv@accesdirectaide.fr'), mailAddress('x <bad>'), mailAddress('')]).toEqual(['rdv@accesdirectaide.fr', 'rdv@accesdirectaide.fr', '', '']);
  });
  it('control characters from imported text never reach a content line; a lone CR is a line break; DQUOTE leaves the CN parameter', () => {
    const hostile = 'Maison\rde la\u0007 solidarité\u0000\tquartier\u001b[31m "Gare"';
    const ics = buildAppointmentIcs({ ...base, structureName: hostile, location: hostile, itip: ITIP });
    expect(conforms(ics)).toBe('PUBLISH');
    expect(unescape(props(ics, 'LOCATION')[0])).toBe('Maison\nde la solidarité\tquartier[31m "Gare"');
    expect(unfold(ics)).toContain('ORGANIZER;CN="Maisonde la solidaritéquartier[31m Gare":mailto:rdv@example.test');
  });
  it('folding never splits a multi-byte character, and short lines are untouched', () => {
    expect(foldIcsLine('SUMMARY:court')).toBe('SUMMARY:court');
    const long = 'LOCATION:' + 'é'.repeat(80);
    const folded = foldIcsLine(long);
    for (const part of folded.split('\r\n')) expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(long);
  });
});
