import { citizenHandler } from '../../_utils/citizen-handler.js';
import { setPhone } from '../../_services/email-change.js';

/** PUT /api/citizen/phone { phone | null } — change or remove the phone number (launch-readiness item 66); a new number is not verified. */
export default citizenHandler('phone', ['PUT'], async (/** @type {{ id: string }} */ citizen, /** @type {any} */ req) => setPhone(citizen.id, req.body || {}));
