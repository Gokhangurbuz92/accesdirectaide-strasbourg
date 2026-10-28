// @ts-nocheck
import { db } from '../../../src/db/index.js';
import { RdvConversation, RdvConversationMessage } from '../../../src/db/schema.js';
import { eq, desc, asc } from 'drizzle-orm';
import { requireProStructureContext } from '../../_utils/auth.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { withProRdvHandler } from '../../_utils/with-pro-rdv-handler.js';
import { encrypt } from '../../lib/crypto.js';
import {
  notifyConversationMessage,
  sanitizeMessageBody,
  serializeConversationDetail,
  serializeConversationListItem,
  serializeRdvMessage,
} from '../../_utils/rdv-messaging.js';
import { insertMessageWithAttachment, prepareAttachment, readAttachment, sendAttachment, withAttachments } from '../../_services/message-attachments.js';
import { canNotify } from '../../_services/citizen-account.js';

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @returns {URL}
 */
function getUrl(req) {
  return new URL(req.url || '/api/pro/messages/conversations', `https://${req.headers?.host || 'localhost'}`);
}

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @returns {string[]}
 */
function getPathSegments(req) {
  const pathname = getUrl(req).pathname || '';
  const normalized = pathname
    .replace(/^\/api\/pro\/messages\/conversations\/?/i, '')
    .replace(/^\/pro\/messages\/conversations\/?/i, '')
    .replace(/\/+$/, '');
  if (!normalized) return [];
  return normalized.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} max
 */
function toLimit(value, fallback, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, parsed));
}

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {string} action
 * @param {string} subject
 */
async function enforceRateLimit(req, action, subject) {
  const key = `${subject}:${getClientIp(req)}`;
  const result = await checkRateLimit(action, key);
  if (!result.allowed) {
    return {
      allowed: false,
      status: getRateLimitStatus(result),
      error: result.error || { error: 'Trop de demandes : réessayez dans un instant.' },
    };
  }
  return { allowed: true };
}

/**
 * @param {string} conversationId
 * @param {number} limit
 */
