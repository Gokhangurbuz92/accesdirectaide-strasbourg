import logger from '../../../_utils/logger.js';
// @ts-nocheck
import { requireProAuth, requireProStructureContext } from '../../../_utils/auth.js';
import { logProAudit } from '../../../_utils/auth.js';
import { resolveDossierForStructure, projectResultsForStructure } from '../../../_utils/share-access.js';
import { clientIp } from '../../../_utils/client-ip.js';
/**
 * Dossier Export API (Pro-only, RGPD)
 *
 * GET /api/pro/dossier/export?shareId=xxx&format=json|csv
 *
 * Exports a dossier's data in JSON or CSV format (RGPD data portability).
 * Also logs the export action for audit compliance.
 */
async function handler(/** @type {import('../../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    const proCtx = requireProStructureContext(req, res);
    if (!proCtx) return;

    const { userId, structureId } = proCtx;

    const url = new URL(req.url || '/', `https://${req.headers?.host || 'localhost'}`);
    const shareId = url.searchParams.get('shareId');
    const format = url.searchParams.get('format') || 'json';

    if (!shareId) {
        return res.status(400).json({ error: 'shareId requis.' });
    }

    try {
        // RC5: structure-scoped (active grant) and never after expiry.
        const found = await resolveDossierForStructure(shareId, proCtx);
        if (found.status === 'not_found') {
            return res.status(404).json({ error: 'Dossier introuvable.' });
        }
        if (found.status === 'expired') {
            return res.status(410).json({ error: 'Ce dossier a expiré.' });
        }
        const shared = found.shared;

        // Safe results (strip internal fields; only the caller structure's own follow-up is ever present)
        /** @type {Record<string, unknown> & { _files?: unknown, _consent?: unknown, _followUp?: unknown, legacyRightsOmitted?: boolean, assessment?: { items?: Array<any> } }} */
        const safeResults = projectResultsForStructure(shared.results, structureId);
        delete safeResults._files;
        delete safeResults._consent;

        const exportData = {
            reference: shareId.slice(0, 8).toUpperCase(),
            createdAt: shared.createdAt,
            expiresAt: shared.expiresAt,
            situation: shared.situation || {},
            results: safeResults,
            viewCount: shared.viewCount,
            exportedAt: new Date().toISOString(),
            exportedBy: userId,
        };

        // Audit
        await logProAudit('DOSSIER_EXPORTED', userId, structureId, {
            shareId,
            format,
        }, clientIp(req));

        // CSV format
        if (format === 'csv') {
            const situation = exportData.situation || {};
            const items = (safeResults.assessment && Array.isArray(safeResults.assessment.items)) ? safeResults.assessment.items : [];
            // PKG-11 audit: every cell is quoted and a cell starting with = + - @ (or a tab / CR) is neutralised, so a spreadsheet never runs a formula typed in a dossier
            const cell = (/** @type {unknown} */ v) => { const t = v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''); const safe = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t; return `"${safe.replace(/"/g, '""')}"`; };

            const csvLines = [
                'Champ,Valeur',
                `Référence,${cell(exportData.reference)}`,
                `Créé le,${cell(exportData.createdAt)}`,
                `Expire le,${cell(exportData.expiresAt)}`,
                `Vues,${cell(exportData.viewCount)}`,
                '',
                'Pistes d\'orientation (pré-orientation non officielle, aucune décision)',
                'Aide,Statut,Source,Incertitude',
            ];

            for (const it of items) {
                csvLines.push([cell(it.label), cell(it.state), cell(it.provenance?.display?.source), cell(it.provenance?.display?.uncertainty)].join(','));
            }
            if (safeResults.legacyRightsOmitted) csvLines.push('"(ancien partage : résultat détaillé non repris)"');

            csvLines.push('');
            csvLines.push('Situation');
            csvLines.push('Clé,Valeur');
            for (const [key, value] of Object.entries(situation)) {
                csvLines.push(`${cell(key)},${cell(value)}`);
            }

            const csv = csvLines.join('\n');
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="dossier-${exportData.reference}.csv"`);
            return res.status(200).send(csv);
        }

        // JSON format (default)
        res.setHeader('Content-Disposition', `attachment; filename="dossier-${exportData.reference}.json"`);
        return res.status(200).json({
            ok: true,
            export: exportData,
        });
    } catch (error) {
        logger.error({ err: error }, '[DossierExport] Erreur');
        return res.status(500).json({ error: 'Erreur export.' });
    }
}

export default requireProAuth(handler);
