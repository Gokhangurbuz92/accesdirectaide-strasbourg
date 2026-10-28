import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/index.js', () => ({ db: {} }));
vi.mock('../../src/db/schema.js', () => ({}));
vi.mock('../../api/_utils/ics.js', () => ({
  buildAppointmentIcs: () => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
}));
vi.mock('../../api/_utils/mailer.js', () => ({ sendMail: vi.fn() }));
vi.mock('../../api/_utils/pro-rdv.js', () => ({
  ACTIVE_APPOINTMENT_STATUSES: ['confirmed'],
  generateSlots: () => [],
  toBusyWindows: () => [],
  validateDateRange: () => ({ from: new Date(), to: new Date() }),
}));
vi.mock('../../api/_utils/rateLimit.js', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: () => '127.0.0.1',
  getRateLimitStatus: () => 429,
}));
vi.mock('../../api/_utils/rdv-public-auth.js', () => ({
  requireCitizenUser: vi.fn(),
}));
vi.mock('../../api/_utils/user-auth.js', () => ({
  buildAppUrl: (path) => `http://localhost${path}`,
}));

const {
  issueAppointmentConfirmationToken,
  verifyAppointmentConfirmationToken,
  withBookingCollisionLock,
} = await import('../../api/_handlers/rdv.js');

describe('WS7 appointment confirmation token', () => {
  it('is signed, nonce-backed, non-sequential and bound to appointment + user', () => {
    const first = issueAppointmentConfirmationToken({
      appointmentId: 'appointment-1',
      citizenUserId: 'citizen-1',
      nowMs: 1_000,
      ttlMs: 60_000,
    });
    const second = issueAppointmentConfirmationToken({
      appointmentId: 'appointment-1',
      citizenUserId: 'citizen-1',
      nowMs: 1_000,
      ttlMs: 60_000,
    });

    expect(first.token).not.toBe(second.token);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(first.token).not.toContain('appointment-1');
    expect(first.token).not.toContain('citizen-1');

    expect(
      verifyAppointmentConfirmationToken(first.token, {
        appointmentId: 'appointment-1',
        citizenUserId: 'citizen-1',
        nowMs: 2_000,
      }),
    ).toMatchObject({ ok: true });

    expect(
      verifyAppointmentConfirmationToken(first.token, {
        appointmentId: 'appointment-2',
        citizenUserId: 'citizen-1',
        nowMs: 2_000,
      }),
    ).toEqual({ ok: false, code: 'INVALID_APPOINTMENT_TOKEN' });
  });

  it('fails closed for tampered and expired tokens', () => {
    const issued = issueAppointmentConfirmationToken({
      appointmentId: 'appointment-1',
      citizenUserId: 'citizen-1',
      nowMs: 1_000,
      ttlMs: 1_000,
    });

    const tampered = `${issued.token.slice(0, -1)}${issued.token.endsWith('a') ? 'b' : 'a'}`;

    expect(
      verifyAppointmentConfirmationToken(tampered, {
        appointmentId: 'appointment-1',
        citizenUserId: 'citizen-1',
        nowMs: 1_500,
      }),
    ).toEqual({ ok: false, code: 'INVALID_APPOINTMENT_TOKEN' });

    expect(
      verifyAppointmentConfirmationToken(issued.token, {
        appointmentId: 'appointment-1',
        citizenUserId: 'citizen-1',
        nowMs: 2_001,
      }),
    ).toEqual({ ok: false, code: 'INVALID_APPOINTMENT_TOKEN' });
  });
});

describe('WS7 local booking collision guard', () => {
  it('serializes contenders sharing the same structure/day key', async () => {
    const events = [];
    let releaseFirst;
    const holdFirst = new Promise((resolve) => {
      releaseFirst = resolve;
    });

    const first = withBookingCollisionLock('structure-1:2030-01-01', async () => {
      events.push('first:start');
      await holdFirst;
      events.push('first:end');
      return 'first';
    });

    await Promise.resolve();

    const second = withBookingCollisionLock('structure-1:2030-01-01', async () => {
      events.push('second:start');
      events.push('second:end');
      return 'second';
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(['first:start']);

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(events).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ]);
  });
});
