import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { AuditLog } from '../../../src/db/schema.js';

import { env } from '../../_utils/env.js';
import { requireProAuth, requireProStructureContext } from '../../_utils/auth.js';
import { grantHasPurpose, resolveDossierForStructure } from '../../_utils/share-access.js';
import { withCapability } from '../../_utils/capabilities.js';
import { buildSiaoHandover, siaoAdapterStatus, SIAO_PURPOSE } from '../../lib/siao-handover.js';

/**
 * SI-SIAO interoperability (Pro-only) — R46 / R22: an honest DISCONNECTED adapter (api/lib/siao-handover.js).
 *
 * GET  /api/pro/interop-siao                 → the adapter status { provider, status: DISCONNECTED, reason, transmission: MANUAL_BY_PROFESSIONAL, format }
 * POST /api/pro/interop-siao  { shareId }    → the handover sheet `ada.siao-handover/1` of a dossier shared with THIS organization (active grant, unexpired), only
 *                                              when its owner allowed this organization to pass the housing request to the SIAO (purpose PURP-07 — sharing
 *                                              PURP-06 or the AI purpose PURP-05 never stand in for it). Nothing is sent anywhere: the professional enters it in
 *                                              the operator's own tool. The answer always says transmissionStatus NOT_TRANSMITTED.
 * The former home-made POST to `${SIAO_API_URL}/v2/demande` (an undocumented endpoint presented as the « DGCS standard ») is removed: no official
 * specification of SI-SIAO is held in the repository. Logs carry no dossier id; the audit row records the purpose and the reference, never the content.
 */
export const PURPOSE_SIAO = SIAO_PURPOSE;

async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') {
        const proCtx = requireProStructureContext(req, res);
        if (!proCtx) return undefined;
        return res.status(200).json(siaoAdapterStatus());
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    const proCtx = requireProStructureContext(req, res);
    if (!proCtx) return undefined;

    const shareId = typeof req.body?.shareId === 'string' ? req.body.shareId : '';
    if (!shareId || shareId.length > 200) {
        return res.status(400).json({ error: 'shareId requis.' });
    }

    try {
        // RC5: an active structure grant on an unexpired dossier
        const found = await resolveDossierForStructure(shareId, proCtx);
        if (found.status === 'not_found') {
            return res.status(404).json({ error: 'Dossier introuvable.' });
        }
        if (found.status === 'expired') {
            return res.status(410).json({ error: 'Ce dossier a expiré.' });
        }
        if (!grantHasPurpose(found.grant, PURPOSE_SIAO)) {
            return res.status(403).json({ ok: false, status: 'purpose_required', error: 'La personne n’a pas autorisé la transmission de sa demande au SIAO par votre structure.' });
        }
        const secret = env.secrets.jwtSecret;
        if (!secret) return res.status(500).json({ error: 'Server configuration error' });
        const handover = buildSiaoHandover({ shareId, situation: found.shared.situation, createdAt: found.shared.createdAt, secret });

        await db.insert(AuditLog).values({
            action: 'SIAO_HANDOVER_PREPARED',
            entity_id: shareId,
            entity: 'DIAGNOSTIC',
            actor_id: proCtx.userId,
            details: { reference: handover.request.reference, purpose: PURPOSE_SIAO, format: handover.format, structureId: proCtx.structureId, missing: handover.missing.join(',') || 'none', transmissionStatus: 'NOT_TRANSMITTED' },
            ip_hash: 'SYSTEM_GATEWAY',
        });

        return res.status(200).json({ ok: true, ...siaoAdapterStatus(), transmissionStatus: 'NOT_TRANSMITTED', handover });
    } catch (error) {
        logger.error({ err: { name: error instanceof Error ? error.name : 'Error' } }, '[SIAO] handover failed');
        return res.status(500).json({ error: 'La fiche SIAO n’a pas pu être préparée.' });
    }
}

// R45 / ENG-LR-6: outside the AIPD — refused before authentication and any database access while the capability is closed (api/_utils/capabilities.js)
export default withCapability(['pro.siao_interop', 'citizen.shared_dossier'], requireProAuth(handler));
