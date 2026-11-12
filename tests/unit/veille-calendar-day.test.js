/**
 * K12 first night (12/11/2026): FINESS gives its update date without a time zone (« 2024-06-17 00:00:00 »). The verification chain must write that same
 * calendar day whatever the machine's time zone — read as local time it moved one day back on a Paris-time machine and every description was rewritten
 * when the UTC server wrote the right day. Dates with a zone keep their UTC day.
 */
import { describe, expect, it } from 'vitest';
import { day } from '../../api/_services/verification/chain.js';

describe('calendar day of a source date', () => {
  it('a date without a zone is that calendar day (process TZ: ' + (process.env.TZ || 'default') + ')', () => {
    expect(day('2024-06-17 00:00:00')).toBe('2024-06-17');
    expect(day('2024-06-17T00:00:00')).toBe('2024-06-17');
    expect(day('2024-06-17')).toBe('2024-06-17');
    expect(day(' 2024-06-17 23:59:59.5 ')).toBe('2024-06-17');
  });
  it('a date with a zone or a Date keeps its UTC day; nothing or garbage gives null', () => {
    expect(day('2024-06-16T22:00:00Z')).toBe('2024-06-16');
    expect(day('2024-06-17T00:30:00+02:00')).toBe('2024-06-16');
    expect(day(new Date(Date.UTC(2024, 5, 17, 12)))).toBe('2024-06-17');
    expect(day(null)).toBeNull(); expect(day('')).toBeNull(); expect(day('pas une date')).toBeNull();
  });
});
