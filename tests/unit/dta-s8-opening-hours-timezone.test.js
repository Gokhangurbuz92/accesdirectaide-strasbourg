/**
 * DTA S8 — opening hours are LOCAL time. A professional types "09:00-12:00" on a screen that says Europe/Paris and the rule is stored with timezone 'Europe/Paris';
 * before S8 the slot engine read those clock times as UTC, so a citizen was offered 11:00-14:00 (Paris, summer time) or 10:00-13:00 (winter time) for a structure that
 * opens 09:00-12:00. Contract: a rule WITH a time zone is read in that zone (daylight saving included); a rule WITHOUT a zone keeps the historical UTC reading (legacy
 * callers / unit inputs only - every stored rule has a zone).
 */
import { describe, expect, it } from 'vitest';
import { generateSlots, isSlotWithinRules, zonedParts, zonedWallTimeToUtc } from '../../api/_utils/pro-rdv.js';

const day = (iso) => ({ from: new Date(`${iso}T00:00:00.000Z`), to: new Date(`${iso}T23:59:59.000Z`) });
const starts = (rules, iso, durationMinutes = 60) => generateSlots({ rules, ...day(iso), durationMinutes, busyWindows: [] }).map((s) => s.startAt.slice(11, 16));
const rule = (weekday, startTime, endTime, timezone) => ({ weekday, startTime, endTime, isActive: true, ...(timezone ? { timezone } : {}) });

describe('slots follow the declared time zone', () => {
  it('summer time (UTC+2): Monday 2026-10-19 09:00-12:00 Paris = 07:00Z, 08:00Z, 09:00Z', () => {
    expect(starts([rule(1, '09:00', '12:00', 'Europe/Paris')], '2026-10-19')).toEqual(['07:00', '08:00', '09:00']);
  });
  it('winter time (UTC+1): Monday 2026-11-02 09:00-12:00 Paris = 08:00Z, 09:00Z, 10:00Z', () => {
    expect(starts([rule(1, '09:00', '12:00', 'Europe/Paris')], '2026-11-02')).toEqual(['08:00', '09:00', '10:00']);
  });
  it('the day summer time ends (Sunday 2026-10-25) the window is already UTC+1; the day it starts (Sunday 2026-03-29) it is UTC+2', () => {
    expect(starts([rule(0, '09:00', '10:00', 'Europe/Paris')], '2026-10-25')).toEqual(['08:00']);
    expect(starts([rule(0, '09:00', '10:00', 'Europe/Paris')], '2026-03-29')).toEqual(['07:00']);
  });
  it('another zone is honoured (America/Martinique UTC-4, no DST) - the engine is not Paris-specific', () => {
    expect(starts([rule(1, '09:00', '10:00', 'America/Martinique')], '2026-10-19')).toEqual(['13:00']);
  });
  it('a rule WITHOUT a zone keeps the historical UTC reading; an INVALID zone name falls back to it instead of throwing', () => {
    expect(starts([rule(1, '09:00', '11:00')], '2026-10-19')).toEqual(['09:00', '10:00']);
    expect(starts([rule(1, '09:00', '11:00', 'Mars/Phobos')], '2026-10-19')).toEqual(['09:00', '10:00']);
  });
  it('30-minute slots never cross the end of the LOCAL window', () => {
    expect(starts([rule(1, '09:00', '10:30', 'Europe/Paris')], '2026-10-19', 30)).toEqual(['07:00', '07:30', '08:00']);
  });
  it('busy windows are compared in absolute time: an appointment at 09:00 Paris (07:00Z) removes exactly that slot', () => {
    const slots = generateSlots({ rules: [rule(1, '09:00', '12:00', 'Europe/Paris')], ...day('2026-10-19'), durationMinutes: 60, busyWindows: [{ start: new Date('2026-10-19T07:00:00Z'), end: new Date('2026-10-19T08:00:00Z') }] });
    expect(slots.map((s) => s.startAt.slice(11, 16))).toEqual(['08:00', '09:00']);
  });
});

