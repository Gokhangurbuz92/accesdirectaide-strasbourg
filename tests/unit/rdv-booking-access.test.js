import { describe, it, expect } from 'vitest';
import {
  hasBookingManagementCapability,
  classifyCitizenBookingAccess,
  citizenBookingLoginUrl,
} from '../../src/lib/rdvBookingAccess.js';

const TOKEN = 'a'.repeat(24) + '.' + 'b'.repeat(24);

describe('hasBookingManagementCapability (appointment management route)', () => {
  it('accepts appointment query + signed token in the URL fragment', () => {
    expect(hasBookingManagementCapability('?appointment=apt-1', `#token=${TOKEN}`)).toBe(true);
  });
  it('rejects a missing appointment id, missing/short/oversized/whitespace token', () => {
    expect(hasBookingManagementCapability('', `#token=${TOKEN}`)).toBe(false);
    expect(hasBookingManagementCapability('?appointment=apt-1', '')).toBe(false);
    expect(hasBookingManagementCapability('?appointment=apt-1', '#token=short')).toBe(false);
    expect(hasBookingManagementCapability('?appointment=apt-1', `#token=${'x'.repeat(4097)}`)).toBe(false);
    expect(hasBookingManagementCapability('?appointment=apt-1', `#token=${encodeURIComponent('a'.repeat(12) + ' ' + 'b'.repeat(12))}`)).toBe(false);
  });
  it('does not accept the token from the query string (fragment only)', () => {
    expect(hasBookingManagementCapability(`?appointment=apt-1&token=${TOKEN}`, '')).toBe(false);
  });
});

describe('classifyCitizenBookingAccess (mirrors api/_handlers/auth/me.js + requireCitizenUser)', () => {
  const user = { session: { kind: 'user' }, user: { id: 'u1', emailVerified: true, emailVerifiedAt: '2026-01-01T00:00:00Z' } };
  it('401 -> login; 403 EMAIL_NOT_VERIFIED -> verify-email', () => {
    expect(classifyCitizenBookingAccess(401, null)).toBe('login');
    expect(classifyCitizenBookingAccess(403, { code: 'EMAIL_NOT_VERIFIED' })).toBe('verify-email');
  });
  it('other statuses fail closed as unavailable', () => {
    expect(classifyCitizenBookingAccess(403, { code: 'OTHER' })).toBe('unavailable');
    expect(classifyCitizenBookingAccess(500, user)).toBe('unavailable');
    expect(classifyCitizenBookingAccess(404, null)).toBe('unavailable');
  });
  it('200 with a verified citizen session -> allowed', () => {
    expect(classifyCitizenBookingAccess(200, user)).toBe('allowed');
  });
  it('pro/admin sessions and id-less users are not citizens -> login', () => {
    expect(classifyCitizenBookingAccess(200, { session: { kind: 'pro' }, user: { id: 'p1' } })).toBe('login');
    expect(classifyCitizenBookingAccess(200, { session: { kind: 'admin' }, user: { id: 'admin' } })).toBe('login');
    expect(classifyCitizenBookingAccess(200, { session: { kind: 'user' }, user: {} })).toBe('login');
    expect(classifyCitizenBookingAccess(200, null)).toBe('login');
  });
  it('unverified e-mail on a 200 payload -> verify-email', () => {
    expect(classifyCitizenBookingAccess(200, { ...user, user: { id: 'u1', emailVerified: false } })).toBe('verify-email');
    expect(classifyCitizenBookingAccess(200, { ...user, user: { id: 'u1', emailVerifiedAt: null } })).toBe('verify-email');
  });
});

describe('citizenBookingLoginUrl', () => {
  it('keeps a safe /rdv/:slug/booking path and encodes next', () => {
    expect(citizenBookingLoginUrl('/rdv/ccas-strasbourg/booking', '?aide=a1&origin=aide')).toBe(
      `/auth/login?next=${encodeURIComponent('/rdv/ccas-strasbourg/booking?aide=a1&origin=aide')}`,
    );
  });
  it('never forwards appointment ids or tokens into the auth redirect', () => {
    const url = citizenBookingLoginUrl('/rdv/s/booking', `?appointment=apt-1&token=${TOKEN}&aide=a1`);
    const next = decodeURIComponent(url.split('next=')[1]);
    expect(next).toBe('/rdv/s/booking?aide=a1');
    expect(url).not.toContain('apt-1');
    expect(url).not.toContain(TOKEN);
  });
  it('falls back to /annuaire for unsafe paths (open-redirect guard)', () => {
    for (const p of ['//evil.test/booking', 'https://evil.test', '/rdv/x/booking/extra', '/other', '']) {
      expect(citizenBookingLoginUrl(p, '')).toBe(`/auth/login?next=${encodeURIComponent('/annuaire')}`);
    }
  });
  it('drops an oversized query', () => {
    const url = citizenBookingLoginUrl('/rdv/s/booking', `?q=${'x'.repeat(2100)}`);
    expect(decodeURIComponent(url.split('next=')[1])).toBe('/rdv/s/booking');
  });
});
