/**
 * C12 (owner decision b) — the /ressources publication path on REAL PostgreSQL, through the real handlers, on BOTH database levels:
 *   - with drizzle/0050: draft → verify (server date, bound to the version read) → publish → withdraw, by a named administrator with MFA only; markup,
 *     a non-https or non-official source refused; the public list and page show source, publisher and verification date and never the reviewer; the
 *     staleness rule of the catalogue (> 180 days hidden, > 90 days « update needed »); the ledger is append-only; a legacy row (no publisher, no
 *     verification) is never public and gets nothing invented;
 *   - without 0050 (Production today): the public list stays empty even with a legacy « published » row, a document answers 404, the administration
 *     lists the rows read-only (available=false) and refuses every write with 503 MIGRATION_0050_REQUIRED.
 * Synthetic rows only. QA v43: the file makes its OWN two databases on the suite's cluster (tests/integration/helpers/throwaway-db.mjs, as the 0046/0047
 * compat suites) — one migrated up to 0049, one fully migrated — loads the handlers once per database (vi.resetModules: the database module binds
 * DATABASE_URL when it is imported) and drops both at the end. Nothing skips on a migrated suite database; skipped only without a loopback DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { sql } from 'drizzle-orm';
import { createThrowawayDatabase, isLoopbackDatabaseUrl } from './helpers/throwaway-db.mjs';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const SUITE_URL = process.env.DATABASE_URL;
const hasDatabase = isLoopbackDatabaseUrl(SUITE_URL);   // throwaway databases are only made on a loopback cluster
const BEFORE_0050 = '0049_pa_conversation_read';
const LATEST = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries.at(-1).tag;
const TS = Date.now().toString(36);
const LEGACY = `rs-legacy-${TS}`;
const ADMIN = `rs-admin-${TS}@example.test`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end(d) { if (d !== undefined) this.body = d; return this; } });
/** the database's own message of a refused statement (drizzle wraps it as « Failed query: … » with the driver error as cause) */
const refusal = (p) => p.then(() => 'ACCEPTED', (e) => `${e?.message} ${e?.cause?.message || ''}`);
const GOOD = { title: `Guide officiel des services en ligne ${TS}`, type: 'guide', content: 'Présentation officielle des services en ligne de la Caf, avec le lien vers la page source.',
  source_url: 'https://www.caf.fr/allocataires/mes-services-en-ligne', source_publisher: 'Caf — Caisse nationale des allocations familiales' };

