import { db } from '../../../src/db/index.js';
import { ProAvailabilityRule } from '../../../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { logProAudit, requireProStructureContext } from '../../_utils/auth.js';
import { clientIp } from '../../_utils/client-ip.js';
import { dayKeyToWeekday, normalizeAvailabilityRules, parseTimeOfDay, rulesToSlotsJson, slotsJsonToRules } from '../../_utils/pro-rdv.js';
import { withProRdvHandler } from '../../_utils/with-pro-rdv-handler.js';
import { availabilityPayloadSchema } from '../../../src/db/drizzle-schemas.js';
import { canManageSchedule, SCHEDULE_MANAGERS_ONLY } from '../../_utils/schedule-permissions.js';

const DAY_LABELS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const RANGE_PATTERN = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/;

/**
 * First malformed entry of a `slots_json` payload, as a French message for the professional, or null when every non-blank entry is a valid range.
 * @param {Record<string, unknown>} slotsJson
 * @returns {string | null}
 */
export function findInvalidSlotsJson(slotsJson) {
  for (const [dayKey, ranges] of Object.entries(slotsJson)) {
    const weekday = dayKeyToWeekday(dayKey);
    if (weekday === null) return `Jour inconnu « ${String(dayKey).slice(0, 20)} ».`;
    if (!Array.isArray(ranges)) return `Les plages du ${DAY_LABELS[weekday]} doivent être une liste.`;
    for (const raw of ranges) {
      const range = String(raw ?? '').trim();
      if (!range) continue;                                   // a blank row is "nothing", not an error
      const match = RANGE_PATTERN.exec(range);
      if (!match) return `Plage invalide « ${range.slice(0, 20)} » (${DAY_LABELS[weekday]}). Utilisez HH:MM-HH:MM, par exemple 09:00-12:00.`;
      let start;
      let end;
      try {
        start = parseTimeOfDay(match[1]);
        end = parseTimeOfDay(match[2]);
      } catch {
        return `Plage invalide « ${range} » (${DAY_LABELS[weekday]}) : horaire entre 00:00 et 23:59.`;
      }
      if (end.hours * 60 + end.minutes <= start.hours * 60 + start.minutes) {
        return `Plage invalide « ${range} » (${DAY_LABELS[weekday]}) : la fin doit être après le début.`;
      }
    }
  }
  return null;
}

/**
 * Two ranges of one weekday that overlap (touching ranges such as 09:00-12:00 and 12:00-14:00 are fine).
 * @param {Array<{ weekday: number, startTime: string, endTime: string }>} rules
 * @returns {string | null}
 */
export function findOverlap(rules) {
  const byDay = new Map();
  for (const rule of rules) {
    const list = byDay.get(rule.weekday) || [];
    list.push(rule);
    byDay.set(rule.weekday, list);
  }
  for (const [weekday, list] of byDay) {
    list.sort((/** @type {{ startTime: string }} */ a, /** @type {{ startTime: string }} */ b) => a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < list.length; i += 1) {
      if (list[i].startTime < list[i - 1].endTime) {
        return `Plages qui se chevauchent le ${DAY_LABELS[weekday]} : ${list[i - 1].startTime}-${list[i - 1].endTime} et ${list[i].startTime}-${list[i].endTime}.`;
      }
    }
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
async function handler(req, res) {
  const proCtx = requireProStructureContext(req, res);
  if (!proCtx) return;

  if (req.method === 'GET') {
    const rules = await db.query.ProAvailabilityRule.findMany({
      where: eq(ProAvailabilityRule.structureId, proCtx.structureId),
      orderBy: (pr, { asc }) => [asc(pr.weekday), asc(pr.startTime)],
    });

    return res.status(200).json({
      rules: rules.map((rule /** @type {any} */) => ({
        id: rule.id,
        weekday: rule.weekday,
        startTime: rule.startTime,
        endTime: rule.endTime,
        timezone: rule.timezone,
        isActive: rule.isActive,
      })),
      slots_json: rulesToSlotsJson(rules),
      timezone: rules[0]?.timezone || 'Europe/Paris',
      canEdit: await canManageSchedule(proCtx),   // R24: the screen shows the hours read-only to the other members
    });
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    // R24 (owner decision R18.5): the general opening hours decide what the public can book — only the administrator or a member they delegated changes them
    if (!(await canManageSchedule(proCtx))) return res.status(403).json({ error: SCHEDULE_MANAGERS_ONLY, code: 'SCHEDULE_MANAGERS_ONLY' });
    const parsed = availabilityPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || 'Invalid input';
      return res.status(400).json({ error: firstError });
    }
    const data = parsed.data;
    const timezone = data.timezone || 'Europe/Paris';

    /** @type {Array<{weekday:number,startTime:string,endTime:string,timezone:string,isActive:boolean}>} */
    let normalizedRules = [];
    try {
      if (Array.isArray(data.rules) && data.rules.length > 0) {
        normalizedRules = normalizeAvailabilityRules(
          data.rules.map((rule) => ({
            weekday: rule.weekday,
            startTime: rule.startTime,
            endTime: rule.endTime,
            timezone: rule.timezone || timezone,
            isActive: rule.isActive !== false,
          })),
        );
      } else if (data.slots_json && typeof data.slots_json === 'object') {
        // DTA S8: a malformed range used to be dropped silently and the save answered 200, so the professional believed a day was open when it was not.
        const invalid = findInvalidSlotsJson(/** @type {Record<string, unknown>} */ (data.slots_json));
        if (invalid) return res.status(400).json({ error: invalid });
        normalizedRules = slotsJsonToRules(/** @type {Record<string, unknown>} */ (data.slots_json), timezone);
      }
    } catch {
      return res.status(400).json({ error: 'Horaire invalide. Utilisez HH:MM (00:00 à 23:59), la fin après le début.' });
    }
    const overlap = findOverlap(normalizedRules);
    if (overlap) return res.status(400).json({ error: overlap });

    // DTA S8: replace atomically. The old delete-then-insert sequence left a structure with NO availability if the insert failed, and two concurrent saves
    // could interleave into duplicated rules. One transaction, serialized per structure by an advisory lock.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`availability:${proCtx.structureId}`}, 0))`);
      await tx.delete(ProAvailabilityRule).where(eq(ProAvailabilityRule.structureId, proCtx.structureId));
      if (normalizedRules.length > 0) {
        await tx.insert(ProAvailabilityRule).values(
          normalizedRules.map((rule) => ({
            structureId: proCtx.structureId,
            weekday: rule.weekday,
            startTime: rule.startTime,
            endTime: rule.endTime,
            timezone: rule.timezone || timezone,
            isActive: rule.isActive !== false,
          })),
        );
      }
    });
    // R14: opening hours decide what the public can book — journaled like the service catalogue (an emptied schedule used to leave no trace)
    await logProAudit('RDV_AVAILABILITY_UPDATED', proCtx.userId, proCtx.structureId, { rules: normalizedRules.length }, clientIp(req));

    return res.status(200).json({
      ok: true,
      rules: normalizedRules,
      slots_json: rulesToSlotsJson(normalizedRules),
      timezone,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withProRdvHandler('pro.availability', handler);
