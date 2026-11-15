import logger from '../../_utils/logger.js';
// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { ProCase, SharedDiagnostic } from '../../../src/db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { requireProAuth, requireProStructureContext } from '../../_utils/auth.js';
import { logProAudit } from '../../_utils/auth.js';
import { resolveDossierForStructure, activeGrantExists, projectResultsForStructure } from '../../_utils/share-access.js';
import { CASE_STATUSES, addNote, ensureCase, setStatus } from '../../_services/pro-cases.js';
import { capabilityOpen, requireCapability } from '../../_utils/capabilities.js';
import { openText } from '../../lib/data-keys.js';
import { generateAttachmentToken } from '../../lib/crypto.js';
import { clientIp } from '../../_utils/client-ip.js';
import { withProRateLimit } from '../../_utils/pro-rate-limit.js';

const DOCUMENT_TOKEN_TTL_SECONDS = 60 * 60;
/** A04: the statuses this page may set — the open case statuses (closing needs an outcome: the case page) */
const FOLLOW_UP_STATUSES = CASE_STATUSES.filter((x) => x !== 'CLOSED');

/**
 * A04: the organization's legacy entry in results._followUps (free label + optional note in clear) is retired once the case holds the status. A legacy note is
 * first moved into a protected INTERNAL case note; if that cannot be done (protected records unavailable, closed case) the legacy entry is left as it is —
 * a note is never dropped. Only the caller organization's own key is touched. Best effort: the status change is already recorded.
 * @param {any} shared @param {string} caseId @param {{ structureId: string, userId: string, role: any }} ctx
 */
async function retireLegacyFollowUp(shared, caseId, ctx) {
    const proCtx = ctx; const shareId = String(shared?.id || '');
    try {
        const legacy = shared?.results?._followUps?.[ctx.structureId];
        if (!legacy || typeof legacy !== 'object') return;
        const note = typeof legacy.internalNote === 'string' ? legacy.internalNote.trim() : '';
        if (note.length >= 2) {
            const moved = await addNote(caseId, { visibility: 'INTERNAL', body: `[Note reprise de l’ancien suivi du dossier]\n${note}`.slice(0, 4000) }, ctx);
            if (!moved.ok) return;
        }
        // the only write this route still makes to the dossier JSON: like every write path, grant AND active membership are re-checked inside the statement
        await db.update(SharedDiagnostic).set({ results: sql`${SharedDiagnostic.results} #- ARRAY['_followUps', ${ctx.structureId}::text]` })
            .where(and(eq(SharedDiagnostic.id, shareId), activeGrantExists(shareId, proCtx)));
    } catch (err) {
        logger.warn({ err: { name: /** @type {any} */ (err)?.name } }, '[Pro Dossier] legacy follow-up not retired');
    }
}

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
 * PATCH /api/pro/dossier?shareId=... — A04: set the follow-up status = the organization's CASE status (same rule and history as POST /api/pro/cases
 *   { action: 'status' }); an `internalNote` is refused (notes live in the protected case notes)
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

            // A04: the one follow-up status shown on this page is the case status (read only here; null while no case exists or the capability is closed)
            /** @type {{ available: boolean, caseId: string | null, status: string | null }} */
            const followUp = { available: capabilityOpen('pro.case_management'), caseId: null, status: null };
            if (followUp.available) {
                const [c] = await db.select({ id: ProCase.id, status: ProCase.status }).from(ProCase).where(and(eq(ProCase.sharedDiagnosticId, shareId), eq(ProCase.structureId, structureId))).limit(1);
                if (c) { followUp.caseId = c.id; followUp.status = c.status; }
            }
            const projected = projectResultsForStructure(shared.results, structureId);
            const documents = documentsOf(projected, shareId, userId);
            delete projected._files;
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({
                ok: true,
                documents,
                followUp,
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
            // A04 — ONE follow-up status: the case status (ProCase, with its history, the one the person's view reads). Before, this route wrote an unrelated free label
            // into the person's dossier JSON (results._followUps), with an optional internal note stored in clear there, outside the protected-records boundary.
            const body = req.body || {};
            const found = await resolveDossierForStructure(shareId, proCtx);
            if (found.status === 'not_found') {
                return res.status(404).json({ error: 'Dossier introuvable.' });
            }
            if (found.status === 'expired') {
                return res.status(410).json({ error: 'Ce dossier a expiré.' });
            }
            if (body.internalNote !== undefined && body.internalNote !== null) {
                return res.status(400).json({ error: 'INTERNAL_NOTE_NOT_ACCEPTED', message: 'Les notes internes s’écrivent dans le suivi du dossier (notes protégées), pas ici. Rien n’a été enregistré.' });
            }
            const status = body.status;
            if (typeof status !== 'string' || !FOLLOW_UP_STATUSES.includes(status)) {
                return res.status(400).json({ error: 'INVALID_STATUS', message: 'Statut inconnu. Pour clôturer un dossier, indiquez un résultat depuis le suivi du dossier.' });
            }
            // the case follow-up is a capability of its own (outside the AIPD): this route never opens it by the back door
            if (!requireCapability(res, 'pro.case_management')) return undefined;
            const c = await ensureCase(shareId, proCtx);
            if (!c) {
                return res.status(404).json({ error: 'Dossier introuvable.' });
            }
            /** @type {any} */
            const out = await setStatus(c.id, status, proCtx);
            if (out.ok === false) {
                return res.status(out.status || 400).json({ error: out.code, message: out.message });
            }
            await retireLegacyFollowUp(found.shared, c.id, proCtx);

            await logProAudit('DOSSIER_STATUS_UPDATED', userId, structureId, {
                shareId,
                caseId: c.id,
                status,
            }, clientIp(req));

            return res.status(200).json({ ok: true, status, caseId: c.id });
        }

        return res.status(405).json({ error: 'Méthode non autorisée' });
    } catch (error) {
        logger.error({ err: error }, '[Pro Dossier] Erreur');
        return res.status(500).json({ error: 'Erreur serveur.' });
    }
}

// A23: tenant read / write quota, after authentication (api/_utils/pro-rate-limit.js)
export default requireProAuth(withProRateLimit('pro.dossier', handler));
