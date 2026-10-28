// @ts-nocheck
/**
 * PKG-11 / C21 — the citizen's erasure request (DELETE /api/auth/delete-account → DSRRequest DELETE, IN_REVIEW) had no way forward: nothing could approve it, so the
 * account was never erased. TWO PEOPLE, as for access reviews: a first MFA administrator PROPOSES (APPROVE, or REJECT with the written reason — e.g. doubt on who
 * asked); a SECOND, different MFA administrator CONFIRMS — APPROVE then runs the existing deletion engine at once (an active legal hold still blocks it and the
 * request is marked BLOCKED) — or sends it back. The system never decides; the review screen shows counts and holds, never dossier content.
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';
import { createPrivacyRightsService } from './privacy.js';
import { READ_REQUIRED, readSince } from './review-reads.js';
import { dsrDeadline } from './dsr-deadline.js';

const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
/**
 * PKG-11 audit: the deletion runs in ONE database transaction, so an error other than a legal hold usually means NOTHING was erased — yet the engine marks the
 * request PARTIALLY_COMPLETED, which leaves the queue and cannot be retried. When the subject's account is still there, the request is parked as BLOCKED
 * (reason EXECUTION_FAILED): it stays in the queue and « Reprendre » runs it again. A real partial (account gone) keeps the engine's status.
 */
async function parkFailedExecution(db, requestId, subjectId) {
  const still = (await db.execute(sql`SELECT 1 AS x FROM "CitizenUser" WHERE id = ${String(subjectId || '')}`)).rows.length > 0;
  if (!still) return false;
  await db.execute(sql`UPDATE "DSRRequest" SET status = 'BLOCKED', "reasonCode" = 'EXECUTION_FAILED' WHERE id = ${requestId} AND status IN ('APPROVED', 'EXECUTING', 'PARTIALLY_COMPLETED')`);
  return true;
}
const audit = (db, action, reviewer, requestId, details = {}) => db.insert(AuditLog).values({ action, entity: 'DSR_REQUEST', entity_id: requestId, actor_id: reviewer, details: { requestId, ...details }, ip_hash: 'ADMIN_MFA' });

export async function listOpenErasures(db = defaultDb) {
  const rows = (await db.execute(sql`SELECT id, status, "reasonCode", "createdAt", "reviewOutcome" AS o FROM "DSRRequest" WHERE "requestType" = 'DELETE' AND status IN ('IN_REVIEW', 'BLOCKED') ORDER BY "createdAt" LIMIT 100`)).rows;
  return { ok: true, requests: rows.map((r) => ({ id: r.id, status: r.status, createdAt: r.createdAt, ...dsrDeadline(r.createdAt),
    stage: r.status === 'BLOCKED' ? (r.reasonCode === 'EXECUTION_FAILED' ? 'EXECUTION_FAILED_RETRYABLE' : 'BLOCKED_BY_LEGAL_HOLD') : r.o?.proposal ? 'AWAITING_SECOND_REVIEWER' : 'AWAITING_PROPOSAL',
    proposed: r.o?.proposal?.decision || null, proposedBy: r.o?.proposal?.proposedBy || null, proposedAt: r.o?.proposal?.proposedAt || null, reason: r.o?.proposal?.reason || null })) };
}

/** What the deletion would touch (counts only) and the active legal holds — MFA reviewer; the reading is audited. */
export async function readErasure(id, reviewer, db = defaultDb) {
  const [r] = (await db.execute(sql`SELECT id, "subjectId", status FROM "DSRRequest" WHERE id = ${String(id || '')} AND "requestType" = 'DELETE'`)).rows;
  if (!r) return bad('not_found', 'Demande introuvable.', 404);
  const one = async (q) => Number((await db.execute(q)).rows[0]?.n || 0);
  const subject = String(r.subjectId);
  const summary = {
    accountExists: (await one(sql`SELECT count(*)::int AS n FROM "CitizenUser" WHERE id = ${subject}`)) === 1,
    dossiers: await one(sql`SELECT count(*)::int AS n FROM "SharedDiagnostic" WHERE "privacySubjectId" = ${subject} OR "ownerCitizenId" = ${subject}`),
    appointments: await one(sql`SELECT count(*)::int AS n FROM "ProAppointment" WHERE "citizenUserId" = ${subject}`),
    activeLegalHolds: await one(sql`SELECT count(*)::int AS n FROM "LegalHold" h WHERE h.status = 'ACTIVE' AND (h."recordId" = ${subject}
      OR h."recordId" IN (SELECT id FROM "SharedDiagnostic" WHERE "privacySubjectId" = ${subject} OR "ownerCitizenId" = ${subject}))`),
  };
  await audit(db, 'DSR_DELETE_REVIEW_READ', reviewer, r.id);
  return { ok: true, request: { id: r.id, status: r.status }, summary };
}

