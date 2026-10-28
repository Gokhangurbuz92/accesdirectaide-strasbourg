// @ts-nocheck
/**
 * PKG-11 / E08 — closure of an organization's ADA Pro space and erasure of the organization's own data. Before: the organization export ended with « Suppression de
 * la structure : procédure humaine auprès d’ADA » and nothing existed to carry it out; a physical delete of the organization would have cascaded into the OTHER
 * organizations' referrals and the members' audit trail (Referral / ProAuditLog foreign keys).
 *
 * The request (the organization's administrator, or an ADA administrator — e.g. the end of the agreement) is a DSRRequest of its own type (ORGANIZATION_CLOSURE,
 * never mixed with a person's erasure). TWO PEOPLE decide, as for a person's erasure: a first MFA administrator PROPOSES (APPROVE, or REJECT with the reason); a
 * SECOND, different MFA administrator CONFIRMS (bound to the proposal they read) or sends it back. An active legal hold on the organization blocks the execution.
 *
 * Execution (one transaction; rows are never physically removed when someone else holds them):
 *   - the people keep control of their dossiers: every access and pending invitation the organization holds is revoked, its AI drafts are forgotten;
 *   - organization-held data is erased: internal case notes, in-app notifications, pending invitations of new members, the members' public profiles;
 *     the members' accounts are disabled and anonymized (e-mail, password, MFA secret) and every session is revoked — the rows stay because the audit
 *     trail and the other side's records point to them;
 *   - open cases are closed; referrals it received end and those it sent that nobody accepted yet are cancelled (an accepted one stays: the other organization keeps
 *     supporting the person); the other organization and the person keep their history; future appointments are cancelled
 *     and the person is told (the notice ledger records the outcome), online booking is unpublished and the services deactivated, pending profile proposals withdrawn;
 *   - kept on purpose: citizen-visible notes and case outcomes (part of the person's follow-up, erasable through the person's own request), the messages exchanged
 *     with people, the consent ledger, the audit trails, and the public directory record (public-source information; online booking is switched off).
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';
import { snapshotRow } from './content-versions.js';
import { formatParis, noticeCitizen } from './appointment-notices.js';
import { READ_REQUIRED, readSince } from './review-reads.js';

export const REQUEST_TYPE = 'ORGANIZATION_CLOSURE';
const OPEN = ['IN_REVIEW', 'BLOCKED'];
const LIVE_REFERRALS = ['DRAFT', 'PENDING_CITIZEN', 'SENT', 'ACKNOWLEDGED', 'NEEDS_INFO', 'ACCEPTED', 'IN_PROGRESS'];
const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
const audit = (db, action, actor, requestId, details = {}) => db.insert(AuditLog).values({ action, entity: 'DSR_REQUEST', entity_id: requestId, actor_id: actor, details: { requestId, ...details }, ip_hash: 'ADMIN_MFA' });
const list = (arr) => sql.join(arr.map((x) => sql`${x}`), sql`, `);

async function openRequestFor(db, structureId) {
  return (await db.execute(sql`SELECT id, status, "createdAt", "reviewOutcome" AS o FROM "DSRRequest" WHERE "requestType" = ${REQUEST_TYPE} AND "subjectId" = ${structureId}
    AND status IN (${list(OPEN)}) ORDER BY "createdAt" DESC LIMIT 1`)).rows[0] || null;
}

/** The organization's administrator asks (reason required); or an ADA administrator opens it (`by: { admin }`). Idempotent: one open request per organization. */
export async function requestClosure(structureId, input, by, db = defaultDb) {
  const reason = String(input?.reason || '').trim().slice(0, 2000);
  if (reason.length < 10) return bad('reason_required', 'Indiquez la raison de la fermeture (au moins 10 caractères).');
  const [s] = (await db.execute(sql`SELECT id, nom FROM "Structure" WHERE id = ${String(structureId || '')}`)).rows;
  if (!s) return bad('not_found', 'Structure introuvable.', 404);
  const existing = await openRequestFor(db, s.id);
  if (existing) return { ok: true, status: 200, request: { id: existing.id, status: existing.status, createdAt: existing.createdAt } };
  const id = crypto.randomUUID();
  const origin = by?.admin ? { admin: String(by.admin) } : { proUserId: String(by?.proUserId || '') };
  await db.execute(sql`INSERT INTO "DSRRequest" (id, "subjectType", "subjectId", "requestType", status, "executionMode", "affectedDomains", "reasonCode", "createdAt", "reviewOutcome")
    VALUES (${id}, 'ORGANIZATION', ${s.id}, ${REQUEST_TYPE}, 'IN_REVIEW', 'TWO_PERSON_REVIEW', ${JSON.stringify(['pro_accounts', 'dossier_access', 'cases', 'referrals', 'appointments', 'notifications'])}::jsonb,
      ${by?.admin ? 'ADA_REQUEST' : 'ORGANIZATION_REQUEST'}, NOW(), ${JSON.stringify({ request: { ...origin, at: new Date().toISOString(), reason } })}::jsonb)`);
  await db.insert(AuditLog).values({ action: 'ORGANIZATION_CLOSURE_REQUESTED', entity: 'STRUCTURE', entity_id: s.id, actor_id: by?.admin || by?.proUserId || null, details: { requestId: id, origin: by?.admin ? 'ADA' : 'ORGANIZATION' }, ip_hash: by?.admin ? 'ADMIN_MFA' : 'PRO' });
  return { ok: true, status: 201, request: { id, status: 'IN_REVIEW' } };
}

