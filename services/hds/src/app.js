// @ts-check
/**
 * G14-R3 — HTTP layer of the HDS service (node:http, no framework). The browser calls it DIRECTLY (CORS, exact origin, no cookie) with a single-use
 * ES256 ticket issued by the main API; the main API (Vercel) never sees these requests or their content.
 *
 *   GET    /health                                   liveness (no database)
 *   GET    /health/ready                             readiness (SELECT 1)
 * Bodies are END-TO-END encrypted « boxes » { iv, ct } produced in the browser (src/lib/vaultCrypto.js); this service never holds a key that opens them.
 *   GET    /v1/vault/documents                       citizen, cap citizen.vault   → { keyring, healthConsent, documents: [{ id, meta, dek, … }], quota }
 *   PUT    /v1/vault/keyring                         citizen, cap citizen.vault   { keyring, replace? } (vault key wrapped by the passphrase key)
 *   POST   /v1/vault/documents                       citizen, cap citizen.vault + vault.write   { content, meta, dek, expiresAt? }
 *   GET    /v1/vault/documents/:id/content           citizen, cap citizen.vault   → { content }
 *   DELETE /v1/vault/documents/:id                   citizen, cap citizen.vault
 *   POST   /v1/vault/health-consent                  citizen, cap citizen.vault   { explicit: true, version } (art. 9.2.a, approved text only)
 *   DELETE /v1/vault/health-consent                  citizen, cap citizen.vault   (withdrawal)
 *   GET    /v1/dossiers                              citizen, cap citizen.shared_dossier
 *   POST   /v1/dossiers                              citizen
 *   GET    /v1/dossiers/:id                          citizen (owner) | pro (active grant of the ticket's structure)
 *   DELETE /v1/dossiers/:id                          citizen (owner)
 *   POST   /v1/dossiers/:id/grants                   citizen (owner) { structureId, wrappedKey? }
 *   DELETE /v1/dossiers/:id/grants                   citizen (owner) { structureId }
 *   POST   /v1/dossiers/:id/files                    citizen | pro
 *   GET    /v1/dossiers/:id/files/:fileId/content    citizen | pro
 *   GET    /v1/dossiers/:id/access-log               citizen (owner)
 *   POST   /v1/internal/erase-subject                system ticket, cap hds.erase (sub = the erased account)
 */
import crypto from 'node:crypto';
import { log } from './log.js';
import { verifyTicket } from './ticket.js';
import * as svc from './service.js';

const MAX_BODY = 5 * 1024 * 1024;
const RATE_PER_MIN = 120;

