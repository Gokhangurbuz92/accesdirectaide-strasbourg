import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AUTH_ROLE } from './auth.js';

/**
 * R24 (owner decision R18.5, 28/10/2026): who manages a structure's schedule.
 *   - its administrator, or a member to whom an administrator explicitly delegated it (ProUser.canManageSchedule), may change the general opening hours,
 *     record a closure of the whole structure and manage every member's absence;
 *   - every other member manages only their own absence.
 * The delegation is read from the database on every request (never from the token), so withdrawing it takes effect at once; a disabled account has no right.
 * @param {{ userId: string, structureId: string, role: string }} proCtx
 * @returns {Promise<boolean>}
 */
export async function canManageSchedule(proCtx, db = defaultDb) {
  if (proCtx.role === AUTH_ROLE.STRUCTURE_ADMIN || proCtx.role === AUTH_ROLE.SUPERADMIN) return true;
  const rows = (await db.execute(sql`SELECT "canManageSchedule" c FROM "ProUser" WHERE id = ${proCtx.userId} AND "structureId" = ${proCtx.structureId} AND status = 'active' LIMIT 1`)).rows;
  return rows[0]?.c === true;
}

export const SCHEDULE_MANAGERS_ONLY = 'Seuls l’administrateur de la structure ou un membre qu’il a désigné pour gérer le planning peuvent faire cette modification.';
