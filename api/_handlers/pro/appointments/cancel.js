import { db } from '../../../../src/db/index.js';
import { ProAppointment } from '../../../../src/db/schema.js';
import { and, eq, inArray } from 'drizzle-orm';
import { requireProStructureContext } from '../../../_utils/auth.js';
import { withProRdvHandler } from '../../../_utils/with-pro-rdv-handler.js';
import { buildAppUrl } from '../../../_utils/user-auth.js';
import { noticeCitizen } from '../../../_services/appointment-notices.js';

/** @param {Date} d */
const formatParis = (d) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(d);
/**
 * @param {import('../../../_utils/http-types').ApiRequest} req
 * @param {import('../../../_utils/http-types').ApiResponse} res
 */

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const proCtx = requireProStructureContext(req, res);
  if (!proCtx) return;

  const id = String(req.body?.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Missing appointment ID' });

  const appointment = await db.query.ProAppointment.findFirst({
    where: (pa, { eq }) => eq(pa.id, id),
  });
  // R12: another organization's appointment answers exactly like an unknown one (no existence oracle)
  if (!appointment || appointment.structureId !== proCtx.structureId) return res.status(404).json({ error: 'Appointment not found' });

  const alreadyCancelled = String(appointment.status || '').toLowerCase() === 'cancelled';
  // PKG-11 audit: only an ACTIVE appointment still to come can be cancelled — an attended (done) or missed (no_show) one keeps its record, and the person is
  // not sent a cancellation for something already past; the update itself re-checks the status, so two clicks send one notice.
  const ACTIVE = ['booked', 'requested', 'confirmed', 'pending'];
  if (!alreadyCancelled && (!ACTIVE.includes(String(appointment.status || '').toLowerCase()) || new Date(appointment.startAt).getTime() <= Date.now())) {
    return res.status(409).json({ error: 'APPOINTMENT_NOT_CANCELLABLE', message: 'Ce rendez-vous est passé ou n’est plus actif : il ne peut pas être annulé.' });
  }
  const [raced] = alreadyCancelled ? [] : await db.update(ProAppointment).set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: 'PRO' })
    .where(and(eq(ProAppointment.id, id), inArray(ProAppointment.status, ACTIVE))).returning();
  const updated = alreadyCancelled ? appointment : raced || { ...appointment, status: 'cancelled' };
  const cancelledNow = Boolean(raced);

  // PKG-3 / B04: tell the person (verified account, channel allowed: canNotify email/service) with a calendar CANCEL; the outcome is recorded honestly in AppointmentNotice.
  // Generic subject: no structure name in the subject line (data minimisation, unchanged).
  if (cancelledNow) {
    await noticeCitizen(updated, 'CANCELLED_BY_STRUCTURE', {
      subject: 'Votre rendez-vous a été annulé - Accès Direct Aide',
      text: ['Votre rendez-vous a été annulé par la structure.', '', `Date prévue : ${formatParis(new Date(appointment.startAt))}`, '', `Pour reprendre rendez-vous : ${buildAppUrl('/compte/rendez-vous')}`].join('\n'),
      calendar: { appointmentId: updated.id, startAt: updated.startAt, endAt: updated.endAt, structureName: 'Accès Direct Aide', serviceName: 'Rendez-vous', sequence: Number(updated.rescheduleCount || 0) + 1, cancelled: true },
    });
  }

  return res.status(200).json({
    ok: true,
    item: {
      id: updated.id,
      status: updated.status,
      startAt: updated.startAt,
      endAt: updated.endAt,
      start_at: updated.startAt,
      end_at: updated.endAt,
    },
  });
}

export default withProRdvHandler('pro.appointments.cancel', handler);