export async function proposeErasure(id, input, reviewer, db = defaultDb) {
  const decision = String(input?.decision || '').toUpperCase();
  const reason = String(input?.reason || '').trim().slice(0, 2000);
  if (!['APPROVE', 'REJECT'].includes(decision)) return bad('invalid_decision', 'Décision invalide.');
  if (decision === 'REJECT' && reason.length < 10) return bad('reason_required', 'Indiquez pourquoi la demande ne peut pas être exécutée (cette raison sera communiquée à la personne).');
  const proposal = { decision, proposedBy: reviewer, proposedAt: new Date().toISOString(), ...(reason ? { reason } : {}) };
  const rows = (await db.execute(sql`UPDATE "DSRRequest" SET "reviewOutcome" = ${JSON.stringify({ proposal })}::jsonb
      WHERE id = ${String(id || '')} AND "requestType" = 'DELETE' AND status = 'IN_REVIEW' AND ("reviewOutcome" IS NULL OR NOT ("reviewOutcome" ? 'proposal')) RETURNING id`)).rows;
  if (!rows.length) return bad('not_found', 'Demande introuvable, déjà traitée ou déjà proposée.', 404);
  await audit(db, 'DSR_DELETE_REVIEW_PROPOSED', reviewer, rows[0].id, { decision });
  return { ok: true, request: { id: rows[0].id, status: 'IN_REVIEW', proposed: decision, awaiting: 'confirmation by a second reviewer' } };
}

/** The second reviewer: confirm (APPROVE runs the deletion now) or send back. The proposer can never confirm their own proposal. */
export async function confirmErasure(id, input, reviewer, db = defaultDb, privacy = createPrivacyRightsService({ db, cryptoLib: crypto })) {
  const action = String(input?.action || '').toLowerCase();
  if (!['confirm', 'send_back'].includes(action)) return bad('invalid_action', 'Action invalide.');
  const note = String(input?.note || '').trim().slice(0, 2000);
  if (note.length < 5) return bad('note_required', 'Indiquez votre appréciation (rôle et motif).');
  const [r] = (await db.execute(sql`SELECT id, status, "subjectId", "reviewOutcome" AS o FROM "DSRRequest" WHERE id = ${String(id || '')} AND "requestType" = 'DELETE' AND status = 'IN_REVIEW'`)).rows;
  const p = r?.o?.proposal;
  if (!p) return bad('not_found', 'Aucune proposition à confirmer.', 404);
  if (p.proposedBy === reviewer) return bad('second_reviewer_required', 'La confirmation doit venir d’une autre personne que celle qui a proposé.', 403);
  if (String(input?.proposedAt || '') !== String(p.proposedAt || '')) return bad('version_changed', 'La proposition a changé depuis votre lecture : rechargez et relisez-la.', 409);
  if (action === 'confirm' && !(await readSince(db, 'DSR_DELETE_REVIEW_READ', r.id, reviewer, p.proposedAt))) return READ_REQUIRED;   // owner LAB audit: confirm what was read
  const now = new Date().toISOString();
  if (action === 'send_back') {
    const done = (await db.execute(sql`UPDATE "DSRRequest" SET "reviewOutcome" = ${JSON.stringify({ sentBack: { by: reviewer, at: now, note, previous: p.decision } })}::jsonb
        WHERE id = ${r.id} AND status = 'IN_REVIEW' AND "reviewOutcome" = ${JSON.stringify(r.o)}::jsonb RETURNING id`)).rows;
    if (!done.length) return bad('conflict', 'La demande a changé entre-temps.', 409);
    await audit(db, 'DSR_DELETE_REVIEW_SENT_BACK', reviewer, r.id);
    return { ok: true, request: { id: r.id, status: 'IN_REVIEW' } };
  }
  const outcome = { decision: p.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedAt: now, proposedBy: p.proposedBy, confirmedBy: reviewer, confirmationNote: note, ...(p.reason ? { reason: p.reason } : {}) };
  const nextStatus = p.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const done = (await db.execute(sql`UPDATE "DSRRequest" SET status = ${nextStatus}, "reviewOutcome" = ${JSON.stringify(outcome)}::jsonb,
      "completedAt" = ${nextStatus === 'REJECTED' ? now : null}::timestamp
      WHERE id = ${r.id} AND status = 'IN_REVIEW' AND "reviewOutcome" = ${JSON.stringify(r.o)}::jsonb RETURNING id`)).rows;
  if (!done.length) return bad('conflict', 'La demande a changé entre-temps.', 409);
  await audit(db, nextStatus === 'APPROVED' ? 'DSR_DELETE_REVIEW_APPROVED' : 'DSR_DELETE_REVIEW_REJECTED', reviewer, r.id);
  if (nextStatus === 'REJECTED') return { ok: true, request: { id: r.id, status: 'REJECTED' } };
  try {
    const summary = await privacy.executeApprovedDeletion(r.id);
    return { ok: true, request: { id: r.id, status: 'COMPLETED' }, summary: Object.fromEntries(Object.entries(summary || {}).filter(([, v]) => typeof v === 'number')) };
  } catch (error) {
    if (error?.code === 'LEGAL_HOLD_ACTIVE') {
      await db.execute(sql`UPDATE "DSRRequest" SET status = 'BLOCKED', "reasonCode" = 'LEGAL_HOLD_ACTIVE' WHERE id = ${r.id} AND status IN ('APPROVED', 'EXECUTING')`);
      return { ok: true, request: { id: r.id, status: 'BLOCKED' }, blockedBy: 'LEGAL_HOLD_ACTIVE' };
    }
    if (await parkFailedExecution(db, r.id, r.subjectId).catch(() => false)) return { ok: false, status: 503, code: 'EXECUTION_FAILED', message: 'L’effacement n’a pas pu être exécuté (rien n’a été effacé) : la demande reste dans la file, reprenez-la.', request: { id: r.id, status: 'BLOCKED' } };
    throw error;
  }
}

