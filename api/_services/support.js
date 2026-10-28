// @ts-nocheck
/**
 * PKG-5 / A19 — support / help requests. The public form stores the request (no e-mail provider needed); the text and the optional contact are sealed
 * (data-keys purpose 'support-request') and only an MFA administrator session reads them. A support request is never linked to a dossier, a case or a document:
 * agents answer from what the person wrote, and privacy requests (category PRIVACY) are handed to the privacy console. Every status change is audited.
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';
import { sealText, openText } from '../lib/data-keys.js';

export const CATEGORIES = ['ACCOUNT', 'BOOKING', 'CONTENT', 'PRIVACY', 'ACCESSIBILITY', 'OTHER'];
const STATUSES = ['OPEN', 'IN_PROGRESS', 'ANSWERED', 'CLOSED'];
const bad = (status, code, message) => ({ ok: false, status, code, message });

export async function createRequest({ category, message, contact }, db = defaultDb) {
  const cat = String(category || '').toUpperCase(); const text = String(message || '').trim(); const who = String(contact || '').trim();
  if (!CATEGORIES.includes(cat)) return bad(400, 'INVALID_CATEGORY', 'Choisissez un type de demande.');
  if (text.length < 10 || text.length > 4000) return bad(400, 'INVALID_MESSAGE', 'Décrivez votre demande (10 à 4000 caractères).');
  if (who.length > 200) return bad(400, 'INVALID_CONTACT', 'Coordonnées trop longues.');
  const id = crypto.randomUUID();
  await db.execute(sql`INSERT INTO "SupportRequest" (id, category, "messageEncrypted", "contactEncrypted", status, "createdAt", "updatedAt")
    VALUES (${id}, ${cat}, ${sealText(text, { purpose: 'support-request', context: `support:${id}` })}, ${who ? sealText(who, { purpose: 'support-request', context: `support-contact:${id}` }) : null}, 'OPEN', NOW(), NOW())`);
  return { ok: true, id, privacy: cat === 'PRIVACY' };
}

export async function listRequests({ status, actor = null } = {}, db = defaultDb) {
  const st = STATUSES.includes(String(status || '').toUpperCase()) ? String(status).toUpperCase() : null;
  const rows = (await db.execute(sql`SELECT id, category, "messageEncrypted" AS m, "contactEncrypted" AS c, status, "assignedTo", "resolutionNote", "createdAt", "closedAt" FROM "SupportRequest"
    WHERE ${st ? sql`status = ${st}` : sql`status <> 'CLOSED'`} ORDER BY "createdAt" LIMIT 200`)).rows;
  // R12 (A19): opening the sealed messages is journaled — who read which requests (ids only, never their content); no journal row, no decrypted list
  if (rows.length) await db.insert(AuditLog).values({ action: 'SUPPORT_REQUESTS_READ', actor, actor_id: actor, entity: 'SupportRequest', entity_id: null, details: { ids: rows.map((r) => r.id), status: st || 'OPEN' } });
  return { ok: true, requests: rows.map((r) => ({ id: r.id, category: r.category, status: r.status, assignedTo: r.assignedTo, resolutionNote: r.resolutionNote, createdAt: r.createdAt, closedAt: r.closedAt,
    message: openText(r.m, { purpose: 'support-request', context: `support:${r.id}` }), contact: r.c ? openText(r.c, { purpose: 'support-request', context: `support-contact:${r.id}` }) : null,
    routedTo: r.category === 'PRIVACY' ? 'PRIVACY_CONSOLE' : null })) };
}

export async function updateRequest(id, { status, resolutionNote, assignToMe }, actor, db = defaultDb) {
  const st = String(status || '').toUpperCase();
  if (st && !STATUSES.includes(st)) return bad(400, 'INVALID_STATUS', 'Statut invalide.');
  const note = resolutionNote === undefined ? undefined : String(resolutionNote).trim().slice(0, 2000);
  if (st === 'CLOSED' && !note) return bad(400, 'NOTE_REQUIRED', 'Indiquez comment la demande a été traitée.');
  const rows = (await db.execute(sql`UPDATE "SupportRequest" SET status = COALESCE(${st || null}, status), "resolutionNote" = COALESCE(${note ?? null}, "resolutionNote"),
    "assignedTo" = CASE WHEN ${assignToMe === true} THEN ${actor} ELSE "assignedTo" END, "closedAt" = CASE WHEN ${st === 'CLOSED'} THEN NOW() ELSE "closedAt" END, "updatedAt" = NOW()
    WHERE id = ${String(id || '')} RETURNING id, status`)).rows;
  if (!rows.length) return bad(404, 'not_found', 'Demande introuvable.');
  await db.insert(AuditLog).values({ action: 'SUPPORT_REQUEST_UPDATED', actor, actor_id: actor, entity: 'SupportRequest', entity_id: rows[0].id, details: { status: rows[0].status, assigned: assignToMe === true } });
  return { ok: true, request: rows[0] };
}
