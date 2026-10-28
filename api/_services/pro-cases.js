// @ts-nocheck
/**
 * PKG-4 / R03 R06 R07 R08 R11 R12 — ADA Pro case work inside ONE organization.
 * A case exists only while the organization holds the citizen's grant on the dossier (the citizen decides; membership alone opens nothing). Inside the organization an
 * unassigned case is the triage queue; an assigned case is opened by its assignee and the organization's administrators only (share-access caseAccessSql — the SAME rule
 * protects the dossier, files, messages, exports). Every check is a SQL predicate evaluated with the read or inside the UPDATE (no check-then-act race).
 * Internal notes never leave the organization; citizen-visible notes and the outcome summary are the only texts the person sees. History is append-only.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { ProCase, ProCaseEvent, ProCaseNote, ProUser } from '../../src/db/schema.js';
import { activeGrantExists, activeMemberSql } from '../_utils/share-access.js';
import { restrictedDossierSql } from './processing-restriction.js';
import { openText, sealText } from '../lib/data-keys.js';

export const CASE_STATUSES = ['NEW', 'IN_PROGRESS', 'WAITING_CITIZEN', 'WAITING_PARTNER', 'REFERRED', 'CLOSED'];
export const OUTCOMES = ['SUPPORT_COMPLETED', 'APPLICATION_FILED', 'INFORMATION_PROVIDED', 'REFERRED_ELSEWHERE', 'CITIZEN_WITHDREW', 'NO_RESPONSE', 'OTHER'];
const OPEN_STATUSES = CASE_STATUSES.filter((s) => s !== 'CLOSED');
const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
const notFound = () => bad('not_found', 'Dossier introuvable.', 404);
export const isAdmin = (ctx) => ['structure_admin', 'STRUCTURE_ADMIN'].includes(String(ctx.role || ''));

async function event(db, c, ctx, kind, fromValue = null, toValue = null) {
  await db.insert(ProCaseEvent).values({ caseId: c.id, structureId: c.structureId, actorProUserId: ctx?.userId || null, kind, fromValue, toValue });
}

/** Open (or find) the organization's case on a dossier it holds a grant for. Idempotent. */
export async function ensureCase(dossierId, ctx, db = defaultDb) {
  const [granted] = (await db.execute(sql`SELECT 1 AS ok WHERE EXISTS (SELECT 1 FROM "SharedDossierGrant" g WHERE g."sharedDiagnosticId" = ${dossierId} AND g."structureId" = ${ctx.structureId} AND g."revokedAt" IS NULL) AND ${activeMemberSql(ctx)}`)).rows;
  if (!granted) return null;
  const rows = await db.insert(ProCase).values({ sharedDiagnosticId: dossierId, structureId: ctx.structureId }).onConflictDoNothing({ target: [ProCase.sharedDiagnosticId, ProCase.structureId] }).returning();
  if (rows.length) { await event(db, rows[0], ctx, 'OPENED', null, 'NEW'); return rows[0]; }
  const [c] = await db.select().from(ProCase).where(and(eq(ProCase.sharedDiagnosticId, dossierId), eq(ProCase.structureId, ctx.structureId))).limit(1);
  return c || null;
}

/** Materialize a case for every active grant of the organization that has none yet (new grants appear in the queue). */
export async function syncQueue(ctx, db = defaultDb) {
  const created = (await db.execute(sql`INSERT INTO "ProCase" (id, "sharedDiagnosticId", "structureId", status, "updatedAt")
    SELECT gen_random_uuid()::text, g."sharedDiagnosticId", g."structureId", 'NEW', NOW() FROM "SharedDossierGrant" g
    WHERE g."structureId" = ${ctx.structureId} AND g."revokedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM "ProCase" c WHERE c."sharedDiagnosticId" = g."sharedDiagnosticId" AND c."structureId" = g."structureId")
    ON CONFLICT DO NOTHING RETURNING id, "structureId"`)).rows;
  for (const r of created) await db.insert(ProCaseEvent).values({ caseId: r.id, structureId: r.structureId, kind: 'OPENED', toValue: 'NEW' });
  return created.length;
}

