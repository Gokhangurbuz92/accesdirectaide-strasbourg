import logger from '../_utils/logger.js';
import crypto from 'node:crypto';
import { db } from '../../src/db/index.js';
import { SharedDiagnostic, AuditLog, ProUser } from '../../src/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { verifyAttachmentToken } from '../lib/crypto.js';
import { openBuffer, openText } from '../lib/data-keys.js';
import { storage } from '../lib/storage.js';
import { findGrant } from '../_utils/share-access.js';
import { isDossierRestricted } from '../_services/processing-restriction.js';

/**
 * @param {string | null} value
 */
function parseAttachmentBinding(value) {
    const raw = String(value || '');
    const separator = raw.indexOf(':');
    if (separator <= 0 || separator === raw.length - 1) return null;
    const shareId = raw.slice(0, separator);
    // R18: « shareId:fileId@memberId » — a token minted for a professional stops working when that person leaves the organization (tokens of the
    // previous form, without a member, are only the ones minted before this change: they expire within the hour)
    const rest = raw.slice(separator + 1); const at = rest.lastIndexOf('@');
    const fileId = at > 0 ? rest.slice(0, at) : rest;
    const memberId = at > 0 ? rest.slice(at + 1) : null;
    if (shareId.length > 128 || fileId.length > 128 || (memberId !== null && (!memberId || memberId.length > 128))) return null;
    return { shareId, fileId, memberId };
}

function safeDownloadError(/** @type {unknown} */ error) {
    return {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : 'Download failed',
    };
}

/**
 * Capability-protected document download.
 * The raw capability is accepted only in the POST body, never in URL query/path.
 */
export default async function handler(/** @type {import('../_utils/http-types').ApiRequest} */ req, /** @type {import('../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const token = String(req.body?.token || '').trim();
    if (!token) return res.status(404).json({ error: 'Document not found' });

    const binding = parseAttachmentBinding(verifyAttachmentToken(token));
    if (!binding) return res.status(404).json({ error: 'Document not found' });

    try {
        const shared = await db.query.SharedDiagnostic.findFirst({
            where: eq(SharedDiagnostic.id, binding.shareId),
        });
        if (!shared) return res.status(404).json({ error: 'Document not found' });
        if (new Date() > new Date(shared.expiresAt)) {
            return res.status(410).json({ error: 'Shared dossier expired' });
        }

        const attachmentResults = /** @type {{ _files?: Array<{ id: string | number | boolean | null | undefined, encrypted?: boolean, storageKey?: string, filenameEncrypted?: string, checksumSha256?: string, mimeType?: string }> }} */ (shared.results || {});
        const files = Array.isArray(attachmentResults._files) ? attachmentResults._files : [];
        const attachment = files.find((/** @type {{ id: string | number | boolean | null | undefined }} */ entry) => String(entry?.id || '') === binding.fileId);
        if (
            !attachment
            || attachment.encrypted !== true
            || typeof attachment.storageKey !== 'string'
            || typeof attachment.filenameEncrypted !== 'string'
        ) {
            return res.status(404).json({ error: 'Document not found' });
        }
        // DTA S1D: the signed token is a 1 h bearer capability; a revoked grant of the file-owning organization must stop it at once (same 404 as an unknown file).
        // Legacy entries without structureId have no owning organization to check (recorded limit).
        const ownerStructureId = /** @type {{ structureId?: unknown }} */ (attachment).structureId;
        if (typeof ownerStructureId === 'string' && ownerStructureId) {
            const grant = await findGrant(binding.shareId, ownerStructureId);
            if (!grant || grant.revokedAt) return res.status(404).json({ error: 'Document not found' });
        }
        // R18: the professional the token was issued to must still be an active member of the file-owning organization (a departure cuts it at once)
        if (binding.memberId) {
            const [member] = await db.select({ id: ProUser.id }).from(ProUser).where(and(eq(ProUser.id, binding.memberId), eq(ProUser.status, 'active'),
                ...(typeof ownerStructureId === 'string' && ownerStructureId ? [eq(ProUser.structureId, ownerStructureId)] : []))).limit(1);
            if (!member) return res.status(404).json({ error: 'Document not found' });
        }
        // PKG-11 audit: a token minted before the person restricted processing (art. 18) stops working too
        if (await isDossierRestricted(binding.shareId)) return res.status(404).json({ error: 'Document not found' });

        const encryptedBuffer = await storage.download(attachment.storageKey);
        const fileContext = `file:${binding.shareId}:${binding.fileId}`;     // envelope v2 is bound to dossier + file; pre-RC5-product files fall back to the legacy reader
        const fileBuffer = openBuffer(encryptedBuffer, { purpose: 'dossier-file', context: fileContext });
        const checksumSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        if (
            typeof attachment.checksumSha256 !== 'string'
            || !/^[a-f0-9]{64}$/.test(attachment.checksumSha256)
            || checksumSha256 !== attachment.checksumSha256
        ) {
            return res.status(500).json({ error: 'Document integrity check failed' });
        }

        const decryptedName = openText(attachment.filenameEncrypted, { purpose: 'dossier-filename', context: fileContext }) || 'document';
        const filename = decryptedName.replace(/[\r\n"]/g, '_').slice(0, 180) || 'document';
        const mimeType = String(attachment.mimeType || 'application/octet-stream');

        // R12 (R16): the person's access journal shows each document download by the owning organization; no journal row, no file
        await db.insert(AuditLog).values({ action: 'DOSSIER_FILE_DOWNLOADED', entity: 'SharedDiagnostic', entity_id: binding.shareId,
            details: { shareId: binding.shareId, fileId: binding.fileId, structureId: typeof ownerStructureId === 'string' ? ownerStructureId : null } });

        res.setHeader('Content-Type', mimeType);
        // PKG-11 audit: an ASCII fallback plus the RFC 5987 UTF-8 name — a name with ’, œ, € or an emoji used to make setHeader throw (500 for that document, always)
        const ascii = filename.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'document';
        const utf8 = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
        res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`);
        res.setHeader('Content-Length', fileBuffer.length);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.send(fileBuffer);
    } catch (error) {
        logger.error({ err: safeDownloadError(error) }, '[Document Download] Error');
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
