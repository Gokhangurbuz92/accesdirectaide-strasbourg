// @ts-nocheck
/**
 * R46 / N03 — in-app notifications of a citizen account (« Notifications » in Mon Espace).
 *
 * Without a new migration (Production DB at 0042) the centre is DERIVED from the account's own records — nothing is copied into a second store:
 *   APPOINTMENT_<kind>          AppointmentNotice rows addressed to the citizen, for the account's appointments          (citizen.booking)
 *   MESSAGE_FROM_STRUCTURE      the latest structure message of each appointment conversation                              (citizen.booking_message)
 *   DOSSIER_MESSAGE             the latest organisation message of each thread of a dossier the account owns              (citizen.shared_dossier)
 *   PARCOURS_DEADLINE_SOON      a sourced Mon Parcours deadline in the next 7 days, item still open                       (citizen.parcours)
 *   PARCOURS_CLOSED_STEP_EXPIRING  G14: a closed step will be deleted within 30 days by the retention policy — ONLY where that purge step really
 *                               executes (stepWillExecute, api/_services/retention-policy.js), so no deletion is ever announced that will not happen
 *   DOCUMENT_EXPIRING           a Mon Coffre document whose expiry date is in the next 30 days                            (citizen.vault)
 *   GUARDIAN_REQUEST            a minor's guardian-link request waiting for this account's answer                          (citizen.guardians)
 *   REFERRAL_DECISION_NEEDED    E7: a referral proposal on a dossier the account owns, waiting for the person's consent    (citizen.orientation_records)
 *   REFERRAL_ANSWER             E7: the receiving organisation answered or moved a referral of such a dossier (acknowledged, accepted, declined — with or
 *                               without a suggestion —, asked for information, started, completed): one item per ReferralEvent by the RECEIVER
 *   REFERRAL_ENDED              E7: the sender cancelled a referral, or it expired without an answer (ReferralEvent by SENDER / SYSTEM)
 *   EVENT_REMINDER              X04: an event the person registered to starts within 48 hours                                (community.events)
 *   EVENT_CANCELLED             X04: the organizer cancelled an event the person is registered to (api/_services/academy-events.js)
 *   Before E7 the answer of a referral reached the person only by e-mail (when service e-mails are consented AND a provider delivers) or by opening the
 *   orientations page: with e-mails off — or MAILER_PROVIDER=noop — nothing in Mon Espace said that an answer or a consent request was waiting.
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
import { RETENTION_POLICY, stepWillExecute } from './retention-policy.js';

export const INBOX_LIMIT = 50;
export const APPOINTMENT_KINDS = ['BOOKED_BY_STRUCTURE', 'CANCELLED_BY_STRUCTURE', 'RESCHEDULED', 'REMINDER_J1', 'VISIO_APPROVED', 'VISIO_REVOKED', 'REQUEST_ACCEPTED', 'REQUEST_REFUSED', 'BOOKED_BY_CITIZEN', 'REQUEST_RECEIVED'];
export const INBOX_KINDS = [...APPOINTMENT_KINDS.map((k) => `APPOINTMENT_${k}`), 'MESSAGE_FROM_STRUCTURE', 'DOSSIER_MESSAGE', 'PARCOURS_DEADLINE_SOON', 'PARCOURS_CLOSED_STEP_EXPIRING', 'DOCUMENT_EXPIRING', 'GUARDIAN_REQUEST',
  'REFERRAL_DECISION_NEEDED', 'REFERRAL_ANSWER', 'REFERRAL_ENDED', 'EVENT_REMINDER', 'EVENT_CANCELLED'];
/** E7: the referral transitions the person is told about in the centre (ReferralEvent, append-only), by who made them */
export const REFERRAL_ANSWER_STATUSES = Object.freeze(['ACKNOWLEDGED', 'NEEDS_INFO', 'ACCEPTED', 'DECLINED', 'IN_PROGRESS', 'COMPLETED']);
export const REFERRAL_ENDED_STATUSES = Object.freeze(['CANCELLED', 'EXPIRED']);
const REFERRALS_LINK = '/compte/orientations';
const SEEN = { channel: 'inapp', category: 'seen' };
const opaque = (userId, kind, ref) => crypto.createHash('sha256').update(`${userId}\n${kind}\n${ref}`).digest('hex').slice(0, 24);
const rows = async (db, q) => (await db.execute(q)).rows;

