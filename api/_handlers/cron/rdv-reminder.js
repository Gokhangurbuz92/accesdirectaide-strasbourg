// @ts-nocheck
import logger from '../../_utils/logger.js';
import { env } from '../../_utils/env.js';
// @ts-nocheck
import { getCronAuth } from '../../_utils/cronAuth.js';
import { db } from '../../../src/db/index.js';
import { ProAppointment, ProUser, AuditLog } from '../../../src/db/schema.js';
import { gte, lt, and, inArray, eq, isNull, or, sql } from 'drizzle-orm';
import { sendMail } from '../../_utils/mailer.js';
import { createNotification } from '../../_handlers/pro/notifications.js';
import { withLock } from '../../_utils/pipelineLock.js';
import { canNotify } from '../../_services/citizen-account.js';
import { formatParisDate, formatParisTime, noticeCitizen, parisDayWindow, recordNotice } from '../../_services/appointment-notices.js';
import { MODE_LABELS, modeLabel, locationOf, locationText } from '../../lib/appointment-modes.js';
import { buildAppUrl } from '../../_utils/user-auth.js';
import { isSmsSendWindow, normalizeFrenchPhone, optOutReady, withOptOut } from '../../lib/sms-policy.js';

/**
 * Cron: RDV J-1 Reminder
 *
 * GET /api/cron/rdv-reminder
 *
 * Runs daily (08:00 UTC). Finds all ProAppointments scheduled
 * for tomorrow and sends email reminders to:
 *   1. The beneficiary (if email available via SharedDiagnostic)
 *   2. The pro agent (for their own preparation)
 *
 * Also creates in-app ProNotification for the agent.
 *
 * Uses claim-before-send pattern to ensure idempotency:
 *   1. Query appointments WHERE date = tomorrow AND reminder_sent_at IS NULL
 *   2. CLAIM each appointment via UPDATE...RETURNING before sending
 *   3. If send fails, release the claim
 */
