import { db } from '../../../../src/db/index.js';
import { ProAppointment, ProRdvService, ProAvailabilityRule, ProTimeOff, StructureRdvSettings } from '../../../../src/db/schema.js';
import { eq, inArray, lt, gt, and, gte, lte, count, desc, asc, sql, or, isNull } from 'drizzle-orm';
import { withBookingCollisionLock } from '../../rdv.js';
import { MODE_LABELS, modeLabel, normalizeMode, offeredModes, rulesFor } from '../../../lib/appointment-modes.js';
import { joinWindow, publicVideoStatus } from '../../../lib/video-provider.js';
import { formatParis, listNotices, noticeStructure, recordNotice } from '../../../_services/appointment-notices.js';
import { requireProStructureContext } from '../../../_utils/auth.js';
import {
  ACTIVE_APPOINTMENT_STATUSES,
  isSlotWithinRules,
  toBusyWindows,
} from '../../../_utils/pro-rdv.js';
import { withProRdvHandler } from '../../../_utils/with-pro-rdv-handler.js';
import { decrypt, encrypt, isV1Text } from '../../../lib/crypto.js';

// launch-readiness item 61: the name and the notes a professional records for a person are encrypted at rest (v1, covered by the key rotation); rows written
// before stay readable as they are. The phone number stays in clear: the SMS « STOP » replies are matched on it (SMS is disabled, N02) — the privacy page says so.
const seal = (/** @type {string | null | undefined} */ v) => (v ? encrypt(v) : v ?? null);
const open = (/** @type {string | null | undefined} */ v) => { if (!isV1Text(v)) return v ?? null; try { return decrypt(/** @type {string} */ (v)); } catch { return null; } };
import { createAppointmentSchema, patchAppointmentSchema } from '../../../../src/db/drizzle-schemas.js';

/**
 * @param {unknown} value
 * @returns {number}
 */
function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

/**
 * @param {Date} date
 * @returns {Date}
 */
function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

/**
 * @param {Date} date
 * @returns {Date}
 */
function endOfUtcDay(date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
  );
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function maskContact(value) {
  const text = String(value || '').trim();
  if (!text) return 'Bénéficiaire';
  if (text.length <= 4) return '***';
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
}

/**
 * @param {any} appointment
 * @returns {Record<string, any>}
 */
function serialize(appointment) {
  const name = open(appointment.beneficiaryName);
  return {
    id: appointment.id,
    serviceId: appointment.serviceId,
    serviceName: appointment.service?.name || null,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    start_at: appointment.startAt,
    end_at: appointment.endAt,
    status: appointment.status,
    beneficiaryName: name,
    beneficiaryPhone: appointment.beneficiaryPhone || null,
    notes: open(appointment.notes) || null,
    // PKG-3: modality, moves and video state (never the room name or any token)
    mode: appointment.mode || 'IN_PERSON',
    modeLabel: modeLabel(appointment.mode),
    origin: appointment.citizenUserId ? 'CITIZEN' : 'STRUCTURE',
    rescheduleCount: Number(appointment.rescheduleCount || 0),
    rescheduledAt: appointment.rescheduledAt || null,
    beneficiaryConsentAt: appointment.beneficiaryConsentAt || null,
    visioEnabled: appointment.mode === 'VIDEO' && Boolean(appointment.visioApprovedAt),
    video: appointment.mode === 'VIDEO' ? { approved: Boolean(appointment.visioApprovedAt), citizenConsent: Boolean(appointment.visioCitizenConsentAt),
      opensAt: joinWindow(appointment).opensAt.toISOString(), closesAt: joinWindow(appointment).closesAt.toISOString(), service: publicVideoStatus() } : null,
    beneficiary: {
      id: appointment.id,
      contactMasked: maskContact(appointment.beneficiaryPhone || name),
      firstName: name || '',
    },
  };
}

/**
 * @param {import('../../../_utils/http-types').ApiRequest} req
 * @param {import('../../../_utils/http-types').ApiResponse} res
 */
