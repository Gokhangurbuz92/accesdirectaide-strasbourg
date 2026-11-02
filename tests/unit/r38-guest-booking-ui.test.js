/** R38 — browser helpers of the account-free booking: the manage capability is read from the fragment only; slots are grouped by their Paris day. */
import { describe, expect, it } from 'vitest';
import { guestBookingPath, readManageCapability, slotsByParisDay } from '../../src/lib/guestBooking.js';

describe('account-free booking helpers', () => {
  const token = 'A'.repeat(43);
  it('the manage capability comes from ?appointment= and #manage= (never a query-string token)', () => {
    expect(readManageCapability('?appointment=abc', `#manage=${token}`)).toEqual({ appointmentId: 'abc', token });
    expect(readManageCapability(`?appointment=abc&manage=${token}`, '')).toBeNull();
    expect(readManageCapability('', `#manage=${token}`)).toBeNull();
    expect(readManageCapability('?appointment=abc', '#manage=short')).toBeNull();
  });
  it('slots are grouped by the Paris calendar day (23:30 UTC in summer is the next day in Paris)', () => {
    const days = slotsByParisDay([{ startAt: '2030-07-01T22:30:00.000Z' }, { startAt: '2030-07-01T08:00:00.000Z' }]);
    expect(days.map((d) => d.date)).toEqual(['2030-07-01', '2030-07-02']);
  });
  it('the guest page path', () => { expect(guestBookingPath('mon slug')).toBe('/rdv/mon%20slug/sans-compte'); });
});
