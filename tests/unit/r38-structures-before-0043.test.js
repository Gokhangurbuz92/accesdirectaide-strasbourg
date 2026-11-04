// R38 — the public structure page runs in Production at migration 0042. R42 (DEC-R42-01): account-free booking is retired, so the page no longer reads
// the 0043 column at all, says that an account is required, and never returns the internal booking configuration (settings_json).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('structures.js on a 0042 database, after the R42 retirement of account-free booking', () => {
  const src = fs.readFileSync('api/_handlers/structures.js', 'utf8');
  it('never reads allowGuestBooking nor the guest switch; leaves settings_json out; says an account is required', () => {
    expect(src).not.toMatch(/allowGuestBooking|ADA_GUEST_BOOKING_ENABLED|requestGuestSchema/);
    expect(src).toMatch(/settings_json: false/);
    expect(src).toMatch(/accountRequired: true/);
  });
});
