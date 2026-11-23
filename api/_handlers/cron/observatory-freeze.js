// @ts-nocheck
import { getCronAuth, scheduledByVercel } from '../../_utils/cronAuth.js';
import { logger } from '../../lib/logger.js';
import { freezeClosedQuarters } from '../../_services/territorial-stats.js';
import { freezeDemandQuarters } from '../../_services/demand-signals.js';
import { startCronRun, finishCronRun } from '../../_utils/cron-run.js';
import { env } from '../../_utils/env.js';
import { db } from '../../../src/db/index.js';

/**
 * C8 (owner Paket 4) — freezes the closed calendar quarters of the cross-organization statistics (drizzle/0052, api/_services/territorial-stats.js
 * freezeClosedQuarters): each closed quarter of the window not frozen yet is published once and stored; later reads return it unchanged. Daily in
 * vercel.json, idempotent. Category A (api/_utils/public-beta.js): closed in the restricted beta until named in ADA_BETA_OPEN_JOBS. Reads aggregates and
 * writes published cells only — no person, no organization id, nothing sent. Without 0052 the run ends « skipped » (SCHEMA_MISSING) and changes nothing.
 * Every call leaves a CronRun row (counts only).
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res, deps = {}) {
  const auth = getCronAuth(req);
  if (!auth.ok) {
    if (auth.reason === 'missing_secret') return res.status(500).json({ error: 'CRON_SECRET is not configured' });
    logger.warn('Unauthorized observatory-freeze attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const database = deps.db || db;
  const startedAtMs = Date.now();
  const cronRunId = await startCronRun(database, 'observatory-freeze', { trigger: scheduledByVercel(req) ? 'vercel-cron' : 'manual' });
  try {
    const out = await freezeClosedQuarters(database, deps.now || new Date(), { release: env.sentry?.release ?? null });
    // G14-OBS: the demand signals of every closed quarter are frozen (suppressed grid) and their daily counts deleted — independent of 0052; without 0062, nothing
    const demand = await (deps.freezeDemand || freezeDemandQuarters)(database, deps.now || new Date(), { release: env.sentry?.release ?? null });
    const demandOut = { available: demand.available, frozen: demand.frozen, deletedDailyRows: demand.deletedDailyRows };
    if (!out.available) {
      await finishCronRun(database, cronRunId, { status: 'skipped', skipReason: 'SCHEMA_MISSING', startedAtMs });
      return res.status(200).json({ success: true, skipped: 'schema_missing', frozen: [], alreadyFrozen: [], demand: demandOut });
    }
    await finishCronRun(database, cronRunId, { status: 'success', startedAtMs, metrics: { frozen: out.frozen.length, alreadyFrozen: out.alreadyFrozen.length, demandFrozen: demand.frozen.length, demandDailyDeleted: demand.deletedDailyRows } });
    logger.info('OBSERVATORY_FREEZE_END', { frozen: out.frozen.length, alreadyFrozen: out.alreadyFrozen.length });
    return res.status(200).json({ success: true, frozen: out.frozen, alreadyFrozen: out.alreadyFrozen, demand: demandOut });
  } catch (error) {
    logger.error('OBSERVATORY_FREEZE_FATAL', { name: error?.name });
    await finishCronRun(database, cronRunId, { status: 'failed', startedAtMs, error: error?.name || 'Error' });
    return res.status(500).json({ error: 'Observatory freeze failed' });
  }
}
