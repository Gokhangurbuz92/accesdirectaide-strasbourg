// PKG-5 — LOCAL LAB server for the owner's own machine (never deployed): binds 127.0.0.1 ONLY, serves the production build (~/.ada-lab/dist, LAB_DIST) and the PRODUCTION API entry
// (api/index.js: CORS, CSRF, validation registry, handlers) on the owner's LOCAL PostgreSQL. Started by `node --import tsx scripts/lab-local.mjs start` (Ctrl+C stops it).
// Refuses to start with mock flags, a production profile or a non-local database. Same request handling as the native-QA server (.qa/qa_server.mjs of the RC launchers).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const HOST = '127.0.0.1', PORT = Number(process.env.LAB_PORT || 3000), DIST = path.resolve(process.env.LAB_DIST || 'dist-lab');
const fail = (m) => { console.error('refusing to start: ' + m); process.exit(3); };
if (process.env.USE_MOCKS || process.env.VITE_USE_MOCKS) fail('mock flags set');
if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') fail('production profile');
try { const h = new URL(process.env.DATABASE_URL || '').hostname; if (!['127.0.0.1', 'localhost', '::1'].includes(h)) fail('the database is not local'); } catch { fail('DATABASE_URL missing'); }
if (!fs.existsSync(path.join(DIST, 'index.html'))) fail(`no build in ${DIST} (run: node --import tsx scripts/lab-local.mjs build)`);
const { default: api } = await import('../api/index.js');
// P22: the record pages' initial HTML (canonical, title, description, 404 / 410), as the hosting's rewrite to /api/public/page does
const pageHead = await import('../api/_services/page-head.js'); const { db: pageDb } = await import('../src/db/index.js');
// the SHIPPED vercel.json page headers (CSP, frame, referrer, permissions…) on every page, as in production; HSTS and upgrade-insecure-requests are dropped: the LAB serves plain
// http on 127.0.0.1 (the browser would otherwise rewrite every request to https)
const SHIPPED = (() => { try { const v = JSON.parse(fs.readFileSync(path.resolve('vercel.json'), 'utf8')); return (v.headers || []).filter((x) => x.source === '/(.*)').flatMap((x) => x.headers)
  .filter((x) => x.key !== 'Strict-Transport-Security').map((x) => [x.key, x.key === 'Content-Security-Policy' ? x.value.replace(/\s*upgrade-insecure-requests;?/g, '').trim() : x.value]); } catch { return []; } })();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const STARTED = new Date().toISOString();
