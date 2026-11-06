#!/usr/bin/env node
// @ts-nocheck
/**
 * R47 admin — LAB server for e2e-r47/admin: the BUILT app (R47_DIST, built with the final VITE_PUBLIC_BETA_* switches) + the REAL api/index.js on 127.0.0.1:5193
 * in the Production-equivalent FINAL configuration of scripts/activation-simulator.mjs (restricted beta on, every surface opened by its switch, capability and
 * sensitivity enforcement on, PRO_MFA_REQUIRED, ADMIN_SESSION_REGISTRY_STRICT), synthetic fixtures and loopback mocks only:
 *   certified HDS host (CONTRACT.md), local model (Ollama /api/chat shape), OpenFisca (/spec, /calculate), alert sink.
 * Seeds a disposable *_test database and writes the synthetic credentials to R47_CREDS (mode 0600, outside the repository; never printed).
 * A loopback control port (R47_CONTROL_PORT, default 5294) lets the browser suite switch ONE allow-listed variable in this running server (rollback proof) and
 * take the mock OpenFisca engine down; it is LAB-only and refuses any other name.
 */
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import { guardLab, startApp, startHdsMock, startSink, startModelMock, seed } from '../lib/lab.mjs';

const PORT = Number(process.env.R47_PORT || 5193); const CONTROL = Number(process.env.R47_CONTROL_PORT || 5294);
guardLab(PORT);
process.env.ADA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
const hdsToken = `SYNTHETIC-TEST-ONLY-${crypto.randomBytes(20).toString('hex')}`;
const hds = await startHdsMock({ token: hdsToken });
const sink = await startSink();

const model = await startModelMock();
// OpenFisca stand-in: /spec answers, /calculate returns the situation with every requested (null) value set to 0
let engineUp = true;
const fill = (o) => (Array.isArray(o) ? o.map(fill) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null ? 0 : fill(v)])) : o);
const openfisca = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  if (!engineUp) { req.socket.destroy(); return; }
  if (req.url === '/spec') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"info":{"title":"SYNTHETIC-TEST-ONLY OpenFisca stand-in"}}'); }
  if (req.url === '/calculate') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(fill(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')))); }
  res.writeHead(404); res.end();
});
await new Promise((r) => openfisca.listen(0, '127.0.0.1', r));

// read at import time by api/lib/ai-foundation.js (the simulator's imports may load it): set before any import of the API
process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${model.port}`; process.env.OPENFISCA_URL = `http://127.0.0.1:${openfisca.address().port}`;
const { finalConfig } = await import('../../scripts/activation-simulator.mjs');
const base = `http://127.0.0.1:${PORT}`;
const cfg = finalConfig({ profile: 'lab', base, mocks: { hds: hds.url, alert: sink.url } });
Object.assign(cfg, { NODE_ENV: 'development', ADA_ENCRYPTION_KEY: process.env.ADA_ENCRYPTION_KEY, ADA_PROTECTED_STORE_TOKEN: hdsToken, MAILER_PROVIDER: 'test',
  PRO_MFA_REQUIRED: 'true', ADMIN_SESSION_REGISTRY_STRICT: 'true', OLLAMA_BASE_URL: `http://127.0.0.1:${model.port}`, OPENFISCA_URL: `http://127.0.0.1:${openfisca.address().port}` });
for (const k of ['SENTRY_DSN', 'STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'VERCEL_ENV',
  'FRANCECONNECT_ISSUER', 'PROCONNECT_ISSUER']) delete cfg[k];
Object.assign(process.env, cfg);
const FINAL = { ...process.env };

const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
const S = await seed(db);
const q = (s, p = []) => db.query(s, p);
// two named administrators with TOTP (the second one for the two-person rules)
const { hashPassword } = await import('../../api/_utils/password-hash.js');
const { encryptToken } = await import('../../api/_utils/vault.js');
const otplib = await import('otplib');
const admins = [];
for (const k of ['a', 'b']) {
  const a = { email: `r47b-admin-${k}-${S.ts}@example.test`, password: `Lab-${crypto.randomBytes(9).toString('base64url')}-9a`, secret: otplib.generateSecret() };
  const enc = encryptToken(a.secret); const mfaSecret = enc.content; const mfaIv = enc.iv;
  await q(`INSERT INTO "AdminUser" (id, email, password, role, "updatedAt", "failedLoginAttempts", "mfaEnabled", "mfaSecret", "mfaIv") VALUES ($1, $2, $3, 'superadmin', NOW(), 0, true, $4, $5)`,
    [`r47b-adm-${k}-${S.ts}`, a.email, await hashPassword(a.password), mfaSecret, mfaIv]);
  admins.push(a);
}
// an official record, published but NOT yet verified (D-5 v2: not public until a named administrator verifies it)
const aide = { id: `r47b-aide-${S.ts}`, slug: `aide-synthetique-loyer-r47-${S.ts}`, titre: 'Aide synthétique R47 pour payer le loyer' };
await q(`INSERT INTO "Aide" (id, slug, titre, cest_quoi, categorie, statut, launch_eligible, data_origin, source_url, "updatedAt", published_at)
  VALUES ($1, $2, $3, 'Fiche de test synthétique : aide pour payer le loyer à Strasbourg.', 'logement', 'publie', true, 'official', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006', NOW(), NOW() - interval '2 days')`, [aide.id, aide.slug, aide.titre]);