export default async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Auth: CRON_SECRET only (Vercel Cron sends it as a Bearer token; a user-agent proves nothing)
    const auth = getCronAuth(req);

    if (!auth.ok) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const result = await withLock('rdv-reminder', async () => {
            // Find appointments for tomorrow (J+1) — PKG-11 audit pass 2: « demain » for a person in Strasbourg (Paris calendar day), not the server's UTC day
            const { start: tomorrowStart, end: tomorrowEnd } = parisDayWindow(new Date(), 1);

            const appointments = await db.query.ProAppointment.findMany({
                where: and(
                    gte(ProAppointment.startAt, tomorrowStart),
                    lt(ProAppointment.startAt, tomorrowEnd),
                    // PKG-3 / B06: every ACTIVE status (citizen bookings are 'confirmed', structure-created ones 'booked'; 'pending' kept for older rows)
                    inArray(ProAppointment.status, ['booked', 'requested', 'confirmed', 'pending']),
                    isNull(ProAppointment.reminder_sent_at)
                ),
                with: {
                    createdByProUser: {
                        columns: {
                            id: true,
                            email: true,
                            structureId: true,
                            notificationEmailEnabled: true,
                        },
                    },
                    structure: { columns: { nom: true, adresse: true, code_postal: true, ville: true, accessibilite_pmr: true, verification_status: true } },
                },
            });

            if (appointments.length === 0) {
                return {
                    ok: true,
                    message: 'Aucun RDV prévu demain.',
                    reminders: 0,
                };
            }

            let emailsSent = 0;
            let smsSent = 0;
            let smsSkippedNoConsent = 0;
            let smsQuietHours = 0;
            let smsChannelInactive = 0;
            let notificationsCreated = 0;
            let skipped = 0;
            const errors = [];

            for (const rdv of appointments) {
                // PKG-3 / B06: an appointment booked by the person has no creating agent; it used to be skipped entirely (no reminder at all). The agent part is now optional.
                const agent = rdv.createdByProUser || null;

                // STEP 1: Claim the appointment using a temporary lock
                const claimed = await db.update(ProAppointment)
                    .set({ reminder_locked_at: new Date() })
                    .where(and(
                        eq(ProAppointment.id, rdv.id),
                        isNull(ProAppointment.reminder_sent_at),
                        // Claim if not locked OR locked more than 15 minutes ago (stale/abandoned)
                        or(
                            isNull(ProAppointment.reminder_locked_at),
                            sql`${ProAppointment.reminder_locked_at} < NOW() - INTERVAL '15 minutes'`
                        )
                    ))
                    .returning({ id: ProAppointment.id });

                if (!claimed || claimed.length === 0) {
                    // Already claimed by another instance — skip
                    skipped++;
                    continue;
                }

                // STEP 2: SEND notifications — PKG-11 audit pass 2: success is counted PER appointment (the run-wide counters used to mark a fully failed
                // appointment as sent as soon as an earlier one had succeeded), and the date / time are those of Paris
                let sendFailed = false;
                let reached = 0;

                const dateStr = formatParisDate(rdv.startAt);
                const timeStr = formatParisTime(rdv.startAt);

                // 0. The person of the appointment (verified account, e-mail reminders allowed: canNotify email/reminder), with the modality and the place / the video access
                const modeLine = rdv.mode === 'VIDEO'
                    ? `Modalité : ${MODE_LABELS.VIDEO}. Accès sécurisé depuis Mes rendez-vous, 15 minutes avant (aucun lien par e-mail).`
                    : `Modalité : ${MODE_LABELS.IN_PERSON}.\n${locationText(locationOf(rdv.structure))}`;
                const citizenStatus = await noticeCitizen(rdv, 'REMINDER_J1', {
                    subject: `Rappel : rendez-vous demain ${dateStr} à ${timeStr}`,
                    text: `Rappel : vous avez rendez-vous demain ${dateStr} à ${timeStr}${rdv.structure?.nom ? ` avec ${rdv.structure.nom}` : ''}.\n${modeLine}\n\nGérer mes rendez-vous : ${buildAppUrl('/compte/rendez-vous')}`,
                });
                if (citizenStatus === 'PROVIDER_ACCEPTED') { emailsSent++; reached++; }   // PKG-5: accepted by the provider (not a confirmed delivery)

                // 1. Send email to agent (if enabled)
                if (agent && agent.notificationEmailEnabled && agent.email) {
                    try {
                        const out = await sendMail({
                            to: agent.email,
                            subject: `📅 Rappel RDV demain — ${dateStr} à ${timeStr}`,
                            text: `Bonjour,\n\nVous avez un rendez-vous prévu demain :\n\n📅 Date : ${dateStr}\n🕐 Heure : ${timeStr}\n📝 Type : ${rdv.type || 'Rendez-vous'}\n📍 Mode : ${modeLabel(rdv.mode)}\n\nConnectez-vous à AccesDirectAide pour voir les détails.\n\nCordialement,\nL'équipe AccesDirectAide`,
                            html: `
                                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                                    <h2 style="color: #4F46E5;">📅 Rappel de rendez-vous</h2>
                                    <p>Bonjour,</p>
                                    <p>Vous avez un rendez-vous prévu <strong>demain</strong> :</p>
                                    <table style="background: #F8FAFC; border-radius: 8px; padding: 16px; width: 100%; margin: 16px 0;">
                                        <tr><td style="padding: 8px; color: #64748B;">📅 Date</td><td style="padding: 8px; font-weight: bold;">${dateStr}</td></tr>
                                        <tr><td style="padding: 8px; color: #64748B;">🕐 Heure</td><td style="padding: 8px; font-weight: bold;">${timeStr}</td></tr>
                                        <tr><td style="padding: 8px; color: #64748B;">📝 Type</td><td style="padding: 8px;">${rdv.type || 'Rendez-vous'}</td></tr>
                                        <tr><td style="padding: 8px; color: #64748B;">📍 Mode</td><td style="padding: 8px;">${modeLabel(rdv.mode)}</td></tr>
                                    </table>
                                    <p style="color: #64748B; font-size: 12px;">— L'équipe AccesDirectAide</p>
                                </div>
                            `,
                            category: 'rdv-reminder',
                        });
                        if (out?.accepted) { emailsSent++; reached++; }
                        else { sendFailed = true; errors.push({ rdvId: rdv.id, type: 'email', error: 'NOT_ACCEPTED' }); }   // pass 2: a refused mail is a failure
                    } catch (err) {
                        sendFailed = true;
                        errors.push({ rdvId: rdv.id, error: err.message });
                    }
                }

                // 2. Create in-app notification for agent
                if (agent) try {
                    await createNotification({
                        userId: agent.id,
                        structureId: agent.structureId,
                        type: 'rdv_new',
                        title: `RDV demain à ${timeStr}`,
                        message: `Vous avez un ${rdv.type || 'rendez-vous'} prévu demain ${dateStr} à ${timeStr}.`,
                        metadata: {
                            appointmentId: rdv.id,
                            startAt: rdv.startAt,
                        },
                    });
                    notificationsCreated++; reached++;
                } catch (err) {
                    sendFailed = true;
                    // @ts-ignore
                    errors.push({ rdvId: rdv.id, type: 'notification', error: err.message });
                }

                // 3. SMS reminder to the beneficiary — K0/C20: only when the appointment's own citizen account holds a LIVE consent for SMS reminders
                //    (preference on + latest ledger decision "yes"). A number typed by someone else, or a booking without an account, never gets an SMS.
                const smsAllowed = Boolean(rdv.beneficiaryPhone && rdv.citizenUserId) && await canNotify(rdv.citizenUserId, 'sms', 'reminder').catch(() => false);
                if (rdv.beneficiaryPhone && !smsAllowed) { smsSkippedNoConsent++; await recordNotice(rdv.id, 'REMINDER_J1', 'citizen', 'sms', 'NO_CONSENT'); }
                const inWindow = isSmsSendWindow();   // PKG-11 / N02: no SMS 20:00-08:00 Paris (the scheduled run is 08:00 UTC); outside it the SMS is not sent and the notice says so
                if (smsAllowed && !inWindow) { smsQuietHours++; await recordNotice(rdv.id, 'REMINDER_J1', 'citizen', 'sms', 'NOT_DELIVERED'); }
                // N02: no SMS at all while a « STOP » reply cannot be honoured (channel inactive); recorded honestly
                const channelReady = optOutReady();
                if (smsAllowed && inWindow && !channelReady) { smsChannelInactive++; await recordNotice(rdv.id, 'REMINDER_J1', 'citizen', 'sms', 'NOT_DELIVERED'); }
                if (smsAllowed && inWindow && channelReady && env.twilio.sid && env.twilio.authToken && env.twilio.from) {
                    try {
                        const smsBody = withOptOut(`Rappel ADA : Votre RDV est prévu demain ${dateStr} à ${timeStr}. Pour annuler ou reporter, consultez votre email de confirmation.`);
                        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${env.twilio.sid}/Messages.json`;
                        const twilioBody = new URLSearchParams({
                            To: normalizeFrenchPhone(rdv.beneficiaryPhone) || rdv.beneficiaryPhone.replace(/\s/g, ''),   // pass 2: E.164 (+33…)
                            From: env.twilio.from,
                            Body: smsBody,
                        });
                        const smsRes = await fetch(twilioUrl, {
                            method: 'POST',
                            headers: {
                                Authorization: `Basic ${Buffer.from(`${env.twilio.sid}:${env.twilio.authToken}`).toString('base64')}`,
                                'Content-Type': 'application/x-www-form-urlencoded',
                            },
                            body: twilioBody.toString(),
                        });
                        if (smsRes.ok) {
                            smsSent++; reached++;
                            await recordNotice(rdv.id, 'REMINDER_J1', 'citizen', 'sms', 'PROVIDER_ACCEPTED');   // PKG-5: the SMS provider accepted the request
                        } else {
                            sendFailed = true;
                            errors.push({ rdvId: rdv.id, type: 'sms', error: `Twilio ${smsRes.status}` });   // pass 2: never the provider's body (it can carry the number)
                        }
                    } catch (err) {
                        sendFailed = true;
                        // @ts-ignore
                        errors.push({ rdvId: rdv.id, type: 'sms', error: err.message });
                    }
                }

                // STEP 3: Handle results and finalize state
                if (sendFailed && reached === 0) {
                    // ALL failed -> release the claim so it can be retried
                    try {
                        await db.update(ProAppointment)
                            .set({ reminder_locked_at: null })
                            .where(eq(ProAppointment.id, rdv.id));
                    } catch (releaseErr) {
                        // @ts-ignore
                        logger.error({ rdvId: rdv.id, error: releaseErr.message }, 'Failed to release claim');
                    }
                } else {
                    // At least ONE succeeded -> mark as officially sent
                    try {
                        await db.update(ProAppointment)
                            .set({ reminder_sent_at: new Date() })
                            .where(eq(ProAppointment.id, rdv.id));
                    } catch (successErr) {
                        // @ts-ignore
                        logger.error({ rdvId: rdv.id, error: successErr.message }, 'Failed to record successful send');
                    }
                }
            }

            // Audit log
            await db.insert(AuditLog).values({
                action: 'CRON_RDV_REMINDER',
                entityId: 'system',
                entityType: 'CRON',
                details: JSON.stringify({
                    appointmentsFound: appointments.length,
                    emailsSent,
                    notificationsCreated,
                    skipped,
                    errors: errors.length,
                }),
                ipHash: 'CRON',
            }).catch(() => { });

            logger.info({
                appointmentsFound: appointments.length,
                emailsSent,
                smsSent,
                smsSkippedNoConsent,
                smsQuietHours,
                smsChannelInactive,
                notificationsCreated,
                skipped,
                errors: errors.length,
            }, '[Cron] RDV J-1 reminder completed');

            return {
                ok: true,
                appointmentsFound: appointments.length,
                emailsSent,
                smsSent,
                smsSkippedNoConsent,
                smsQuietHours,
                smsChannelInactive,
                notificationsCreated,
                skipped,
                errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
            };
        }, { ttl: 600 });

        return res.status(200).json(result);
    } catch (error) {
        // @ts-ignore
        if (error.message?.includes('already running')) {
            logger.warn('[Cron] RDV reminder already running, skipping');
            return res.status(409).json({ error: 'RDV reminder already running' });
        }
        logger.error({ err: error }, '[Cron] RDV reminder failed');
        return res.status(500).json({ error: 'Cron RDV reminder failed.' });
    }
}
