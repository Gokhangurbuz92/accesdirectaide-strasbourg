/**
 * R47 — the moves of an appointment made by its STRUCTURE (api/_services/rdv-pro-reschedule.js), read back from the journal row each move writes
 * (AuditLog RDV_PRO_RESCHEDULED: appointment id + structure id, nothing else). No migration: the Production schema 0042 has no column for it, and
 * ProAppointment.rescheduleCount stays the PERSON's own online-move allowance (D-2: at most 2, a DB CHECK) — a move by the team never uses it up.
 *
 * Used for: what both sides see (« horaire modifié par la structure »), and the calendar SEQUENCE of every later e-mail calendar file
 * (person moves + team moves), so an updated or cancelled event always supersedes the previous one in the person's calendar.
 * A row is counted only when its structure is the appointment's (tenant check). Never throws: an unreadable journal counts nothing.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import logger from '../_utils/logger.js';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';

export const TEAM_MOVE_ACTION = 'RDV_PRO_RESCHEDULED';

/**
 * @param {Array<{ id: string, structureId: string }>} rows @param {{ database?: typeof defaultDb }} [deps]
 * @returns {Promise<Map<string, { count: number, lastAt: string }>>}
 */
export async function teamMovesFor(rows, deps = {}) {
  const database = deps.database ?? defaultDb;
  /** @type {Map<string, { count: number, lastAt: string }>} */
  const out = new Map();
  if (!rows.length) return out;
  try {
    const structureOf = new Map(rows.map((r) => [r.id, r.structureId]));
    const found = await database.select({ details: AuditLog.details, at: AuditLog.timestamp }).from(AuditLog)
      .where(and(eq(AuditLog.action, TEAM_MOVE_ACTION), inArray(sql`${AuditLog.details}->>'appointmentId'`, rows.map((r) => r.id))))
      .orderBy(AuditLog.timestamp);
    for (const f of found) {
      const d = /** @type {Record<string, unknown> | null} */ (f.details && typeof f.details === 'object' ? f.details : null);
      const id = typeof d?.appointmentId === 'string' ? d.appointmentId : '';
      if (!id || structureOf.get(id) !== d?.structureId) continue;
      const prev = out.get(id);
      out.set(id, { count: (prev?.count || 0) + 1, lastAt: new Date(f.at).toISOString() });
    }
  } catch (error) {
    logger.warn({ err: { name: error instanceof Error ? error.name : 'Error' } }, '[rdv-team-moves] journal unavailable');
  }
  return out;
}

/**
 * How many times the structure moved this appointment (0 when unknown). Only with a database that can run raw SQL (a test double without one: 0).
 * @param {string} appointmentId @param {any} [database]
 */
export async function teamMoveCount(appointmentId, database = defaultDb) {
  if (!appointmentId || !database || typeof database.execute !== 'function') return 0;
  try {
    const res = await database.execute(sql`SELECT count(*)::int AS n FROM "AuditLog" a JOIN "ProAppointment" p ON p.id = a.details->>'appointmentId'
      WHERE a.action = ${TEAM_MOVE_ACTION} AND a.details->>'appointmentId' = ${appointmentId} AND a.details->>'structureId' = p."structureId"`);
    const n = Number(res?.rows?.[0]?.n);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}