describe('isSlotWithinRules uses the same reading (a professional cannot book outside the hours they configured)', () => {
  const rules = [rule(1, '09:00', '12:00', 'Europe/Paris')];
  const within = (s, e) => isSlotWithinRules({ rules, startAt: new Date(s), endAt: new Date(e) });
  it('inside / edges / outside, in summer time', () => {
    expect(within('2026-10-19T07:00:00Z', '2026-10-19T08:00:00Z')).toBe(true);     // 09:00-10:00 Paris
    expect(within('2026-10-19T09:00:00Z', '2026-10-19T10:00:00Z')).toBe(true);     // 11:00-12:00 Paris
    expect(within('2026-10-19T09:30:00Z', '2026-10-19T10:30:00Z')).toBe(false);    // ends 12:30 Paris
    expect(within('2026-10-19T06:00:00Z', '2026-10-19T07:00:00Z')).toBe(false);    // 08:00-09:00 Paris
    expect(within('2026-10-19T10:00:00Z', '2026-10-19T11:00:00Z')).toBe(false);    // 12:00-13:00 Paris: the old UTC reading said true
  });
  it('winter time and the wrong weekday', () => {
    expect(within('2026-11-02T08:00:00Z', '2026-11-02T09:00:00Z')).toBe(true);
    expect(within('2026-11-02T10:00:00Z', '2026-11-02T11:00:00Z')).toBe(true);     // 11:00-12:00 Paris
    expect(within('2026-11-02T11:00:00Z', '2026-11-02T12:00:00Z')).toBe(false);    // 12:00-13:00 Paris
    expect(within('2026-10-20T07:00:00Z', '2026-10-20T08:00:00Z')).toBe(false);    // Tuesday
  });
  it('the calendar day is the LOCAL day: Monday 00:30 Paris is Sunday 22:30Z', () => {
    const night = [rule(1, '00:00', '02:00', 'Europe/Paris')];
    expect(isSlotWithinRules({ rules: night, startAt: new Date('2026-10-18T22:30:00Z'), endAt: new Date('2026-10-18T23:30:00Z') })).toBe(true);
  });
  it('a rule without a zone is still read as UTC', () => {
    const legacy = [rule(1, '09:00', '12:00')];
    expect(isSlotWithinRules({ rules: legacy, startAt: new Date('2026-10-19T09:00:00Z'), endAt: new Date('2026-10-19T10:00:00Z') })).toBe(true);
    expect(isSlotWithinRules({ rules: legacy, startAt: new Date('2026-10-19T07:00:00Z'), endAt: new Date('2026-10-19T08:00:00Z') })).toBe(false);
    expect(isSlotWithinRules({ rules: legacy, startAt: new Date('2026-10-19T12:00:00Z'), endAt: new Date('2026-10-19T13:00:00Z') })).toBe(false);
  });
});

describe('zonedWallTimeToUtc', () => {
  it('a local time that does not exist (spring-forward gap) resolves to the instant just after the gap', () => {
    expect(zonedWallTimeToUtc(2026, 2, 29, '02:30', 'Europe/Paris').toISOString()).toBe('2026-03-29T01:30:00.000Z');   // = 03:30 CEST
  });
  it('round trip: for every hour of 2026 that exists locally, the wall clock read back equals the wall clock asked for', () => {
    let checked = 0;
    for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2027, 0, 1); ms += 3600_000) {
      const p = zonedParts(ms, 'Europe/Paris');
      const back = zonedWallTimeToUtc(p.year, p.month - 1, p.day, `${String(p.hour).padStart(2, '0')}:00`, 'Europe/Paris');
      const q = zonedParts(back.getTime(), 'Europe/Paris');
      if (p.minute === 0) { expect([q.year, q.month, q.day, q.hour]).toEqual([p.year, p.month, p.day, p.hour]); checked += 1; }
    }
    expect(checked).toBeGreaterThan(8700);
  });
  it('invalid zone: returns the UTC reading, never throws', () => {
    expect(zonedWallTimeToUtc(2026, 9, 19, '09:00', 'Nope/Nope').toISOString()).toBe('2026-10-19T09:00:00.000Z');
    expect(zonedParts(0, 'Nope/Nope')).toBeNull();
  });
});
