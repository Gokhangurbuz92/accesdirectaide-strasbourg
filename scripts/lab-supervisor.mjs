// @ts-nocheck
// LAB — the supervisor of the owner's LAB server, kept alive in the owner's macOS session by a user LaunchAgent (« lab-local autostart enable »:
// ~/Library/LaunchAgents/fr.accesdirectaide.lab.plist). It starts the LAB server (scripts/lab-server.mjs, 127.0.0.1 only) at login and keeps exactly one running:
//  - a LAB server already serving the port (started by hand in a Terminal) is left alone; anything else on the port is never touched;
//  - a native QA campaign has priority: while one runs (its launcher or its PostgreSQL, the veille's own detection QA_PROCESS) or after « server qa-handover »,
//    the server is stopped — the port is freed at once — and not restarted; it comes back by itself five minutes after the last QA process (or three hours
//    after a hand-over that no campaign used); the local model is unloaded so that no inference runs during the campaign. A launcher checks the port within a
//    second of its start, sooner than any watch can stop the server: « server qa-handover » before it (RC5_AUTHZ_QA/run_native_qa.sh does it) gives it the
//    port for sure; without it the first attempt may find the port busy and stop at its preflight, the server is then stopped and kept away, and the next
//    attempt gets the port;
//  - the owner's temporary stop (« server stop ») holds until « server start » or the next restart of the Mac;
//  - a crash is followed by a restart after 10 s, 30 s, 2 min, 5 min, then 15 min; six crashes in an hour hold it for an hour (never a loop); the database or the
//    build not ready is waited for, not counted as a crash;
//  - bounded logs (~/.ada-lab/logs: supervisor.log 1 MB and server.log 2 MB, three files each), every line redacted (secrets, tokens, passwords, database URLs).
// It changes no power, sleep or startup setting of the Mac: a Mac switched off, or with no open session, runs nothing (the veille catches the missed night up a few
// minutes after the next start).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { QA_PROCESS, unloadModel } from '../api/_services/verification/resources.js';

export const LABEL = 'fr.accesdirectaide.lab';
export const BACKOFF_S = [10, 30, 120, 300, 900];
export const CRASH_WINDOW_MS = 3600000;
export const CRASH_LIMIT = 6;
export const HOLD_MS = 3600000;
export const HANDOVER_MAX_MS = 3 * 3600000;
export const QA_END_GRACE_MS = 5 * 60000;
const TICK_MS = 2000;

// ------------------------------------------------------------------------------------------------------------------------------- rules (pure)
/** delay before the next start after the crashes listed (their times) @param {number[]} crashes @param {number} now */
export function restartDelay(crashes, now) {
  const recent = (crashes || []).filter((t) => now - t < CRASH_WINDOW_MS);
  if (!recent.length) return 0;
  if (recent.length >= CRASH_LIMIT) return HOLD_MS;
  return BACKOFF_S[Math.min(recent.length - 1, BACKOFF_S.length - 1)] * 1000;
}

/**
 * The QA hand-over marker: active while a campaign runs, then five minutes more (a launcher stopped at its preflight is run again on a free port); a hand-over
 * no campaign used expires after three hours.
 * @param {{ at: number, qaSeenAt?: number } | null} marker @param {{ qaRunning: boolean, now: number }} s
 * @returns {{ active: boolean, marker?: object, clear?: boolean, why?: string }}
 */
export function handover(marker, { qaRunning, now }) {
  if (!marker) return { active: false };
  if (qaRunning) return { active: true, marker: { ...marker, qaSeenAt: now } };
  if (marker.qaSeenAt) return now - marker.qaSeenAt >= QA_END_GRACE_MS ? { active: false, clear: true, why: 'campagne de QA terminée' } : { active: true };
  if (now - marker.at > HANDOVER_MAX_MS) return { active: false, clear: true, why: 'aucune campagne de QA dans les trois heures' };
  return { active: true };
}

/**
 * What to do now. @param {{ qa: boolean, stopped: boolean, child: null | 'running' | 'stopping', labElsewhere: boolean, portBusy: boolean, now: number, nextStartAt?: number }} s
 * @returns {{ action: 'start' | 'stop-child' | 'wait', state: string, fast?: boolean }}
 */
export function decide(s) {
  if (s.qa) return s.child === 'running' ? { action: 'stop-child', state: 'suspended-qa', fast: true } : { action: 'wait', state: 'suspended-qa' };
  if (s.stopped) return s.child === 'running' ? { action: 'stop-child', state: 'stopped' } : { action: 'wait', state: 'stopped' };
  if (s.child) return { action: 'wait', state: s.child === 'stopping' ? 'stopping' : 'running' };
  if (s.labElsewhere) return { action: 'wait', state: 'running-elsewhere' };
  if (s.portBusy) return { action: 'wait', state: 'port-busy' };
  if (s.nextStartAt && s.now < s.nextStartAt) return { action: 'wait', state: 'backoff' };
  return { action: 'start', state: 'starting' };
}

