import logger from '../../_utils/logger.js';
// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { SharedDiagnostic } from '../../../src/db/schema.js';
import { eq, and, gt, sql } from 'drizzle-orm';
import { requireProAuth, requireProStructureContext } from '../../_utils/auth.js';
import { logProAudit } from '../../_utils/auth.js';
import { resolveDossierForStructure, activeGrantExists, projectResultsForStructure } from '../../_utils/share-access.js';
import { openText } from '../../lib/data-keys.js';
import { generateAttachmentToken } from '../../lib/crypto.js';
import { clientIp } from '../../_utils/client-ip.js';

const DOCUMENT_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * DTA S8: the organization's own uploaded documents as a safe LIST (id, decrypted name, type, size, date, one-hour download capability bound to this dossier + file).
 * The raw `_files` entries (storage keys, encrypted names, checksums) never leave the server. The capability is only ever sent in a POST body to /api/download.
 * @param {any} results @param {string} shareId @param {string | null} [memberId] R18: binds each download token to the professional it was issued to
 */
export function documentsOf(results, shareId, memberId = null) {
    const files = Array.isArray(results?._files) ? results._files : [];
    return files
        .filter((/** @type {any} */ f) => f && typeof f.id === 'string' && f.encrypted === true)
        .map((/** @type {any} */ f) => {
            let name = 'document';
            try { name = openText(f.filenameEncrypted, { purpose: 'dossier-filename', context: `file:${shareId}:${f.id}` }) || 'document'; } catch { /* unreadable name: neutral label */ }
            return {
                id: f.id,
                name: String(name).replace(/[\r\n"]/g, '_').slice(0, 180),
                mimeType: String(f.mimeType || 'application/octet-stream'),
                byteLength: Number(f.byteLength) || 0,
                uploadedAt: f.uploadedAt || null,
                downloadToken: generateAttachmentToken(memberId ? `${shareId}:${f.id}@${memberId}` : `${shareId}:${f.id}`, DOCUMENT_TOKEN_TTL_SECONDS),
            };
        });
}
/**
 * Pro Dossier Handler  (RC5: structure-scoped)
 *
 * GET /api/pro/dossier?shareId=...  — Retrieve a shared diagnostic the CALLER'S STRUCTURE holds an active grant on (see POST /api/pro/dossier/redeem)
 * PATCH /api/pro/dossier?shareId=... — Update the caller structure's own follow-up status / note
 *
 * A pro session + a shareId is not authorization: no grant (or revoked grant) answers the same 404 as an unknown id. Follow-up notes and uploaded files are
 * per structure; one structure never reads another structure's notes or files.
 */
async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    const proCtx = requireProStructureContext(req, res);
    if (!proCtx) return;

    const { structureId, userId } = proCtx;

    const url = new URL(req.url || '/', `https://${req.headers?.host || 'localhost'}`);
    const shareId = url.searchParams.get('shareId');

    if (!shareId) {
        return res.status(400).json({ error: 'Le paramètre shareId est requis.' });
    }

    try {
        if (req.method === 'GET') {
            const found = await resolveDossierForStructure(shareId, proCtx);
            if (found.status === 'not_found') {
                return res.status(404).json({ error: 'Dossier introuvable.' });
            }
            if (found.status === 'expired') {
                return res.status(410).json({
                    error: 'Ce dossier a expiré.',
                    message: 'Demandez à l\'usager de générer un nouveau lien de partage.',
                });
            }
            const shared = found.shared;

            // Atomic increment (no read-modify-write), non-blocking.
            db.update(SharedDiagnostic)
                .set({ viewCount: sql`${SharedDiagnostic.viewCount} + 1` })
                .where(eq(SharedDiagnostic.id, shareId))
                .catch(() => { /* non-blocking */ });

            await logProAudit('DOSSIER_VIEWED', userId, structureId, {
                shareId,
                viewCount: shared.viewCount + 1,
            }, clientIp(req));

            const projected = projectResultsForStructure(shared.results, structureId);
            const documents = documentsOf(projected, shareId, userId);
            delete projected._files;
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({
                ok: true,
                documents,
                dossier: {
                    id: shared.id,
                    createdAt: shared.createdAt,
                    expiresAt: shared.expiresAt,
                    situation: shared.situation,
                    results: projected,
                    viewCount: shared.viewCount + 1,
                },
                // what the CITIZEN agreed to for THIS organization (the UI shows it; AI stays off unless the owner enabled PURP-05)
                access: { purposes: String(found.grant?.purposes || 'PURP-06').split(','), grantedAt: found.grant?.createdAt || null },
            });
        }

        if (req.method === 'PATCH') {
            const { status, internalNote } = req.body || {};

            if (!status) {
                return res.status(400).json({ error: 'Le champ status est requis.' });
            }
            // R18: a short label and a bounded note (the screen offers four labels; anything else was stored verbatim, of any type and size)
            if (typeof status !== 'string' || status.length > 80 || (internalNote != null && (typeof internalNote !== 'string' || internalNote.length > 4000))) {
                return res.status(400).json({ error: 'Statut ou note invalide.' });
            }

            const found = await resolveDossierForStructure(shareId, proCtx, { id: true, expiresAt: true });
            if (found.status === 'not_found') {
                return res.status(404).json({ error: 'Dossier introuvable.' });
            }
            if (found.status === 'expired') {
                return res.status(410).json({ error: 'Ce dossier a expiré.' });
            }

            const entry = JSON.stringify({
                status,
                internalNote: internalNote || null,
                updatedAt: new Date().toISOString(),
                updatedBy: userId,
            });

            // One atomic statement: writes ONLY results._followUps.<caller structure> (a concurrent upload's _files or another structure's note is never overwritten),
            // and only while the dossier is unexpired AND the grant is still active (closes expiry / revocation races).
            const updatedRows = await db.update(SharedDiagnostic)
                .set({
                    results: sql`jsonb_set(
                        jsonb_set(coalesce(${SharedDiagnostic.results}, '{}'::jsonb), '{_followUps}',
                            CASE WHEN jsonb_typeof(${SharedDiagnostic.results}->'_followUps') = 'object' THEN ${SharedDiagnostic.results}->'_followUps' ELSE '{}'::jsonb END, true),
                        ARRAY['_followUps', ${structureId}::text], ${entry}::jsonb, true)`,
                })
                .where(and(
                    eq(SharedDiagnostic.id, shareId),
                    gt(SharedDiagnostic.expiresAt, new Date()),
                    activeGrantExists(shareId, proCtx),
                ))
                .returning({ id: SharedDiagnostic.id });
            if (!updatedRows.length) {
                return res.status(404).json({ error: 'Dossier introuvable.' });
            }

            await logProAudit('DOSSIER_STATUS_UPDATED', userId, structureId, {
                shareId,
                status,
            }, clientIp(req));

            return res.status(200).json({ ok: true, status });
        }

        return res.status(405).json({ error: 'Méthode non autorisée' });
    } catch (error) {
        logger.error({ err: error }, '[Pro Dossier] Erreur');
        return res.status(500).json({ error: 'Erreur serveur.' });
    }
}

export default requireProAuth(handler);
