/**
 * RETIRED — public/appointments/create.js (legacy « System A » anonymous booking: { structureId, startAt, email, name } → an appointment without account).
 *
 * R42 (owner decision DEC-R42-01, 04/11/2026): « There shall be no public account-free booking capability. » This legacy adapter is not routed
 * (api/routes.js has no public/appointments entry) and, should anything ever import it again, it refuses every request with 410 ACCOUNT_REQUIRED
 * before reading the body or the database. Booking is the account-based POST /api/rdv/appointments (api/_handlers/rdv.js).
 * booking governed by StructureRdvSettings.isPublished — and by a signed-in, verified citizen account (requireCitizenUser).
 */
import { GUEST_BOOKING_RETIRED } from '../../../_services/rdv-guest.js';

/**
 * @param {import('../../../_utils/http-types').ApiRequest} _req
 * @param {import('../../../_utils/http-types').ApiResponse} res
 */
export default async function handler(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json(GUEST_BOOKING_RETIRED);
}
