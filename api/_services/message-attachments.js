// @ts-nocheck
/**
 * PKG-4 / R14 — one file attached to a message of a professional <-> citizen appointment conversation, through the secure document pipeline:
 *   - type from the CONTENT (PDF / PNG / JPEG magic bytes, shared with Mon Coffre), declared type must agree, 1 byte .. 5 MB, one file per message;
 *   - bytes envelope-encrypted (purpose 'message-attachment', bound to conversation + attachment id) before object storage; the name is encrypted too;
 *   - read only by the two parties of THAT conversation: the citizen of the conversation, or an active member of the conversation's structure (the caller resolves
 *     who it is; this module checks the conversation binding on every read);
 *   - erased with the conversation (row cascade) and the blob purged by the erasure path (storageKeysOfCitizen).
 */
import crypto from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { RdvConversation, RdvConversationMessage, RdvMessageAttachment } from '../../src/db/schema.js';
import { storage as defaultStorage } from '../lib/storage.js';
import { openBuffer, openText, sealBuffer, sealText } from '../lib/data-keys.js';
import { sniffType } from './mon-espace.js';
import { isDeployed } from '../_utils/hds-gateway.js';

/**
 * G14-R4 — attachments through the HDS service (messaging.attachments): the browser encrypts the file end to end (src/lib/dossierCrypto.js), stores it at
 * the HDS service with a ticket bound to the conversation, then sends here ONLY its reference { hdsAttachmentId, byteLength, sha256 } (of the ciphertext).
 * The row keeps storageKey « hds:<id> », a neutral name and the octet-stream type; the real name and type exist only encrypted at the HDS service.
 * In a deployed environment file BYTES are refused here (409 HDS_SERVICE_REQUIRED): they never reach Vercel / object storage.
 */
export const HDS_KEY_PREFIX = 'hds:';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// R34 (R33 audit G5): 3 MB, as the Coffre (src/lib/fileVaultLimits.js) — the file travels as base64 JSON (+33 %) and a serverless request body is capped near
// 4.5 MB, so 5 MB (6.7 MB encoded) failed on the hosting before reaching this check
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
const TOO_LARGE = Symbol('too-large');
const ctxOf = (conversationId, id) => `rdvatt:${conversationId}:${id}`;

function decode(value) {
  if (typeof value !== 'string') return null;
  let raw = value.trim(); const comma = raw.indexOf(',');
  if (/^data:/i.test(raw) && comma >= 0) raw = raw.slice(comma + 1);
  raw = raw.replace(/\s+/g, '');
  if (raw.length > Math.ceil(MAX_ATTACHMENT_BYTES * 4 / 3) + 16) return TOO_LARGE;   // said as such, not as an unreadable file
  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 === 1) return null;
  try { return Buffer.from(raw, 'base64'); } catch { return null; }
}

