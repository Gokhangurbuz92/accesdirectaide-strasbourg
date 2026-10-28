// @ts-nocheck
/**
 * PKG-4 / R09 R10 R11 E06 — closed-loop referral of a citizen dossier from one organization (sender) to another (receiver).
 *
 *   DRAFT/PENDING_CITIZEN ──citizen authorizes──▶ SENT ──receiver──▶ ACKNOWLEDGED ──▶ ACCEPTED ──▶ IN_PROGRESS ──▶ COMPLETED ──▶ CLOSED
 *            │                                    │  ╲──────────────▶ NEEDS_INFO ──sender replies──▶ SENT
 *            └─citizen refuses / sender cancels──▶ CANCELLED        └──▶ DECLINED ──▶ CLOSED          (no answer after the due date + 14 days ──▶ EXPIRED)
 *
 * Rules (enforced HERE and by the database): the professional cannot give the receiver access — only the CITIZEN's authorization creates the receiver's grant
 * (grantedVia 'referral'); the receiver must be a verified, active organization; the receiver sees the dossier through its own grant projection and the referral
 * message — never the sender's internal notes; a declined / cancelled / expired referral revokes the grant it created. Every transition is ONE conditional UPDATE
 * (status IN allowed) so double clicks, retries and concurrent actors cannot skip or repeat a step; each step is recorded in ReferralEvent (append-only).
 */
import crypto from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { ProCase, ProCaseEvent, ProAppointment, Referral, ReferralEvent, SharedDossierGrant } from '../../src/db/schema.js';
import { activeGrantExists, activeMemberSql, caseAccessSql } from '../_utils/share-access.js';
import { openText, sealText } from '../lib/data-keys.js';
import { OUTCOMES, ensureCase, isAdmin } from './pro-cases.js';
import { sendMail as defaultSendMail } from '../_utils/mailer.js';
import { canNotify } from './citizen-account.js';
import { isDossierRestricted } from './processing-restriction.js';
import { buildAppUrl } from '../_utils/user-auth.js';

export const REASONS = ['SPECIALISED_SUPPORT', 'ACCESS_TO_RIGHTS', 'HOUSING', 'EMPLOYMENT', 'HEALTH', 'FOOD_AID', 'DIGITAL_SUPPORT', 'LEGAL', 'OTHER'];
export const RESPONSES = ['OUT_OF_SCOPE', 'NO_CAPACITY', 'ALREADY_SUPPORTED', 'NEEDS_MORE_INFORMATION', 'OTHER'];
export const ACK_DAYS = 5;
export const EXPIRE_AFTER_DUE_DAYS = 14;
const LIVE = ['DRAFT', 'PENDING_CITIZEN', 'SENT', 'ACKNOWLEDGED', 'NEEDS_INFO', 'ACCEPTED', 'IN_PROGRESS'];
const day = 86400000;
const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
const notFound = () => bad('not_found', 'Orientation introuvable.', 404);
const ctxOf = (id) => ({ purpose: 'referral-message', context: `referral:${id}` });

async function record(db, r, actorType, actorId, fromStatus, toStatus) {
  await db.insert(ReferralEvent).values({ referralId: r.id, actorType, actorId: actorId || null, fromStatus, toStatus });
}
/** One conditional transition; null when the referral was not in an allowed state (raced or replayed). */
async function transition(db, id, from, set, where = sql`TRUE`) {
  const rows = await db.update(Referral).set(set).where(and(eq(Referral.id, id), inArray(Referral.status, from), where)).returning();
  return rows[0] || null;
}
async function revokeReferralGrant(db, r) {
  if (!r.grantId) return;
  await db.update(SharedDossierGrant).set({ revokedAt: new Date() }).where(and(eq(SharedDossierGrant.id, r.grantId), eq(SharedDossierGrant.grantedVia, 'referral'), sql`${SharedDossierGrant.revokedAt} IS NULL`));
}
/** PKG-4 / R20: every active member of the organization, through the one catalogue (in-app always; e-mail per preference; honest delivery record). */
async function notifyOrg(db, structureId, type, title, message, metadata) {
  try { const { notify } = await import('./pro-notifications.js'); await notify({ structureId, to: 'members', type, title, message, metadata }); } catch { /* best effort */ }
}

