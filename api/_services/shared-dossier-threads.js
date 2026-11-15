// @ts-nocheck
/**
 * Data access for structure <-> shared-diagnostic chats (tables SharedDossierThread / SharedDossierMessage).
 * Kept free of HTTP concerns so the authorization logic in the handlers can be tested against a fake of this module,
 * and the SQL itself against a real PostgreSQL (tests/integration/shared-dossier-thread-db.test.js).
 */
import crypto from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { SharedDiagnostic, SharedDossierGrant, SharedDossierMessage, SharedDossierThread, Structure } from '../../src/db/schema.js';
import { sealText, openText } from '../lib/data-keys.js';

/** @param {string} id */
export async function getDossier(id) {
  const [row] = await db.select({ id: SharedDiagnostic.id, expiresAt: SharedDiagnostic.expiresAt, rightsSecretHash: SharedDiagnostic.rightsSecretHash, shareTokenHash: SharedDiagnostic.shareTokenHash, ownerCitizenId: SharedDiagnostic.ownerCitizenId })
    .from(SharedDiagnostic).where(eq(SharedDiagnostic.id, id)).limit(1);
  return row || null;
}

/** Server-side envelope encryption (v2): random per-message data key, bound to the thread by AAD. @param {string} threadId @param {string} text */
export const sealMessage = (threadId, text) => sealText(text, { purpose: 'dossier-message', context: `thread:${threadId}` });
/** Reads v2 values and the legacy v1 values written before RC5-product. @param {string} threadId @param {string} body */
export const openMessage = (threadId, body) => openText(body, { purpose: 'dossier-message', context: `thread:${threadId}` });

export const isExpired = (dossier) => !(new Date(dossier.expiresAt).getTime() > Date.now());

/** @param {string} dossierId @param {string} structureId */
export async function findThread(dossierId, structureId) {
  const [row] = await db.select().from(SharedDossierThread)
    .where(and(eq(SharedDossierThread.sharedDiagnosticId, dossierId), eq(SharedDossierThread.structureId, structureId))).limit(1);
  return row || null;
}

/** Thread of a dossier by id (the caller proves dossier ownership separately). @param {string} dossierId @param {string} threadId */
export async function findThreadOfDossier(dossierId, threadId) {
  const [row] = await db.select().from(SharedDossierThread)
    .where(and(eq(SharedDossierThread.id, threadId), eq(SharedDossierThread.sharedDiagnosticId, dossierId))).limit(1);
  return row || null;
}

/** Idempotent: one thread per (dossier, structure). */
export async function openThread({ dossierId, structureId, proUserId }) {
  await db.insert(SharedDossierThread).values({ sharedDiagnosticId: dossierId, structureId, openedByProUserId: proUserId }).onConflictDoNothing();
  return findThread(dossierId, structureId);
}

/**
 * A-17: `closed` = the organisation of the thread no longer holds an active grant on the dossier (the person removed it, or stopped sharing): its members can no longer
 * open the thread, so the person may still read it but a new message would reach nobody.
 */
export async function listThreads(dossierId) {
  return db.select({
    id: SharedDossierThread.id, structureName: Structure.nom, lastMessageAt: SharedDossierThread.lastMessageAt, createdAt: SharedDossierThread.createdAt,
    closed: sql`NOT EXISTS (SELECT 1 FROM ${SharedDossierGrant} g WHERE g."sharedDiagnosticId" = ${SharedDossierThread.sharedDiagnosticId} AND g."structureId" = ${SharedDossierThread.structureId} AND g."revokedAt" IS NULL)`.mapWith(Boolean),
  })
    .from(SharedDossierThread).innerJoin(Structure, eq(Structure.id, SharedDossierThread.structureId))
    .where(eq(SharedDossierThread.sharedDiagnosticId, dossierId)).orderBy(asc(SharedDossierThread.createdAt)).limit(50);
}

/** A-17: does the organisation of this thread still hold an active (not revoked) grant on the dossier? @param {{ sharedDiagnosticId: string, structureId: string }} thread */
export async function threadGrantActive(thread) {
  const [row] = await db.select({ id: SharedDossierGrant.id }).from(SharedDossierGrant)
    .where(and(eq(SharedDossierGrant.sharedDiagnosticId, thread.sharedDiagnosticId), eq(SharedDossierGrant.structureId, thread.structureId), sql`${SharedDossierGrant.revokedAt} IS NULL`)).limit(1);
  return Boolean(row);
}

/**
 * A-17: trace of an answer written by the person (who, on which dossier, to which organisation — never the content). Best effort: the message is already stored.
 * @param {{ dossierId: string, threadId: string, structureId: string, citizenId?: string | null }} e
 */
export async function auditSharerMessage(e) {
  await db.execute(sql`INSERT INTO "AuditLog" (id, action, actor, actor_id, entity, entity_id, details, "timestamp")
    VALUES (${crypto.randomUUID()}, 'DOSSIER_THREAD_ANSWERED', ${e.citizenId ? 'citizen' : 'sharer'}, ${e.citizenId || null}, 'SharedDiagnostic', ${e.dossierId},
      ${JSON.stringify({ shareId: e.dossierId, threadId: e.threadId, structureId: e.structureId, via: e.citizenId ? 'account' : 'owner_secret' })}::jsonb, NOW())`).catch(() => {});
}

export async function listMessages(threadId, limit = 50) {
  return db.select().from(SharedDossierMessage).where(eq(SharedDossierMessage.threadId, threadId)).orderBy(asc(SharedDossierMessage.createdAt)).limit(limit);
}

/** @param {{ threadId: string, senderType: 'PRO' | 'SHARER', senderProUserId?: string | null, body: string }} m */
export async function addMessage(m) {
  const [msg] = await db.insert(SharedDossierMessage).values({ threadId: m.threadId, senderType: m.senderType, senderProUserId: m.senderProUserId || null, body: m.body }).returning();
  await db.update(SharedDossierThread).set({ lastMessageAt: msg.createdAt }).where(eq(SharedDossierThread.id, m.threadId));
  return msg;
}