/** What the organization sees of its own request. */
export async function closureState(structureId, db = defaultDb) {
  const [r] = (await db.execute(sql`SELECT id, status, "createdAt", "completedAt", "reviewOutcome" AS o FROM "DSRRequest" WHERE "requestType" = ${REQUEST_TYPE} AND "subjectId" = ${String(structureId || '')}
    ORDER BY "createdAt" DESC LIMIT 1`)).rows;
  if (!r) return { ok: true, request: null };
  return { ok: true, request: { id: r.id, status: r.status, createdAt: r.createdAt, completedAt: r.completedAt, ...(r.status === 'REJECTED' && r.o?.reason ? { reason: r.o.reason } : {}) } };
}

export async function listOpenClosures(db = defaultDb) {
  const rows = (await db.execute(sql`SELECT r.id, r.status, r."createdAt", r."reviewOutcome" AS o, s.nom, s.id AS sid FROM "DSRRequest" r JOIN "Structure" s ON s.id = r."subjectId"
    WHERE r."requestType" = ${REQUEST_TYPE} AND r.status IN (${list(OPEN)}) ORDER BY r."createdAt" LIMIT 100`)).rows;
  return { ok: true, requests: rows.map((r) => ({ id: r.id, status: r.status, createdAt: r.createdAt, structureId: r.sid, structureNom: r.nom,
    origin: r.o?.request?.admin ? 'ADA' : 'ORGANIZATION', requestReason: r.o?.request?.reason || null,
    stage: r.status === 'BLOCKED' ? 'BLOCKED_BY_LEGAL_HOLD' : r.o?.proposal ? 'AWAITING_SECOND_REVIEWER' : 'AWAITING_PROPOSAL',
    proposed: r.o?.proposal?.decision || null, proposedBy: r.o?.proposal?.proposedBy || null, proposedAt: r.o?.proposal?.proposedAt || null, reason: r.o?.proposal?.reason || null })) };
}

async function counts(db, sid) {
  const one = async (q) => Number((await db.execute(q)).rows[0]?.n || 0);
  return {
    members: await one(sql`SELECT count(*)::int AS n FROM "ProUser" WHERE "structureId" = ${sid} AND email NOT LIKE 'closed-%@closed.invalid'`),
    activeDossierAccesses: await one(sql`SELECT count(*)::int AS n FROM "SharedDossierGrant" WHERE "structureId" = ${sid} AND "revokedAt" IS NULL`),
    openCases: await one(sql`SELECT count(*)::int AS n FROM "ProCase" WHERE "structureId" = ${sid} AND status <> 'CLOSED'`),
    internalNotes: await one(sql`SELECT count(*)::int AS n FROM "ProCaseNote" WHERE "structureId" = ${sid} AND visibility = 'INTERNAL'`),
    liveReferrals: await one(sql`SELECT count(*)::int AS n FROM "Referral" WHERE (("fromStructureId" = ${sid} AND status NOT IN ('ACCEPTED', 'IN_PROGRESS')) OR "toStructureId" = ${sid}) AND status IN (${list(LIVE_REFERRALS)})`),
    futureAppointments: await one(sql`SELECT count(*)::int AS n FROM "ProAppointment" WHERE "structureId" = ${sid} AND status = 'booked' AND "startAt" > NOW()`),
    activeLegalHolds: await one(sql`SELECT count(*)::int AS n FROM "LegalHold" WHERE status = 'ACTIVE' AND "dataCategory" = 'Structure' AND "recordId" = ${sid}`),
  };
}

