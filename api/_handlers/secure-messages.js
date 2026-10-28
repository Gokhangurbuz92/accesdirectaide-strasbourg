import logger from '../_utils/logger.js';
// @ts-nocheck
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { encrypt, decrypt } from '../lib/crypto.js';
import { requireProAuth, requireProStructureContext } from '../_utils/auth.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../_utils/rateLimit.js';
import * as threads from '../_services/shared-dossier-threads.js';
import { findActiveGrant } from '../_utils/share-access.js';

const MAX_ID_LENGTH = 128;
const MAX_ENCRYPTED_CONTENT_LENGTH = 32 * 1024; // client-encrypted blob (base64) — a chat message, not a file

/**
 * Secure Messages API Handler (Pro only)
 *
 * Stores chat messages as opaque client-side-encrypted blobs, additionally encrypted server-side at rest (envelope v2: random per-message data key, key id,
 * AAD bound to the thread; see api/lib/data-keys.ts). This is NOT end-to-end encryption: the client layer is keyed from a server-known identifier and the
 * server holds the master key, so the platform can read messages. Do not describe it to users as E2EE / zero-knowledge.
 *
 * GET  /api/secure-messages?shareId=...  → List encrypted messages
 * POST /api/secure-messages               → Store a new encrypted message
 *
 * Access control (previously none): a valid pro session is required and the conversation must belong to the caller's
 * structure (foreign / unknown conversations are indistinguishable: 404). The sender identity is taken from the session,
 * never from the request body. Rate-limited like the other messaging endpoints.
 * `shareId` is either a SharedDiagnostic id (SharedDossier panel: one thread per (dossier, structure), created on the first pro message; expired
 * dossiers answer 410) or, for backward compatibility, a RdvConversation id of the caller's structure. Pro of another structure never sees a thread (404/empty).
 */