/** @type {{ m: string, re: RegExp, tpl: string, typ: string[], cap: string, run: (ctx: any, p: any, params: string[], body: any) => Promise<any> }[]} */
const ROUTES = [
  { m: 'GET', re: /^\/v1\/vault\/documents$/, tpl: '/v1/vault/documents', typ: ['citizen'], cap: 'citizen.vault', run: (ctx, p) => svc.vaultList(ctx, p) },
  { m: 'POST', re: /^\/v1\/vault\/documents$/, tpl: '/v1/vault/documents', typ: ['citizen'], cap: 'citizen.vault', run: (ctx, p, _a, b) => svc.vaultUpload(ctx, p, b) },
  { m: 'PUT', re: /^\/v1\/vault\/keyring$/, tpl: '/v1/vault/keyring', typ: ['citizen'], cap: 'citizen.vault', run: (ctx, p, _a, b) => svc.vaultSetKeyring(ctx, p, b) },
  { m: 'POST', re: /^\/v1\/vault\/health-consent$/, tpl: '/v1/vault/health-consent', typ: ['citizen'], cap: 'citizen.vault', run: (ctx, p, _a, b) => svc.vaultHealthConsent(ctx, p, b) },
  { m: 'DELETE', re: /^\/v1\/vault\/health-consent$/, tpl: '/v1/vault/health-consent', typ: ['citizen'], cap: 'citizen.vault', run: (ctx, p) => svc.vaultHealthConsentWithdraw(ctx, p) },
  { m: 'GET', re: /^\/v1\/vault\/documents\/([^/]+)\/content$/, tpl: '/v1/vault/documents/:id/content', typ: ['citizen'], cap: 'citizen.vault', run: (ctx, p, a) => svc.vaultDownload(ctx, p, a[0]) },
  { m: 'DELETE', re: /^\/v1\/vault\/documents\/([^/]+)$/, tpl: '/v1/vault/documents/:id', typ: ['citizen'], cap: 'citizen.vault', run: (ctx, p, a) => svc.vaultDelete(ctx, p, a[0]) },
  { m: 'GET', re: /^\/v1\/dossiers$/, tpl: '/v1/dossiers', typ: ['citizen'], cap: 'citizen.shared_dossier', run: (ctx, p) => svc.dossierListOwn(ctx, p) },
  { m: 'POST', re: /^\/v1\/dossiers$/, tpl: '/v1/dossiers', typ: ['citizen'], cap: 'citizen.shared_dossier', run: (ctx, p, _a, b) => svc.dossierCreate(ctx, p, b) },
  { m: 'GET', re: /^\/v1\/dossiers\/([^/]+)$/, tpl: '/v1/dossiers/:id', typ: ['citizen', 'pro'], cap: 'citizen.shared_dossier', run: (ctx, p, a) => svc.dossierGet(ctx, p, a[0]) },
  { m: 'DELETE', re: /^\/v1\/dossiers\/([^/]+)$/, tpl: '/v1/dossiers/:id', typ: ['citizen'], cap: 'citizen.shared_dossier', run: (ctx, p, a) => svc.dossierDelete(ctx, p, a[0]) },
  { m: 'POST', re: /^\/v1\/dossiers\/([^/]+)\/grants$/, tpl: '/v1/dossiers/:id/grants', typ: ['citizen'], cap: 'citizen.shared_dossier', run: (ctx, p, a, b) => svc.dossierSetGrant(ctx, p, a[0], b, true) },
  { m: 'DELETE', re: /^\/v1\/dossiers\/([^/]+)\/grants$/, tpl: '/v1/dossiers/:id/grants', typ: ['citizen'], cap: 'citizen.shared_dossier', run: (ctx, p, a, b) => svc.dossierSetGrant(ctx, p, a[0], b, false) },
  { m: 'POST', re: /^\/v1\/dossiers\/([^/]+)\/files$/, tpl: '/v1/dossiers/:id/files', typ: ['citizen', 'pro'], cap: 'citizen.shared_dossier', run: (ctx, p, a, b) => svc.dossierAddFile(ctx, p, a[0], b) },
  { m: 'GET', re: /^\/v1\/dossiers\/([^/]+)\/files\/([^/]+)\/content$/, tpl: '/v1/dossiers/:id/files/:fileId/content', typ: ['citizen', 'pro'], cap: 'citizen.shared_dossier', run: (ctx, p, a) => svc.dossierDownloadFile(ctx, p, a[0], a[1]) },
  { m: 'GET', re: /^\/v1\/dossiers\/([^/]+)\/access-log$/, tpl: '/v1/dossiers/:id/access-log', typ: ['citizen'], cap: 'citizen.shared_dossier', run: (ctx, p, a) => svc.dossierAccessLog(ctx, p, a[0]) },
  { m: 'POST', re: /^\/v1\/internal\/erase-subject$/, tpl: '/v1/internal/erase-subject', typ: ['system'], cap: 'hds.erase', run: async (ctx, p) => ({ status: 200, body: await svc.eraseSubject(ctx.pool, p.sub) }) },
];

/** @param {import('node:http').ServerResponse} res @param {string[]} origins @param {string | undefined} origin @param {boolean} production */
function baseHeaders(res, origins, origin, production) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Vary', 'Origin');
  if (origin && origins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Expose-Headers', 'Retry-After');
  }
}

/** @param {import('node:http').ServerResponse} res @param {number} status @param {any} body */
function json(res, status, body) {
  const b = Buffer.from(JSON.stringify(body));
  res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Content-Length', b.length); res.end(b);
}

