/** R47 — the FranceConnect status line is not refused by the citizen.franceconnect gate (the handler answers available:false itself); every other FranceConnect route still is. */
import { describe, expect, it } from 'vitest';
import { capabilitiesOfRoute, closedCapabilityOfRoute } from '../../api/_utils/capabilities.js';

const ENFORCED = { ADA_CAPABILITY_ENFORCEMENT: '1', ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'accounts' };
describe('R47 FranceConnect status gate', () => {
  it('status needs only the account capability; start / callback / unlink need citizen.franceconnect', () => {
    expect(capabilitiesOfRoute('auth/franceconnect/status')).toEqual(['citizen.account']);
    for (const p of ['auth/franceconnect/start', 'auth/franceconnect/callback', 'auth/franceconnect/unlink']) expect(capabilitiesOfRoute(p)).toContain('citizen.franceconnect');
  });
  it('accounts open, FranceConnect closed: status passes the gate, start does not', () => {
    expect(closedCapabilityOfRoute('auth/franceconnect/status', ENFORCED)).toBeNull();
    expect(closedCapabilityOfRoute('auth/franceconnect/start', ENFORCED)).toBe('citizen.franceconnect');
  });
});
