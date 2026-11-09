/**
 * V2 (owner review 09/11/2026) — erasure tombstones: the durable record of an erasure, written OUTSIDE the database at the moment it happens.
 *
 * Why: the erasure ledger travels with each backup (scripts/db-erasure-replay.mjs), so it only knows the erasures completed BEFORE that backup. If the
 * database is lost between two backups (≤ 12 h), the latest backup brings back everyone erased in that interval. The tombstones close that interval.
 * Content: request id, subject id (pseudonymous UUID — no e-mail, no name, no content), domains, time, phase. Store: the KV store (Upstash, already a
 * V2 processor, Frankfurt), list kept 40 days after the last write (longer than the 35-day backups; every restorable backup is younger).
 *
 * Two phases (final data-integrity review, 09/11/2026):
 *   - `intent`  written BEFORE anything is erased; if it cannot be written, nothing is erased (fail-closed, request stays open);
 *   - `done`    written after the erasure committed (best effort — the data are already gone);
 *   - `aborted` written when the erasure failed before committing (best effort).
 * A restore replays only `done` erasures. An `intent` with neither `done` nor `aborted` is UNCONFIRMED: it is never replayed automatically (an erasure
 * that may not have happened must not delete anyone); the replay refuses to run until the operator decides (scripts/db-erasure-replay.mjs).
 * Coverage: every write also sets `…:last` (no TTL). A replay whose list lacks the `last` record, or whose list is full and starts after the backup,
 * is INCOMPLETE and refuses to execute — a silent loss (eviction, flush, trimming) is never mistaken for « no erasure ».
 */
import { kv as defaultKv } from '../_utils/kv.js';

export const TOMBSTONE_KEY = 'ada:erasure-tombstones:v1';
export const TOMBSTONE_LAST_KEY = 'ada:erasure-tombstones:v1:last';
export const TOMBSTONE_TTL_SECONDS = 40 * 86400;
export const TOMBSTONE_MAX = 10000;
export const TOMBSTONE_KIND = 'ada-erasure-tombstone';
export const PHASES = Object.freeze(['intent', 'done', 'aborted']);

/** @param {{ requestId: string, subjectId: string, domains?: string[], at?: Date }} e @param {'intent' | 'done' | 'aborted'} [phase] */
export function tombstoneOf(e, phase = 'intent') {
  return { kind: TOMBSTONE_KIND, phase, requestId: String(e.requestId), subjectId: String(e.subjectId), domains: [...new Set((e.domains || []).map(String))],
    completedAt: (e.at || new Date()).toISOString() };
}

const unavailable = () => Object.assign(new Error('ERASURE_TOMBSTONE_UNAVAILABLE'), { code: 'ERASURE_TOMBSTONE_UNAVAILABLE' });

/**
 * @param {{ kv?: any, requireRemote?: boolean }} [opts] requireRemote: Production — refuse when only the in-memory fallback exists
 */
/** outside Production: a process-local store (development, tests, QA — whose KV variables may point at a placeholder host) */
const localKv = (() => {
  /** @type {Map<string, any>} */ const m = new Map();
  /** @param {any[]} l @param {number} a @param {number} b */ const cut = (l, a, b) => l.slice(a, b < 0 ? l.length + b + 1 : b + 1);
  return { isRemote: false,
    /** @param {string} k @param {string} v */ async lpush(k, v) { const l = m.get(k) || []; l.unshift(v); m.set(k, l); return l.length; },
    /** @param {string} k @param {number} a @param {number} b */ async lrange(k, a, b) { return cut(m.get(k) || [], a, b); },
    /** @param {string} k @param {number} a @param {number} b */ async ltrim(k, a, b) { m.set(k, cut(m.get(k) || [], a, b)); return 'OK'; },
    async expire() { return 1; },
    /** @param {string} k @param {any} v */ async set(k, v) { m.set(k, v); return 'OK'; },
    /** @param {string} k */ async get(k) { return m.get(k) ?? null; } };
})();

/**
 * Production (VERCEL_ENV=production): the real KV store, required — no store, no erasure (fail-closed). Elsewhere: a process-local store, so a
 * development or test environment never depends on (or waits for) a remote KV it does not own; the fail-closed path is tested with an explicit kv.
 */