/** Receiving organizations a professional can propose: verified, active, with at least one active member, not their own. Names only (no personal data). */
export async function eligibleReceivers(ctx, q = '', db = defaultDb, onlyId = null) {
  const term = `%${String(q || '').trim().slice(0, 60)}%`;
  return (await db.execute(sql`SELECT s.id, s.nom AS name, s.ville AS city FROM "Structure" s
    WHERE s.statut = 'actif' AND s.verification_status = 'VERIFIED' AND s.id <> ${ctx.structureId} AND s.nom ILIKE ${term}
      ${onlyId ? sql`AND s.id = ${String(onlyId)}` : sql``}
      AND EXISTS (SELECT 1 FROM "ProUser" u WHERE u."structureId" = s.id AND u.status = 'active' AND upper(u.role) IN ('PRO', 'STRUCTURE_ADMIN'))
    ORDER BY s.nom LIMIT 30`)).rows;
}

/** Sender: propose a referral of a case the caller may open. It waits for the CITIZEN's authorization (nothing is shared before). Idempotent on idempotencyKey. */
export async function propose(ctx, input, deps = {}) {
  const db = deps.db || defaultDb;
  const reasonCode = String(input?.reasonCode || ''); const message = String(input?.message || '').trim(); const key = String(input?.idempotencyKey || '').slice(0, 80) || null;
  if (!REASONS.includes(reasonCode)) return bad('INVALID_REASON', 'Choisissez le motif de l’orientation.');
  if (message.length > 1500) return bad('INVALID_MESSAGE', 'Le message fait 1500 caractères au plus.');
  const [c] = await db.select().from(ProCase).where(and(eq(ProCase.id, String(input?.caseId || '')), eq(ProCase.structureId, ctx.structureId))).limit(1);
  if (!c || !(await db.execute(sql`SELECT 1 AS ok WHERE ${activeGrantExists(c.sharedDiagnosticId, ctx)}`)).rows.length) return bad('not_found', 'Dossier introuvable.', 404);
  if (c.status === 'CLOSED') return bad('CASE_CLOSED', 'Ce dossier est clôturé.', 409);
  const toStructureId = String(input?.toStructureId || '');
  // PKG-11 audit: the chosen organization itself is checked (the former filter over the first 30 names refused every receiver ranked 31st or later)
  const [target] = toStructureId ? await eligibleReceivers(ctx, '', db, toStructureId) : [];
  if (!target) return bad('INVALID_RECEIVER', 'Cette structure ne peut pas recevoir d’orientation (structure non vérifiée, inactive ou sans équipe active).', 400);
  if (key) {
    const [replay] = await db.select().from(Referral).where(and(eq(Referral.fromStructureId, ctx.structureId), eq(Referral.idempotencyKey, key))).limit(1);
    if (replay) return { ok: true, status: 200, referral: { id: replay.id, status: replay.status } };
  }
  const id = crypto.randomUUID();
  const rows = await db.insert(Referral).values({ id, sharedDiagnosticId: c.sharedDiagnosticId, fromStructureId: ctx.structureId, toStructureId, fromCaseId: c.id, createdByProUserId: ctx.userId,
    status: 'PENDING_CITIZEN', reasonCode, messageEncrypted: message ? sealText(message, ctxOf(id)) : null, idempotencyKey: key }).onConflictDoNothing().returning();
  if (!rows.length) return bad('ALREADY_REFERRED', 'Une orientation vers cette structure est déjà en cours pour ce dossier.', 409);
  await record(db, rows[0], 'SENDER', ctx.userId, null, 'PENDING_CITIZEN');
  await db.insert(ProCaseEvent).values({ caseId: c.id, structureId: c.structureId, actorProUserId: ctx.userId, kind: 'REFERRAL', toValue: 'PENDING_CITIZEN' });
  await tellCitizen(db, c.sharedDiagnosticId, deps.sendMail || defaultSendMail, 'Une proposition d’orientation attend votre accord',
    `Une structure qui vous accompagne propose de transmettre votre dossier à ${target.name}. Rien n’est transmis sans votre accord.\nDécidez depuis Mon Espace : ${buildAppUrl('/compte/orientations')}`);
  return { ok: true, status: 201, referral: { id, status: 'PENDING_CITIZEN', to: target.name } };
}

