// @ts-nocheck
/**
 * R46 / N03 — in-app notifications of a citizen account (« Notifications » in Mon Espace).
 *
 * Without a new migration (Production DB at 0042) the centre is DERIVED from the account's own records — nothing is copied into a second store:
 *   APPOINTMENT_<kind>          AppointmentNotice rows addressed to the citizen, for the account's appointments          (citizen.booking)
 *   MESSAGE_FROM_STRUCTURE      the latest structure message of each appointment conversation                              (citizen.booking_message)
 *   DOSSIER_MESSAGE             the latest organisation message of each thread of a dossier the account owns              (citizen.shared_dossier)
 *   PARCOURS_DEADLINE_SOON      a sourced Mon Parcours deadline in the next 7 days, item still open                       (citizen.parcours)
 *   DOCUMENT_EXPIRING           a Mon Coffre document whose expiry date is in the next 30 days                            (citizen.vault)
 *   GUARDIAN_REQUEST            a minor's guardian-link request waiting for this account's answer                          (citizen.guardians)
 * Minimisation: an item carries a kind, a time, an in-app link and an opaque id — never a message body, a name, an organisation, an e-mail or a title
 * (the person opens the link to see the content, under that page's own authorisation). A part whose capability is closed is neither read nor returned.
 * Read state: one « seen up to » instant per account, kept in the NotificationPreference row (channel « inapp », category « seen ») — that row is never a
 * preference (getPreferences reads only the CHANNELS × CATEGORIES pairs); a dedicated column/table is the clean schema when a migration is allowed.
 */
import crypto from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { NotificationPreference } from '../../src/db/schema.js';
import { capabilityOpen } from '../_utils/capabilities.js';

export const INBOX_LIMIT = 50;
export const APPOINTMENT_KINDS = ['BOOKED_BY_STRUCTURE', 'CANCELLED_BY_STRUCTURE', 'RESCHEDULED', 'REMINDER_J1', 'VISIO_APPROVED', 'VISIO_REVOKED', 'REQUEST_ACCEPTED', 'REQUEST_REFUSED', 'BOOKED_BY_CITIZEN', 'REQUEST_RECEIVED'];
export const INBOX_KINDS = [...APPOINTMENT_KINDS.map((k) => `APPOINTMENT_${k}`), 'MESSAGE_FROM_STRUCTURE', 'DOSSIER_MESSAGE', 'PARCOURS_DEADLINE_SOON', 'DOCUMENT_EXPIRING', 'GUARDIAN_REQUEST'];
const SEEN = { channel: 'inapp', category: 'seen' };
const opaque = (userId, kind, ref) => crypto.createHash('sha256').update(`${userId}\n${kind}\n${ref}`).digest('hex').slice(0, 24);
const rows = async (db, q) => (await db.execute(q)).rows;

