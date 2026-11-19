/**
 * G10 — the five expansion capabilities merged on the G9 candidate (X04 events 0053, X02 testimonials 0054, X01 stories 0055, X05 job board 0056,
 * X03 Entraide 0057), checked TOGETHER on REAL PostgreSQL through the real API entry (api/index.js):
 *   - CLOSED in every Production-like configuration: today's (restricted beta, admin + accounts, narrow or full accounts scope, pro opened too),
 *     Production without the beta and no capability listed, all five surfaces opened without their capabilities; and opening ONE of them (surface AND
 *     capability) opens none of the other four;
 *   - the personal-data tables of 0053..0057, read from the migration files and the database catalogue (foreign keys reaching CitizenUser): each one is in
 *     the erasure lineage (privacy.js) and in the export sections, and every foreign key on its path to the account is ON DELETE CASCADE;
 *   - one person with a row in EVERY such table: the export lists each section, an approved erasure leaves no row of the person in any of them (the other
 *     account keeps its own), and purge step 6c (unverified account) does the same.
 * FIXTURES: every account and every text below is a SYNTHETIC TEST FIXTURE (example.test addresses, « FIXTURE » texts); they are deleted afterwards.
 * Skipped without DATABASE_URL.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const TAG = TS.toString(36).slice(-5).replace(/\d/g, (c) => 'abcdefghij'[Number(c)]);
const u = (k) => ({ id: `g10x-${k}-${TS}`, email: `g10x-${k}-${TS}@example.test`, k });
const S = u('s'); const O = u('o'); const UNV = u('unv');
const ALL = [S, O, UNV];
const ADMIN = `g10x-admin-${TS}@example.test`;
const DAY = 86400e3;

/** capability → its surface and one probe per route family (public, citizen, pro, admin) */
const FIVE = {
  'community.events': { surface: 'events', probes: [['GET', '/api/events'], ['GET', '/api/citizen/events'], ['POST', '/api/citizen/events'], ['GET', '/api/admin/events']] },
  'community.testimonials': { surface: 'testimonials', probes: [['GET', '/api/testimonials'], ['GET', '/api/citizen/testimonials'], ['POST', '/api/citizen/testimonials'], ['GET', '/api/admin/testimonials']] },
  'community.stories': { surface: 'stories', probes: [['GET', '/api/stories'], ['GET', '/api/citizen/stories'], ['POST', '/api/citizen/stories'], ['GET', '/api/admin/stories']] },
  'community.employment': { surface: 'employment', probes: [['GET', '/api/employment'], ['GET', '/api/pro/employment'], ['POST', '/api/pro/employment'], ['GET', '/api/admin/employment']] },
  'community.entraide': { surface: 'entraide', probes: [['GET', '/api/citizen/entraide'], ['POST', '/api/citizen/entraide'], ['GET', '/api/admin/entraide']] },
};
const PROD_NOW = { VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: 'true', ADA_BETA_OPEN_SURFACES: 'admin,accounts', ADA_CAPABILITIES_OPEN: '', ADA_BETA_ACCOUNTS_SCOPE: '' };

/** tables created by the five expansion migrations, read from the SQL files themselves */
const EXPANSION_TABLES = fs.readdirSync('drizzle').filter((f) => /^005[3-7]_.*\.sql$/.test(f)).sort()
  .flatMap((f) => [...fs.readFileSync(`drizzle/${f}`, 'utf8').matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]));

