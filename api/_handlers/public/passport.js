// @ts-nocheck
import logger from '../../_utils/logger.js';
// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { SharedDiagnostic, ProAppointment } from '../../../src/db/schema.js';
import { eq, and, gte, ne } from 'drizzle-orm';
import { holdsOwnership } from '../../_utils/share-access.js';

/**
 * Citizen Passport API (Public)
 *
 * GET /api/public/passport?shareId=xxx      header X-Share-Owner-Secret: <owner secret>
 *
 * Returns the citizen's shared diagnostic metadata + upcoming appointments.
 * RC5: the OWNER secret is required (a shareId is an identifier, not a credential; recipients' share tokens do not open the passport).
 * Unknown id / missing / wrong secret are the same 404.
 */
export default async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    const url = new URL(req.url || '/', `https://${req.headers?.host || 'localhost'}`);
    const shareId = url.searchParams.get('shareId');

    if (!shareId) {
        return res.status(400).json({ error: 'shareId requis.' });
    }

    try {
        const shared = await db.query.SharedDiagnostic.findFirst({
            where: eq(SharedDiagnostic.id, shareId),
        });

        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        if (!shared || !(await holdsOwnership(shared, req))) {
            return res.status(404).json({ error: 'Dossier introuvable ou expiré.' });
        }

        const isExpired = new Date() > new Date(shared.expiresAt);

        // Find appointments for this citizen
        // PKG-1: the person behind the dossier is the account it is attached to (ownerCitizenId). The former read of shared.citizenUserId named a column that
        // does not exist on SharedDiagnostic, so this list was always empty.
        const personId = shared.ownerCitizenId || null;
        let appointments = [];
        if (personId) {
            appointments = await db.query.ProAppointment.findMany({
                where: and(
                    eq(ProAppointment.citizenUserId, personId),
                    gte(ProAppointment.startAt, new Date()),
                    ne(ProAppointment.status, 'cancelled')
                ),
                columns: {
                    id: true,
                    startAt: true,
                    endAt: true,
                    status: true,
                    visioEnabled: true,
                },
                // real columns only (ProRdvService has `name`, no label/mode; ProUser has no first/last name): Drizzle threw before any SQL, so every passport WITH an appointment failed
                with: {
                    service: { columns: { name: true } },
                    structure: { columns: { nom: true } },
                },
                orderBy: (pa, { asc }) => [asc(pa.startAt)],
                limit: 5,
            });
        }

        const consent = shared.results?._consent || null;

        return res.status(200).json({
            ok: true,
            passport: {
                shareId: shared.id,
                createdAt: shared.createdAt,
                expiresAt: shared.expiresAt,
                isExpired,
                hasConsent: !!consent?.signed,
                consentDate: consent?.signedAt || null,
                filesCount: (shared.results?._files || []).length,
                appointments: appointments.map((a) => ({
                    id: a.id,
                    date: a.startAt,
                    endAt: a.endAt,
                    status: a.status,
                    service: a.service?.name || 'Rendez-vous',
                    mode: a.visioEnabled ? 'visio' : 'sur_place',
                    professional: a.structure?.nom || null,
                })),
            },
        });
    } catch (error) {
        logger.error('[Passport] Erreur:', error.message);
        return res.status(500).json({ error: 'Erreur interne.' });
    }
}