/** @param {string} userId @param {any} [db] @param {{ isOpen?: (c: string) => boolean, now?: Date, policy?: any, env?: Record<string, string | undefined> }} [opts] */
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
    // G14: 30 days before a closed step reaches the retention duration — only where the purge step really executes here (duration decided, step recorded in
    // the policy, purge enabled and pinned, step listed): a deletion is never announced that will not happen. The person can export meanwhile.
    const policy = opts.policy || RETENTION_POLICY;
    const keep = policy.durations?.PARCOURS_CLOSED_STEP_DAYS;
    if (keep && Number.isInteger(keep.days) && keep.days > 30 && stepWillExecute(policy, opts.env || process.env, { id: 'parcoursClosedStepsDeleted', durationKey: 'PARCOURS_CLOSED_STEP_DAYS' })) {
      const cut = new Date(now.getTime() - (keep.days - 30) * 864e5);
      for (const r of await rows(db, sql`SELECT i.id, COALESCE((SELECT max(e."createdAt") FROM "ParcoursEvent" e WHERE e."itemId" = i.id AND e.kind = 'STATUS'), i."updatedAt") AS closed
          FROM "ParcoursItem" i WHERE i."userId" = ${userId} AND i.status IN ('CLOSED', 'DECISION_POSITIVE', 'DECISION_NEGATIVE')
          AND COALESCE((SELECT max(e."createdAt") FROM "ParcoursEvent" e WHERE e."itemId" = i.id AND e.kind = 'STATUS'), i."updatedAt") < ${cut} LIMIT ${INBOX_LIMIT}`)) {
        items.push({ ref: `pc:${r.id}`, kind: 'PARCOURS_CLOSED_STEP_EXPIRING', at: new Date(new Date(r.closed).getTime() + (keep.days - 30) * 864e5), link: '/compte/parcours' });
      }
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
  if (isOpen('citizen.orientation_records')) {
    // a proposal waits for the person while it is PENDING_CITIZEN on a dossier they own that has not expired; it leaves the centre once answered
    for (const r of await rows(db, sql`SELECT r.id, r."createdAt" AS at FROM "Referral" r JOIN "SharedDiagnostic" d ON d.id = r."sharedDiagnosticId"
        WHERE d."ownerCitizenId" = ${userId} AND d."expiresAt" > ${now} AND r.status = 'PENDING_CITIZEN' ORDER BY r."createdAt" DESC LIMIT ${INBOX_LIMIT}`)) {
      items.push({ ref: `rp:${r.id}`, kind: 'REFERRAL_DECISION_NEEDED', at: r.at, link: REFERRALS_LINK });
    }
    // what the organisations did: the append-only events of the dossiers the person owns (the person's own decisions are not news to them)
    for (const r of await rows(db, sql`SELECT e.id, e."actorType" AS actor, e."toStatus" AS status, e."createdAt" AS at FROM "ReferralEvent" e
        JOIN "Referral" r ON r.id = e."referralId" JOIN "SharedDiagnostic" d ON d.id = r."sharedDiagnosticId"
        WHERE d."ownerCitizenId" = ${userId} AND ((e."actorType" = 'RECEIVER' AND e."toStatus" IN (${sql.join(REFERRAL_ANSWER_STATUSES.map((x) => sql`${x}`), sql`, `)}))
          OR (e."actorType" IN ('SENDER', 'SYSTEM') AND e."toStatus" IN (${sql.join(REFERRAL_ENDED_STATUSES.map((x) => sql`${x}`), sql`, `)})))
        ORDER BY e."createdAt" DESC LIMIT ${INBOX_LIMIT}`)) {
      items.push({ ref: `re:${r.id}`, kind: r.actor === 'RECEIVER' ? 'REFERRAL_ANSWER' : 'REFERRAL_ENDED', at: r.at, link: REFERRALS_LINK });
    }
  }
  if (isOpen('community.events')) {
    // X04 (expansion): derived from the person's own registrations — kind, time, link; never the event's title, place or the accessibility need
    const { eventInboxItems } = await import('./academy-events.js');
    items.push(...await eventInboxItems(userId, { db, now, limit: INBOX_LIMIT }));
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