/** After a legal hold is released, a BLOCKED request can be executed again (one MFA administrator: the decision was already taken by two people). */
export async function retryBlockedErasure(id, reviewer, db = defaultDb, privacy = createPrivacyRightsService({ db, cryptoLib: crypto })) {
  const rows = (await db.execute(sql`UPDATE "DSRRequest" SET status = 'APPROVED', "reasonCode" = NULL WHERE id = ${String(id || '')} AND "requestType" = 'DELETE' AND status = 'BLOCKED' RETURNING id`)).rows;
  if (!rows.length) return bad('not_found', 'Aucune demande bloquée à reprendre.', 404);
  await audit(db, 'DSR_DELETE_RETRIED', reviewer, rows[0].id);
  try {
    const summary = await privacy.executeApprovedDeletion(rows[0].id);
    return { ok: true, request: { id: rows[0].id, status: 'COMPLETED' }, summary: Object.fromEntries(Object.entries(summary || {}).filter(([, v]) => typeof v === 'number')) };
  } catch (error) {
    if (error?.code === 'LEGAL_HOLD_ACTIVE') {
      await db.execute(sql`UPDATE "DSRRequest" SET status = 'BLOCKED', "reasonCode" = 'LEGAL_HOLD_ACTIVE' WHERE id = ${rows[0].id} AND status IN ('APPROVED', 'EXECUTING')`);
      return { ok: true, request: { id: rows[0].id, status: 'BLOCKED' }, blockedBy: 'LEGAL_HOLD_ACTIVE' };
    }
    const [subj] = (await db.execute(sql`SELECT "subjectId" FROM "DSRRequest" WHERE id = ${rows[0].id}`)).rows;
    if (await parkFailedExecution(db, rows[0].id, subj?.subjectId).catch(() => false)) return { ok: false, status: 503, code: 'EXECUTION_FAILED', message: 'L’effacement n’a pas pu être exécuté (rien n’a été effacé) : la demande reste dans la file, reprenez-la.', request: { id: rows[0].id, status: 'BLOCKED' } };
    throw error;
  }
}

