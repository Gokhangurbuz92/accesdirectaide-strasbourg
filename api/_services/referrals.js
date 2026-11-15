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
import { AuditLog, ProCase, ProCaseEvent, ProAppointment, Referral, ReferralEvent, SharedDossierGrant } from '../../src/db/schema.js';
import { activeGrantExists, activeMemberSql, caseAccessSql, REFERRAL_AWAITING_ANSWER_STATUSES, REFERRAL_EXPIRE_AFTER_DUE_DAYS } from '../_utils/share-access.js';
import { openText, sealText } from '../lib/data-keys.js';
import { OUTCOMES, ensureCase, isAdmin } from './pro-cases.js';
import { mailLedgerStatus, sendMail as defaultSendMail } from '../_utils/mailer.js';
import { canNotify } from './citizen-account.js';
import { isDossierRestricted } from './processing-restriction.js';
import { buildAppUrl } from '../_utils/user-auth.js';
import { logger } from '../lib/logger.js';

export const REASONS = ['SPECIALISED_SUPPORT', 'ACCESS_TO_RIGHTS', 'HOUSING', 'EMPLOYMENT', 'HEALTH', 'FOOD_AID', 'DIGITAL_SUPPORT', 'LEGAL', 'OTHER'];
export const RESPONSES = ['OUT_OF_SCOPE', 'NO_CAPACITY', 'ALREADY_SUPPORTED', 'NEEDS_MORE_INFORMATION', 'OTHER'];
export const ACK_DAYS = 5;
export const EXPIRE_AFTER_DUE_DAYS = REFERRAL_EXPIRE_AFTER_DUE_DAYS;   // R40: one value, also applied by the access checks (share-access.js)
/** G4: waiting for an answer against the due date — the ONE list behind the « overdue » flag, the overdue notice and the expiry (share-access.js) */
export const AWAITING_ANSWER_STATUSES = REFERRAL_AWAITING_ANSWER_STATUSES;
/** G1: the states in which the receiver holds (or may hold) the access the person authorized — closed when the person withdraws that access */
export const LIVE_AFTER_CONSENT_STATUSES = Object.freeze(['SENT', 'ACKNOWLEDGED', 'NEEDS_INFO', 'ACCEPTED', 'IN_PROGRESS']);
/** G2: a proposal the person has not answered is closed after this many days (nothing was shared; the sender may propose again) */
export const PENDING_CITIZEN_EXPIRE_DAYS = 30;
/** G4: an ACCEPTED referral with no step recorded after this many days is FLAGGED in the lists (human follow-up only: nothing is changed or claimed) */
export const ACCEPTED_NO_PROGRESS_DAYS = 14;
const day = 86400000;
const inList = (values) => sql.join(values.map((v) => sql`${v}`), sql`, `);
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
  // G2: only the dossier's owner can decide, from a verified account. Without one the proposal could never be answered (it used to be created, 201, and to
  // wait forever): refused, nothing is written.
  if (!(await db.execute(sql`SELECT 1 AS ok FROM "SharedDiagnostic" d JOIN "CitizenUser" u ON u.id = d."ownerCitizenId" WHERE d.id = ${c.sharedDiagnosticId} AND u."emailVerifiedAt" IS NOT NULL`)).rows.length) {
    return bad('NO_CITIZEN_ACCOUNT', 'Cette orientation ne peut pas être proposée : le dossier n’est rattaché à aucun compte vérifié, personne ne pourrait donner son accord.', 409);
  }
  const id = crypto.randomUUID();
  const rows = await db.insert(Referral).values({ id, sharedDiagnosticId: c.sharedDiagnosticId, fromStructureId: ctx.structureId, toStructureId, fromCaseId: c.id, createdByProUserId: ctx.userId,
    status: 'PENDING_CITIZEN', reasonCode, messageEncrypted: message ? sealText(message, ctxOf(id)) : null, idempotencyKey: key }).onConflictDoNothing().returning();
  if (!rows.length) return bad('ALREADY_REFERRED', 'Une orientation vers cette structure est déjà en cours pour ce dossier.', 409);
  await record(db, rows[0], 'SENDER', ctx.userId, null, 'PENDING_CITIZEN');
  await db.insert(ProCaseEvent).values({ caseId: c.id, structureId: c.structureId, actorProUserId: ctx.userId, kind: 'REFERRAL', toValue: 'PENDING_CITIZEN' });
  const notice = await tellCitizen(db, rows[0], deps.sendMail || defaultSendMail, 'Une proposition d’orientation attend votre accord',
    `Une structure qui vous accompagne propose de transmettre votre dossier à ${target.name}. Rien n’est transmis sans votre accord.\nDécidez depuis Mon Espace : ${buildAppUrl('/compte/orientations')}`, 'PENDING_CITIZEN');
  // G2: the sender learns whether an e-mail left (the proposal is in Mon Espace either way) instead of an unconditional « the person is told »
  return { ok: true, status: 201, referral: { id, status: 'PENDING_CITIZEN', to: target.name, citizenNotified: ['PROVIDER_ACCEPTED', 'TEST_RECORDED'].includes(notice) } };
}

