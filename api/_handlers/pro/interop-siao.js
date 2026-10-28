import logger from '../../_utils/logger.js';
// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { AuditLog } from '../../../src/db/schema.js';

import { env } from '../../_utils/env.js';
import { requireProAuth, requireProStructureContext } from '../../_utils/auth.js';
import { grantHasPurpose, resolveDossierForStructure } from '../../_utils/share-access.js';
import crypto from 'crypto';

/**
 * SI-SIAO Interoperability API (Pro-only)
 *
 * POST /api/pro/interop-siao
 * Body: { shareId }
 *
 * Formats a SharedDiagnostic into the national SI-SIAO standard
 * and logs the transmission in the audit trail.
 *
 * FEATURE FLAG: SIAO_ENABLED must be 'true' for actual network calls.
 * When disabled, returns { status: 'not_configured' }.
 * PKG-4 / D10: a transmission to an external public body is its OWN purpose: the citizen must have granted PURPOSE_SIAO to this organization (sharing PURP-06 or the AI
 * purpose PURP-05 never stand in for it). No screen can grant it yet (legal basis + DPO decision pending), so the transmission stays refused (fail-closed) even when the
 * flag is on. The identifier sent is a keyed pseudonym (never the dossier id); logs carry no dossier id and no provider answer body; the audit records the purpose.
 */
export const PURPOSE_SIAO = 'PURP-07';
const pseudonym = (/** @type {string} */ shareId) => crypto.createHmac('sha256', String(env.siao.apiKey || env.secrets.jwtSecret || 'ada-siao-pseudonym')).update('siao:' + String(shareId)).digest('hex').slice(0, 24);
async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    const proCtx = requireProStructureContext(req, res);
    if (!proCtx) return;

    // Feature flag guard — no SIAO calls when disabled
    const siaoEnabled = env.siao.enabled;
    if (!siaoEnabled) {
        return res.status(200).json({
            ok: false,
            status: 'not_configured',
            message: 'L\'interopérabilité SI-SIAO n\'est pas encore activée. Contactez votre administrateur pour l\'activer.',
        });
    }

    const { shareId } = req.body || {};
    if (!shareId) {
        return res.status(400).json({ error: 'shareId requis.' });
    }

    try {
        // RC5: an external (national SIAO) transmission requires an active structure grant on an unexpired dossier.
        const found = await resolveDossierForStructure(shareId, proCtx);
        if (found.status === 'not_found') {
            return res.status(404).json({ error: 'Dossier introuvable.' });
        }
        if (found.status === 'expired') {
            return res.status(410).json({ error: 'Ce dossier a expiré.' });
        }
        if (!grantHasPurpose(found.grant, PURPOSE_SIAO)) {
            return res.status(403).json({ ok: false, status: 'purpose_required', error: 'La personne n’a pas autorisé la transmission de son dossier au SI-SIAO.' });
        }
        const dossier = found.shared;

        // SharedDiagnostic has opaque JSONB `situation` and no zipCode/isUrgent columns.
        // Never invent a location or urgency for an external SIAO transmission.
        const situation = dossier.situation;
        const validatedSituation = situation && typeof situation === 'object' && !Array.isArray(situation)
            ? situation : null;
        const postalCode = validatedSituation && 'zipCode' in validatedSituation
            && typeof validatedSituation.zipCode === 'string'
            && /^\d{5}$/.test(validatedSituation.zipCode)
            ? validatedSituation.zipCode : null;
        const urgent = validatedSituation && 'isUrgent' in validatedSituation
            && typeof validatedSituation.isUrgent === 'boolean'
            ? validatedSituation.isUrgent : null;
        if (postalCode === null || urgent === null) {
            logger.warn('[SIAO] Missing verified geographic or urgency data');
            return res.status(422).json({
                ok: false,
                status: 'incomplete_diagnostic',
                error: 'Données géographiques ou urgence non renseignées : transmission impossible.',
            });
        }

        // Generate transmission reference
        const transmissionId = `ADA-SIAO-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

        // Map to SI-SIAO payload (DGCS standard)
        const siaoPayload = {
            transmission: {
                id: transmissionId,
                date: new Date().toISOString(),
                emetteur: proCtx.structureId,
                version: '2.0',
            },
            demandeur: {
                identifiant_anonyme: pseudonym(shareId),
                zone_geographique: postalCode,
            },
            evaluation: {
                is_urgent: urgent,
                date_diagnostic: dossier.createdAt?.toISOString(),
            },
        };

        // Transmit to SI-SIAO national API (if configured)
        const siaoUrl = env.siao.apiUrl;
        let transmissionStatus = 'LOCAL_ONLY';

        if (siaoUrl) {
            try {
                const siaoRes = await fetch(`${siaoUrl}/v2/demande`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-ADA-Transmission-Id': transmissionId,
                        ...(env.siao.apiKey ? { Authorization: `Bearer ${env.siao.apiKey}` } : {}),
                    },
                    body: JSON.stringify(siaoPayload),
                    signal: AbortSignal.timeout(15000),
                });

                if (siaoRes.ok) {
                    transmissionStatus = 'TRANSMITTED';
                } else {
                    logger.error({ status: siaoRes.status }, '[SIAO] API error');   // the answer body may echo personal data: never logged
                    transmissionStatus = 'FAILED';
                }
            } catch (fetchErr) {
                logger.error({ err: { name: fetchErr instanceof Error ? fetchErr.name : 'Error' } }, '[SIAO] Network error');
                transmissionStatus = 'NETWORK_ERROR';
            }
        } else {
            logger.warn({ transmissionId }, '[SIAO] API not configured — logged locally');
        }

        // Audit trail
        await db.insert(AuditLog).values({
                action: 'EXTERNAL_TRANSMISSION_SIAO',
                entity_id: shareId,
                entity: 'DIAGNOSTIC',
                actor_id: proCtx.userId,
                details: {
                    transmissionId,
                    destination: 'SI-SIAO National',
                    transmissionStatus,
                    purpose: PURPOSE_SIAO,
                    fieldsExported: Object.keys(siaoPayload.demandeur).length,
                },
                ip_hash: 'SYSTEM_GATEWAY',
        });

        // R12: « ok » only when the national service accepted it — a refused or unreachable transmission (or none at all: not configured) is never a success
        const transmitted = transmissionStatus === 'TRANSMITTED';
        return res.status(transmitted ? 200 : transmissionStatus === 'LOCAL_ONLY' ? 200 : 502).json({
            ok: transmitted,
            transmissionId,
            transmissionStatus,
            timestamp: siaoPayload.transmission.date,
            destination: 'SI-SIAO National',
        });
    } catch (error) {
        logger.error({ err: error }, '[SIAO] Erreur');
        return res.status(500).json({ error: 'Échec interopérabilité nationale.' });
    }
}

export default requireProAuth(handler);
