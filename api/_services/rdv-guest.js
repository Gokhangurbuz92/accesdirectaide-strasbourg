// @ts-nocheck
/**
 * R38 — OPTIONAL account-free (« sans compte ») public booking, on the existing appointment engine (api/_handlers/rdv.js: same structure checks, same slot
 * generation in Europe/Paris, same bookSlot() under the in-process + advisory locks, same moveSlot()). Routed from rdv.js as rdv/guest/… (the « appointments »
 * surface of the public beta, api/_utils/public-beta.js — never in the public allowlist).
 *
 * Rules (owner, R38):
 *   - off unless ADA_GUEST_BOOKING_ENABLED=true (every endpoint answers 503 GUEST_BOOKING_DISABLED otherwise);
 *   - only for a published, VERIFIED structure whose administrator enabled StructureRdvSettings.allowGuestBooking, and only its services with guestBookable;
 *     in person only (no video without an account);
 *   - a hold is taken only when mail can really leave (getMailerStatus().deliverable, then the code mail's outcome must be PROVIDER_ACCEPTED or TEST_RECORDED,
 *     otherwise the hold is released and 503 GUEST_BOOKING_MAIL_UNAVAILABLE is answered);
 *   - hold = status 'requested' for 20 minutes with a 6-digit code e-mailed (HMAC stored, 5 attempts); confirm -> 'confirmed' (the engine has no manual
 *     validation mode: bookingMode is the modality), a manage token (only its hash stored, valid until the end of the appointment, for this one appointment);
 *   - manage: date, time, place, service only (no name, no phone, the e-mail masked); cancel; reschedule to another free slot of the same service.
 * R39:
 *   - an OPTIONAL J-1 reminder: a separate box, never pre-ticked, not required (hold body `reminderConsent: true`, stored as guestReminderConsentAt = now);
 *     the cron rdv-reminder sends it only with that consent (noticeCitizen: NO_CONSENT otherwise); the person turns it on / off from the personal link
 *     (POST rdv/guest/manage/reminder, same token check, rate limit and CSRF as cancel; an AuditLog entry without personal data);
 *   - one ACTIVE booking per structure and per address (an unexpired hold, or a confirmed booking not ended / not cancelled — the shared rule of
 *     api/_utils/rdv-active.js), without enumeration: a second request (another idempotency key) is answered exactly like a created hold, and the address
 *     is told by e-mail that a booking already exists.
 * R41-B: that answer is a DECOY hold — a real hold row without any personal data (api/_utils/rdv-guest-decoy.js), inserted under the same locks after the
 *   same slot checks, so it holds its slot (the slot leaves the public list, a second hold on it answers 409 SLOT_TAKEN), replays on a retry of the same
 *   request, counts wrong codes, locks, expires and is purged exactly like a real hold, from the database only (no KV state). It can never be confirmed, and
 *   it is shown or counted to nobody (no agenda, statistic, notice, reminder or « active booking » of any address).
 */
import crypto from 'node:crypto';
import { and, eq, gt, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import logger from '../_utils/logger.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { getMailerStatus, mailLedgerStatus, sendMail } from '../_utils/mailer.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../_utils/rateLimit.js';
import { validateDateRange } from '../_utils/pro-rdv.js';
import { buildAppUrl } from '../_utils/user-auth.js';
import { calendarAttachment, formatParis, noticeCitizen, noticeStructure, recordNotice } from '../_services/appointment-notices.js';
import { locationOf, locationText, offeredModes } from '../lib/appointment-modes.js';
import { publicVideoStatus } from '../lib/video-provider.js';
import { encrypt } from '../lib/crypto.js';
import {
  GUEST_CODE_MAX_ATTEMPTS, GUEST_HOLD_MINUTES, checkGuestCode, checkManageToken, guestBookingEnabled, guestCodeHash, guestEmailHash, holdExpired, holdExpiry,
  mailReallySent, maskEmail, newGuestCode, newManageToken, readGuestIdentity, readReminderConsent, sameDigest, manageTokenHash,
} from '../_utils/rdv-guest-core.js';
import { activeAppointmentWhere } from '../_utils/rdv-active.js';
import { GUEST_DECOY_NAME, guestDecoyLookupHash, isGuestDecoy, notGuestDecoy, unusableGuestCodeHash } from '../_utils/rdv-guest-decoy.js';
import {
  MAX_BOOKING_AHEAD_DAYS, MAX_RANGE_DAYS, MAX_RESCHEDULES, MIN_BOOKING_DELAY_MINUTES, RESCHEDULE_MIN_NOTICE_HOURS,
  bookSlot, bookingLockKeyOf, computePublicSlots, icsLocation, loadAppointmentWithRelations, loadStructureBySlug, moveSlot, rescheduleRefusal,
  withBookingCollisionLock, withLoadedRelations,
} from '../_handlers/rdv.js';

const MODE = 'IN_PERSON';
const NOT_FOUND = { error: 'RDV indisponible', code: 'GUEST_BOOKING_UNAVAILABLE' };
const MANAGE_NOT_FOUND = { error: 'Appointment not found', code: 'APPOINTMENT_NOT_FOUND' };
const SLOT_TAKEN = { error: 'Slot no longer available', code: 'SLOT_TAKEN', message: 'Ce créneau n’est plus libre. Choisissez-en un autre.' };
const MAIL_UNAVAILABLE = { error: 'GUEST_BOOKING_MAIL_UNAVAILABLE', code: 'GUEST_BOOKING_MAIL_UNAVAILABLE' };
const str = (v) => String(v ?? '').trim();
const utcDay = (d) => ({ from: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), to: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)) });
const iso = (d) => (d ? new Date(d).toISOString() : null);
const digest = (v) => crypto.createHash('sha256').update(String(v || ''), 'utf8').digest('hex').slice(0, 24);

