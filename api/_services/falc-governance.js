// @ts-nocheck
/**
 * PKG-6 / D19 D22 P18 — FALC (facile à lire et à comprendre) governance.
 *   - draft(entityType, id, field): a FALC draft of the record's public text, made by the LOCAL model only (Ollama on 127.0.0.1, no cloud fallback) or, when the local
 *     model is unavailable, by the deterministic summarizer. The draft goes to the human review queue (AiOutputReview, PENDING); it is NEVER written to the public record.
 *   - approve(reviewId, { text, note }, reviewer): a named MFA administrator approves (possibly after editing): the public field is written with falc_origin
 *     (HUMAN when edited, else the draft's origin), falc_reviewed_by and falc_reviewed_at; the prior version is snapshotted (A07); audited.
 *   - reject(reviewId, note, reviewer); markReviewed(entityType, id, reviewer, note, fields): a human confirms existing (imported) FALC texts as reviewed.
 *   - PKG-11 / ADM-11: the review is recorded PER FIELD (falc_field_reviews: { field: { at, by, sha256 } }) — the record-level stamp used to make every FALC
 *     field of a record look reviewed when only one had been read; a field counts as reviewed only while its text keeps the reviewed sha256
 *     (api/lib/publicVisibility.js falcFieldReview).
 * Only public content is processed: no personal data enters the prompt or the queue.
 */
import crypto from 'node:crypto';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';
import { generateCitizenLocalStructuredContent } from '../lib/ai-foundation.js';
import { summarizeFALC } from '../lib/falc-summarizer.js';
import { recordLocalAiEvent } from '../lib/local-ai-metrics.js';
import { snapshotRow, VERSIONED } from './content-versions.js';

const SOURCE = { // public text the FALC version simplifies (real columns of each table)
  aide: { summary_falc: ['cest_quoi', 'description', 'ce_que_ca_aide'], conditions_falc: ['pour_qui'], montant_falc: ['ce_que_ca_aide'] },
  demarche: { summary_falc: ['description_courte', 'contenu_detaille', 'pour_qui'] },
  structure: { summary_falc: ['description_courte'] },
};
const bad = (status, code, message) => ({ ok: false, status, code, message });
const FALC_TABLES = { aide: VERSIONED.aide, demarche: VERSIONED.demarche, structure: VERSIONED.structure };   // the tables that carry the FALC review columns
const tableOf = (t) => FALC_TABLES[String(t || '').toLowerCase()];
/** ADM-11: the FALC fields of each kind (a review is recorded for one of these, never for the record as a whole). */
export const FALC_FIELDS = { aide: ['summary_falc', 'conditions_falc', 'montant_falc'], demarche: ['summary_falc'], structure: ['summary_falc'] };
const sha256 = (v) => crypto.createHash('sha256').update(String(v ?? ''), 'utf8').digest('hex');
/** SQL: falc_field_reviews with { at, by, sha256 } recorded for `field` (merged into the existing object). */
const fieldReviewSql = (field, reviewer, text) => sql`COALESCE(falc_field_reviews, '{}'::jsonb) || jsonb_build_object(${field}::text, jsonb_build_object('at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'by', ${reviewer}::text, 'sha256', ${sha256(text)}::text))`;
export const FALC_RULES = 'Phrases courtes (une idée par phrase), mots courants, voix active, vous, pas de sigle sans explication, pas de chiffre inventé : garder exactement les montants, dates et conditions du texte source.';

async function readRecord(db, type, id) {
  const t = tableOf(type); if (!t) return null;
  const [r] = (await db.execute(sql`SELECT to_jsonb(x) AS j FROM ${sql.raw(`"${t}"`)} x WHERE id = ${String(id)} LIMIT 1`)).rows;
  return r?.j || null;
}

