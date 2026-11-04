/**
 * R42-CDGG — a professional's own working hours and dated exceptions (api/_services/rdv-member-hours.js). GET / PUT /api/pro/rdv/hours
 *
 * Who: every member reads and changes THEIR OWN hours; the structure's administrator (or a member delegated to manage the schedule — the R24 rule of
 * api/_utils/schedule-permissions.js) reads and changes every member's hours of THEIR structure. A member of another structure, an unknown id or a
 * disabled member is the same 404. Nothing here is public: the booking only uses the hours to narrow the offered slots.
 *
 * GET  → { timezone, canManageOthers, structureHours: [{ weekday, startTime, endTime }], members: [{ id, label, mine, hours }] } (a plain member: only themself)
 * PUT  { memberId?, weekly: null | [{ weekday, startTime, endTime }], exceptions: [{ kind, from, to, startTime?, endTime? }] } → 200 { ok, member,
 *      appointmentsOutsideHours: [{ id, startAt }] }   (existing appointments are KEPT, as with an absence (R12 B11): they are listed so the team moves or
 *      cancels each one from the agenda with the person's notice) | 400 { error } | 403 SCHEDULE_MANAGERS_ONLY | 404
 * DELETE ?memberId= → back to « follows the structure's hours ».
 * Every change is journaled (RDV_MEMBER_HOURS_UPDATED / _CLEARED) with counts only.
 */
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { db } from '../../../src/db/index.js';
import { ProAppointment, ProAvailabilityRule, ProProfile, ProUser } from '../../../src/db/schema.js';
import { logProAudit, requireProStructureContext } from '../../_utils/auth.js';
import { clientIp } from '../../_utils/client-ip.js';
import { withProRdvHandler } from '../../_utils/with-pro-rdv-handler.js';
import { activeAppointmentWhere } from '../../_utils/rdv-active.js';
import { notGuestDecoy } from '../../_utils/rdv-guest-decoy.js';
import { requestGuestSchema } from '../../_utils/schema-features.js';
import { canManageSchedule, SCHEDULE_MANAGERS_ONLY } from '../../_utils/schedule-permissions.js';
import { allowedBy, memberWindows, readMemberHours, validateMemberHours, writeMemberHours } from '../../_services/rdv-member-hours.js';

const NOT_FOUND = Object.freeze({ error: 'Membre introuvable dans cette structure.', code: 'MEMBER_NOT_FOUND' });
const HORIZON_DAYS = 180;

/** @param {string} structureId */
async function activeMembers(structureId) {
  const rows = await db.select({ id: ProUser.id, email: ProUser.email }).from(ProUser)
    .where(and(eq(ProUser.structureId, structureId), eq(ProUser.status, 'active'))).orderBy(asc(ProUser.email));
  const profiles = rows.length ? await db.select({ proUserId: ProProfile.proUserId, displayName: ProProfile.displayName }).from(ProProfile).where(inArray(ProProfile.proUserId, rows.map((r) => r.id))) : [];
  const names = new Map(profiles.map((p) => [p.proUserId, p.displayName || '']));
  return rows.map((r) => ({ id: r.id, label: (names.get(r.id) || '').trim() || r.email }));
}

/**
 * The member's future active appointments that the new hours no longer cover (kept, listed for the team).
 * @param {string} structureId @param {string} memberId @param {import('../../_services/rdv-member-hours.js').MemberHours} hours
 */
async function outsideHours(structureId, memberId, hours) {
  const now = new Date();
  const rows = await db.select({ id: ProAppointment.id, startAt: ProAppointment.startAt, endAt: ProAppointment.endAt }).from(ProAppointment)
    .where(and(eq(ProAppointment.structureId, structureId), eq(ProAppointment.createdByProUserId, memberId), activeAppointmentWhere(ProAppointment, now, await requestGuestSchema(db)),
      notGuestDecoy(ProAppointment), gt(ProAppointment.startAt, now)))
    .orderBy(asc(ProAppointment.startAt)).limit(200);
  const inRange = rows.filter((a) => a.startAt.getTime() <= now.getTime() + HORIZON_DAYS * 86_400_000);
  if (!inRange.length) return [];
  const w = memberWindows(hours, { from: inRange[0].startAt, to: inRange[inRange.length - 1].endAt });
  return inRange.filter((a) => !allowedBy(w, a.startAt, a.endAt)).slice(0, 50).map((a) => ({ id: a.id, startAt: a.startAt }));
}

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
async function handler(req, res) {
  const proCtx = requireProStructureContext(req, res);
  if (!proCtx) return;
  const { structureId, userId } = proCtx;
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const manager = await canManageSchedule(proCtx);
    const members = await activeMembers(structureId);
    const visible = manager ? members : members.filter((m) => m.id === userId);
    const hours = await readMemberHours(structureId, visible.map((m) => m.id));
    const rules = await db.select({ weekday: ProAvailabilityRule.weekday, startTime: ProAvailabilityRule.startTime, endTime: ProAvailabilityRule.endTime }).from(ProAvailabilityRule)
      .where(and(eq(ProAvailabilityRule.structureId, structureId), eq(ProAvailabilityRule.isActive, true))).orderBy(asc(ProAvailabilityRule.weekday), asc(ProAvailabilityRule.startTime));
    return res.status(200).json({
      timezone: 'Europe/Paris',
      canManageOthers: manager,
      structureHours: rules,
      members: visible.map((m) => ({ id: m.id, label: m.label, mine: m.id === userId, hours: hours.get(m.id) })),
    });
  }

  if (req.method !== 'PUT' && req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? /** @type {Record<string, unknown>} */ (req.body) : {};
  const rawId = req.method === 'DELETE' ? req.query?.memberId : (body.memberId ?? req.query?.memberId);
  const memberId = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : userId;
  if (memberId !== userId && !(await canManageSchedule(proCtx))) return res.status(403).json({ error: SCHEDULE_MANAGERS_ONLY, code: 'SCHEDULE_MANAGERS_ONLY' });
  // an unknown id, a disabled member or a member of another structure: one answer
  if (!(await activeMembers(structureId)).some((m) => m.id === memberId)) return res.status(404).json(NOT_FOUND);

  if (req.method === 'DELETE') {
    await writeMemberHours(structureId, memberId, null);
    await logProAudit('RDV_MEMBER_HOURS_CLEARED', userId, structureId, { memberId, self: memberId === userId }, clientIp(req));
    return res.status(200).json({ ok: true, memberId });
  }

  const checked = validateMemberHours(body);
  if ('error' in checked) return res.status(400).json({ error: checked.error, code: 'INVALID_MEMBER_HOURS' });
  await writeMemberHours(structureId, memberId, checked.hours);
  await logProAudit('RDV_MEMBER_HOURS_UPDATED', userId, structureId, { memberId, self: memberId === userId, weeklyRanges: checked.hours.weekly === null ? null : checked.hours.weekly.length,
    available: checked.hours.exceptions.filter((e) => e.kind === 'AVAILABLE').length, unavailable: checked.hours.exceptions.filter((e) => e.kind === 'UNAVAILABLE').length }, clientIp(req));
  return res.status(200).json({ ok: true, member: { id: memberId, hours: checked.hours }, appointmentsOutsideHours: await outsideHours(structureId, memberId, checked.hours) });
}

export default withProRdvHandler('pro.rdv.hours', handler);