async function tellCitizen(db, dossierId, sendMail, subject, text) {
  try {
    const [o] = (await db.execute(sql`SELECT u.id, u.email FROM "SharedDiagnostic" d JOIN "CitizenUser" u ON u.id = d."ownerCitizenId" WHERE d.id = ${dossierId} AND u."emailVerifiedAt" IS NOT NULL`)).rows;
    if (o && (await canNotify(o.id, 'email', 'service').catch(() => false))) await sendMail({ to: o.email, subject, text, category: 'referral' });
  } catch { /* best effort */ }
}

/** Citizen: the referrals of the dossiers they own (sender, receiver, status, reason, message, outcome summary). */
export async function citizenList(userId, db = defaultDb) {
  const rows = (await db.execute(sql`SELECT r.*, sf.nom AS "fromName", st.nom AS "toName" FROM "Referral" r JOIN "SharedDiagnostic" d ON d.id = r."sharedDiagnosticId"
    JOIN "Structure" sf ON sf.id = r."fromStructureId" JOIN "Structure" st ON st.id = r."toStructureId" WHERE d."ownerCitizenId" = ${userId} ORDER BY r."createdAt" DESC LIMIT 100`)).rows;
  return { ok: true, status: 200, referrals: rows.map((r) => ({ id: r.id, dossierId: r.sharedDiagnosticId, from: r.fromName, to: r.toName, status: r.status, reasonCode: r.reasonCode,
    message: r.messageEncrypted ? openText(r.messageEncrypted, ctxOf(r.id)) : '', outcome: r.outcome, outcomeSummary: r.outcomeCitizenSummary, createdAt: r.createdAt, sentAt: r.sentAt })) };
}

