/**
 * G14-OBS — the public observatoire in the browser: the build switches, the reader of GET /api/public/observatoire and the OPT-IN situation counter.
 *
 * Switches (build time, exact values, closed by default — the server has its own, api/lib/demand-signals.js):
 *   VITE_OBSERVATOIRE=open           the /observatoire page shows the data, and the impact page links to it;
 *   VITE_DEMAND_SIGNALS ∋ situation  the Rights Graph page may show the opt-in box (SituationSignalOptIn), unticked by default.
 * The opt-in choice is kept in the page's memory only (never stored on the device, never in a cookie): nothing to consent to on the terminal, and a new
 * visit starts unticked again.
 */
import { csrfFetch } from '@/lib/csrf';

export const OBSERVATOIRE_API = '/api/public/observatoire';
export const OBSERVATOIRE_CSV = '/api/public/observatoire?format=csv';
export const SIGNAL_API = '/api/public/signal';
export const SCHEMA = 'ada.observatoire.v1';

/** @param {unknown} [value] the build value (tests pass it) */
export function observatoireOpened(value = undefined) {
  let v = value;
  if (v === undefined) { try { v = import.meta.env.VITE_OBSERVATOIRE; } catch { v = ''; } }
  return String(v ?? '').trim().toLowerCase() === 'open';
}

/** @param {unknown} [value] the build value (tests pass it) */
export function situationSignalsOpened(value = undefined) {
  let v = value;
  if (v === undefined) { try { v = import.meta.env.VITE_DEMAND_SIGNALS; } catch { v = ''; } }
  return String(v ?? '').split(',').map((x) => x.trim().toLowerCase()).includes('situation');
}

/** @param {typeof fetch} [fetchImpl] @returns {Promise<any | null>} null on any failure, a closed route (404) or another schema */
export async function loadObservatoire(fetchImpl = fetch) {
  try {
    const r = await fetchImpl(OBSERVATOIRE_API, { credentials: 'omit' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.schema === SCHEMA ? j : null;
  } catch { return null; }
}

/**
 * Sends the chosen Rights Graph situation — ONLY when the visitor ticked the box and the build opened the counter. The id goes in the body (never in the
 * address); no other field, no credential beyond the CSRF token the site already uses. Fire and forget: the page never waits for it or shows an error.
 * Hook for the Rights Graph page (branch g14-rg): `sendSituationSignal(situation.id, { optedIn })` when a situation is chosen.
 * @param {string} id @param {{ optedIn: boolean, opened?: boolean, fetchImpl?: (url: string, init: RequestInit) => Promise<Response> }} opts
 * @returns {Promise<boolean>} whether a request was sent
 */
export async function sendSituationSignal(id, { optedIn, opened = situationSignalsOpened(), fetchImpl = csrfFetch }) {
  if (optedIn !== true || !opened || typeof id !== 'string' || !id) return false;
  try {
    await fetchImpl(SIGNAL_API, { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ situation: id }) });
    return true;
  } catch { return false; }
}
