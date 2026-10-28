import logger from '../../_utils/logger.js';
// @ts-nocheck
import { requireProAuth, requireProStructureContext, logProAudit } from '../../_utils/auth.js';
import { resolveDossierForStructure, projectResultsForStructure } from '../../_utils/share-access.js';
import crypto from 'crypto';
import { clientIp } from '../../_utils/client-ip.js';
/**
 * Attestation Data API (Pro-only)
 *
 * GET /api/pro/attestation-data?shareId=xxx
 *
 * Data for the printable dossier RECAP (route /pro/attestation/:shareId). PKG-6 / G: this is NOT a signed or certified document. There is no electronic
 * signature, seal or verification portal in the product (a real one needs a qualified trust service and an identity check), so the response says so
 * (signed: false) and carries no verification URL. `fingerprint` is the full SHA-256 of exactly the content returned (reference, dates, results), so two
 * printouts can be compared; it proves nothing about who issued them.
 *
 * DTA S1D (security): access is decided by the SHARED RC5 authorization (resolveDossierForStructure) exactly like every other dossier surface:
 *   unknown dossier / no grant / revoked grant / wrong organization / inactive member or suspended organization => ONE uniform 404;
 *   an authorized organization on an EXPIRED dossier => 410; anonymous => 401 (requireProAuth); valid active grant => 200.
 * Before S1D this handler read the dossier directly (no grant, no expiry check) and returned every organization's follow-up notes to any professional who knew a shareId.
 * Results are projected per organization (projectResultsForStructure): only the caller's own follow-up is present; legacy eligibility flags / amounts / totals never leave.
 * Each successful attestation is audited (identifiers only, never the payload).
 */
async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    const proCtx = requireProStructureContext(req, res);
    if (!proCtx) return;
    const { userId, structureId } = proCtx;

    const url = new URL(req.url || '/', `https://${req.headers?.host || 'localhost'}`);
    const shareId = url.searchParams.get('shareId');

    if (!shareId) {
        return res.status(400).json({ error: 'shareId requis.' });
    }

    try {
        const found = await resolveDossierForStructure(shareId, proCtx);
        if (found.status === 'not_found') {
            return res.status(404).json({ error: 'Dossier introuvable.' });
        }
        if (found.status === 'expired') {
            return res.status(410).json({ error: 'Ce dossier a expiré.' });
        }
        const dossier = found.shared;

        // Reference number (stable per dossier); not a certification
        const certHash = crypto
            .createHash('sha256')
            .update(`${shareId}:${dossier.createdAt?.toISOString() || ''}`)
            .digest('hex')
            .slice(0, 12)
            .toUpperCase();

        const reference = `ADA-${certHash}`;

        // Safe results: per-organization projection (own follow-up only), internal fields stripped
        /** @type {Record<string, unknown> & { _files?: unknown, _consent?: unknown }} */
        const results = projectResultsForStructure(dossier.results || {}, structureId);
        delete results._files;
        delete results._consent;

        // Agent info from auth context
        const user = req.user || {};
        const proName = user.email ? user.email.split('@')[0] : 'Agent ADA';

        await logProAudit('ATTESTATION_VIEWED', userId, structureId, { shareId }, clientIp(req));

        const recap = {
            kind: 'RECAP_NON_SIGNE',
            signed: false,
            reference,
            date: new Date().toLocaleDateString('fr-FR'),
            createdAt: dossier.createdAt,
            expiresAt: dossier.expiresAt,
            usagerToken: shareId.slice(0, 8).toUpperCase(),
            results,
            professional: {
                name: proName,
                role: user.role || 'Agent',
                structure: structureId,
            },
        };
        const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ reference, createdAt: recap.createdAt, expiresAt: recap.expiresAt, results })).digest('hex');
        // certHash: legacy field name kept for existing clients/tests = the reference fragment above; it certifies nothing
        return res.status(200).json({ ok: true, attestation: { ...recap, certHash, fingerprint } });
    } catch (error) {
        logger.error({ err: error }, '[Attestation] Erreur');
        return res.status(500).json({ error: 'Erreur attestation.' });
    }
}

export default requireProAuth(handler);
