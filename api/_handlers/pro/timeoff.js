import crypto from 'node:crypto';
import { db } from '../../../src/db/index.js';
import { ProAppointment, ProTimeOff, ProUser } from '../../../src/db/schema.js';
import { eq, and, gt, lt, asc, inArray } from 'drizzle-orm';
import { ACTIVE_APPOINTMENT_STATUSES } from '../../_utils/pro-rdv.js';
import { logProAudit, requireProStructureContext } from '../../_utils/auth.js';
import { clientIp } from '../../_utils/client-ip.js';
import { withProRdvHandler } from '../../_utils/with-pro-rdv-handler.js';
import { createTimeOffSchema, updateTimeOffSchema } from '../../../src/db/drizzle-schemas.js';
import { canManageSchedule, SCHEDULE_MANAGERS_ONLY } from '../../_utils/schedule-permissions.js';

/**
 * @param {unknown} value
 * @returns {Date | null}
 */
function toDate(value) {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * @param {any} item
 * @param {{ userId: string }} [proCtx]
 * @param {boolean} [manager]
 * @param {Map<string, string>} [emails]
 */
function serialize(item, proCtx, manager = false, emails = new Map()) {
  const mine = !!proCtx && item.proUserId === proCtx.userId;
  return {
    id: item.id,
    structureId: item.structureId,
    // R24 (owner decision R18.5): a member's own absence, or a closure of the whole structure (proUserId null)
    scope: item.proUserId ? 'member' : 'structure',
    proUserId: item.proUserId || null,
    memberEmail: item.proUserId ? (emails.get(item.proUserId) || null) : null,
    mine,
    canEdit: manager || mine,
    startAt: item.startAt,
    endAt: item.endAt,
    reason: item.reason || null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/**
 * @param {Date | null} startAt
 * @param {Date | null} endAt
 * @returns {string | null}
 */
function validateRange(startAt, endAt) {
  if (!startAt) return 'startAt is required';
  if (!endAt) return 'endAt is required';
  if (endAt <= startAt) return 'endAt must be greater than startAt';
  return null;
}

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
async function handler(req, res) {
  const proCtx = requireProStructureContext(req, res);
  if (!proCtx) return;

  if (req.method === 'GET') {
    const from = toDate(req.query.from);
    const to = toDate(req.query.to);

    const conditions = [eq(ProTimeOff.structureId, proCtx.structureId)];
    if (from || to) {
      if (from) conditions.push(gt(ProTimeOff.endAt, from));
      if (to) conditions.push(lt(ProTimeOff.startAt, to));
    }

    const items = await db.query.ProTimeOff.findMany({
      where: and(...conditions),
      orderBy: [asc(ProTimeOff.startAt), asc(ProTimeOff.createdAt)],
    });
    const manager = await canManageSchedule(proCtx);
    const everyone = await structureMembers(proCtx.structureId, false);   // a departed member's past absence keeps its name
    const members = everyone.filter((m) => m.status === 'active').map(({ id, email }) => ({ id, email }));
    const emails = new Map(everyone.map((m) => [m.id, m.email]));
    // R24: the team sees everyone's absences (it is the team's agenda); a schedule manager also gets the members they may record an absence for
    return res.status(200).json({
      items: items.map((i) => serialize(i, proCtx, manager, emails)), total: items.length,
      canManageOthers: manager, members: manager ? members.filter((m) => m.id !== proCtx.userId) : [],   // « Moi-même » is its own choice
    });
  }

  if (req.method === 'POST') {
    const parsed = createTimeOffSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || 'Invalid input';
      return res.status(400).json({ error: firstError });
    }
    const { startAt, endAt, reason: rawReason } = parsed.data;
    const reason = typeof rawReason === 'string' ? rawReason.trim() || null : null;
    // R24 (owner decision R18.5): a member records their own absence; a closure of the structure or another member's absence needs a schedule manager.
    // Nothing said = the author's own absence, or for a schedule manager a closure (the meaning every absence had before R24).
    const manager = await canManageSchedule(proCtx);
    const scope = parsed.data.scope || (parsed.data.proUserId ? 'member' : (manager ? 'structure' : 'member'));
    const proUserId = scope === 'structure' ? null : (parsed.data.proUserId || proCtx.userId);
    if ((scope === 'structure' || proUserId !== proCtx.userId) && !manager) return res.status(403).json({ error: SCHEDULE_MANAGERS_ONLY, code: 'SCHEDULE_MANAGERS_ONLY' });
    if (proUserId && proUserId !== proCtx.userId && !(await structureMembers(proCtx.structureId, true)).some((m) => m.id === proUserId)) {
      return res.status(404).json({ error: 'Membre introuvable dans cette structure.' });   // another organization's member answers like an unknown one
    }

    const [created] = await db.insert(ProTimeOff).values({
        id: crypto.randomUUID(),
        structureId: proCtx.structureId,
        proUserId,
        startAt,
        endAt,
        reason,
        createdAt: new Date(),
        updatedAt: new Date(),
    }).returning();

    // R12 (B11): an absence over appointments already booked does not cancel them silently, and is not silent either — they are listed so the team cancels
    // or moves each one (with the person's notice) from the agenda
    await logProAudit('RDV_TIMEOFF_CREATED', proCtx.userId, proCtx.structureId, { timeOffId: created.id, scope, memberId: proUserId }, clientIp(req));
    return res.status(201).json({ ok: true, item: serialize(created, proCtx, manager), overlappingAppointments: await overlappingOf(proCtx.structureId, created.startAt, created.endAt, proUserId) });
  }

  if (req.method === 'PATCH' || req.method === 'PUT') {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const id = String(req.query.id || body.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });

    const existing = await db.query.ProTimeOff.findFirst({ where: eq(ProTimeOff.id, id) });
    // R7: another organization's absence is the same 404 as an unknown one (a 403 confirmed that the id exists)
    if (!existing || existing.structureId !== proCtx.structureId) return res.status(404).json({ error: 'Time off not found' });
    const manager = await canManageSchedule(proCtx);
    // R24 (owner decision R18.5): one's own absence, or a schedule manager
    if (existing.proUserId !== proCtx.userId && !manager) return res.status(403).json({ error: SCHEDULE_MANAGERS_ONLY, code: 'SCHEDULE_MANAGERS_ONLY' });

    const parsed = updateTimeOffSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || 'Invalid input';
      return res.status(400).json({ error: firstError });
    }
    const data = parsed.data;

    const nextStartAt = data.startAt ?? existing.startAt;
    const nextEndAt = data.endAt ?? existing.endAt;

    if (nextEndAt <= nextStartAt) {
      return res.status(400).json({ error: 'endAt must be greater than startAt' });
    }

    const nextReason = typeof data.reason !== 'undefined' ? (data.reason?.trim() || null) : existing.reason;

    const noChanges =
      /** @type {Date} */ (nextStartAt).toISOString() === existing.startAt.toISOString() &&
      /** @type {Date} */ (nextEndAt).toISOString() === existing.endAt.toISOString() &&
      (nextReason || null) === (existing.reason || null);

    if (noChanges) {
      return res.status(200).json({ ok: true, item: serialize(existing, proCtx, manager) });
    }

    const [updated] = await db.update(ProTimeOff).set({
        startAt: /** @type {Date} */ (nextStartAt),
        endAt: /** @type {Date} */ (nextEndAt),
        reason: nextReason || null,
        updatedAt: new Date(),
    }).where(eq(ProTimeOff.id, id)).returning();
    await logProAudit('RDV_TIMEOFF_UPDATED', proCtx.userId, proCtx.structureId, { timeOffId: id, scope: existing.proUserId ? 'member' : 'structure', memberId: existing.proUserId || null }, clientIp(req));   // R14: schedule changes are journaled like the catalogue
    // R14: an absence widened over booked appointments says so, as on creation (the edit used to be silent)
    return res.status(200).json({ ok: true, item: serialize(updated, proCtx, manager), overlappingAppointments: await overlappingOf(proCtx.structureId, updated.startAt, updated.endAt, updated.proUserId) });
  }

  if (req.method === 'DELETE') {
    const id = String(req.query.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });

    const existing = await db.query.ProTimeOff.findFirst({ where: eq(ProTimeOff.id, id) });
    // R7: another organization's absence is the same 404 as an unknown one (a 403 confirmed that the id exists)
    if (!existing || existing.structureId !== proCtx.structureId) return res.status(404).json({ error: 'Time off not found' });
    if (existing.proUserId !== proCtx.userId && !(await canManageSchedule(proCtx))) return res.status(403).json({ error: SCHEDULE_MANAGERS_ONLY, code: 'SCHEDULE_MANAGERS_ONLY' });

    await db.delete(ProTimeOff).where(eq(ProTimeOff.id, id));
    await logProAudit('RDV_TIMEOFF_DELETED', proCtx.userId, proCtx.structureId, { timeOffId: id, scope: existing.proUserId ? 'member' : 'structure', memberId: existing.proUserId || null }, clientIp(req));
    return res.status(200).json({ ok: true, id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

/** R12 (B11) / R14: the appointments still booked inside an absence (listed on creation AND on edit, so the team moves or cancels each one with the person's notice).
 * R24: for a member's absence, the appointments that member created (citizens' bookings belong to the structure, not to a member). */
/** @param {string} structureId @param {Date} startAt @param {Date} endAt @param {string | null} [proUserId] */
async function overlappingOf(structureId, startAt, endAt, proUserId = null) {
  const conds = [eq(ProAppointment.structureId, structureId), inArray(ProAppointment.status, ACTIVE_APPOINTMENT_STATUSES), lt(ProAppointment.startAt, endAt), gt(ProAppointment.endAt, startAt)];
  if (proUserId) conds.push(eq(ProAppointment.createdByProUserId, proUserId));
  const rows = await db.select({ id: ProAppointment.id, startAt: ProAppointment.startAt }).from(ProAppointment)
    .where(and(...conds))
    .orderBy(asc(ProAppointment.startAt)).limit(50);
  return rows.map((a) => ({ id: a.id, startAt: a.startAt }));
}

/** R24: the members of the structure (the active ones are the people an absence can be recorded for) */
/** @param {string} structureId @param {boolean} activeOnly */
async function structureMembers(structureId, activeOnly) {
  const conds = [eq(ProUser.structureId, structureId)];
  if (activeOnly) conds.push(eq(ProUser.status, 'active'));
  return db.select({ id: ProUser.id, email: ProUser.email, status: ProUser.status }).from(ProUser).where(and(...conds)).orderBy(asc(ProUser.email));
}

export default withProRdvHandler('pro.timeoff', handler);
