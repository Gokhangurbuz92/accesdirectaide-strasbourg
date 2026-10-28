// @ts-check
/**
 * Owner LAB audit — a second reviewer confirms only what they have read. Confirming a two-person decision (DSR access review, erasure, organization closure)
 * needs the reviewer's OWN audited reading of the request, made after the proposal: the reading is where the basis, the extract or the counts are shown, and a
 * confirmation without it used to be accepted. (The reading itself is audited fail-closed by each service: no audit row, no content.)
 */
import { sql } from 'drizzle-orm';

/** @param {any} db @param {string} action the *_READ audit action @param {string} requestId @param {string} reviewer @param {string} since ISO time of the proposal */
export async function readSince(db, action, requestId, reviewer, since) {
  const t = Date.parse(String(since || '')); if (!Number.isFinite(t)) return false;
  const rows = (await db.execute(sql`SELECT 1 AS x FROM "AuditLog" WHERE action = ${action} AND entity_id = ${String(requestId)} AND actor_id = ${String(reviewer)}
    AND "timestamp" >= (${new Date(t).toISOString()}::timestamptz AT TIME ZONE 'UTC') LIMIT 1`)).rows;
  return rows.length > 0;
}

export const READ_REQUIRED = { ok: false, status: 409, code: 'read_required', message: 'Ouvrez d’abord la lecture de la demande et de la proposition (elle est journalisée), puis confirmez.' };
