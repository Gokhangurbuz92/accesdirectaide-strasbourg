/**
 * V2 (owner review 09/11/2026) — erasure tombstones: the durable record of an erasure, written OUTSIDE the database at the moment it happens.
 *
 * Why: the erasure ledger travels with each backup (scripts/db-erasure-replay.mjs), so it only knows the erasures completed BEFORE that backup. If the
 * database is lost between two backups (≤ 12 h), the latest backup brings back everyone erased in that interval, and the ledger exported with it does not
 * name them: they would come back silently. The tombstone closes that interval: before a DELETE request is executed, its request id, subject id
 * (pseudonymous UUID — no e-mail, no name, no content), domains and time are pushed to the KV store (Upstash, already a V2 processor, Frankfurt),
 * kept 40 days (longer than the 35-day backups). A restore replays the bucket ledger PLUS the tombstones newer than the backup
 * (db-erasure-replay.mjs --kv / --tombstones-file). Fail-closed in Production: if the tombstone cannot be written, the erasure is not executed (the
 * request stays open and is retried) — an erasure that a restore could silently undo is never reported complete.
 */
import { kv as defaultKv } from '../_utils/kv.js';

export const TOMBSTONE_KEY = 'ada:erasure-tombstones:v1';
export const TOMBSTONE_TTL_SECONDS = 40 * 86400;
export const TOMBSTONE_MAX = 10000;
export const TOMBSTONE_KIND = 'ada-erasure-tombstone';

/** @param {{ requestId: string, subjectId: string, domains: string[], at?: Date }} e */
export function tombstoneOf(e) {
  return { kind: TOMBSTONE_KIND, requestId: String(e.requestId), subjectId: String(e.subjectId), domains: [...new Set((e.domains || []).map(String))],
    completedAt: (e.at || new Date()).toISOString() };
}

/**
 * @param {{ kv?: any, requireRemote?: boolean }} [opts] requireRemote: Production — refuse when only the in-memory fallback exists
 */
export function createErasureTombstones({ kv = defaultKv, requireRemote = process.env.VERCEL_ENV === 'production' } = {}) {
  return {
    /** @param {{ requestId: string, subjectId: string, domains: string[], at?: Date }} e */
    async record(e) {
      if (requireRemote && !kv.isRemote) throw Object.assign(new Error('ERASURE_TOMBSTONE_UNAVAILABLE'), { code: 'ERASURE_TOMBSTONE_UNAVAILABLE' });
      try {
        await kv.lpush(TOMBSTONE_KEY, JSON.stringify(tombstoneOf(e)));
        await kv.ltrim(TOMBSTONE_KEY, 0, TOMBSTONE_MAX - 1);
        await kv.expire(TOMBSTONE_KEY, TOMBSTONE_TTL_SECONDS);
      } catch {
        throw Object.assign(new Error('ERASURE_TOMBSTONE_UNAVAILABLE'), { code: 'ERASURE_TOMBSTONE_UNAVAILABLE' });
      }
    },
    /** every tombstone, newest first (malformed rows skipped) @returns {Promise<ReturnType<typeof tombstoneOf>[]>} */
    async list() {
      const rows = await kv.lrange(TOMBSTONE_KEY, 0, -1);
      return parseTombstones(rows);
    },
  };
}

/** @param {unknown[]} rows raw KV values (strings, or objects when the client already parsed JSON) */
export function parseTombstones(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    let v = r; if (typeof v === 'string') { try { v = JSON.parse(v); } catch { continue; } }
    if (v && typeof v === 'object' && /** @type {any} */ (v).kind === TOMBSTONE_KIND && /** @type {any} */ (v).requestId && /** @type {any} */ (v).subjectId
      && Number.isFinite(Date.parse(/** @type {any} */ (v).completedAt))) out.push(/** @type {any} */ (v));
  }
  return out;
}

/** a no-op recorder (the restore tool replaying erasures into a restored copy writes no new tombstone) */
export const NO_TOMBSTONES = Object.freeze({ async record() {}, async list() { return []; } });
