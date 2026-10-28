// @ts-nocheck
import { and, eq } from 'drizzle-orm';
import { db } from '../../../../src/db/index.js';
import { ProAppointment } from '../../../../src/db/schema.js';
import { logProAudit, requireProStructureContext } from '../../../_utils/auth.js';
import { withProRdvHandler } from '../../../_utils/with-pro-rdv-handler.js';
import { issueJoin, joinRefusal, newRoomNonce, publicVideoStatus } from '../../../lib/video-provider.js';
import { formatParis, noticeCitizen } from '../../../_services/appointment-notices.js';
import { buildAppUrl } from '../../../_utils/user-auth.js';
import { clientIp } from '../../../_utils/client-ip.js';

/**
 * PKG-3 / B07 — POST /api/pro/appointments/visio { appointmentId, action: 'approve' | 'revoke' | 'join' } — a member of the appointment's structure only.
 * approve: the structure validates video for a VIDEO appointment (only while the provider is activated); a fresh room nonce is drawn, so a revoked approval can never be
 * reused. revoke: withdraws it (the room is forgotten). join: a moderator token under the same rules as the person (active, approved, consented, inside the time window).
 * The person is told of an approval / withdrawal without any link (access is from Mes rendez-vous). Audit entries name the appointment only — never the room or a token.
 */
async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  const proCtx = requireProStructureContext(req, res);
  if (!proCtx) return undefined;
  const appointmentId = String(req.body?.appointmentId || '').trim(); const action = String(req.body?.action || '').trim();
  if (!appointmentId || !['approve', 'revoke', 'join'].includes(action)) return res.status(400).json({ error: 'appointmentId and a valid action are required' });
  const appointment = await db.query.ProAppointment.findFirst({ where: (pa, { eq: e, and: a }) => a(e(pa.id, appointmentId), e(pa.structureId, proCtx.structureId)) });
  if (!appointment) return res.status(404).json({ error: 'Rendez-vous introuvable' });
  if (appointment.mode !== 'VIDEO') return res.status(409).json({ error: 'NOT_A_VIDEO_APPOINTMENT', message: 'Ce rendez-vous a lieu en présentiel : la visio ne peut pas y être ajoutée.' });
  if (!['booked', 'requested', 'confirmed'].includes(String(appointment.status || '').toLowerCase())) return res.status(409).json({ error: 'APPOINTMENT_NOT_ACTIVE', message: 'Ce rendez-vous n’est plus actif.' });
  const ip = clientIp(req);
  if (action === 'join') {
    const refusal = joinRefusal(appointment);
    if (refusal) return res.status(refusal.status).json({ error: refusal.code, message: refusal.message, ...(refusal.opensAt ? { opensAt: refusal.opensAt } : {}) });
    await logProAudit('VISIO_JOIN_ISSUED', proCtx.userId, proCtx.structureId, { appointmentId: appointment.id }, ip);
    return res.status(200).json({ join: issueJoin(appointment, 'pro') });
  }
  if (action === 'approve') {
    if (!publicVideoStatus().available) return res.status(503).json({ error: 'VIDEO_DISABLED', message: 'La visio n’est pas activée sur ce service pour le moment.' });
    const [row] = await db.update(ProAppointment).set({ visioApprovedAt: new Date(), visioApprovedByProUserId: proCtx.userId, visioRoomId: newRoomNonce(), visioEnabled: true, visioStartedAt: null })
      .where(and(eq(ProAppointment.id, appointment.id), eq(ProAppointment.structureId, proCtx.structureId))).returning();
    await logProAudit('VISIO_APPROVED', proCtx.userId, proCtx.structureId, { appointmentId: appointment.id }, ip);
    await noticeCitizen(row, 'VISIO_APPROVED', { subject: 'Votre rendez-vous en visio est validé - Accès Direct Aide',
      text: `La structure a validé la visio pour votre rendez-vous du ${formatParis(row.startAt)}.\nL’accès sécurisé se fait depuis Mes rendez-vous, à partir de 15 minutes avant l’heure : ${buildAppUrl('/compte/rendez-vous')}\nAucun lien n’est envoyé par e-mail. Aucun enregistrement.` });
    return res.status(200).json({ ok: true, video: { approved: true } });
  }
  const [row] = await db.update(ProAppointment).set({ visioApprovedAt: null, visioApprovedByProUserId: null, visioRoomId: null, visioEnabled: false })
    .where(and(eq(ProAppointment.id, appointment.id), eq(ProAppointment.structureId, proCtx.structureId))).returning();
  await logProAudit('VISIO_REVOKED', proCtx.userId, proCtx.structureId, { appointmentId: appointment.id }, ip);
  await noticeCitizen(row, 'VISIO_REVOKED', { subject: 'Modification de votre rendez-vous en visio - Accès Direct Aide',
    text: `La structure a retiré la validation de la visio pour votre rendez-vous du ${formatParis(row.startAt)}. Elle vous recontactera ; vous pouvez aussi la joindre ou gérer ce rendez-vous depuis Mes rendez-vous : ${buildAppUrl('/compte/rendez-vous')}` });
  return res.status(200).json({ ok: true, video: { approved: false } });
}

export default withProRdvHandler('pro.appointments.visio', handler);