export async function draft(entityType, entityId, field = 'summary_falc', actor, { db = defaultDb, generate = generateCitizenLocalStructuredContent } = {}) {
  const type = String(entityType || '').toLowerCase(); const cols = SOURCE[type]?.[field];
  if (!cols) return bad(400, 'UNSUPPORTED_FIELD', 'Champ FALC non pris en charge pour ce type.');
  const rec = await readRecord(db, type, entityId); if (!rec) return bad(404, 'not_found', 'Fiche introuvable.');
  const source = cols.map((c) => rec[c]).filter((v) => typeof v === 'string' && v.trim()).join('\n').trim();
  if (source.length < 20) return bad(409, 'NO_SOURCE_TEXT', 'La fiche n’a pas de texte source à simplifier.');
  let text = null; let origin = 'DETERMINISTIC'; let model = null;
  const startedAt = Date.now();
  const out = await generate({
    systemInstruction: `Tu réécris un texte administratif en FALC (facile à lire et à comprendre) pour le public. ${FALC_RULES} Réponds uniquement en JSON {"falc": "..."}.`,
    prompt: `Texte source (${rec.titre || rec.nom || ''}) :\n${source.slice(0, 4000)}`,
    zodSchema: z.object({ falc: z.string().min(20).max(2000) }),
  }).catch(() => null);
  // The AI foundation returns the parsed JSON in `content` (wrapOutput); `data` was never set, so every local draft fell back to the summarizer.
  const falc = out && !out.safeErrorState ? out.content?.falc : null;
  if (typeof falc === 'string' && falc.trim().length >= 20) { text = falc.trim(); origin = 'AI_LOCAL'; model = out.model || 'qwen3:8b'; }
  recordLocalAiEvent({ feature: 'falc', outcome: text ? 'drafted' : 'fallback', reason: text ? null : String(out?.safeErrorState || (out ? 'invalid_output' : 'local_failure')).toLowerCase(), model: out?.model, latencyMs: Date.now() - startedAt, usage: out?.usage });
  if (!text) { text = summarizeFALC(source); origin = 'DETERMINISTIC'; }
  const id = crypto.randomUUID();
  await db.execute(sql`INSERT INTO "AiOutputReview" (id, kind, "entityType", "entityId", field, origin, model, "sourceTextHash", "outputText", status, "createdBy", "createdAt")
    VALUES (${id}, 'FALC', ${type}, ${String(entityId)}, ${field}, ${origin}, ${model}, ${crypto.createHash('sha256').update(source).digest('hex')}, ${text}, 'PENDING', ${actor}, NOW())`);
  await db.insert(AuditLog).values({ action: 'FALC_DRAFT_CREATED', actor, actor_id: actor, entity: tableOf(type), entity_id: String(entityId), details: { field, origin, model } });
  return { ok: true, id, origin, model, text, published: false };
}

export async function listPending(db = defaultDb) {
  const rows = (await db.execute(sql`SELECT id, "entityType", "entityId", field, origin, model, "outputText", "createdAt" FROM "AiOutputReview" WHERE status = 'PENDING' ORDER BY "createdAt" LIMIT 200`)).rows;
  const out = [];
  for (const r of rows) {
    const rec = await readRecord(db, r.entityType, r.entityId);
    out.push({ ...r, title: rec?.titre || rec?.nom || null, current: rec?.[r.field] || null, source: (SOURCE[r.entityType]?.[r.field] || []).map((c) => rec?.[c]).filter(Boolean).join('\n') });
  }
  return { ok: true, drafts: out };
}

export async function approve(reviewId, { text, note }, reviewer, db = defaultDb) {
  return db.transaction(async (tx) => {
    const [r] = (await tx.execute(sql`SELECT * FROM "AiOutputReview" WHERE id = ${String(reviewId || '')} AND status = 'PENDING' FOR UPDATE`)).rows;
    if (!r) return bad(404, 'not_found', 'Brouillon introuvable ou déjà traité.');
    // PKG-6 / D22: the approval is bound to the source text the draft was made from; a source changed since then does not inherit it
    const rec = await readRecord(tx, r.entityType, r.entityId);
    const nowSource = (SOURCE[r.entityType]?.[r.field] || []).map((c) => rec?.[c]).filter((v) => typeof v === 'string' && v.trim()).join('\n').trim();
    if (crypto.createHash('sha256').update(nowSource).digest('hex') !== r.sourceTextHash) return bad(409, 'SOURCE_CHANGED', 'Le texte source de la fiche a changé depuis ce brouillon : refusez-le et demandez un nouveau brouillon.');
    const final = String(text ?? r.outputText).trim();
    if (final.length < 20 || final.length > 2000) return bad(400, 'INVALID_TEXT', 'Texte FALC invalide (20 à 2000 caractères).');
    const origin = final === String(r.outputText).trim() ? r.origin : 'HUMAN';
    const t = tableOf(r.entityType);
    await snapshotRow(tx, r.entityType, r.entityId, `before FALC approval ${r.id}`, reviewer);
    const done = (await tx.execute(sql`UPDATE ${sql.raw(`"${t}"`)} SET ${sql.raw(`"${r.field}"`)} = ${final}, falc_origin = ${origin}, falc_reviewed_by = ${reviewer}, falc_reviewed_at = NOW(),
      falc_field_reviews = ${fieldReviewSql(r.field, reviewer, final)} WHERE id = ${r.entityId} RETURNING id`)).rows;   // ADM-11: this field, with the text approved
    if (!done.length) return bad(404, 'ENTITY_NOT_FOUND', 'La fiche n’existe plus.');
    await tx.execute(sql`UPDATE "AiOutputReview" SET status = 'APPROVED', "reviewedBy" = ${reviewer}, "reviewedAt" = NOW(), "reviewNote" = ${String(note || '').slice(0, 1000) || null} WHERE id = ${r.id}`);
    await tx.insert(AuditLog).values({ action: 'FALC_APPROVED', actor: reviewer, actor_id: reviewer, entity: t, entity_id: r.entityId, details: { field: r.field, origin, edited: origin === 'HUMAN', reviewId: r.id } });
    return { ok: true, origin };
  });
}

