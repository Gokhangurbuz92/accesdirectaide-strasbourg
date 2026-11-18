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
 *   - A02: after the commit the other organization of each ended referral and each person whose dossier access or referral ended are told (tellClosure);
 *     A03: the members' Outlook links (tokens, Outlook address) are deleted;
 *   - kept on purpose: citizen-visible notes and case outcomes (part of the person's follow-up, erasable through the person's own request), the messages exchanged
 *     with people, the consent ledger, the audit trails, and the public directory record (public-source information; online booking is switched off).
 */
import { releaseSenderCase } from './referrals.js';
import { endReferentsForClosedOrganization } from './dossier-referent.js';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';
import { snapshotRow } from './content-versions.js';
import { formatParis, noticeCitizen } from './appointment-notices.js';
import { READ_REQUIRED, readSince } from './review-reads.js';
import { mailLedgerStatus, sendMail as defaultSendMail } from '../_utils/mailer.js';
import { ACCESS_ENDED_BY, recordAccessEnded } from '../lib/consent-ledger.js';
import { logger } from '../lib/logger.js';
import { canNotify } from './citizen-account.js';
import { buildAppUrl } from '../_utils/user-auth.js';

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
    futureAppointments: await one(sql`SELECT count(*)::int AS n FROM "ProAppointment" WHERE "structureId" = ${sid} AND status IN ('booked', 'requested', 'confirmed') AND "startAt" > NOW()`),
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
  // A03: the members' Outlook link (refresh token, access token, Outlook address) ends with the space. Nothing in the code revokes a token at Microsoft: the
  // stored copy is deleted here, so ADA can no longer read any calendar; the member removes the application's consent from their Microsoft account themselves.
  summary.outlookLinksErased = await n(sql`DELETE FROM "ProOutlookToken" WHERE "userId" IN (SELECT id FROM "ProUser" WHERE "structureId" = ${sid})`);
  summary.referentsEnded = (await endReferentsForClosedOrganization(tx, sid)).length;   // M2 / G5: no contact person of a closed organization stays shown
  summary.aiDraftsForgotten = await n(sql`DELETE FROM "AiOutputReview" WHERE kind = 'DOSSIER_SYNTHESIS' AND "scopeStructureId" = ${sid}`);
  summary.internalNotesErased = await n(sql`DELETE FROM "ProCaseNote" WHERE "structureId" = ${sid} AND visibility = 'INTERNAL'`);
  const open = (await tx.execute(sql`UPDATE "ProCase" SET status = 'CLOSED', outcome = COALESCE(outcome, 'OTHER'), "closedAt" = NOW() WHERE "structureId" = ${sid} AND status <> 'CLOSED'
    RETURNING id, "structureId"`)).rows;
  for (const c of open) await tx.execute(sql`INSERT INTO "ProCaseEvent" (id, "caseId", "structureId", "actorProUserId", kind, "fromValue", "toValue", "createdAt")
    VALUES (${crypto.randomUUID()}, ${c.id}, ${c.structureId}, NULL, 'CLOSED', 'ORGANIZATION_CLOSED', 'CLOSED', NOW())`);
  summary.casesClosed = open.length;
  // referrals: one SENT by the closing organization and already ACCEPTED by the other one stays (that organization keeps supporting the person); one not yet accepted
  // is cancelled and the access it created is revoked; one RECEIVED by the closing organization ends (the sender sees it)
  const refs = (await tx.execute(sql`SELECT id, status, "fromStructureId" AS f, "toStructureId" AS t, "sharedDiagnosticId" AS d, "grantId" AS g, "fromCaseId" AS c FROM "Referral" WHERE ("fromStructureId" = ${sid} OR "toStructureId" = ${sid})
    AND status IN (${list(LIVE_REFERRALS)}) FOR UPDATE`)).rows;
  let ended = 0; const endedReferrals = [];
  /** @type {{ shareId: string, structureId: string }[]} */ const endedAccesses = grants.map((g) => ({ shareId: g.d, structureId: sid }));
  for (const r of refs) {
    const sent = r.f === sid;
    if (sent && ['ACCEPTED', 'IN_PROGRESS'].includes(r.status)) continue;
    const to = sent || ['DRAFT', 'PENDING_CITIZEN'].includes(r.status) ? 'CANCELLED' : 'CLOSED';
    await tx.execute(sql`UPDATE "Referral" SET status = ${to}, "closedAt" = NOW(), "updatedAt" = NOW() WHERE id = ${r.id}`);
    await tx.execute(sql`INSERT INTO "ReferralEvent" (id, "referralId", "actorType", "actorId", "fromStatus", "toStatus", "createdAt") VALUES (${crypto.randomUUID()}, ${r.id}, 'SYSTEM', 'ORGANIZATION_CLOSED', ${r.status}, ${to}, NOW())`);
    if (sent && r.g) {
      const g = (await tx.execute(sql`UPDATE "SharedDossierGrant" SET "revokedAt" = NOW() WHERE id = ${r.g} AND "grantedVia" = 'referral' AND "revokedAt" IS NULL RETURNING "sharedDiagnosticId" AS d, "structureId" AS s`)).rows;
      for (const x of g) endedAccesses.push({ shareId: x.d, structureId: x.s });
    }
    // A07: a referral the closing organization RECEIVED ends without support — the sender's case leaves REFERRED when it has no other referral held by a
    // receiver (the closing organization's own cases are closed above)
    if (!sent) await releaseSenderCase(tx, r.c);
    ended += 1;
    endedReferrals.push({ id: r.id, sharedDiagnosticId: r.d, was: r.status, sent, otherStructureId: sent ? r.t : r.f });
  }
  summary.referralsEnded = ended;
  // FA-D5 / F2: the purposes (PURP-05/06/07) those accesses carried end in the consent ledger — channel organisation_closed, never the person's withdrawal
  summary.consentLedgerRows = await recordAccessEnded(tx, endedAccesses, ACCESS_ENDED_BY.ORGANISATION_CLOSED, logger);
  const appts = (await tx.execute(sql`UPDATE "ProAppointment" SET status = 'cancelled', "cancelledAt" = NOW(), "cancelledBy" = 'ORGANIZATION_CLOSED', "updatedAt" = NOW()
    WHERE "structureId" = ${sid} AND status IN ('booked', 'requested', 'confirmed') AND "startAt" > NOW() RETURNING id, "citizenUserId", "startAt"`)).rows;   // R47: the account bookings (confirmed, requested) too, not only the legacy « booked »
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
  return { summary, appointments: appts, referrals: endedReferrals, dossiers: grants.map((g) => g.d) };
}