async function handler(/** @type {import('../_utils/http-types').ApiRequest} */ req, /** @type {import('../_utils/http-types').ApiResponse} */ res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const ctx = requireProStructureContext(req, res);
    if (!ctx) return;

    try {
        // ─── GET: List messages by shareId ───
        if (req.method === 'GET') {
            const url = new URL(req.url || '/', `https://${req.headers?.host || 'localhost'}`);
            const shareId = String(url.searchParams.get('shareId') || '').trim();

            if (!shareId || shareId.length > MAX_ID_LENGTH) {
                return res.status(400).json({ error: 'Identifiant de partage requis' });
            }

            const limit = await checkRateLimit('MESSAGE_PRO_READ', `${ctx.userId}:${getClientIp(req)}`);
            if (!limit.allowed) return res.status(getRateLimitStatus(/** @type {any} */ (limit))).json(/** @type {any} */ (limit).error || { error: 'Too many requests' });

            const dossier = await threads.getDossier(shareId);
            if (dossier) {
                // RC5: a SharedDiagnostic id is not authorization. Only a structure with an ACTIVE grant (redeemed share token) reaches its thread; everyone else: uniform 404.
                const grant = await findActiveGrant(dossier.id, ctx);
                if (!grant) return res.status(404).json({ error: 'Conversation introuvable' });
                if (threads.isExpired(dossier)) return res.status(410).json({ error: 'Ce dossier a expiré.' });
                const thread = await threads.findThread(dossier.id, ctx.structureId);
                const rows = thread ? await threads.listMessages(thread.id, 50) : [];
                return res.status(200).json({
                    ok: true,
                    items: rows.map((m) => ({
                        id: m.id,
                        senderId: m.senderProUserId || m.senderType,
                        encryptedContent: threads.openMessage(thread.id, m.body),
                        createdAt: m.createdAt,
                    })),
                });
            }

            const conversation = await db.query.RdvConversation.findFirst({
                where: (c, { eq }) => eq(c.id, shareId),
                columns: { id: true, structureId: true },
            });
            if (!conversation || conversation.structureId !== ctx.structureId) {
                return res.status(404).json({ error: 'Conversation introuvable' });
            }

            const messages = await db.query.RdvConversationMessage.findMany({
                where: (m, { eq }) => eq(m.conversationId, shareId),
                orderBy: (m, { asc }) => [asc(m.createdAt)],
                limit: 50,
                columns: {
                    id: true,
                    senderType: true,
                    senderCitizenUserId: true,
                    senderProUserId: true,
                    body: true,
                    createdAt: true,
                },
            });

            // Map to E2EE-compatible shape — decrypt server-side encryption,
            // then return the client-encrypted blob
            const items = messages.map((m) => ({
                id: m.id,
                senderId: m.senderCitizenUserId || m.senderProUserId || m.senderType,
                encryptedContent: m.body?.startsWith('v1:') ? decrypt(m.body) : m.body,
                createdAt: m.createdAt,
            }));

            return res.status(200).json({ ok: true, items });
        }

        // ─── POST: Store a new encrypted message ───
        if (req.method === 'POST') {
            const { shareId: rawShareId, encryptedContent } = req.body || {};
            const shareId = String(rawShareId || '').trim();

            if (!shareId || shareId.length > MAX_ID_LENGTH || typeof encryptedContent !== 'string' || encryptedContent.length === 0) {
                return res.status(400).json({ error: 'Contenu ou identifiant manquant' });
            }
            if (encryptedContent.length > MAX_ENCRYPTED_CONTENT_LENGTH) {
                return res.status(413).json({ error: 'Message trop volumineux' });
            }

            const limit = await checkRateLimit('MESSAGE_PRO_SEND', `${ctx.userId}:${shareId}:${getClientIp(req)}`);
            if (!limit.allowed) return res.status(getRateLimitStatus(/** @type {any} */ (limit))).json(/** @type {any} */ (limit).error || { error: 'Too many requests' });

            const dossier = await threads.getDossier(shareId);
            if (dossier) {
                // RC5: thread creation requires an ACTIVE grant of the caller's structure (no grant / revoked grant / unknown id: indistinguishable 404).
                const grant = await findActiveGrant(dossier.id, ctx);
                if (!grant) return res.status(404).json({ error: 'Conversation introuvable' });
                if (threads.isExpired(dossier)) return res.status(410).json({ error: 'Ce dossier a expiré.' });
                const thread = await threads.openThread({ dossierId: dossier.id, structureId: ctx.structureId, proUserId: ctx.userId });
                if (!thread) return res.status(500).json({ error: 'Erreur serveur interne' });
                const wrapped = threads.sealMessage(thread.id, encryptedContent);       // per-message random data key, bound to the thread (envelope v2)
                const msg = await threads.addMessage({ threadId: thread.id, senderType: 'PRO', senderProUserId: ctx.userId, body: wrapped });
                return res.status(201).json({ ok: true, item: { id: msg.id, senderId: ctx.userId, createdAt: msg.createdAt } });
            }

            // Verify conversation exists AND belongs to the caller's structure
            const conversation = await db.query.RdvConversation.findFirst({
                where: (c, { eq }) => eq(c.id, shareId),
            });

            if (!conversation || conversation.structureId !== ctx.structureId) {
                return res.status(404).json({ error: 'Conversation introuvable' });
            }

            const serverEncryptedContent = encrypt(encryptedContent);
            if (serverEncryptedContent == null) {
                return res.status(400).json({ error: 'Contenu chiffré manquant' });
            }

            const [newMessage] = await db.insert(schema.RdvConversationMessage).values({
                conversationId: shareId,
                senderType: 'PRO',
                senderCitizenUserId: null,
                senderProUserId: ctx.userId, // identity comes from the verified session, never from the body
                body: serverEncryptedContent, // Server-side AES wrap around client E2EE blob
            }).returning();

            // Update conversation timestamp
            await db.update(schema.RdvConversation).set({
                lastMessageAt: newMessage.createdAt,
            }).where(eq(schema.RdvConversation.id, shareId));

            return res.status(201).json({
                ok: true,
                item: {
                    id: newMessage.id,
                    senderId: ctx.userId,
                    createdAt: newMessage.createdAt,
                },
            });
        }

        return res.status(405).json({ error: 'Méthode non autorisée' });
    } catch (error) {
        logger.error({ err: error }, '[API Secure Messages] Erreur:');
        return res.status(500).json({ error: 'Erreur serveur interne' });
    }
}

export default requireProAuth(handler);
