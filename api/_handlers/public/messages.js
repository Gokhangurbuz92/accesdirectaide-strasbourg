// @ts-nocheck
/**
 * PROXY ADAPTER — public/messages.js
 *
 * Legacy System A route → reads/writes System B tables (RdvConversation, RdvConversationMessage).
 * Maintains identical API contract:
 *   GET  /api/public/messages?token=...  → List messages (decrypted)
 *   POST /api/public/messages?token=...  → Send message (encrypted)
 *   PATCH /api/public/messages?token=... → Mark as read
 *
 * Mapping:
 *   access_token/cancel_token → HMAC-signed token from cancel flow → appointment ID → conversation
 *   Message (encrypted content) → RdvConversationMessage (E2EE body)
 *   Message.sender = 'BENEFICIARY' → RdvConversationMessage.senderType = 'USER'
 *   Message.sender = 'PRO' → RdvConversationMessage.senderType = 'PRO'
 */
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { RdvConversation, RdvConversationMessage } from '../../../src/db/schema.js';
import { eq, desc, count } from 'drizzle-orm';
import { verifyAttachmentToken, encrypt, decrypt } from '../../lib/crypto.js';
import crypto from 'crypto';
import { decryptMessageBody } from '../../_utils/rdv-messaging.js';

/**
 * Resolve a legacy token to a ProAppointment ID and find/create a RdvConversation.
 * @param {string} token
 */
async function resolveTokenToConversation(token) {
    // Verify HMAC-signed token → extract appointment ID
    const appointmentId = verifyAttachmentToken(token);
    if (!appointmentId) return null;

    // Find existing conversation for this appointment
    let conversation = await db.query.RdvConversation.findFirst({
        where: eq(RdvConversation.appointmentId, appointmentId),
        columns: { id: true, appointmentId: true, structureId: true, citizenUserId: true },
    });

    // Auto-create conversation if needed (upsert pattern)
    if (!conversation) {
        const appointment = await db.query.ProAppointment.findFirst({
            where: (a, { eq }) => eq(a.id, appointmentId),
            columns: { id: true, structureId: true, citizenUserId: true },
        });

        if (!appointment) return null;

        const [created] = await db.insert(RdvConversation).values({
            id: crypto.randomUUID(),
            appointmentId: appointment.id,
            structureId: appointment.structureId,
            citizenUserId: appointment.citizenUserId || 'legacy-anonymous',
            lastMessageAt: new Date(),
            updatedAt: new Date(),
        }).onConflictDoUpdate({
            target: RdvConversation.appointmentId,
            set: { updatedAt: new Date() },
        }).returning();

        conversation = created;
    }

    return conversation;
}

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    try {
        const { token, page = 1, pageSize = 50 } = req.query;
        if (!token) return res.status(401).json({ error: "Unauthorized" });

        // Resolve legacy token → RdvConversation (System B)
        const conversation = await resolveTokenToConversation(token);
        if (!conversation) return res.status(401).json({ error: "Invalid token" });

        // GET: List messages
        if (req.method === 'GET') {
            const pageInt = Math.max(1, parseInt(page));
            const limitInt = Math.min(100, Math.max(1, parseInt(pageSize)));

            const [totalRes, messages] = await Promise.all([
                db.select({ count: count() })
                    .from(RdvConversationMessage)
                    .where(eq(RdvConversationMessage.conversationId, conversation.id)),
                db.query.RdvConversationMessage.findMany({
                    where: eq(RdvConversationMessage.conversationId, conversation.id),
                    orderBy: (m, { desc }) => [desc(m.createdAt)],
                    offset: (pageInt - 1) * limitInt,
                    limit: limitInt,
                }),
            ]);
            const total = totalRes[0].count;

            // Map to legacy response format (System A shape)
            const mapped = messages.map(m => ({
                id: m.id,
                sender: m.senderType === 'USER' ? 'BENEFICIARY' : m.senderType,
                content: decryptMessageBody(m.body),
                createdAt: m.createdAt,
                read_at: null, // RdvConversationMessage has no read_at
                attachments: [], // System B has no attachments (yet)
            }));

            return res.status(200).json({
                appointmentId: conversation.appointmentId,
                messages: mapped,
                pagination: {
                    page: pageInt,
                    pageSize: limitInt,
                    total,
                    totalPages: Math.ceil(total / limitInt)
                }
            });
        }

        // POST: Send message
        if (req.method === 'POST') {
            const { content } = req.body;
            if (!content) return res.status(400).json({ error: "Empty message" });

            const [msg] = await db.insert(RdvConversationMessage).values({
                id: crypto.randomUUID(),
                conversationId: conversation.id,
                senderType: 'USER', // Legacy 'BENEFICIARY' → System B 'USER'
                body: encrypt(content),
            }).returning();

            // Update conversation timestamp
            await db.update(RdvConversation)
                .set({ lastMessageAt: msg.createdAt })
                .where(eq(RdvConversation.id, conversation.id));

            return res.status(201).json({ success: true, messageId: msg.id });
        }

        // PATCH: Mark as read (best-effort compatibility)
        if (req.method === 'PATCH') {
            const { action } = req.body;
            if (action === 'read_all') {
                // RdvConversationMessage has no read_at field — acknowledge silently
                return res.status(200).json({ success: true });
            }
            return res.status(400).json({ error: "Invalid action" });
        }

        return res.status(405).json({ error: "Method not allowed" });
    } catch (error) {
        logger.error("Public Message Proxy Error:", error);
        return res.status(500).json({ error: "Internal Server Error", details: error.message });
    }
}
