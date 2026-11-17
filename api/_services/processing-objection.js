// @ts-nocheck
/**
 * A-20 — objection to processing (RGPD art. 21). Before: the right was declared (DSR_EXECUTION_POLICY.OBJECT, the « I objected and I am waiting » ground of the
 * restriction) but nothing created the request: the person had to write an e-mail.
 *
 * The request goes through the two mechanisms that already exist — no schema change, no new purpose, no new provider:
 *   - the rights-request register: one DSRRequest row (type OBJECT, status RECEIVED, HUMAN_REVIEW_REQUIRED as DSR_EXECUTION_POLICY says). It carries no free
 *     text; an open rights request also keeps the retention purge away from the person's records until it is answered;
 *   - the privacy queue the administrators already read: one SupportRequest of category PRIVACY (sealed text and contact, every read journaled), which names the
 *     register reference and holds what the person wrote about their situation (art. 21(1)) and the account's e-mail address to answer.
 * An objection is NOT applied automatically: whether the processing rests on a ground one can object to, and whether a compelling ground overrides it, is a
 * human decision. Nothing here says the objection is accepted — only that it is recorded and will be answered within one month (art. 12(3)). The person can
 * ask for the restriction of processing meanwhile (art. 18(1)(d), ground OBJECTION_PENDING), which applies at once.
 * One open objection per person: a second request while the first is open returns the first (no duplicates in the queue). Closing or answering the queue entry
 * completes the register row (support.js).
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';
import { createRequest as createSupportRequest } from './support.js';

export const REQUEST_TYPE = 'OBJECT';
export const OBJECTION_OPEN_STATUSES = Object.freeze(['RECEIVED', 'IN_REVIEW']);
export const MAX_OBJECTION_REASON = 1000;
const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
const lockSubject = (tx, citizenId) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'dsr-object:' + citizenId}))`);
const openStatuses = sql.join(OBJECTION_OPEN_STATUSES.map((s) => sql`${s}`), sql`, `);

async function latest(db, citizenId) {
  return (await db.execute(sql`SELECT id, status, "createdAt", "completedAt" FROM "DSRRequest" WHERE "requestType" = ${REQUEST_TYPE} AND "subjectId" = ${citizenId}
    ORDER BY "createdAt" DESC LIMIT 1`)).rows[0] || null;
}
const view = (r) => (r ? { id: r.id, status: OBJECTION_OPEN_STATUSES.includes(r.status) ? 'OPEN' : 'ANSWERED', since: r.createdAt, answeredAt: r.completedAt || null } : null);

/** The person's latest objection (open, or answered), for the settings page. */
export async function objectionState(citizenId, db = defaultDb) {
  return view(await latest(db, String(citizenId)));
}

/**
 * @param {{ id: string, email: string }} citizen the verified session
 * @param {{ reason?: unknown }} input `reason`: optional, what the person wants to say about their situation (sealed in the privacy queue, never in the register)
 */
export async function requestObjection(citizen, input, db = defaultDb) {
  const citizenId = String(citizen?.id || '');
  const reason = input?.reason === undefined || input?.reason === null ? '' : String(input.reason).trim();
  if (reason.length > MAX_OBJECTION_REASON) return bad('reason_too_long', `Votre explication est trop longue (${MAX_OBJECTION_REASON} caractères au plus).`);
  const out = await db.transaction(async (tx) => {
    await lockSubject(tx, citizenId);
    const cur = await latest(tx, citizenId);
    if (cur && OBJECTION_OPEN_STATUSES.includes(cur.status)) return { cur };
    const id = crypto.randomUUID();
    const text = `Demande d’opposition au traitement (RGPD, article 21) déposée depuis le compte. Référence du registre des droits : ${id}.`
      + (reason ? `\nCe que la personne indique : ${reason}` : '\nLa personne n’a pas ajouté d’explication.');
    const support = await createSupportRequest({ category: 'PRIVACY', message: text, contact: String(citizen.email || '') }, tx);
    if (!support.ok) throw new Error('objection: the privacy queue refused the request');   // nothing is recorded if the queue entry cannot be written
    await tx.execute(sql`INSERT INTO "DSRRequest" (id, "subjectType", "subjectId", "requestType", status, "executionMode", "affectedDomains", "reasonCode", "createdAt", "reviewOutcome")
      VALUES (${id}, 'CITIZEN_USER', ${citizenId}, ${REQUEST_TYPE}, 'RECEIVED', 'HUMAN_REVIEW_REQUIRED', '[]'::jsonb, ${reason ? 'PARTICULAR_SITUATION_STATED' : 'NO_REASON_STATED'}, NOW(),
        ${JSON.stringify({ requestedAt: new Date().toISOString(), article: '21', supportRequestId: support.id })}::jsonb)`);
    await tx.insert(AuditLog).values({ action: 'PROCESSING_OBJECTION_FILED', entity: 'DSR_REQUEST', entity_id: id, actor_id: 'subject', details: { requestId: id, supportRequestId: support.id, reasonGiven: Boolean(reason) }, ip_hash: 'CITIZEN' });
    return { id };
  });
  if (out.cur) return { ok: true, status: 200, objection: view(out.cur), alreadyOpen: true };
  return { ok: true, status: 201, objection: view(await latest(db, citizenId)) };
}

/** support.js: the privacy-queue entry of an objection was answered or closed → the register row is completed (same reference). @param {any} db @param {string} supportRequestId */
export async function completeObjectionOfSupportRequest(db, supportRequestId) {
  const rows = (await db.execute(sql`UPDATE "DSRRequest" SET status = 'COMPLETED', "completedAt" = NOW()
    WHERE "requestType" = ${REQUEST_TYPE} AND status IN (${openStatuses}) AND "reviewOutcome"->>'supportRequestId' = ${String(supportRequestId || '')} RETURNING id`)).rows;
  return rows.length;
}
