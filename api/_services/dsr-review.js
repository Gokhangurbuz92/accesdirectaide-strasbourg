// @ts-nocheck
/**
 * PKG-4 — human review of the part of an access request (DSR) that concerns organization-held INTERNAL case notes.
 * The system never decides: a named ADA administrator with an MFA session reads the notes (the reading is audited), weighs third-party information and applicable
 * restrictions, and records RELEASE (with the extract that will be given to the person — possibly redacted) or WITHHOLD (with the stated reason). Until then the
 * access request stays PARTIALLY_COMPLETED. The legal assessment itself is the reviewer's / DPO's; nothing here infers it.
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';
import { openText, sealText } from '../lib/data-keys.js';
import { READ_REQUIRED, readSince } from './review-reads.js';
import { dsrDeadline } from './dsr-deadline.js';

const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
// owner LAB audit: never swallowed — the notes are returned only once their reading is journalised, and a decision is journalised in its own transaction
const audit = (db, action, reviewer, requestId) => db.insert(AuditLog).values({ action, entity: 'DSR_REQUEST', entity_id: requestId, actor_id: reviewer, details: { requestId }, ip_hash: 'ADMIN_MFA' });

export async function listOpen(db = defaultDb) {
  const rows = (await db.execute(sql`SELECT id, "subjectId", status, "createdAt", "reviewOutcome" AS o FROM "DSRRequest" WHERE "requestType" = 'ACCESS_REVIEW' AND status IN ('IN_REVIEW') ORDER BY "createdAt" LIMIT 200`)).rows;
  return { ok: true, requests: rows.map((r) => ({ id: r.id, status: r.status, createdAt: r.createdAt, ...dsrDeadline(r.createdAt), stage: r.o?.proposal ? 'AWAITING_SECOND_REVIEWER' : 'AWAITING_PROPOSAL', proposed: r.o?.proposal?.decision || null,
    proposedBy: r.o?.proposal?.proposedBy || null, proposedAt: r.o?.proposal?.proposedAt || null })) };   // PKG-6 / D22: the version the second reviewer confirms (no content here: the basis and the extract are in the audited MFA reading)
}

/** The notes under review (decrypted) — MFA reviewer only; the reading is audited. */
export async function readForReview(id, reviewer, db = defaultDb) {
  const [r] = (await db.execute(sql`SELECT id, "subjectId", status, "reviewOutcome" AS o FROM "DSRRequest" WHERE id = ${String(id || '')} AND "requestType" = 'ACCESS_REVIEW'`)).rows;
  if (!r) return bad('not_found', 'Demande introuvable.', 404);
  const notes = (await db.execute(sql`SELECT n.id, n."caseId", n."bodyEncrypted", n."createdAt", s.nom AS organization, upper(coalesce(u.role, '')) AS "authorRole"
    FROM "ProCaseNote" n JOIN "ProCase" c ON c.id = n."caseId" JOIN "SharedDiagnostic" d ON d.id = c."sharedDiagnosticId" JOIN "Structure" s ON s.id = c."structureId"
    LEFT JOIN "ProUser" u ON u.id = n."authorProUserId" WHERE d."ownerCitizenId" = ${r.subjectId} AND n.visibility = 'INTERNAL' ORDER BY n."createdAt"`)).rows;
  await audit(db, 'DSR_ACCESS_REVIEW_READ', reviewer, r.id);
  let proposalExtract = null;   // the proposed extract (decrypted) for the second reviewer — part of the audited reading
  if (r.o?.proposal?.extractEncrypted) { try { proposalExtract = openText(r.o.proposal.extractEncrypted, { purpose: 'case-note', context: `dsr:${String(r.id)}` }) || ''; } catch { proposalExtract = '[illisible]'; } }
  const proposal = r.o?.proposal ? { decision: r.o.proposal.decision, proposedBy: r.o.proposal.proposedBy, proposedAt: r.o.proposal.proposedAt, basis: r.o.proposal.basis } : null;
  return { ok: true, request: { id: r.id, status: r.status }, proposal, proposalExtract, notes: notes.map((n) => {
    let body = '';
    try { body = openText(n.bodyEncrypted, { purpose: 'case-note', context: `case:${n.caseId}` }) || ''; } catch { body = '[illisible]'; }
    return { id: n.id, organization: n.organization, authorRole: n.authorRole, createdAt: n.createdAt, body };
  }) };
}

/**
 * PKG-5: TWO PEOPLE. A first MFA reviewer PROPOSES RELEASE (with the extract) or WITHHOLD (with the reason) and the written basis; the proposal changes nothing for
 * the person. A SECOND, different MFA reviewer (the privacy / legal reviewer) CONFIRMS it — only then is the decision final — or SENDS IT BACK. MFA proves who acts;
 * it is not a legal authority: the basis text is the reviewers' own and the system never infers it.
 */