async function handler(req, res) {
  const proCtx = requireProStructureContext(req, res);
  if (!proCtx) return;

  if (req.method === 'GET') {
    const page = Math.max(1, toInt(req.query.page || 1) || 1);
    const pageSize = Math.min(50, Math.max(1, toInt(req.query.pageSize || req.query.limit || 20) || 20));
    const skip = (page - 1) * pageSize;
    const id = String(req.query.id || '').trim();
    const status = String(req.query.status || '').trim();

    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;

    const conditions = [eq(ProAppointment.structureId, proCtx.structureId)];
    if (id) conditions.push(eq(ProAppointment.id, id));
    if (status) conditions.push(eq(ProAppointment.status, status));
    if (from && !Number.isNaN(from.getTime())) conditions.push(gte(ProAppointment.startAt, from));
    if (to && !Number.isNaN(to.getTime())) conditions.push(lte(ProAppointment.startAt, to));
    const whereFilter = and(...conditions);

    const [totalRes, appointments] = await Promise.all([
      db.select({ value: count() }).from(ProAppointment).where(whereFilter),
      db.query.ProAppointment.findMany({
        where: whereFilter,
        offset: skip,
        limit: pageSize,
        orderBy: (pa, { asc }) => [asc(pa.startAt)],
        columns: {
          idempotencyKey: false,
          citizenEmailSnapshot: false,
          createdByProUserId: false,
          visioRoomId: false,
          visioStartedAt: false,
        },
        with: {
          service: {
            columns: {
              id: true,
              name: true,
            },
          },
        },
      }),
    ]);
    const total = totalRes[0]?.value || 0;
    const items = appointments.map(serialize);
    if (id && items.length === 1) items[0].notices = await listNotices(items[0].id);   // honest delivery record of the notices about this appointment

    return res.status(200).json({
      items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  }

  if (req.method === 'POST') {
    const parsed = createAppointmentSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || 'Invalid input';
      return res.status(400).json({ error: firstError });
    }
    const { serviceId, startAt, beneficiaryName, beneficiaryPhone: rawPhone, notes: rawNotes } = parsed.data;
    const beneficiaryPhone = typeof rawPhone === 'string' ? rawPhone.trim() || null : null;
    const notes = typeof rawNotes === 'string' ? rawNotes.trim() || null : null;
    // PKG-3 / B08: an appointment created FOR a person needs the professional to record that the person agreed (to the appointment and to the name/phone being kept)
    if (req.body?.personConsent !== true) {
      return res.status(400).json({ error: 'PERSON_CONSENT_REQUIRED', code: 'PERSON_CONSENT_REQUIRED', message: 'Confirmez que la personne est d’accord pour ce rendez-vous et pour que ses coordonnées soient enregistrées.' });
    }

    const service = await db.query.ProRdvService.findFirst({
      where: (s, { eq }) => eq(s.id, serviceId),
    });
    // R12: another organization's service answers exactly like an unknown one (no existence oracle)
    if (!service || service.structureId !== proCtx.structureId) return res.status(404).json({ error: 'Service not found' });
    if (!service.isActive) return res.status(409).json({ error: 'Service is inactive' });
    const [settings] = await db.select({ bookingMode: StructureRdvSettings.bookingMode }).from(StructureRdvSettings).where(eq(StructureRdvSettings.structureId, proCtx.structureId)).limit(1);
    const mode = req.body?.mode === undefined ? 'IN_PERSON' : normalizeMode(req.body.mode);
    if (!mode || !offeredModes(settings?.bookingMode || 'IN_PERSON', service.modes, publicVideoStatus()).includes(mode)) {
      return res.status(409).json({ error: 'MODE_UNAVAILABLE', code: 'MODE_UNAVAILABLE', message: 'Cette modalité n’est pas proposée pour ce service.' });
    }

    const endAt = new Date(startAt.getTime() + service.durationMinutes * 60_000);
    const rangeStart = startOfUtcDay(startAt);
    const rangeEnd = endOfUtcDay(startAt);

    const rules = rulesFor(await db.query.ProAvailabilityRule.findMany({
      where: (r, { and, eq }) => and(
        eq(r.structureId, proCtx.structureId),
        eq(r.isActive, true)
      ),
      orderBy: (r, { asc }) => [asc(r.weekday), asc(r.startTime)],
    }), mode);

    const slotAllowed = isSlotWithinRules({
      rules,
      startAt,
      endAt,
    });
    if (!slotAllowed) {
      return res.status(409).json({ error: 'Slot is not available' });
    }

    // PKG-3 / B03: same per-structure/day booking lock and transaction as a citizen booking (the professional path used to check-then-insert without it, and ignored time off)
    const lockKey = `${proCtx.structureId}:${new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(startAt)}`;   // R14: the Paris day, the citizen booking's key (the UTC day took another lock near midnight: double booking)
    const created = await withBookingCollisionLock(lockKey, () => db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      const existing = await tx.query.ProAppointment.findMany({
        where: (pa, { and, eq, inArray, lt, gt }) => and(
          eq(pa.structureId, proCtx.structureId),
          inArray(pa.status, ACTIVE_APPOINTMENT_STATUSES),
          lt(pa.startAt, new Date(endAt.getTime() + 24 * 3_600_000)),
          gt(pa.endAt, new Date(startAt.getTime() - 24 * 3_600_000))
        ),
        with: { service: { columns: { bufferBeforeMinutes: true, bufferAfterMinutes: true } } },
      });
      const requestedWindow = {
        start: new Date(startAt.getTime() - service.bufferBeforeMinutes * 60_000),
        end: new Date(endAt.getTime() + service.bufferAfterMinutes * 60_000),
      };
      if (toBusyWindows(existing).some((window) => requestedWindow.start < window.end && window.start < requestedWindow.end)) return null;
      // R24: a closure of the structure, or the author's own absence
      const [off] = await tx.select({ value: count() }).from(ProTimeOff).where(and(eq(ProTimeOff.structureId, proCtx.structureId), or(isNull(ProTimeOff.proUserId), eq(ProTimeOff.proUserId, proCtx.userId)), lt(ProTimeOff.startAt, endAt), gt(ProTimeOff.endAt, startAt)));
      if (Number(off.value) > 0) return null;
      const [row] = await tx.insert(ProAppointment).values({
        structureId: proCtx.structureId,
        serviceId: service.id,
        startAt,
        endAt,
        status: 'booked',
        beneficiaryName: /** @type {string} */ (seal(beneficiaryName)),   // required by the schema: never empty here
        beneficiaryPhone,
        notes: seal(notes),
        createdByProUserId: proCtx.userId,
        beneficiaryConsentAt: new Date(),
        mode,
      }).returning();
      return row;
    }));
    if (!created) {
      return res.status(409).json({ error: 'Slot no longer available' });
    }

    const fullAppointment = await db.query.ProAppointment.findFirst({
      where: (pa, { eq }) => eq(pa.id, created.id),
      with: {
        service: {
          columns: {
            id: true,
            name: true,
          },
        },
      },
    });
    // a person without an account cannot be written to from here (a typed phone is never used for notices): recorded honestly; the team is told
    await recordNotice(created.id, 'BOOKED_BY_STRUCTURE', 'citizen', 'email', 'NO_RECIPIENT');
    await noticeStructure(created, 'BOOKED_BY_STRUCTURE', { title: 'Nouveau rendez-vous créé par l’équipe', text: `Un rendez-vous ${modeLabel(mode).toLowerCase()} a été créé pour le ${formatParis(startAt)}.` });

    return res.status(201).json({
      ok: true,
      item: serialize(fullAppointment),
      meta: {
        rangeStart: rangeStart.toISOString(),
        rangeEnd: rangeEnd.toISOString(),
      },
    });
  }

  if (req.method === 'PATCH') {
    const parsed = patchAppointmentSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || 'Invalid input';
      return res.status(400).json({ error: firstError });
    }
    const id = String(req.query.id || parsed.data.id || '').trim();
    const status = parsed.data.status;
    const notes = typeof parsed.data.notes === 'string' ? parsed.data.notes.trim() : undefined;

    if (!id) return res.status(400).json({ error: 'id is required' });

    const existing = await db.query.ProAppointment.findFirst({
      where: (pa, { eq }) => eq(pa.id, id),
      with: {
        service: { columns: { id: true, name: true } },
      },
    });
    // PKG-4 / D5: another structure's appointment is "not found" (no existence oracle)
    if (!existing || existing.structureId !== proCtx.structureId) return res.status(404).json({ error: 'Appointment not found' });

    // PKG-4 / B09: attendance ('done' = attended, 'no_show') is recorded only once the appointment has started, and only on an active appointment; a cancellation goes
    // through the cancellation path (cancelledAt/By, the person's notice with a calendar CANCEL) instead of a silent status write.
    if (status === 'cancelled' && existing.status !== 'cancelled') {
      const { default: cancelHandler } = await import('./cancel.js');
      req.body = { id };
      return cancelHandler(req, res);
    }
    if ((status === 'done' || status === 'no_show') && existing.status !== status) {
      if (new Date(existing.startAt).getTime() > Date.now()) return res.status(409).json({ error: 'ATTENDANCE_TOO_EARLY', message: 'La présence se renseigne une fois le rendez-vous commencé.' });
      if (!ACTIVE_APPOINTMENT_STATUSES.includes(String(existing.status)) && !['done', 'no_show'].includes(String(existing.status))) return res.status(409).json({ error: 'APPOINTMENT_NOT_ACTIVE', message: 'Ce rendez-vous n’est plus actif.' });
    }

    /** @type {Record<string, any>} */
    const updates = {};
    if (existing.status !== status) updates.status = status;
    if (typeof notes !== 'undefined' && notes !== open(existing.notes)) updates.notes = seal(notes || null);

    if (Object.keys(updates).length === 0) {
      return res.status(200).json({ ok: true, item: serialize(existing) });
    }

    // R12 (B09): compare-and-set on the status that was checked — a cancellation by the person (or a colleague's change) between the read and this write is
    // never overwritten (the write was unconditional)
    const written = await db.update(ProAppointment).set(updates)
      .where(and(eq(ProAppointment.id, id), eq(ProAppointment.structureId, proCtx.structureId), eq(ProAppointment.status, existing.status))).returning({ id: ProAppointment.id });
    if (!written.length) return res.status(409).json({ error: 'APPOINTMENT_CHANGED', message: 'Ce rendez-vous vient d’être modifié : rechargez la page.' });

    const updated = await db.query.ProAppointment.findFirst({
      where: (pa, { eq }) => eq(pa.id, id),
      with: {
        service: { columns: { id: true, name: true } },
      },
    });
    return res.status(200).json({ ok: true, item: serialize(updated) });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withProRdvHandler('pro.appointments', handler);