function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; },
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c, h) { this.statusCode = c; if (h) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v; return this; },
    json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('G10 — the five expansion capabilities together (real DB, real API entry)', () => {
  let db; let api; let userAuth; let auth;
  const CSRF = 'g10xcsrftoken0123456789abcdef';
  const sessionOf = (x) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: x.id, email: x.email })).split(';')[0];
  const call = async (method, url, { as, body, bearer } = {}) => {
    const cookies = [as ? sessionOf(as) : '', `__csrf=${CSRF}`].filter(Boolean).join('; ');
    const req = { method, url, query: Object.fromEntries(new URL(url, 'http://localhost').searchParams), body: body ?? (method === 'POST' ? {} : null), cookies: {},
      headers: { host: 'localhost:5210', 'x-forwarded-proto': 'http', cookie: cookies, 'x-csrf-token': CSRF, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } };
    const res = mkRes(); await api(req, res); return res;
  };
  const probe = (cap) => Promise.all(FIVE[cap].probes.map(([m, url]) => call(m, url, { as: S, bearer: /\/admin\//.test(url) ? auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: true }) : undefined })
    .then((r) => ({ url: `${m} ${url}`, r }))));
  const withEnv = async (vars, fn) => {
    const keep = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    try { return await fn(); } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  };
  const one = async (q) => (await db.execute(q)).rows[0];
  const n = async (q) => Number((await one(q)).n);
  const ids = () => sql.join(ALL.map((x) => sql`${x.id}`), sql`, `);
  const ITEM = crypto.randomUUID();

  /** every personal row of account x in the expansion tables, table by table */
  const rowsOf = async (x) => {
    const q = {
      EventRegistration: sql`SELECT count(*)::int n FROM "EventRegistration" WHERE "citizenUserId" = ${x.id}`,
      Testimonial: sql`SELECT count(*)::int n FROM "Testimonial" WHERE "citizenUserId" = ${x.id}`,
      TestimonialReport: sql`SELECT count(*)::int n FROM "TestimonialReport" r LEFT JOIN "Testimonial" t ON t.id = r."testimonialId" WHERE r."reporterUserId" = ${x.id} OR t."citizenUserId" = ${x.id}`,
      CommunityMember: sql`SELECT count(*)::int n FROM "CommunityMember" WHERE "citizenUserId" = ${x.id}`,
      CommunityStory: sql`SELECT count(*)::int n FROM "CommunityStory" s JOIN "CommunityMember" m ON m.id = s."memberId" WHERE m."citizenUserId" = ${x.id}`,
      CommunityStoryReport: sql`SELECT count(*)::int n FROM "CommunityStoryReport" r JOIN "CommunityStory" s ON s.id = r."storyId" JOIN "CommunityMember" m ON m.id = s."memberId" WHERE r."reporterUserId" = ${x.id} OR m."citizenUserId" = ${x.id}`,
      EntraideMember: sql`SELECT count(*)::int n FROM "EntraideMember" WHERE "citizenUserId" = ${x.id}`,
      EntraideOffer: sql`SELECT count(*)::int n FROM "EntraideOffer" o JOIN "EntraideMember" m ON m.id = o."memberId" WHERE m."citizenUserId" = ${x.id}`,
      EntraideRequest: sql`SELECT count(*)::int n FROM "EntraideRequest" q JOIN "EntraideOffer" o ON o.id = q."offerId" JOIN "EntraideMember" a ON a.id = q."requesterId" JOIN "EntraideMember" b ON b.id = o."memberId" WHERE a."citizenUserId" = ${x.id} OR b."citizenUserId" = ${x.id}`,
      EntraideContactShare: sql`SELECT count(*)::int n FROM "EntraideContactShare" c JOIN "EntraideMember" m ON m.id = c."memberId" WHERE m."citizenUserId" = ${x.id}`,
      EntraideReport: sql`SELECT count(*)::int n FROM "EntraideReport" r JOIN "EntraideMember" a ON a.id = r."reporterId" JOIN "EntraideMember" b ON b.id = r."targetId" WHERE a."citizenUserId" = ${x.id} OR b."citizenUserId" = ${x.id}`,
      EntraideBlock: sql`SELECT count(*)::int n FROM "EntraideBlock" k JOIN "EntraideMember" a ON a.id = k."blockerId" JOIN "EntraideMember" b ON b.id = k."blockedId" WHERE a."citizenUserId" = ${x.id} OR b."citizenUserId" = ${x.id}`,
    };
    const out = {};
    for (const [t, query] of Object.entries(q)) out[t] = await n(query);
    return out;
  };

  /** x gets a row in every personal table; with y (already seeded) the cross rows: reports, requests, shared e-mail, block */
  const seed = async (x, y) => {
    const mC = crypto.randomUUID(); const mE = crypto.randomUUID(); const t = crypto.randomUUID(); const st = crypto.randomUUID(); const off = crypto.randomUUID();
    Object.assign(x, { mC, mE, t, st, off });
    await db.execute(sql`INSERT INTO "EventRegistration" (id, "itemId", "citizenUserId", "accessibilityNeed", "accessibilityNeedAt", "updatedAt") VALUES (${crypto.randomUUID()}, ${ITEM}, ${x.id}, 'QUIET_SPACE', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "Testimonial" (id, "citizenUserId", "displayName", body, lang, "consentVersion", "submittedAt", "updatedAt") VALUES (${t}, ${x.id}, ${`Fx ${x.k}`}, ${`FIXTURE ${TAG} témoignage synthétique pour le contrôle croisé G10.`}, 'fr', 'g10-fixture', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "CommunityMember" (id, "citizenUserId", pseudonym) VALUES (${mC}, ${x.id}, ${`Gc${x.k}${TAG}`})`);
    await db.execute(sql`INSERT INTO "CommunityStory" (id, "memberId", title, body, lang, "consentVersion", "submittedAt", "updatedAt") VALUES (${st}, ${mC}, ${`FIXTURE ${TAG}`}, ${`FIXTURE ${TAG} — une histoire synthétique assez longue pour passer la règle de longueur minimale.`}, 'fr', 'g10-fixture', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "EntraideMember" (id, "citizenUserId", pseudonym, "charterVersion", "charterAcceptedAt", "updatedAt") VALUES (${mE}, ${x.id}, ${`Ge${x.k}${TAG}`}, 'g10-fixture', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "EntraideOffer" (id, "memberId", category, area, note, "updatedAt") VALUES (${off}, ${mE}, 'SHOPPING', 'OSTWALD', ${`FIXTURE ${TAG}`}, NOW())`);
    if (!y) return;
    for (const [a, b] of [[x, y], [y, x]]) {
      const rq = crypto.randomUUID();
      await db.execute(sql`INSERT INTO "TestimonialReport" (id, "testimonialId", "reporterUserId", reason) VALUES (${crypto.randomUUID()}, ${b.t}, ${a.id}, 'OFF_TOPIC')`);
      await db.execute(sql`INSERT INTO "CommunityStoryReport" (id, "storyId", "reporterUserId", reason) VALUES (${crypto.randomUUID()}, ${b.st}, ${a.id}, 'OFF_TOPIC')`);
      await db.execute(sql`INSERT INTO "EntraideRequest" (id, "offerId", "requesterId", note, status, "decidedAt", "updatedAt") VALUES (${rq}, ${b.off}, ${a.mE}, ${`FIXTURE ${TAG}`}, 'accepted', NOW(), NOW())`);
      await db.execute(sql`INSERT INTO "EntraideContactShare" (id, "requestId", "memberId", email) VALUES (${crypto.randomUUID()}, ${rq}, ${a.mE}, ${`g10x-share-${a.k}-${TS}@example.test`})`);
      await db.execute(sql`INSERT INTO "EntraideReport" (id, "reporterId", "targetId", reason) VALUES (${crypto.randomUUID()}, ${a.mE}, ${b.mE}, 'SPAM')`);
      await db.execute(sql`INSERT INTO "EntraideBlock" (id, "blockerId", "blockedId") VALUES (${crypto.randomUUID()}, ${a.mE}, ${b.mE})`);
    }
  };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default;
    userAuth = await import('../../api/_utils/user-auth.js');
    auth = await import('../../api/_utils/auth.js');
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${S.id}, ${S.email}, 'x', NOW(), NOW()), (${O.id}, ${O.email}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "createdAt", "updatedAt") VALUES (${UNV.id}, ${UNV.email}, 'x', NOW() - interval '9 days', NOW())`);
    await db.execute(sql`INSERT INTO "AcademyItem" (id, kind, status, slug, title, "startsAt", "endsAt", capacity, "venueName", "createdBy", "updatedBy", "approvedBy", "publishedAt", "updatedAt")
      VALUES (${ITEM}, 'EVENT', 'published', ${`g10x-${TAG}`}, ${`FIXTURE ${TAG}`}, NOW() + interval '10 days', NOW() + interval '10 days 2 hours', 30, 'FIXTURE', ${ADMIN}, ${ADMIN}, ${ADMIN}, NOW(), NOW())`);
    await seed(O); await seed(S, O); await seed(UNV, O);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" IN (${ids()})`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuditLog" WHERE actor = ${ADMIN}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${ids()})`);
    await db.execute(sql`DELETE FROM "AcademyItem" WHERE id = ${ITEM}`);
  });

  describe('closed in every Production-like configuration; one opening opens none of the other four', () => {
    it('today’s Production configuration (beta, admin + accounts; narrow or full accounts scope; pro opened too) refuses every route of the five 503 before the handler', async () => {
      for (const env of [PROD_NOW, { ...PROD_NOW, ADA_BETA_ACCOUNTS_SCOPE: 'full' }, { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,pro', ADA_BETA_ACCOUNTS_SCOPE: 'full' }]) {
        await withEnv(env, async () => {
          for (const cap of Object.keys(FIVE)) for (const { url, r } of await probe(cap)) { expect(r.statusCode, `${url} ${JSON.stringify(env)}`).toBe(503); expect(r.body.error, url).toBe('PUBLIC_BETA_RESTRICTED'); }
        });
      }
    });
    it('Production without the beta and no capability listed, or the beta with the five surfaces opened but no capability: 503 CAPABILITY_NOT_OPEN naming the capability', async () => {
      const surfaces = Object.values(FIVE).map((x) => x.surface).join(',');
      for (const env of [{ VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: '', ADA_CAPABILITIES_OPEN: '' }, { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: `admin,accounts,pro,${surfaces}` }]) {
        await withEnv(env, async () => {
          for (const cap of Object.keys(FIVE)) for (const { url, r } of await probe(cap)) { expect(r.statusCode, url).toBe(503); expect(r.body, url).toMatchObject({ error: 'CAPABILITY_NOT_OPEN', capability: cap }); }
        });
      }
    });
    it('opening one capability (its surface AND its capability) leaves the four others closed', async () => {
      for (const opened of Object.keys(FIVE)) {
        await withEnv({ ...PROD_NOW, ADA_BETA_OPEN_SURFACES: `admin,accounts,pro,${FIVE[opened].surface}`, ADA_CAPABILITIES_OPEN: opened }, async () => {
          for (const cap of Object.keys(FIVE).filter((c) => c !== opened)) for (const { url, r } of await probe(cap)) { expect(r.statusCode, `${opened} → ${url}`).toBe(503); }
          const [first] = await probe(opened);
          expect(first.r.statusCode, `${opened} → ${first.url}`).not.toBe(503);
        });
      }
    });
    it('nothing was written by the refused calls (S still has exactly its seeded rows)', async () => {
      expect(await n(sql`SELECT count(*)::int n FROM "EventRegistration" WHERE "citizenUserId" = ${S.id}`)).toBe(1);
      expect(await n(sql`SELECT count(*)::int n FROM "Testimonial" WHERE "citizenUserId" = ${S.id}`)).toBe(1);
    });
  });

  describe('export and erasure cover every personal-data table of 0053..0057', () => {
    it('the migration files create the fourteen expected tables; the catalogue says which reach CitizenUser, all through ON DELETE CASCADE', async () => {
      expect(EXPANSION_TABLES.sort()).toEqual(['AcademyItem', 'CommunityMember', 'CommunityStory', 'CommunityStoryReport', 'EntraideBlock', 'EntraideContactShare', 'EntraideMember',
        'EntraideOffer', 'EntraideReport', 'EntraideRequest', 'EventRegistration', 'JobListing', 'Testimonial', 'TestimonialReport']);
      const fks = (await db.execute(sql`SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent, confdeltype AS del FROM pg_constraint WHERE contype = 'f'`)).rows
        .map((r) => ({ child: r.child.replace(/"/g, ''), parent: r.parent.replace(/"/g, ''), del: r.del }));
      // fixpoint: a table reaches the account when one of its foreign keys points to CitizenUser or to a table that does
      const reach = new Set(['CitizenUser']);
      for (let grew = true; grew;) { grew = false; for (const f of fks) if (reach.has(f.parent) && !reach.has(f.child)) { reach.add(f.child); grew = true; } }
      const personal = EXPANSION_TABLES.filter((t) => reach.has(t)).sort();
      expect(personal).toEqual(['CommunityMember', 'CommunityStory', 'CommunityStoryReport', 'EntraideBlock', 'EntraideContactShare', 'EntraideMember', 'EntraideOffer', 'EntraideReport',
        'EntraideRequest', 'EventRegistration', 'Testimonial', 'TestimonialReport']);
      for (const t of personal) for (const f of fks.filter((x) => x.child === t && reach.has(x.parent))) expect(f.del, `${t} → ${f.parent}`).toBe('c');
      const { USER_PERSONAL_DATA_LINEAGE } = await import('../../api/_services/privacy.js');
      const { EXPORT_SECTION_TABLES } = await import('../../api/_services/export-account-sections.js');
      const lineage = Object.values(USER_PERSONAL_DATA_LINEAGE).flatMap((x) => x.storageEntities);
      for (const t of personal) { expect(lineage, t).toContain(t); expect(Object.values(EXPORT_SECTION_TABLES), t).toContain(t); }
    });
    it('the seed gives S a row in every one of the twelve tables', async () => {
      const r = await rowsOf(S);
      for (const [t, c] of Object.entries(r)) expect(c, t).toBeGreaterThanOrEqual(1);
    });
    it('S’s export lists every section; no member id, no account id of the other person', async () => {
      const r = await call('GET', '/api/auth/export-data', { as: S });
      expect(r.statusCode).toBe(200);
      const b = typeof r.body === 'string' ? JSON.parse(r.body) : r.body;
      for (const s of ['eventRegistrations', 'testimonials', 'testimonialReports', 'communityMember', 'communityStories', 'communityStoryReports', 'entraideMember', 'entraideOffers',
        'entraideRequests', 'entraideRequestsReceived', 'entraideContactShares', 'entraideReports', 'entraideBlocks']) expect(b[s]?.length, s).toBeGreaterThanOrEqual(1);
      for (const leak of [O.id, O.email, O.mE, O.mC, `g10x-share-o-${TS}@example.test`]) expect(JSON.stringify(b)).not.toContain(leak);
    });
    it('an approved erasure of S leaves no row of S in any of the twelve tables; O keeps its own rows; the event stays', async () => {
      const before = await rowsOf(O);
      const privacy = await import('../../api/_services/privacy.js');
      const svc = privacy.createPrivacyRightsService({ db, cryptoLib: crypto });
      const req = await svc.requestDeletion(S.id);
      await svc.updateDsrRequestStatus(req.id, 'APPROVED');
      await svc.executeApprovedDeletion(req.id);
      expect(Object.values(await rowsOf(S)).every((c) => c === 0), JSON.stringify(await rowsOf(S))).toBe(true);
      const after = await rowsOf(O);
      for (const t of ['EventRegistration', 'Testimonial', 'CommunityMember', 'CommunityStory', 'EntraideMember', 'EntraideOffer']) expect(after[t], t).toBe(before[t]);
      expect(await n(sql`SELECT count(*)::int n FROM "AcademyItem" WHERE id = ${ITEM}`)).toBe(1);
    });
    it('purge step 6c (unverified account after 7 days) leaves no row of that account in any of the twelve tables', async () => {
      expect(Object.values(await rowsOf(UNV)).every((c) => c >= 1)).toBe(true);
      const { PURGE_STEPS } = await import('../../api/_handlers/cron/gdpr-purge.js');
      const step = PURGE_STEPS.find((s) => s.id === 'unverifiedAccountsDeleted');
      const out = await step.run(db, { cutoff: () => new Date(Date.now() - 7 * DAY) }, { failures: [] });
      expect(out.count).toBeGreaterThanOrEqual(1);
      expect(Object.values(await rowsOf(UNV)).every((c) => c === 0), JSON.stringify(await rowsOf(UNV))).toBe(true);
      expect((await rowsOf(O)).EntraideMember).toBe(1);
    });
  });
});