// set once the schedule is loaded (end of this file); a request or a stop may come before
let veilleRunning = () => false; let requestStop = () => {};
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${HOST}:${PORT}`); req.query = Object.fromEntries(u.searchParams);
  // liveness for the LAB supervisor and « lab-local server status » (this process only; no data, no secret)
  if (u.pathname === '/__lab/health') {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ lab: true, pid: process.pid, startedAt: STARTED, veilleRunning: veilleRunning() }));
  }
  // like a trusted proxy: the client address is the socket's, never a client-supplied X-Forwarded-For (the per-address limits of sign-in, MFA, forms rely on it)
  req.headers['x-forwarded-for'] = req.socket?.remoteAddress || '127.0.0.1';
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (d) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(d)); return res; };
  res.send = (d) => { res.end(d); return res; };
  try {
    if (u.pathname.startsWith('/api') || u.pathname === '/robots.txt' || u.pathname === '/sitemap.xml') {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) { const ch = []; for await (const c of req) ch.push(c); const raw = Buffer.concat(ch).toString(); try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; } }
      return await api(req, res);
    }
    for (const [k, v] of SHIPPED) res.setHeader(k, v);
    if (pageHead.recordPath(u.pathname) && (req.method === 'GET' || req.method === 'HEAD')) {
      const h = await pageHead.pageHead({ db: pageDb, pathname: u.pathname, origin: `http://${HOST}:${PORT}` });
      if (h.status === 301) { res.writeHead(301, { Location: h.location }); return res.end(); }
      const headers = pageHead.pageHeaders(h);
      if (req.headers['if-none-match'] === h.etag) { res.writeHead(304, headers); return res.end(); }
      res.writeHead(h.status, headers);
      return res.end(req.method === 'HEAD' ? undefined : pageHead.renderPage(fs.readFileSync(path.join(DIST, 'index.html'), 'utf8'), h));
    }
    let f = path.join(DIST, decodeURIComponent(u.pathname));
    if (!f.startsWith(DIST)) { res.statusCode = 403; return res.end(); }
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      // SPA fallback only for extension-less navigation routes; platform paths (/_vercel/… exist only on Vercel) and missing files are 404
      if (u.pathname.startsWith('/_vercel/') || path.extname(u.pathname) !== '') { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); return res.end('not found'); }
      f = path.join(DIST, 'index.html');
    }
    res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
  } catch (e) { if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'lab-server-error' })); } console.error('handler error', e && e.message); }
});
// which process serves the LAB (for « lab-local server status » and the supervisor): written once listening, removed at exit
const RUN_FILE = process.env.LAB_RUN_DIR ? path.join(process.env.LAB_RUN_DIR, 'server.json') : null;
const dropRunFile = () => { try { if (RUN_FILE && JSON.parse(fs.readFileSync(RUN_FILE, 'utf8')).pid === process.pid) fs.unlinkSync(RUN_FILE); } catch { /* not ours or gone */ } };
const sockets = new Set();
server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
// an idle keep-alive connection is left for the client to close (a browser keeps one a few minutes): a close by the server would leave TIME_WAIT on the port
// itself, which a native QA launcher (bind without SO_REUSEADDR) reads as busy; at shutdown the open ones are reset
server.keepAliveTimeout = 15 * 60000;
server.on('error', (e) => { console.error(`refusing to start: ${e.code === 'EADDRINUSE' ? `port ${PORT} déjà utilisé` : e.message}`); process.exit(3); });
server.listen(PORT, HOST, () => {
  if (RUN_FILE) { try { fs.mkdirSync(path.dirname(RUN_FILE), { recursive: true, mode: 0o700 }); fs.writeFileSync(RUN_FILE, JSON.stringify({ pid: process.pid, host: HOST, port: PORT, startedAt: STARTED, supervised: process.env.LAB_SUPERVISED === '1' }), { mode: 0o600 }); } catch { /* status only */ } }
  console.log(`AccesDirectAide LAB : http://${HOST}:${PORT}  (administration : http://${HOST}:${PORT}/admin/login) — Ctrl+C pour arrêter`);
});
process.on('exit', dropRunFile);
// a stop of the server (Ctrl+C, the LAB supervisor, a native QA campaign that needs the port): no new connection and the open ones reset at once — the port is
// free immediately, with no TIME_WAIT left (the QA launchers bind it without SO_REUSEADDR) —, the veille in progress asked to stop at its next record (it is
// continued at the next start: SERVER_STOP is not the owner's stop), then exit after at most LAB_STOP_GRACE_MS (15 s by default)
let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return; stopping = true;
  // reset BEFORE close: http.Server.close() ends the idle keep-alive connections itself, with a FIN (TIME_WAIT on the port)
  const reset = () => { for (const s of sockets) { try { s.resetAndDestroy(); } catch { s.destroy(); } } };
  reset(); server.close(); reset();
  dropRunFile();
  requestStop('SERVER_STOP', 'arrêt du serveur LAB : la veille reprendra au prochain démarrage');
  const until = Date.now() + Number(process.env.LAB_STOP_GRACE_MS || 15000);
  while (veilleRunning() && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
  process.exit(code);
}
process.on('SIGTERM', () => shutdown(0)); process.on('SIGINT', () => shutdown(0));
// a native QA campaign has priority on the port: a server started in a Terminal steps aside as soon as one starts (exit code 75); a supervised one is stopped
// by its supervisor (scripts/lab-supervisor.mjs), which also keeps it away until the campaign is over. LAB_QA_PRIORITY=off disables it.
if (process.env.LAB_QA_PRIORITY !== 'off' && process.env.LAB_SUPERVISED !== '1') {
  const { QA_PROCESS } = await import('../api/_services/verification/resources.js');
  const { execFile } = await import('node:child_process');
  const qaWatch = setInterval(() => execFile('/bin/ps', ['-axo', 'command='], { timeout: 4000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
    if (err || stopping || !String(out).split('\n').some((l) => QA_PROCESS.test(l))) return;
    clearInterval(qaWatch); console.log(`[lab] campagne de QA native : le serveur LAB s’arrête et laisse le port ${PORT}`); shutdown(75);
  }), 2000);
  qaWatch.unref();
}
// automatic verification (« veille automatique », api/_services/verification/chain.js): every night at 03:17 in this process, and once a few minutes after start
// when the last complete run is more than a day old; it reads official public sources only (ADA_VEILLE=off stops the schedule only; ADA_VERIFICATION_NETWORK=off stops every run, whoever starts it)
// and when the Mac wakes up or the server starts after a missed night; never during a native QA campaign, never under the disk floor, the model only with free
// memory (api/_services/verification/resources.js); the owner's pause (/admin/veille or « lab-local veille pause ») stops it
process.env.ADA_VEILLE_RUNNER = 'inline';
process.env.ADA_VEILLE_RESOURCE_GUARD = process.env.ADA_VEILLE_RESOURCE_GUARD || 'on';
const schedule = await import('../api/_services/verification/schedule.js');
const control = await import('../api/_services/verification/control.js');
veilleRunning = schedule.veilleRunning; requestStop = control.requestStop;
if (!stopping) schedule.scheduleVeille({ log: (m) => console.log(`[veille] ${m}`) });
