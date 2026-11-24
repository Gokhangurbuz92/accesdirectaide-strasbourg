// @ts-check
/**
 * G14-R3 — HTTP layer of the HDS service (node:http, no framework). The browser calls it DIRECTLY (CORS, exact origin, no cookie) with a single-use
 * ES256 ticket issued by the main API; the main API (Vercel) never sees these requests or their content.
 *
 *   GET    /health                                   liveness (no database)
 *   GET    /health/ready                             readiness (SELECT 1)
 * Bodies are END-TO-END encrypted « boxes » { iv, ct } produced in the browser (src/lib/vaultCrypto.js); this service never holds a key that opens them.
 *   GET    /v1/vault/documents                       citizen, cap citizen.vault   → { keyring, healthConsent, healthCategory: { enabled, version }, documents: [{ id, meta, dek, … }], quota }
 *   PUT    /v1/vault/keyring                         citizen, cap citizen.vault   { keyring, replace? } (vault key wrapped by the passphrase key)
 *   POST   /v1/vault/documents                       citizen, cap citizen.vault + vault.write   { content, meta, dek, expiresAt? }
 *   GET    /v1/vault/documents/:id/content           citizen, cap citizen.vault   → { content }
 *   DELETE /v1/vault/documents/:id                   citizen, cap citizen.vault
 *   POST   /v1/vault/health-consent                  citizen, cap citizen.vault   { explicit: true, version } (art. 9.2.a, approved text only)
 *   DELETE /v1/vault/health-consent                  citizen, cap citizen.vault   (withdrawal)
 * G14-R4 — shared dossiers, keys, referral payloads, attachments (src/sharing.js). « D » = cap citizen.shared_dossier.
 *   GET    /v1/dossiers                              citizen D                    own dossiers with grants (state, expiry, epoch)
 *   POST   /v1/dossiers                              citizen D                    { content, ownerKey, kind?, expiresAt? }
 *   GET    /v1/dossiers/:id                          citizen D (owner) | pro D (active grant)
 *   PUT    /v1/dossiers/:id                          citizen D (owner)            { content, keyEpoch }
 *   DELETE /v1/dossiers/:id                          citizen D (owner)
 *   POST   /v1/dossiers/:id/grants                   citizen D (owner)            { structureId, wrappedKey (ECIES), keyEpoch, consent: { explicit, version }, expiresAt? }
 *   DELETE /v1/dossiers/:id/grants                   citizen D (owner)            { structureId } → rekeyRequired
 *   POST   /v1/dossiers/:id/rekey                    citizen D (owner)            { fromEpoch, content, ownerKey, files[], messages[], grants[] } (atomic)
 *   POST   /v1/dossiers/:id/referral-answer          citizen D (owner)            { structureId, accept, consent? }
 *   POST   /v1/dossiers/:id/files                    citizen D | pro D
 *   GET    /v1/dossiers/:id/files/:fileId/content    citizen D | pro D
 *   DELETE /v1/dossiers/:id/files/:fileId            citizen D (owner)
 *   GET    /v1/dossiers/:id/threads/:structureId     citizen D | pro D (its own structure)
 *   POST   /v1/dossiers/:id/threads/:structureId     citizen D | pro D            { dek, body, keyEpoch }
 *   POST   /v1/dossiers/:id/events                   pro D                        { action } content-free (export, attestation, SIAO hand-over, print)
 *   GET    /v1/dossiers/:id/access-log               citizen D (owner)
 *   POST   /v1/dossiers/:id/referrals                pro, cap pro.referrals       { toStructureId, referralRef, wrappedKey, keyEpoch, note? } → pending grant
 *   DELETE /v1/dossiers/:id/referrals                pro, cap pro.referrals       { toStructureId } the sender withdraws its still-pending proposal
 *   GET    /v1/orgs/:structureId/public-key          citizen | pro (D, pro.referrals or messaging.attachments)
 *   GET    /v1/pro/dossiers                          pro D                        dossiers shared with the ticket's structure
 *   GET    /v1/pro/keys                              pro D                        my key, the organisation keys with my wraps, members to wrap (admin)
 *   PUT    /v1/pro/member-key                        pro D                        { publicJwk, keyring, replace? }
 *   POST   /v1/pro/org-keys                          pro D, role STRUCTURE_ADMIN  { kid, publicJwk, wraps[] } (create / rotate)
 *   POST   /v1/pro/org-keys/members                  pro D, role STRUCTURE_ADMIN  { memberRef, wraps[] }
 *   DELETE /v1/pro/org-keys/members                  pro D, role STRUCTURE_ADMIN  { memberRef }
 *   GET    /v1/vault/box-key   PUT /v1/vault/box-key citizen (citizen.vault or D)  the person's receiving key pair (private half wrapped by the vault key)
 *   GET    /v1/vault/export                          citizen (citizen.vault or D) everything the person owns here, as stored (the browser decrypts)
 *   GET    /v1/attachments/keys                      citizen | pro, cap messaging.attachments, obj claim   the two public keys to wrap for
 *   POST   /v1/attachments                           idem                          { content, meta, keyCitizen, keyOrg }
 *   GET    /v1/attachments/:id                       idem                          { content, meta, key } (the caller's own wrapped key)
 *   POST   /v1/internal/dossier-ref                  system, cap hds.dossier-ref   { dossierId, structureId, toStructureId? } identifiers only
 *   POST   /v1/internal/erase-binding                system, cap hds.erase         { binding } (a conversation's attachments)
 */
