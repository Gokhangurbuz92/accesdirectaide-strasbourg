#!/usr/bin/env node
/**
 * G4 — a static server for a BUILT bundle (G4_DIST), with the SPA fallback, that RECORDS every request it receives (method, path + query, body) into
 * G4_SERVER_LOG (JSON lines). /api/* answers 404 JSON (no backend: the browser-only orientation must not need one). Loopback only; port G4_PORT (5200–5299).
 *   G4_DIST=<dist> G4_PORT=5231 G4_SERVER_LOG=<file> node e2e-g4/serve-dist.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const DIST = path.resolve(process.env.G4_DIST || 'dist');
const PORT = Number(process.env.G4_PORT || 5231);
const LOG = process.env.G4_SERVER_LOG || '';
if (!(PORT >= 5200 && PORT <= 5299)) throw new Error('G4_PORT must be in 5200–5299');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.xml': 'application/xml', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (LOG) fs.appendFileSync(LOG, `${JSON.stringify({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString('utf8') })}\n`);
    const url = new URL(req.url || '/', 'http://x');
    if (url.pathname.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not_found"}'); return; }
    let file = path.join(DIST, decodeURIComponent(url.pathname));
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`g4 serve-dist on http://127.0.0.1:${PORT} (${DIST})`));