async function limited(res, action, key) {
  const r = await checkRateLimit(action, key);
  if (r.allowed) return false;
  res.status(getRateLimitStatus(r)).json(r.error || { error: 'Too many requests' });
  return true;
}

/** a structure taking account-free bookings (published, VERIFIED, opted in), or null */
async function guestStructure(slug) {
  const structure = slug ? await loadStructureBySlug(slug) : null;
  return structure && structure.bookable && structure.allowGuestBooking ? structure : null;
}

const serviceColumns = { id: true, name: true, durationMinutes: true, bufferBeforeMinutes: true, bufferAfterMinutes: true, modes: true, guestBookable: true };
/** an active, guest-bookable service of the structure offered in person now, or null */
async function guestService(structure, serviceId) {
  if (!serviceId) return null;
  const service = await db.query.ProRdvService.findFirst({
    where: (s, { eq: e, and: a }) => a(e(s.id, serviceId), e(s.structureId, structure.id), e(s.isActive, true), e(s.guestBookable, true)),
    columns: serviceColumns,
  });
  return service && offeredModes(structure.bookingMode, service.modes, publicVideoStatus()).includes(MODE) ? service : null;
}

/** what the person may see of their booking: no name, no phone, no other person's data */
function guestView(a, extra = {}) {
  const startsAt = a.startAt ? new Date(a.startAt) : null; const now = Date.now();
  const status = String(a.status || '').toLowerCase();
  const active = ['requested', 'confirmed', 'booked'].includes(status);
  return {
    id: a.id,
    status: status.toUpperCase(),
    awaitingCode: status === 'requested' && Boolean(a.guestHoldExpiresAt),
    startsAt: iso(a.startAt),
    endsAt: iso(a.endAt),
    mode: MODE,
    location: locationOf(a.structure),
    structure: a.structure ? { slug: a.structure.slug, name: a.structure.nom } : null,
    service: a.service ? { id: a.service.id, name: a.service.name, durationMinutes: a.service.durationMinutes } : null,
    cancelledAt: iso(a.cancelledAt),
    canCancel: active && !a.guestHoldExpiresAt && startsAt !== null && startsAt.getTime() > now,
    canReschedule: active && !a.guestHoldExpiresAt && !rescheduleRefusal(a),
    // R38: why the move is not offered online (the page says it and points to the structure), never a silent missing button
    rescheduleBlocked: active && !a.guestHoldExpiresAt ? (rescheduleRefusal(a)?.code || null) : null,
    reschedule: startsAt ? { count: Number(a.rescheduleCount || 0), max: MAX_RESCHEDULES, until: new Date(startsAt.getTime() - RESCHEDULE_MIN_NOTICE_HOURS * 3_600_000).toISOString() } : null,
    // R39: the optional J-1 reminder (a yes / no only, never its date), and whether it can still be turned on from the personal link
    reminderConsent: Boolean(a.guestReminderConsentAt),
    reminderChangeable: active && !a.guestHoldExpiresAt && startsAt !== null && startsAt.getTime() > now,
    ...extra,
  };
}

function guestManageUrl(slug, appointmentId, token) {
  const url = new URL(buildAppUrl(`/rdv/${encodeURIComponent(slug)}/sans-compte/gerer?${new URLSearchParams({ appointment: appointmentId }).toString()}`));
  url.hash = new URLSearchParams({ manage: token }).toString();   // the capability travels in the fragment, then in a POST body only — never in a query string
  return url.toString();
}

async function openEmail(row) {
  const { decrypt, isV1Text } = await import('../lib/crypto.js');
  try { return isV1Text(row.guestEmail) ? decrypt(row.guestEmail) : null; } catch { return null; }
}