/** Validate an attachment BEFORE anything is written. Returns { ok, file } or a refusal. */
export function prepareAttachment(input, envVars = process.env) {
  if (input === undefined || input === null) return { ok: true, file: null };
  if (typeof input !== 'object') return bad('INVALID_ATTACHMENT', 'Pièce jointe invalide.');
  if (input.hdsAttachmentId !== undefined) {
    const id = String(input.hdsAttachmentId); const n = Number(input.byteLength); const sum = String(input.sha256 || '');
    if (!UUID_RE.test(id) || !Number.isInteger(n) || n <= 0 || n > MAX_ATTACHMENT_BYTES + 64 || !/^[0-9a-f]{64}$/.test(sum)) return bad('INVALID_ATTACHMENT', 'Pièce jointe invalide.');
    return { ok: true, file: { hds: true, id, byteLength: n, sha256: sum } };
  }
  if (isDeployed(envVars)) return bad('HDS_SERVICE_REQUIRED', 'Les pièces jointes sont chiffrées dans votre navigateur et conservées chez un hébergeur certifié : ce service ne les reçoit pas.', 409);
  const buf = decode(input.contentBase64);
  if (buf !== TOO_LARGE && (!buf || !buf.length)) return bad('INVALID_ATTACHMENT', 'Pièce jointe illisible.');
  if (buf === TOO_LARGE || buf.length > MAX_ATTACHMENT_BYTES) return bad('ATTACHMENT_TOO_LARGE', 'La pièce jointe dépasse 3 Mo.', 413);
  const mimeType = sniffType(buf);
  if (!mimeType) return bad('UNSUPPORTED_TYPE', 'Seuls les fichiers PDF, PNG et JPEG sont acceptés.', 415);
  if (input.mimeType && String(input.mimeType) !== mimeType) return bad('TYPE_MISMATCH', 'Le contenu du fichier ne correspond pas à son type.', 415);
  const name = String(input.filename || 'piece-jointe').replace(/[\r\n"\\/]/g, '_').slice(0, 120) || 'piece-jointe';
  return { ok: true, file: { buf, mimeType, name } };
}

/** Insert the message and its attachment together; the blob is removed again if the rows cannot be written. Returns { message, attachment }. */
export async function insertMessageWithAttachment({ conversationId, senderType, senderProUserId = null, senderCitizenUserId = null, body, file }, deps = {}) {
  const db = deps.db || defaultDb; const storage = deps.storage || defaultStorage;
  if (!file) {
    const [message] = await db.insert(RdvConversationMessage).values({ conversationId, senderType, senderProUserId, senderCitizenUserId, body }).returning();
    return { message, attachment: null };
  }
  if (file.hds) {
    return db.transaction(async (tx) => {
      const [message] = await tx.insert(RdvConversationMessage).values({ conversationId, senderType, senderProUserId, senderCitizenUserId, body }).returning();
      const [attachment] = await tx.insert(RdvMessageAttachment).values({ id: file.id, conversationId, messageId: message.id, uploaderType: senderType === 'PRO' ? 'PRO' : 'CITIZEN',
        storageKey: `${HDS_KEY_PREFIX}${file.id}`, filenameEncrypted: sealText('piece-jointe', { purpose: 'message-attachment-name', context: ctxOf(conversationId, file.id) }),
        mimeType: 'application/octet-stream', byteLength: file.byteLength, checksumSha256: file.sha256 }).returning();
      return { message, attachment: view(attachment) };
    });
  }
  const id = crypto.randomUUID();
  const key = await storage.upload(sealBuffer(file.buf, { purpose: 'message-attachment', context: ctxOf(conversationId, id) }), 'application/octet-stream');
  try {
    return await db.transaction(async (tx) => {
      const [message] = await tx.insert(RdvConversationMessage).values({ conversationId, senderType, senderProUserId, senderCitizenUserId, body }).returning();
      const [attachment] = await tx.insert(RdvMessageAttachment).values({ id, conversationId, messageId: message.id, uploaderType: senderType === 'PRO' ? 'PRO' : 'CITIZEN', storageKey: key,
        filenameEncrypted: sealText(file.name, { purpose: 'message-attachment-name', context: ctxOf(conversationId, id) }), mimeType: file.mimeType, byteLength: file.buf.length,
        checksumSha256: crypto.createHash('sha256').update(file.buf).digest('hex') }).returning();
      return { message, attachment: view(attachment) };
    });
  } catch (err) {
    await storage.delete(key).catch(() => {});   // never leave an orphan encrypted blob
    throw err;
  }
}

function view(a) {
  let name = 'piece-jointe';
  try { name = openText(a.filenameEncrypted, { purpose: 'message-attachment-name', context: ctxOf(a.conversationId, a.id) }) || name; } catch { /* neutral label */ }
  const hds = String(a.storageKey || '').startsWith(HDS_KEY_PREFIX);
  return { id: a.id, messageId: a.messageId, name, mimeType: a.mimeType, byteLength: a.byteLength, uploaderType: a.uploaderType, createdAt: a.createdAt, ...(hds ? { hds: true } : {}) };
}

/** messageId -> [attachment] for one conversation (metadata only). */
export async function attachmentsByMessage(conversationId, db = defaultDb) {
  const rows = await db.select().from(RdvMessageAttachment).where(eq(RdvMessageAttachment.conversationId, conversationId));
  const map = {};
  for (const a of rows) (map[a.messageId] = map[a.messageId] || []).push(view(a));
  return map;
}

/** The decrypted file, only through ITS conversation (the caller has already proven it is a party of that conversation). */
export async function readAttachment(conversationId, attachmentId, deps = {}) {
  const db = deps.db || defaultDb; const storage = deps.storage || defaultStorage;
  const [a] = await db.select().from(RdvMessageAttachment).where(and(eq(RdvMessageAttachment.id, String(attachmentId || '')), eq(RdvMessageAttachment.conversationId, String(conversationId || '')))).limit(1);
  if (!a) return bad('not_found', 'Pièce jointe introuvable.', 404);
  if (String(a.storageKey).startsWith(HDS_KEY_PREFIX)) return bad('HDS_SERVICE_REQUIRED', 'Cette pièce jointe est chiffrée chez l’hébergeur certifié : ouvrez-la depuis la conversation.', 409);
  const bytes = openBuffer(await storage.download(a.storageKey), { purpose: 'message-attachment', context: ctxOf(a.conversationId, a.id) });
  return { ok: true, bytes, meta: view(a) };
}

/** Storage keys of every attachment in the conversations of one citizen (erasure: the rows cascade, these blobs are purged after commit). */
export async function storageKeysOfCitizen(citizenUserId, db = defaultDb) {
  const conv = db.select({ id: RdvConversation.id }).from(RdvConversation).where(eq(RdvConversation.citizenUserId, citizenUserId));
  // G14-R4: « hds:… » rows have no blob here (the HDS service erases them with the person: api/lib/hds-erasure.js)
  return (await db.select({ k: RdvMessageAttachment.storageKey }).from(RdvMessageAttachment).where(inArray(RdvMessageAttachment.conversationId, conv))).map((r) => r.k).filter((k) => !String(k).startsWith(HDS_KEY_PREFIX));
}

/** HTTP answer for a decrypted attachment: forced download, content type from the stored (sniffed) type, never rendered inline. */
export function sendAttachment(res, out) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', out.meta.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="${String(out.meta.name).replace(/[^\w.\- ]/g, '_')}"`);
  res.setHeader('Content-Length', out.bytes.length);
  return res.status(200).send(out.bytes);
}

/** Adds `attachments` (metadata only) to every message of a serialized conversation detail. */
export async function withAttachments(item, db = defaultDb) {
  if (!item?.id || !Array.isArray(item.messages)) return item;
  const map = await attachmentsByMessage(item.id, db);
  return { ...item, messages: item.messages.map((m) => ({ ...m, attachments: map[m.id] || [] })) };
}
