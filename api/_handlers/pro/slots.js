import { db } from '../../../src/db/index.js';
import { ProRdvService, ProAvailabilityRule, ProAppointment, ProTimeOff } from '../../../src/db/schema.js';
import { eq, inArray, lt, gt, and, or, isNull } from 'drizzle-orm';
import { requireProStructureContext } from '../../_utils/auth.js';
import { normalizeMode, rulesFor } from '../../lib/appointment-modes.js';
import {
  ACTIVE_APPOINTMENT_STATUSES,
  generateSlots,
  toBusyWindows,
  validateDateRange,
} from '../../_utils/pro-rdv.js';
import { withProRdvHandler } from '../../_utils/with-pro-rdv-handler.js';

const MAX_RANGE_DAYS = 31;

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const proCtx = requireProStructureContext(req, res);
  if (!proCtx) return;

  const serviceId = String(req.query.serviceId || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  if (!serviceId) return res.status(400).json({ error: 'serviceId is required' });
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });

  let range;
  try {
    range = validateDateRange(from, to, MAX_RANGE_DAYS);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid date range' });
  }

  const service = await db.query.ProRdvService.findFirst({
    where: eq(ProRdvService.id, serviceId),
  });
  // R12: another organization's service answers exactly like an unknown one (no existence oracle)
  if (!service || service.structureId !== proCtx.structureId) return res.status(404).json({ error: 'Service not found' });

  // PKG-3: slots of ONE modality (default in person), from the opening periods that serve it
  const mode = req.query?.mode ? normalizeMode(req.query.mode) : 'IN_PERSON';
  if (!mode) return res.status(400).json({ error: 'Invalid mode' });
  const rules = rulesFor(await db.query.ProAvailabilityRule.findMany({
    where: and(
      eq(ProAvailabilityRule.structureId, proCtx.structureId),
      eq(ProAvailabilityRule.isActive, true)
    ),
    orderBy: (par, { asc }) => [asc(par.weekday), asc(par.startTime)],
  }), mode);

  const appointments = await db.query.ProAppointment.findMany({
    where: and(
      eq(ProAppointment.structureId, proCtx.structureId),
      inArray(ProAppointment.status, ACTIVE_APPOINTMENT_STATUSES),
      lt(ProAppointment.startAt, range.to),
      gt(ProAppointment.endAt, range.from)
    ),
    columns: {
      id: true,
      startAt: true,
      endAt: true,
      status: true,
    },
    with: {
      service: {
        columns: {
          bufferBeforeMinutes: true,
          bufferAfterMinutes: true,
        },
      },
    },
  });

  const timeOffs = await db.query.ProTimeOff.findMany({
    where: and(
      eq(ProTimeOff.structureId, proCtx.structureId),
      // R24 (owner decision R18.5): a closure of the structure, or this professional's own absence (a colleague's absence leaves the structure open)
      or(isNull(ProTimeOff.proUserId), eq(ProTimeOff.proUserId, proCtx.userId)),
      lt(ProTimeOff.startAt, range.to),
      gt(ProTimeOff.endAt, range.from)
    ),
    columns: {
      startAt: true,
      endAt: true,
    },
  });

  const busyWindows = [
    ...toBusyWindows(appointments),
    ...timeOffs.map((off /** @type {any} */) => ({
      start: off.startAt,
      end: off.endAt,
    })),
  ];

  const slots = generateSlots({
    rules,
    from: range.from,
    to: range.to,
    durationMinutes: service.durationMinutes,
    bufferBeforeMinutes: service.bufferBeforeMinutes,
    bufferAfterMinutes: service.bufferAfterMinutes,
    busyWindows,
  }).filter((slot) => new Date(slot.startAt).getTime() > Date.now());   // PKG-3 / B02: a slot that has already started is not offered (also to the team)

  return res.status(200).json({
    slots,
    meta: {
      serviceId: service.id,
      timezone: rules[0]?.timezone || 'Europe/Paris',
      durationMinutes: service.durationMinutes,
      bufferBeforeMinutes: service.bufferBeforeMinutes,
      bufferAfterMinutes: service.bufferAfterMinutes,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      total: slots.length,
    },
  });
}

export default withProRdvHandler('pro.slots', handler);
