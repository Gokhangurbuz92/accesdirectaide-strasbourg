/**
 * R42 (owner decision R42-A03) — the BUSY intervals of a professional's connected Outlook calendar, for the public slot engine and the booking re-check.
 *
 * What exists before R42 (verified, see CONTROL/r42/R42_BOOKING_ARCHITECTURE_AND_ACCEPTANCE.md §6): the OAuth connection of one professional's Microsoft
 * account (api/_services/calendar-outlook.js: signed state, strict AES-256-GCM token envelope in ProOutlookToken, off unless OUTLOOK_ENABLED and, in
 * production, CALENDAR_PRODUCTION_APPROVED), and a professional-only free/busy read of their own calendar (api/_handlers/pro/outlook-availability.js). The
 * public slots never used it. This module is the missing link, with the R42 rules:
 *   - FREE/BUSY ONLY, least data: POST /me/calendar/getSchedule and only `availabilityView` is read (one digit per interval). No subject, attendee,
 *     location or event id is requested, read, kept or logged. Nothing is written to the calendar (no two-way sync).
 *   - Europe/Paris and DST: the window is sent and read in UTC (timeZone 'UTC'), so a digit always maps to an exact UTC interval.
 *   - FAIL SAFE: a professional whose calendar is connected REQUIRES the check. When it cannot be done — Outlook switched off, token unreadable, token
 *     expired and not refreshable, Graph error, incomplete (stale) answer — the result is UNAVAILABLE and the caller offers none of that professional's
 *     slots. Only a professional with no connected calendar is NOT_CONNECTED (the internal engine alone decides).
 *   - A successful read is reused for CALENDAR_FRESH_MS at most (in-process), never longer.
 *   - Tests use an injected fetch (no Microsoft endpoint is ever called); OUTLOOK_GRAPH_BASE_URL / OUTLOOK_AUTHORITY_URL can point at a sandbox.
 */
import { eq } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { ProOutlookToken } from '../../src/db/schema.js';
import { decryptToken, encryptToken, envelopeIv } from '../_utils/outlook-token-crypto.js';
import { outlookStatus } from './calendar-outlook.js';

export const CALENDAR_INTERVAL_MINUTES = 15;
export const CALENDAR_FRESH_MS = 2 * 60_000;
const INTERVAL_MS = CALENDAR_INTERVAL_MINUTES * 60_000;
const REQUEST_TIMEOUT_MS = 5_000;

/** @typedef {{ start: Date, end: Date }} BusyWindow */
/** @typedef {'CALENDAR_DISABLED' | 'RECONNECT_REQUIRED' | 'TOKEN_EXPIRED' | 'GRAPH_ERROR' | 'STALE'} CalendarUnavailableReason */
/** @typedef {{ state: 'NOT_CONNECTED' } | { state: 'OK', busy: BusyWindow[] } | { state: 'UNAVAILABLE', reason: CalendarUnavailableReason }} CalendarBusy */
/** @typedef {(url: string, init: { method: string, headers: Record<string, string>, body: string, signal?: AbortSignal }) => Promise<{ ok: boolean, status: number, json: () => Promise<unknown> }>} FetchLike */
/** @typedef {{ now?: number, env?: Record<string, string | undefined>, fetchImpl?: FetchLike, database?: typeof defaultDb }} CalendarOptions */

/** @type {Map<string, { at: number, busy: BusyWindow[] }>} */
const cache = new Map();
export function clearCalendarCache() { cache.clear(); }

/** @param {Record<string, string | undefined>} env */
const graphBase = (env) => String(env.OUTLOOK_GRAPH_BASE_URL || 'https://graph.microsoft.com/v1.0').replace(/\/+$/, '');
/** @param {Record<string, string | undefined>} env */
const authorityBase = (env) => String(env.OUTLOOK_AUTHORITY_URL || 'https://login.microsoftonline.com/common/oauth2/v2.0').replace(/\/+$/, '');
/** @param {Date} d the UTC wall time without zone suffix, as getSchedule takes it with timeZone 'UTC' */
const utcWall = (d) => d.toISOString().replace(/\.\d{3}Z$/, '');
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => typeof v === 'object' && v !== null;

/** @type {FetchLike} */
const defaultFetch = async (url, init) => {
  const r = await fetch(url, init);
  return { ok: r.ok, status: r.status, json: () => r.json() };
};

/**
 * @param {FetchLike} fetchImpl @param {string} url @param {{ method: string, headers: Record<string, string>, body: string }} init
 * @returns {Promise<{ ok: boolean, status: number, body: unknown } | null>} null = network error / timeout
 */