/**
 * A02 — after the commit, the people and the other organizations learn what the closure ended (before: only the cancelled appointments were told; a referral
 * silently became CANCELLED / CLOSED and an access disappeared). Best effort, like every other notice: the closure itself is already committed.
 *   - the OTHER organization of each ended referral it already knew of (a proposal the person had not authorized yet was never shown to the receiver): in-app
 *     notice through the one catalogue (`referral_cancelled`), identifiers only;
 *   - the PERSON: ONE e-mail per person (never one per dossier), sent only with their service e-mails on (canNotify) to their verified account address. It names
 *     the organization (public directory information) and never gives the reason of the closure. The outcome is written per referral (REFERRAL_CITIZEN_NOTICE,
 *     kind ORGANIZATION_CLOSED — the ledger the referral chain already uses) and per dossier whose access ended (DOSSIER_ACCESS_CITIZEN_NOTICE): no address, no text.
 */
async function tellClosure(db, sid, result, deps = {}) {
  const sendMail = deps.sendMail || defaultSendMail;
  const out = { organizationsNotified: 0, peopleNotified: 0, people: 0 };
  let name = '';
  try { name = String((await db.execute(sql`SELECT nom FROM "Structure" WHERE id = ${sid}`)).rows[0]?.nom || ''); } catch { /* the notice stays generic */ }
  for (const r of result.referrals || []) {
    if (r.sent && ['DRAFT', 'PENDING_CITIZEN'].includes(r.was)) continue;
    try {
      const notify = deps.notifyPro || (await import('./pro-notifications.js')).notify;
      const sum = await notify({ structureId: r.otherStructureId, to: 'members', type: 'referral_cancelled', title: 'Orientation close : la structure a fermé son espace',
        message: r.sent ? 'La structure d’origine a fermé son espace sur AccèsDirectAide : l’orientation est annulée et l’accès au dossier est retiré.'
          : 'La structure destinataire a fermé son espace sur AccèsDirectAide : l’orientation est close. Une nouvelle orientation reste possible avec l’accord de la personne.',
        metadata: { referralId: r.id, kind: 'ORGANIZATION_CLOSED' } }, { db });
      if (sum?.inApp) out.organizationsNotified += 1;
    } catch { /* best effort */ }
  }
  // the person: every dossier whose access ended, every referral the person knew of (a DRAFT was never shown to anyone)
  const told = (result.referrals || []).filter((r) => r.was !== 'DRAFT');
  const dossierIds = [...new Set([...(result.dossiers || []), ...told.map((r) => r.sharedDiagnosticId)].map(String))];
  if (!dossierIds.length) return out;
  let owners = [];
  try {
    owners = (await db.execute(sql`SELECT d.id AS d, u.id AS uid, u.email FROM "SharedDiagnostic" d LEFT JOIN "CitizenUser" u ON u.id = d."ownerCitizenId" AND u."emailVerifiedAt" IS NOT NULL
      WHERE d.id IN (${list(dossierIds)})`)).rows;
  } catch { return out; }
  const byPerson = new Map(); const outcomeOf = new Map();
  for (const o of owners) { if (!o.uid) { outcomeOf.set(String(o.d), 'NO_RECIPIENT'); continue; } const e = byPerson.get(o.uid) || { email: o.email, dossiers: [] }; e.dossiers.push(String(o.d)); byPerson.set(o.uid, e); }
  for (const [uid, p] of byPerson) {
    out.people += 1;
    let outcome = 'FAILED';
    try {
      const refs = told.filter((r) => p.dossiers.includes(String(r.sharedDiagnosticId))).length;
      if (!(await canNotify(uid, 'email', 'service', db).catch(() => false))) outcome = 'NO_CONSENT';
      else {
        const who = name ? `La structure « ${name} »` : 'Une structure';
        outcome = mailLedgerStatus(await sendMail({ to: p.email, category: 'organization-closure', subject: 'Une structure n’a plus accès à votre dossier',
          text: `${who} a fermé son espace sur AccèsDirectAide.\n\nElle n’a plus accès à votre dossier.${refs ? `\n${refs > 1 ? `${refs} orientations qui la concernaient sont closes` : 'Une orientation qui la concernait est close'} : aucune suite ne sera donnée par cette structure.` : ''}`
            + `\n\nVotre dossier reste à vous : rien n’est supprimé et vous n’avez rien à faire. Vous pouvez le partager avec une autre structure quand vous le souhaitez.\nLe détail est dans Mon Espace : ${buildAppUrl('/compte')}` }));
      }
    } catch { outcome = 'FAILED'; }
    if (['PROVIDER_ACCEPTED', 'TEST_RECORDED'].includes(outcome)) out.peopleNotified += 1;
    for (const d of p.dossiers) outcomeOf.set(d, outcome);
  }
  for (const r of told) await db.insert(AuditLog).values({ action: 'REFERRAL_CITIZEN_NOTICE', actor: 'system', entity: 'Referral', entity_id: r.id, details: { kind: 'ORGANIZATION_CLOSED', outcome: outcomeOf.get(String(r.sharedDiagnosticId)) || 'NO_RECIPIENT' } }).catch(() => {});
  for (const d of [...new Set((result.dossiers || []).map(String))]) await db.insert(AuditLog).values({ action: 'DOSSIER_ACCESS_CITIZEN_NOTICE', actor: 'system', entity: 'SharedDiagnostic', entity_id: d, details: { kind: 'ORGANIZATION_CLOSED', outcome: outcomeOf.get(d) || 'NO_RECIPIENT' } }).catch(() => {});
  return out;
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
  const notices = await tellClosure(db, sid, result, deps).catch(() => null);
  return { ok: true, request: { id: r.id, status: 'COMPLETED' }, summary: result.summary, ...(notices ? { notices } : {}) };
}

/** After a legal hold is released, a BLOCKED closure is executed again (one MFA administrator: two people already decided). */
export async function retryBlockedClosure(id, reviewer, db = defaultDb, deps = {}) {
  const [r] = (await db.execute(sql`SELECT id, status, "subjectId" AS sid, "reviewOutcome" AS o FROM "DSRRequest" WHERE id = ${String(id || '')} AND "requestType" = ${REQUEST_TYPE} AND status = 'BLOCKED'`)).rows;
  if (!r || r.o?.decision !== 'APPROVED') return bad('not_found', 'Aucune fermeture bloquée à reprendre.', 404);
  await audit(db, 'ORGANIZATION_CLOSURE_RETRIED', reviewer, r.id);
  return runApproved(db, r, r.o, sql`"reviewOutcome" = ${JSON.stringify(r.o)}::jsonb`, reviewer, deps);
}
