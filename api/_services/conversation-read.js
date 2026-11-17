// @ts-nocheck
/**
 * RECON Pro B02 — a professional's read state for the appointment conversations of their structure.
 *
 * The marker lives in "RdvConversationRead" (drizzle/0049): one row per (conversation, member) = the moment that member last opened the thread. A
 * conversation is UNREAD for a member when the person wrote after BOTH that marker and the team's last reply (a reply implies the earlier messages were
 * read by the team). Nothing is inferred beyond that.
 *
 * The database can be behind the code (Production migrates later): every function here first asks the catalogue whether the table exists
 * (conversationReadAvailable, at most once per READ_SCHEMA_TTL_MS per process, a failed read is not remembered). Without the table: nothing is written,
 * the unread count is `null` (unknown — exactly what the interface got before 0049) and the lists carry no unread flag. No other code names this table,
 * and no relation is declared on it, so every existing query is the same on both database levels.
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import logger from '../_utils/logger.js';

export const READ_SCHEMA_TTL_MS = 60_000;
const cache = new WeakMap();

/** @param {any} database a drizzle client with execute() @returns {Promise<boolean>} whether "RdvConversationRead" exists in this database */
export function conversationReadAvailable(database = defaultDb) {
  if (!database || typeof database.execute !== 'function') return Promise.resolve(false);
  const hit = cache.get(database);
  if (hit && Date.now() - hit.at < READ_SCHEMA_TTL_MS) return hit.value;
  const value = database.execute(sql`SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'RdvConversationRead'`)
    .then((res) => (res?.rows || res || []).length > 0);
  cache.set(database, { at: Date.now(), value });
  value.catch(() => { if (cache.get(database)?.value === value) cache.delete(database); });
  return value;
}
/** for the tests: forget what was read (a migration applied or rolled back inside one process) */
export function forgetConversationReadSchema(database = defaultDb) { cache.delete(database); }

/** the conversations of `structureId` that are unread for `userId` (a person's message after the member's marker and after the team's last reply) */
const unreadSql = (structureId, userId) => sql`
  SELECT c.id FROM "RdvConversation" c
  LEFT JOIN "RdvConversationRead" r ON r."conversationId" = c.id AND r."proUserId" = ${userId}
  WHERE c."structureId" = ${structureId} AND EXISTS (
    SELECT 1 FROM "RdvConversationMessage" m WHERE m."conversationId" = c.id AND m."senderType" <> 'PRO'
      AND m."createdAt" > GREATEST(COALESCE(r."lastReadAt", '-infinity'::timestamp),
        COALESCE((SELECT max(p."createdAt") FROM "RdvConversationMessage" p WHERE p."conversationId" = c.id AND p."senderType" = 'PRO'), '-infinity'::timestamp)))`;

/**
 * @param {{ structureId: string, userId: string }} ctx @param {any} [database]
 * @returns {Promise<Set<string> | null>} ids of the member's unread conversations; null = unknown (database without the read marker)
 */
export async function unreadConversationIds(ctx, database = defaultDb) {
  if (!(await conversationReadAvailable(database))) return null;
  const res = await database.execute(unreadSql(ctx.structureId, ctx.userId));
  return new Set((res?.rows || res || []).map((r) => String(r.id)));
}

/** @param {{ structureId: string, userId: string }} ctx @param {any} [database] @returns {Promise<number | null>} null = unknown (no read marker in this database) */
export async function unreadConversationCount(ctx, database = defaultDb) {
  if (!(await conversationReadAvailable(database))) return null;
  const res = await database.execute(sql`SELECT count(*)::int AS n FROM (${unreadSql(ctx.structureId, ctx.userId)}) u`);
  const n = Number((res?.rows || res || [])[0]?.n);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid unread conversation count');
  return n;
}

/**
 * The member opened (or answered in) a conversation of THEIR structure — the caller has already checked that. Best effort, never throws:
 *  - the member's notices « message_received » about this appointment are marked read (works on every database level: ProNotification only);
 *  - with the read marker table: the member's marker moves to now (database clock, like the messages' createdAt).
 * @param {{ conversationId: string, appointmentId?: string | null, structureId: string, userId: string }} input @param {any} [database]
 * @returns {Promise<{ marked: boolean }>} marked = the durable marker was written
 */
export async function markConversationRead(input, database = defaultDb) {
  const { conversationId, appointmentId, structureId, userId } = input;
  try {
    if (appointmentId) {
      await database.execute(sql`UPDATE "ProNotification" SET "readAt" = now() WHERE "userId" = ${userId} AND "structureId" = ${structureId} AND "readAt" IS NULL
        AND type = 'message_received' AND metadata->>'appointmentId' = ${String(appointmentId)}`);
    }
  } catch (err) { logger.warn({ err: { name: err?.name } }, '[conversation-read] notices not marked read'); }
  try {
    if (!(await conversationReadAvailable(database))) return { marked: false };
    await database.execute(sql`INSERT INTO "RdvConversationRead" ("conversationId", "proUserId", "lastReadAt") VALUES (${conversationId}, ${userId}, now())
      ON CONFLICT ("conversationId", "proUserId") DO UPDATE SET "lastReadAt" = now()`);
    return { marked: true };
  } catch (err) {
    logger.warn({ err: { name: err?.name, code: err?.cause?.code || err?.code } }, '[conversation-read] marker not written');
    return { marked: false };
  }
}
