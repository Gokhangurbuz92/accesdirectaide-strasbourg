/**
 * Release A (activation plan 07/11/2026) — unit rules.
 *   G-1: the platform invitation of a partner structure's first administrator (api/_services/platform-invitation.js): only a SUPERADMIN with a second-factor
 *        session AND, in the database, an active, enrolled SUPERADMIN account; only the STRUCTURE_ADMIN role; only an active, identity-verified structure.
 *   G-2: the professional's own notices (pro/notifications) follow the « pro » surface, not « communications »; messaging stays in « communications ».
 */
import { describe, expect, it } from 'vitest';
import { authorizePlatformInvitation, platformTargetOf, PLATFORM_INVITATION_CODES as C } from '../../api/_services/platform-invitation.js';
import { surfaceOf, isAllowedInPublicBeta, SURFACES } from '../../api/_utils/public-beta.js';
import { capabilitiesOfRoute } from '../../api/_utils/capabilities.js';

/** a fake drizzle handle answering the two reads of the rule */
function fakeDb({ me = { role: 'SUPERADMIN', status: 'active', mfa_enabled: true }, structure = { id: 's1', nom: 'Structure fictive', statut: 'actif', verification_status: 'VERIFIED' } } = {}) {
  const calls = [];
  return {
    calls,
    async execute(q) {
      const text = JSON.stringify(q);
      calls.push(text);
      if (text.includes('ProUser')) return { rows: me ? [me] : [] };
      if (text.includes('Structure')) return { rows: structure ? [structure] : [] };
      return { rows: [] };
    },
  };
}
const actor = (o = {}) => ({ userId: 'op', role: 'SUPERADMIN', mfa: true, ...o });

describe('Release A / G-1 — platform invitation rule', () => {
  it('reads the target only from a string « structure » field', () => {
    expect(platformTargetOf({ structure: '  slug-x ' })).toBe('slug-x');
    expect(platformTargetOf({ structure: 42 })).toBe('');
    expect(platformTargetOf({})).toBe('');
    expect(platformTargetOf(null)).toBe('');
  });

  it('accepts an enrolled, active SUPERADMIN with a second-factor session, the STRUCTURE_ADMIN role and an active verified structure', async () => {
    const out = await authorizePlatformInvitation({ dbh: fakeDb(), actor: actor(), target: 'slug-x', role: 'STRUCTURE_ADMIN' });
    expect(out).toEqual({ ok: true, structure: { id: 's1', nom: 'Structure fictive' } });
  });

  it.each([
    ['STRUCTURE_ADMIN', true], ['PRO', true], ['', true], [undefined, true],
  ])('refuses a %s actor (403, before any database read)', async (role) => {
    const dbh = fakeDb();
    const out = await authorizePlatformInvitation({ dbh, actor: actor({ role }), target: 'slug-x', role: 'STRUCTURE_ADMIN' });
    expect(out).toMatchObject({ ok: false, status: 403, body: { code: C.FORBIDDEN } });
    expect(dbh.calls).toHaveLength(0);
  });

  it('refuses a SUPERADMIN session that did not pass the second factor, whatever PRO_MFA_REQUIRED says', async () => {
    for (const mfa of [false, undefined, 'true', 1]) {
      const out = await authorizePlatformInvitation({ dbh: fakeDb(), actor: actor({ mfa }), target: 'slug-x', role: 'STRUCTURE_ADMIN' });
      expect(out).toMatchObject({ ok: false, status: 403, body: { code: C.MFA_REQUIRED } });
    }
  });

  it.each([
    ['no account', null],
    ['demoted', { role: 'STRUCTURE_ADMIN', status: 'active', mfa_enabled: true }],
    ['disabled', { role: 'SUPERADMIN', status: 'disabled', mfa_enabled: true }],
    ['pending', { role: 'SUPERADMIN', status: 'pending', mfa_enabled: true }],
    ['factor removed', { role: 'SUPERADMIN', status: 'active', mfa_enabled: false }],
  ])('refuses a token whose account is %s in the database', async (_label, me) => {
    const out = await authorizePlatformInvitation({ dbh: fakeDb({ me }), actor: actor(), target: 'slug-x', role: 'STRUCTURE_ADMIN' });
    expect(out).toMatchObject({ ok: false, status: 403, body: { code: C.FORBIDDEN } });
  });

  it('names the structure administrator only', async () => {
    for (const role of ['PRO', 'SUPERADMIN', 'INSTITUTION', '']) {
      const out = await authorizePlatformInvitation({ dbh: fakeDb(), actor: actor(), target: 'slug-x', role });
      expect(out).toMatchObject({ ok: false, status: 400, body: { code: C.ROLE } });
    }
  });

  it('refuses an unknown or oversized target without reading anything else', async () => {
    expect(await authorizePlatformInvitation({ dbh: fakeDb({ structure: null }), actor: actor(), target: 'nope', role: 'STRUCTURE_ADMIN' }))
      .toMatchObject({ ok: false, status: 404, body: { code: C.NOT_FOUND } });
    expect(await authorizePlatformInvitation({ dbh: fakeDb(), actor: actor(), target: 'x'.repeat(201), role: 'STRUCTURE_ADMIN' }))
      .toMatchObject({ ok: false, status: 404, body: { code: C.NOT_FOUND } });
  });

  it.each([
    ['draft and unverified (self-registered or the internal platform structure)', { statut: 'brouillon', verification_status: 'UNVERIFIED' }],
    ['active but unverified', { statut: 'actif', verification_status: 'UNVERIFIED' }],
    ['verified but suspended', { statut: 'suspendu', verification_status: 'VERIFIED' }],
    ['verified but draft', { statut: 'brouillon', verification_status: 'VERIFIED' }],
    ['rejected', { statut: 'actif', verification_status: 'REJECTED' }],
  ])('refuses a structure that is %s', async (_label, st) => {
    const out = await authorizePlatformInvitation({ dbh: fakeDb({ structure: { id: 's1', nom: 'x', ...st } }), actor: actor(), target: 's1', role: 'STRUCTURE_ADMIN' });
    expect(out).toMatchObject({ ok: false, status: 409, body: { code: C.NOT_ELIGIBLE } });
  });
});

describe('Release A / G-2 — professional notices follow the « pro » surface', () => {
  it('classifies the routes', () => {
    expect(surfaceOf('pro/notifications')).toBe('pro');
    expect(surfaceOf('pro/notifications/unread-count')).toBe('pro');
    expect(surfaceOf('pro/messages')).toBe('communications');
    expect(SURFACES.communications).not.toContain('pro/notifications');
    expect(capabilitiesOfRoute('pro/notifications')).toEqual(['pro.account']);
    expect(capabilitiesOfRoute('pro/notifications/unread-count')).toEqual(['pro.account']);
  });

  it('opens with « pro » alone, without « communications »; stays closed otherwise', () => {
    const env = (open) => ({ ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: open });
    for (const [method, p] of [['GET', 'pro/notifications'], ['PATCH', 'pro/notifications'], ['GET', 'pro/notifications/unread-count']]) {
      expect(isAllowedInPublicBeta(method, p, env('pro'))).toBe(true);
      expect(isAllowedInPublicBeta(method, p, env('communications'))).toBe(false);
      expect(isAllowedInPublicBeta(method, p, env(''))).toBe(false);
    }
    // messaging is NOT opened by « pro »
    expect(isAllowedInPublicBeta('GET', 'pro/messages', env('pro'))).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'pro/messages', env('communications'))).toBe(true);
  });
});
