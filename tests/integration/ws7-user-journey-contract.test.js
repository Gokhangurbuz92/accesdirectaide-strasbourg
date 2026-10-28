import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('WS7 product journey wiring', () => {
  it('connects aide detail to public booking with a local return path', () => {
    const aideDetail = read('src/pages/AideDetail.jsx');
    const routing = read('src/lib/rdvRouting.js');

    expect(aideDetail).toContain("import { buildPublicRdvPath } from '@/lib/rdvRouting';");
    expect(aideDetail).toContain("origin: 'aide'");
    expect(aideDetail).toContain('data-testid={`aide-booking-${struct.id}`}');
    expect(routing).toContain("/booking");
    expect(routing).toContain('normalizeNextPath');
    expect(routing).toContain("decoded.startsWith('//')");
    expect(routing).toContain("decoded.includes('\\\\')");
  });

  it('keeps the public booking flow on real slots and exposes local ICS download', () => {
    const booking = read('src/pages/PublicBooking.jsx');
    const rdv = read('api/_handlers/rdv.js');

    expect(booking).toContain('/api/rdv/structures/');
    expect(booking).toContain("fetch('/api/rdv/appointments'");
    expect(booking).toContain('data-testid="booking-download-ics"');
    expect(booking).toContain('new Blob([calendar.content]');
    expect(booking).toContain('useEffect(() =>');
    expect(rdv).toContain('buildAppointmentIcs({');
    expect(rdv).toContain('includeCalendar: true');
  });

  it('hardens booking collisions and token confirmation without schema mutation', () => {
    const rdv = read('api/_handlers/rdv.js');

    expect(rdv).toContain('withBookingCollisionLock');
    expect(rdv).toContain('crypto.randomBytes(18)');
    expect(rdv).toContain("createHmac('sha256'");
    expect(rdv).toContain('crypto.timingSafeEqual');
    expect(rdv).toContain('INVALID_APPOINTMENT_TOKEN');
    expect(rdv).toContain("segments[2] === 'confirmation'");
    expect(rdv).not.toContain('ALTER TABLE');
    expect(rdv).not.toContain('CREATE TABLE');
  });
});