/** a log line without secrets: key=value / "key":"value" of sensitive keys, bearer tokens, JWTs, passwords inside URLs @param {string} line */
export function redact(line) {
  return String(line)
    .replace(/((?:pass(?:word|wd)?|secret|token|api[_-]?key|authorization|cookie|totp|mfa[_-]?(?:seed|secret)|encryption[_-]?key)["']?\s*[:=]\s*["']?)([^"'\s,;}]+)/gi, '$1[masqué]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [masqué]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jeton masqué]')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@/]+@/gi, '$1:[masqué]@');
}

/** append-only log of at most maxBytes per file, `keep` files (name, name.1, name.2) */
export class RotatingLog {
  constructor(file, { maxBytes = 1_000_000, keep = 3 } = {}) { this.file = file; this.maxBytes = maxBytes; this.keep = keep; }
  write(line) {
    try {
      const text = `${new Date().toISOString()} ${redact(line).replace(/\s+$/, '')}\n`;
      let size = 0; try { size = fs.statSync(this.file).size; } catch { /* new */ }
      if (size + text.length > this.maxBytes) {
        for (let i = this.keep - 1; i >= 1; i -= 1) { try { fs.renameSync(i === 1 ? this.file : `${this.file}.${i - 1}`, `${this.file}.${i}`); } catch { /* absent */ } }
      }
      fs.appendFileSync(this.file, text, { mode: 0o600 });
    } catch { /* a log must never stop the LAB */ }
  }
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** the LaunchAgent: the supervisor at login, restarted only after a crash (at most once a minute); no secret in it @param {{ node: string, root: string, envFile: string, log: string }} p */
export function plist({ node, root, envFile, log }) {
  const args = [node, '--import', 'tsx', path.join(root, 'scripts', 'lab-local.mjs'), 'supervise', '--env', envFile];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>TZ</key><string>Europe/Paris</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>ExitTimeOut</key><integer>30</integer>
  <key>ProcessType</key><string>Standard</string>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}

// ------------------------------------------------------------------------------------------------------------------------------- machine (read-only probes)
const run = (cmd, args) => new Promise((resolve) => { execFile(cmd, args, { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => resolve(err ? null : String(out || ''))); });
/** is a native QA campaign running? (the veille's own detection) */
export async function qaRunning() { const ps = await run('/bin/ps', ['-axo', 'command=']); return ps !== null && ps.split('\n').some((l) => QA_PROCESS.test(l)); }
/** the processes LISTENING on the port (read-only: nothing is bound to look) @param {number} port @returns {Promise<{ pid: number, lab: boolean }[]>} */
export async function listeners(port) {
  const out = await run('/usr/sbin/lsof', ['-nP', '-tiTCP:' + port, '-sTCP:LISTEN']);
  const pids = [...new Set(String(out || '').split('\n').map((x) => Number(x.trim())).filter(Boolean))];
  const res = [];
  for (const pid of pids) { const cmd = await run('/bin/ps', ['-p', String(pid), '-o', 'command=']); res.push({ pid, lab: /scripts\/lab-server\.mjs/.test(cmd || '') }); }
  return res;
}
/** the time the Mac started (a temporary stop does not outlive a restart) */
export async function bootTime() { const t = await run('/usr/sbin/sysctl', ['-n', 'kern.boottime']); return Number((String(t || '').match(/sec = (\d+)/) || [])[1] || 0); }
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f, v) => { try { fs.writeFileSync(f, JSON.stringify(v), { mode: 0o600 }); } catch { /* status only */ } };
const fmt = (ms) => (ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 1000)} s`);

/** the files of the supervisor next to the LAB configuration @param {string} envFile */
export function paths(envFile) {
  const dir = path.dirname(envFile);
  return { dir, run: path.join(dir, 'run'), logs: path.join(dir, 'logs'), lock: path.join(dir, 'run', 'supervisor.pid'), status: path.join(dir, 'run', 'supervisor.json'),
    stop: path.join(dir, 'run', 'stop'), handover: path.join(dir, 'run', 'qa-handover'), server: path.join(dir, 'run', 'server.json'), launchdLog: path.join(dir, 'logs', 'launchd.log') };
}

// ------------------------------------------------------------------------------------------------------------------------------- runtime
/**
 * Run the supervisor until SIGTERM (launchd at logout, « autostart disable »). @param {{ root: string, envFile: string, dist: string, readEnv: () => any,
 * serverEnv: (env: any) => any, checkDb: (env: any) => Promise<{ ok: boolean, why?: string }>, node?: string }} o
 */
export async function runSupervisor(o) {
  const P = paths(o.envFile);
  fs.mkdirSync(P.run, { recursive: true, mode: 0o700 }); fs.mkdirSync(P.logs, { recursive: true, mode: 0o700 });
  try { if (fs.statSync(P.launchdLog).size > 1_000_000) fs.truncateSync(P.launchdLog, 0); } catch { /* none yet */ }
  const log = new RotatingLog(path.join(P.logs, 'supervisor.log'), { maxBytes: 1_000_000 });
  const serverLog = new RotatingLog(path.join(P.logs, 'server.log'), { maxBytes: 2_000_000 });
  // one supervisor: the lock names a live supervisor, or it is taken over
  try { fs.writeFileSync(P.lock, String(process.pid), { flag: 'wx', mode: 0o600 }); } catch {
    const other = Number(fs.readFileSync(P.lock, 'utf8')) || 0;
    const cmd = other && alive(other) ? await run('/bin/ps', ['-p', String(other), '-o', 'command=']) : null;
    if (cmd && /lab-local\.mjs\s+supervise/.test(cmd) && other !== process.pid) { log.write(`un superviseur tourne déjà (pid ${other}) : rien à faire`); return 0; }
    fs.writeFileSync(P.lock, String(process.pid), { mode: 0o600 });
  }
  let port = 3000; try { port = Number(o.readEnv().LAB_PORT || 3000); } catch { /* waited for at start */ }
  const boot = await bootTime();
  const st = { state: null, since: Date.now(), child: null, crashes: [], nextStartAt: 0, note: null };
  const status = () => writeJson(P.status, { pid: process.pid, startedAt: new Date(st.since0 || Date.now()).toISOString(), state: st.state, stateSince: new Date(st.since).toISOString(),
    note: st.note, port, child: st.child ? { pid: st.child.pid, startedAt: new Date(st.child.startedAt).toISOString() } : null,
    crashesLastHour: st.crashes.filter((t) => Date.now() - t < CRASH_WINDOW_MS).length, lastCrash: st.crashes.length ? new Date(st.crashes.at(-1)).toISOString() : null,
    nextStartAt: st.nextStartAt && st.nextStartAt > Date.now() ? new Date(st.nextStartAt).toISOString() : null });
  st.since0 = Date.now();
  const setState = (state, note = null) => {
    if (state === st.state && note === st.note) return;
    st.state = state; st.note = note; st.since = Date.now(); status();
    log.write(`état : ${state}${note ? ` — ${note}` : ''}`);
  };
  log.write(`superviseur démarré (pid ${process.pid}, port ${port})`);

  const stopChild = (why) => {
    const c = st.child; if (!c || c.stopping) return;
    c.stopping = why; c.kill('SIGTERM');
    setTimeout(() => { if (!c.exited) { log.write(`serveur toujours là après l’arrêt demandé : arrêt forcé`); c.kill('SIGKILL'); } }, why === 'qa' ? 8000 : 20000).unref();
  };
  const startChild = async () => {
    if (!fs.existsSync(path.join(o.dist, 'index.html'))) { st.nextStartAt = Date.now() + 60000; return setState('waiting-build', 'site non construit : « lab-local build »'); }
    let env; try { env = o.readEnv(); } catch (e) { st.nextStartAt = Date.now() + 60000; return setState('waiting-config', String(e?.message || e).slice(0, 120)); }
    const db = await o.checkDb(env).catch((e) => ({ ok: false, why: String(e?.code || e?.message || e) }));
    if (!db.ok) { st.nextStartAt = Date.now() + 15000; return setState('waiting-db', db.why || 'base de données locale pas encore prête'); }
    const c = spawn(o.node || process.execPath, ['--import', 'tsx', path.join(o.root, 'scripts', 'lab-server.mjs')], { cwd: o.root, env: { ...o.serverEnv(env), LAB_SUPERVISED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    c.startedAt = Date.now(); st.child = c;
    const pipe = (stream) => { let buf = ''; stream.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { serverLog.write(buf.slice(0, i)); buf = buf.slice(i + 1); } }); };
    pipe(c.stdout); pipe(c.stderr);
    c.on('exit', (code, signal) => {
      c.exited = true; if (st.child === c) st.child = null;
      if (!c.stopping && code === 75) c.stopping = 'qa';   // the server stepped aside for a native QA campaign by itself
      if (c.stopping) {
        log.write(`serveur arrêté (${{ qa: 'campagne de QA native', owner: 'arrêt demandé', session: 'fin de session', restart: 'redémarrage demandé' }[c.stopping] || c.stopping})`);
        if (c.stopping === 'qa') unloadModel(env).catch(() => {});
        if (c.stopping === 'restart') st.nextStartAt = 0;
        status(); return;
      }
      const now = Date.now();
      if (now - c.startedAt > CRASH_WINDOW_MS) st.crashes = [];
      st.crashes = [...st.crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
      const delay = restartDelay(st.crashes, now); st.nextStartAt = now + delay;
      log.write(`serveur arrêté de façon inattendue (code ${code ?? '-'}${signal ? `, signal ${signal}` : ''}) : redémarrage dans ${fmt(delay)}${st.crashes.length >= CRASH_LIMIT ? ' (six pannes en une heure : attente d’une heure)' : ''} — voir logs/server.log`);
      status();
    });
    setState('running', `pid ${c.pid}`);
  };

  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const now = Date.now();
      const qa = await qaRunning();
      // a campaign seen without a hand-over: one is recorded, so that the port stays free until five minutes after it
      if (qa && !readJson(P.handover)) { writeJson(P.handover, { at: now, auto: true }); log.write('campagne de QA native détectée : le port lui est laissé'); }
      const h = handover(readJson(P.handover), { qaRunning: qa, now });
      if (h.marker) writeJson(P.handover, h.marker);
      if (h.clear) { try { fs.unlinkSync(P.handover); } catch { /* gone */ } log.write(`fin de la mise à disposition pour la QA : ${h.why}`); }
      const stopMark = readJson(P.stop);
      if (stopMark && stopMark.boot !== boot) { try { fs.unlinkSync(P.stop); } catch { /* gone */ } }
      const stopped = Boolean(stopMark && stopMark.boot === boot);
      const child = st.child ? (st.child.stopping ? 'stopping' : 'running') : null;
      let labElsewhere = false; let portBusy = false;
      if (!qa && !h.active && !stopped && !child) {
        const l = await listeners(port); labElsewhere = l.some((x) => x.lab); portBusy = l.length > 0 && !labElsewhere;
        // a server a previous supervisor started (it stopped without its server): replaced by one this supervisor manages; a Terminal's is left alone
        const srv = readJson(P.server);
        if (labElsewhere && srv?.supervised && l.some((x) => x.lab && x.pid === srv.pid) && !st.replacing) {
          st.replacing = true; log.write(`serveur d’un superviseur précédent (pid ${srv.pid}) : remplacé`);
          try { process.kill(srv.pid, 'SIGTERM'); } catch { /* gone */ }
          setTimeout(() => { st.replacing = false; }, 20000).unref();
        }
      }
      const d = decide({ qa: qa || h.active, stopped, child, labElsewhere, portBusy, now, nextStartAt: st.nextStartAt });
      if (d.action === 'stop-child') { setState(d.state, d.state === 'suspended-qa' ? 'campagne de QA native : le port 3000 lui est laissé' : 'arrêté à votre demande'); stopChild(d.fast ? 'qa' : 'owner'); }
      else if (d.action === 'start') await startChild();
      else setState(d.state, { 'suspended-qa': 'campagne de QA native : le serveur reviendra seul cinq minutes après elle', stopped: 'arrêté à votre demande (« server start » pour le relancer)',
        'running-elsewhere': 'un serveur LAB tourne déjà (lancé dans un Terminal)', 'port-busy': `le port ${port} est utilisé par un autre programme : attente`,
        backoff: `redémarrage prévu à ${new Date(st.nextStartAt).toLocaleTimeString('fr-FR')}` }[d.state] || (d.state === 'running' && st.child ? `pid ${st.child.pid}` : null));
    } catch (e) { log.write(`erreur du superviseur : ${String(e?.message || e).slice(0, 200)}`); }
    finally { busy = false; }
  };
  const timer = setInterval(tick, TICK_MS);
  await tick();

  return new Promise((resolve) => {
    const end = async (sig) => {
      clearInterval(timer); log.write(`superviseur arrêté (${sig})`);
      if (st.child) { stopChild('session'); const until = Date.now() + 25000; while (st.child && Date.now() < until) await new Promise((r) => setTimeout(r, 200)); }
      try { if (Number(fs.readFileSync(P.lock, 'utf8')) === process.pid) fs.unlinkSync(P.lock); } catch { /* gone */ }
      setState('off'); resolve(0);
    };
    process.once('SIGTERM', () => end('SIGTERM')); process.once('SIGINT', () => end('SIGINT'));
    // « server restart » (after a « build »): a new server at once, no crash counted
    process.on('SIGHUP', () => { log.write('redémarrage demandé'); stopChild('restart'); });
  });
}
