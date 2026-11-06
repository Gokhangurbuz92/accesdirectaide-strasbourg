/**
 * PKG-11 audit — boundary of proSessionRevoked (account-level revocation by ProUser.sessionsValidAfter): tokens issued before the revocation second are dead, tokens
 * issued in or after it live; no revocation = nothing changes; a token without an issue time is refused once a revocation exists. Real API behaviour: integration
 * test pkg11-pro-session-lifecycle-db.
 */
import { describe, expect, it } from 'vitest';
import { proSessionRevoked } from '../../api/_utils/auth.js';

describe('proSessionRevoked', () => {
  const at = new Date('2026-10-22T10:00:00.500Z'); const sec = Math.floor(at.getTime() / 1000);
  it('no revocation recorded: never revoked', () => { expect(proSessionRevoked(1, { sessionsValidAfter: null })).toBe(false); expect(proSessionRevoked(1, null)).toBe(false); });
  it('issued before the revocation second: revoked; after it: valid', () => {
    expect(proSessionRevoked(sec - 1, { sessionsValidAfter: at })).toBe(true);
    expect(proSessionRevoked(sec + 5, { sessionsValidAfter: at.toISOString() })).toBe(false);
  });
  // R47 (journeys finding): with 1 s resolution a token issued in the SAME second as a logout / MFA enrolment survived it. Tokens now carry iat_ms
  // and are compared to the millisecond; a legacy token without it is placed at the start of its second (revoked if in doubt).
  it('R47: same second — compared to the millisecond with iat_ms; a legacy token in that second is revoked', () => {
    expect(proSessionRevoked(sec, { sessionsValidAfter: at }, at.getTime() - 1)).toBe(true);
    expect(proSessionRevoked(sec, { sessionsValidAfter: at }, at.getTime())).toBe(false);
    expect(proSessionRevoked(sec, { sessionsValidAfter: at }, at.getTime() + 1)).toBe(false);
    expect(proSessionRevoked(sec, { sessionsValidAfter: at })).toBe(true);
  });
  it('a token without an issue time is refused once a revocation exists', () => { expect(proSessionRevoked(undefined, { sessionsValidAfter: at })).toBe(true); });
});
