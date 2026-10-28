// @ts-nocheck
/**
 * Automatic verification chain — the schedule of the owner's LAB server (scripts/lab-server.mjs): one run for every 03:17 (Europe/Paris, the server's local
 * time). A tick every five minutes asks « is a run due? » instead of one long timer: a Mac asleep at 03:17 runs the veille when it wakes up, a Mac switched off
 * runs it a few minutes after the server starts, a run held back (native QA campaign, little disk space, the owner's pause) starts as soon as it may.
 * Due: no run started since the last 03:17 that finished (success, partial — its time was up —, stopped by the owner, or error: one more try an hour later),
 * nothing running, not paused. A run « interrupted » (server stopped, Mac switched off) is not a finished one: the next tick continues it; nor is a run stopped
 * for the machine (a native QA campaign, the disk floor) or by the LAB server's own shutdown (control.js OWNER_STOPS: only the owner's pause or stop ends a night).
 * ADA_VEILLE=off disables the schedule; ADA_VERIFICATION_NETWORK=off disables every request to the official sources (the runs then stop at once).
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../../src/db/index.js';
import { CronRun } from '../../../src/db/schema.js';
import { runVeille } from './chain.js';
import { pauseState, STALE_MINUTES, OWNER_STOPS } from './control.js';
import { bumpContentEpoch } from '../../lib/search-cache.js';

export const NIGHTLY = { hour: 3, minute: 17 };
const TICK_MS = 5 * 60000;

let running = null;
/** start a run now unless one is running in this process (returns its promise) @param {{ trigger?: string, log?: Function, db?: any }} [opts] */
export function startVeille(opts = {}) {
  if (running) return running;
  const log = opts.log || (() => {});
  running = runVeille({ db: opts.db || defaultDb, trigger: opts.trigger || 'lab-schedule', log: opts.verbose ? log : undefined })
    .then(async (r) => {
      if (r.ok) await bumpContentEpoch().catch(() => {});
      const c = r.counts || {};
      const sum = (re) => Object.entries(c).filter(([k]) => re.test(k)).reduce((n, [, v]) => n + v, 0);
      log(r.skipped ? `pas de veille : ${r.message || r.skipped}` : `veille ${r.status} en ${Math.round((r.durationMs || 0) / 60000)} min — vérifiées ${sum(/^(aide|demarche|dispositif|structure):checked$/)}, publiées ${sum(/:PUBLISHED$/)}, mises à jour ${sum(/:(UPDATED|CORRECTED)$/)}, retirées ${sum(/:WITHDRAWN$/)}, ajoutées ${sum(/:CREATED$/)}, à réessayer ${sum(/:(RETRY|UNRESOLVED)$/)}${r.stop ? ` — arrêtée : ${r.stop.reason}` : ''}`);
      return r;
    })
    .catch((e) => { log(`veille interrompue : ${String(e?.message || e).slice(0, 200)}`); return { ok: false }; })
    .finally(() => { running = null; });
  return running;
}
export const veilleRunning = () => Boolean(running);

/** next 03:17 local time after `from` */
export function nextNightly(from = new Date(), hour = NIGHTLY.hour, minute = NIGHTLY.minute) {
  const n = new Date(from); n.setHours(hour, minute, 0, 0);
  if (n <= from) n.setDate(n.getDate() + 1);
  return n;
}
/** the last 03:17 local time at or before `at` */
export function lastSlot(at = new Date(), hour = NIGHTLY.hour, minute = NIGHTLY.minute) {
  const n = new Date(at); n.setHours(hour, minute, 0, 0);
  if (n > at) n.setDate(n.getDate() - 1);
  return n;
}

/**
 * Is a run due now? Pure: the runs started since the last slot decide. @param {{ startedAt: Date, updatedAt?: Date, status: string, skipReason?: string | null }[]} runsSinceSlot
 * newest first @param {Date} [now] @returns {{ due: boolean, why: string }}
 */
