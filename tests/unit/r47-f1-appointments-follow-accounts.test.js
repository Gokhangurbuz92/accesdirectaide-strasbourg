/**
 * R47 activation finding F1 — closing « accounts » (rollback) also stops the citizen side of « appointments » for sessions already open;
 * public slot reading and the professional side are unaffected.
 */
import { describe, expect, it } from 'vitest';
import { citizenAppointmentNeedsAccounts, isAllowedInPublicBeta } from '../../api/_utils/public-beta.js';

const BETA = { ADA_PUBLIC_BETA_RESTRICTED: '1' };
describe('R47 F1', () => {
  it('classifies citizen appointment actions', () => {
    expect(citizenAppointmentNeedsAccounts('POST', 'rdv/appointments')).toBe(true);
    expect(citizenAppointmentNeedsAccounts('POST', 'rdv/appointments/a1/cancel')).toBe(true);
    expect(citizenAppointmentNeedsAccounts('GET', 'rdv/appointments')).toBe(true);
    expect(citizenAppointmentNeedsAccounts('GET', 'rdv/structures/s1/slots')).toBe(false);
    expect(citizenAppointmentNeedsAccounts('POST', 'pro/rdv/hours')).toBe(false);
  });
  it('appointments open + accounts closed: booking refused, slots readable; both open: booking allowed', () => {
    const appt = { ...BETA, ADA_BETA_OPEN_SURFACES: 'appointments' };
    expect(isAllowedInPublicBeta('POST', 'rdv/appointments', appt)).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'rdv/appointments', appt)).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'rdv/structures/s1/slots', appt)).toBe(true);
    const both = { ...BETA, ADA_BETA_OPEN_SURFACES: 'accounts,appointments' };
    expect(isAllowedInPublicBeta('POST', 'rdv/appointments', both)).toBe(true);
    expect(isAllowedInPublicBeta('POST', 'pro/rdv/hours', { ...BETA, ADA_BETA_OPEN_SURFACES: 'appointments' })).toBe(true);
  });
});
