// @ts-nocheck
import { db } from '../../../src/db/index.js';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createPrivacyRightsService } from '../../_services/privacy.js';
import { resolveCitizen } from '../../_utils/citizen-auth.js';
import logger from '../../_utils/logger.js';
import * as Sentry from '@sentry/node';
import { dsrDeadline } from '../../_services/dsr-deadline.js';

/**
 * DELETE /api/auth/delete-account
 *
 * RGPD right-to-erasure entrypoint.
 *
 * WS6 policy intentionally does not erase immediately:
 * deletion is HUMAN_REVIEW_REQUIRED. This endpoint records a DSR request,
 * moves it to IN_REVIEW, and leaves the account active until an approved
 * request is executed by the DSR engine.
 *
 * Requires: authenticated citizen session (JWT cookie).
 *
 * PKG-11 / C21: GET returns the state of the latest erasure request (the screen used to forget it on reload and never said when it was refused or blocked by a
 * legal hold); DELETE while a request is still open returns that request instead of filing a duplicate. Approval / execution: api/_handlers/admin/dsr-erasure.js.
 *
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    if (req.method !== 'DELETE' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // PKG-11 audit: the account behind the session is re-read (exists, verified, same e-mail), as on every other account route
    const citizen = await resolveCitizen(req);
    if (!citizen) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const { id: userId } = citizen;
    const latest = async () => (await db.execute(sql`SELECT id, status, "createdAt", "reviewOutcome" AS o FROM "DSRRequest" WHERE "subjectId" = ${userId} AND "requestType" = 'DELETE' ORDER BY "createdAt" DESC LIMIT 1`)).rows[0] || null;
    // launch-readiness item 63: the person sees by when the answer is due (one month, GDPR art. 12(3))
    const view = (r) => (r ? { requestId: r.id, status: r.status, ...(['COMPLETED', 'REJECTED'].includes(r.status) ? {} : { dueAt: dsrDeadline(r.createdAt).dueAt }),
      ...(r.status === 'REJECTED' && r.o?.reason ? { reason: r.o.reason } : {}) } : null);
    if (req.method === 'GET') {
        try { return res.status(200).json({ ok: true, request: view(await latest()) }); }
        catch { return res.status(500).json({ error: 'Erreur lors de la lecture de la demande' }); }
    }

    try {
        // R12: one request per person even when the button is pressed twice at once — the check and the creation run under a per-person lock
        const outcome = await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'dsr-delete:' + userId}, 0))`);
            const open = (await tx.execute(sql`SELECT id, status, "createdAt", "reviewOutcome" AS o FROM "DSRRequest" WHERE "subjectId" = ${userId} AND "requestType" = 'DELETE' ORDER BY "createdAt" DESC LIMIT 1`)).rows[0] || null;
            if (open && ['IDENTITY_OR_AUTHORITY_CHECK', 'IN_REVIEW', 'APPROVED', 'EXECUTING', 'BLOCKED'].includes(open.status)) return { open };
            logger.info('[GDPR] Account deletion request received');
            const privacyService = createPrivacyRightsService({ db: tx, cryptoLib: crypto });
            return { request: await privacyService.requestDeletion(userId) };
        });
        if (outcome.open) {
            return res.status(202).json({ ok: true, ...view(outcome.open), message: 'Une demande de suppression est déjà en cours d’examen.' });
        }
        const request = outcome.request;

        logger.info('[GDPR] Account deletion request queued for review', {
            requestId: request.id,
            status: request.status,
        });

        return res.status(202).json({
            ok: true,
            requestId: request.id,
            status: request.status,
            message: 'Votre demande de suppression a été enregistrée et doit être examinée avant effacement.',
        });
    } catch (error) {
        if (error?.code === 'SUBJECT_NOT_FOUND') {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }

        logger.error('[GDPR] Account deletion request failed', {
            // @ts-ignore
            code: error?.code || 'UNEXPECTED_ERROR',
        });
        Sentry.captureException(error);
        return res.status(500).json({ error: 'Erreur lors de la demande de suppression du compte' });
    }
}
