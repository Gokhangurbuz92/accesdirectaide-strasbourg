// @ts-nocheck
import logger from '../../_utils/logger.js';
import { env } from '../../_utils/env.js';
// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { ProAppointment, SharedDiagnostic } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { logProAudit } from '../../_utils/auth.js';
import { sendMail } from '../../_utils/mailer.js';
import { resolveCitizen } from '../../_utils/citizen-auth.js';
import { holdsOwnership } from '../../_utils/share-access.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { canNotify, setPreference } from '../../_services/citizen-account.js';
import { formatParisDate, formatParisTime } from '../../_services/appointment-notices.js';
import { isSmsSendWindow, normalizeFrenchPhone, optOutReady, withOptOut } from '../../lib/sms-policy.js';
import { clientIp } from '../../_utils/client-ip.js';

const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const NOT_FOUND = { error: 'Rendez-vous introuvable.' };

/**
 * K0 / C20: the caller must BE the person the appointment belongs to: either their verified account session, or the owner secret of a dossier attached to
 * that same account (the passport page). An appointment id alone is an identifier, never a credential: anything else is the same 404 as an unknown id.
 * @returns {Promise<boolean>}
 */
async function ownsAppointment(appointment, req, shareId) {
    if (!appointment.citizenUserId) return false;   // a booking without an account has no person who could have consented here
    const citizen = await resolveCitizen(req).catch(() => null);
    if (citizen && citizen.id === appointment.citizenUserId) return 'AUTHENTICATED_SESSION';
    if (!shareId) return false;
    const shared = await db.query.SharedDiagnostic.findFirst({ where: eq(SharedDiagnostic.id, String(shareId)), columns: { id: true, ownerCitizenId: true, rightsSecretHash: true, shareTokenHash: true, expiresAt: true } });
    return shared && shared.ownerCitizenId === appointment.citizenUserId && (await holdsOwnership(shared, req)) ? 'DOSSIER_OWNER_SECRET' : false;   // PKG-11 audit: the proof recorded in the ledger
}

/**
 * sendEmailFallback — envoie un email de secours quand le SMS échoue.
 * Ne crash jamais — absorbe les erreurs silencieusement.
 */
// @ts-ignore
async function sendEmailFallback(appointment, phoneNumber, smsMessage) {
    try {
        const beneficiaryEmail = appointment.beneficiaryEmail;
        if (!beneficiaryEmail) {
            logger.warn('[SMS-FALLBACK] Pas d\'email bénéficiaire pour le fallback');
            return;
        }

        await sendMail({
            to: beneficiaryEmail,
            subject: 'Rappel de votre rendez-vous — AccesDirectAide',
            text: `${smsMessage}\n\n(Ce message vous est envoyé car le rappel SMS n'a pas pu être délivré.)`,
            html: `<p>${escapeHtml(smsMessage)}</p><p style="color:#666;font-size:12px"><em>Ce message vous est envoyé car le rappel SMS n'a pas pu être délivré.</em></p>`,   // the structure name is data, never markup
            category: 'sms_fallback',
        });

        logger.info('[SMS-FALLBACK] Email de secours transmis');   // no address in logs
    } catch (emailErr) {
        // Ne jamais crash le handler principal
        // @ts-ignore
        logger.error('[SMS-FALLBACK] Erreur email de secours:', emailErr.message);
    }
}

// Mask phone for audit: 06 12 34 56 78 → 06 ** ** ** 78
/**
 * SMS Notification API (Public)
 *
 * POST /api/public/sms-notify
 *
 * Registers an SMS reminder for an appointment. In production,
 * this connects to Twilio/Vonage. Currently logs via structured logger.
 *
 * Body:
 * - appointmentId: string
 * - phoneNumber: string (French format)
 * - action: 'subscribe' | 'unsubscribe'
 * @param {string} phone
 */
function maskPhone(phone) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 4) return '****';
    return digits.slice(0, 2) + ' ** ** ** ' + digits.slice(-2);
}

// French phone regex
const FRENCH_PHONE_RE = /^(?:(?:\+|00)33|0)\s*[1-9](?:[\s.\-]*\d{2}){4}$/;

