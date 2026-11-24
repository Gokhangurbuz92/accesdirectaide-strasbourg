// @ts-nocheck
/**
 * R3 — « Signaler » a message of an appointment conversation (citizen ↔ structure), from inside the thread.
 *
 * Reuses the existing content-report flow (table "ContentReport", administrator triage GET /api/reports): one row with contentType STRUCTURE (the structure
 * of the conversation), reason AUTRE and a short, fixed-format description. Privacy: the message text is NEVER copied into the report — the
 * administrator does not read conversations (no admin message reader); the report names the conversation, the message, the side that reports and a
 * category from a closed list. The reporter is the signed-in account (its e-mail is not copied either: the operator answers through the conversation's
 * parties if needed). Only a message of the OTHER party can be reported, inside a conversation the caller may read and that this deployment serves.
 */
import crypto from 'node:crypto';
import { db as defaultDb } from '../../src/db/index.js';
import { ContentReport, RdvConversationMessage } from '../../src/db/schema.js';
import { and, eq } from 'drizzle-orm';

/** the closed list of categories (the UI shows the same list, six languages) */
export const MESSAGE_REPORT_CATEGORIES = Object.freeze(['ABUSIVE', 'SPAM', 'HEALTH_DATA', 'NOT_RELATED', 'OTHER']);

/**
 * the fixed description stored in ContentReport.message (no free text, no message content)
 * @param {{ side: 'USER' | 'PRO', conversationId: string, messageId: string, category: string }} r
 */
export const messageReportText = (r) => `[messagerie] signalé par : ${r.side === 'PRO' ? 'la structure' : 'la personne'} ; catégorie : ${r.category} ; conversation : ${r.conversationId} ; message : ${r.messageId}`;

/**
 * Files the report. The caller has already checked that the conversation is the caller's own (citizen) or its structure's (professional) and that it is
 * served (messaging-policy conversationAllowed).
 * @param {{ side: 'USER' | 'PRO', conversation: { id: string, structureId: string }, messageId: unknown, category: unknown }} input
 * @param {{ db?: any }} [deps]
 * @returns {Promise<{ ok: true, reportId: string } | { ok: false, status: number, error: string }>}
 */
export async function fileMessageReport(input, deps = {}) {
  const db = deps.db || defaultDb;
  const category = String(input.category || '');
  if (!MESSAGE_REPORT_CATEGORIES.includes(category)) return { ok: false, status: 400, error: 'INVALID_CATEGORY' };
  const messageId = String(input.messageId || '');
  if (!/^[A-Za-z0-9-]{1,64}$/.test(messageId)) return { ok: false, status: 400, error: 'INVALID_MESSAGE' };
  const [message] = await db.select({ id: RdvConversationMessage.id, senderType: RdvConversationMessage.senderType })
    .from(RdvConversationMessage)
    .where(and(eq(RdvConversationMessage.id, messageId), eq(RdvConversationMessage.conversationId, input.conversation.id)))
    .limit(1);
  // a message of another conversation answers like an unknown one; one's own message cannot be reported
  if (!message) return { ok: false, status: 404, error: 'MESSAGE_NOT_FOUND' };
  if (String(message.senderType) === input.side) return { ok: false, status: 400, error: 'OWN_MESSAGE' };
  const id = crypto.randomUUID();
  await db.insert(ContentReport).values({
    id,
    contentType: 'STRUCTURE',
    contentId: String(input.conversation.structureId),
    reason: 'AUTRE',
    message: messageReportText({ side: input.side, conversationId: input.conversation.id, messageId, category }),
    pageUrl: null,
    reporterEmail: null,
    status: 'NEW',
  });
  return { ok: true, reportId: id };
}