/** The organization's work queue (R18: a dossier under a restriction of processing, RGPD art. 18, is neither listed nor counted — it cannot be opened either). scope: 'mine' | 'unassigned' | 'all' (all = administrators). Metadata only — no dossier content, no note text. */
export async function listQueue(ctx, { scope = 'mine' } = {}, db = defaultDb) {
  const member = (await db.execute(sql`SELECT 1 AS ok WHERE ${activeMemberSql(ctx)}`)).rows.length > 0;
  if (!member) return bad('forbidden', 'Accès refusé.', 403);
  await syncQueue(ctx, db);
  const scopeSql = scope === 'unassigned' ? sql`c."assigneeProUserId" IS NULL`
    : scope === 'all' && isAdmin(ctx) ? sql`TRUE`
      : sql`c."assigneeProUserId" = ${ctx.userId}`;
  const rows = (await db.execute(sql`SELECT c.id, c."sharedDiagnosticId" AS "dossierId", c.status, c.outcome, c."assigneeProUserId" AS "assigneeId", u.email AS "assigneeEmail", c."openedAt", c."updatedAt", c."closedAt",
      (SELECT count(*)::int FROM "Referral" r WHERE r."fromCaseId" = c.id AND r.status NOT IN ('CANCELLED', 'CLOSED', 'EXPIRED')) AS "openReferrals"
    FROM "ProCase" c LEFT JOIN "ProUser" u ON u.id = c."assigneeProUserId"
    WHERE c."structureId" = ${ctx.structureId} AND ${scopeSql}
      AND EXISTS (SELECT 1 FROM "SharedDossierGrant" g WHERE g."sharedDiagnosticId" = c."sharedDiagnosticId" AND g."structureId" = c."structureId" AND g."revokedAt" IS NULL) AND NOT ${restrictedDossierSql(sql`c."sharedDiagnosticId"`)}
    ORDER BY (c.status = 'CLOSED'), c."updatedAt" DESC LIMIT 200`)).rows;
  const [{ mine, unassigned }] = (await db.execute(sql`SELECT count(*) FILTER (WHERE c."assigneeProUserId" = ${ctx.userId} AND c.status <> 'CLOSED')::int AS mine,
      count(*) FILTER (WHERE c."assigneeProUserId" IS NULL AND c.status <> 'CLOSED')::int AS unassigned
    FROM "ProCase" c WHERE c."structureId" = ${ctx.structureId} AND EXISTS (SELECT 1 FROM "SharedDossierGrant" g WHERE g."sharedDiagnosticId" = c."sharedDiagnosticId" AND g."structureId" = c."structureId" AND g."revokedAt" IS NULL) AND NOT ${restrictedDossierSql(sql`c."sharedDiagnosticId"`)}`)).rows;
  return { ok: true, status: 200, scope: scope === 'all' && !isAdmin(ctx) ? 'mine' : scope, cases: rows, counts: { mine, unassigned } };
}

/** A case the caller may open (grant + active member + assignment rule), else null. */
async function openCase(id, ctx, db) {
  const [c] = await db.select().from(ProCase).where(and(eq(ProCase.id, String(id || '')), eq(ProCase.structureId, ctx.structureId))).limit(1);
  if (!c) return null;
  const [ok] = (await db.execute(sql`SELECT 1 AS ok WHERE ${activeGrantExists(c.sharedDiagnosticId, ctx)}`)).rows;
  return ok ? c : null;
}