async function loadConversationForPro(conversationId, limit) {
  return db.query.RdvConversation.findFirst({
    where: eq(RdvConversation.id, conversationId),
    with: {
      structure: {
        columns: { id: true, slug: true, nom: true },
      },
      appointment: {
        columns: { id: true, startAt: true, endAt: true, status: true },
        with: {
          service: { columns: { id: true, name: true } },
        },
      },
      messages: {
        orderBy: [asc(RdvConversationMessage.createdAt)],
      },
      citizenUser: {
        columns: { id: true },
      },
    },
  });
}

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
async function getConversations(req, res, proCtx) {
  const readLimit = await enforceRateLimit(req, 'MESSAGE_PRO_READ', `${proCtx.userId}:conversations`);
  if (!readLimit.allowed) {
    return res.status(readLimit.status).json(readLimit.error);
  }

  const url = getUrl(req);
  const limit = toLimit(url.searchParams.get('limit'), 20, 100);

  const conversations = await db.query.RdvConversation.findMany({
    where: eq(RdvConversation.structureId, proCtx.structureId),
    limit,
    orderBy: [desc(RdvConversation.lastMessageAt)],
    with: {
      structure: {
        columns: { id: true, slug: true, nom: true },
      },
      appointment: {
        columns: { id: true, startAt: true, endAt: true, status: true },
        with: {
          service: { columns: { id: true, name: true } },
        },
      },
      messages: {
        orderBy: [desc(RdvConversationMessage.createdAt)],
      },
    },
  });

  return res.status(200).json({
    ok: true,
    items: conversations.map((conversation) => serializeConversationListItem(conversation)),
  });
}

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
async function getConversation(req, res, proCtx, conversationId) {
  const readLimit = await enforceRateLimit(req, 'MESSAGE_PRO_READ', `${proCtx.userId}:${conversationId}`);
  if (!readLimit.allowed) {
    return res.status(readLimit.status).json(readLimit.error);
  }

  const url = getUrl(req);
  const limit = toLimit(url.searchParams.get('limit'), 50, 200);

  const conversation = await loadConversationForPro(conversationId, limit);
  // PKG-4: another organization's conversation answers exactly like an unknown id (no existence oracle)
  if (!conversation || conversation.structureId !== proCtx.structureId) {
    return res.status(404).json({ error: 'Conversation introuvable.' });
  }

  return res.status(200).json({
    ok: true,
    item: await withAttachments(serializeConversationDetail(conversation)),   // PKG-4 / R14
  });
}

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
async function sendMessage(req, res, proCtx, conversationId) {
  const writeLimit = await enforceRateLimit(req, 'MESSAGE_PRO_SEND', `${proCtx.userId}:${conversationId}`);
  if (!writeLimit.allowed) {
    return res.status(writeLimit.status).json(writeLimit.error);
  }

  // PKG-4 / R14: a message may carry ONE file (validated before anything is written); text is then optional
  const prepared = prepareAttachment(req.body?.attachment);
  if (!prepared.ok) return res.status(prepared.status).json({ error: prepared.code, message: prepared.message });
  const body = sanitizeMessageBody(req.body?.body) || (prepared.file ? 'Pièce jointe' : null);
  if (!body) {
    return res.status(400).json({ error: 'Le message est vide.' });
  }

  // Sequential operations (neon-http driver doesn't support transactions)
  const conversation = await db.query.RdvConversation.findFirst({
    where: eq(RdvConversation.id, conversationId),
    with: {
      structure: { columns: { id: true, nom: true } },
      appointment: { columns: { id: true, startAt: true } },
      citizenUser: {
        columns: {
          id: true,
          email: true,
          emailVerifiedAt: true,
          notificationEmailEnabled: true,
        },
      },
    },
  });

  if (!conversation || conversation.structureId !== proCtx.structureId) {
    return res.status(404).json({ error: 'Conversation introuvable.' });
  }

  const { message, attachment } = await insertMessageWithAttachment({ conversationId: conversation.id, senderType: 'PRO', senderProUserId: proCtx.userId, body: encrypt(body), file: prepared.file });

  await db.update(RdvConversation).set({
      lastMessageAt: message.createdAt,
  }).where(eq(RdvConversation.id, conversation.id));

  const created = { conversation, message, forbidden: false };

  try {
    await notifyConversationMessage({
      conversationId: created.conversation.id,
      messageId: created.message.id,
      recipientType: 'USER',
      recipientEmail: created.conversation.citizenUser?.email || null,
      // PKG-11 audit: the single consent question (preference, ledger, restriction of processing)
      recipientEnabled: Boolean(created.conversation.citizenUser?.emailVerifiedAt && created.conversation.citizenUser?.id
        && await canNotify(created.conversation.citizenUser.id, 'email', 'service').catch(() => false)),
      structureName: created.conversation.structure?.nom || 'Acces Direct Aide',
      appointmentStartAt: created.conversation.appointment?.startAt || null,
    });
  } catch {
    // Email delivery stays best-effort for messaging.
  }

  return res.status(201).json({
    ok: true,
    item: { ...serializeRdvMessage(created.message), attachments: attachment ? [attachment] : [] },
  });
}

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
async function handler(req, res) {
  const proCtx = requireProStructureContext(req, res);
  if (!proCtx) return;

  const method = String(req.method || 'GET').toUpperCase();
  const segments = getPathSegments(req);

  if (method === 'GET' && segments.length === 0) {
    return getConversations(req, res, proCtx);
  }

  if (method === 'GET' && segments[0] && segments[1] === 'attachments' && segments[2]) {
    // PKG-4 / R14: the file of a message, only through a conversation of the caller's organization
    const conversation = await db.query.RdvConversation.findFirst({ where: eq(RdvConversation.id, String(segments[0])), columns: { id: true, structureId: true } });
    if (!conversation || conversation.structureId !== proCtx.structureId) return res.status(404).json({ error: 'Introuvable.' });
    const out = await readAttachment(conversation.id, String(segments[2]));
    return out.ok ? sendAttachment(res, out) : res.status(404).json({ error: 'Introuvable.' });
  }

  if (method === 'GET' && segments[0]) {
    return getConversation(req, res, proCtx, String(segments[0]));
  }

  if (method === 'POST' && segments[0]) {
    return sendMessage(req, res, proCtx, String(segments[0]));
  }

  return res.status(404).json({ error: 'Introuvable.' });
}

export default withProRdvHandler('pro_messages_conversations', handler);