// ── GET rdv/guest/structures/:slug/services ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function services(req, res, slug) {
  if (await limited(res, 'RDV_GUEST_READ', getClientIp(req))) return undefined;
  const structure = await guestStructure(slug);
  if (!structure) return res.status(404).json(NOT_FOUND);
  const rows = await db.query.ProRdvService.findMany({
    where: (s, { eq: e, and: a }) => a(e(s.structureId, structure.id), e(s.isActive, true), e(s.guestBookable, true)),
    columns: serviceColumns, orderBy: (s, { asc }) => [asc(s.name)],
  });
  const video = publicVideoStatus();
  const items = rows.filter((s) => offeredModes(structure.bookingMode, s.modes, video).includes(MODE))
    .map((s) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes, modes: [MODE] }));
  return res.status(200).json({ structure: { slug: structure.slug, name: structure.nom, location: structure.location, modes: [MODE] }, holdMinutes: GUEST_HOLD_MINUTES, items });
}

// ── GET rdv/guest/structures/:slug/slots?serviceId&from&to ────────────────────────────────────────────────────────────────────────────────────────────────
async function slots(req, res, slug) {
  if (await limited(res, 'RDV_GUEST_READ', getClientIp(req))) return undefined;
  const structure = await guestStructure(slug);
  if (!structure) return res.status(404).json(NOT_FOUND);
  const service = await guestService(structure, str(req.query?.serviceId));
  if (!service) return res.status(404).json({ error: 'Service not found', code: 'SERVICE_NOT_FOUND' });
  const from = str(req.query?.from); const to = str(req.query?.to);
  let range;
  try {
    range = validateDateRange(/^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}T00:00:00.000Z` : from, /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to, MAX_RANGE_DAYS);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid date range' });
  }
  const { rules, slots: list } = await computePublicSlots(structure, service, MODE, range);
  return res.status(200).json({ timezone: rules[0]?.timezone || 'Europe/Paris', mode: MODE, service: { id: service.id, name: service.name, durationMinutes: service.durationMinutes },
    from: range.from.toISOString(), to: range.to.toISOString(), total: list.length, slots: list });
}

/** the requested start is a free slot of this service right now (the same regeneration as the citizen booking) */
async function isFreeSlot(structure, service, startAt, exceptId = null) {
  const now = new Date();
  if (startAt < new Date(now.getTime() + MIN_BOOKING_DELAY_MINUTES * 60_000) || startAt > new Date(now.getTime() + MAX_BOOKING_AHEAD_DAYS * 86_400_000)) return false;
  const endAt = new Date(startAt.getTime() + service.durationMinutes * 60_000);
  const { slots: list } = await computePublicSlots(structure, service, MODE, utcDay(startAt), { exceptId });
  return list.some((s) => s.startAt === startAt.toISOString() && s.endAt === endAt.toISOString());
}

/**
 * R39 — an ACTIVE account-free booking of this address with this structure other than this very request (its idempotency key): an unexpired hold, or a
 * confirmed booking that has not ended and is not cancelled (the shared « still active » rule). Only its id is read.
 */
async function otherActiveBooking(runner, structureId, emailHash, idempotencyKey) {
  const t = schema.ProAppointment; const now = new Date();
  const [row] = await runner.select({ id: t.id }).from(t).where(and(
    eq(t.structureId, structureId), eq(t.guestEmailHash, emailHash), isNull(t.citizenUserId), notGuestDecoy(t),
    activeAppointmentWhere(t, now), gt(t.endAt, now),
    or(isNull(t.idempotencyKey), ne(t.idempotencyKey, idempotencyKey)),
  )).limit(1);
  return row || null;
}

/**
 * R39 / R41-B — the answer to a second booking request of an address that already has an active booking with this structure, after the decoy row was
 * committed (see hold()): the same steps and the same answer as a created hold — one e-mail, then 202 with the hold body built from the decoy row by the
 * same function; when that e-mail did not really leave, the decoy is released like a real hold (cancelled: its slot is free again) and 503 is answered.
 * The e-mail goes to the address only: it says a booking exists and how to manage it.
 */
async function alreadyBooked({ structure, email }) {
  let out = null;
  try {
    out = await sendMail({
      to: email,
      subject: `Rendez-vous déjà en cours - ${structure.nom}`,
      text: [`Une demande de rendez-vous vient d'être faite avec votre adresse e-mail auprès de ${structure.nom}.`, '',
        'Un rendez-vous (ou une demande en cours) existe déjà avec cette structure pour cette adresse : aucun nouveau rendez-vous n\'a été réservé.',
        'Pour le déplacer ou l\'annuler, utilisez le lien personnel reçu dans l\'e-mail de confirmation de ce rendez-vous.',
        `Si vous venez de faire une demande sans saisir le code reçu, elle expire au bout de ${GUEST_HOLD_MINUTES} minutes : vous pourrez ensuite recommencer.`, '',
        "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message."].join('\n'),
      category: 'appointment_guest_already_booked',   // a « service » message about the person's own booking (never a reminder)
    });
  } catch { out = null; }
  logger.info({ structureId: structure.id, sent: mailReallySent(out) }, '[rdv-guest] second active booking refused (answered as a hold)');
  return mailReallySent(out);
}