/** What the closure would touch (counts only, never a person's content) — MFA reviewer; the reading is audited. */
export async function readClosure(id, reviewer, db = defaultDb) {
  const [r] = (await db.execute(sql`SELECT id, "subjectId", status FROM "DSRRequest" WHERE id = ${String(id || '')} AND "requestType" = ${REQUEST_TYPE}`)).rows;
  if (!r) return bad('not_found', 'Demande introuvable.', 404);
  const summary = await counts(db, String(r.subjectId));
  await audit(db, 'ORGANIZATION_CLOSURE_REVIEW_READ', reviewer, r.id);
  return { ok: true, request: { id: r.id, status: r.status, structureId: r.subjectId }, summary };
}

export async function proposeClosure(id, input, reviewer, db = defaultDb) {
  const decision = String(input?.decision || '').toUpperCase();
  const reason = String(input?.reason || '').trim().slice(0, 2000);
  if (!['APPROVE', 'REJECT'].includes(decision)) return bad('invalid_decision', 'Décision invalide.');
  if (decision === 'REJECT' && reason.length < 10) return bad('reason_required', 'Indiquez pourquoi la fermeture ne peut pas être exécutée (cette raison sera communiquée à la structure).');
  const [r] = (await db.execute(sql`SELECT id, "reviewOutcome" AS o FROM "DSRRequest" WHERE id = ${String(id || '')} AND "requestType" = ${REQUEST_TYPE} AND status = 'IN_REVIEW'`)).rows;
  if (!r || r.o?.proposal) return bad('not_found', 'Demande introuvable, déjà traitée ou déjà proposée.', 404);
  const next = { ...(r.o || {}), proposal: { decision, proposedBy: reviewer, proposedAt: new Date().toISOString(), ...(reason ? { reason } : {}) } };
  delete next.sentBack;
  const rows = (await db.execute(sql`UPDATE "DSRRequest" SET "reviewOutcome" = ${JSON.stringify(next)}::jsonb WHERE id = ${r.id} AND status = 'IN_REVIEW'
    AND "reviewOutcome" IS NOT DISTINCT FROM ${r.o == null ? null : JSON.stringify(r.o)}::jsonb RETURNING id`)).rows;
  if (!rows.length) return bad('conflict', 'La demande a changé entre-temps.', 409);
  await audit(db, 'ORGANIZATION_CLOSURE_PROPOSED', reviewer, r.id, { decision });
  return { ok: true, request: { id: r.id, status: 'IN_REVIEW', proposed: decision, awaiting: 'confirmation by a second reviewer' } };
}

