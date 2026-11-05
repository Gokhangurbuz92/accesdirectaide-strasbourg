/**
 * R46 (N02) — POST /api/monitor/sms-inbound/twilio: the provider's inbound-message webhook, so a « STOP » reply to a reminder SMS is honoured.
 *   It sits under /monitor/ because that prefix is the one the byte-pinned CSRF middleware already exempts for server-to-server calls (as the Mailjet
 *   event webhook, api/_handlers/monitor/mail-events-mailjet.js). Off unless SMS_INBOUND_URL (the exact https address given to the provider, i.e.
 *   https://<host>/api/monitor/sms-inbound/twilio) and TWILIO_AUTH_TOKEN are set: otherwise 404. Every request must carry a valid X-Twilio-Signature
 *   over that address and the posted fields (api/lib/sms-policy.js verifyTwilioSignature): otherwise 403 and nothing changes. The message text is never
 *   stored or logged. Logic: api/_services/sms-stop.js.
 */
import { handleInboundStop } from '../../_services/sms-stop.js';

/** @param {any} req @param {any} res */
export default function handler(req, res) {
  return handleInboundStop(req, res);
}
