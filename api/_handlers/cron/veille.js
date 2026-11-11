// @ts-nocheck
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getCronAuth } from '../../_utils/cronAuth.js';
import { logger } from '../../lib/logger.js';
import { runVeille } from '../../_services/verification/chain.js';
import { bumpContentEpoch } from '../../lib/search-cache.js';

/**
 * K12 (11/11/2026): the night's plan. vercel.json starts this route six times a night (« 37 0-5 * * * », UTC); each start is ONE bounded slice of the
 * veille, never all ten steps at once:
 *  - FINESS (≈ 100 Mo) and data·inclusion (≈ 294 Mo) are never read in the same invocation (docs/verification-production.md § 5: measured LAB limits);
 *  - the record steps run twice (slots 0 and 3, 1 and 4): each run takes the records checked the longest ago, so the second continues the first;
 *  - the review of sources and the D-5 v2 contract check (audit) close the night.
 * Before K12 every start ran every step: six downloads of both large files a night, and the record steps of a slice never reached past its 4 minutes.
 */
export const CRON_PLAN = Object.freeze({
  0: Object.freeze(['aide', 'demarche', 'dispositif', 'fiches']),     // Service-Public / DILA archive of the day
  1: Object.freeze(['structure', 'offices', 'finess']),               // SIRENE, Annuaire, FINESS of the day
  2: Object.freeze(['datainclusion']),                                // data·inclusion export, alone
  3: Object.freeze(['aide', 'demarche', 'dispositif']),               // continues slot 0
  4: Object.freeze(['structure', 'offices']),                         // continues slot 1
  5: Object.freeze(['review', 'audit']),                              // sources review + publication contract on the whole base
});

/** the slice for this start: `?slot=0..5` (an authorized manual start, e.g. the first Production run) or the current UTC hour of the schedule */
export function planFor(req, now = new Date()) {
  const raw = req?.query?.slot;
  const slot = raw !== undefined && /^[0-5]$/.test(String(raw)) ? Number(raw) : now.getUTCHours();
  return Object.prototype.hasOwnProperty.call(CRON_PLAN, slot) ? { slot, only: [...CRON_PLAN[slot]] } : null;
}

/**
 * Automatic verification (« veille automatique », api/_services/verification/chain.js) as a cron. A serverless function has minutes, not hours: the run is bounded
 * (ADA_VEILLE_MAX_MINUTES, default 4) and starts with the records checked the longest ago, so successive runs cover the whole catalogue. The texts (normal summary,
 * FALC) are written only where a LOCAL model is available (ADA_VEILLE_TEXTS=on, with Ollama on the same machine): elsewhere a record whose texts must be written
 * again keeps the official excerpt or is not published until they are (fail-closed). It reads official public sources only; ADA_VERIFICATION_NETWORK=off disables it.
 * @param {import('../../_utils/http-types').ApiRequest} req @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res, deps = {}) {
  const auth = getCronAuth(req);
  if (!auth.ok) {
    if (auth.reason === 'missing_secret') return res.status(500).json({ error: 'CRON_SECRET is not configured' });
    logger.warn('Unauthorized veille attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const plan = planFor(req, deps.now ? new Date(deps.now) : new Date());
  if (!plan) {
    // outside the night's six slots (a manual start without ?slot): nothing is read or written
    return res.status(200).json({ success: true, skipped: 'OUTSIDE_PLAN', message: 'Hors des créneaux de la veille (0 h à 5 h UTC) : indiquer ?slot=0..5.' });
  }
  // K12: FINESS and data·inclusion are read from files on disk (streamed); without a cache directory the chain does not download them at all (fail-closed,
  // « fichiers trop gros pour la mémoire »). A slice gets its own directory in the function's /tmp, removed when it ends: a warm instance that runs the FINESS
  // slice (≈ 132 Mo) and then the data·inclusion one (≈ 329 Mo) never holds both (Vercel /tmp: 500 Mo). ADA_VEILLE_CACHE_DIR, when set, is used as is.
  const own = process.env.ADA_VEILLE_CACHE_DIR ? null : fs.mkdtempSync(path.join(deps.tmpdir || os.tmpdir(), 'ada-veille-'));
  const cacheDir = process.env.ADA_VEILLE_CACHE_DIR || own;
  try {
    const r = await (deps.runVeille || runVeille)({ trigger: `cron:slot${plan.slot}`, only: plan.only, nightCap: true, cacheDir, texts: process.env.ADA_VEILLE_TEXTS === 'on',
      maxMinutes: Number(process.env.ADA_VEILLE_MAX_MINUTES) || 4, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) });
    if (r.ok) await bumpContentEpoch().catch(() => {});
    logger.info('VEILLE_END', { slot: plan.slot, steps: plan.only, status: r.status, counts: r.counts });
    return res.status(200).json({ success: r.ok, slot: plan.slot, steps: plan.only, ...r });
  } catch (error) {
    logger.error('VEILLE_FATAL', { name: error?.name, slot: plan.slot });
    return res.status(500).json({ error: 'Veille failed' });
  } finally {
    if (own) { try { fs.rmSync(own, { recursive: true, force: true }); } catch { /* the instance's /tmp is reclaimed anyway */ } }
  }
}
