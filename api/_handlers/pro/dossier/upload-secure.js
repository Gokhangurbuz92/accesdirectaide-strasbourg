// @ts-nocheck
import logger from '../../../_utils/logger.js';
// @ts-nocheck
import crypto from 'node:crypto';
import { db } from '../../../../src/db/index.js';
import { SharedDiagnostic } from '../../../../src/db/schema.js';
import { and, eq, gt, sql } from 'drizzle-orm';
import { requireProAuth, requireProStructureContext, logProAudit } from '../../../_utils/auth.js';
import { resolveDossierForStructure, activeGrantExists } from '../../../_utils/share-access.js';
import { storage } from '../../../lib/storage.js';
import { generateAttachmentToken } from '../../../lib/crypto.js';
import { sealBuffer, sealText } from '../../../lib/data-keys.js';
import { clientIp } from '../../../_utils/client-ip.js';
import { sniffType } from '../../../_services/mon-espace.js';

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const DOWNLOAD_TOKEN_TTL_SECONDS = 60 * 60;
// R12: the type is read from the bytes (PDF / PNG / JPEG, like the message attachments and the coffre); a declared type that differs is refused
const VALID_MIMES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
]);

/**
 * @param {string} value
 */
function decodeBase64(value) {
    if (typeof value !== 'string') return null;
    let raw = value.trim();
    const commaIndex = raw.indexOf(',');
    if (/^data:/i.test(raw) && commaIndex >= 0) raw = raw.slice(commaIndex + 1);
    raw = raw.replace(/\s+/g, '');
    if (!raw || raw.length > Math.ceil(MAX_UPLOAD_SIZE * 4 / 3) + 16) return null;
    const base64url = /[-_]/.test(raw);
    const re = base64url ? /^[A-Za-z0-9_-]+={0,2}$/ : /^[A-Za-z0-9+/]+={0,2}$/;
    if (!re.test(raw) || raw.length % 4 === 1) return null;
    try {
        return Buffer.from(raw, base64url ? 'base64url' : 'base64');
    } catch {
        return null;
    }
}

function resolveUploadBuffer(req) {
    const direct = req.file?.buffer;
    if (Buffer.isBuffer(direct)) return direct;
    if (direct instanceof Uint8Array) return Buffer.from(direct);

    const body = req.body || {};
    for (const value of [body.fileBase64, body.file]) {
        if (Buffer.isBuffer(value)) return value;
        if (value instanceof Uint8Array) return Buffer.from(value);
        if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
            return Buffer.from(value.data);
        }
        const decoded = decodeBase64(value);
        if (decoded) return decoded;
    }
    return null;
}

function safeErrorForLog(/** @type {unknown} */ error) {
    return {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : 'Upload failed',
    };
}

/**
 * Secure File Upload Handler (Pro-only)
 *
 * POST /api/pro/dossier/upload-secure
 *
 * Persists encrypted bytes through the configured storage adapter and stores
 * only encrypted/minimal metadata inside the SharedDiagnostic JSON envelope.
 * Raw document bytes, plaintext filenames and download capabilities are never
 * written to audit logs.
 */
