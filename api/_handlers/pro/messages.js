// @ts-nocheck
/**
 * GET/POST /api/pro/messages?appointmentId=…  — contract used by the pro AppointmentDetail "Messages" tab.
 * Thin adapter over RdvConversation / RdvConversationMessage (same tables, encryption and notifications as
 * pro/messages-conversations.js). Replaces the legacy proxy deleted in f0a5a3b (it imported a non-existent table
 * and invented a 'legacy-anonymous' citizen, which violates the FK).
 *
 *  GET  → { ok, conversationId|null, messages: [{ id, sender: 'PRO'|'BENEFICIARY', content, createdAt, attachments: [] }] }
 *  POST { content } → 201 { ok, item }   (409 NO_CITIZEN_ACCOUNT when the beneficiary has no verified account to receive it)
 * Appointments of other structures answer 404 (no existence leak). Attachments are not supported (upload is unrouted).
 */
import crypto from 'crypto';
import { eq, asc } from 'drizzle-orm';
import { db } from '../../../src/db/index.js';
import { RdvConversation, RdvConversationMessage } from '../../../src/db/schema.js';
import { requireProStructureContext } from '../../_utils/auth.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { withProRdvHandler } from '../../_utils/with-pro-rdv-handler.js';
import { encrypt } from '../../lib/crypto.js';
import { notifyConversationMessage, sanitizeMessageBody, serializeRdvMessage } from '../../_utils/rdv-messaging.js';
import { canNotify } from '../../_services/citizen-account.js';

const PAGE = 200;

function toLegacyMessage(message) {
  const m = serializeRdvMessage(message);
  return { id: m.id, sender: m.senderType === 'PRO' ? 'PRO' : 'BENEFICIARY', content: m.body, createdAt: m.createdAt, attachments: [] };
}

async function rateLimited(req, res, action, key) {
  const result = await checkRateLimit(action, `${key}:${getClientIp(req)}`);
  if (result?.allowed === false) {
    res.status(getRateLimitStatus(result)).json({ error: 'Too Many Requests' });
    return true;
  }
  return false;
}

async function handler(req, res) {
  const proCtx = requireProStructureContext(req, res);
  if (!proCtx) return;

  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const url = new URL(req.url || '/api/pro/messages', `https://${req.headers?.host || 'localhost'}`);
  const appointmentId = String(req.query?.appointmentId || url.searchParams.get('appointmentId') || '').trim();
  if (!appointmentId) return res.status(400).json({ error: 'appointmentId is required' });

  if (await rateLimited(req, res, method === 'GET' ? 'MESSAGE_PRO_READ' : 'MESSAGE_PRO_SEND', `${proCtx.userId}:apt:${appointmentId}`)) return;

  const appointment = await db.query.ProAppointment.findFirst({
    where: (a, { eq: e }) => e(a.id, appointmentId),
    columns: { id: true, structureId: true, citizenUserId: true, startAt: true },
    with: { structure: { columns: { nom: true } } },
  });
  if (!appointment || appointment.structureId !== proCtx.structureId) {
    return res.status(404).json({ error: 'Appointment not found' });
  }

  const conversation = await db.query.RdvConversation.findFirst({ where: eq(RdvConversation.appointmentId, appointment.id) });

  if (method === 'GET') {
    if (!conversation) return res.status(200).json({ ok: true, conversationId: null, messages: [] });
    const rows = await db.select().from(RdvConversationMessage)
      .where(eq(RdvConversationMessage.conversationId, conversation.id))
      .orderBy(asc(RdvConversationMessage.createdAt)).limit(PAGE);
    return res.status(200).json({ ok: true, conversationId: conversation.id, messages: rows.map(toLegacyMessage) });
  }

  const body = sanitizeMessageBody(req.body?.content);
  if (!body) return res.status(400).json({ error: 'Message content is required' });

  const citizen = appointment.citizenUserId
    ? await db.query.CitizenUser.findFirst({
        where: (c, { eq: e }) => e(c.id, appointment.citizenUserId),
        columns: { email: true, emailVerifiedAt: true, notificationEmailEnabled: true },
      })
    : null;
  if (!conversation && !appointment.citizenUserId) {
    return res.status(409).json({ error: 'The beneficiary has no account to receive messages', code: 'NO_CITIZEN_ACCOUNT' });
  }

  const convId = conversation
    ? conversation.id
    : (await db.insert(RdvConversation).values({
        id: crypto.randomUUID(), appointmentId: appointment.id, structureId: appointment.structureId,
        citizenUserId: appointment.citizenUserId, lastMessageAt: new Date(), updatedAt: new Date(),
      }).onConflictDoUpdate({ target: RdvConversation.appointmentId, set: { updatedAt: new Date() } }).returning())[0].id;

  const [message] = await db.insert(RdvConversationMessage).values({
    conversationId: convId, senderType: 'PRO', senderProUserId: proCtx.userId, body: encrypt(body),
  }).returning();
  await db.update(RdvConversation).set({ lastMessageAt: message.createdAt }).where(eq(RdvConversation.id, convId));

  try {
    await notifyConversationMessage({
      conversationId: convId, messageId: message.id, recipientType: 'USER',
      recipientEmail: citizen?.email || null,
      // PKG-11 audit: the single consent question (preference, ledger, restriction of processing) — the bare flag ignored an art. 18 restriction
      recipientEnabled: Boolean(citizen?.emailVerifiedAt && appointment.citizenUserId && await canNotify(appointment.citizenUserId, 'email', 'service').catch(() => false)),
      structureName: appointment.structure?.nom || 'Acces Direct Aide', appointmentStartAt: appointment.startAt || null,
    });
  } catch {
    // e-mail stays best-effort
  }
  return res.status(201).json({ ok: true, item: toLegacyMessage(message) });
}

export default withProRdvHandler('pro_messages', handler);
