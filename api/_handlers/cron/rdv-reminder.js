// @ts-nocheck
import logger from '../../_utils/logger.js';
import { env } from '../../_utils/env.js';
// @ts-nocheck
import { getCronAuth } from '../../_utils/cronAuth.js';
import { db } from '../../../src/db/index.js';
import { ProAppointment, ProUser, AuditLog, AppointmentNotice } from '../../../src/db/schema.js';
import { gte, lt, and, inArray, eq, isNull, or, sql, count } from 'drizzle-orm';
import { mailFailure, mailLedgerStatus, sendMail } from '../../_utils/mailer.js';
import { createNotification } from '../../_handlers/pro/notifications.js';
import { withLock } from '../../_utils/pipelineLock.js';
import { canNotify } from '../../_services/citizen-account.js';
import { formatParisDate, formatParisTime, noticeCitizen, parisDayWindow, recordNotice } from '../../_services/appointment-notices.js';
import { MODE_LABELS, modeLabel, locationOf, locationText } from '../../lib/appointment-modes.js';
import { buildAppUrl } from '../../_utils/user-auth.js';
import { isSmsSendWindow, optOutReady, withOptOut } from '../../lib/sms-policy.js';
import { sendTwilioSms } from '../../_utils/twilio-sms.js';
import { reminderClaimOutcome } from '../../_utils/rdv-guest-core.js';
import { appointmentColumns, appointmentGuestSchema, columnFlags } from '../../_utils/schema-features.js';

/** R39: the person's J-1 e-mails that failed (NOT_DELIVERED / FAILED) since `since` (the start of today's Paris day) — the bound of the retries */
async function citizenReminderFailuresSince(appointmentId, since) {
    const [row] = await db.select({ n: count() }).from(AppointmentNotice).where(and(
        eq(AppointmentNotice.appointmentId, appointmentId), eq(AppointmentNotice.kind, 'REMINDER_J1'), eq(AppointmentNotice.recipient, 'citizen'),
        eq(AppointmentNotice.channel, 'email'), inArray(AppointmentNotice.status, ['NOT_DELIVERED', 'FAILED']), gte(AppointmentNotice.createdAt, since)));
    return Number(row?.n || 0);
}