import crypto from 'node:crypto';
import { log } from './log.js';
import { verifyTicket } from './ticket.js';
import * as svc from './service.js';
import * as sh from './sharing.js';

const MAX_BODY = 5 * 1024 * 1024;
const RATE_PER_MIN = 120;

/** @type {{ m: string, re: RegExp, tpl: string, typ: string[], cap: string[], run: (ctx: any, p: any, params: string[], body: any) => Promise<any> }[]} */
const V = ['citizen.vault']; const D = ['citizen.shared_dossier']; const VD = ['citizen.vault', 'citizen.shared_dossier']; const A = ['messaging.attachments'];
const ROUTES = [
  { m: 'GET', re: /^\/v1\/vault\/documents$/, tpl: '/v1/vault/documents', typ: ['citizen'], cap: V, run: (ctx, p) => svc.vaultList(ctx, p) },
  { m: 'POST', re: /^\/v1\/vault\/documents$/, tpl: '/v1/vault/documents', typ: ['citizen'], cap: V, run: (ctx, p, _a, b) => svc.vaultUpload(ctx, p, b) },
  { m: 'PUT', re: /^\/v1\/vault\/keyring$/, tpl: '/v1/vault/keyring', typ: ['citizen'], cap: V, run: (ctx, p, _a, b) => svc.vaultSetKeyring(ctx, p, b) },
  { m: 'POST', re: /^\/v1\/vault\/health-consent$/, tpl: '/v1/vault/health-consent', typ: ['citizen'], cap: V, run: (ctx, p, _a, b) => svc.vaultHealthConsent(ctx, p, b) },
  { m: 'DELETE', re: /^\/v1\/vault\/health-consent$/, tpl: '/v1/vault/health-consent', typ: ['citizen'], cap: V, run: (ctx, p) => svc.vaultHealthConsentWithdraw(ctx, p) },
  { m: 'GET', re: /^\/v1\/vault\/documents\/([^/]+)\/content$/, tpl: '/v1/vault/documents/:id/content', typ: ['citizen'], cap: V, run: (ctx, p, a) => svc.vaultDownload(ctx, p, a[0]) },
  { m: 'DELETE', re: /^\/v1\/vault\/documents\/([^/]+)$/, tpl: '/v1/vault/documents/:id', typ: ['citizen'], cap: V, run: (ctx, p, a) => svc.vaultDelete(ctx, p, a[0]) },
  { m: 'GET', re: /^\/v1\/vault\/box-key$/, tpl: '/v1/vault/box-key', typ: ['citizen'], cap: VD, run: (ctx, p) => sh.boxKeyGet(ctx, p) },
  { m: 'PUT', re: /^\/v1\/vault\/box-key$/, tpl: '/v1/vault/box-key', typ: ['citizen'], cap: VD, run: (ctx, p, _a, b) => sh.boxKeySet(ctx, p, b) },
  { m: 'GET', re: /^\/v1\/vault\/export$/, tpl: '/v1/vault/export', typ: ['citizen'], cap: VD, run: (ctx, p) => sh.exportOwn(ctx, p) },
  { m: 'GET', re: /^\/v1\/dossiers$/, tpl: '/v1/dossiers', typ: ['citizen'], cap: D, run: (ctx, p) => sh.dossierListOwn(ctx, p) },
  { m: 'POST', re: /^\/v1\/dossiers$/, tpl: '/v1/dossiers', typ: ['citizen'], cap: D, run: (ctx, p, _a, b) => sh.dossierCreate(ctx, p, b) },
  { m: 'GET', re: /^\/v1\/dossiers\/([^/]+)$/, tpl: '/v1/dossiers/:id', typ: ['citizen', 'pro'], cap: D, run: (ctx, p, a) => sh.dossierGet(ctx, p, a[0]) },
  { m: 'PUT', re: /^\/v1\/dossiers\/([^/]+)$/, tpl: '/v1/dossiers/:id', typ: ['citizen'], cap: D, run: (ctx, p, a, b) => sh.dossierUpdate(ctx, p, a[0], b) },
  { m: 'DELETE', re: /^\/v1\/dossiers\/([^/]+)$/, tpl: '/v1/dossiers/:id', typ: ['citizen'], cap: D, run: (ctx, p, a) => sh.dossierDelete(ctx, p, a[0]) },
  { m: 'POST', re: /^\/v1\/dossiers\/([^/]+)\/grants$/, tpl: '/v1/dossiers/:id/grants', typ: ['citizen'], cap: D, run: (ctx, p, a, b) => sh.dossierGrant(ctx, p, a[0], b) },
  { m: 'DELETE', re: /^\/v1\/dossiers\/([^/]+)\/grants$/, tpl: '/v1/dossiers/:id/grants', typ: ['citizen'], cap: D, run: (ctx, p, a, b) => sh.dossierRevoke(ctx, p, a[0], b) },
  { m: 'POST', re: /^\/v1\/dossiers\/([^/]+)\/rekey$/, tpl: '/v1/dossiers/:id/rekey', typ: ['citizen'], cap: D, run: (ctx, p, a, b) => sh.dossierRekey(ctx, p, a[0], b) },
  { m: 'POST', re: /^\/v1\/dossiers\/([^/]+)\/referral-answer$/, tpl: '/v1/dossiers/:id/referral-answer', typ: ['citizen'], cap: D, run: (ctx, p, a, b) => sh.dossierAnswerReferral(ctx, p, a[0], b, b?.accept === true) },
  { m: 'POST', re: /^\/v1\/dossiers\/([^/]+)\/files$/, tpl: '/v1/dossiers/:id/files', typ: ['citizen', 'pro'], cap: D, run: (ctx, p, a, b) => sh.dossierAddFile(ctx, p, a[0], b) },
  { m: 'GET', re: /^\/v1\/dossiers\/([^/]+)\/files\/([^/]+)\/content$/, tpl: '/v1/dossiers/:id/files/:fileId/content', typ: ['citizen', 'pro'], cap: D, run: (ctx, p, a) => sh.dossierDownloadFile(ctx, p, a[0], a[1]) },
  { m: 'DELETE', re: /^\/v1\/dossiers\/([^/]+)\/files\/([^/]+)$/, tpl: '/v1/dossiers/:id/files/:fileId', typ: ['citizen'], cap: D, run: (ctx, p, a) => sh.dossierDeleteFile(ctx, p, a[0], a[1]) },
  { m: 'GET', re: /^\/v1\/dossiers\/([^/]+)\/threads\/([^/]+)$/, tpl: '/v1/dossiers/:id/threads/:structureId', typ: ['citizen', 'pro'], cap: D, run: (ctx, p, a) => sh.threadList(ctx, p, a[0], a[1]) },
  { m: 'POST', re: /^\/v1\/dossiers\/([^/]+)\/threads\/([^/]+)$/, tpl: '/v1/dossiers/:id/threads/:structureId', typ: ['citizen', 'pro'], cap: D, run: (ctx, p, a, b) => sh.threadPost(ctx, p, a[0], a[1], b) },
  { m: 'POST', re: /^\/v1\/dossiers\/([^/]+)\/events$/, tpl: '/v1/dossiers/:id/events', typ: ['pro'], cap: D, run: (ctx, p, a, b) => sh.dossierProEvent(ctx, p, a[0], b) },
  { m: 'GET', re: /^\/v1\/dossiers\/([^/]+)\/access-log$/, tpl: '/v1/dossiers/:id/access-log', typ: ['citizen'], cap: D, run: (ctx, p, a) => sh.dossierAccessLog(ctx, p, a[0]) },
  { m: 'POST', re: /^\/v1\/dossiers\/([^/]+)\/referrals$/, tpl: '/v1/dossiers/:id/referrals', typ: ['pro'], cap: ['pro.referrals'], run: (ctx, p, a, b) => sh.referralPropose(ctx, p, a[0], b) },
  { m: 'DELETE', re: /^\/v1\/dossiers\/([^/]+)\/referrals$/, tpl: '/v1/dossiers/:id/referrals', typ: ['pro'], cap: ['pro.referrals'], run: (ctx, p, a, b) => sh.referralWithdraw(ctx, p, a[0], b) },
  { m: 'GET', re: /^\/v1\/orgs\/([^/]+)\/public-key$/, tpl: '/v1/orgs/:structureId/public-key', typ: ['citizen', 'pro'], cap: [...D, 'pro.referrals', ...A], run: (ctx, _p, a) => sh.orgPublicKey(ctx, a[0]) },
  { m: 'GET', re: /^\/v1\/pro\/dossiers$/, tpl: '/v1/pro/dossiers', typ: ['pro'], cap: D, run: (ctx, p) => sh.proDossiers(ctx, p) },
  { m: 'GET', re: /^\/v1\/pro\/keys$/, tpl: '/v1/pro/keys', typ: ['pro'], cap: [...D, ...A], run: (ctx, p) => sh.orgKeysState(ctx, p) },
  { m: 'PUT', re: /^\/v1\/pro\/member-key$/, tpl: '/v1/pro/member-key', typ: ['pro'], cap: [...D, ...A], run: (ctx, p, _a, b) => sh.memberKeySet(ctx, p, b) },
  { m: 'POST', re: /^\/v1\/pro\/org-keys$/, tpl: '/v1/pro/org-keys', typ: ['pro'], cap: [...D, ...A], run: (ctx, p, _a, b) => sh.orgKeyCreate(ctx, p, b) },
  { m: 'POST', re: /^\/v1\/pro\/org-keys\/members$/, tpl: '/v1/pro/org-keys/members', typ: ['pro'], cap: [...D, ...A], run: (ctx, p, _a, b) => sh.orgKeyAddMember(ctx, p, b) },
  { m: 'DELETE', re: /^\/v1\/pro\/org-keys\/members$/, tpl: '/v1/pro/org-keys/members', typ: ['pro'], cap: [...D, ...A], run: (ctx, p, _a, b) => sh.orgKeyRemoveMember(ctx, p, b) },
  { m: 'GET', re: /^\/v1\/attachments\/keys$/, tpl: '/v1/attachments/keys', typ: ['citizen', 'pro'], cap: A, run: (ctx, p) => sh.attachmentKeys(ctx, p) },
  { m: 'POST', re: /^\/v1\/attachments$/, tpl: '/v1/attachments', typ: ['citizen', 'pro'], cap: A, run: (ctx, p, _a, b) => sh.attachmentUpload(ctx, p, b) },
  { m: 'GET', re: /^\/v1\/attachments\/([^/]+)$/, tpl: '/v1/attachments/:id', typ: ['citizen', 'pro'], cap: A, run: (ctx, p, a) => sh.attachmentDownload(ctx, p, a[0]) },
  { m: 'POST', re: /^\/v1\/internal\/erase-subject$/, tpl: '/v1/internal/erase-subject', typ: ['system'], cap: ['hds.erase'], run: async (ctx, p) => ({ status: 200, body: await svc.eraseSubject(ctx.pool, p.sub) }) },
  { m: 'POST', re: /^\/v1\/internal\/erase-binding$/, tpl: '/v1/internal/erase-binding', typ: ['system'], cap: ['hds.erase'], run: (ctx, _p, _a, b) => sh.internalEraseBinding(ctx, b) },
  { m: 'POST', re: /^\/v1\/internal\/dossier-ref$/, tpl: '/v1/internal/dossier-ref', typ: ['system'], cap: ['hds.dossier-ref'], run: (ctx, _p, _a, b) => sh.internalDossierRef(ctx, b) },
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
      if (!route.typ.includes(p.typ) || !route.cap.some((c) => p.caps.includes(c))) { code = 'TICKET_SCOPE'; json(res, 403, { error: 'TICKET_SCOPE' }); return; }
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
      const out = await route.run({ pool, cfg }, { sub: p.sub, typ: p.typ, caps: p.caps, str: p.str, role: p.role, obj: p.obj }, params || [], body);
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