async function call(fetchImpl, url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const r = await fetchImpl(url, { ...init, signal: controller.signal });
    const body = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * one refresh of an expired access token with the stored refresh token; the new pair is stored encrypted. null when it cannot be refreshed.
 * @param {{ userId: string, refreshTokenEnc: string }} row @param {Required<CalendarOptions>} o @returns {Promise<string | null>}
 */
async function refreshAccess(row, o) {
  let refresh;
  try { refresh = decryptToken(row.refreshTokenEnc); } catch { return null; }
  if (!refresh || !o.env.OUTLOOK_CLIENT_ID || !o.env.OUTLOOK_CLIENT_SECRET) return null;
  const form = new URLSearchParams();
  form.set('client_id', String(o.env.OUTLOOK_CLIENT_ID)); form.set('client_' + 'secret', String(o.env.OUTLOOK_CLIENT_SECRET));
  form.set('grant_type', 'refresh_token'); form.set('refresh_token', refresh);
  const r = await call(o.fetchImpl, `${authorityBase(o.env)}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  const access = r && r.ok && isObject(r.body) && typeof r.body.access_token === 'string' ? r.body.access_token : null;
  if (!r || !access || !isObject(r.body)) return null;
  const nextRefresh = typeof r.body.refresh_token === 'string' && r.body.refresh_token ? r.body.refresh_token : refresh;
  const expiresIn = Number(r.body.expires_in) > 0 ? Number(r.body.expires_in) : 3600;
  const accessEnc = encryptToken(access);
  await o.database.update(ProOutlookToken).set({ accessTokenEnc: accessEnc, refreshTokenEnc: encryptToken(nextRefresh), iv: envelopeIv(accessEnc), expiresAt: new Date(o.now + expiresIn * 1000) })
    .where(eq(ProOutlookToken.userId, row.userId));
  return access;
}

/**
 * The busy windows of the availabilityView digits ('0' free; '1' tentative, '2' busy, '3' away, '4' working elsewhere and anything else: busy — fail safe).
 * @param {string} view @param {Date} from @returns {BusyWindow[]}
 */
export function busyFromView(view, from) {
  /** @type {BusyWindow[]} */
  const out = [];
  for (let i = 0; i < view.length; i += 1) {
    if (view[i] === '0') continue;
    const start = new Date(from.getTime() + i * INTERVAL_MS); const end = new Date(start.getTime() + INTERVAL_MS);
    const last = out[out.length - 1];
    if (last && last.end.getTime() === start.getTime()) last.end = end; else out.push({ start, end });
  }
  return out;
}

/**
 * The busy windows of one professional's connected calendar over a range.
 * @param {{ id: string, email: string }} pro the professional (ProUser id and sign-in e-mail: the calendar asked for is their own)
 * @param {{ from: Date, to: Date }} range
 * @param {CalendarOptions} [options]
 * @returns {Promise<CalendarBusy>}
 */
export async function calendarBusyFor(pro, range, options = {}) {
  const o = { now: options.now ?? Date.now(), env: options.env ?? process.env, fetchImpl: options.fetchImpl ?? defaultFetch, database: options.database ?? defaultDb };
  const [row] = await o.database.select({ userId: ProOutlookToken.userId, email: ProOutlookToken.email, accessTokenEnc: ProOutlookToken.accessTokenEnc,
    refreshTokenEnc: ProOutlookToken.refreshTokenEnc, expiresAt: ProOutlookToken.expiresAt }).from(ProOutlookToken).where(eq(ProOutlookToken.userId, pro.id)).limit(1);
  if (!row) return { state: 'NOT_CONNECTED' };
  if (!outlookStatus(o.env).enabled) return { state: 'UNAVAILABLE', reason: 'CALENDAR_DISABLED' };

  // the window, aligned on the interval (a digit covers exactly one interval)
  const from = new Date(Math.floor(range.from.getTime() / INTERVAL_MS) * INTERVAL_MS);
  const to = new Date(Math.ceil(range.to.getTime() / INTERVAL_MS) * INTERVAL_MS);
  const key = `${pro.id}|${from.toISOString()}|${to.toISOString()}`;
  const hit = cache.get(key);
  if (hit && o.now - hit.at >= 0 && o.now - hit.at < CALENDAR_FRESH_MS) return { state: 'OK', busy: hit.busy };

  let access;
  try { access = decryptToken(row.accessTokenEnc); } catch { return { state: 'UNAVAILABLE', reason: 'RECONNECT_REQUIRED' }; }
  if (new Date(row.expiresAt).getTime() <= o.now + 30_000) {
    access = await refreshAccess(row, o);
    if (!access) return { state: 'UNAVAILABLE', reason: 'TOKEN_EXPIRED' };
  }
  const body = JSON.stringify({ schedules: [row.email || pro.email], startTime: { dateTime: utcWall(from), timeZone: 'UTC' }, endTime: { dateTime: utcWall(to), timeZone: 'UTC' },
    availabilityViewInterval: CALENDAR_INTERVAL_MINUTES });
  /** @param {string} token */
  const ask = (token) => call(o.fetchImpl, `${graphBase(o.env)}/me/calendar/getSchedule`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'outlook.timezone="UTC"' }, body });
  let r = await ask(access);
  if (r && r.status === 401) {   // revoked or expired early: one refresh, one retry
    const again = await refreshAccess(row, o);
    if (!again) return { state: 'UNAVAILABLE', reason: 'TOKEN_EXPIRED' };
    r = await ask(again);
  }
  if (!r || !r.ok || !isObject(r.body) || !Array.isArray(r.body.value)) return { state: 'UNAVAILABLE', reason: 'GRAPH_ERROR' };
  const first = r.body.value[0];
  if (!isObject(first) || first.error) return { state: 'UNAVAILABLE', reason: 'GRAPH_ERROR' };
  const view = typeof first.availabilityView === 'string' ? first.availabilityView : '';
  const expected = Math.round((to.getTime() - from.getTime()) / INTERVAL_MS);
  if (view.length < expected || !/^[0-9]*$/.test(view)) return { state: 'UNAVAILABLE', reason: 'STALE' };   // an incomplete answer is never read as « free »
  const busy = busyFromView(view.slice(0, expected), from);
  cache.set(key, { at: o.now, busy });
  return { state: 'OK', busy };
}