/**
 * The person's e-mail about their referral (best effort: the decision is in Mon Espace anyway). R40: the outcome of each notice is written to AuditLog
 * (REFERRAL_CITIZEN_NOTICE: the referral id, the kind, the outcome — no address, no text): NO_RECIPIENT (no verified owner account), NO_CONSENT (service
 * e-mails off, or processing restricted), PROVIDER_ACCEPTED (a real provider took it — not proof it arrived), TEST_RECORDED (the LAB outbox), NOT_DELIVERED
 * (noop or refused: never counted as sent), FAILED (an error). Before, nothing was recorded and a noop « accepted » looked like a sent notice.
 */
export async function tellCitizen(db, referral, sendMail, subject, text, kind) {
  let outcome = 'FAILED';
  try {
    const [o] = (await db.execute(sql`SELECT u.id, u.email FROM "SharedDiagnostic" d JOIN "CitizenUser" u ON u.id = d."ownerCitizenId" WHERE d.id = ${referral.sharedDiagnosticId} AND u."emailVerifiedAt" IS NOT NULL`)).rows;
    if (!o) outcome = 'NO_RECIPIENT';
    else if (!(await canNotify(o.id, 'email', 'service', db).catch(() => false))) outcome = 'NO_CONSENT';
    else outcome = mailLedgerStatus(await sendMail({ to: o.email, subject, text, category: 'referral' }));
  } catch { outcome = 'FAILED'; }
  await db.insert(AuditLog).values({ action: 'REFERRAL_CITIZEN_NOTICE', actor: 'system', entity: 'Referral', entity_id: referral.id, details: { kind, outcome } }).catch(() => {});
  return outcome;
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
      r."sharedDiagnosticId" AS "dossierId", sf.nom AS "fromName", st.nom AS "toName", (r."dueAt" < NOW() AND r.status IN (${inList(AWAITING_ANSWER_STATUSES)})) AS overdue,
      (r.status = 'ACCEPTED' AND r."respondedAt" < NOW() - make_interval(days => ${ACCEPTED_NO_PROGRESS_DAYS})) AS stalled${inbox ? sql`` : sql`, (${caseAccessSql(sql`r."sharedDiagnosticId"`, ctx)}) AS "caseOpen"`}
    FROM "Referral" r JOIN "Structure" sf ON sf.id = r."fromStructureId" JOIN "Structure" st ON st.id = r."toStructureId"
    WHERE ${inbox ? sql`r."toStructureId" = ${ctx.structureId} AND r.status NOT IN ('DRAFT', 'PENDING_CITIZEN') AND r."sentAt" IS NOT NULL` : sql`r."fromStructureId" = ${ctx.structureId}`}
    ORDER BY r."createdAt" DESC LIMIT 200`)).rows;
  // R14: the receiver gets the dossier link only while its grant is active (as getReferral) — the inbox used to list it for a revoked or restricted dossier too
  if (inbox) {
    const open = new Map();
    for (const id of new Set(rows.map((x) => x.dossierId).filter(Boolean))) open.set(id, (await db.execute(sql`SELECT 1 AS ok WHERE ${activeGrantExists(id, ctx)}`)).rows.length > 0);
    for (const x of rows) if (!open.get(x.dossierId)) x.dossierId = null;
  } else {
    // G8: in the sending organization, a referral of a case assigned to a colleague shows its state only — not which dossier it is, nor the reason (the
    // PKG-4 assignment rule, as everywhere else)
    for (const x of rows) { if (!x.caseOpen) { x.dossierId = null; x.reasonCode = null; } delete x.caseOpen; }
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
  // G8: a sender-side colleague who may not open the case (assigned to someone else) sees the state and the dates only
  const caseOpen = side === 'RECEIVER' ? true : (await db.execute(sql`SELECT 1 AS ok WHERE ${caseAccessSql(r.sharedDiagnosticId, ctx)}`)).rows.length > 0;
  let appointment = null;
  if (r.appointmentId) {
    const [a] = await db.select({ startAt: ProAppointment.startAt, mode: ProAppointment.mode, status: ProAppointment.status }).from(ProAppointment).where(eq(ProAppointment.id, r.appointmentId)).limit(1);
    appointment = a || null;
  }
  return { ok: true, status: 200, side, referral: { id: r.id, status: r.status, reasonCode: caseOpen ? r.reasonCode : null, from: nameOf(r.fromStructureId), to: nameOf(r.toStructureId),
    message: textsOpen && r.messageEncrypted ? openText(r.messageEncrypted, ctxOf(r.id)) : '', responseCode: r.responseCode,
    responseMessage: textsOpen && r.responseMessageEncrypted ? openText(r.responseMessageEncrypted, ctxOf(r.id)) : '', textsHidden: !textsOpen, outcome: r.outcome, outcomeSummary: caseOpen ? r.outcomeCitizenSummary : null,
    createdAt: r.createdAt, sentAt: r.sentAt, dueAt: r.dueAt, acknowledgedAt: r.acknowledgedAt, respondedAt: r.respondedAt, closedAt: r.closedAt, appointment,
    dossierId: side === 'RECEIVER' && dossierOpen ? r.sharedDiagnosticId : side === 'SENDER' && caseOpen ? r.sharedDiagnosticId : null },
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
      await tellCitizen(db, r, deps.sendMail || defaultSendMail, 'Votre orientation a été acceptée', `La structure destinataire a accepté de vous accompagner. Suivez-la depuis Mon Espace : ${buildAppUrl('/compte/orientations')}`, 'ACCEPTED');
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
    if (out.ok) await tellCitizen(db, r, deps.sendMail || defaultSendMail, to === 'DECLINED' ? 'Votre orientation n’a pas été acceptée' : 'Votre orientation est en cours d’examen',
      to === 'DECLINED'
        ? `La structure proposée ne peut pas vous accompagner ; elle n’a plus accès à votre dossier. La structure qui vous accompagne peut vous proposer une autre orientation. Détails dans Mon Espace : ${buildAppUrl('/compte/orientations')}`
        : `La structure proposée a demandé des précisions à la structure qui vous accompagne avant de répondre. Suivez votre orientation dans Mon Espace : ${buildAppUrl('/compte/orientations')}`, to);
    return out;
  }
  if (receiver && action === 'link_appointment') {
    // G8: the appointment must be the receiver's AND the one of the person this dossier belongs to (before: any appointment of the structure, so another
    // person's appointment could be attached to this referral). Appointments carry no dossier id: the link is the owner's account.
    const [a] = (await db.execute(sql`SELECT a.id FROM "ProAppointment" a JOIN "SharedDiagnostic" d ON d.id = ${r.sharedDiagnosticId}
      WHERE a.id = ${String(input.appointmentId || '')} AND a."structureId" = ${ctx.structureId} AND a."citizenUserId" IS NOT NULL AND a."citizenUserId" = d."ownerCitizenId"`)).rows;
    if (!a) return bad('INVALID_APPOINTMENT', 'Rendez-vous introuvable dans votre structure pour la personne concernée par cette orientation.', 400);
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
      await tellCitizen(db, r, deps.sendMail || defaultSendMail, 'Votre accompagnement est terminé', `La structure a indiqué le résultat de votre accompagnement. Consultez-le dans Mon Espace : ${buildAppUrl('/compte/orientations')}`, 'COMPLETED');
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
    // G4: the person is told too (they were asked to decide, or had authorized the transmission) — no reason, no message
    if (out.ok) await tellCitizen(db, r, deps.sendMail || defaultSendMail, 'Une orientation a été annulée',
      `La structure qui vous accompagne a annulé l’orientation qu’elle avait proposée. ${r.sentAt ? 'L’accès ouvert par cette orientation est retiré.' : 'Rien n’a été transmis.'} Détails dans Mon Espace : ${buildAppUrl('/compte/orientations')}`, 'CANCELLED');
    return out;
  }
  if ((sender || (receiver && isAdmin(ctx))) && action === 'close') return go(['COMPLETED', 'DECLINED', 'EXPIRED'], { status: 'CLOSED', closedAt: now }, sender ? 'SENDER' : 'RECEIVER', 'CLOSED', sender ? senderCase : sql`TRUE`);
  return bad('INVALID_ACTION', 'Action inconnue ou non autorisée pour votre structure.', 400);
}

/**
 * G1 — the person withdrew the receiver's access (one organization: `structureId`; « stop sharing »: null = every organization). Called INSIDE the transaction
 * that revokes the grant: every referral still live towards that receiver ends as CANCELLED with the controlled outcome CITIZEN_WITHDREW and a ReferralEvent
 * (actor CITIZEN, no free text). Before, it stayed ACCEPTED / IN_PROGRESS for ever: the receiver could not complete it, the sender could not cancel it, the
 * cron ignored it and its live key refused any new referral to that organization. A proposal not yet authorized (PENDING_CITIZEN) shares nothing and stays
 * the person's to decide. Returns the closed referrals for notifyAccessWithdrawn (after COMMIT).
 * @param {any} tx @param {string} dossierId @param {string | null} [structureId] @param {string | null} [citizenId]
 * @returns {Promise<Array<{ id: string, fromStatus: string, fromStructureId: string, toStructureId: string }>>}
 */
export async function closeForWithdrawnAccess(tx, dossierId, structureId = null, citizenId = null) {
  const rows = (await tx.execute(sql`WITH live AS (SELECT id, status FROM "Referral" WHERE "sharedDiagnosticId" = ${dossierId} AND status IN (${inList(LIVE_AFTER_CONSENT_STATUSES)})
      ${structureId ? sql`AND "toStructureId" = ${structureId}` : sql``} FOR UPDATE)
    UPDATE "Referral" r SET status = 'CANCELLED', outcome = 'CITIZEN_WITHDREW', "closedAt" = NOW(), "updatedAt" = NOW() FROM live WHERE r.id = live.id
    RETURNING r.id, live.status AS "fromStatus", r."fromStructureId", r."toStructureId"`)).rows;
  for (const r of rows) await record(tx, r, 'CITIZEN', citizenId, r.fromStatus, 'CANCELLED');
  return rows;
}
/**
 * G1: both organizations are told through the professional notification catalogue (in-app always, e-mail per member preference) — after COMMIT, best effort.
 * @param {Array<{ id: string, fromStructureId: string, toStructureId: string }>} rows @param {any} [db]
 */
export async function notifyAccessWithdrawn(rows, db = defaultDb) {
  for (const r of rows || []) {
    await notifyOrg(db, r.fromStructureId, 'referral_cancelled', 'Orientation close : accès retiré par la personne', 'La personne a retiré l’accès de la structure destinataire à son dossier : l’orientation est close. Une nouvelle orientation reste possible avec son accord.', { referralId: r.id });
    await notifyOrg(db, r.toStructureId, 'referral_cancelled', 'Orientation close : accès retiré par la personne', 'La personne a retiré l’accès de votre structure à son dossier : l’orientation est close.', { referralId: r.id });
  }
}

/**
 * G6 — departure of a member: the proposals they made that still wait for the person go to the successor, or to the administrator who records the departure
 * when no successor is named (an active member of the organization in both cases — otherwise nothing changes). Before, the person's « accept » failed with
 * SENDER_GONE and the proposal stayed pending. Called in the transaction that disables the account; each change is a ReferralEvent (actor SENDER).
 * @param {string} leavingUserId @param {string | null} successorUserId @param {{ userId: string, structureId: string, role?: string }} ctx @param {any} [db]
 * @returns {Promise<number>}
 */
export async function handOverProposals(leavingUserId, successorUserId, ctx, db = defaultDb) {
  const heir = successorUserId || ctx.userId;
  if (!heir || heir === leavingUserId || !(await db.execute(sql`SELECT 1 AS ok WHERE ${activeMemberSql({ userId: heir, structureId: ctx.structureId })}`)).rows.length) return 0;
  const rows = await db.update(Referral).set({ createdByProUserId: heir })
    .where(and(eq(Referral.fromStructureId, ctx.structureId), eq(Referral.createdByProUserId, leavingUserId), inArray(Referral.status, ['DRAFT', 'PENDING_CITIZEN']))).returning({ id: Referral.id, status: Referral.status });
  for (const r of rows) await record(db, r, 'SENDER', ctx.userId, r.status, r.status);
  return rows.length;
}

/** Cron: notify the sender once when the receiver has not answered by the due date; expire (and revoke the referral grant) EXPIRE_AFTER_DUE_DAYS later. */
/** R39: how often an organization notice of a timeout is tried before it is given up (one try per daily run) */
export const NOTICE_MAX_ATTEMPTS = 5;
const NOTICE_TEXT = {
  overdue: ['referral_overdue', 'Orientation sans réponse', 'Une orientation n’a pas reçu de réponse dans le délai prévu.'],
  expired: ['referral_expired', 'Orientation expirée', 'Une orientation a expiré sans réponse ; l’accès de la structure destinataire est retiré.'],
  // G2: a proposal the person never answered (same catalogue event: no new e-mail type)
  citizen_unanswered: ['referral_expired', 'Orientation sans accord de la personne', `Une orientation proposée n’a pas reçu l’accord de la personne en ${PENDING_CITIZEN_EXPIRE_DAYS} jours : elle est close, rien n’a été transmis. Vous pouvez la proposer à nouveau.`],
};
/**
 * R39 — one organization notice, classified: DELIVERED (at least one member's in-app notice stored), NO_RECIPIENT (no active member: permanent, never
 * retried), FAILED (members exist but nothing was stored: retryable). E-mail stays per member preference (pro-notifications); « accepted » by a noop mailer
 * is never counted here — the in-app notice is the delivery. Each try is written to AuditLog (no personal data: the referral id, the kind, the outcome).
 */
async function deliverTimeoutNotice(db, r, kind, notifyImpl) {
  const [type, title, message] = NOTICE_TEXT[kind];
  let sum = null;
  try { sum = await notifyImpl({ structureId: r.fromStructureId, to: 'members', type, title, message, metadata: { referralId: r.id } }); } catch { sum = null; }
  const recipients = sum ? Object.values(sum.email || {}).reduce((a, b) => a + Number(b || 0), 0) : null;
  const outcome = sum && sum.inApp > 0 ? 'DELIVERED' : sum && recipients === 0 ? 'NO_RECIPIENT' : 'FAILED';
  const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'REFERRAL_TIMEOUT_NOTICE' AND entity_id = ${r.id} AND details->>'kind' = ${kind}`)).rows;
  const attempt = Number(n || 0) + 1;
  await db.insert(AuditLog).values({ action: 'REFERRAL_TIMEOUT_NOTICE', actor: 'cron', entity: 'Referral', entity_id: r.id, details: { kind, outcome, attempt } }).catch(() => {});
  return { outcome, attempt };
}