/** R41-E / G6: the recipients / channels of this appointment's J-1 reminder already reached today (a retry pass never writes to them again) */
async function reachedToday(appointmentId, since) {
    const rows = await db.select({ recipient: AppointmentNotice.recipient, channel: AppointmentNotice.channel }).from(AppointmentNotice).where(and(
        eq(AppointmentNotice.appointmentId, appointmentId), eq(AppointmentNotice.kind, 'REMINDER_J1'),
        inArray(AppointmentNotice.status, ['PROVIDER_ACCEPTED', 'TEST_RECORDED', 'DELIVERED']), gte(AppointmentNotice.createdAt, since)));
    return new Set(rows.map((r) => `${r.recipient}:${r.channel}`));
}

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
 *
 * R39 — the person's e-mail (account, or an account-free booking WITH its separate reminder consent) counts like the agent's: PROVIDER_ACCEPTED or
 * TEST_RECORDED reached them; NOT_DELIVERED / FAILED (noop included) is a failure. When every attempt of a pass failed, the claim is released and
 * reminder_sent_at stays NULL, so a later run of the SAME J-1 day may retry (the selection is tomorrow's Paris day only: never earlier, never on the day
 * itself), at most REMINDER_MAX_ATTEMPTS_PER_DAY failed e-mails per appointment and per day (counted in the AppointmentNotice ledger), then it is closed.
 * Two concurrent runs never send twice: besides the pipeline lock, the per-appointment claim is a compare-and-set UPDATE (one winner).
 *
 * R41-E / G6 — reach is counted PER RECIPIENT: the agent's e-mail or in-app notice no longer closes the claim when the person's e-mail failed for a retryable
 * reason (provider unreachable, 5xx, 429, no provider yet); a permanent refusal (e.g. an address the provider rejects) closes it. Each outcome is in the
 * AppointmentNotice ledger (the agent's e-mail and in-app notice as recipient « structure »), and a retry pass skips every recipient / channel already
 * reached that day — the agent is never written to twice. The person's e-mail carries a stable Idempotency-Key (appointment + start time), so a retry within
 * the provider's 24 h never delivers a second copy. Twilio goes through sendTwilioSms (timeout). With the single scheduled run (vercel.json 0 8 * * *) a
 * released claim is retried only by a manual or a second scheduled run that day (owner decision, R41_G5_G6_G11_CLOSURE.md); the next day it is no longer J-1.
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
            const todayStart = parisDayWindow(new Date(), 0).start;   // R39: the J-1 day of these reminders (bounded retries are counted from here)
            // R40 / G10: the guest columns exist only from migration 0043 (0044 for the reminder consent); read once per run, and on an older database the
            // guest clauses are left out (no account-free booking can exist there) and only existing columns are selected / returned
            const guestSchema = await appointmentGuestSchema(db);
            const notUnconfirmedHold = guestSchema.guestBooking ? isNull(ProAppointment.guestHoldExpiresAt) : undefined;

            const appointments = await db.query.ProAppointment.findMany({
                where: and(
                    gte(ProAppointment.startAt, tomorrowStart),
                    lt(ProAppointment.startAt, tomorrowEnd),
                    // PKG-3 / B06: every ACTIVE status (citizen bookings are 'confirmed', structure-created ones 'booked'; 'pending' kept for older rows)
                    inArray(ProAppointment.status, ['booked', 'requested', 'confirmed', 'pending']),
                    isNull(ProAppointment.reminder_sent_at),
                    // R38: an account-free hold whose code was never confirmed is not an appointment (confirmed ones have it NULL). R39: a confirmed
                    // account-free booking gets the J-1 e-mail only with its separate reminder consent (noticeCitizen), NO_CONSENT otherwise
                    notUnconfirmedHold
                ),
                columns: columnFlags(guestSchema),
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

            for (const listed of appointments) {
                // PKG-3 / B06: an appointment booked by the person has no creating agent; it used to be skipped entirely (no reminder at all). The agent part is now optional.
                const agent = listed.createdByProUser || null;

                // STEP 1: Claim the appointment using a temporary lock
                const claimed = await db.update(ProAppointment)
                    .set({ reminder_locked_at: new Date() })
                    .where(and(
                        eq(ProAppointment.id, listed.id),
                        isNull(ProAppointment.reminder_sent_at),
                        // Claim if not locked OR locked more than 15 minutes ago (stale/abandoned)
                        or(
                            isNull(ProAppointment.reminder_locked_at),
                            sql`${ProAppointment.reminder_locked_at} < NOW() - INTERVAL '15 minutes'`
                        ),
                        // R39: still the same selection at claim time (not cancelled, not moved out of tomorrow, not an unconfirmed hold)
                        gte(ProAppointment.startAt, tomorrowStart),
                        lt(ProAppointment.startAt, tomorrowEnd),
                        inArray(ProAppointment.status, ['booked', 'requested', 'confirmed', 'pending']),
                        notUnconfirmedHold
                    ))
                    .returning(appointmentColumns(guestSchema));

                if (!claimed || claimed.length === 0) {
                    // Already claimed by another instance — skip
                    skipped++;
                    continue;
                }
                // R39: the row as claimed (a reminder consent withdrawn after the selection is honoured), with the relations of the selection
                const rdv = { ...listed, ...claimed[0] };

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
                // R39: an account-free booking has no account page: its personal link (only its hash is stored) moves, cancels and turns the reminder off
                const manageLine = rdv.citizenUserId
                    ? `Gérer mes rendez-vous : ${buildAppUrl('/compte/rendez-vous')}`
                    : 'Pour déplacer ou annuler ce rendez-vous, ou ne plus recevoir de rappel, utilisez le lien personnel reçu dans l’e-mail de confirmation.\nVous recevez ce rappel parce que vous l’avez demandé.';
                const done = await reachedToday(rdv.id, todayStart).catch(() => new Set());   // R41-E / G6: a retry pass skips who was already reached today
                const startKey = new Date(rdv.startAt).getTime();
                let citizenMail = null;   // the person's sendMail() result (its failure class decides a retry)
                const citizenStatus = done.has('citizen:email') ? 'PROVIDER_ACCEPTED' : await noticeCitizen(rdv, 'REMINDER_J1', {
                    subject: `Rappel : rendez-vous demain ${dateStr} à ${timeStr}`,
                    text: `Rappel : vous avez rendez-vous demain ${dateStr} à ${timeStr}${rdv.structure?.nom ? ` avec ${rdv.structure.nom}` : ''}.\n${modeLine}\n\n${manageLine}`,
                }, { sendMail: async (payload) => { citizenMail = await sendMail({ ...payload, idempotencyKey: `rdv-reminder-j1/${rdv.id}/${startKey}/citizen` }); return citizenMail; } });
                // PKG-5: accepted by the provider (not a confirmed delivery); R39: the LAB test outbox counts like the agent's, a refused / noop e-mail is a failure
                const citizenFailed = citizenStatus === 'NOT_DELIVERED' || citizenStatus === 'FAILED';
                // R41-E: retryable = provider unreachable / 5xx / 429, no provider yet (R38: retried once one is configured), or an exception; a refusal is final
                const citizenRetryable = citizenStatus === 'FAILED' || ['retryable', 'not_configured'].includes(mailFailure(citizenMail));
                if (citizenStatus === 'PROVIDER_ACCEPTED' || citizenStatus === 'TEST_RECORDED') { emailsSent++; reached++; }
                else if (citizenFailed) { sendFailed = true; errors.push({ rdvId: rdv.id, type: 'citizen_email', error: citizenRetryable ? 'NOT_ACCEPTED_RETRYABLE' : 'NOT_ACCEPTED_PERMANENT' }); }

                // 1. Send email to agent (if enabled) — R41-E: once a day (ledger « structure / email »)
                if (agent && agent.notificationEmailEnabled && agent.email && done.has('structure:email')) reached++;
                else if (agent && agent.notificationEmailEnabled && agent.email) {
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
                            idempotencyKey: `rdv-reminder-j1/${rdv.id}/${startKey}/agent/${agent.id}`,
                        });
                        await recordNotice(rdv.id, 'REMINDER_J1', 'structure', 'email', mailLedgerStatus(out));
                        // R38: « accepted » is also true for MAILER_PROVIDER=noop (nothing leaves): only a real provider's acceptance (or the LAB test outbox)
                        // counts, otherwise the reminder would be marked sent and never retried once a provider is configured
                        if (out?.outcome === 'PROVIDER_ACCEPTED' || out?.outcome === 'TEST_RECORDED') { emailsSent++; reached++; }
                        else { sendFailed = true; errors.push({ rdvId: rdv.id, type: 'email', error: 'NOT_ACCEPTED' }); }   // pass 2: a refused mail is a failure
                    } catch (err) {
                        sendFailed = true;
                        errors.push({ rdvId: rdv.id, type: 'email', error: err?.name || 'Error' });   // R41-E: never an error message (it can quote an address)
                    }
                }

                // 2. Create in-app notification for agent — R41-E: once a day (ledger « structure / in_app »)
                if (agent && done.has('structure:in_app')) reached++;
                else if (agent) try {
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
                    await recordNotice(rdv.id, 'REMINDER_J1', 'structure', 'in_app', 'DELIVERED');
                } catch (err) {
                    sendFailed = true;
                    errors.push({ rdvId: rdv.id, type: 'notification', error: err?.name || 'Error' });
                    await recordNotice(rdv.id, 'REMINDER_J1', 'structure', 'in_app', 'FAILED');
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
                if (done.has('citizen:sms')) reached++;   // R41-E: already accepted today (retry pass)
                else if (smsAllowed && inWindow && channelReady && env.twilio.sid && env.twilio.authToken && env.twilio.from) {
                    // R41-E / G6: through sendTwilioSms — a 10 s timeout, nothing logged (Twilio's error text quotes the number), only status / numeric code kept
                    const smsBody = withOptOut(`Rappel ADA : Votre RDV est prévu demain ${dateStr} à ${timeStr}. Pour annuler ou reporter, consultez votre email de confirmation.`);
                    const sms = await sendTwilioSms({ to: rdv.beneficiaryPhone, body: smsBody }, env.twilio);
                    if (sms.ok) {
                        smsSent++; reached++;
                        await recordNotice(rdv.id, 'REMINDER_J1', 'citizen', 'sms', 'PROVIDER_ACCEPTED');   // PKG-5: the SMS provider accepted the request
                    } else {
                        sendFailed = true;
                        errors.push({ rdvId: rdv.id, type: 'sms', error: `Twilio ${sms.status}${sms.code ? ` code=${sms.code}` : ''}` });   // never the provider's body (it can carry the number)
                        await recordNotice(rdv.id, 'REMINDER_J1', 'citizen', 'sms', sms.failure === 'retryable' ? 'FAILED' : 'NOT_DELIVERED');
                    }
                }

                // STEP 3: Handle results and finalize state (R39: bounded — after REMINDER_MAX_ATTEMPTS_PER_DAY failed e-mails today the claim is closed)
                const citizenFailuresToday = citizenFailed ? await citizenReminderFailuresSince(rdv.id, todayStart).catch(() => 0) : 0;
                if (reminderClaimOutcome({ sendFailed, reached, citizenFailed, citizenRetryable, citizenFailuresToday }) === 'release') {
                    // ALL failed -> release the claim so it can be retried
                    try {
                        await db.update(ProAppointment)
                            .set({ reminder_locked_at: null })
                            .where(eq(ProAppointment.id, rdv.id));
                    } catch (releaseErr) {
                        logger.error({ rdvId: rdv.id, err: { name: releaseErr?.name, code: releaseErr?.cause?.code || releaseErr?.code } }, 'Failed to release claim');
                    }
                } else {
                    // At least ONE succeeded -> mark as officially sent
                    try {
                        await db.update(ProAppointment)
                            .set({ reminder_sent_at: new Date() })
                            .where(eq(ProAppointment.id, rdv.id));
                    } catch (successErr) {
                        logger.error({ rdvId: rdv.id, err: { name: successErr?.name, code: successErr?.cause?.code || successErr?.code } }, 'Failed to record successful send');
                    }
                }
            }

            // Audit log
            await db.insert(AuditLog).values({
                action: 'CRON_RDV_REMINDER',
                actor: 'cron', entity: 'CRON', entity_id: 'rdv-reminder',   // R38: the AuditLog columns (entityId / entityType / ipHash do not exist)
                details: ({
                    appointmentsFound: appointments.length,
                    emailsSent,
                    notificationsCreated,
                    skipped,
                    errors: errors.length,
                }),
                ip_hash: 'CRON',
            }).catch((e) => logger.warn({ err: e?.message }, '[rdv-reminder] audit log not written'));

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