// @ts-ignore
async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    const proCtx = requireProStructureContext(req, res);
    if (!proCtx) return;

    let storageKey = null;
    let metadataPersisted = false;

    try {
        const body = req.body || {};
        const shareId = String(body.shareId || '').trim();
        const originalName = String(body.originalName || '').trim().slice(0, 255);
        const declaredMimeType = String(body.mimeType || req.file?.mimetype || '').trim();
        const fileBuffer = resolveUploadBuffer(req);
        const actualMimeType = fileBuffer ? (sniffType(fileBuffer) || '') : '';

        if (!shareId || !originalName || !fileBuffer) {
            return res.status(400).json({ error: 'shareId, originalName et contenu du fichier requis.' });
        }
        if (fileBuffer.length <= 0 || fileBuffer.length > MAX_UPLOAD_SIZE) {
            return res.status(413).json({ error: 'Fichier trop volumineux ou vide (max 10MB).' });
        }

        // RC5: authorization BEFORE any byte is stored — active structure grant, unexpired.
        const found = await resolveDossierForStructure(shareId, proCtx, { id: true, expiresAt: true });
        if (found.status === 'not_found') {
            return res.status(404).json({ error: 'Dossier introuvable.' });
        }
        if (found.status === 'expired') {
            return res.status(410).json({ error: 'Ce dossier a expiré.' });
        }
        // R12 (R13): the stored type is the one the bytes prove (PDF / PNG / JPEG), never the client's claim; checked after authorization (no 415 vs 404 oracle)
        if (!VALID_MIMES.has(actualMimeType) || (declaredMimeType && declaredMimeType !== 'application/octet-stream' && declaredMimeType !== actualMimeType)) {
            return res.status(415).json({ error: 'Type de fichier non autorisé : seuls les PDF, PNG et JPEG sont acceptés, et le contenu doit correspondre au type.' });
        }

        const fileId = crypto.randomUUID();
        const checksumSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        const fileContext = `file:${shareId}:${fileId}`;
        const encryptedBuffer = sealBuffer(fileBuffer, { purpose: 'dossier-file', context: fileContext });
        storageKey = await storage.upload(encryptedBuffer, actualMimeType);

        const fileEntry = {
            id: fileId,
            structureId: proCtx.structureId,
            storageKey,
            filenameEncrypted: sealText(originalName, { purpose: 'dossier-filename', context: fileContext }),
            mimeType: actualMimeType,
            uploadedAt: new Date().toISOString(),
            byteLength: fileBuffer.length,
            checksumSha256,
            encrypted: true,
        };

        // Atomic SQL append (no read-modify-write: concurrent uploads / follow-up updates cannot drop entries); only while unexpired AND the grant is still active.
        const updatedRows = await db.update(SharedDiagnostic).set({
            results: sql`jsonb_set(
                coalesce(${SharedDiagnostic.results}, '{}'::jsonb),
                '{_files}',
                (CASE WHEN jsonb_typeof(${SharedDiagnostic.results}->'_files') = 'array' THEN ${SharedDiagnostic.results}->'_files' ELSE '[]'::jsonb END)
                  || ${JSON.stringify([fileEntry])}::jsonb,
                true)`,
        }).where(and(
            eq(SharedDiagnostic.id, shareId),
            gt(SharedDiagnostic.expiresAt, new Date()),
            activeGrantExists(shareId, proCtx),
        )).returning({ id: SharedDiagnostic.id });
        if (!updatedRows.length) {
            await storage.delete(storageKey).catch(() => { });
            storageKey = null;
            return res.status(404).json({ error: 'Dossier introuvable.' });
        }
        metadataPersisted = true;

        const downloadToken = generateAttachmentToken(`${shareId}:${fileId}` + `@${proCtx.userId}`, DOWNLOAD_TOKEN_TTL_SECONDS);   // R18: + the uploading member (download.js checks they are still active)
        const ip = clientIp(req);
        await logProAudit('FILE_UPLOADED', proCtx.userId, proCtx.structureId, {
            shareId,
            fileId,
            mimeType: actualMimeType,
            byteLength: fileBuffer.length,
            encrypted: true,
        }, ip).catch(() => { });

        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        return res.status(200).json({
            ok: true,
            fileId,
            downloadToken,
            expiresInSeconds: DOWNLOAD_TOKEN_TTL_SECONDS,
            message: 'Fichier chiffré reçu et enregistré.',
        });
    } catch (error) {
        if (storageKey && !metadataPersisted) {
            await storage.delete(storageKey).catch(() => { });
        }
        logger.error({ err: safeErrorForLog(error) }, '[Upload Secure] Erreur');
        return res.status(500).json({ error: 'Erreur lors de l\'envoi.' });
    }
}

export default requireProAuth(handler);
