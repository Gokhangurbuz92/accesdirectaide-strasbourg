/**
 * R42-CDGG (DEC-R42-03) — the fictional LAB pilot « CDGG Conseil » is LAB-only. On a REAL PostgreSQL (0042 and 0044), the real seed script
 * (scripts/lab/seed-cdgg-conseil.mjs) writes the fixture; then, OUTSIDE lab mode (strict — the only mode Production honours), the fixture must be absent from
 * the public directory list and detail, the search, the sitemap, the booking profile / slots / booking (same answer as an unknown slug), and it never
 * carries a FINESS number, a SIRET or a source (so no FINESS total or coverage count can include it). In lab mode it is visible and labelled LAB_UNVERIFIED,
 * and its location is never « verified ». The seed refuses a non-lab mode, a non-local host and a non-LAB database name.
 * Run: DBN=ada_r42_cdgg_0042_test bash $S/r42/cdgg/int.sh tests/integration/r42-cdgg-fixture-isolation-db.test.js   (and DBN=ada_r42_cdgg_0044_test)
 */
import { vi } from 'vitest';
vi.stubEnv('MAILER_PROVIDER', 'test');
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
vi.mock('../../api/_utils/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  getRateLimitStatus: vi.fn().mockReturnValue(429),
}));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; },
  setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; }, writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); return this; }, end(d) { if (d !== undefined) this.body = d; return this; } });