/** @param {{ requireRemote?: boolean, kv?: any }} [opts] */
export function createErasureTombstones(opts = {}) {
  const requireRemote = opts.requireRemote ?? process.env.VERCEL_ENV === 'production';
  const kv = opts.kv ?? (requireRemote ? defaultKv : localKv);
  const push = async (/** @type {ReturnType<typeof tombstoneOf>} */ t) => {
    if (requireRemote && !kv.isRemote) throw unavailable();
    try {
      await kv.lpush(TOMBSTONE_KEY, JSON.stringify(t));
      await kv.ltrim(TOMBSTONE_KEY, 0, TOMBSTONE_MAX - 1);
      await kv.expire(TOMBSTONE_KEY, TOMBSTONE_TTL_SECONDS);
      // the marker has NO TTL on purpose: with Upstash eviction enabled, keys WITH a TTL go first (« optimistic-volatile »), so the marker outlives a
      // silently evicted list and reveals it (eviction is disabled by default; it cannot be read through the REST API: owner console check)
      await kv.set(TOMBSTONE_LAST_KEY, JSON.stringify({ requestId: t.requestId, phase: t.phase, completedAt: t.completedAt }));
    } catch { throw unavailable(); }
  };
  return {
    /** BEFORE the erasure; throws ERASURE_TOMBSTONE_UNAVAILABLE (the caller must then erase nothing) */
    async record(/** @type {{ requestId: string, subjectId: string, domains: string[], at?: Date }} */ e) { await push(tombstoneOf(e, 'intent')); },
    /** after the commit; never throws (the data are gone already): false = not recorded, the restore will report it as unconfirmed */
    async complete(/** @type {{ requestId: string, subjectId: string, domains: string[], at?: Date }} */ e) { try { await push(tombstoneOf(e, 'done')); return true; } catch { return false; } },
    /** the erasure failed before committing; never throws */
    async abort(/** @type {{ requestId: string, subjectId: string, domains: string[], at?: Date }} */ e) { try { await push(tombstoneOf(e, 'aborted')); return true; } catch { return false; } },
    /** every record, newest first, and the `last` marker */
    async snapshot() {
      const rows = await kv.lrange(TOMBSTONE_KEY, 0, -1);
      let last = await kv.get(TOMBSTONE_LAST_KEY);
      if (typeof last === 'string') { try { last = JSON.parse(last); } catch { last = null; } }
      return { entries: parseTombstones(rows), last: last && typeof last === 'object' ? last : null, length: Array.isArray(rows) ? rows.length : 0 };
    },
    /** @deprecated kept for callers that only need the records */
    async list() { return (await this.snapshot()).entries; },
  };
}

/** @param {unknown[]} rows raw KV values (strings, or objects when the client already parsed JSON) */
export function parseTombstones(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    let v = r; if (typeof v === 'string') { try { v = JSON.parse(v); } catch { continue; } }
    const x = /** @type {any} */ (v);
    if (x && typeof x === 'object' && x.kind === TOMBSTONE_KIND && x.requestId && x.subjectId && Number.isFinite(Date.parse(x.completedAt))) {
      out.push({ ...x, phase: PHASES.includes(x.phase) ? x.phase : 'intent' });
    }
  }
  return out;
}

/**
 * One state per erasure request: `done` (a done record exists), `aborted` (an aborted record after its newest intent, no done), else `unconfirmed`.
 * @param {ReturnType<typeof parseTombstones>} entries newest first, as stored (LPUSH)
 */
export function tombstoneStates(entries) {
  /** @type {Map<string, { requestId: string, subjectId: string, domains: string[], completedAt: string, state: 'done' | 'aborted' | 'unconfirmed', intentAt: number }>} */
  const by = new Map();
  // insertion order, oldest first: the KV list is newest first (LPUSH). Timestamps can tie (intent and abort in the same millisecond), the order cannot.
  const ordered = [...entries].reverse();
  let i = 0;
  for (const e of ordered) {
    i += 1;
    const cur = by.get(e.requestId) || { requestId: e.requestId, subjectId: e.subjectId, domains: e.domains || [], completedAt: e.completedAt, state: 'unconfirmed', intentAt: -1 };
    if (e.phase === 'done') { cur.state = 'done'; cur.completedAt = e.completedAt; cur.domains = e.domains?.length ? e.domains : cur.domains; }
    else if (e.phase === 'aborted') { if (cur.state !== 'done' && i > cur.intentAt) cur.state = 'aborted'; }
    else { cur.intentAt = i; if (cur.state !== 'done') { cur.state = 'unconfirmed'; cur.completedAt = e.completedAt; } }
    by.set(e.requestId, cur);
  }
  return [...by.values()];
}

/**
 * Is the record complete enough to trust « no tombstone ⇒ no erasure » after `since`? @param {{ entries: any[], last: any, length?: number }} snap
 * @param {string | Date | null} since @returns {string[]} problems (empty = complete)
 */
export function tombstoneCoverage(snap, since = null, now = Date.now()) {
  const problems = [];
  const entries = Array.isArray(snap?.entries) ? snap.entries : [];
  const last = snap?.last;
  // the list lives TTL after its LAST write: a marker younger than the TTL whose record is absent means the list was lost (eviction, flush, deletion);
  // an older marker with no list is the normal expiry (no erasure for 40 days, longer than any restorable backup)
  const lastWithinTtl = last && now - Date.parse(last.completedAt) < TOMBSTONE_TTL_SECONDS * 1000;
  if (last && lastWithinTtl && !entries.some((e) => e.requestId === last.requestId && e.phase === last.phase && e.completedAt === last.completedAt)) problems.push('TOMBSTONE_LAST_RECORD_MISSING');
  if (!last && entries.length > 0) problems.push('TOMBSTONE_LAST_MARKER_MISSING');
  const t = since ? new Date(since).getTime() : null;
  if (Number(snap?.length ?? entries.length) >= TOMBSTONE_MAX && entries.length) {
    const oldest = Math.min(...entries.map((e) => Date.parse(e.completedAt)));
    if (t === null || oldest >= t) problems.push('TOMBSTONE_LIST_TRIMMED_AFTER_BACKUP');
  }
  return problems;
}

/** a no-op recorder (the restore tool replaying erasures into a restored copy writes no new tombstone) */
export const NO_TOMBSTONES = Object.freeze({ async record() {}, async complete() { return true; }, async abort() { return true; },
  async snapshot() { return { entries: [], last: null, length: 0 }; }, async list() { return []; } });