/** Citizen: authorize (creates the receiver's grant, referral SENT) or refuse (CANCELLED). Only the dossier's owner; only from PENDING_CITIZEN; exactly once. */
export async function citizenDecide(userId, id, accept, db = defaultDb) {
  const [r] = (await db.execute(sql`SELECT r.* FROM "Referral" r JOIN "SharedDiagnostic" d ON d.id = r."sharedDiagnosticId" WHERE r.id = ${String(id || '')} AND d."ownerCitizenId" = ${userId} AND d."expiresAt" > NOW()`)).rows;
  if (!r) return notFound();
  if (!accept) {
    const done = await transition(db, r.id, ['PENDING_CITIZEN', 'DRAFT'], { status: 'CANCELLED', citizenDecisionAt: new Date(), closedAt: new Date() });
    if (!done) return bad('ALREADY_DECIDED', 'Vous avez déjà répondu à cette proposition.', 409);
    await record(db, r, 'CITIZEN', userId, r.status, 'CANCELLED');
    await notifyOrg(db, r.fromStructureId, 'referral_refused', 'Orientation refusée par la personne', 'La personne n’a pas souhaité transmettre son dossier.', { referralId: r.id });
    return { ok: true, status: 200, referral: { id: r.id, status: 'CANCELLED' } };
  }
  // R14: the proposer must still be an active member of the sending organization (accounts are disabled, never deleted: the former null check never fired)
  if (!r.createdByProUserId || !(await db.execute(sql`SELECT 1 AS ok WHERE ${activeMemberSql({ userId: r.createdByProUserId, structureId: r.fromStructureId })}`)).rows.length) return bad('SENDER_GONE', 'La personne qui a proposé cette orientation n’est plus active : la structure doit la renouveler.', 409);
  // PKG-11 audit: no new access while the person restricts processing (art. 18)
  if (await isDossierRestricted(r.sharedDiagnosticId, db)) return bad('PROCESSING_RESTRICTED', 'Vous avez demandé la limitation du traitement : levez-la avant d’autoriser une orientation.', 409);
  return db.transaction(async (tx) => {
    // PKG-11 audit: a REVOKED grant brought back by a referral starts again from the base purpose only (PURP-06), as redeem.js does — before, its old purposes
    // (AI synthesis PURP-05, SIAO PURP-07) came back without any new consent. An ACTIVE grant keeps what the person already authorized.
    const [g] = await tx.insert(SharedDossierGrant).values({ sharedDiagnosticId: r.sharedDiagnosticId, structureId: r.toStructureId, grantedByProUserId: r.createdByProUserId, grantedVia: 'referral', purposes: 'PURP-06' })
      .onConflictDoUpdate({ target: [SharedDossierGrant.sharedDiagnosticId, SharedDossierGrant.structureId], set: {
        purposes: sql`CASE WHEN "SharedDossierGrant"."revokedAt" IS NULL THEN "SharedDossierGrant"."purposes" ELSE 'PURP-06' END`,
        purposesUpdatedAt: sql`CASE WHEN "SharedDossierGrant"."revokedAt" IS NULL THEN "SharedDossierGrant"."purposesUpdatedAt" ELSE NOW() END`,
        grantedVia: sql`CASE WHEN "SharedDossierGrant"."revokedAt" IS NULL THEN "SharedDossierGrant"."grantedVia" ELSE 'referral' END`,
        revokedAt: null } }).returning();
    const now = new Date();
    const done = await transition(tx, r.id, ['PENDING_CITIZEN'], { status: 'SENT', grantId: g.id, citizenDecisionAt: now, sentAt: now, dueAt: new Date(now.getTime() + ACK_DAYS * day) });
    if (!done) throw Object.assign(new Error('raced'), { code: 'ALREADY_DECIDED' });
    await record(tx, r, 'CITIZEN', userId, 'PENDING_CITIZEN', 'SENT');
    if (r.fromCaseId) await tx.update(ProCase).set({ status: 'REFERRED' }).where(and(eq(ProCase.id, r.fromCaseId), sql`${ProCase.status} <> 'CLOSED'`));
    return { ok: true, status: 200, referral: { id: r.id, status: 'SENT' } };
  }).then(async (out) => {
    // after COMMIT: the receiving organization is told only once the access really exists (and a slow mailer never holds the transaction)
    await notifyOrg(db, r.toStructureId, 'referral_received', 'Nouvelle orientation reçue', 'Une orientation attend votre accusé de réception.', { referralId: r.id });
    return out;
  }).catch((e) => (e.code === 'ALREADY_DECIDED' ? bad('ALREADY_DECIDED', 'Vous avez déjà répondu à cette proposition.', 409) : Promise.reject(e)));
}

