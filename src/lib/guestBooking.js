// R38 — account-free (« sans compte ») booking, browser side. The server (api/_services/rdv-guest.js) is authoritative: these helpers only call it.
import { csrfFetch } from '@/lib/csrf';

export const GUEST_NOTE_MAX = 300;

/** the guest booking page of a structure @param {string} slug */
export const guestBookingPath = (slug) => `/rdv/${encodeURIComponent(String(slug || ''))}/sans-compte`;

/**
 * The manage capability of the e-mailed link: ?appointment=<id>#manage=<token>. It is read once, then removed from the address bar (the token never goes
 * into a query string, a referrer or the history). @param {string} search @param {string} hash @returns {{ appointmentId: string, token: string } | null}
 */
export function readManageCapability(search, hash) {
  const appointmentId = String(new URLSearchParams(String(search || '').replace(/^\?/, '')).get('appointment') || '').trim();
  const token = String(new URLSearchParams(String(hash || '').replace(/^#/, '')).get('manage') || '').trim();
  if (!appointmentId || !/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  return { appointmentId, token };
}

/** @typedef {{ startAt: string, endAt: string }} GuestSlot a free slot as the slots endpoint lists it */
/** @typedef {{ name: string }} GuestStructure the structure as the services endpoint describes it */
/** @typedef {{ id: string, name: string, durationMinutes: number }} GuestService a service open to account-free booking */
/** @typedef {{ hold: { id: string }, emailMasked?: string }} GuestHold the answer of POST hold */
/**
 * @typedef {object} GuestAppointment an account-free appointment as the confirm / manage endpoints return it
 * @property {string} id
 * @property {string} [startsAt]
 * @property {string} [status]
 * @property {{ name?: string }} [structure]
 * @property {{ id?: string, name?: string }} [service]
 * @property {{ address?: string }} [location]
 * @property {boolean} [canReschedule]
 * @property {boolean} [canCancel]
 * @property {string} [rescheduleBlocked]
 * @property {boolean} [reminderChangeable]
 * @property {boolean} [reminderConsent]
 */
/** @typedef {{ appointment: GuestAppointment, mail?: { status?: string }, manage: { token: string } }} GuestConfirmation the answer of POST confirm */

/** slots grouped by their Paris calendar day @param {GuestSlot[]} slots @returns {{ date: string, slots: GuestSlot[] }[]} */
export function slotsByParisDay(slots) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' });
  const map = new Map();
  for (const s of Array.isArray(slots) ? slots : []) {
    const key = day.format(new Date(s.startAt));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => ({ date, slots: list }));
}

/**
 * R41: a 2xx answer that is not the API's JSON (an HTML fallback page of a static host or dev server, a proxy or captive-portal page) is not a success:
 * it used to count as one, so such a page was read as « this structure takes account-free bookings » and the sign-in path was skipped.
 * @param {Response} res
 */
async function json(res) {
  const body = await res.json().catch(() => null);
  const parsed = typeof body === 'object' && body !== null;
  return { ok: res.ok && parsed, status: res.status, body: parsed ? body : {} };
}

/**
 * R41 — the server offers account-free booking for this structure: its services answer is the API's JSON naming the structure with its list of
 * services (possibly empty: the guest page then says that no service is offered without an account). Anything else (503 GUEST_BOOKING_DISABLED, 404,
 * a network failure, an answer of another shape) keeps the historical path: sign in, or the « not published » screen.
 * @param {{ ok: boolean, body?: unknown }} r @returns {boolean}
 */
export function offersGuestBooking(r) {
  if (!r.ok) return false;
  const b = r.body;
  return typeof b === 'object' && b !== null && 'structure' in b && 'items' in b && typeof b.structure === 'object' && b.structure !== null && Array.isArray(b.items);
}

/** @param {string} path */
export async function guestGet(path) {
  try { return await json(await fetch(`/api/rdv/guest/${path}`, { credentials: 'same-origin', cache: 'no-store' })); } catch { return { ok: false, status: 0, body: {} }; }
}

/** a protected POST (CSRF double-submit through csrfFetch) @param {string} path @param {object} payload */
export async function guestPost(path, payload) {
  try {
    return await json(await csrfFetch(`/api/rdv/guest/${path}`, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }));
  } catch { return { ok: false, status: 0, body: {} }; }
}

/** a fresh idempotency key for one booking attempt (a retry of the same attempt reuses it) */
export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