export async function getCase(id, ctx, db = defaultDb) {
  const c = await openCase(id, ctx, db);
  if (!c) return notFound();
  const events = await db.select({ kind: ProCaseEvent.kind, fromValue: ProCaseEvent.fromValue, toValue: ProCaseEvent.toValue, at: ProCaseEvent.createdAt, actorId: ProCaseEvent.actorProUserId })
    .from(ProCaseEvent).where(eq(ProCaseEvent.caseId, c.id)).orderBy(desc(ProCaseEvent.createdAt)).limit(200);
  const notes = await db.select().from(ProCaseNote).where(eq(ProCaseNote.caseId, c.id)).orderBy(desc(ProCaseNote.createdAt)).limit(200);
  const members = (await db.execute(sql`SELECT id, email, role FROM "ProUser" WHERE "structureId" = ${ctx.structureId} AND status = 'active' AND upper(role) IN ('PRO', 'STRUCTURE_ADMIN') ORDER BY email`)).rows;
  const assignee = members.find((m) => m.id === c.assigneeProUserId) || (c.assigneeProUserId ? { id: c.assigneeProUserId, email: '(compte inactif)' } : null);
  return { ok: true, status: 200, case: { id: c.id, dossierId: c.sharedDiagnosticId, status: c.status, outcome: c.outcome, outcomeCitizenSummary: c.outcomeCitizenSummary, openedAt: c.openedAt, closedAt: c.closedAt, assignee },
    notes: notes.map((n) => ({ id: n.id, visibility: n.visibility, body: openText(n.bodyEncrypted, { purpose: 'case-note', context: `case:${c.id}` }), authorId: n.authorProUserId, mentions: n.mentions, at: n.createdAt })),
    events, members: members.map((m) => ({ id: m.id, email: m.email, role: m.role })), canAssignOthers: isAdmin(ctx) };
}

/**
 * Assign / reassign / hand over. Administrators assign any active member of the organization (or nobody = back to the queue); a professional takes an UNASSIGNED case
 * for themself, or hands their own case to a colleague. The target must be an active member of the same organization (checked in the UPDATE).
 */
export async function assign(id, targetUserId, ctx, db = defaultDb) {
  const c = await openCase(id, ctx, db);
  if (!c) return notFound();
  if (c.status === 'CLOSED') return bad('CASE_CLOSED', 'Ce dossier est clôturé.', 409);
  const target = targetUserId ? String(targetUserId) : null;
  if (!isAdmin(ctx)) {
    const taking = target === ctx.userId && c.assigneeProUserId === null;
    const handing = c.assigneeProUserId === ctx.userId && target !== null;
    if (!taking && !handing) return bad('forbidden', 'Seul un responsable de la structure peut attribuer ce dossier à quelqu’un d’autre.', 403);
  }
  if (target) {
    const [ok] = (await db.execute(sql`SELECT 1 AS ok FROM "ProUser" WHERE id = ${target} AND "structureId" = ${ctx.structureId} AND status = 'active' AND upper(role) IN ('PRO', 'STRUCTURE_ADMIN')`)).rows;
    if (!ok) return bad('INVALID_ASSIGNEE', 'La personne choisie n’est pas un membre actif de la structure.', 400);
  }
  const rows = await db.update(ProCase).set({ assigneeProUserId: target, status: c.status === 'NEW' && target ? 'IN_PROGRESS' : c.status })
    .where(and(eq(ProCase.id, c.id), c.assigneeProUserId === null ? sql`${ProCase.assigneeProUserId} IS NULL` : eq(ProCase.assigneeProUserId, c.assigneeProUserId))).returning();
  if (!rows.length) return bad('CONFLICT', 'Ce dossier vient d’être attribué par quelqu’un d’autre. Rechargez la page.', 409);
  await event(db, c, ctx, !target ? 'UNASSIGNED' : c.assigneeProUserId ? 'HANDOVER' : 'ASSIGNED', c.assigneeProUserId, target);
  if (target && target !== ctx.userId) await notify(db, target, ctx.structureId, 'case_assigned', 'Un dossier vous a été attribué', 'Un dossier vous a été attribué dans votre file.', { caseId: c.id });
  return { ok: true, status: 200, case: { id: c.id, assigneeId: target, status: rows[0].status } };
}