const ROOT = path.resolve(import.meta.dirname, '../..');
const SEED = path.join(ROOT, 'scripts/lab/seed-cdgg-conseil.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r42-cdgg-'));
const credentials = path.join(tmp, 'credentials.json');
const seedEnv = (over = {}) => ({ PATH: process.env.PATH, HOME: process.env.HOME, TZ: 'UTC', DATABASE_URL: process.env.DATABASE_URL, ADA_PUBLIC_CONTENT_MODE: 'lab', NODE_ENV: 'development',
  JWT_SECRET: process.env.JWT_SECRET, AUTH_SECRET: process.env.AUTH_SECRET, ADA_ENCRYPTION_KEY: process.env.ADA_ENCRYPTION_KEY, OUTLOOK_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'), ...over });
const runSeed = (cmd, env) => { try { return { code: 0, out: execFileSync(process.execPath, ['--import', 'tsx', SEED, cmd, '--credentials', credentials], { cwd: ROOT, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; } };

describe.skipIf(!hasDatabase)('R42-CDGG fixture isolation (real DB)', () => {
  let db, structures, search, sitemap, rdv, userAuth;
  const SLUG = 'cdgg-conseil';
  const call = async (handler, req) => { const r = mk(); await handler({ headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http' }, query: {}, ...req }, r); return r; };
  const text = (r) => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
  const strict = () => { vi.stubEnv('ADA_PUBLIC_CONTENT_MODE', 'strict'); };
  const lab = () => { vi.stubEnv('ADA_PUBLIC_CONTENT_MODE', 'lab'); };

  beforeAll(async () => {
    const seeded = runSeed('seed', seedEnv());
    expect(seeded.code, seeded.out).toBe(0);
    expect(seeded.out).not.toMatch(/password|totp|secret/i);
    ({ db } = await import('../../src/db/index.js'));
    structures = (await import('../../api/_handlers/structures.js')).default;
    search = (await import('../../api/_handlers/search.js')).default;
    sitemap = (await import('../../api/_handlers/sitemap.js')).default;
    ({ default: rdv } = await import('../../api/_handlers/rdv.js'));
    userAuth = await import('../../api/_utils/user-auth.js');
  }, 120000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    runSeed('remove', seedEnv());
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('the seed refuses outside a local LAB database in lab mode, and writes nothing', () => {
    const base = process.env.DATABASE_URL;
    const u = new URL(base);
    const cases = [
      seedEnv({ ADA_PUBLIC_CONTENT_MODE: 'strict' }),
      seedEnv({ NODE_ENV: 'production' }),
      seedEnv({ VERCEL_ENV: 'production' }),
      seedEnv({ DATABASE_URL: `postgresql://${u.username}@db.example.invalid:5432${u.pathname}` }),
      seedEnv({ DATABASE_URL: `postgresql://${u.username}@${u.host}/ada_production` }),
    ];
    for (const env of cases) {
      const r = runSeed('seed', env);
      expect(r.code, r.out).toBe(3);
      expect(r.out).toMatch(/refusing to run/);
    }
  });

  it('the fixture is a synthetic fixture: no source, no FINESS number, no SIRET, no phone, a fictitious address and the LAB status text', async () => {
    const row = (await db.execute(sql`SELECT data_origin, source_url, source_url_exact, numero_finess, siret, telephone, email, site_web, adresse, description_courte, launch_eligible, territory_verified
      FROM "Structure" WHERE slug = ${SLUG}`)).rows[0];
    expect(row.data_origin).toBe('synthetic_fixture');
    expect([row.source_url, row.source_url_exact, row.numero_finess, row.siret, row.telephone, row.email, row.site_web]).toEqual([null, null, null, null, null, null, null]);
    expect(row.adresse).toMatch(/^Adresse fictive/);
    expect(row.description_courte).toMatch(/^Structure fictive de démonstration — environnement LAB uniquement\. CDGG Conseil est une structure fictive de démonstration/);
    expect([row.launch_eligible, row.territory_verified]).toEqual([false, false]);
    const emails = (await db.execute(sql`SELECT email FROM "ProUser" WHERE "structureId" IN ('lab-cdgg-conseil', 'lab-temoin-structure') UNION ALL SELECT email FROM "CitizenUser" WHERE id LIKE 'lab-cdgg-%'`)).rows.map((r) => r.email);
    expect(emails.length).toBeGreaterThanOrEqual(10);
    for (const e of emails) expect(e).toMatch(/\.example\.test$/);
    expect(fs.statSync(credentials).mode & 0o077).toBe(0);   // credentials file readable by its owner only
  });

  it('strict mode (Production): absent from the directory list and detail, the search, the sitemap and every booking route', async () => {
    strict();
    try {
      const list = await call(structures, { method: 'GET', url: '/api/structures', query: {} });
      expect(list.statusCode, text(list).slice(0, 200)).toBe(200);
      expect(text(list)).not.toMatch(/CDGG|cdgg-conseil|structure-temoin-fictive/);
      const listQ = await call(structures, { method: 'GET', url: '/api/structures?search=CDGG', query: { search: 'CDGG' } });
      expect(text(listQ)).not.toMatch(/cdgg-conseil/);
      const detail = await call(structures, { method: 'GET', url: `/api/structures?slug=${SLUG}`, query: { slug: SLUG } });
      expect(detail.statusCode).toBe(404);
      for (const q of ['démarches administratives emploi', 'CDGG Conseil', 'handicap cognitif']) {
        const s = await call(search, { method: 'POST', url: '/api/search', body: { query: q } });
        expect(s.statusCode, text(s).slice(0, 200)).toBe(200);
        expect(text(s)).not.toMatch(/CDGG|cdgg-conseil/);
      }
      const map = await call(sitemap, { method: 'GET', url: '/sitemap.xml' });
      expect(text(map)).not.toMatch(/cdgg-conseil|structure-temoin-fictive/);
      const unknown = mk(); await rdv({ method: 'GET', url: '/api/rdv/structures/lab-no-such-slug/profile', query: {}, headers: { host: 'localhost:3000' } }, unknown);
      const prof = mk(); await rdv({ method: 'GET', url: `/api/rdv/structures/${SLUG}/profile`, query: {}, headers: { host: 'localhost:3000' } }, prof);
      expect([prof.statusCode, prof.body]).toEqual([unknown.statusCode, unknown.body]);
      expect(prof.statusCode).toBe(404);
      const cred = JSON.parse(fs.readFileSync(credentials, 'utf8'));
      const c = cred.citizens.client;
      const cookie = userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: c.id, email: c.email })).split(';')[0];
      const slots = mk(); await rdv({ method: 'GET', url: `/api/rdv/structures/${SLUG}/slots?serviceId=${cred.services.direct.id}`, query: { serviceId: cred.services.direct.id }, headers: { host: 'localhost:3000', cookie } }, slots);
      expect(slots.statusCode).toBe(404);
      const book = mk(); await rdv({ method: 'POST', url: '/api/rdv/appointments', query: {}, headers: { host: 'localhost:3000', cookie },
        body: { structureSlug: SLUG, serviceId: cred.services.direct.id, startAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), idempotencyKey: 'strict-cdgg' } }, book);
      expect(book.statusCode).toBe(404);
      expect((await db.execute(sql`SELECT count(*)::int n FROM "ProAppointment" WHERE "idempotencyKey" = 'strict-cdgg'`)).rows[0].n).toBe(0);
    } finally { lab(); }
  });

  it('NODE_ENV=production forces strict mode even with ADA_PUBLIC_CONTENT_MODE=lab', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const detail = await call(structures, { method: 'GET', url: `/api/structures?slug=${SLUG}`, query: { slug: SLUG } });
      expect(detail.statusCode).toBe(404);
      const prof = mk(); await rdv({ method: 'GET', url: `/api/rdv/structures/${SLUG}/profile`, query: {}, headers: { host: 'localhost:3000' } }, prof);
      expect(prof.statusCode).toBe(404);
    } finally { vi.stubEnv('NODE_ENV', 'test'); }
  });

  it('lab mode: visible, labelled LAB_UNVERIFIED, bookable for the acceptance, the location never « verified »', async () => {
    lab();
    const detail = await call(structures, { method: 'GET', url: `/api/structures?slug=${SLUG}`, query: { slug: SLUG } });
    expect(detail.statusCode).toBe(200);
    expect(detail.body.provenance.contentStatus).toBe('LAB_UNVERIFIED');
    const prof = mk(); await rdv({ method: 'GET', url: `/api/rdv/structures/${SLUG}/profile`, query: {}, headers: { host: 'localhost:3000' } }, prof);
    expect(prof.statusCode).toBe(200);
    expect(prof.body.structure.location.verified).toBe(false);
    expect(prof.body.services.map((s) => s.confirmation).sort()).toEqual(['APPROVAL', 'DIRECT']);
    expect(JSON.stringify(prof.body)).not.toMatch(/rdvMemberHours|rdvBooking|example\.test/);
  });
});
