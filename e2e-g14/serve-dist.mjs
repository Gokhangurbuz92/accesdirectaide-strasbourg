#!/usr/bin/env node
/**
 * G14-LITE — a static server for a BUILT bundle (G14_DIST, default dist) with the SPA fallback and the shipped vercel.json page headers (CSP included,
 * HSTS / upgrade-insecure-requests dropped: plain http on loopback). /api/* answers 404 JSON: the offline spec answers the API itself (page routes).
 * Loopback only; port G14_PORT (5240–5249, never 3000).
 *   G14_DIST=dist G14_PORT=5246 node e2e-g14/serve-dist.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const DIST = path.resolve(process.env.G14_DIST || 'dist');
const PORT = Number(process.env.G14_PORT || 5246);
if (!(PORT >= 5240 && PORT <= 5249)) throw new Error('G14_PORT must be in 5240–5249');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.xml': 'application/xml', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4' };
const SHIPPED = (() => {
  try {
    const v = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
    return (v.headers || []).filter((x) => x.source === '/(.*)').flatMap((x) => x.headers).filter((x) => x.key !== 'Strict-Transport-Security')
      .map((x) => [x.key, x.key.startsWith('Content-Security-Policy') ? x.value.replace(/\s*upgrade-insecure-requests;?/g, '').trim() : x.value]);
  } catch { return []; }
})();

http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  if (url.pathname.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not_found"}'); return; }
  for (const [k, v] of SHIPPED) res.setHeader(k, v);
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(url.pathname)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    file = path.join(DIST, 'index.html');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`g14 serve-dist on http://127.0.0.1:${PORT} (${DIST})`));