export async function setStatus(id, status, ctx, db = defaultDb) {
  if (!OPEN_STATUSES.includes(status)) return bad('INVALID_STATUS', 'Statut inconnu (pour clôturer, indiquez un résultat).');
  const c = await openCase(id, ctx, db);
  if (!c) return notFound();
  if (c.status === 'CLOSED') return bad('CASE_CLOSED', 'Ce dossier est clôturé : rouvrez-le d’abord.', 409);
  if (c.status === status) return { ok: true, status: 200, case: { id: c.id, status } };
  const rows = await db.update(ProCase).set({ status }).where(and(eq(ProCase.id, c.id), eq(ProCase.status, c.status))).returning();
  if (!rows.length) return bad('CONFLICT', 'Le dossier a changé entre-temps. Rechargez la page.', 409);
  await event(db, c, ctx, 'STATUS', c.status, status);
  return { ok: true, status: 200, case: { id: c.id, status } };
}

export async function addNote(id, input, ctx, db = defaultDb) {
  const visibility = input?.visibility === 'CITIZEN' ? 'CITIZEN' : input?.visibility === 'INTERNAL' ? 'INTERNAL' : null;
  const body = String(input?.body || '').trim();
  if (!visibility) return bad('INVALID_VISIBILITY', 'Précisez si la note est interne à l’équipe ou visible par la personne.');
  if (body.length < 2 || body.length > 4000) return bad('INVALID_BODY', 'La note doit faire 2 à 4000 caractères.');
  const c = await openCase(id, ctx, db);
  if (!c) return notFound();
  // R12 (R06): a closed case takes no new note (its record is final; reopen it first) — before, notes could still be added, including notes shown to the person
  if (c.status === 'CLOSED') return bad('CASE_CLOSED', 'Ce dossier est clôturé : rouvrez-le pour ajouter une note.', 409);
  const wanted = [...new Set(Array.isArray(input?.mentions) ? input.mentions.map(String) : [])].slice(0, 10);
  const mentions = wanted.length ? (await db.select({ id: ProUser.id }).from(ProUser).where(and(inArray(ProUser.id, wanted), eq(ProUser.structureId, ctx.structureId), eq(ProUser.status, 'active')))).map((r) => r.id) : [];
  if (mentions.length !== wanted.length) return bad('INVALID_MENTION', 'Vous ne pouvez mentionner que des membres actifs de votre structure.');
  const [n] = await db.insert(ProCaseNote).values({ caseId: c.id, structureId: c.structureId, authorProUserId: ctx.userId, visibility, mentions,
    bodyEncrypted: sealText(body, { purpose: 'case-note', context: `case:${c.id}` }) }).returning();
  await event(db, c, ctx, visibility === 'CITIZEN' ? 'NOTE_CITIZEN' : 'NOTE_INTERNAL');
  for (const m of mentions) if (m !== ctx.userId) await notify(db, m, ctx.structureId, 'case_mention', 'Vous êtes mentionné·e sur un dossier', 'Un membre de votre équipe vous a mentionné·e dans une note.', { caseId: c.id });
  return { ok: true, status: 201, note: { id: n.id, visibility, at: n.createdAt } };
}

export async function close(id, input, ctx, db = defaultDb) {
  const outcome = String(input?.outcome || '');
  const summary = String(input?.citizenSummary || '').trim();
  if (!OUTCOMES.includes(outcome)) return bad('INVALID_OUTCOME', 'Choisissez le résultat de l’accompagnement.');
  if (summary.length > 1000) return bad('INVALID_SUMMARY', 'Le message à la personne fait 1000 caractères au plus.');
  const c = await openCase(id, ctx, db);
  if (!c) return notFound();
  const rows = await db.update(ProCase).set({ status: 'CLOSED', outcome, outcomeCitizenSummary: summary || null, closedAt: new Date() }).where(and(eq(ProCase.id, c.id), sql`${ProCase.status} <> 'CLOSED'`)).returning();
  if (!rows.length) return bad('CASE_CLOSED', 'Ce dossier est déjà clôturé.', 409);
  await event(db, c, ctx, 'OUTCOME', null, outcome);
  await event(db, c, ctx, 'CLOSED', c.status, 'CLOSED');
  return { ok: true, status: 200, case: { id: c.id, status: 'CLOSED', outcome } };
}

