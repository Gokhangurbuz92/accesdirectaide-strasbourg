// @ts-nocheck
/**
 * Automatic verification chain — the machine it runs on (the owner's Mac mini in the LAB). Read-only probes (statfs, sysctl, ps), each failing open to « unknown »
 * except where the answer protects something else:
 *  - disk: the veille does not run below ADA_VEILLE_MIN_FREE_GB free (default 10 GiB): the native QA campaigns refuse to start under 8 GiB and the veille must
 *    never be the reason they cannot run;
 *  - native QA: while a campaign runs (its launcher ADA_RC…_QA_v….command, or its PostgreSQL under RC5_AUTHZ_QA/runs/…) the veille does not start, and a run in
 *    progress stops at the next record (it continues at the next tick once the campaign is over);
 *  - memory: the local model (about 6 GiB) is LOADED only when macOS reports at least ADA_VEILLE_MIN_MEMORY_PCT % of memory available (default 25); once it is
 *    loaded its own memory counts against that figure, so it keeps writing until macOS reports a critical memory pressure or swap use exceeds
 *    ADA_VEILLE_MAX_SWAP_GB (default 12) — then the remaining texts wait for the next run (the records keep their state);
 *  - processor: the model uses ADA_VEILLE_MODEL_THREADS threads, by default half of the cores during the day (07:00–23:00) and all of them at night;
 *  - the model is unloaded at the end of a run (Ollama keep_alive 0) so that its memory goes back to the machine at once.
 * ADA_VEILLE_RESOURCE_GUARD=off disables the probes (tests, servers without these tools); the LAB server and the LAB command line turn them on.
 */
import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';

const GIB = 1024 ** 3;
const run = (cmd, args, timeout = 4000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : String(stdout || '')));
});
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && v !== '' && v !== undefined && v !== null ? n : d; };

/** a native QA campaign of this project: its launcher, or the PostgreSQL of one of its runs */
export const QA_PROCESS = /ADA_RC\d+[A-Z0-9_]*_QA_v\d+\.command|RC5_AUTHZ_QA\/runs\/[^/\s]+\/pgdata/;

export const guardEnabled = (env = process.env) => String(env.ADA_VEILLE_RESOURCE_GUARD || 'off').toLowerCase() === 'on';
export const limits = (env = process.env) => ({
  // swap: macOS keeps swap allocated long after a pressure passed, so it is a safety valve, not the main signal (the pressure level is; swap files also take disk
  // space, which the disk floor watches at every heartbeat)
  minFreeGb: num(env.ADA_VEILLE_MIN_FREE_GB, 10), minMemoryPct: num(env.ADA_VEILLE_MIN_MEMORY_PCT, 25), maxSwapGb: num(env.ADA_VEILLE_MAX_SWAP_GB, 12),
});

/** swap in use, in GiB, from `sysctl vm.swapusage` (« total = 2048.00M  used = 1024.00M  free = … ») @param {string | null} text */
export function parseSwap(text) {
  const m = String(text || '').match(/used\s*=\s*([\d.]+)([MG])/i);
  if (!m) return null;
  return Number(m[1]) / (m[2].toUpperCase() === 'G' ? 1 : 1024);
}