/**
 * a hold whose e-mail did not really leave is released at once (nothing blocks the slot, nothing personal is kept); a decoy keeps its marker (it has nothing
 * personal) so that it stays invisible to the structure until the purge deletes it @param {string} id @param {boolean} decoy
 */
async function releaseHold(id, decoy) {
  const personal = decoy ? {} : { guestEmail: null, guestPhone: null, notes: null, beneficiaryName: '[non confirmé]' };
  await db.update(schema.ProAppointment).set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: 'SYSTEM_MAIL_FAILED', guestCodeHash: null, guestReminderConsentAt: null, ...personal })
    .where(eq(schema.ProAppointment.id, id));
}

// ── POST rdv/guest/hold ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function hold(req, res) {
  if (await limited(res, 'RDV_GUEST_WRITE', getClientIp(req))) return undefined;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const structureSlug = str(body.structureSlug); const serviceId = str(body.serviceId); const idempotencyKey = str(body.idempotencyKey);
  const startAt = new Date(str(body.startAt));
  if (!structureSlug || !serviceId || !idempotencyKey || idempotencyKey.length > 100 || Number.isNaN(startAt.getTime())) {
    return res.status(400).json({ error: 'structureSlug, serviceId, startAt and idempotencyKey are required', code: 'INVALID_REQUEST' });
  }
  const identity = readGuestIdentity(body);
  if (identity.error) return res.status(400).json({ error: identity.error.code, code: identity.error.code, field: identity.error.field });
  const reminderConsent = readReminderConsent(body);   // R39: optional, separate, never implied
  // mail truthfulness: no hold at all when nothing could deliver the code
  if (!getMailerStatus().deliverable) return res.status(503).json(MAIL_UNAVAILABLE);
  const emailHash = guestEmailHash(identity.value.email);
  if (await limited(res, 'RDV_GUEST_EMAIL', emailHash)) return undefined;

  const structure = await guestStructure(structureSlug);
  if (!structure) return res.status(404).json(NOT_FOUND);
  const service = await guestService(structure, serviceId);
  if (!service) return res.status(404).json({ error: 'Service not found', code: 'SERVICE_NOT_FOUND' });

  // R41-B: a retry of a request answered with a decoy finds that decoy through its per-request lookup value (never the address's blind index)
  const decoyHash = guestDecoyLookupHash(emailHash, structure.id, idempotencyKey);
  const findByKey = () => db.query.ProAppointment.findFirst({
    where: (a, { eq: e, and: x, isNull: n, inArray: within }) => x(e(a.structureId, structure.id), within(a.guestEmailHash, [emailHash, decoyHash]), e(a.idempotencyKey, idempotencyKey), n(a.citizenUserId)),
    orderBy: (a, { desc }) => [desc(a.createdAt)],
    with: { service: { columns: { id: true, name: true, durationMinutes: true } }, structure: { columns: { id: true, slug: true, nom: true, adresse: true, code_postal: true, ville: true, accessibilite_pmr: true } } },
  });
  // idempotent retry (same address + same key): the same hold (or the same decoy), no second e-mail
  const replyHold = (row, status = 200) => res.status(status).json({ hold: guestView(row, { expiresAt: iso(row.guestHoldExpiresAt) }), emailMasked: maskEmail(identity.value.email) });
  const before = await findByKey();
  if (before) return replyHold(before);

  if (!(await isFreeSlot(structure, service, startAt))) return res.status(409).json(SLOT_TAKEN);
  const endAt = new Date(startAt.getTime() + service.durationMinutes * 60_000);
  const id = crypto.randomUUID(); const code = newGuestCode(); const now = new Date();
  let outcome;
  try {
    outcome = await bookSlot({
      structure, service, startAt, endAt,
      replay: () => findByKey(),
      // R39: one active booking per structure and address — checked under the slot's day lock AND a lock of this address at this structure (two
      // requests of one address for two different days serialise here), after the slot checks; the same request (same key) was replayed above.
      // R41-B: refused -> the decoy hold is inserted instead, in this same transaction under the same locks (it takes the slot exactly like a real hold;
      // the unique index on structure + lookup value + key turns a concurrent retry into the same « duplicate » replay as for a real hold)
      guard: async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`guest-active:${structure.id}:${emailHash}`}, 0))`);
        const other = await otherActiveBooking(tx, structure.id, emailHash, idempotencyKey);
        if (!other) return null;
        const decoyId = crypto.randomUUID();
        const [decoy] = await tx.insert(schema.ProAppointment).values({
          id: decoyId, structureId: structure.id, serviceId: service.id, startAt, endAt, status: 'requested', mode: MODE, visioEnabled: false,
          beneficiaryName: GUEST_DECOY_NAME, notes: null, beneficiaryPhone: null, citizenUserId: null, citizenEmailSnapshot: null, idempotencyKey,
          guestEmail: null, guestEmailHash: decoyHash, guestPhone: null, guestMailConsentAt: null,
          guestHoldExpiresAt: holdExpiry(now), guestCodeHash: unusableGuestCodeHash(), guestCodeAttempts: 0,
          guestReminderConsentAt: reminderConsent ? now : null,   // only so that the answer shows the same yes / no as a real hold; never used (no reminder for a hold)
        }).returning();
        return { kind: 'already_booked', appointment: decoy };
      },
      values: {
        id, structureId: structure.id, serviceId: service.id, startAt, endAt, status: 'requested', mode: MODE, visioEnabled: false,
        beneficiaryName: encrypt(identity.value.name), notes: identity.value.note ? encrypt(identity.value.note) : null, beneficiaryPhone: null,
        citizenUserId: null, citizenEmailSnapshot: null, idempotencyKey,
        guestEmail: encrypt(identity.value.email), guestEmailHash: emailHash, guestPhone: identity.value.phone ? encrypt(identity.value.phone) : null,
        guestMailConsentAt: now, guestHoldExpiresAt: holdExpiry(now), guestCodeHash: guestCodeHash(id, code), guestCodeAttempts: 0,
        guestReminderConsentAt: reminderConsent ? now : null,
      },
    });
  } catch (error) {
    logger.error({ err: { name: error?.name, code: error?.cause?.code || error?.code } }, '[rdv-guest] hold transaction failed');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
  if (outcome.kind === 'replay') return replyHold(outcome.appointment);
  if (outcome.kind === 'duplicate') { const row = await findByKey(); return row ? replyHold(row) : res.status(409).json(SLOT_TAKEN); }
  if (outcome.kind === 'conflict') return res.status(409).json(SLOT_TAKEN);
  if (outcome.kind === 'already_booked') {
    if (!(await alreadyBooked({ structure, email: identity.value.email }))) {
      await releaseHold(outcome.appointment.id, true);
      return res.status(503).json(MAIL_UNAVAILABLE);
    }
    return replyHold(withLoadedRelations(outcome.appointment, structure, service), 202);
  }
  if (outcome.kind !== 'created') return res.status(500).json({ error: 'Internal Server Error' });

  // after COMMIT: the code. If it did not really leave, the hold is released at once (nothing blocks the slot, nothing personal is kept) and 503 is answered.
  let out = null;
  try {
    out = await sendMail({
      to: identity.value.email,
      subject: `Votre code de confirmation - ${structure.nom}`,
      text: [`Votre code de confirmation : ${code}`, '',
        `Il confirme votre demande de rendez-vous avec ${structure.nom} (${service.name}) le ${formatParis(startAt)} (Europe/Paris).`,
        `Le créneau est réservé pendant ${GUEST_HOLD_MINUTES} minutes. Sans confirmation, il est libéré automatiquement.`, '',
        "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : aucun rendez-vous ne sera pris."].join('\n'),
      category: 'appointment_guest_code',
    });
  } catch { out = null; }
  await recordNotice(id, 'GUEST_CODE', 'citizen', 'email', mailLedgerStatus(out));
  if (!mailReallySent(out)) {
    await releaseHold(id, false);
    return res.status(503).json(MAIL_UNAVAILABLE);
  }
  return replyHold(withLoadedRelations(outcome.appointment, structure, service), 202);
}

// ── POST rdv/guest/confirm { holdId, code } ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function confirm(req, res) {
  if (await limited(res, 'RDV_GUEST_CONFIRM', getClientIp(req))) return undefined;
  const holdId = str(req.body?.holdId); const code = str(req.body?.code);
  if (!holdId || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'CODE_INVALID', code: 'CODE_INVALID' });
  const current = await loadAppointmentWithRelations(holdId);
  if (!current || !current.guestEmailHash) return res.status(404).json(MANAGE_NOT_FOUND);
  if (current.status === 'confirmed' && !current.guestHoldExpiresAt) return res.status(409).json({ error: 'HOLD_ALREADY_CONFIRMED', code: 'HOLD_ALREADY_CONFIRMED' });

  const manage = newManageToken();
  // under the booking lock of the slot's day: a hold confirmed in time is never confirmed over a booking taken after it expired
  const lockKey = bookingLockKeyOf(current.structureId, new Date(current.startAt));
  const result = await withBookingCollisionLock(lockKey, () => db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const [row] = await tx.select().from(schema.ProAppointment).where(eq(schema.ProAppointment.id, holdId)).for('update');
    if (!row || row.status !== 'requested' || !row.guestHoldExpiresAt || !row.guestCodeHash) return { status: 409, body: { error: 'HOLD_NOT_ACTIVE', code: 'HOLD_NOT_ACTIVE' } };
    if (holdExpired(row)) return { status: 409, body: { error: 'HOLD_EXPIRED', code: 'HOLD_EXPIRED' } };
    // R41-B: a decoy goes through the very same steps (attempts, lockout, expiry) and never matches; the code is checked first so both cost the same
    if (!(checkGuestCode(row.id, code, row.guestCodeHash) && !isGuestDecoy(row))) {
      const attempts = Number(row.guestCodeAttempts || 0) + 1;
      if (attempts >= GUEST_CODE_MAX_ATTEMPTS) {
        await tx.update(schema.ProAppointment).set({ guestCodeAttempts: GUEST_CODE_MAX_ATTEMPTS, status: 'cancelled', cancelledAt: new Date(), cancelledBy: 'GUEST_CODE_LOCKED', guestCodeHash: null })
          .where(eq(schema.ProAppointment.id, row.id));
        return { status: 409, body: { error: 'HOLD_LOCKED', code: 'HOLD_LOCKED', attemptsLeft: 0 } };
      }
      await tx.update(schema.ProAppointment).set({ guestCodeAttempts: attempts }).where(eq(schema.ProAppointment.id, row.id));
      return { status: 400, body: { error: 'CODE_INVALID', code: 'CODE_INVALID', attemptsLeft: GUEST_CODE_MAX_ATTEMPTS - attempts } };
    }
    const [updated] = await tx.update(schema.ProAppointment).set({
      status: 'confirmed', guestHoldExpiresAt: null, guestCodeHash: null, guestConfirmedAt: new Date(),
      guestManageTokenHash: manage.hash, guestManageExpiresAt: row.endAt,
    }).where(and(eq(schema.ProAppointment.id, row.id), eq(schema.ProAppointment.status, 'requested'))).returning();
    return updated ? { status: 200, row: updated } : { status: 409, body: { error: 'HOLD_NOT_ACTIVE', code: 'HOLD_NOT_ACTIVE' } };
  }));
  if (result.status !== 200) return res.status(result.status).json(result.body);

  const appointment = { ...result.row, structure: current.structure, service: current.service };
  const email = await openEmail(appointment);
  const manageUrl = guestManageUrl(current.structure.slug, appointment.id, manage.token);
  let status = 'NOT_DELIVERED';
  try {
    const out = await sendMail({
      to: email,
      subject: `Confirmation de votre rendez-vous - ${current.structure.nom}`,
      text: [`Votre rendez-vous est confirmé avec ${current.structure.nom}.`, '', `Service : ${current.service?.name || 'Rendez-vous'}`,
        `Date : ${formatParis(appointment.startAt)} (Europe/Paris)`, `Modalité : en présentiel.`, locationText(locationOf(current.structure)), '',
        `Voir, déplacer ou annuler ce rendez-vous (lien personnel, ne le transférez pas) : ${manageUrl}`, '',
        "Si vous n'êtes pas à l'origine de cette demande, annulez-la avec ce lien."].join('\n'),
      category: 'appointment_guest_confirmation',
      attachments: [calendarAttachment({ appointmentId: appointment.id, startAt: appointment.startAt, endAt: appointment.endAt, structureName: current.structure.nom,
        serviceName: current.service?.name || 'Rendez-vous', manageUrl, location: icsLocation(appointment) }, email)],
    });
    status = mailLedgerStatus(out);
  } catch { status = 'FAILED'; }
  await recordNotice(appointment.id, 'BOOKED_BY_GUEST', 'citizen', 'email', status);
  await noticeStructure(appointment, 'BOOKED_BY_GUEST', { title: 'Nouveau rendez-vous pris sans compte', text: `Un rendez-vous en présentiel a été pris sans compte pour le ${formatParis(appointment.startAt)}.` });
  // the person proved the mailbox with the code: the manage token is also given to this browser (same capability as the e-mailed link)
  return res.status(200).json({ appointment: guestView(appointment), manage: { token: manage.token, expiresAt: iso(appointment.guestManageExpiresAt) }, mail: { status } });
}

/** the appointment this token manages (one appointment, until its end), or null — every failure looks the same */
async function byToken(req) {
  const appointmentId = str(req.body?.appointmentId); const token = str(req.body?.token);
  if (!appointmentId || !token) return null;
  const row = await loadAppointmentWithRelations(appointmentId);
  return row && row.guestEmailHash && !row.citizenUserId && checkManageToken(token, row) ? row : null;
}

// ── POST rdv/guest/manage { appointmentId, token } ───────────────────────────────────────────────────────────────────────────────────────────────────────
async function manage(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (await limited(res, 'RDV_GUEST_MANAGE', `${getClientIp(req)}:${digest(req.body?.token)}`)) return undefined;
  const row = await byToken(req);
  if (!row) return res.status(404).json(MANAGE_NOT_FOUND);
  return res.status(200).json({ appointment: guestView(row), emailMasked: maskEmail(await openEmail(row)) });
}

// ── POST rdv/guest/manage/cancel { appointmentId, token } ────────────────────────────────────────────────────────────────────────────────────────────────
async function cancel(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (await limited(res, 'RDV_GUEST_MANAGE', `${getClientIp(req)}:${digest(req.body?.token)}`)) return undefined;
  const row = await byToken(req);
  if (!row) return res.status(404).json(MANAGE_NOT_FOUND);
  if (row.status === 'cancelled') return res.status(200).json({ appointment: guestView(row) });
  if (new Date(row.startAt).getTime() <= Date.now()) return res.status(409).json({ error: 'APPOINTMENT_NOT_CANCELLABLE', code: 'APPOINTMENT_NOT_CANCELLABLE' });
  const done = await db.update(schema.ProAppointment).set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: 'GUEST' })
    .where(and(eq(schema.ProAppointment.id, row.id), sql`${schema.ProAppointment.status} <> 'cancelled'`, isNull(schema.ProAppointment.citizenUserId))).returning({ id: schema.ProAppointment.id });
  const updated = await loadAppointmentWithRelations(row.id);
  if (done.length && updated) {
    const when = formatParis(updated.startAt); const structureName = updated.structure?.nom || 'la structure';
    await noticeStructure(updated, 'CANCELLED_BY_CITIZEN', { title: 'Rendez-vous annulé par la personne', text: `Le rendez-vous (sans compte) du ${when} a été annulé par la personne. Le créneau est de nouveau libre.` });
    await noticeCitizen(updated, 'CANCELLED_BY_CITIZEN', {
      subject: `Annulation confirmée - ${structureName}`,
      text: `Votre rendez-vous du ${when} (Europe/Paris) avec ${structureName} est annulé.`,
      calendar: { appointmentId: updated.id, startAt: updated.startAt, endAt: updated.endAt, structureName, serviceName: updated.service?.name || 'Rendez-vous', sequence: Number(updated.rescheduleCount || 0) + 1, cancelled: true },
    });
  }
  return res.status(200).json({ appointment: guestView(updated || row) });
}

// ── POST rdv/guest/manage/reschedule { appointmentId, token, startAt } ───────────────────────────────────────────────────────────────────────────────────
async function reschedule(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (await limited(res, 'RDV_GUEST_MANAGE', `${getClientIp(req)}:${digest(req.body?.token)}`)) return undefined;
  const row = await byToken(req);
  if (!row) return res.status(404).json(MANAGE_NOT_FOUND);
  const tokenHash = manageTokenHash(str(req.body?.token));
  const startAt = new Date(str(req.body?.startAt));
  if (Number.isNaN(startAt.getTime())) return res.status(400).json({ error: 'A valid startAt is required', code: 'INVALID_REQUEST' });
  if (row.guestHoldExpiresAt) return res.status(409).json({ error: 'APPOINTMENT_NOT_ACTIVE', code: 'APPOINTMENT_NOT_ACTIVE' });
  const early = rescheduleRefusal(row);
  if (early) return res.status(early.status).json({ error: early.code, code: early.code, message: early.error });
  if (startAt.getTime() === new Date(row.startAt).getTime()) return res.status(400).json({ error: 'SAME_SLOT', code: 'SAME_SLOT' });
  // a NEW slot needs the structure still taking account-free bookings, and the same, still guest-bookable service
  const structure = await guestStructure(row.structure?.slug);
  if (!structure) return res.status(409).json({ error: 'ORGANIZATION_NOT_BOOKABLE', code: 'ORGANIZATION_NOT_BOOKABLE' });
  const service = await guestService(structure, row.serviceId);
  if (!service) return res.status(404).json({ error: 'Service not found', code: 'SERVICE_NOT_FOUND' });
  if (!(await isFreeSlot(structure, service, startAt, row.id))) return res.status(409).json(SLOT_TAKEN);
  const endAt = new Date(startAt.getTime() + service.durationMinutes * 60_000);
  const { moved, outcome } = await moveSlot({
    appointment: row, structure, service, startAt, endAt, refuse: rescheduleRefusal,
    owns: (r) => !r.citizenUserId && sameDigest(r.guestManageTokenHash, tokenHash),
    set: { guestManageExpiresAt: endAt },   // the manage link follows the appointment: valid until its NEW end
  });
  if (!moved) return res.status(outcome.status).json(outcome.body);
  const before = formatParis(row.startAt); const after = formatParis(moved.startAt);
  await noticeCitizen(moved, 'RESCHEDULED', {
    subject: `Rendez-vous déplacé - ${structure.nom}`,
    text: `Votre rendez-vous avec ${structure.nom} (${service.name}) est déplacé :\nancien créneau : ${before}\nnouveau créneau : ${after} (Europe/Paris)\nModalité : en présentiel.\n${locationText(locationOf(structure))}\n\nLe lien reçu à la confirmation reste valable pour gérer ce rendez-vous.`,
    calendar: { appointmentId: moved.id, startAt: moved.startAt, endAt: moved.endAt, structureName: structure.nom, serviceName: service.name, sequence: Number(moved.rescheduleCount || 0), location: icsLocation(moved) },
  });
  await noticeStructure(moved, 'RESCHEDULED', { title: 'Rendez-vous déplacé par la personne', text: `Un rendez-vous (sans compte) a été déplacé par la personne : du ${before} au ${after}.` });
  return res.status(200).json({ appointment: guestView(moved) });
}

// ── POST rdv/guest/manage/reminder { appointmentId, token, consent } ───────────────────────────────────────────────────────────────────────────────────
// R39: the optional J-1 reminder, turned on or off from the personal link (withdrawing is always possible while the link is valid; turning it on only for a
// confirmed appointment still to come). Idempotent; the first consent's time is kept; an AuditLog entry without personal data records a change.
async function reminder(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (await limited(res, 'RDV_GUEST_MANAGE', `${getClientIp(req)}:${digest(req.body?.token)}`)) return undefined;
  const row = await byToken(req);
  if (!row) return res.status(404).json(MANAGE_NOT_FOUND);
  const consent = req.body?.consent;
  if (typeof consent !== 'boolean') return res.status(400).json({ error: 'consent must be true or false', code: 'INVALID_REQUEST' });
  if (consent && !guestView(row).reminderChangeable) return res.status(409).json({ error: 'APPOINTMENT_NOT_ACTIVE', code: 'APPOINTMENT_NOT_ACTIVE' });
  const t = schema.ProAppointment;
  const changed = await db.update(t).set({ guestReminderConsentAt: consent ? new Date() : null })
    .where(and(eq(t.id, row.id), isNull(t.citizenUserId), eq(t.guestManageTokenHash, row.guestManageTokenHash),
      consent ? isNull(t.guestReminderConsentAt) : isNotNull(t.guestReminderConsentAt)))
    .returning({ id: t.id });
  if (changed.length) {
    await db.insert(schema.AuditLog).values({ action: consent ? 'RDV_GUEST_REMINDER_CONSENT_GIVEN' : 'RDV_GUEST_REMINDER_CONSENT_WITHDRAWN', actor: 'guest',
      entity: 'ProAppointment', entity_id: row.id, details: { via: 'manage_link' } })
      .catch((e) => logger.warn({ err: { name: e?.name, code: e?.cause?.code || e?.code } }, '[rdv-guest] reminder consent audit not written'));
  }
  const updated = await loadAppointmentWithRelations(row.id);
  return res.status(200).json({ appointment: guestView(updated || row) });
}

/** rdv/guest/<rest> @param {string} method @param {string[]} seg the segments after « guest » */
export default async function guestHandler(req, res, method, seg) {
  res.setHeader('Cache-Control', 'no-store');
  // fail-closed global switch: the owner activates account-free booking deliberately (legal basis, retention, mail provider)
  if (!guestBookingEnabled()) return res.status(503).json({ error: 'GUEST_BOOKING_DISABLED', code: 'GUEST_BOOKING_DISABLED' });
  if (method === 'GET' && seg[0] === 'structures' && seg.length === 3 && seg[2] === 'services') return services(req, res, str(seg[1]));
  if (method === 'GET' && seg[0] === 'structures' && seg.length === 3 && seg[2] === 'slots') return slots(req, res, str(seg[1]));
  if (method === 'POST' && seg.length === 1 && seg[0] === 'hold') return hold(req, res);
  if (method === 'POST' && seg.length === 1 && seg[0] === 'confirm') return confirm(req, res);
  if (method === 'POST' && seg.length === 1 && seg[0] === 'manage') return manage(req, res);
  if (method === 'POST' && seg.length === 2 && seg[0] === 'manage' && seg[1] === 'cancel') return cancel(req, res);
  if (method === 'POST' && seg.length === 2 && seg[0] === 'manage' && seg[1] === 'reschedule') return reschedule(req, res);
  if (method === 'POST' && seg.length === 2 && seg[0] === 'manage' && seg[1] === 'reminder') return reminder(req, res);
  return res.status(404).json({ error: 'Not Found' });
}
