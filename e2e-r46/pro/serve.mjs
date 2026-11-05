#!/usr/bin/env node
/**
 * R46 pro — LAB server for the browser journeys of e2e-r46/pro: the BUILT app (dist/) and the REAL API entry (api/index.js: origin gate, CSRF, beta gate,
 * capability gate, rate limits, handlers) in one loopback origin, on R46_PRO_PORT (default 5186; never 3000).
 * The API's development origin allowlist names :5173 only, so a same-origin API request is presented to it with that development origin (LAB harness
 * only). Refuses to start outside a loopback LAB database.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, process.env.R46_DIST || 'dist');
const PORT = Number(process.env.R46_PRO_PORT || 5186);
if (PORT === 3000) throw new Error('port 3000 is reserved');
const db = new URL(String(process.env.DATABASE_URL || 'postgres://x@invalid/x'));
if (!['127.0.0.1', 'localhost'].includes(db.hostname) || !/(^|_)(lab|test|e2e)(_|$)/i.test(db.pathname.slice(1))) throw new Error('LAB loopback database only');
if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') throw new Error('not in production');
const { default: api } = await import('../../api/index.js');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

http.createServer(async (req, res) => {
  const u = new URL(String(req.url), `http://127.0.0.1:${PORT}`);
  if (u.pathname.startsWith('/api/') || u.pathname === '/api') {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    /** @type {any} */ const r = req; /** @type {any} */ const s = res;
    r.query = Object.fromEntries(u.searchParams);
    try { r.body = raw ? JSON.parse(raw) : {}; } catch { r.body = {}; }
    if (r.headers.origin === `http://127.0.0.1:${PORT}`) r.headers.origin = 'http://127.0.0.1:5173';
    s.status = (/** @type {number} */ c) => { res.statusCode = c; return s; };
    s.json = (/** @type {any} */ d) => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(d)); return s; };
    s.send = (/** @type {any} */ d) => { res.end(typeof d === 'string' || Buffer.isBuffer(d) ? d : JSON.stringify(d)); return s; };
    try { await api(r, s); } catch (e) { if (!res.headersSent) { res.statusCode = 500; res.end('{"error":"server"}'); } console.error('[serve]', e instanceof Error ? e.name : 'Error'); }
    return;
  }
  let f = path.join(DIST, decodeURIComponent(u.pathname));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[/** @type {keyof typeof TYPES} */ (path.extname(f))] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`R46 pro LAB server http://127.0.0.1:${PORT}`));