/** The organization's own data is erased or closed; nothing the people or the other organizations hold is removed. Returns counts. */
async function execute(tx, sid, requestId, reviewer) {
  const n = async (q) => (await tx.execute(q)).rowCount ?? 0;
  const summary = {};
  await snapshotRow(tx, 'structure', sid, `before organization closure ${requestId}`, reviewer);   // A07: the public record as it was
  summary.invitesRevoked = await n(sql`UPDATE "SharedDossierInvite" SET "revokedAt" = NOW() WHERE "structureId" = ${sid} AND "usedAt" IS NULL AND "revokedAt" IS NULL`);
  const grants = (await tx.execute(sql`UPDATE "SharedDossierGrant" SET "revokedAt" = NOW() WHERE "structureId" = ${sid} AND "revokedAt" IS NULL RETURNING "sharedDiagnosticId" AS d`)).rows;
  summary.dossierAccessesRevoked = grants.length;
  summary.aiDraftsForgotten = await n(sql`DELETE FROM "AiOutputReview" WHERE kind = 'DOSSIER_SYNTHESIS' AND "scopeStructureId" = ${sid}`);
  summary.internalNotesErased = await n(sql`DELETE FROM "ProCaseNote" WHERE "structureId" = ${sid} AND visibility = 'INTERNAL'`);
  const open = (await tx.execute(sql`UPDATE "ProCase" SET status = 'CLOSED', outcome = COALESCE(outcome, 'OTHER'), "closedAt" = NOW() WHERE "structureId" = ${sid} AND status <> 'CLOSED'
    RETURNING id, "structureId"`)).rows;
  for (const c of open) await tx.execute(sql`INSERT INTO "ProCaseEvent" (id, "caseId", "structureId", "actorProUserId", kind, "fromValue", "toValue", "createdAt")
    VALUES (${crypto.randomUUID()}, ${c.id}, ${c.structureId}, NULL, 'CLOSED', 'ORGANIZATION_CLOSED', 'CLOSED', NOW())`);
  summary.casesClosed = open.length;
  // referrals: one SENT by the closing organization and already ACCEPTED by the other one stays (that organization keeps supporting the person); one not yet accepted
  // is cancelled and the access it created is revoked; one RECEIVED by the closing organization ends (the sender sees it)
  const refs = (await tx.execute(sql`SELECT id, status, "fromStructureId" AS f, "grantId" AS g FROM "Referral" WHERE ("fromStructureId" = ${sid} OR "toStructureId" = ${sid})
    AND status IN (${list(LIVE_REFERRALS)}) FOR UPDATE`)).rows;
  let ended = 0;
  for (const r of refs) {
    const sent = r.f === sid;
    if (sent && ['ACCEPTED', 'IN_PROGRESS'].includes(r.status)) continue;
    const to = sent || ['DRAFT', 'PENDING_CITIZEN'].includes(r.status) ? 'CANCELLED' : 'CLOSED';
    await tx.execute(sql`UPDATE "Referral" SET status = ${to}, "closedAt" = NOW(), "updatedAt" = NOW() WHERE id = ${r.id}`);
    await tx.execute(sql`INSERT INTO "ReferralEvent" (id, "referralId", "actorType", "actorId", "fromStatus", "toStatus", "createdAt") VALUES (${crypto.randomUUID()}, ${r.id}, 'SYSTEM', 'ORGANIZATION_CLOSED', ${r.status}, ${to}, NOW())`);
    if (sent && r.g) await tx.execute(sql`UPDATE "SharedDossierGrant" SET "revokedAt" = NOW() WHERE id = ${r.g} AND "grantedVia" = 'referral' AND "revokedAt" IS NULL`);
    ended += 1;
  }
  summary.referralsEnded = ended;
  const appts = (await tx.execute(sql`UPDATE "ProAppointment" SET status = 'cancelled', "cancelledAt" = NOW(), "cancelledBy" = 'ORGANIZATION_CLOSED', "updatedAt" = NOW()
    WHERE "structureId" = ${sid} AND status = 'booked' AND "startAt" > NOW() RETURNING id, "citizenUserId", "startAt"`)).rows;
  summary.appointmentsCancelled = appts.length;
  summary.servicesDeactivated = await n(sql`UPDATE "ProRdvService" SET "isActive" = false, "updatedAt" = NOW() WHERE "structureId" = ${sid} AND "isActive" = true`);
  await tx.execute(sql`UPDATE "StructureRdvSettings" SET "isPublished" = false, "contactEmail" = NULL, "contactPhone" = NULL, "updatedAt" = NOW() WHERE "structureId" = ${sid}`);
  summary.proposalsWithdrawn = await n(sql`UPDATE "StructureProposal" SET status = 'WITHDRAWN' WHERE "structureId" = ${sid} AND status = 'PENDING'`);
  summary.memberInvitationsErased = await n(sql`DELETE FROM "Invitation" WHERE "structureId" = ${sid} AND used_at IS NULL`);
  summary.notificationsErased = await n(sql`DELETE FROM "ProNotification" WHERE "structureId" = ${sid}`);
  await tx.execute(sql`UPDATE "ProProfile" SET "displayName" = NULL, "jobTitle" = NULL, "descriptionPublic" = NULL, "photoUrl" = NULL, "isPubliclyVisible" = false, "updatedAt" = NOW()
    WHERE "proUserId" IN (SELECT id FROM "ProUser" WHERE "structureId" = ${sid})`);
  // the account rows stay (audit trail, the other side's records); what identifies or authenticates a person is erased, and every session ends now
  summary.membersAnonymized = await n(sql`UPDATE "ProUser" SET email = 'closed-' || id || '@closed.invalid', password_hash = ${'!closed:' + crypto.randomBytes(24).toString('hex')},
    status = 'disabled', mfa_enabled = false, mfa_secret = NULL, "notificationEmailEnabled" = false, "notificationPrefs" = '{}'::jsonb, "sessionsValidAfter" = NOW(), "updatedAt" = NOW()
    WHERE "structureId" = ${sid} AND email NOT LIKE 'closed-%@closed.invalid'`);
  await tx.execute(sql`UPDATE "Structure" SET is_pro_enabled = false, "updatedAt" = NOW(), "updatedBy" = ${reviewer} WHERE id = ${sid}`);
  return { summary, appointments: appts };
}