describe.skipIf(!hasDatabase)('C12 /ressources publication (real DB, with and without 0050)', () => {
  /** @type {Record<'pre' | 'full', any>} one database per level, each with its own copy of the handlers */
  const L = { pre: null, full: null };
  const bearer = (ctx, mfa) => ({ host: 'x', authorization: `Bearer ${ctx.auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: mfa })}` });
  const adminOn = async (ctx, method, { query = {}, body, mfa = true, headers } = {}) => { const r = mk(); await ctx.adminH({ method, url: '/api/admin/resources', query, body, headers: headers ?? bearer(ctx, mfa) }, r); return r; };
  const pubOn = async (ctx, query = {}) => { const r = mk(); await ctx.publicH({ method: 'GET', url: '/api/ressources', query, headers: { host: 'x' } }, r); return r; };
  const listedOn = async (ctx) => (await pubOn(ctx)).body.items.map((i) => i.id);
  const levels = () => [L.pre, L.full];

  /** a throwaway database migrated up to `upTo`, then the handlers imported against it */
  const open = async (key, upTo) => {
    const throwaway = await createThrowawayDatabase({ prefix: `ada_c12_${key}`, upTo, baseUrl: SUITE_URL });   // on the suite's cluster, never inside the other throwaway
    const ctx = { throwaway }; L[key] = ctx;
    process.env.DATABASE_URL = throwaway.url;   // read by src/db/index when it is imported, just below
    vi.resetModules();
    ({ db: ctx.db } = await import('../../src/db/index.js'));
    ctx.auth = await import('../../api/_utils/auth.js');
    ({ default: ctx.adminH } = await import('../../api/_handlers/admin/resources.js'));
    ({ default: ctx.publicH } = await import('../../api/_handlers/ressources.js'));
    ctx.has0050 = await (await import('../../api/_utils/schema-features.js')).resourcePublicationSchema(ctx.db);
    // a row as it may exist before 0050: « published », an address, nothing else (no publisher, no verification, no reviewer)
    await ctx.db.execute(sql`INSERT INTO "ResourceAccessibility" (id, slug, title, type, content, source_url, status, "updatedAt") VALUES (${LEGACY}, ${LEGACY}, 'Ancien document', 'guide', 'Texte ancien sans vérification.', 'https://www.caf.fr/ancien', 'published', NOW())`);
  };

  beforeAll(async () => {
    await open('pre', BEFORE_0050);
    await open('full', LATEST);
  }, 240000);

  afterAll(async () => {
    // the ledger is append-only by design (its trigger refuses DELETE): the whole throwaway databases go instead
    try { for (const ctx of levels()) await ctx?.db?.$client?.end?.().catch(() => {}); } finally {
      process.env.DATABASE_URL = SUITE_URL;
      for (const ctx of levels()) await ctx?.throwaway?.drop();
    }
  }, 60000);

  it('the database level is the one this run was started for', () => {
    expect(L.pre.throwaway.applied.at(-1)).toBe(BEFORE_0050); expect(L.pre.has0050).toBe(false);
    expect(L.full.throwaway.applied.at(-1)).toBe(LATEST); expect(L.full.has0050).toBe(true);
  });

  it('administration gates: no session 401; a write without MFA 403', async () => {
    for (const ctx of levels()) {
      expect((await adminOn(ctx, 'GET', { headers: { host: 'x' } })).statusCode).toBe(401);
      const r = await adminOn(ctx, 'POST', { body: { action: 'create', draft: GOOD }, mfa: false });
      expect(r.statusCode).toBe(403); expect(r.body.error).toBe('HUMAN_MFA_SESSION_REQUIRED');
    }
  });

  it('the legacy row is never public, on both levels, and nothing is invented for it', async () => {
    for (const ctx of levels()) {
      expect(await listedOn(ctx)).not.toContain(LEGACY);
      expect((await pubOn(ctx, { slug: LEGACY })).statusCode).toBe(404);
      const row = (await ctx.db.execute(sql`SELECT * FROM "ResourceAccessibility" WHERE id = ${LEGACY}`)).rows[0];
      expect(row.status).toBe('published');
      if (ctx.has0050) expect([row.source_publisher, row.verified_at, row.reviewer_id, row.reviewer_type, row.verified_version, row.published_at]).toEqual([null, null, null, null, null, null]);
    }
  });

  describe('without 0050', () => {
    const admin = (...a) => adminOn(L.pre, ...a); const pub = (...a) => pubOn(L.pre, ...a);
    it('the public list is empty, the administration is read-only and refuses writes with 503', async () => {
      expect((await pub()).body).toMatchObject({ items: [], pagination: { total: 0 } });
      const g = await admin('GET');
      expect(g.statusCode).toBe(200); expect(g.body.available).toBe(false);
      expect(g.body.items.map((i) => i.id)).toContain(LEGACY);
      const c = await admin('POST', { body: { action: 'create', draft: GOOD } });
      expect(c.statusCode).toBe(503); expect(c.body.error).toBe('MIGRATION_0050_REQUIRED');
    });
  });

  describe('with 0050', () => {
    const admin = (...a) => adminOn(L.full, ...a); const pub = (...a) => pubOn(L.full, ...a); const listed = () => listedOn(L.full);
    const db = { execute: (q) => L.full.db.execute(q) };
    let id; let slug;
    it('server-side validation: markup and non-https sources are refused; a non-official host may be drafted but never verified', async () => {
      let r = await admin('POST', { body: { action: 'create', draft: { ...GOOD, content: `${GOOD.content} <script>alert(1)</script>` } } });
      expect(r.statusCode).toBe(422); expect(r.body.problems).toContain('UNSAFE_MARKUP_DESCRIPTION');
      r = await admin('POST', { body: { action: 'create', draft: { ...GOOD, source_url: 'http://www.caf.fr/x' } } });
      expect(r.statusCode).toBe(422); expect(r.body.problems).toContain('UNSAFE_SOURCE_URL_NOT_HTTPS');
      r = await admin('POST', { body: { action: 'create', draft: { ...GOOD, title: `Blog non officiel ${TS}`, source_url: 'https://blog.example.com/aide' } } });
      expect(r.statusCode).toBe(201); expect(r.body.problems).toContain('SOURCE_DOMAIN_NOT_OFFICIAL');
      const one = await admin('GET', { query: { id: r.body.id } });
      const v = await admin('POST', { body: { action: 'verify', id: r.body.id, expectedVersion: one.body.version, note: 'Page consultée le jour même.' } });
      expect(v.statusCode).toBe(422); expect(v.body.problems).toContain('SOURCE_DOMAIN_NOT_OFFICIAL');
    });

    it('draft → verify (server date, exact version) → publish, explicit steps only', async () => {
      const c = await admin('POST', { body: { action: 'create', draft: GOOD } });
      expect(c.statusCode).toBe(201); expect(c.body).toMatchObject({ status: 'draft', problems: [] });
      ({ id, slug } = c.body);
      expect(await listed()).not.toContain(id);
      let p = await admin('POST', { body: { action: 'publish', id } });
      expect(p.statusCode).toBe(422); expect(p.body.problems).toContain('NOT_VERIFIED');
      const g = await admin('GET', { query: { id } });
      expect((await admin('POST', { body: { action: 'verify', id, expectedVersion: 'a'.repeat(64), note: 'Page source relue en entier.' } })).body.error).toBe('STALE_REVIEW');
      expect((await admin('POST', { body: { action: 'verify', id, expectedVersion: g.body.version, note: 'court' } })).body.error).toBe('VERIFICATION_NOTE_REQUIRED');
      const before = Date.now();
      const v = await admin('POST', { body: { action: 'verify', id, expectedVersion: g.body.version, note: 'Page source relue en entier, contenu conforme.', verified_at: '2020-01-01' } });
      expect(v.statusCode).toBe(200);
      const at = new Date(v.body.verified_at).getTime();
      expect(at).toBeGreaterThanOrEqual(before - 5000); expect(at).toBeLessThanOrEqual(Date.now() + 5000);   // the server's clock, never the client's value
      expect(await listed()).not.toContain(id);   // verified is not published: no automatic publication
      p = await admin('POST', { body: { action: 'publish', id } });
      expect(p.statusCode).toBe(200); expect(p.body.status).toBe('published');
      const item = (await pub()).body.items.find((i) => i.id === id);
      expect(item).toMatchObject({ source_url: GOOD.source_url, source_publisher: GOOD.source_publisher, freshness: 'current' });
      expect(item.verified_at).toBeTruthy(); expect(item).not.toHaveProperty('reviewer_id');
      const d = await pub({ slug });
      expect(d.statusCode).toBe(200); expect(JSON.stringify(d.body)).not.toContain(ADMIN);
    });

    it('a published document cannot be edited silently; the ledger is append-only and the journal names the administrator', async () => {
      expect((await admin('POST', { body: { action: 'edit', id, draft: { ...GOOD, content: `${GOOD.content} Modifié.` } } })).body.error).toBe('WITHDRAW_BEFORE_EDITING');
      const ev = (await db.execute(sql`SELECT action, "actorType", "actorId", "toStatus" FROM "ResourcePublicationEvent" WHERE "resourceId" = ${id} ORDER BY "createdAt", action`)).rows;
      expect(ev.map((e) => e.action)).toEqual(['CREATE', 'VERIFY', 'PUBLISH']);
      expect(ev.every((e) => e.actorType === 'admin' && e.actorId === ADMIN)).toBe(true);
      expect(await refusal(db.execute(sql`UPDATE "ResourcePublicationEvent" SET note = 'x' WHERE "resourceId" = ${id}`))).toMatch(/append-only/);
      expect(await refusal(db.execute(sql`DELETE FROM "ResourcePublicationEvent" WHERE "resourceId" = ${id}`))).toMatch(/append-only/);
      const audit = (await db.execute(sql`SELECT action FROM "AuditLog" WHERE entity_id = ${id} AND actor = ${ADMIN} ORDER BY timestamp`)).rows.map((r) => r.action);
      expect(audit).toEqual(expect.arrayContaining(['RESOURCE_CREATE', 'RESOURCE_VERIFY', 'RESOURCE_PUBLISH']));
      // the database refuses a verification date without its reviewer, publisher and address
      expect(await refusal(db.execute(sql`UPDATE "ResourceAccessibility" SET verified_at = NOW() WHERE id = ${LEGACY}`))).toMatch(/ResourceAccessibility_verification_check/);
    });

    it('staleness as in the catalogue: > 90 days « update needed », > 180 days hidden; a renewed verification brings it back', async () => {
      await db.execute(sql`UPDATE "ResourceAccessibility" SET verified_at = NOW() - interval '120 days' WHERE id = ${id}`);
      expect((await pub()).body.items.find((i) => i.id === id).freshness).toBe('update_needed');
      await db.execute(sql`UPDATE "ResourceAccessibility" SET verified_at = NOW() - interval '181 days' WHERE id = ${id}`);
      expect(await listed()).not.toContain(id);
      expect((await pub({ slug })).statusCode).toBe(404);
      const g = await admin('GET', { query: { id } });
      expect(g.body.publicDecision.reasons).toContain('VERIFICATION_STALE');
      const v = await admin('POST', { body: { action: 'verify', id, expectedVersion: g.body.version, note: 'Source relue : contenu toujours conforme.' } });
      expect(v.statusCode).toBe(200);
      expect(await listed()).toContain(id);
    });

    it('withdrawal: a reason is required, the document leaves the list and its address answers 410 without the reason', async () => {
      expect((await admin('POST', { body: { action: 'withdraw', id, reason: 'court' } })).body.error).toBe('WITHDRAWAL_REASON_REQUIRED');
      const w = await admin('POST', { body: { action: 'withdraw', id, reason: 'Page source supprimée par l’éditeur.' } });
      expect(w.statusCode).toBe(200);
      expect(await listed()).not.toContain(id);
      const d = await pub({ slug });
      expect(d.statusCode).toBe(410); expect(JSON.stringify(d.body)).not.toContain('supprimée');
    });

    it('the legacy row: verify refused until a human completes it; once edited it is a draft that needs its own verification', async () => {
      const g = await admin('GET', { query: { id: LEGACY } });
      expect(g.body.legacy).toBe(true);
      expect((await admin('POST', { body: { action: 'verify', id: LEGACY, expectedVersion: g.body.version, note: 'Tentative de vérification directe.' } })).body.error).toBe('LEGACY_ROW_EDIT_FIRST');
      const e = await admin('POST', { body: { action: 'edit', id: LEGACY, draft: { ...GOOD, title: `Ancien document complété ${TS}` } } });
      expect(e.statusCode).toBe(200); expect(e.body.status).toBe('draft');
      const row = (await db.execute(sql`SELECT status, verified_at, reviewer_id FROM "ResourceAccessibility" WHERE id = ${LEGACY}`)).rows[0];
      expect(row).toMatchObject({ status: 'draft', verified_at: null, reviewer_id: null });
      expect(await listed()).not.toContain(LEGACY);
    });
  });
});