/**
 * Referral acknowledgement timeouts (cron). R39: one run at a time (a Postgres advisory lock held for the run), the sender is told when a referral is
 * overdue — the flag is set by a claim and given back when the notice could not be stored, so a later run tries again (at most NOTICE_MAX_ATTEMPTS, then the
 * failure is logged and the flag kept); the expiry, its ledger entry and the revocation of the receiver's access are ONE transaction (a referral can no longer
 * be « expired » while the receiving organization keeps the dossier); a failed expiry notice is retried on the next runs within the same bound.
 */
export async function runReferralTimeouts({ now = new Date(), notifyImpl = null, sendMail = defaultSendMail } = {}, db = defaultDb) {
  const notify = notifyImpl || (async (args) => (await import('./pro-notifications.js')).notify(args));
  const summary = { overdueNotified: 0, overdueNoRecipient: 0, overdueRetry: 0, overdueAbandoned: 0, expired: 0, expiredNoticeFailed: 0, expiredNoticeRetried: 0, pendingCitizenExpired: 0, pendingCitizenNoticeFailed: 0 };
  return db.transaction(async (lockTx) => {
    const [lock] = (await lockTx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext('ada:referral-timeouts')) AS ok`)).rows;
    if (!lock?.ok) return { ...summary, skipped: 'ALREADY_RUNNING' };
    // 1. overdue: claim, notify, give the claim back when the notice could not be stored
    const due = await db.select().from(Referral)
      .where(and(inArray(Referral.status, [...AWAITING_ANSWER_STATUSES]), sql`${Referral.dueAt} < ${now}`, sql`${Referral.overdueNotifiedAt} IS NULL`));
    for (const c of due) {
      const [r] = await db.update(Referral).set({ overdueNotifiedAt: now }).where(and(eq(Referral.id, c.id), sql`${Referral.overdueNotifiedAt} IS NULL`)).returning();
      if (!r) continue;
      const { outcome, attempt } = await deliverTimeoutNotice(db, r, 'overdue', notify);
      if (outcome === 'DELIVERED') summary.overdueNotified += 1;
      else if (outcome === 'NO_RECIPIENT') summary.overdueNoRecipient += 1;
      else if (attempt < NOTICE_MAX_ATTEMPTS) {
        await db.update(Referral).set({ overdueNotifiedAt: null }).where(and(eq(Referral.id, r.id), eq(Referral.overdueNotifiedAt, now)));
        summary.overdueRetry += 1;
      } else { summary.overdueAbandoned += 1; logger.error({ referralId: r.id, attempts: attempt }, '[referrals] overdue notice given up'); }
    }
    // 2. expiry: status, ledger and access revocation together
    const limit = new Date(now.getTime() - EXPIRE_AFTER_DUE_DAYS * day);
    const failedNow = new Set();
    const stale = await db.select({ id: Referral.id }).from(Referral).where(and(inArray(Referral.status, [...AWAITING_ANSWER_STATUSES]), sql`${Referral.dueAt} < ${limit}`));
    for (const { id } of stale) {
      const r = await db.transaction(async (tx) => {
        const row = await transition(tx, id, [...AWAITING_ANSWER_STATUSES], { status: 'EXPIRED', closedAt: now }, sql`${Referral.dueAt} < ${limit}`);
        if (!row) return null;
        await record(tx, row, 'SYSTEM', null, null, 'EXPIRED');
        await revokeReferralGrant(tx, row);
        return row;
      });
      if (!r) continue;
      summary.expired += 1;
      const { outcome } = await deliverTimeoutNotice(db, r, 'expired', notify);
      if (outcome === 'FAILED') { summary.expiredNoticeFailed += 1; failedNow.add(r.id); }
      // G4: the person is told as well (best effort, recorded in AuditLog like every notice to them) — before, only the sending organization was
      await tellCitizen(db, r, sendMail, 'Votre orientation n’a pas reçu de réponse',
        `La structure proposée n’a pas répondu dans le délai prévu : l’orientation est close et l’accès ouvert par cette orientation est retiré. La structure qui vous accompagne peut vous proposer une autre orientation. Détails dans Mon Espace : ${buildAppUrl('/compte/orientations')}`, 'EXPIRED');
    }
    // 2b. G2: a proposal the person has not answered for PENDING_CITIZEN_EXPIRE_DAYS is closed (before: it waited forever and kept the live key, so the
    // sender could not propose again). Nothing was shared, so there is no access to revoke; the state is CANCELLED by SYSTEM — the database reserves
    // EXPIRED for a referral that was sent (Referral_sent_needs_citizen_check). The sender and the person are told.
    const pendingLimit = new Date(now.getTime() - PENDING_CITIZEN_EXPIRE_DAYS * day);
    const unanswered = await db.select({ id: Referral.id }).from(Referral).where(and(eq(Referral.status, 'PENDING_CITIZEN'), sql`${Referral.createdAt} < ${pendingLimit}`));
    for (const { id } of unanswered) {
      const r = await db.transaction(async (tx) => {
        const row = await transition(tx, id, ['PENDING_CITIZEN'], { status: 'CANCELLED', closedAt: now }, sql`${Referral.createdAt} < ${pendingLimit}`);
        if (!row) return null;
        await record(tx, row, 'SYSTEM', null, 'PENDING_CITIZEN', 'CANCELLED');
        return row;
      });
      if (!r) continue;
      summary.pendingCitizenExpired += 1;
      const { outcome } = await deliverTimeoutNotice(db, r, 'citizen_unanswered', notify);
      if (outcome === 'FAILED') { summary.pendingCitizenNoticeFailed += 1; failedNow.add(r.id); }
      await tellCitizen(db, r, sendMail, 'Une proposition d’orientation n’est plus valable',
        `Une proposition d’orientation est restée sans réponse de votre part pendant ${PENDING_CITIZEN_EXPIRE_DAYS} jours : elle est close et rien n’a été transmis. La structure qui vous accompagne peut vous la proposer à nouveau. Détails dans Mon Espace : ${buildAppUrl('/compte/orientations')}`, 'PENDING_EXPIRED');
    }
    // 3. timeout notices that failed before: tried again (same bound), never once one was stored or there was no recipient
    for (const [kind, status] of [['expired', 'EXPIRED'], ['citizen_unanswered', 'CANCELLED']]) {
      const pending = (await db.execute(sql`SELECT r.id FROM "Referral" r WHERE r.status = ${status}
        AND EXISTS (SELECT 1 FROM "AuditLog" a WHERE a.action = 'REFERRAL_TIMEOUT_NOTICE' AND a.entity_id = r.id AND a.details->>'kind' = ${kind} AND a.details->>'outcome' = 'FAILED')
        AND NOT EXISTS (SELECT 1 FROM "AuditLog" a WHERE a.action = 'REFERRAL_TIMEOUT_NOTICE' AND a.entity_id = r.id AND a.details->>'kind' = ${kind} AND a.details->>'outcome' IN ('DELIVERED', 'NO_RECIPIENT'))
        AND (SELECT count(*) FROM "AuditLog" a WHERE a.action = 'REFERRAL_TIMEOUT_NOTICE' AND a.entity_id = r.id AND a.details->>'kind' = ${kind}) < ${NOTICE_MAX_ATTEMPTS}`)).rows;
      for (const { id } of pending) {
        if (failedNow.has(id)) continue;   // just tried in this run: the next run tries again
        const [r] = await db.select().from(Referral).where(eq(Referral.id, id)).limit(1);
        if (!r) continue;
        await deliverTimeoutNotice(db, r, kind, notify);
        summary.expiredNoticeRetried += 1;
      }
    }
    return summary;
  });
}
