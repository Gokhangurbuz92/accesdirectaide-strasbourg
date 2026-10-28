// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { resolveAuthContext, isAdminRole } from '../../_utils/auth.js';
import { db } from '../../../src/db/index.js';
import { veilleDigest, recordHistory } from '../../_services/verification/digest.js';
import { pauseState, setPause, requestStop } from '../../_services/verification/control.js';
import { SEED_SOURCES } from '../../_services/verification/sources.js';
import { guardEnabled, probe } from '../../_services/verification/resources.js';

const KINDS = new Set(['aide', 'demarche', 'dispositif', 'structure']);

/**
 * Automatic verification — the owner's dashboard (« Veille automatique »).
 *   GET  /api/admin/veille                      the state (running, paused, last and next run), the alerts that matter, what was checked, published, corrected,
 *                                               added, withdrawn and merged, freshness, the registry of sources, the texts the checks refused, the machine, the
 *                                               self-check (?days=1..60)
 *   GET  /api/admin/veille?history=<kind>:<id>  one record's history from its sources to the decisions (events, ledger, source versions, content versions)
 *   POST /api/admin/veille { action: 'run' }    start a run now (LAB server only, where the run happens in this process: ADA_VEILLE_RUNNER=inline)
 *   POST /api/admin/veille { action: 'pause', reason? } | { action: 'resume' }   the owner's emergency stop and its end (any runner: the pause is in the database)
 * POST needs an administrator session with MFA. Nothing here validates, refuses or holds a record: those decisions are the chain's, with their evidence.
 * @param {import('../../_utils/http-types').ApiRequest} req @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const rateLimit = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rateLimit.allowed) return res.status(getRateLimitStatus(rateLimit)).json(rateLimit.error);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await resolveAuthContext(req);
  if (!auth || !isAdminRole(auth.role) || !['admin_jwt', 'admin_token'].includes(String(auth.authType))) return res.status(401).json({ error: 'Unauthorized' });
  const inline = process.env.ADA_VEILLE_RUNNER === 'inline';
  try {
    if (req.method === 'GET') {
      const h = String(req.query?.history || '');
      if (h) {
        const [kind, ...rest] = h.split(':'); const id = rest.join(':');
        if (!KINDS.has(kind) || !id || id.length > 80) return res.status(400).json({ error: 'BAD_HISTORY_REF' });
        const r = await recordHistory({ db, type: kind, id });
        return r ? res.status(200).json(r) : res.status(404).json({ error: 'NOT_FOUND' });
      }
      const d = await veilleDigest({ db, days: Math.min(Math.max(Number(req.query?.days) || 7, 1), 60), probe: inline && guardEnabled() ? probe : null });
      const { veilleRunning, nextRunAt } = await import('../../_services/verification/schedule.js');
      const next = inline ? await nextRunAt(db).catch(() => null) : null;
      return res.status(200).json({ ...d, running: veilleRunning() || Boolean(d.status.running), runner: inline ? 'inline' : 'cron', next,
        seed: SEED_SOURCES.map((s) => ({ sourceId: s.sourceId, name: s.name, level: s.level, domains: s.domains, attestation: s.attestation, frequency: s.frequency, capabilities: s.capabilities })) });
    }
    if (auth.authType !== 'admin_jwt' || auth.mfa_verified !== true) return res.status(403).json({ error: 'MFA_SESSION_REQUIRED', message: 'Session administrateur avec MFA requise.' });
    const action = String(req.body?.action || '');
    const who = `admin:${auth.email || auth.id || 'admin'}`;
    if (action === 'pause') {
      const p = await setPause(db, { paused: true, by: who, reason: String(req.body?.reason || 'mise en pause depuis la page de la veille').slice(0, 200) });
      requestStop();
      logger.info({ veille: 'pause' }, '[Veille] paused by the owner');
      return res.status(200).json({ ok: true, paused: p });
    }
    if (action === 'resume') {
      await setPause(db, { paused: false, by: who });
      logger.info({ veille: 'resume' }, '[Veille] resumed by the owner');
      return res.status(200).json({ ok: true, paused: await pauseState(db) });
    }
    if (action !== 'run') return res.status(400).json({ error: 'UNKNOWN_ACTION' });
    if (!inline) return res.status(409).json({ error: 'RUNNER_NOT_AVAILABLE', message: 'Sur ce serveur, la veille ne se lance pas depuis cette page : elle est exécutée par la tâche planifiée /api/cron/veille, qui doit être programmée dans l’hébergement (docs/deployment.md).' });
    if ((await pauseState(db)).paused) return res.status(409).json({ error: 'PAUSED', message: 'La veille est en pause : reprenez-la d’abord.' });
    const { startVeille, veilleRunning } = await import('../../_services/verification/schedule.js');
    if (veilleRunning()) return res.status(200).json({ ok: true, alreadyRunning: true });
    startVeille({ trigger: who, log: (m) => logger.info({ veille: m }, '[Veille]') });
    return res.status(202).json({ ok: true, started: true });
  } catch (error) {
    logger.error({ err: { name: error?.name, message: String(error?.message || '').slice(0, 200) } }, '[Veille] failed');
    return res.status(500).json({ error: 'VEILLE_FAILED' });
  }
}