/** Organization views. box: 'inbox' (received, E06) | 'outbox' (sent). Members of the organization only. */
export async function listBox(ctx, box, db = defaultDb) {
  if (!(await db.execute(sql`SELECT 1 AS ok WHERE ${activeMemberSql(ctx)}`)).rows.length) return bad('forbidden', 'Accès refusé.', 403);
  const inbox = box !== 'outbox';
  const rows = (await db.execute(sql`SELECT r.id, r.status, r."reasonCode", r."responseCode", r.outcome, r."createdAt", r."sentAt", r."dueAt", r."acknowledgedAt", r."respondedAt", r."closedAt",
      r."sharedDiagnosticId" AS "dossierId", sf.nom AS "fromName", st.nom AS "toName", (r."dueAt" < NOW() AND r.status IN ('SENT', 'NEEDS_INFO')) AS overdue
    FROM "Referral" r JOIN "Structure" sf ON sf.id = r."fromStructureId" JOIN "Structure" st ON st.id = r."toStructureId"
    WHERE ${inbox ? sql`r."toStructureId" = ${ctx.structureId} AND r.status NOT IN ('DRAFT', 'PENDING_CITIZEN') AND r."sentAt" IS NOT NULL` : sql`r."fromStructureId" = ${ctx.structureId}`}
    ORDER BY r."createdAt" DESC LIMIT 200`)).rows;
  // R14: the receiver gets the dossier link only while its grant is active (as getReferral) — the inbox used to list it for a revoked or restricted dossier too
  if (inbox) {
    const open = new Map();
    for (const id of new Set(rows.map((x) => x.dossierId).filter(Boolean))) open.set(id, (await db.execute(sql`SELECT 1 AS ok WHERE ${activeGrantExists(id, ctx)}`)).rows.length > 0);
    for (const x of rows) if (!open.get(x.dossierId)) x.dossierId = null;
  }
  return { ok: true, status: 200, box: inbox ? 'inbox' : 'outbox', referrals: rows };
}

/** One referral for a member of the sender or the receiver organization. The receiver gets the dossier link only while its grant is active. */
export async function getReferral(ctx, id, db = defaultDb) {
  const [r] = await db.select().from(Referral).where(eq(Referral.id, String(id || ''))).limit(1);
  if (!r || ![r.fromStructureId, r.toStructureId].includes(ctx.structureId) || (r.toStructureId === ctx.structureId && (['DRAFT', 'PENDING_CITIZEN'].includes(r.status) || !r.sentAt))) return notFound();   // R14: never sent = never the receiver's
  if (!(await db.execute(sql`SELECT 1 AS ok WHERE ${activeMemberSql(ctx)}`)).rows.length) return notFound();
  const side = r.fromStructureId === ctx.structureId ? 'SENDER' : 'RECEIVER';
  const events = await db.select().from(ReferralEvent).where(eq(ReferralEvent.referralId, r.id)).orderBy(desc(ReferralEvent.createdAt));
  const names = (await db.execute(sql`SELECT id, nom FROM "Structure" WHERE id IN (${r.fromStructureId}, ${r.toStructureId})`)).rows;
  const nameOf = (sid) => names.find((n) => n.id === sid)?.nom || '';
  const dossierOpen = side === 'RECEIVER' ? (await db.execute(sql`SELECT 1 AS ok WHERE ${activeGrantExists(r.sharedDiagnosticId, ctx)}`)).rows.length > 0 : false;
  // PKG-11 audit: the free texts are about the person: shown only to a side that still holds an active access to the dossier (revoked, declined or restricted
  // processing = the texts are hidden; the statuses and dates stay)
  const textsOpen = side === 'RECEIVER' ? dossierOpen : (await db.execute(sql`SELECT 1 AS ok WHERE ${activeGrantExists(r.sharedDiagnosticId, ctx)}`)).rows.length > 0;
  let appointment = null;
  if (r.appointmentId) {
    const [a] = await db.select({ startAt: ProAppointment.startAt, mode: ProAppointment.mode, status: ProAppointment.status }).from(ProAppointment).where(eq(ProAppointment.id, r.appointmentId)).limit(1);
    appointment = a || null;
  }
  return { ok: true, status: 200, side, referral: { id: r.id, status: r.status, reasonCode: r.reasonCode, from: nameOf(r.fromStructureId), to: nameOf(r.toStructureId),
    message: textsOpen && r.messageEncrypted ? openText(r.messageEncrypted, ctxOf(r.id)) : '', responseCode: r.responseCode,
    responseMessage: textsOpen && r.responseMessageEncrypted ? openText(r.responseMessageEncrypted, ctxOf(r.id)) : '', textsHidden: !textsOpen, outcome: r.outcome, outcomeSummary: r.outcomeCitizenSummary,
    createdAt: r.createdAt, sentAt: r.sentAt, dueAt: r.dueAt, acknowledgedAt: r.acknowledgedAt, respondedAt: r.respondedAt, closedAt: r.closedAt, appointment,
    dossierId: side === 'RECEIVER' && dossierOpen ? r.sharedDiagnosticId : side === 'SENDER' ? r.sharedDiagnosticId : null },
    events: events.map((e) => ({ actor: e.actorType, from: e.fromStatus, to: e.toStatus, at: e.createdAt })) };
}

