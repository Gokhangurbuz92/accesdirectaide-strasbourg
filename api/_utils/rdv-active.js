// @ts-nocheck
/**
 * R38 — the ONE « still active » rule of an appointment (does it block its slot?), shared by availability, the booking overlap re-checks, the professional
 * booking and the reschedule. An appointment is active when its status is one of ACTIVE_APPOINTMENT_STATUSES, EXCEPT an account-free hold that was never
 * confirmed and whose short expiry has passed: status 'requested' with guestHoldExpiresAt <= now. A confirmed guest booking has guestHoldExpiresAt NULL
 * (cleared at confirmation), so it blocks like any other. The comparison binds `now` through the column (drizzle encoder), never a raw SQL timestamp.
 */
import { and, gt, inArray, isNull, ne, or } from 'drizzle-orm';
import { ACTIVE_APPOINTMENT_STATUSES } from './pro-rdv.js';

/** @param {{ status?: string, guestHoldExpiresAt?: Date | string | null }} row @param {Date} [now] */
export function isAppointmentActive(row, now = new Date()) {
  const status = String(row?.status || '');
  if (!ACTIVE_APPOINTMENT_STATUSES.includes(status)) return false;
  if (status === 'requested' && row?.guestHoldExpiresAt) return new Date(row.guestHoldExpiresAt).getTime() > now.getTime();
  return true;
}

/** the same rule as a drizzle condition on the ProAppointment table @param {any} t the ProAppointment table (or the query-builder alias) @param {Date} [now] */
export function activeAppointmentWhere(t, now = new Date()) {
  return and(
    inArray(t.status, ACTIVE_APPOINTMENT_STATUSES),
    or(ne(t.status, 'requested'), isNull(t.guestHoldExpiresAt), gt(t.guestHoldExpiresAt, now)),
  );
}
