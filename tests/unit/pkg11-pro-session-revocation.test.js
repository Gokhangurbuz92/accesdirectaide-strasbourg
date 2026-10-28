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
  it('issued before the revocation second: revoked; in or after it: valid', () => {
    expect(proSessionRevoked(sec - 1, { sessionsValidAfter: at })).toBe(true);
    expect(proSessionRevoked(sec, { sessionsValidAfter: at })).toBe(false);
    expect(proSessionRevoked(sec + 5, { sessionsValidAfter: at.toISOString() })).toBe(false);
  });
  it('a token without an issue time is refused once a revocation exists', () => { expect(proSessionRevoked(undefined, { sessionsValidAfter: at })).toBe(true); });
});
