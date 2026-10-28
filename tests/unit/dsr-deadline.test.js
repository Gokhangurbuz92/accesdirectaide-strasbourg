/**
 * Launch-readiness item 63 — the one-month deadline of a data-subject request (GDPR art. 12(3)), counted as EU regulation 1182/71 counts months.
 */
import { describe, expect, it } from 'vitest';
import { dsrDeadline } from '../../api/_services/dsr-deadline.js';

const due = (iso) => dsrDeadline(iso, new Date(iso)).dueAt.slice(0, 10);

describe('DSR deadline', () => {
  it('the same date of the following month, or its last day', () => {
    expect(due('2026-03-15T10:00:00Z')).toBe('2026-04-15');
    expect(due('2026-01-31T10:00:00Z')).toBe('2026-02-28');
    expect(due('2028-01-31T10:00:00Z')).toBe('2028-02-29');
    expect(due('2026-12-31T10:00:00Z')).toBe('2027-01-31');
    expect(due('2026-05-31T10:00:00Z')).toBe('2026-06-30');
  });
  it('says when it is overdue and how many days are left; no date, no deadline', () => {
    expect(dsrDeadline('2026-09-01T08:00:00Z', new Date('2026-10-25T12:00:00Z'))).toMatchObject({ overdue: true });
    expect(dsrDeadline('2026-10-20T08:00:00Z', new Date('2026-10-25T12:00:00Z'))).toMatchObject({ overdue: false, daysLeft: 27, dueAt: '2026-11-20T23:59:59.999Z' });
    expect(dsrDeadline(null)).toEqual({ dueAt: null, overdue: false, daysLeft: null });
  });
});