/** Receiver actions: acknowledge | accept | decline | needs_info | link_appointment | start | complete. Sender actions: reply | cancel | close. */
export async function act(ctx, id, action, input = {}, deps = {}) {
  const db = deps.db || defaultDb;
  const [r] = await db.select().from(Referral).where(eq(Referral.id, String(id || ''))).limit(1);
  if (!r || !(await db.execute(sql`SELECT 1 AS ok WHERE ${activeMemberSql(ctx)}`)).rows.length) return notFound();
  const receiver = r.toStructureId === ctx.structureId && Boolean(r.sentAt); const sender = r.fromStructureId === ctx.structureId;   // R14: a referral never sent is not the receiver's
  if (!receiver && !sender) return notFound();
  const now = new Date();
  const go = async (from, set, actor, to, extraWhere) => {
    const done = await transition(db, r.id, from, set, extraWhere);
    if (!done) return bad('INVALID_TRANSITION', 'Cette action n’est pas possible dans l’état actuel de l’orientation.', 409);
    await record(db, r, actor, ctx.userId, r.status, to);
    return { ok: true, status: 200, referral: { id: r.id, status: to } };
  };
  // the receiver acts only while the citizen's grant to it is active, processing is not restricted (art. 18) and the caller may open the case (PKG-4 assignment rule);
  // R12 (E06): the former check was the grant alone, so a colleague could act on a case assigned to someone else. Evaluated inside the UPDATE (no race).
  const receiverGrant = receiver ? activeGrantExists(r.sharedDiagnosticId, ctx) : sql`TRUE`;
  // the sender's cancel / close follows the same assignment rule on its own case (the grant may be gone: withdrawing stays possible)
  const senderCase = sender ? caseAccessSql(r.sharedDiagnosticId, ctx) : sql`TRUE`;
  if (receiver && action === 'acknowledge') return go(['SENT'], { status: 'ACKNOWLEDGED', acknowledgedAt: now }, 'RECEIVER', 'ACKNOWLEDGED', receiverGrant);
  if (receiver && action === 'accept') {
    const out = await go(['SENT', 'ACKNOWLEDGED', 'NEEDS_INFO'], { status: 'ACCEPTED', respondedAt: now, acknowledgedAt: r.acknowledgedAt || now }, 'RECEIVER', 'ACCEPTED', receiverGrant);
    if (out.ok) {
      const c = await ensureCase(r.sharedDiagnosticId, ctx, db);
      await notifyOrg(db, r.fromStructureId, 'referral_accepted', 'Orientation acceptée', 'La structure destinataire a accepté l’orientation.', { referralId: r.id });
      await tellCitizen(db, r.sharedDiagnosticId, deps.sendMail || defaultSendMail, 'Votre orientation a été acceptée', `La structure destinataire a accepté de vous accompagner. Suivez-la depuis Mon Espace : ${buildAppUrl('/compte/orientations')}`);
      out.caseId = c?.id || null;
    }
    return out;
  }
  if (receiver && (action === 'decline' || action === 'needs_info')) {
    const code = action === 'needs_info' ? 'NEEDS_MORE_INFORMATION' : String(input.responseCode || '');
    if (!RESPONSES.includes(code)) return bad('INVALID_RESPONSE', 'Choisissez le motif de la réponse.');
    const msg = String(input.message || '').trim();
    if (msg.length > 1500 || (action === 'needs_info' && msg.length < 5)) return bad('INVALID_MESSAGE', 'Précisez votre demande (5 à 1500 caractères).');
    const to = action === 'decline' ? 'DECLINED' : 'NEEDS_INFO';
    const out = await go(['SENT', 'ACKNOWLEDGED'], { status: to, responseCode: code, responseMessageEncrypted: msg ? sealText(msg, ctxOf(r.id)) : null, respondedAt: now, acknowledgedAt: r.acknowledgedAt || now }, 'RECEIVER', to, receiverGrant);
    if (out.ok && to === 'DECLINED') await revokeReferralGrant(db, r);
    if (out.ok) await notifyOrg(db, r.fromStructureId, to === 'DECLINED' ? 'referral_declined' : 'referral_needs_info', to === 'DECLINED' ? 'Orientation déclinée' : 'Informations demandées', to === 'DECLINED' ? 'La structure destinataire a décliné l’orientation.' : 'La structure destinataire demande des précisions.', { referralId: r.id });
    // R12 (R10): the person is told too (before: only the organizations were) — no reason and no message in the e-mail, the detail stays in Mon Espace
    if (out.ok) await tellCitizen(db, r.sharedDiagnosticId, deps.sendMail || defaultSendMail, to === 'DECLINED' ? 'Votre orientation n’a pas été acceptée' : 'Votre orientation est en cours d’examen',
      to === 'DECLINED'
        ? `La structure proposée ne peut pas vous accompagner ; elle n’a plus accès à votre dossier. La structure qui vous accompagne peut vous proposer une autre orientation. Détails dans Mon Espace : ${buildAppUrl('/compte/orientations')}`
        : `La structure proposée a demandé des précisions à la structure qui vous accompagne avant de répondre. Suivez votre orientation dans Mon Espace : ${buildAppUrl('/compte/orientations')}`);
    return out;
  }
  if (receiver && action === 'link_appointment') {
    const [a] = await db.select({ id: ProAppointment.id }).from(ProAppointment).where(and(eq(ProAppointment.id, String(input.appointmentId || '')), eq(ProAppointment.structureId, ctx.structureId))).limit(1);
    if (!a) return bad('INVALID_APPOINTMENT', 'Rendez-vous introuvable dans votre structure.', 400);
    const done = await transition(db, r.id, ['ACCEPTED', 'IN_PROGRESS'], { appointmentId: a.id, status: 'IN_PROGRESS' }, receiverGrant);
    if (!done) return bad('INVALID_TRANSITION', 'Acceptez d’abord l’orientation.', 409);
    if (r.status !== 'IN_PROGRESS') await record(db, r, 'RECEIVER', ctx.userId, r.status, 'IN_PROGRESS');
    return { ok: true, status: 200, referral: { id: r.id, status: 'IN_PROGRESS', appointmentId: a.id } };
  }
  if (receiver && action === 'start') return go(['ACCEPTED'], { status: 'IN_PROGRESS' }, 'RECEIVER', 'IN_PROGRESS', receiverGrant);
  if (receiver && action === 'complete') {
    const outcome = String(input.outcome || ''); const summary = String(input.citizenSummary || '').trim();
    if (!OUTCOMES.includes(outcome)) return bad('INVALID_OUTCOME', 'Choisissez le résultat de l’accompagnement.');
    if (summary.length > 1000) return bad('INVALID_SUMMARY', 'Le message à la personne fait 1000 caractères au plus.');
    const out = await go(['ACCEPTED', 'IN_PROGRESS'], { status: 'COMPLETED', outcome, outcomeCitizenSummary: summary || null }, 'RECEIVER', 'COMPLETED', receiverGrant);
    if (out.ok) {
      await notifyOrg(db, r.fromStructureId, 'referral_completed', 'Orientation terminée', 'La structure destinataire a indiqué le résultat de l’accompagnement.', { referralId: r.id });
      await tellCitizen(db, r.sharedDiagnosticId, deps.sendMail || defaultSendMail, 'Votre accompagnement est terminé', `La structure a indiqué le résultat de votre accompagnement. Consultez-le dans Mon Espace : ${buildAppUrl('/compte/orientations')}`);
    }
    return out;
  }
  if (sender && action === 'reply') {
    if (!(await db.execute(sql`SELECT 1 AS ok WHERE ${activeGrantExists(r.sharedDiagnosticId, ctx)}`)).rows.length) return bad('NO_ACTIVE_ACCESS', 'Votre structure n’a plus accès à ce dossier : vous ne pouvez plus y ajouter de précisions.', 409);
    const msg = String(input.message || '').trim();
    if (msg.length < 5 || msg.length > 1500) return bad('INVALID_MESSAGE', 'Votre réponse doit faire 5 à 1500 caractères.');
    const out = await go(['NEEDS_INFO'], { status: 'SENT', messageEncrypted: sealText(msg, ctxOf(r.id)), dueAt: new Date(now.getTime() + ACK_DAYS * day), overdueNotifiedAt: null }, 'SENDER', 'SENT');
    if (out.ok) await notifyOrg(db, r.toStructureId, 'referral_reply', 'Précisions reçues', 'La structure d’origine a répondu à votre demande de précisions.', { referralId: r.id });
    return out;
  }
  if (sender && action === 'cancel') {
    const out = await go(['DRAFT', 'PENDING_CITIZEN', 'SENT', 'ACKNOWLEDGED', 'NEEDS_INFO'], { status: 'CANCELLED', closedAt: now }, 'SENDER', 'CANCELLED', senderCase);
    if (out.ok) { await revokeReferralGrant(db, r); if (!['DRAFT', 'PENDING_CITIZEN'].includes(r.status)) await notifyOrg(db, r.toStructureId, 'referral_cancelled', 'Orientation annulée', 'La structure d’origine a annulé l’orientation.', { referralId: r.id }); }
    return out;
  }
  if ((sender || (receiver && isAdmin(ctx))) && action === 'close') return go(['COMPLETED', 'DECLINED', 'EXPIRED'], { status: 'CLOSED', closedAt: now }, sender ? 'SENDER' : 'RECEIVER', 'CLOSED', sender ? senderCase : sql`TRUE`);
  return bad('INVALID_ACTION', 'Action inconnue ou non autorisée pour votre structure.', 400);
}

