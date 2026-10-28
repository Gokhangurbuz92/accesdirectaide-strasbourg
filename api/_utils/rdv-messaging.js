// @ts-nocheck
import { db } from '../../src/db/index.js';
import { RdvNotificationLog } from '../../src/db/schema.js';
import { sendMail } from './mailer.js';
import { buildAppUrl } from './user-auth.js';
import { decrypt } from '../lib/crypto.js';

export const MAX_MESSAGE_LENGTH = 2000;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeMessageBody(value) {
  const raw = String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  return raw.length > MAX_MESSAGE_LENGTH ? raw.slice(0, MAX_MESSAGE_LENGTH) : raw;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function buildMessagePreview(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  // a message stored in the former browser-encrypted format (« E2EE: ») is readable only inside the conversation, never as a preview
  if (text.startsWith('E2EE:')) return 'Message (ouvrez la conversation pour le lire)';
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatParisDate(value) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return 'Date non disponible';
  return date.toLocaleString('fr-FR', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  });
}

/**
 * @param {any} message
 */
export function serializeRdvMessage(message) {
  return {
    id: message.id,
    senderType: message.senderType,
    body: decryptMessageBody(message.body),
    createdAt: toIso(message.createdAt),
  };
}

/**
 * Decrypt a RdvConversationMessage body.
 * Supports both encrypted (v1:iv:tag:data) and legacy plaintext.
 * @param {string | null} body
 * @returns {string | null}
 */
export function decryptMessageBody(body) {
  if (!body) return null;
  // Encrypted messages start with 'v1:' prefix
  if (body.startsWith('v1:')) {
    try {
      return decrypt(body);
    } catch {
      // If decryption fails, return placeholder
      return '[Message indéchiffrable]';
    }
  }
  // Legacy plaintext — return as-is (backward compatibility)
  return body;
}

/**
 * @param {any} conversation
 */
export function serializeConversationListItem(conversation) {
  const latestMessage = Array.isArray(conversation.messages) ? conversation.messages[0] : null;

  return {
    id: conversation.id,
    appointmentId: conversation.appointmentId,
    structure: conversation.structure
      ? {
          id: conversation.structure.id,
          slug: conversation.structure.slug,
          name: conversation.structure.nom,
        }
      : null,
    appointment: conversation.appointment
      ? {
          id: conversation.appointment.id,
          startsAt: toIso(conversation.appointment.startAt),
          endsAt: toIso(conversation.appointment.endAt),
          status: String(conversation.appointment.status || '').toUpperCase(),
          serviceName: conversation.appointment.service?.name || null,
        }
      : null,
    lastMessageAt: toIso(conversation.lastMessageAt),
    lastMessagePreview: latestMessage ? buildMessagePreview(decryptMessageBody(latestMessage.body)) : null,
  };
}

/**
 * @param {any} conversation
 */
export function serializeConversationDetail(conversation) {
  return {
    id: conversation.id,
    appointmentId: conversation.appointmentId,
    structure: conversation.structure
      ? {
          id: conversation.structure.id,
          slug: conversation.structure.slug,
          name: conversation.structure.nom,
        }
      : null,
    appointment: conversation.appointment
      ? {
          id: conversation.appointment.id,
          startsAt: toIso(conversation.appointment.startAt),
          endsAt: toIso(conversation.appointment.endAt),
          status: String(conversation.appointment.status || '').toUpperCase(),
          serviceName: conversation.appointment.service?.name || null,
        }
      : null,
    lastMessageAt: toIso(conversation.lastMessageAt),
    messages: Array.isArray(conversation.messages)
      ? conversation.messages.map((message) => serializeRdvMessage(message))
      : [],
  };
}

/**
 * @param {{
 *  conversationId: string,
 *  messageId: string,
 *  recipientType: 'USER' | 'PRO',
 *  recipientEmail: string | null,
 *  recipientEnabled: boolean,
 *  structureName: string,
 *  appointmentStartAt: Date | null,
 * }} input
 */
export async function notifyConversationMessage(input) {
  if (!input.recipientEmail || !input.recipientEnabled) {
    return { sent: false, skipped: true, reason: 'opt_out' };
  }

  try {
    await db.insert(RdvNotificationLog).values({
      kind: 'MESSAGE_EMAIL',
      conversationId: input.conversationId,
      messageId: input.messageId,
      recipientType: input.recipientType,
    });
  } catch (error) {
    // Drizzle wraps pg driver errors in DrizzleQueryError — the native
    // PostgreSQL error code lives on error.cause, not on error directly.
    const pgCode = error?.cause?.code || error?.code;
    // PostgreSQL 23505 = unique constraint violation (duplicate notification)
    if (pgCode === '23505') {
      return { sent: false, skipped: true, reason: 'duplicate' };
    }
    throw error;
  }

  const destinationPath =
    input.recipientType === 'PRO'
      ? `/pro/messages/${encodeURIComponent(input.conversationId)}`
      : `/compte/messages/${encodeURIComponent(input.conversationId)}`;

  const url = buildAppUrl(destinationPath);
  const appointmentDate = input.appointmentStartAt ? formatParisDate(input.appointmentStartAt) : 'Date non disponible';

  await sendMail({
    to: input.recipientEmail,
    subject: 'Nouveau message concernant votre rendez-vous - Acces Direct Aide',
    text: [
      'Vous avez recu un nouveau message concernant votre rendez-vous.',
      '',
      `Structure: ${input.structureName || 'Acces Direct Aide'}`,
      `Date du rendez-vous: ${appointmentDate}`,
      '',
      `Voir la conversation: ${url}`,
    ].join('\n'),
    category: 'appointment_message',
  });

  return { sent: true, skipped: false };
}
