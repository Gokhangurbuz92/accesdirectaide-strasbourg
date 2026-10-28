// @ts-nocheck
/**
 * PKG-6 / D22 — one human-oversight view of AI outputs, and the human decision on an AI repair suggestion.
 *  - list(): FALC drafts awaiting review (AiOutputReview PENDING) + review-queue items carrying an AI suggestion that no person has decided
 *    (details.ai_suggestion | ai_fix, status open/OPEN, or 'resolved_by_ai' — set by the AI itself before D22, never seen by a person). The suggestion is shown as untrusted text; nothing is applied to a record.
 *  - decide(): a named administrator with MFA keeps (status 'resolved') or dismisses (status 'dismissed') the suggestion; the item records who, when, the note
 *    and that the decision was HUMAN; an AuditLog row REVIEW_QUEUE_DECISION is written. Keeping a suggestion never edits the record: the person applies any
 *    change through the normal, versioned editing flow.
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';

const bad = (status, code, message) => ({ ok: false, status, code, message });
const AI_PENDING = sql`(details ? 'ai_suggestion' OR details ? 'ai_fix') AND lower(status) IN ('open', 'resolved_by_ai') AND COALESCE(details->>'ai_suggestion_status', 'PENDING_HUMAN_REVIEW') = 'PENDING_HUMAN_REVIEW'`;

export async function list(db = defaultDb) {
  const [falc] = (await db.execute(sql`SELECT count(*)::int AS n FROM "AiOutputReview" WHERE status = 'PENDING'`)).rows;
  const items = (await db.execute(sql`SELECT id, "entityType", "entityId", title, reason, severity, status, details->'ai_suggestion' AS suggestion, details->'ai_fix' AS fix,
      details->>'ai_suggested_at' AS "suggestedAt", "createdAt" FROM "ReviewQueueItem" WHERE ${AI_PENDING} ORDER BY "createdAt" LIMIT 200`)).rows;
  return { ok: true, falcPending: falc.n, aiSuggestions: items.map((r) => ({ id: r.id, entityType: r.entityType, entityId: r.entityId, title: r.title, reason: r.reason, severity: r.severity,
    suggestion: r.suggestion ?? r.fix ?? null, suggestedAt: r.suggestedAt, createdAt: r.createdAt })) };
}

export async function decide(id, decision, note, reviewer, db = defaultDb, seenVersion = undefined) {
  if (!['keep', 'dismiss'].includes(decision)) return bad(400, 'INVALID_DECISION', 'Décision attendue : garder ou écarter.');
  const text = String(note || '').trim();
  if (text.length < 10) return bad(400, 'NOTE_REQUIRED', 'Expliquez votre décision (au moins 10 caractères).');
  const status = decision === 'keep' ? 'resolved' : 'dismissed';
  const verdict = decision === 'keep' ? 'KEPT_BY_HUMAN' : 'DISMISSED_BY_HUMAN';
  return db.transaction(async (tx) => {
    const [row] = (await tx.execute(sql`SELECT id, status, details->>'ai_suggested_at' AS v FROM "ReviewQueueItem" WHERE id = ${String(id || '')} AND ${AI_PENDING} FOR UPDATE`)).rows;
    if (!row) return bad(404, 'not_found', 'Suggestion introuvable ou déjà décidée.');
    if ((row.v ?? null) !== (seenVersion ?? null)) return bad(409, 'VERSION_CHANGED', 'La suggestion a changé depuis votre lecture : rechargez la page et relisez-la.');
    await tx.execute(sql`UPDATE "ReviewQueueItem" SET status = ${status}, "updatedAt" = NOW(),
      details = COALESCE(details, '{}'::jsonb) || jsonb_build_object('ai_suggestion_status', ${verdict}::text, 'reviewed_by', ${reviewer}::text, 'reviewed_at', NOW()::text, 'review_note', ${text.slice(0, 500)}::text)
      WHERE id = ${row.id}`);
    await tx.insert(AuditLog).values({ action: 'REVIEW_QUEUE_DECISION', actor: reviewer, actor_id: reviewer, entity: 'ReviewQueueItem', entity_id: row.id,
      details: { itemId: row.id, from: row.status, to: status, withAiSuggestion: true, decision: verdict, mfa: true, authType: 'admin_jwt' } });
    return { ok: true, id: row.id, status, decision: verdict, recordChanged: false };
  });
}
