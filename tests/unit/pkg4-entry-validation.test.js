/**
 * PKG-4 — the real API entry (api/index.js) validates POST/PUT/PATCH/DELETE bodies with validation-registry BEFORE the handler. DTA-B31 found that the pro/team schema
 * demanded { targetUserId, role } for every method, so the team screen's "désactiver" (DELETE ?userId=, no body) and "réactiver" (PATCH { reactivate }) were refused 400
 * in production while handler-level tests passed. These are the exact bodies the screens send.
 */
import { describe, expect, it } from 'vitest';
import { validationRegistry } from '../../api/_utils/validation-registry.js';

const ok = (path, body) => validationRegistry[path].safeParse(body).success;

describe('PKG-4 entry validation accepts what the screens send', () => {
  it('pro/team: departure (no body), reactivation, role change', () => {
    expect(ok('pro/team', {})).toBe(true);
    expect(ok('pro/team', { targetUserId: 'u1', reactivate: true })).toBe(true);
    expect(ok('pro/team', { targetUserId: 'u1', role: 'PRO' })).toBe(true);
    expect(ok('pro/team', { targetUserId: 'x'.repeat(500) })).toBe(false);
  });
  it('pro/structure: propose (text or INSEE list) and withdraw; anything else refused', () => {
    expect(ok('pro/structure', { action: 'propose', field: 'horaires', value: 'Lundi 9h-12h' })).toBe(true);
    expect(ok('pro/structure', { action: 'propose', field: 'service_area', value: ['67482', '67218'] })).toBe(true);
    expect(ok('pro/structure', { action: 'withdraw', id: 'p1' })).toBe(true);
    expect(ok('pro/structure', { summary_falc: 'x', is_pro_enabled: true })).toBe(false);
    expect(ok('pro/structure', { action: 'publish', field: 'horaires', value: 'x' })).toBe(false);
  });
  it('the PKG-4 case / referral endpoints are validated by their services (no registry schema shadows their actions)', () => {
    for (const p of ['pro/cases', 'pro/referrals', 'citizen/referrals', 'admin/structure-proposals']) {
      if (validationRegistry[p]) expect(ok(p, { action: 'note', id: 'c1', visibility: 'INTERNAL', body: 'x' }) || ok(p, { id: 'r1', decision: 'accept' }), p).toBe(true);
    }
  });
});