/** @param {import('node:http').IncomingMessage} req @returns {Promise<any>} */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('BODY_TOO_LARGE'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!size) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('BODY_NOT_JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

/**
 * @param {{ pool: import('pg').Pool, cfg: ReturnType<typeof import('./config.js').loadConfig>, now?: () => number }} deps
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createApp(deps) {
  const { pool, cfg } = deps;
  const now = deps.now || (() => Date.now());
  /** @type {Map<string, { start: number, n: number }>} */
  const buckets = new Map();
  let served = 0;

  return async function handle(req, res) {
    const started = Date.now();
    const rid = crypto.randomUUID().slice(0, 8);
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const method = String(req.method || 'GET').toUpperCase();
    const pathOnly = String(req.url || '/').split('?')[0];
    let tpl = 'unmatched';
    let code = '';
    const finish = () => log({ evt: 'req', rid, m: method, route: tpl, s: res.statusCode, ms: Date.now() - started, ...(code ? { code } : {}) });
    try {
      baseHeaders(res, cfg.origins, origin, cfg.production);
      // a browser request from any other site is refused before anything else (server-to-server calls carry no Origin)
      if (origin && !cfg.origins.includes(origin)) { code = 'ORIGIN_REFUSED'; json(res, 403, { error: code }); return; }
      if (method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
        tpl = 'preflight'; res.statusCode = 204; res.end(); return;
      }
      if (method === 'GET' && pathOnly === '/health') { tpl = '/health'; json(res, 200, { service: 'ada-hds', ok: true }); return; }
      if (method === 'GET' && pathOnly === '/health/ready') {
        tpl = '/health/ready';
        try { await pool.query('SELECT 1'); json(res, 200, { service: 'ada-hds', ready: true }); } catch { code = 'DB_UNREACHABLE'; json(res, 503, { service: 'ada-hds', ready: false }); }
        return;
      }
      let params = null;
      const route = ROUTES.find((r) => { if (r.m !== method) return false; const m = r.re.exec(pathOnly); if (m) params = m.slice(1).map(decodeURIComponent); return Boolean(m); });
      if (!route) { code = 'NOT_FOUND'; json(res, 404, { error: 'not_found' }); return; }
      tpl = route.tpl;
      if (String(req.url || '').includes('?')) { code = 'QUERY_REFUSED'; json(res, 400, { error: 'QUERY_REFUSED' }); return; }   // nothing rides in a URL (logs, history)
      const auth = String(req.headers.authorization || '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      const v = verifyTicket(token, { keys: cfg.ticketKeys, issuer: cfg.issuer, audience: cfg.audience, now: now() });
      if (!v.ok) { code = v.reason; json(res, 401, { error: 'TICKET_INVALID', reason: v.reason }); return; }
      const p = v.claims;
      if (!route.typ.includes(p.typ) || !p.caps.includes(route.cap)) { code = 'TICKET_SCOPE'; json(res, 403, { error: 'TICKET_SCOPE' }); return; }
      // single use: a ticket seen once is refused afterwards (replay protection), kept until its expiry + the skew
      const fresh = await pool.query('INSERT INTO hds.ticket_use (jti, exp) VALUES ($1, to_timestamp($2)) ON CONFLICT (jti) DO NOTHING RETURNING jti', [p.jti, p.exp + 60]);
      if (!fresh.rowCount) { code = 'TICKET_REPLAYED'; json(res, 401, { error: 'TICKET_INVALID', reason: 'TICKET_REPLAYED' }); return; }
      if ((served += 1) % 200 === 0) pool.query('DELETE FROM hds.ticket_use WHERE exp < now()').catch(() => {});
      const key = `${p.typ}:${p.sub}`; const b = buckets.get(key); const t = now();
      if (!b || t - b.start > 60000) buckets.set(key, { start: t, n: 1 });
      else if ((b.n += 1) > RATE_PER_MIN) { code = 'RATE_LIMITED'; res.setHeader('Retry-After', '60'); json(res, 429, { error: 'RATE_LIMITED' }); return; }
      if (buckets.size > 50000) buckets.clear();
      let body = {};
      if (method !== 'GET') {
        if (req.headers['content-length'] !== '0' && req.headers['content-type'] && !/^application\/json\b/i.test(String(req.headers['content-type']))) { code = 'CONTENT_TYPE'; json(res, 415, { error: 'CONTENT_TYPE' }); return; }
        body = await readJson(req);
      }
      const out = await route.run({ pool, cfg }, { sub: p.sub, typ: p.typ, caps: p.caps, str: p.str }, params || [], body);
      if (out.bytes) {
        res.statusCode = out.status;
        for (const [k, val] of Object.entries(out.headers || {})) res.setHeader(k, val);
        res.setHeader('Content-Length', out.bytes.length);
        res.end(out.bytes);
      } else {
        if (out.status >= 400) code = String(out.body?.error || '');
        json(res, out.status, out.body);
      }
    } catch (e) {
      const err = /** @type {any} */ (e);
      code = err?.status ? String(err.message) : String(err?.code || err?.name || 'ERROR');
      if (!res.headersSent) json(res, err?.status || 500, { error: err?.status ? err.message : 'internal_error' });
    } finally {
      finish();
    }
  };
}
