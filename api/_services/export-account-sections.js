// @ts-nocheck
/**
 * A-14 (art. 15 completeness) — the account-keyed tables the personal-data export used to omit. Each section is MINIMISED: only the person's own rows, and
 * never a secret or an identifier that only serves the platform (push endpoint and its hash, encrypted subscription, token hashes, staff identities).
 *
 *   pushSubscriptions       PushSubscription        (userId)                       no endpoint, no endpointHash, no subscriptionEncrypted
 *   emailChangeRequests     EmailChangeRequest      (userId)                       the requested address (the person typed it), no tokenHash
 *   ownershipRecoveryCases  OwnershipRecoveryCase   (citizenUserId)                status and dates only: the address claimed in a recovery request is not proven to be
 *                                                                                  the person's until the case is approved (it may be a third party's), and the
 *                                                                                  evidence / decision notes and staff identities are the controller's own records
 *   parcoursReminders       ParcoursReminder        (itemId -> ParcoursItem.userId)
 *   appointmentNotices      AppointmentNotice       (appointmentId -> ProAppointment.citizenUserId), recipient 'citizen' only (a notice sent to the professional is not theirs)
 *   eventRegistrations      EventRegistration       (citizenUserId) X04: event, state, times, the accessibility need the person chose — only on a database with 0053
 *
 * EXPORT_SECTION_TABLES is the contract read by tests/unit/a14-export-covers-account-tables.test.js: a new table with a foreign key to CitizenUser must be
 * exported (here or in privacy.js) or the test fails.
 */
import { sql } from 'drizzle-orm';
import { openText } from '../lib/data-keys.js';

export const EXPORT_SECTION_TABLES = Object.freeze({
  pushSubscriptions: 'PushSubscription', emailChangeRequests: 'EmailChangeRequest', ownershipRecoveryCases: 'OwnershipRecoveryCase',
  parcoursReminders: 'ParcoursReminder', appointmentNotices: 'AppointmentNotice', eventRegistrations: 'EventRegistration',
});

/** columns that must never appear in these sections */
export const EXPORT_FORBIDDEN_FIELDS = Object.freeze(['endpoint', 'endpointHash', 'subscriptionEncrypted', 'tokenHash', 'newEmailEncrypted', 'evidenceNote', 'decisionNote', 'proposedBy', 'decidedBy']);

/**
 * @param {string} userId
 * @param {(query: import('drizzle-orm').SQL) => Promise<any[]>} rows reads rows and counts a failed read (privacy.js safeRows)
 * @param {{ open?: (id: string, sealed: string) => string, hasEventTables?: () => Promise<boolean> }} [deps] hasEventTables: migration 0053 present (X04)
 */
export async function accountLinkedSections(userId, rows, deps = {}) {
  const open = deps.open || ((id, sealed) => openText(sealed, { purpose: 'email-change', context: `email-change:${id}` }));
  const pushSubscriptions = await rows(sql`SELECT id, "pushHost", status, "failureCount", "lastSuccessAt", "lastFailureAt", "createdAt" FROM "PushSubscription" WHERE "userId" = ${userId} ORDER BY "createdAt"`);
  const emailChangeRequests = (await rows(sql`SELECT id, "newEmailEncrypted" AS enc, "createdAt", "expiresAt", "usedAt" FROM "EmailChangeRequest" WHERE "userId" = ${userId} ORDER BY "createdAt"`))
    .map((r) => ({ id: r.id, requestedEmail: (() => { try { return String(open(r.id, r.enc) || '') || null; } catch { return null; } })(), createdAt: r.createdAt, expiresAt: r.expiresAt, usedAt: r.usedAt }));
  const ownershipRecoveryCases = await rows(sql`SELECT id, status, "proposedAt", "decidedAt" FROM "OwnershipRecoveryCase" WHERE "citizenUserId" = ${userId} ORDER BY "proposedAt"`);
  const parcoursReminders = await rows(sql`SELECT r."itemId", r.threshold, r.channel, r.status, r."createdAt" FROM "ParcoursReminder" r JOIN "ParcoursItem" i ON i.id = r."itemId" WHERE i."userId" = ${userId} ORDER BY r."createdAt"`);
  const appointmentNotices = await rows(sql`SELECT n.id, n."appointmentId", n.kind, n.channel, n.status, n."createdAt" FROM "AppointmentNotice" n JOIN "ProAppointment" a ON a.id = n."appointmentId"
    WHERE a."citizenUserId" = ${userId} AND n.recipient = 'citizen' ORDER BY n."createdAt"`);
  // X04: a database without 0053 has no registration (not a failed read: the export stays complete)
  const events = await import('./academy-events.js');
  const hasEventTables = deps.hasEventTables || (() => events.academySchemaAvailable());
  const eventRegistrations = (await hasEventTables()) ? await rows(events.eventRegistrationsExportSql(userId)) : [];
  return { pushSubscriptions, emailChangeRequests, ownershipRecoveryCases, parcoursReminders, appointmentNotices, eventRegistrations };
}
