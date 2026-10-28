import logger from '../../_utils/logger.js';
// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { SharedDiagnostic } from '../../../src/db/schema.js';
import { and, eq, gt, sql } from 'drizzle-orm';
import { requireProAuth, requireProStructureContext } from '../../_utils/auth.js';
import { resolveDossierForStructure, activeGrantExists } from '../../_utils/share-access.js';
import { logProAudit } from '../../_utils/auth.js';
import crypto from 'crypto';
import { clientIp } from '../../_utils/client-ip.js';
/**
 * Consent API (Pro-authenticated)
 *
 * POST /api/pro/consent
 *
 * Records the citizen's RGPD consent signature before a dossier
 * is shared with a professional. Stores a SHA-256 hash of the
 * signature (not the raw data) for tamper-proof audit compliance.
 *
 * Body:
 * - shareId: SharedDiagnostic ID
 * - signatureData: base64 canvas data URL
 */
async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    const proCtx = requireProStructureContext(req, res);
    if (!proCtx) return;

    const { shareId, signatureData } = req.body || {};
    // RC5: purpose-specific (CONSENT_AND_PREFERENCE_PURPOSE_MATRIX.md). A professional can only record the in-person PURP-06 (professional dossier sharing) confirmation;
    // PURP-05 (AI / external provider processing) can be granted ONLY by the citizen, per organization, through the owner secret (public/dossier-grants set_purposes).
    const requestedPurposes = Array.isArray(req.body?.purposes) ? req.body.purposes.map(String) : ['PURP-06'];
    const purposes = [...new Set(requestedPurposes)];
    if (purposes.length !== 1 || purposes[0] !== 'PURP-06') {
        return res.status(400).json({ error: 'purposes invalides : un professionnel ne peut enregistrer que PURP-06.' });
    }

    if (!shareId || !signatureData) {
        return res.status(400).json({ error: 'shareId et signatureData requis.' });
    }

    try {
        // 1. RC5: only a structure holding an active grant on an unexpired dossier may record consent (a bare shareId could forge the citizen's consent before).
        const found = await resolveDossierForStructure(shareId, proCtx, { id: true, expiresAt: true });
        if (found.status === 'not_found') {
            return res.status(404).json({ error: 'Dossier introuvable.' });
        }
        if (found.status === 'expired') {
            return res.status(410).json({ error: 'Ce dossier a expiré.' });
        }
        const shared = found.shared;

        // 2. Create tamper-proof hash of the signature
        const signatureHash = crypto
            .createHash('sha256')
            .update(signatureData)
            .digest('hex');

        const ip = clientIp(req);
        const ipHash = crypto
            .createHash('sha256')
            .update(ip)
            .digest('hex')
            .substring(0, 16);

        const consentTimestamp = new Date().toISOString();

        // 3. Store consent metadata in results JSON — one atomic statement touching only results._consent, guarded by unexpired + active grant.
        const consent = JSON.stringify({ signed: true, signatureHash, signedAt: consentTimestamp, ipHash, expiresAt: shared.expiresAt, recordedByStructureId: proCtx.structureId, purposes });
        const written = await db.update(SharedDiagnostic)
            // PKG-11 audit: each organization's proof is also kept under its own key (_consentByStructure) — the single _consent slot (kept for the passport page)
            // was overwritten by the next organization's signature
            .set({ results: sql`jsonb_set(coalesce(${SharedDiagnostic.results}, '{}'::jsonb), '{_consent}', ${consent}::jsonb, true)
              || jsonb_build_object('_consentByStructure', coalesce(${SharedDiagnostic.results}->'_consentByStructure', '{}'::jsonb) || jsonb_build_object(${proCtx.structureId}::text, ${consent}::jsonb))` })
            .where(and(eq(SharedDiagnostic.id, shareId), gt(SharedDiagnostic.expiresAt, new Date()), activeGrantExists(shareId, proCtx)))
            .returning({ id: SharedDiagnostic.id });
        if (!written.length) {
            return res.status(404).json({ error: 'Dossier introuvable.' });
        }

        // 4. Critical audit log entry (legal proof)
        await logProAudit('CONSENT_SIGNED', 'citizen', proCtx.structureId, {   // PKG-11 audit: the organization's own audit trail (it was written without one)
            shareId,
            signatureHash,
            signedAt: consentTimestamp,
            ipHash,
            purposes: purposes.join(','),
            structureId: proCtx.structureId,
        }, ip);

        return res.status(200).json({
            ok: true,
            signedAt: consentTimestamp,
            signatureHash,
        });
    } catch (error) {
        logger.error({ err: error }, '[Consent] Erreur');
        return res.status(500).json({ error: 'Échec de l\'enregistrement du consentement.' });
    }
}

export default requireProAuth(handler);