/** @param {string} userId @param {any} [db] @param {{ isOpen?: (c: string) => boolean, now?: Date }} [opts] */
export async function listInbox(userId, db = defaultDb, opts = {}) {
  const isOpen = opts.isOpen || ((c) => capabilityOpen(c));
  const now = opts.now || new Date();
  /** @type {{ ref: string, kind: string, at: Date, link: string }[]} */
  const items = [];
  if (isOpen('citizen.booking')) {
    for (const r of await rows(db, sql`SELECT n.id, n.kind, n."createdAt" AS at FROM "AppointmentNotice" n JOIN "ProAppointment" a ON a.id = n."appointmentId"
        WHERE a."citizenUserId" = ${userId} AND n.recipient = 'citizen' ORDER BY n."createdAt" DESC LIMIT ${INBOX_LIMIT}`)) {
      if (APPOINTMENT_KINDS.includes(r.kind)) items.push({ ref: `n:${r.id}`, kind: `APPOINTMENT_${r.kind}`, at: r.at, link: '/compte/rendez-vous' });
    }
  }
  if (isOpen('citizen.booking_message')) {
    for (const r of await rows(db, sql`SELECT c.id AS cid, max(m."createdAt") AS at FROM "RdvConversation" c JOIN "RdvConversationMessage" m ON m."conversationId" = c.id
        WHERE c."citizenUserId" = ${userId} AND m."senderType" <> 'USER' GROUP BY c.id ORDER BY at DESC LIMIT ${INBOX_LIMIT}`)) {
      items.push({ ref: `c:${r.cid}:${new Date(r.at).getTime()}`, kind: 'MESSAGE_FROM_STRUCTURE', at: r.at, link: `/compte/messages/${encodeURIComponent(r.cid)}` });
    }
  }
  if (isOpen('citizen.shared_dossier')) {
    for (const r of await rows(db, sql`SELECT s.id AS sid, t.id AS tid, max(m."createdAt") AS at FROM "SharedDiagnostic" s JOIN "SharedDossierThread" t ON t."sharedDiagnosticId" = s.id
        JOIN "SharedDossierMessage" m ON m."threadId" = t.id WHERE s."ownerCitizenId" = ${userId} AND m."senderType" = 'PRO' GROUP BY s.id, t.id ORDER BY at DESC LIMIT ${INBOX_LIMIT}`)) {
      items.push({ ref: `t:${r.tid}:${new Date(r.at).getTime()}`, kind: 'DOSSIER_MESSAGE', at: r.at, link: `/compte/partages/${encodeURIComponent(r.sid)}` });
    }
  }
  if (isOpen('citizen.parcours')) {
    for (const r of await rows(db, sql`SELECT id, "dueDate" AS due FROM "ParcoursItem" WHERE "userId" = ${userId} AND "dueDate" IS NOT NULL AND "dueSourceUrl" IS NOT NULL
        AND "dueDate" > ${now} AND "dueDate" <= ${new Date(now.getTime() + 7 * 864e5)} AND status NOT IN ('CLOSED', 'DECISION_POSITIVE', 'DECISION_NEGATIVE') LIMIT ${INBOX_LIMIT}`)) {
      // the item appears once the 7-day window opens: its time is the window's start
      items.push({ ref: `p:${r.id}:${new Date(r.due).getTime()}`, kind: 'PARCOURS_DEADLINE_SOON', at: new Date(new Date(r.due).getTime() - 7 * 864e5), link: '/compte/parcours' });
    }
  }
  if (isOpen('citizen.vault')) {
    for (const r of await rows(db, sql`SELECT id, "expiresAt" AS exp FROM "CitizenDocument" WHERE "userId" = ${userId} AND "expiresAt" IS NOT NULL
        AND "expiresAt" > ${now} AND "expiresAt" <= ${new Date(now.getTime() + 30 * 864e5)} LIMIT ${INBOX_LIMIT}`)) {
      items.push({ ref: `d:${r.id}:${new Date(r.exp).getTime()}`, kind: 'DOCUMENT_EXPIRING', at: new Date(new Date(r.exp).getTime() - 30 * 864e5), link: '/compte/coffre' });
    }
  }
  if (isOpen('citizen.guardians')) {
    for (const r of await rows(db, sql`SELECT id, "createdAt" AS at FROM "GuardianRelationship" WHERE "guardianId" = ${userId} AND status = 'DECLARED' LIMIT ${INBOX_LIMIT}`)) {
      items.push({ ref: `g:${r.id}`, kind: 'GUARDIAN_REQUEST', at: r.at, link: '/compte/profil' });
    }
  }
  const seenAt = await seenUpTo(userId, db);
  const list = items.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, INBOX_LIMIT)
    .map((i) => ({ id: opaque(userId, i.kind, i.ref), kind: i.kind, at: new Date(i.at).toISOString(), link: i.link, unread: !seenAt || new Date(i.at) > seenAt }));
  return { ok: true, status: 200, notifications: list, unread: list.filter((i) => i.unread).length, seenAt: seenAt ? seenAt.toISOString() : null };
}

/** @returns {Promise<Date | null>} */
export async function seenUpTo(userId, db = defaultDb) {
  const [r] = await db.select({ at: NotificationPreference.updatedAt }).from(NotificationPreference)
    .where(and(eq(NotificationPreference.userId, userId), eq(NotificationPreference.channel, SEEN.channel), eq(NotificationPreference.category, SEEN.category))).limit(1);
  return r ? new Date(r.at) : null;
}

/** mark everything up to now as read */
export async function markAllRead(userId, db = defaultDb, now = new Date()) {
  await db.insert(NotificationPreference).values({ userId, ...SEEN, enabled: true, updatedAt: now })
    .onConflictDoUpdate({ target: [NotificationPreference.userId, NotificationPreference.channel, NotificationPreference.category], set: { updatedAt: now } });
  return { ok: true, status: 200, seenAt: now.toISOString() };
}