/** The second reviewer: confirm (APPROVE runs the closure now) or send back. The proposer can never confirm their own proposal. */
export async function confirmClosure(id, input, reviewer, db = defaultDb, deps = {}) {
  const action = String(input?.action || '').toLowerCase();
  if (!['confirm', 'send_back'].includes(action)) return bad('invalid_action', 'Action invalide.');
  const note = String(input?.note || '').trim().slice(0, 2000);
  if (note.length < 5) return bad('note_required', 'Indiquez votre appréciation (rôle et motif).');
  const [r] = (await db.execute(sql`SELECT id, status, "subjectId" AS sid, "reviewOutcome" AS o FROM "DSRRequest" WHERE id = ${String(id || '')} AND "requestType" = ${REQUEST_TYPE} AND status = 'IN_REVIEW'`)).rows;
  const p = r?.o?.proposal;
  if (!p) return bad('not_found', 'Aucune proposition à confirmer.', 404);
  if (p.proposedBy === reviewer) return bad('second_reviewer_required', 'La confirmation doit venir d’une autre personne que celle qui a proposé.', 403);
  if (String(input?.proposedAt || '') !== String(p.proposedAt || '')) return bad('version_changed', 'La proposition a changé depuis votre lecture : rechargez et relisez-la.', 409);
  if (action === 'confirm' && !(await readSince(db, 'ORGANIZATION_CLOSURE_REVIEW_READ', r.id, reviewer, p.proposedAt))) return READ_REQUIRED;   // owner LAB audit: confirm what was read
  const now = new Date().toISOString();
  const same = sql`"reviewOutcome" = ${JSON.stringify(r.o)}::jsonb`;
  if (action === 'send_back') {
    const next = { request: r.o.request, sentBack: { by: reviewer, at: now, note, previous: p.decision } };
    const done = (await db.execute(sql`UPDATE "DSRRequest" SET "reviewOutcome" = ${JSON.stringify(next)}::jsonb WHERE id = ${r.id} AND status = 'IN_REVIEW' AND ${same} RETURNING id`)).rows;
    if (!done.length) return bad('conflict', 'La demande a changé entre-temps.', 409);
    await audit(db, 'ORGANIZATION_CLOSURE_SENT_BACK', reviewer, r.id);
    return { ok: true, request: { id: r.id, status: 'IN_REVIEW' } };
  }
  const outcome = { request: r.o.request, decision: p.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedAt: now, proposedBy: p.proposedBy, confirmedBy: reviewer, confirmationNote: note, ...(p.reason ? { reason: p.reason } : {}) };
  if (p.decision === 'REJECT') {
    const done = (await db.execute(sql`UPDATE "DSRRequest" SET status = 'REJECTED', "reviewOutcome" = ${JSON.stringify(outcome)}::jsonb, "completedAt" = NOW() WHERE id = ${r.id} AND status = 'IN_REVIEW' AND ${same} RETURNING id`)).rows;
    if (!done.length) return bad('conflict', 'La demande a changé entre-temps.', 409);
    await audit(db, 'ORGANIZATION_CLOSURE_REJECTED', reviewer, r.id);
    return { ok: true, request: { id: r.id, status: 'REJECTED' } };
  }
  return runApproved(db, r, outcome, same, reviewer, deps);
}

