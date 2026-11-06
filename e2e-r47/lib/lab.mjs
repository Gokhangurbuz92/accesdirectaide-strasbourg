// @ts-nocheck
/**
 * R47 — shared LAB helpers for e2e-r47 (synthetic only, loopback only, never port 3000, never Production):
 *   guardLab()                 refuses anything but a loopback *_test database and a non-production profile
 *   startApp({ port, dist })   the BUILT app (optional) + the REAL api/index.js in one loopback origin (as e2e-r46/pro/serve.mjs), JSON and form bodies
 *   startHdsMock({ token })    a certified-host stand-in implementing api/lib/protected-store/CONTRACT.md (PUT/GET/DELETE /v1/objects/{uuid}, digests)
 *   startSink()                a webhook sink (the alert channel), records what it receives
 *   seed(client)               synthetic citizen, structure with three services (ordinary / sensitive / unreviewed), pro member, institution, admin
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function guardLab(port) {
  if (Number(port) === 3000) throw new Error('port 3000 is reserved for the owner LAB');
  const db = new URL(String(process.env.DATABASE_URL || 'postgres://x@invalid/x'));
  if (!['127.0.0.1', 'localhost'].includes(db.hostname) || !db.pathname.endsWith('_test')) throw new Error('loopback *_test database only');
  if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') throw new Error('never a production profile');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.xml': 'application/xml' };

export async function startApp({ port, dist = null }) {
  guardLab(port);
  const { default: api } = await import('../../api/index.js');
  const DIST = dist ? path.resolve(dist) : null;
  const server = http.createServer(async (req, res) => {
    const u = new URL(String(req.url), `http://127.0.0.1:${port}`);
    if (u.pathname.startsWith('/api/') || u.pathname === '/api') {
      const chunks = []; for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8');
      req.query = Object.fromEntries(u.searchParams);
      const ct = String(req.headers['content-type'] || '');
      try { req.body = !raw ? {} : ct.includes('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw); } catch { req.body = {}; }
      // the API's development origin allowlist names :5173: a same-origin request of this LAB origin is presented with it (LAB harness only)
      if (req.headers.origin === `http://127.0.0.1:${port}`) req.headers.origin = 'http://127.0.0.1:5173';
      res.status = (c) => { res.statusCode = c; return res; };
      res.json = (d) => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(d)); return res; };
      res.send = (d) => { res.end(typeof d === 'string' || Buffer.isBuffer(d) ? d : JSON.stringify(d)); return res; };
      try { await api(req, res); } catch (e) { if (!res.headersSent) { res.statusCode = 500; res.end('{"error":"server"}'); } console.error('[lab]', e?.name, e?.message); }
      return;
    }
    if (!DIST) { res.statusCode = 404; return res.end('no dist'); }
    let f = path.join(DIST, decodeURIComponent(u.pathname));
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

/** a certified health-data host stand-in (CONTRACT.md); it stores bytes in memory and counts calls */
export async function startHdsMock({ port = 0, token }) {
  const objects = new Map(); const calls = [];
  const server = http.createServer(async (req, res) => {
    const m = /^\/v1\/objects\/([0-9a-f-]{36})$/.exec(String(req.url));
    calls.push(`${req.method} ${m ? 'object' : req.url}`);
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); return res.end(); }
    if (!m) { res.writeHead(404); return res.end(); }
    const id = m[1];
    if (req.method === 'PUT') {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks); const digest = crypto.createHash('sha256').update(body).digest('hex');
      if (req.headers['x-content-sha256'] !== digest) { res.writeHead(400); return res.end(); }
      objects.set(id, body); res.writeHead(201, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ id, sha256: digest }));
    }
    if (req.method === 'GET') {
      if (!objects.has(id)) { res.writeHead(404); return res.end(); }
      const b = objects.get(id); res.writeHead(200, { 'x-content-sha256': crypto.createHash('sha256').update(b).digest('hex'), 'content-type': 'application/octet-stream' }); return res.end(b);
    }
    if (req.method === 'DELETE') { objects.delete(id); res.writeHead(204); return res.end(); }
    res.writeHead(405); return res.end();
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, objects, calls, close: () => new Promise((r) => server.close(r)) };
}

