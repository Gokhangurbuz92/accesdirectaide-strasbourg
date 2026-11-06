#!/usr/bin/env node
/**
 * R46 public worker — serve the app (Vite dev server) with the REAL API router (api/index.js: CSRF, beta gate, capability gates, rate limits) on ONE
 * non-3000 port for the browser journeys of e2e-r46/public. LAB only: refuses a non-local DATABASE_URL and NODE_ENV=production.
 *   R46_PORT=5181 DATABASE_URL=postgres://…@127.0.0.1:55434/ada_r46_public_test node e2e-r46/public/serve-lab.mjs
 */
import { createServer } from 'vite';
import { assertTestServer } from '../../scripts/lib/test-isolation.mjs';

const PORT = Number(process.env.R46_PORT || 5181);
if (process.env.NODE_ENV === 'production') throw new Error('LAB only');
// R47: loopback, never :3000; a database, when given, is the disposable test cluster (127.0.0.1:55434, *_test) — scripts/lib/test-isolation.mjs
assertTestServer({ host: '127.0.0.1', port: PORT, databaseUrl: process.env.DATABASE_URL, requireDatabase: false, label: 'e2e-r46/public/serve-lab' });

const { default: api } = await import('../../api/index.js');

/** the real router, Vercel-shaped (query, parsed JSON body, status/json/send helpers) */
function realApi() {
  return {
    name: 'r46-real-api',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        if (!(url.startsWith('/api') || url === '/robots.txt' || url === '/sitemap.xml')) return next();
        const u = new URL(url, `http://127.0.0.1:${PORT}`);
        // the router allow-lists the dev origins :5173 / :3000 only; a request from THIS server's own page is same-origin, so its Origin header is dropped
        // (exactly this origin — any other origin still reaches the router's CSRF origin check). The double-submit token check stays fully active.
        if (req.headers.origin === `http://127.0.0.1:${PORT}`) delete req.headers.origin;
        req.query = Object.fromEntries(u.searchParams);
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method || '')) {
          const chunks = []; for await (const c of req) chunks.push(c);
          const raw = Buffer.concat(chunks).toString('utf8');
          try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = raw; }
        }
        res.status = (c) => { res.statusCode = c; return res; };
        res.json = (d) => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(d)); return res; };
        res.send = (d) => { res.end(d); return res; };
        try { await api(req, res); } catch (e) { if (!res.headersSent) { res.statusCode = 500; res.end(JSON.stringify({ error: 'server_error' })); } console.error('[r46-serve]', e?.message); }
      });
    },
  };
}

const server = await createServer({ server: { port: PORT, strictPort: true, host: '127.0.0.1' }, plugins: [realApi()], logLevel: 'warn' });
await server.listen();
console.log(`r46 public LAB server on http://127.0.0.1:${PORT}`);
