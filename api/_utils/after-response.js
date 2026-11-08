/**
 * V2 (security review D1) — account enumeration by timing. The answers of sign-up, forgot-password and resend-verification are identical for every
 * address; their DURATION was not: an existing account added database writes and an awaited Mailjet call (up to 10 s). The address-dependent work now
 * runs AFTER the answer (Vercel `waitUntil`, as pro/auth/forgot-password since R40), and in Production / Preview the answer is never sent before a
 * fixed floor (the remaining difference — one indexed lookup — is hidden under it).
 */
import { waitUntil } from '@vercel/functions';
import logger from './logger.js';

const pending = new Set();

/**
 * Runs `work` after the response (never awaited by the handler; errors are logged by name only — no address, no token).
 * @param {() => Promise<unknown>} work @param {string} label
 */
export function afterResponse(work, label) {
  const p = Promise.resolve().then(work).catch((err) => { logger.error({ err: { name: err?.name, code: err?.cause?.code || err?.code }, label }, '[after-response] deferred work failed'); });
  const tracked = p.finally(() => pending.delete(tracked));
  pending.add(tracked);
  try { waitUntil(tracked); } catch { /* outside Vercel the promise simply runs */ }
  return tracked;
}

/** Tests and the LAB: wait until the deferred work has finished. */
export const settleAfterResponse = async () => { while (pending.size) await Promise.allSettled([...pending]); };

/** The answer floor: 0 outside Production / Preview (tests, LAB), ENUMERATION_FLOOR_MS or 400 ms there. */
export function responseFloorMs(env = process.env) {
  const vercelEnv = String(env.VERCEL_ENV || '').toLowerCase();
  if (vercelEnv !== 'production' && vercelEnv !== 'preview') return 0;
  const n = Number(env.ENUMERATION_FLOOR_MS);
  return Number.isFinite(n) && n >= 0 && env.ENUMERATION_FLOOR_MS !== '' && env.ENUMERATION_FLOOR_MS !== undefined ? Math.min(n, 5000) : 400;
}

/** Waits until `floorMs` have passed since `startedAt`. @param {number} startedAt @param {number} [floorMs] */
export async function holdResponseFloor(startedAt, floorMs = responseFloorMs()) {
  const left = startedAt + floorMs - Date.now();
  if (left > 0) await new Promise((r) => setTimeout(r, left));
}
