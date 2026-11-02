// R38 — the public structure page runs in Production before the owner applies migration 0043: it reads « allowGuestBooking » only when the guest switch is
// on (verified live in LAB on a database stopped at migration 0042: structure detail, list and search answer 200). This pins the guard in the source.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('structures.js before migration 0043', () => {
  const src = fs.readFileSync('api/_handlers/structures.js', 'utf8');
  it('selects allowGuestBooking only behind ADA_GUEST_BOOKING_ENABLED', () => {
    expect(src).toMatch(/\.\.\.\(guestBookingOn\(\) \? \{ allowGuestBooking: true \} : \{\}\)/);
    expect(src).not.toMatch(/^\s*allowGuestBooking: true,\s*$/m);
    expect(src).toMatch(/const guestBookingOn = \(\) => String\(process\.env\.ADA_GUEST_BOOKING_ENABLED \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'true'/);
  });
});