export async function reopen(id, ctx, db = defaultDb) {
  const c = await openCase(id, ctx, db);
  if (!c) return notFound();
  const rows = await db.update(ProCase).set({ status: 'IN_PROGRESS', closedAt: null, outcome: null, outcomeCitizenSummary: null }).where(and(eq(ProCase.id, c.id), eq(ProCase.status, 'CLOSED'))).returning();
  if (!rows.length) return bad('NOT_CLOSED', 'Ce dossier n’est pas clôturé.', 409);
  await event(db, c, ctx, 'REOPENED', 'CLOSED', 'IN_PROGRESS');
  return { ok: true, status: 200, case: { id: c.id, status: 'IN_PROGRESS' } };
}

/**
 * R12 — departure of a member: every OPEN case they hold goes to the successor (an active member of the same organization) or back to the queue. Called in the same
 * request that disables the account (sessions die at once through the per-request membership check). Returns the number of cases moved.
 */
export async function handOverAll(leavingUserId, successorUserId, ctx, db = defaultDb, { notice = true } = {}) {
  const cases = await db.select().from(ProCase).where(and(eq(ProCase.structureId, ctx.structureId), eq(ProCase.assigneeProUserId, leavingUserId), sql`${ProCase.status} <> 'CLOSED'`));
  for (const c of cases) {
    await db.update(ProCase).set({ assigneeProUserId: successorUserId || null }).where(eq(ProCase.id, c.id));
    await event(db, c, ctx, successorUserId ? 'HANDOVER' : 'UNASSIGNED', leavingUserId, successorUserId || null);
  }
  if (notice) await handoverNotice(successorUserId, ctx.structureId, cases.length);
  return cases.length;
}
/** The successor's notice — sent after the hand-over is committed (inside a transaction, pass { notice: false } and call this after COMMIT). */
export async function handoverNotice(successorUserId, structureId, count) {
  if (successorUserId && count) await notify(defaultDb, successorUserId, structureId, 'case_handover', 'Des dossiers vous ont été transmis', `${count} dossier(s) vous ont été transmis suite au départ d’un membre de l’équipe.`, {});
}

/** What the CITIZEN sees of the follow-ups on their own dossier: organization, status, outcome summary and the notes written FOR them. Never internal notes. */
export async function citizenFollowUps(ownerCitizenId, dossierId, db = defaultDb) {
  const rows = (await db.execute(sql`SELECT c.id, c.status, c.outcome, c."outcomeCitizenSummary" AS summary, c."openedAt", c."closedAt", s.nom AS organization
    FROM "ProCase" c JOIN "SharedDiagnostic" d ON d.id = c."sharedDiagnosticId" JOIN "Structure" s ON s.id = c."structureId"
    WHERE c."sharedDiagnosticId" = ${dossierId} AND d."ownerCitizenId" = ${ownerCitizenId} ORDER BY c."openedAt" DESC`)).rows;
  const out = [];
  for (const r of rows) {
    const notes = await db.select().from(ProCaseNote).where(and(eq(ProCaseNote.caseId, r.id), eq(ProCaseNote.visibility, 'CITIZEN'))).orderBy(desc(ProCaseNote.createdAt)).limit(50);
    out.push({ organization: r.organization, status: r.status, outcome: r.outcome, summary: r.summary, openedAt: r.openedAt, closedAt: r.closedAt,
      notes: notes.map((n) => ({ body: openText(n.bodyEncrypted, { purpose: 'case-note', context: `case:${r.id}` }), at: n.createdAt })) });
  }
  return out;
}

/** PKG-4 / R20: one member, through the catalogue (in-app always; e-mail per preference; honest delivery record). */
async function notify(db, userId, structureId, type, title, message, metadata) {
  try { const { notify: send } = await import('./pro-notifications.js'); await send({ structureId, to: [userId], type, title, message, metadata }); } catch { /* notices are best effort */ }
}