// a second citizen (privacy console: legal hold + erasure request), a guardian link waiting for the strong check
const { signUserSessionToken } = await import('../../api/_utils/user-auth.js');
const c2 = { id: `r47b-cit2-${S.ts}`, email: `r47b-cit2-${S.ts}@example.test` };
await q(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES ($1, $2, 'unset:x', NOW(), NOW())`, [c2.id, c2.email]);
await q(`INSERT INTO "CitizenProfile" ("userId", "ageBand", "displayName", "updatedAt") VALUES ($1, '25-59', 'Personne synthétique 2', NOW())`, [c2.id]);
const minor = `r47b-min-${S.ts}`;
await q(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES ($1, $2, 'unset:x', NOW(), NOW())`, [minor, `${minor}@example.test`]);
await q(`INSERT INTO "CitizenProfile" ("userId", "ageBand", "displayName", "updatedAt") VALUES ($1, 'moins-de-18', 'Mineur synthétique', NOW())`, [minor]);
await q(`INSERT INTO "GuardianRelationship" (id, "minorId", "guardianId", status, scopes, "updatedAt") VALUES ($1, $2, $3, 'STRONGER_VERIFICATION_REQUIRED', '[]'::jsonb, NOW())`, [`r47b-gl-${S.ts}`, minor, S.citizen.id]);
// observatory: three more verified organisations in Strasbourg (a commune is shown from 3), referrals in the last complete quarter: 7 housing (2 unmet),
// 6 health, 2 employment — primary suppression masks employment (2 < 5) and every unmet cell; secondary suppression masks the smallest published « sent » (health)
for (let i = 1; i <= 3; i += 1) await q(`INSERT INTO "Structure" (id, slug, nom, ville, statut, verification_status, services, publics_accueillis, categories_aidees, data_origin, "updatedAt", "createdAt")
  VALUES ($1, $1, $2, 'Strasbourg', 'actif', 'VERIFIED', '{}', '{}', '{}', 'official', NOW(), NOW())`, [`r47b-org-${i}-${S.ts}`, `Organisation synthétique ${i}`]);
await q(`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount") VALUES ($1, NOW() + interval '7 days', '{}'::jsonb, '{}'::jsonb, 0)`, [`r47b-sd-${S.ts}`]);
const { lastQuarters } = await import('../../api/_services/territorial-stats.js');
const qq = lastQuarters(); const mid = new Date((qq[qq.length - 1].start.getTime() + qq[qq.length - 1].end.getTime()) / 2);
let n = 0;
for (const [reason, count, unmet] of [['HOUSING', 7, 2], ['HEALTH', 6, 0], ['EMPLOYMENT', 2, 0]]) for (let i = 0; i < count; i += 1) {
  n += 1; await q(`INSERT INTO "Referral" (id, "sharedDiagnosticId", "fromStructureId", "toStructureId", status, "reasonCode", "responseCode", "sentAt", "citizenDecisionAt", "grantId", "updatedAt") VALUES ($1, $2, $3, $4, 'DECLINED', $5, $6, $7, $7, 'r47b-synthetic-grant', NOW())`,
    [`r47b-ref-${n}-${S.ts}`, `r47b-sd-${S.ts}`, `r47b-org-1-${S.ts}`, `r47b-org-${2 + (i % 2)}-${S.ts}`, reason, i < unmet ? 'NO_CAPACITY' : null, mid]);
}

const app = await startApp({ port: PORT, dist: process.env.R47_DIST || 'dist-r47' });
const { signProToken } = await import('../../api/_utils/auth.js');
const creds = {
  base, admins: admins.map((a) => ({ email: a.email, password: a.password, secret: a.secret })),
  citizen: { id: S.citizen.id, email: S.citizen.email, password: S.citizen.password, cookie: encodeURIComponent(signUserSessionToken({ userId: S.citizen.id, email: S.citizen.email })) },
  citizen2: { id: c2.id, cookie: encodeURIComponent(signUserSessionToken({ userId: c2.id, email: c2.email })) },
  pro: { token: signProToken({ id: S.pro.id, email: S.pro.email, structureId: S.structure.id, role: 'STRUCTURE_ADMIN' }, { mfa: true }), structureId: S.structure.id },
  institution: S.institution, aide, structure: S.structure, control: `http://127.0.0.1:${CONTROL}`,
};
fs.writeFileSync(process.env.R47_CREDS, JSON.stringify(creds), { mode: 0o600 });

// loopback control: one allow-listed variable at a time, the OpenFisca stand-in up/down, the HDS stand-in object count
const ALLOWED = new Set(['ADA_HDS_CERTIFIED_HOSTING', 'ADA_PROTECTED_STORE', 'VERCEL_ENV', 'OPEN_DATA_EXPORT_ENABLED', 'ADA_CAPABILITIES_OPEN', 'ADA_BETA_OPEN_SURFACES']);
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const b = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const reply = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.url === '/restore') { for (const k of ALLOWED) { if (k in FINAL) process.env[k] = FINAL[k]; else delete process.env[k]; } engineUp = true; return reply(200, { ok: true }); }
  if (req.url === '/env') {
    if (!ALLOWED.has(b.name)) return reply(400, { error: 'not allowed' });
    if (b.name === 'VERCEL_ENV' && b.value !== 'preview') return reply(400, { error: 'preview only' });
    if (b.value === null) delete process.env[b.name]; else process.env[b.name] = String(b.value);
    return reply(200, { ok: true });
  }
  if (req.url === '/openfisca') { engineUp = Boolean(b.up); return reply(200, { up: engineUp }); }
  if (req.url === '/hds') return reply(200, { objects: hds.objects.size, calls: hds.calls.length });
  if (req.url === '/model') return reply(200, { calls: model.calls() });
  if (req.url === '/sink') return reply(200, { received: sink.received.length });
  return reply(404, {});
}).listen(CONTROL, '127.0.0.1', () => console.log(`R47 admin LAB ready ${base}`));
process.on('SIGTERM', async () => { await app.close(); await db.end(); process.exit(0); });