export function dueNow(runsSinceSlot, now = new Date()) {
  // a « running » run whose heartbeat stopped (its process died) is not running: the next start closes it as interrupted and continues the work
  const alive = (r) => r.status === 'running' && now.getTime() - new Date(r.updatedAt || r.startedAt).getTime() < STALE_MINUTES * 60000;
  const real = (runsSinceSlot || []).filter((r) => r.status !== 'skipped' && (r.status !== 'running' || alive(r)));
  if (real.some((r) => r.status === 'running')) return { due: false, why: 'une veille est en cours' };
  // stopped: the night's run only when the owner stopped it (pause, stop; a row without its reason is from before the reasons were kept)
  // R12: only a run of ALL the steps is the night's veille (a run of some steps — « --only », a rehearsal — is not; rows from before the scope was kept count as full)
  const finished = (r) => r.scope !== 'partial' && (['success', 'partial'].includes(r.status) || (r.status === 'stopped' && (!r.skipReason || OWNER_STOPS.includes(r.skipReason))));
  if (real.some(finished)) return { due: false, why: 'la veille de cette nuit est faite' };
  const errors = real.filter((r) => r.status === 'error');
  if (errors.length >= 2) return { due: false, why: 'deux veilles en erreur cette nuit : nouvel essai à la prochaine' };
  if (errors.length === 1 && now.getTime() - new Date(errors[0].startedAt).getTime() < 3600000) return { due: false, why: 'une veille en erreur il y a moins d’une heure' };
  return { due: true, why: real.length ? 'reprise de la veille de cette nuit' : 'veille de cette nuit' };
}

/** @param {any} db @param {Date} [now] */
export async function isDue(db, now = new Date()) {
  const slot = lastSlot(now);
  const rows = await db.select({ startedAt: CronRun.startedAt, updatedAt: CronRun.updatedAt, status: CronRun.status, skipReason: CronRun.skipReason, scope: sql`${CronRun.metrics}->>'scope'` }).from(CronRun).where(and(eq(CronRun.job, 'veille'), gte(CronRun.startedAt, slot))).orderBy(desc(CronRun.startedAt)).limit(20);
  return { ...dueNow(rows, now), slot };
}

/** the next run the schedule will start (for the owner's page): now if due, else the next 03:17 @param {any} db */
export async function nextRunAt(db = defaultDb, now = new Date()) {
  const pause = await pauseState(db);
  if (pause.paused) return { at: null, why: 'en pause' };
  const d = await isDue(db, now);
  return d.due ? { at: now.toISOString(), why: d.why } : { at: nextNightly(now).toISOString(), why: d.why };
}

/** @param {{ log?: Function, db?: any, firstTickMs?: number, tickMs?: number }} [opts] */
export function scheduleVeille(opts = {}) {
  const env = process.env; const log = opts.log || (() => {});
  if (String(env.ADA_VEILLE || 'on').toLowerCase() === 'off') { log('veille automatique désactivée (ADA_VEILLE=off)'); return null; }
  const db = opts.db || defaultDb;
  const tick = async () => {
    if (running) return;
    try {
      if ((await pauseState(db)).paused) return;
      const d = await isDue(db);
      if (d.due) { log(`${d.why} : veille lancée`); startVeille({ db, log, trigger: 'lab-schedule' }); }
    } catch (e) { log(`veille non lancée (${String(e?.message || e).slice(0, 120)})`); }
  };
  const first = setTimeout(tick, opts.firstTickMs ?? 180000); first.unref?.();
  const every = setInterval(tick, opts.tickMs ?? TICK_MS); every.unref?.();
  // the first line says what happens next: a missed night caught up in a few minutes, the pause, or the next 03:17
  const firstMin = Math.round((opts.firstTickMs ?? 180000) / 60000);
  Promise.all([pauseState(db), isDue(db)])
    .then(([p, d]) => log(`veille automatique : chaque nuit à 3 h 17 (heure de Paris), reprise automatique après une mise en veille ou un arrêt du Mac (${p.paused ? 'en pause : « veille resume » pour reprendre'
      : d.due ? `${d.why} : elle démarre dans ${firstMin} min` : `prochaine : ${nextNightly().toLocaleString('fr-FR')}`})`))
    .catch(() => log(`veille automatique : chaque nuit à 3 h 17, reprise automatique après une mise en veille ou un arrêt du Mac (prochaine : ${nextNightly().toLocaleString('fr-FR')})`));
  return { tick, stop: () => { clearTimeout(first); clearInterval(every); } };
}
