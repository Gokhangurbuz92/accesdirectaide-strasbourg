// R47 (journeys): the professional's absence fields are Paris wall time whatever the device's time zone (the run's TZ is UTC), both sides of the DST change.
import { describe, it, expect } from 'vitest';
import { parisWallToIso, parisWallValue } from '../../src/lib/parisCalendar.js';

describe('R47 Paris wall time of datetime-local fields', () => {
  it('reads winter and summer wall times as Paris time', () => {
    expect(parisWallToIso('2026-11-10T09:00')).toBe('2026-11-10T08:00:00.000Z');
    expect(parisWallToIso('2026-07-10T09:00')).toBe('2026-07-10T07:00:00.000Z');
  });
  it('round-trips an instant to the field value', () => {
    for (const iso of ['2026-11-10T08:00:00.000Z', '2026-07-10T07:00:00.000Z', '2026-10-25T03:30:00.000Z']) expect(parisWallToIso(parisWallValue(iso))).toBe(iso);
  });
  it('moves a time skipped by the spring change forward, and refuses an invalid value', () => {
    expect(parisWallValue(parisWallToIso('2027-03-28T02:30'))).toBe('2027-03-28T03:30');
    expect(parisWallToIso('')).toBe(''); expect(parisWallToIso('not a date')).toBe(''); expect(parisWallValue('x')).toBe('');
  });
});
