// @ts-nocheck
/**
 * PKG-11 / N02 — the STOP reply handler, kept as a SERVICE until it is routed (intended route POST /api/public/sms-inbound; see INBOUND_STOP_ROUTED in
 * api/lib/sms-policy.js: routing needs a reviewed exemption from the byte-pinned CSRF router code, and an unrouted file under api/_handlers is an undocumented
 * orphan). A reply « STOP » to a reminder SMS ends the SMS reminders of that number.
 *  - OFF unless the owner configures it (SMS_INBOUND_URL = the exact https address given to the provider, TWILIO_AUTH_TOKEN): otherwise 404;
 *  - every request must carry a valid provider signature (X-Twilio-Signature over that address and the posted fields): otherwise 403, nothing changes;
 *  - a STOP keyword withdraws the SMS reminder consent of every account whose appointments carry that number (preference off + a « no » in the
 *    append-only consent ledger) and forgets the number on those appointments; any other text is ignored; the message text is never stored or logged;
 *  - the answer is an empty TwiML document (no SMS is sent back by the platform).
 */
import { inArray, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { NotificationPreference, ProAppointment } from '../../src/db/schema.js';
import logger from '../_utils/logger.js';
import { appendConsent, purposeOf } from './citizen-account.js';
import { inboundStopConfigured, isStopKeyword, normalizeFrenchPhone, verifyTwilioSignature } from '../lib/sms-policy.js';

const TWIML_EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const twiml = (res) => { res.setHeader('Content-Type', 'text/xml; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); return res.status(200).send(TWIML_EMPTY); };
const formOf = (body) => (typeof body === 'string' ? Object.fromEntries(new URLSearchParams(body)) : body && typeof body === 'object' ? { ...body } : {});

/** Withdraw SMS reminders for `phone` (+33…): returns how many accounts and appointments were changed. */
export async function stopSmsForNumber(phone, db = defaultDb) {
  const last9 = phone.slice(-9);
  const rows = (await db.execute(sql`SELECT id, "citizenUserId" AS cid FROM "ProAppointment"
    WHERE "beneficiaryPhone" IS NOT NULL AND right(regexp_replace("beneficiaryPhone", '[^0-9]', '', 'g'), 9) = ${last9}`)).rows
    .filter((r) => r.id);
  const accounts = [...new Set(rows.map((r) => r.cid).filter(Boolean))];
  await db.transaction(async (tx) => {   // all or nothing: a provider retry finishes the job
    for (const userId of accounts) {
      await tx.insert(NotificationPreference).values({ userId, channel: 'sms', category: 'reminder', enabled: false })
        .onConflictDoUpdate({ target: [NotificationPreference.userId, NotificationPreference.channel, NotificationPreference.category], set: { enabled: false, updatedAt: new Date() } });
      await appendConsent({ userId, purpose: purposeOf('sms', 'reminder'), decision: false, channel: 'sms_reply_stop', proofLevel: 'PROVIDER_SIGNED_REPLY' }, tx);
    }
    if (rows.length) await tx.update(ProAppointment).set({ beneficiaryPhone: null }).where(inArray(ProAppointment.id, rows.map((r) => r.id)));
  });
  return { accounts: accounts.length, appointments: rows.length };
}

export async function handleInboundStop(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res, deps = {}) {
  const env = deps.env || process.env;
  if (!inboundStopConfigured(env)) return res.status(404).json({ error: 'Not found' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const params = formOf(req.body);
  const signature = req.headers?.['x-twilio-signature'] || req.headers?.['X-Twilio-Signature'];
  if (!verifyTwilioSignature({ authToken: env.TWILIO_AUTH_TOKEN, url: env.SMS_INBOUND_URL, params, signature })) {
    logger.warn({ msg: 'sms.inbound.bad_signature' });
    return res.status(403).json({ error: 'Forbidden' });
  }
  const phone = normalizeFrenchPhone(params.From);
  if (!phone || !isStopKeyword(params.Body)) return twiml(res);   // not a STOP from a French number: ignored, nothing stored
  try {
    const out = await stopSmsForNumber(phone, deps.db || defaultDb);
    logger.info({ msg: 'sms.inbound.stop', accounts: out.accounts, appointments: out.appointments });
    return twiml(res);
  } catch (err) {
    logger.error({ msg: 'sms.inbound.error', name: err?.name });
    return res.status(500).json({ error: 'Erreur interne du serveur' });   // the provider retries; nothing was half-applied that a retry would not finish
  }
}