export async function propose(id, input, reviewer, db = defaultDb) {
  const decision = String(input?.decision || '').toUpperCase();
  const basis = String(input?.basis || '').trim().slice(0, 2000);
  if (!['RELEASE', 'WITHHOLD'].includes(decision)) return bad('invalid_decision', 'Décision invalide.');
  if (basis.length < 10) return bad('basis_required', 'Indiquez le fondement de la décision (examen des tiers, restrictions applicables).');
  const extract = String(input?.extract || '').trim().slice(0, 20000);
  if (decision === 'RELEASE' && !extract) return bad('extract_required', 'Indiquez l’extrait (éventuellement occulté) à transmettre à la personne.');
  const proposal = { decision: decision === 'RELEASE' ? 'RELEASED' : 'WITHHELD', proposedBy: reviewer, proposedAt: new Date().toISOString(), basis,
    ...(decision === 'RELEASE' ? { extractEncrypted: sealText(extract, { purpose: 'case-note', context: `dsr:${String(id)}` }) } : {}) };
  return db.transaction(async (tx) => {
    const rows = (await tx.execute(sql`UPDATE "DSRRequest" SET "reviewOutcome" = ${JSON.stringify({ proposal })}::jsonb
        WHERE id = ${String(id || '')} AND "requestType" = 'ACCESS_REVIEW' AND status = 'IN_REVIEW' AND ("reviewOutcome" IS NULL OR NOT ("reviewOutcome" ? 'proposal')) RETURNING id`)).rows;
    if (!rows.length) return bad('not_found', 'Demande introuvable, déjà traitée ou déjà proposée (confirmez ou renvoyez d’abord la proposition).', 404);
    await audit(tx, 'DSR_ACCESS_REVIEW_PROPOSED', reviewer, rows[0].id);
    return { ok: true, request: { id: rows[0].id, status: 'IN_REVIEW', proposed: proposal.decision, awaiting: 'confirmation by a second reviewer' } };
  });
}

/** The second reviewer: confirm (final) or send back (the proposal is cleared). The proposer can never confirm their own proposal. */
export async function confirm(id, input, reviewer, db = defaultDb) {
  const action = String(input?.action || '').toLowerCase();
  if (!['confirm', 'send_back'].includes(action)) return bad('invalid_action', 'Action invalide.');
  const note = String(input?.note || '').trim().slice(0, 2000);
  if (note.length < 5) return bad('note_required', 'Indiquez votre appréciation (rôle et motif).');
  const [r] = (await db.execute(sql`SELECT id, "reviewOutcome" AS o FROM "DSRRequest" WHERE id = ${String(id || '')} AND "requestType" = 'ACCESS_REVIEW' AND status = 'IN_REVIEW'`)).rows;
  const p = r?.o?.proposal;
  if (!p) return bad('not_found', 'Aucune proposition à confirmer.', 404);
  if (p.proposedBy === reviewer) return bad('second_reviewer_required', 'La confirmation doit venir d’une autre personne que celle qui a proposé.', 403);
  if (String(input?.proposedAt || '') !== String(p.proposedAt || '')) return bad('version_changed', 'La proposition a changé depuis votre lecture : rechargez et relisez-la.', 409);   // PKG-6 / D22: bound to the version read
  if (action === 'confirm' && !(await readSince(db, 'DSR_ACCESS_REVIEW_READ', r.id, reviewer, p.proposedAt))) return READ_REQUIRED;
  const now = new Date();
  if (action === 'send_back') {
    return db.transaction(async (tx) => {
      const done = (await tx.execute(sql`UPDATE "DSRRequest" SET "reviewOutcome" = ${JSON.stringify({ sentBack: { by: reviewer, at: now.toISOString(), note, previous: p.decision } })}::jsonb
          WHERE id = ${r.id} AND status = 'IN_REVIEW' AND "reviewOutcome" = ${JSON.stringify(r.o)}::jsonb RETURNING id`)).rows;
      if (!done.length) return bad('conflict', 'La demande a changé entre-temps.', 409);
      await audit(tx, 'DSR_ACCESS_REVIEW_SENT_BACK', reviewer, r.id);
      return { ok: true, request: { id: r.id, status: 'IN_REVIEW' } };
    });
  }
  const outcome = { decision: p.decision, decidedAt: now.toISOString(), basis: p.basis, proposedBy: p.proposedBy, confirmedBy: reviewer, confirmationNote: note,
    ...(p.decision === 'RELEASED' ? { releasedAt: now.toISOString(), extractEncrypted: p.extractEncrypted } : {}) };
  const status = p.decision === 'RELEASED' ? 'COMPLETED' : 'REJECTED_WITH_REASON';
  return db.transaction(async (tx) => {
    const done = (await tx.execute(sql`UPDATE "DSRRequest" SET status = ${status}, "completedAt" = ${now}, "reasonCode" = ${p.decision === 'RELEASED' ? 'RELEASED_AFTER_REVIEW' : 'WITHHELD_AFTER_REVIEW'},
        "reviewOutcome" = ${JSON.stringify(outcome)}::jsonb WHERE id = ${r.id} AND status = 'IN_REVIEW' AND "reviewOutcome" = ${JSON.stringify(r.o)}::jsonb RETURNING id`)).rows;
    if (!done.length) return bad('conflict', 'La demande a changé entre-temps.', 409);
    await audit(tx, p.decision === 'RELEASED' ? 'DSR_ACCESS_REVIEW_RELEASED' : 'DSR_ACCESS_REVIEW_WITHHELD', reviewer, r.id);
    return { ok: true, request: { id: r.id, status, decision: p.decision } };
  });
}

/** For the person's export: the released extracts of their reviews. */
export function releasedExtract(requestId, outcome) {
  if (!outcome || outcome.decision !== 'RELEASED' || !outcome.extractEncrypted) return null;
  try { return openText(outcome.extractEncrypted, { purpose: 'case-note', context: `dsr:${requestId}` }); } catch { return null; }
}