/**
 * a local-model stand-in shaped like Ollama (/api/tags, /api/embeddings with 768 values, /api/chat): it answers with the first verified source id found in
 * the prompt; « promesse-synthetique » in the question makes it promise eligibility (the API must refuse that answer); no source id = it abstains
 */
export async function startModelMock() {
  let modelCalls = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    modelCalls += 1;
    if (req.url === '/api/tags') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }] })); }
    // nomic-embed-text shape (768 finite values): a deterministic synthetic vector, so the hybrid retrieval runs (lexical ranking decides on this LAB)
    if (req.url === '/api/embeddings') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ embedding: Array.from({ length: 768 }, (_, i) => ((i % 7) + 1) / 100) })); }
    if (req.url !== '/api/chat') { res.writeHead(404); return res.end(); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const prompt = (body.messages || []).map((m) => m.content).join('\n');
    const ids = [...new Set(prompt.match(/\b(?:aide|demarche|structure):[A-Za-z0-9_-]+/g) || [])];
    const invent = /promesse-synthetique/i.test(prompt);   // the question asks the stand-in to promise eligibility (never the system text)
    const content = ids.length ? { answer: invent ? 'Vous avez droit à cette aide, votre demande sera acceptée.' : 'Selon la fiche officielle vérifiée, cette aide peut aider à payer le loyer. Vérifiez les conditions sur la fiche.', citedSourceIds: [ids[0]], abstain: false }
      : { answer: 'Je ne sais pas.', citedSourceIds: [], abstain: true };
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ model: 'qwen3:8b', message: { role: 'assistant', content: JSON.stringify(content) }, done: true }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, calls: () => modelCalls, close: () => new Promise((r) => server.close(r)) };
}

