// @ts-nocheck
import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '../../../../src/db/index.js';
import { ProAppointment } from '../../../../src/db/schema.js';
import { requireProStructureContext } from '../../../_utils/auth.js';
import { withProRdvHandler } from '../../../_utils/with-pro-rdv-handler.js';
import { buildCalendarIcs } from '../../../_utils/ics.js';
import { locationOf } from '../../../lib/appointment-modes.js';
import { SENSITIVITY, sensitivityReviewEnforced } from '../../../lib/service-sensitivity.js';
import { readServiceSensitivityMap } from '../../../_services/service-sensitivity-review.js';

/**
 * PKG-3 / B10 — GET /api/pro/appointments/ics?from=&to= : the structure's appointments as one .ics file (at most 92 days, 500 events), for any calendar application.
 * Authenticated download (no subscription URL, no token in a link, nothing stored). Events carry the service, the modality / address — never the person's name or notes.
 * R46 (N05 × R45 minimal-notification rule): a calendar file is synchronised to phones and third-party calendar services, so an event of a verified
 * SENSITIVE service — and, where the review is enforced (Production, Preview, restricted beta), of a service not yet verified ordinary — is exported with
 * the neutral summary « RDV - Rendez-vous », never the service's name. (LAB development/test keeps the name of an unreviewed service, as its booking does.)
 */
async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const proCtx = requireProStructureContext(req, res);
  if (!proCtx) return undefined;
  const from = req.query?.from ? new Date(String(req.query.from)) : new Date(Date.now() - 7 * 86400000);
  const to = req.query?.to ? new Date(String(req.query.to)) : new Date(Date.now() + 60 * 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to - from > 92 * 86400000) return res.status(400).json({ error: 'Période invalide (92 jours au plus).' });
  const rows = await db.query.ProAppointment.findMany({
    where: and(eq(ProAppointment.structureId, proCtx.structureId), gte(ProAppointment.startAt, from), lte(ProAppointment.startAt, to)),
    orderBy: (pa, { asc }) => [asc(pa.startAt)], limit: 500,
    columns: { id: true, serviceId: true, startAt: true, endAt: true, status: true, mode: true, rescheduleCount: true },
    with: { service: { columns: { name: true } }, structure: { columns: { nom: true, adresse: true, code_postal: true, ville: true, accessibilite_pmr: true, verification_status: true, data_origin: true } } },
  });
  const sensitivity = await readServiceSensitivityMap(proCtx.structureId);   // absent = unknown; a read failure = an empty map (every event neutral)
  const enforced = sensitivityReviewEnforced();
  const serviceLabel = (a) => { const v = sensitivity.get(a.serviceId) || SENSITIVITY.UNKNOWN; return v === SENSITIVITY.SENSITIVE || (enforced && v !== SENSITIVITY.ORDINARY) ? 'Rendez-vous' : a.service?.name; };
  // R12 (B10): a cancelled event carries the SAME sequence as the cancellation e-mail (one above the last move) — at the old sequence calendars ignore it
  const ics = buildCalendarIcs(rows.map((a) => ({ appointmentId: a.id, startAt: a.startAt, endAt: a.endAt, serviceName: serviceLabel(a), structureName: a.structure?.nom,
    sequence: Number(a.rescheduleCount || 0) + (String(a.status).toLowerCase() === 'cancelled' ? 1 : 0),
    cancelled: String(a.status).toLowerCase() === 'cancelled', location: a.mode === 'VIDEO' ? 'À distance (visio)' : (locationOf(a.structure)?.address || '') })));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="agenda-acces-direct-aide.ics"');
  return res.status(200).send(ics);
}

export default withProRdvHandler('pro.appointments.ics', handler);
