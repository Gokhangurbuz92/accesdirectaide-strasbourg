/**
 * R45 (ENG-LR-2, D2 P5s [PROPOSITION]) — the explicit art. 9(2)(a) consent of a booking with a verified SENSITIVE service, used only while the gate
 * sensitiveBookingOpen() is open (api/lib/service-sensitivity.js; closed in Production). One append-only ConsentLog row per decision: purpose
 * SENSITIVE_SERVICE_BOOKING_ART9, subject = the account, the appointment id in policy_hash (0042: no appointment column, no migration), the wording version.
 * No diagnosis, no free text, never the service name or category. Withdrawal (D2 P5s rubric 12: « retrait = annulation »): a decision false row, then the
 * upcoming active appointment is cancelled through the ordinary cancellation route.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { ConsentLog } from '../../src/db/schema.js';
import { SENSITIVE_BOOKING_CONSENT_PURPOSE as PURPOSE, SENSITIVE_BOOKING_CONSENT_VERSION as VERSION } from '../lib/service-sensitivity.js';

const hashOf = (/** @type {string} */ appointmentId) => `${VERSION}:${PURPOSE}:${appointmentId}`;
const appointmentOf = (/** @type {string} */ hash) => String(hash || '').split(':').slice(2).join(':');

/** @param {string} userId @param {string} appointmentId @param {boolean} decision @param {any} [dbh] @param {string} [channel] */
export async function recordSensitiveConsent(userId, appointmentId, decision, dbh = defaultDb, channel = 'booking') {
  await dbh.insert(ConsentLog).values({
    subject_type: 'CITIZEN_USER', subject_id: String(userId), purpose: PURPOSE, decision: decision === true, policy_version: VERSION,
    policy_hash: hashOf(appointmentId), collection_channel: channel, guardian_involved: false, proof_level: 'EXPLICIT_CHECKBOX',
    ...(decision === true ? {} : { withdrawn_at: new Date() }),
  });
}

/**
 * The appointments of this account whose latest sensitive-booking decision is a consent (a Set of appointment ids).
 * @param {string} userId @param {string[]} appointmentIds @param {any} [dbh] @returns {Promise<Set<string>>}
 */
export async function activeSensitiveConsents(userId, appointmentIds, dbh = defaultDb) {
  if (!appointmentIds.length) return new Set();
  const rows = await dbh.select({ hash: ConsentLog.policy_hash, decision: ConsentLog.decision, at: ConsentLog.created_at }).from(ConsentLog)
    .where(and(eq(ConsentLog.subject_type, 'CITIZEN_USER'), eq(ConsentLog.subject_id, String(userId)), eq(ConsentLog.purpose, PURPOSE)))
    .orderBy(desc(ConsentLog.created_at)).limit(500);
  const wanted = new Set(appointmentIds); const latest = new Map();
  for (const r of rows) { const id = appointmentOf(r.hash); if (wanted.has(id) && !latest.has(id)) latest.set(id, r.decision === true); }
  return new Set([...latest].filter(([, v]) => v).map(([id]) => id));
}

/** @param {string} userId @param {string} appointmentId @param {any} [dbh] */
export async function hasActiveSensitiveConsent(userId, appointmentId, dbh = defaultDb) {
  return (await activeSensitiveConsents(userId, [appointmentId], dbh)).has(appointmentId);
}

