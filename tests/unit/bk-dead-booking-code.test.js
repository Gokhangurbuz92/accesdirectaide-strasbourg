/**
 * A-24 (booking part) — the unrouted booking pages and the retired public/appointments adapters stay removed: no file, no lazy import, no test exercising
 * them as if they were live (false coverage). Booking is /rdv/:slug/booking + POST /api/rdv/appointments; the e-mail's manage link opens PublicBooking.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const DEAD = ['src/pages/PublicRdvEntry.jsx', 'src/pages/AppointmentCancel.jsx', 'src/pages/AppointmentReschedule.jsx',
  'api/_handlers/public/appointments/create.js', 'api/_handlers/public/appointments/cancel.js'];

describe('A-24: dead booking code stays removed', () => {
  it('the files do not exist', () => { expect(DEAD.filter((f) => fs.existsSync(f))).toEqual([]); });
  it('nothing imports them (pages index, routes)', () => {
    const index = fs.readFileSync('src/pages/index.jsx', 'utf8'); const routes = fs.readFileSync('api/routes.js', 'utf8');
    expect(index).not.toMatch(/PublicRdvEntry|AppointmentCancel|AppointmentReschedule/);
    expect(routes).not.toMatch(/public\/appointments\//);
  });
});