/** @param {{ env?: any, dir?: string }} [opts] */
export async function probe(opts = {}) {
  const env = opts.env || process.env;
  const out = { at: new Date().toISOString(), disk: null, memory: null, load: null, qa: null };
  try {
    const st = await fs.promises.statfs(opts.dir || env.ADA_LOCAL_STORAGE_DIR || os.homedir());
    out.disk = { freeGb: Math.round((st.bavail * st.bsize / GIB) * 10) / 10 };
  } catch { /* unknown */ }
  const cores = os.cpus().length || 1;
  out.load = { one: Math.round(os.loadavg()[0] * 100) / 100, cores };
  if (process.platform === 'darwin') {
    const level = await run('sysctl', ['-n', 'kern.memorystatus_level']);
    const swap = await run('sysctl', ['-n', 'vm.swapusage']);
    const pressure = await run('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level']);   // 1 normal, 2 warning, 4 critical
    out.memory = { availablePct: level !== null && level.trim() !== '' ? Number(level.trim()) : null, swapUsedGb: swap !== null ? parseSwap(swap) : null,
      pressure: pressure !== null && pressure.trim() !== '' ? Number(pressure.trim()) : null };
  } else {
    try {
      const mi = fs.readFileSync('/proc/meminfo', 'utf8'); const kb = (k) => Number((mi.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm')) || [])[1] || 0);
      out.memory = { availablePct: kb('MemTotal') ? Math.round(kb('MemAvailable') / kb('MemTotal') * 100) : null, swapUsedGb: Math.round(((kb('SwapTotal') - kb('SwapFree')) / 1024 / 1024) * 100) / 100 };
    } catch { out.memory = { availablePct: Math.round(os.freemem() / os.totalmem() * 100), swapUsedGb: null }; }
  }
  // is the local model already in memory? (then its own size is part of the « used » memory)
  try {
    const base = new URL(env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
    if (['127.0.0.1', 'localhost', '::1', '[::1]'].includes(base.hostname)) {
      const r = await fetch(new URL('/api/ps', base), { signal: AbortSignal.timeout(1500) });
      if (r.ok) { const j = await r.json(); out.model = { loaded: (j.models || []).some((m) => /qwen3/.test(String(m.name || m.model || ''))) }; }
    }
  } catch { /* unknown */ }
  const ps = await run('ps', ['-axo', 'command=']);
  if (ps !== null) {
    const hit = ps.split('\n').find((l) => QA_PROCESS.test(l));
    out.qa = { running: Boolean(hit), detail: hit ? (hit.match(QA_PROCESS) || [''])[0].slice(0, 120) : null };
  }
  return out;
}

/**
 * May the veille run now? 'start': before a run and at every heartbeat (disk floor, native QA); 'texts': before writing texts with the local model (memory, swap).
 * @param {any} p a probe() result @param {'start' | 'texts'} what @param {any} [env] @returns {{ ok: boolean, code?: string, reason?: string }}
 */
export function allowed(p, what, env = process.env) {
  const l = limits(env);
  if (!p) return { ok: true };
  if (what === 'start') {
    if (p.qa?.running) return { ok: false, code: 'NATIVE_QA_RUNNING', reason: `une campagne de QA native est en cours (${p.qa.detail || 'processus de QA'}) : la veille attend qu’elle se termine` };
    if (p.disk && p.disk.freeGb < l.minFreeGb) return { ok: false, code: 'DISK_LOW', reason: `espace disque libre ${p.disk.freeGb} Gio, sous le minimum de ${l.minFreeGb} Gio (la QA native en exige 8)` };
    return { ok: true };
  }
  if (what === 'texts') {
    if (p.memory?.pressure >= 4) return { ok: false, code: 'MEMORY_CRITICAL', reason: 'pression mémoire critique signalée par macOS' };
    // the room to LOAD the model; once loaded, its own memory is part of what macOS no longer counts as available
    if (!p.model?.loaded && p.memory?.availablePct !== null && p.memory?.availablePct !== undefined && p.memory.availablePct < l.minMemoryPct) return { ok: false, code: 'MEMORY_LOW', reason: `mémoire disponible ${p.memory.availablePct} %, sous ${l.minMemoryPct} % : pas assez de place pour charger le modèle local` };
    if (p.memory?.swapUsedGb !== null && p.memory?.swapUsedGb !== undefined && p.memory.swapUsedGb > l.maxSwapGb) return { ok: false, code: 'SWAP_HIGH', reason: `mémoire d’échange utilisée ${Math.round(p.memory.swapUsedGb * 10) / 10} Gio, au-dessus de ${l.maxSwapGb} Gio` };
    return { ok: true };
  }
  return { ok: true };
}

/** the local model's threads: ADA_VEILLE_MODEL_THREADS, else half of the cores in the day and all of them at night @param {any} [env] @param {Date} [now] */
export function modelOptions(env = process.env, now = new Date()) {
  const set = num(env.ADA_VEILLE_MODEL_THREADS, null);
  if (set && set > 0) return { num_thread: Math.floor(set) };
  const cores = os.cpus().length || 2; const h = now.getHours();
  return h >= 7 && h < 23 ? { num_thread: Math.max(2, Math.floor(cores / 2)) } : {};
}

/** give the model's memory back now (Ollama keep_alive 0), loopback only; never throws @param {any} [env] @param {string} [model] */
export async function unloadModel(env = process.env, model = 'qwen3:8b') {
  const base = env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  try {
    const u = new URL(base);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname)) return false;
    const r = await fetch(new URL('/api/generate', u), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }), signal: AbortSignal.timeout(10000) });
    return r.ok;
  } catch { return false; }
}