export async function startSink({ port = 0 } = {}) {
  const received = [];
  const server = http.createServer(async (req, res) => { const chunks = []; for await (const c of req) chunks.push(c); received.push({ method: req.method, url: req.url, bytes: Buffer.concat(chunks).length }); res.writeHead(204); res.end(); });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/hook`, received, close: () => new Promise((r) => server.close(r)) };
}

/** synthetic seed (every id « r47a- », every address …@example.test). Returns the identifiers and the generated passwords (kept in memory only). */
export async function seed(c) {
  const { hashPassword } = await import('../../api/_utils/password-hash.js');
  const ts = Date.now().toString(36);
  const pw = () => `Lab-${crypto.randomBytes(9).toString('base64url')}-9a`;
  const q = (s, p = []) => c.query(s, p);
  const citizen = { id: `r47a-cit-${ts}`, email: `r47a-cit-${ts}@example.test`, password: pw() };
  await q(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES ($1, $2, $3, NOW(), NOW())`, [citizen.id, citizen.email, await hashPassword(citizen.password)]);
  await q(`INSERT INTO "CitizenProfile" ("userId", "ageBand", "displayName", "updatedAt") VALUES ($1, '25-59', 'Personne synthétique', NOW())`, [citizen.id]);
  await q(`INSERT INTO "ConsentLog" (id, policy_version, policy_hash, subject_type, subject_id, purpose, decision, collection_channel, guardian_involved, proof_level)
    VALUES ($1, 'r42-a07-2026-11-04', 'r42-a07-2026-11-04:AGE_DECLARATION_ADULT', 'CITIZEN_USER', $2, 'AGE_DECLARATION_ADULT', true, 'account', false, 'SELF_DECLARATION')`, [`r47a-age-${ts}`, citizen.id]);
  const structure = { id: `r47a-st-${ts}`, slug: `r47a-structure-${ts}` };
  const svc = { ordinary: `r47a-svc-o-${ts}`, sensitive: `r47a-svc-s-${ts}`, unknown: `r47a-svc-u-${ts}` };
  const rec = (value) => ({ value, reviewedAt: new Date().toISOString(), reviewedBy: 'r47a-admin@example.test', reason: 'classement synthétique de test R47' });
  const settings = { serviceSensitivity: { v: 1, services: { [svc.ordinary]: rec('ordinary'), [svc.sensitive]: rec('sensitive') } } };
  await q(`INSERT INTO "Structure" (id, slug, nom, ville, code_postal, statut, verification_status, services, publics_accueillis, categories_aidees, data_origin, settings_json, "updatedAt", "createdAt")
    VALUES ($1, $2, 'Structure synthétique R47', 'Strasbourg', '67000', 'actif', 'VERIFIED', '{}', '{}', '{Accès aux droits}', 'official', $3::jsonb, NOW(), NOW())`, [structure.id, structure.slug, JSON.stringify(settings)]);
  await q(`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "updatedAt") VALUES ($1, $2, true, 'BOTH', NOW())`, [`r47a-rs-${ts}`, structure.id]);
  for (const [k, id] of Object.entries(svc)) {
    await q(`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", modes, "updatedAt") VALUES ($1, $2, $3, 30, '{IN_PERSON,VIDEO}', NOW())`, [id, structure.id, `Service synthétique ${k}`]);
  }
  for (let wd = 0; wd < 7; wd += 1) await q(`INSERT INTO "ProAvailabilityRule" (id, "structureId", weekday, "startTime", "endTime", "updatedAt") VALUES ($1, $2, $3, '00:00', '23:30', NOW())`, [`r47a-av-${wd}-${ts}`, structure.id, wd]);
  const pro = { id: `r47a-pro-${ts}`, email: `r47a-pro-${ts}@example.test`, structureId: structure.id, role: 'STRUCTURE_ADMIN' };
  await q(`INSERT INTO "ProUser" (id, email, password_hash, role, "structureId", status, "updatedAt") VALUES ($1, $2, $3, 'STRUCTURE_ADMIN', $4, 'active', NOW())`, [pro.id, pro.email, await hashPassword(pw()), structure.id]);
  const institution = { email: `r47a-inst-${ts}@example.test`, password: pw(), agreementId: `r47a-ag-${ts}` };
  await q(`INSERT INTO "PartnerAgreement" (id, "partnerName", kind, status, "recordedBy", "signedAt", "documentRef", "signedByPartner") VALUES ($1, 'Partenaire synthétique R47', 'CONVENTION', 'SIGNED', 'r47a-admin@example.test', CURRENT_DATE - 1, 'SYNTHETIC-TEST-ONLY-CONV-1', 'Signataire synthétique')`, [institution.agreementId]);
  await q(`INSERT INTO "InstitutionAccount" (id, email, "passwordHash", "organisationName", territory, status, "agreementId", "createdBy") VALUES ($1, $2, $3, 'Institution synthétique R47', 'Bas-Rhin', 'ACTIVE', $4, 'r47a-admin@example.test')`,
    [`r47a-ia-${ts}`, institution.email, await hashPassword(institution.password), institution.agreementId]);
  const admin = { email: `r47a-admin-${ts}@example.test` };
  return { ts, citizen, structure, svc, pro, institution, admin };
}

/** a tiny cookie-aware HTTP client with a distinct client address per request (the per-address rate limits stay active) */
export function client(base) {
  let n = 0; const jar = new Map();
  return {
    jar,
    async req(method, p, { body, headers = {}, bearer, form, raw } = {}) {
      n += 1;
      const h = { 'x-forwarded-for': `10.47.${Math.floor(n / 250) % 250}.${(n % 250) + 1}`, ...headers };
      if (!jar.has('__csrf')) jar.set('__csrf', crypto.randomUUID());
      h['x-csrf-token'] = jar.get('__csrf');
      h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      if (bearer) h.authorization = `Bearer ${bearer}`;
      let payload;
      if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
      else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
      const r = await fetch(`${base}${p}`, { method, headers: h, body: payload, redirect: 'manual' });
      for (const sc of r.headers.getSetCookie?.() || []) { const [kv] = sc.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1)); }
      const buf = Buffer.from(await r.arrayBuffer());
      let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { json = null; }
      return raw ? { status: r.status, headers: r.headers, buf, json } : { status: r.status, headers: r.headers, json, text: json ? null : buf.toString('utf8').slice(0, 300), buf };
    },
  };
}