export default async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    const { appointmentId, phoneNumber, action = 'subscribe', shareId } = req.body || {};
    res.setHeader('Cache-Control', 'no-store');

    if (!appointmentId || !['subscribe', 'unsubscribe'].includes(action) || (action === 'subscribe' && !phoneNumber)) {
        return res.status(400).json({ error: 'appointmentId et phoneNumber requis.' });
    }

    if (action === 'subscribe' && !FRENCH_PHONE_RE.test(phoneNumber)) {
        return res.status(400).json({ error: 'Numéro de téléphone français invalide.' });
    }

    const limit = await checkRateLimit('CITIZEN_ACCOUNT_WRITE', `sms:${getClientIp(req)}`);
    if (!limit.allowed) return res.status(getRateLimitStatus(limit)).json(limit.error || { error: 'Too many requests' });

    try {
        const appointment = await db.query.ProAppointment.findFirst({
            where: eq(ProAppointment.id, appointmentId),
            with: {
                structure: { columns: { nom: true } },
            },
        });

        const proof = appointment ? await ownsAppointment(appointment, req, shareId) : false;
        if (!appointment || !proof) {
            return res.status(404).json(NOT_FOUND);
        }

        if (action === 'unsubscribe') {
            // the withdrawal is recorded in the consent ledger (latest decision wins) and the number is forgotten
            await setPreference(appointment.citizenUserId, { channel: 'sms', category: 'reminder', enabled: false, collection: { channel: 'sms_notify_page', proofLevel: proof } });
            await db.update(ProAppointment).set({ beneficiaryPhone: null }).where(eq(ProAppointment.id, appointmentId));
            return res.status(200).json({ ok: true, message: 'Rappel SMS désactivé.' });
        }
        if (appointment.status === 'cancelled' || new Date(appointment.startAt).getTime() <= Date.now()) {
            return res.status(409).json({ error: 'Ce rendez-vous est passé ou annulé.' });
        }

        // the explicit opt-in on this screen IS the consent: recorded server-side (age policy applies) BEFORE any number is stored or any SMS sent
        const consent = await setPreference(appointment.citizenUserId, { channel: 'sms', category: 'reminder', enabled: true, consentGiven: true, collection: { channel: 'sms_notify_page', proofLevel: proof } });
        if (!consent.ok) return res.status(consent.status || 400).json({ error: consent.code, message: consent.message });
        await db.update(ProAppointment).set({ beneficiaryPhone: phoneNumber.replace(/\s/g, '') }).where(eq(ProAppointment.id, appointmentId));

        // Format message for logging (production: send via Twilio)
        const proName = appointment.structure?.nom || 'votre structure';

        const dateStr = `${formatParisDate(appointment.startAt)} à ${formatParisTime(appointment.startAt)}`;   // PKG-11 audit pass 2: Paris time (servers run in UTC)

        // the structure's own name and the appointment's own mode (the former text hard-coded "CCAS Strasbourg" for every in-person appointment)
        const mode = appointment.visioEnabled ? 'Lien visio dans votre Passeport' : 'Sur place';

        const message = withOptOut(`Rappel ADA : Votre RDV avec ${proName} est prévu le ${dateStr}. ${mode}.`);
        // PKG-11 / N02: no SMS 20:00-08:00 Paris — at night the confirmation SMS is not sent (the reminder the day before still is). Audit pass 2: nor while the
        // person may not be notified (a restriction of processing, the age policy): the same canNotify as every other notice
        const sendNow = isSmsSendWindow() && await canNotify(appointment.citizenUserId, 'sms', 'reminder').catch(() => false);

        // Send SMS via Twilio REST API (no SDK dependency)
        const twilioSid = env.twilio.sid;
        const twilioAuth = env.twilio.authToken;
        const twilioFrom = env.twilio.from;
        const smsConfigured = Boolean(twilioSid && twilioAuth && twilioFrom) && optOutReady();   // N02: the channel is active only when « STOP » is honoured

        if (sendNow && smsConfigured) {
            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
            const twilioBody = new URLSearchParams({
                To: normalizeFrenchPhone(phoneNumber) || phoneNumber.replace(/\s/g, ''),
                From: twilioFrom,
                Body: message,
            });

            try {
                const twilioRes = await fetch(twilioUrl, {
                    method: 'POST',
                    headers: {
                        Authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioAuth}`).toString('base64')}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: twilioBody.toString(),
                });

                if (!twilioRes.ok) {
                    const errBody = await twilioRes.text().catch(() => '');
                    let errCode = null;
                    try { errCode = JSON.parse(errBody)?.code; } catch { /* ignore */ }

                    // Graceful fallback for known Twilio errors
                    if (errCode === 20404) {
                        logger.error('[SMS] Twilio HORS CRÉDIT (20404) — bascule sur email de secours');
                    } else if (errCode === 21614 || errCode === 21211) {
                        logger.error(`[SMS] Numéro invalide Twilio (${errCode}): ${maskPhone(phoneNumber)}`);
                    } else {
                        logger.error(`[SMS] Twilio error (${twilioRes.status}, code=${errCode})`);   // PKG-11 audit: the provider's error text quotes the number: not logged
                    }

                    // Attempt email fallback
                    await sendEmailFallback(appointment, phoneNumber, message);
                } else {
                    const smsResult = await twilioRes.json();
                    logger.info(`[SMS] Sent to=${maskPhone(phoneNumber)} sid=${smsResult.sid}`);
                }
            } catch (twilioErr) {
                // @ts-ignore
                logger.error('[SMS] Twilio network error:', twilioErr.message);
                // Email fallback on network failure
                await sendEmailFallback(appointment, phoneNumber, message);
            }
        } else if (sendNow) {
            logger.warn(`[SMS] Twilio not configured — no SMS sent: ${maskPhone(phoneNumber)}`);
        }

        // Audit
        const ip = clientIp(req);
        await logProAudit('SMS_REMINDER_SUBSCRIBED', 'citizen', '', {
            appointmentId,
            phoneMasked: maskPhone(phoneNumber),
        }, ip).catch(() => { });

        // PKG-11 audit pass 2: « activé » only when an SMS service is configured (it used to be said whatever happened: no SMS could ever leave)
        return res.status(200).json({
            ok: true,
            smsConfigured,
            message: smsConfigured
                ? 'Votre accord est enregistré : un rappel SMS partira la veille du rendez-vous (jamais entre 20 h et 8 h).'
                : 'Votre accord est enregistré, mais l’envoi de SMS n’est pas encore actif : aucun SMS ne partira tant qu’il ne l’est pas.',
        });
    } catch (error) {
        // @ts-ignore
        logger.error('[SMS] Erreur:', error.message);
        return res.status(500).json({ error: "Échec de l'activation du rappel SMS." });
    }
}