export async function reject(reviewId, note, reviewer, db = defaultDb) {
  if (String(note || '').trim().length < 5) return bad(400, 'NOTE_REQUIRED', 'Indiquez pourquoi (au moins 5 caractères).');
  const rows = (await db.execute(sql`UPDATE "AiOutputReview" SET status = 'REJECTED', "reviewedBy" = ${reviewer}, "reviewedAt" = NOW(), "reviewNote" = ${String(note).slice(0, 1000)} WHERE id = ${String(reviewId || '')} AND status = 'PENDING' RETURNING id, "entityType", "entityId"`)).rows;
  if (!rows.length) return bad(404, 'not_found', 'Brouillon introuvable ou déjà traité.');
  await db.insert(AuditLog).values({ action: 'FALC_REJECTED', actor: reviewer, actor_id: reviewer, entity: tableOf(rows[0].entityType), entity_id: rows[0].entityId, details: { reviewId: rows[0].id } });
  return { ok: true };
}

/**
 * A human confirms EXISTING FALC texts (e.g. imported with the launch data) after reading them. ADM-11: only the fields named (default: the summary) and
 * only those that have a text are recorded as reviewed, each with the sha256 of the text read.
 */
/**
 * Owner LAB audit — the FALC texts of one record as a reviewer reads them: each field's text, its sha-256 (what a « relu » is bound to), the source text it simplifies
 * and its current per-field review (still valid only while the text keeps the reviewed sha-256).
 */
export async function recordFalc(entityType, entityId, db = defaultDb) {
  const type = String(entityType || '').toLowerCase(); if (!tableOf(type)) return bad(400, 'UNKNOWN_ENTITY_TYPE', 'Type inconnu.');
  const rec = await readRecord(db, type, entityId); if (!rec) return bad(404, 'not_found', 'Fiche introuvable.');
  const reviews = rec.falc_field_reviews && typeof rec.falc_field_reviews === 'object' ? rec.falc_field_reviews : {};
  return { ok: true, entityType: type, entityId: rec.id, title: rec.titre || rec.nom || null, fields: FALC_FIELDS[type].map((field) => {
    const text = typeof rec[field] === 'string' ? rec[field] : ''; const h = text.trim() ? sha256(text) : null; const r = reviews[field] || null;
    return { field, text, sha256: h, source: (SOURCE[type]?.[field] || []).map((c) => rec[c]).filter((v) => typeof v === 'string' && v.trim()).join('\n'),
      review: r ? { by: r.by, at: r.at, current: Boolean(h) && r.sha256 === h } : null };
  }) };
}

/** `seen` (owner LAB audit): { field: sha-256 of the text the reviewer read } — a text changed since it was read is refused (409 TEXT_CHANGED), never marked. */
export async function markReviewed(entityType, entityId, reviewer, note, db = defaultDb, fields = ['summary_falc'], seen = null) {
  const type = String(entityType || '').toLowerCase(); const t = tableOf(type); if (!t) return bad(400, 'UNKNOWN_ENTITY_TYPE', 'Type inconnu.');
  if (String(note || '').trim().length < 10) return bad(400, 'NOTE_REQUIRED', 'Indiquez ce qui a été relu (au moins 10 caractères).');
  const asked = [...new Set((Array.isArray(fields) && fields.length ? fields : ['summary_falc']).map(String))];
  if (asked.some((f) => !FALC_FIELDS[type].includes(f))) return bad(400, 'UNSUPPORTED_FIELD', 'Champ FALC non pris en charge pour ce type.');
  return db.transaction(async (tx) => {
    const rec = await readRecord(tx, type, entityId); if (!rec) return bad(404, 'not_found', 'Fiche introuvable ou sans texte FALC.');
    const withText = asked.filter((f) => typeof rec[f] === 'string' && rec[f].trim());
    if (!withText.length) return bad(404, 'not_found', 'Fiche introuvable ou sans texte FALC.');
    if (seen && withText.some((f) => seen[f] !== sha256(rec[f]))) return bad(409, 'TEXT_CHANGED', 'Un texte a changé depuis votre lecture : rechargez la fiche et relisez-le.');
    for (const f of withText) await tx.execute(sql`UPDATE ${sql.raw(`"${t}"`)} SET falc_field_reviews = ${fieldReviewSql(f, reviewer, rec[f])} WHERE id = ${rec.id}`);
    await tx.execute(sql`UPDATE ${sql.raw(`"${t}"`)} SET falc_reviewed_by = ${reviewer}, falc_reviewed_at = NOW(), falc_origin = COALESCE(falc_origin, 'IMPORTED') WHERE id = ${rec.id}`);
    await tx.insert(AuditLog).values({ action: 'FALC_EXISTING_REVIEWED', actor: reviewer, actor_id: reviewer, entity: t, entity_id: rec.id, details: { note: String(note).slice(0, 500), fields: withText } });
    return { ok: true, fields: withText };
  });
}