/** Cron: notify the sender once when the receiver has not answered by the due date; expire (and revoke the referral grant) EXPIRE_AFTER_DUE_DAYS later. */
export async function runReferralTimeouts({ now = new Date() } = {}, db = defaultDb) {
  const summary = { overdueNotified: 0, expired: 0 };
  const overdue = await db.update(Referral).set({ overdueNotifiedAt: now })
    .where(and(inArray(Referral.status, ['SENT', 'ACKNOWLEDGED']), sql`${Referral.dueAt} < ${now}`, sql`${Referral.overdueNotifiedAt} IS NULL`)).returning();
  for (const r of overdue) { summary.overdueNotified += 1; await notifyOrg(db, r.fromStructureId, 'referral_overdue', 'Orientation sans réponse', 'Une orientation n’a pas reçu de réponse dans le délai prévu.', { referralId: r.id }); }
  const limit = new Date(now.getTime() - EXPIRE_AFTER_DUE_DAYS * day);
  const expired = await db.update(Referral).set({ status: 'EXPIRED', closedAt: now })
    .where(and(inArray(Referral.status, ['SENT', 'ACKNOWLEDGED', 'NEEDS_INFO']), sql`${Referral.dueAt} < ${limit}`)).returning();
  for (const r of expired) { summary.expired += 1; await record(db, r, 'SYSTEM', null, null, 'EXPIRED'); await revokeReferralGrant(db, r); await notifyOrg(db, r.fromStructureId, 'referral_expired', 'Orientation expirée', 'Une orientation a expiré sans réponse ; l’accès de la structure destinataire est retiré.', { referralId: r.id }); }
  return summary;
}
