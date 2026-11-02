/**
 * R38 — account-free booking: the pure rules (code / token hashing, expiry, the shared « still active » rule, masking, input validation) and the two 503 gates
 * of the handler (global switch off; mail not deliverable). The database behaviour is proven in tests/integration/r38-guest-booking-db.test.js.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  GUEST_CODE_MAX_ATTEMPTS, GUEST_HOLD_MINUTES, checkGuestCode, checkManageToken, guestBookingEnabled, guestCodeHash, guestEmailHash, holdExpired, holdExpiry,
  mailReallySent, maskEmail, maskPhone, manageTokenHash, newGuestCode, newManageToken, normalizeGuestEmail, readGuestIdentity, sameDigest,
} from '../../api/_utils/rdv-guest-core.js';
import { activeAppointmentWhere, isAppointmentActive } from '../../api/_utils/rdv-active.js';
import { ProAppointment } from '../../src/db/schema.js';

const ENV = { JWT_SECRET: 'x'.repeat(40) };
const mkRes = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });

describe('switch and mail truthfulness', () => {
  it('ADA_GUEST_BOOKING_ENABLED must be exactly true (fail-closed)', () => {
    expect(guestBookingEnabled({})).toBe(false);
    for (const v of ['1', 'yes', 'on', 'TRUE ', 'false', '']) expect(guestBookingEnabled({ ADA_GUEST_BOOKING_ENABLED: v })).toBe(v.trim().toLowerCase() === 'true');
    expect(guestBookingEnabled({ ADA_GUEST_BOOKING_ENABLED: 'true' })).toBe(true);
  });
  it('only PROVIDER_ACCEPTED or TEST_RECORDED count as sent — never noop (accepted:true, NOT_SENT)', () => {
    expect(mailReallySent({ accepted: true, delivered: false, outcome: 'NOT_SENT' })).toBe(false);
    expect(mailReallySent({ accepted: true, outcome: 'NOT_DELIVERED' })).toBe(false);
    expect(mailReallySent({ accepted: true })).toBe(false);
    expect(mailReallySent(null)).toBe(false);
    expect(mailReallySent({ outcome: 'PROVIDER_ACCEPTED' })).toBe(true);
    expect(mailReallySent({ outcome: 'TEST_RECORDED' })).toBe(true);
  });
});

describe('code, token and e-mail hashing', () => {
  it('the 6-digit code is uniform, stored as an HMAC bound to its hold, checked in constant time', () => {
    for (let i = 0; i < 50; i += 1) expect(newGuestCode()).toMatch(/^\d{6}$/);
    const h = guestCodeHash('hold-a', '123456', ENV);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('123456');
    expect(checkGuestCode('hold-a', '123456', h, ENV)).toBe(true);
    expect(checkGuestCode('hold-b', '123456', h, ENV)).toBe(false);   // a code of hold A never confirms hold B
    expect(checkGuestCode('hold-a', '123457', h, ENV)).toBe(false);
    expect(checkGuestCode('hold-a', '12345', h, ENV)).toBe(false);
    expect(checkGuestCode('hold-a', '123456', null, ENV)).toBe(false);
    expect(guestCodeHash('hold-a', '123456', { JWT_SECRET: 'y'.repeat(40) })).not.toBe(h);   // keyed
    expect(GUEST_CODE_MAX_ATTEMPTS).toBe(5);
  });
  it('the manage token is 256 random bits; only its SHA-256 is stored; valid for its row until expiry', () => {
    const { token, hash } = newManageToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(manageTokenHash(token));
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(newManageToken().token).not.toBe(token);
    const now = new Date('2030-01-01T10:00:00Z');
    const row = { guestManageTokenHash: hash, guestManageExpiresAt: new Date('2030-01-01T11:00:00Z') };
    expect(checkManageToken(token, row, now)).toBe(true);
    expect(checkManageToken(token, { ...row, guestManageExpiresAt: new Date('2030-01-01T10:00:00Z') }, now)).toBe(false);   // expires at the end of the appointment
    expect(checkManageToken(newManageToken().token, row, now)).toBe(false);
    expect(checkManageToken(token, { ...row, guestManageTokenHash: null }, now)).toBe(false);
    expect(checkManageToken('short', row, now)).toBe(false);
    expect(sameDigest('abc', 'abd')).toBe(false); expect(sameDigest('abc', 'abc')).toBe(true); expect(sameDigest('', '')).toBe(false);
  });
  it('the e-mail blind index ignores case and spaces and is keyed', () => {
    expect(normalizeGuestEmail('  Jean.Dupont@Exemple.FR ')).toBe('jean.dupont@exemple.fr');
    expect(normalizeGuestEmail('pas une adresse')).toBeNull();
    expect(guestEmailHash('A@b.fr', ENV)).toBe(guestEmailHash(' a@B.FR', ENV));
    expect(guestEmailHash('a@b.fr', ENV)).not.toBe(guestEmailHash('a@b.fr', { JWT_SECRET: 'z'.repeat(40) }));
  });
});

describe('hold expiry and the shared « still active » rule', () => {
  const now = new Date('2030-01-01T10:00:00Z');
  it('a hold lasts 20 minutes', () => {
    expect(GUEST_HOLD_MINUTES).toBe(20);
    expect(holdExpiry(now).toISOString()).toBe('2030-01-01T10:20:00.000Z');
    expect(holdExpired({ guestHoldExpiresAt: holdExpiry(now) }, now)).toBe(false);
    expect(holdExpired({ guestHoldExpiresAt: now }, now)).toBe(true);
    expect(holdExpired({ guestHoldExpiresAt: null }, now)).toBe(true);
  });
  it('an expired guest hold no longer blocks; everything else keeps the historical statuses', () => {
    expect(isAppointmentActive({ status: 'requested', guestHoldExpiresAt: new Date('2030-01-01T10:05:00Z') }, now)).toBe(true);
    expect(isAppointmentActive({ status: 'requested', guestHoldExpiresAt: new Date('2030-01-01T09:59:59Z') }, now)).toBe(false);
    expect(isAppointmentActive({ status: 'requested', guestHoldExpiresAt: null }, now)).toBe(true);
    for (const s of ['booked', 'confirmed', 'locked']) expect(isAppointmentActive({ status: s, guestHoldExpiresAt: new Date('2000-01-01') }, now)).toBe(true);
    for (const s of ['cancelled', 'done', 'no_show']) expect(isAppointmentActive({ status: s }, now)).toBe(false);
  });
  it('the SQL form is the same rule (status list, then requested-and-expired excluded), with `now` bound as a parameter', () => {
    const q = new PgDialect().sqlToQuery(activeAppointmentWhere(ProAppointment, now));
    expect(q.sql).toContain('"status" in (');
    expect(q.sql).toMatch(/"status" <> \$\d+ or "ProAppointment"\."guestHoldExpiresAt" is null or "ProAppointment"\."guestHoldExpiresAt" > \$\d+/);
    expect(q.params).toEqual(expect.arrayContaining(['booked', 'requested', 'confirmed', 'locked']));
    expect(q.params.some((p) => String(p).startsWith('2030-01-01'))).toBe(true);
  });
});

describe('minimal identity and masking', () => {
  const ok = { name: 'C. D.', email: 'c.d@exemple.fr', consent: true };
  it('accepts a name or initials, an address, an optional phone and a short note; consent is required', () => {
    expect(readGuestIdentity(ok).value).toEqual({ name: 'C. D.', email: 'c.d@exemple.fr', phone: null, note: null });
    expect(readGuestIdentity({ ...ok, phone: '06 12 34 56 78', note: ' rappel ' }).value).toMatchObject({ phone: '0612345678', note: 'rappel' });
    expect(readGuestIdentity({ ...ok, consent: 'yes' }).error.code).toBe('CONSENT_REQUIRED');
    expect(readGuestIdentity({ ...ok, name: '' }).error.field).toBe('name');
    expect(readGuestIdentity({ ...ok, name: 'x'.repeat(81) }).error.code).toBe('INVALID_NAME');
    expect(readGuestIdentity({ ...ok, email: 'nope' }).error.code).toBe('INVALID_EMAIL');
    expect(readGuestIdentity({ ...ok, phone: 'abc' }).error.code).toBe('INVALID_PHONE');
    expect(readGuestIdentity({ ...ok, note: 'x'.repeat(301) }).error.code).toBe('NOTE_TOO_LONG');
    expect(readGuestIdentity({ ...ok, note: 'x'.repeat(300) }).value.note).toHaveLength(300);
  });
  it('an address or a phone is only ever echoed masked', () => {
    expect(maskEmail('jean.dupont@exemple.fr')).toBe('je***@exemple.fr');
    expect(maskEmail('a@b.fr')).toBe('a***@b.fr');
    expect(maskEmail('nope')).toBeNull();
    expect(maskPhone('0612345678')).toBe('***78');
    expect(maskPhone('')).toBeNull();
  });
});

describe('the 503 gates of rdv/guest/* (before any database access)', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock('../../api/_utils/mailer.js'); vi.doUnmock('../../api/_utils/rateLimit.js'); });
  const call = async (handler, method, path, body) => { const res = mkRes(); await handler({ method, url: `/api/rdv/${path}`, query: {}, body, headers: { host: 'localhost' } }, res); return res; };

  it('switch off: every guest route answers 503 GUEST_BOOKING_DISABLED', async () => {
    vi.stubEnv('ADA_GUEST_BOOKING_ENABLED', '');
    const { default: handler } = await import('../../api/_handlers/rdv.js');
    for (const [m, p] of [['GET', 'guest/structures/x/services'], ['GET', 'guest/structures/x/slots'], ['POST', 'guest/hold'], ['POST', 'guest/confirm'], ['POST', 'guest/manage'], ['POST', 'guest/manage/cancel'], ['POST', 'guest/manage/reschedule']]) {
      const r = await call(handler, m, p, {});
      expect([p, r.statusCode, r.body.code]).toEqual([p, 503, 'GUEST_BOOKING_DISABLED']);
    }
  });
  it('mail not deliverable: the hold answers 503 GUEST_BOOKING_MAIL_UNAVAILABLE before looking anything up', async () => {
    vi.stubEnv('ADA_GUEST_BOOKING_ENABLED', 'true');
    vi.doMock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: () => '127.0.0.1', getRateLimitStatus: () => 429 }));
    vi.doMock('../../api/_utils/mailer.js', async (orig) => ({ ...(await orig()), getMailerStatus: () => ({ provider: 'noop', deliverable: false, reason: 'noop' }), sendMail: vi.fn() }));
    const { default: handler } = await import('../../api/_handlers/rdv.js');
    const mailer = await import('../../api/_utils/mailer.js');
    const r = await call(handler, 'POST', 'guest/hold', { structureSlug: 's', serviceId: 'v', startAt: '2030-01-01T09:00:00.000Z', idempotencyKey: 'k', ...{ name: 'A B', email: 'a@b.fr', consent: true } });
    expect([r.statusCode, r.body.code]).toEqual([503, 'GUEST_BOOKING_MAIL_UNAVAILABLE']);
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });
});