async function runApproved(db, r, outcome, same, reviewer, deps) {
  const sid = String(r.sid);
  const result = await db.transaction(async (tx) => {
    const holds = Number((await tx.execute(sql`SELECT count(*)::int AS n FROM "LegalHold" WHERE status = 'ACTIVE' AND "dataCategory" = 'Structure' AND "recordId" = ${sid}`)).rows[0]?.n || 0);
    if (holds) {
      const done = (await tx.execute(sql`UPDATE "DSRRequest" SET status = 'BLOCKED', "reasonCode" = 'LEGAL_HOLD_ACTIVE', "reviewOutcome" = ${JSON.stringify(outcome)}::jsonb
        WHERE id = ${r.id} AND status IN ('IN_REVIEW', 'BLOCKED') AND ${same} RETURNING id`)).rows;
      return done.length ? { blocked: true } : { conflict: true };
    }
    const done = (await tx.execute(sql`UPDATE "DSRRequest" SET status = 'EXECUTING', "reviewOutcome" = ${JSON.stringify(outcome)}::jsonb WHERE id = ${r.id} AND status IN ('IN_REVIEW', 'BLOCKED') AND ${same} RETURNING id`)).rows;
    if (!done.length) return { conflict: true };
    const out = await execute(tx, sid, r.id, reviewer);
    await tx.execute(sql`UPDATE "DSRRequest" SET status = 'COMPLETED', "completedAt" = NOW(), "reviewOutcome" = ${JSON.stringify({ ...outcome, executed: out.summary })}::jsonb WHERE id = ${r.id}`);
    await tx.insert(AuditLog).values({ action: 'ORGANIZATION_CLOSED', entity: 'STRUCTURE', entity_id: sid, actor_id: reviewer, details: { requestId: r.id, ...out.summary }, ip_hash: 'ADMIN_MFA' });
    return out;
  });
  if (result.conflict) return bad('conflict', 'La demande a changé entre-temps.', 409);
  if (result.blocked) { await audit(db, 'ORGANIZATION_CLOSURE_BLOCKED', reviewer, r.id); return { ok: true, request: { id: r.id, status: 'BLOCKED' }, blockedBy: 'LEGAL_HOLD_ACTIVE' }; }
  // after the commit: each person whose appointment was cancelled is told (the ledger records the outcome; no text, no address)
  const notify = deps.noticeCitizen || noticeCitizen;
  for (const a of result.appointments) {
    await notify(a, 'CANCELLED_BY_STRUCTURE', { subject: 'Rendez-vous annulé', text: `Votre rendez-vous du ${formatParis(a.startAt)} est annulé : la structure a fermé son espace sur AccèsDirectAide. Vos dossiers restent à vous ; vous pouvez prendre rendez-vous avec une autre structure.` }, { db }).catch(() => {});
  }
  return { ok: true, request: { id: r.id, status: 'COMPLETED' }, summary: result.summary };
}

/** After a legal hold is released, a BLOCKED closure is executed again (one MFA administrator: two people already decided). */
export async function retryBlockedClosure(id, reviewer, db = defaultDb, deps = {}) {
  const [r] = (await db.execute(sql`SELECT id, status, "subjectId" AS sid, "reviewOutcome" AS o FROM "DSRRequest" WHERE id = ${String(id || '')} AND "requestType" = ${REQUEST_TYPE} AND status = 'BLOCKED'`)).rows;
  if (!r || r.o?.decision !== 'APPROVED') return bad('not_found', 'Aucune fermeture bloquée à reprendre.', 404);
  await audit(db, 'ORGANIZATION_CLOSURE_RETRIED', reviewer, r.id);
  return runApproved(db, r, r.o, sql`"reviewOutcome" = ${JSON.stringify(r.o)}::jsonb`, reviewer, deps);
}
