/**
 * PKG-1 / D-5 on REAL PostgreSQL with the MIGRATED schema (migration 0015).
 *  1. The three expressions of the publication rule (decide() JS, visibleWhere() drizzle, visibleSql() raw) agree on every combination of the rule's inputs.
 *  2. The verification service writes projection + append-only ledger in one transaction, and the database itself refuses UPDATE/DELETE on the ledger.
 *  3. The public read paths (aide list/detail) hide what is not eligible in strict mode, show only labelled lab fixtures in lab mode, and a direct URL is a 404.
 * Synthetic rows only; skipped without DATABASE_URL. Mode is switched per test through process.env (read at call time by api/lib/publicVisibility.js).
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const P = `pkg1d5-${TS}`;
const DAY = 86400000;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, send(d) { this.body = d; return this; }, end() { return this; } });

describe.skipIf(!hasDatabase)('D-5 publication contract (real DB)', () => {
  let db, schema, vis, verification;
  const ids = [];
  const base = { statut: 'publie', launch_eligible: true, verification_status: 'VERIFIED', verified_by: 'rev-1', territory_verified: true, publication_hold: null, data_origin: 'official', source_url: 'https://www.service-public.fr/x' };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    schema = await import('../../src/db/schema.js');
    vis = await import('../../api/lib/publicVisibility.js');
    verification = await import('../../api/_services/content-verification.js');
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "Aide" WHERE id LIKE ${P + '%'}`);
    // the ledger is append-only by trigger: its rows for these synthetic ids are intentionally left (they reference ids that no longer exist)
  });

  it('JS rule, drizzle conditions and raw SQL agree on every combination', async () => {
    const now = new Date();
    const variants = {
      statut: ['publie', 'brouillon'],
      launch_eligible: [true, false],
      verification_status: ['VERIFIED', 'UNVERIFIED', 'REJECTED'],
      verified_by: ['rev-1', null],
      territory_verified: [true, false],
      publication_hold: [null, 'PRIVACY_REVIEW'],
      data_origin: ['official', 'unclassified', 'synthetic_fixture'],
      date_verification: [null, new Date(now.getTime() - 10 * DAY), new Date(now.getTime() - 120 * DAY), new Date(now.getTime() - 400 * DAY), new Date(now.getTime() + 30 * DAY)],
      source_url: ['https://www.service-public.fr/x', '  ', null],
      status_code: ['PUBLISHED', 'ARCHIVED'],
    };
    // Full cross-product is 2*2*3*2*2*2*3*5*3*2 = 8640 rows: affordable, and it is the point of the test.
    const rows = []; let n = 0;
    const walk = (keys, acc) => {
      if (!keys.length) { rows.push({ id: `${P}-m${n++}`, titre: 'matrix', ...acc }); return; }
      const [k, ...rest] = keys;
      for (const v of variants[k]) walk(rest, { ...acc, [k]: v });
    };
    walk(Object.keys(variants), {});
    for (let i = 0; i < rows.length; i += 500) await db.insert(schema.Aide).values(rows.slice(i, i + 500));
    ids.push(...rows.map((r) => r.id));
    for (const mode of ['strict', 'lab']) {
      const opts = { now, mode, maxAge: 180 };
      const viaJs = new Set(rows.filter((r) => vis.decide(r, 'aide', opts).visible).map((r) => r.id));
      const viaDrizzle = new Set((await db.select({ id: schema.Aide.id }).from(schema.Aide).where(and(sql`${schema.Aide.id} LIKE ${P + '-m%'}`, vis.visibleWhere(schema.Aide, 'aide', opts)))).map((r) => r.id));
      const viaSql = new Set((await db.execute(sql`SELECT id FROM "Aide" WHERE id LIKE ${P + '-m%'} AND ${vis.visibleSql('aide', opts)}`)).rows.map((r) => r.id));
      const diff = (a, b) => [...a].filter((x) => !b.has(x)).slice(0, 5);
      expect({ mode, jsNotDrizzle: diff(viaJs, viaDrizzle), drizzleNotJs: diff(viaDrizzle, viaJs) }).toEqual({ mode, jsNotDrizzle: [], drizzleNotJs: [] });
      expect({ mode, jsNotSql: diff(viaJs, viaSql), sqlNotJs: diff(viaSql, viaJs) }).toEqual({ mode, jsNotSql: [], sqlNotJs: [] });
      // sanity: the matrix contains both outcomes, and strict ⊂ lab
      expect(viaJs.size).toBeGreaterThan(0);
      expect(viaJs.size).toBeLessThan(rows.length);
    }
  }, 120000);

  it('an alias in raw SQL works (hybrid-search style)', async () => {
    const id = `${P}-alias`; ids.push(id);
    await db.insert(schema.Aide).values({ id, titre: 'alias', ...base, date_verification: new Date() });
    const r = await db.execute(sql`SELECT a.id FROM "Aide" a WHERE a.id = ${id} AND ${vis.visibleSql('aide', { alias: 'a', mode: 'strict' })}`);
    expect(r.rows).toHaveLength(1);
  });

  describe('verification workflow', () => {
    const reviewer = { id: `rev-${TS}`, role: 'admin' };
    const note = 'Checked on service-public.fr: conditions and amount match the fiche.';
    const aideId = `${P}-wf`;
    beforeAll(async () => { await db.insert(schema.Aide).values({ id: aideId, titre: 'workflow', statut: 'publie', source_url: null }); });

    it('defaults are safe: a published row with no verification is not public in strict mode', async () => {
      const [row] = await db.select().from(schema.Aide).where(eq(schema.Aide.id, aideId));
      expect(row).toMatchObject({ launch_eligible: false, verification_status: 'UNVERIFIED', verified_by: null, territory_verified: false, data_origin: 'unclassified' });
      expect(vis.decide(row, 'aide', { mode: 'strict' }).visible).toBe(false);
    });
    it('VERIFY needs an allowed evidence URL; a bad URL changes nothing', async () => {
      const r = await verification.recordVerification({ entityType: 'aide', entityId: aideId, action: 'VERIFY', reviewer, sourceUrl: 'https://evil.example/x', evidenceNote: note, territoryConfirmed: true });
      expect(r).toMatchObject({ ok: false, code: 'EVIDENCE_URL_NOT_ALLOWED' });
      const led = await db.select().from(schema.ContentVerification).where(eq(schema.ContentVerification.entityId, aideId));
      expect(led).toHaveLength(0);
    });
    it('VERIFY projects the decision with the SERVER clock and appends one ledger row; the row becomes public', async () => {
      const before = Date.now();
      const r = await verification.recordVerification({ entityType: 'aide', entityId: aideId, action: 'VERIFY', reviewer, sourceUrl: 'https://www.service-public.fr/particuliers/vosdroits/F1', evidenceNote: note, territoryConfirmed: true });
      expect(r.ok).toBe(true); expect(r.decision.visible).toBe(true); expect(r.decision.contentStatus).toBe('VERIFIED');
      const [row] = await db.select().from(schema.Aide).where(eq(schema.Aide.id, aideId));
      expect(row.verified_by).toBe(reviewer.id); expect(row.data_origin).toBe('official');
      expect(row.date_verification.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(row.date_verification.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      const led = await db.select().from(schema.ContentVerification).where(eq(schema.ContentVerification.entityId, aideId));
      expect(led).toHaveLength(1); expect(led[0]).toMatchObject({ outcome: 'VERIFIED', reviewerId: reviewer.id, territoryConfirmed: true });
    });
    it('HOLD hides it at once, VERIFY is refused while held, RELEASE_HOLD restores it', async () => {
      const hold = await verification.recordVerification({ entityType: 'aide', entityId: aideId, action: 'HOLD', reviewer, holdReason: 'PRIVACY_REVIEW: phone number' });
      expect(hold.decision.visible).toBe(false);
      expect((await verification.recordVerification({ entityType: 'aide', entityId: aideId, action: 'VERIFY', reviewer, sourceUrl: 'https://www.caf.fr/a', evidenceNote: note, territoryConfirmed: true })).code).toBe('PUBLICATION_HOLD_ACTIVE');
      expect((await verification.recordVerification({ entityType: 'aide', entityId: aideId, action: 'RELEASE_HOLD', reviewer })).decision.visible).toBe(true);
    });
    it('the database refuses UPDATE and DELETE on the ledger (append-only trigger)', async () => {
      await expect(db.execute(sql`UPDATE "ContentVerification" SET "evidenceNote" = 'tampered' WHERE "entityId" = ${aideId}`)).rejects.toThrow();
      await expect(db.execute(sql`DELETE FROM "ContentVerification" WHERE "entityId" = ${aideId}`)).rejects.toThrow();
      const led = await db.select().from(schema.ContentVerification).where(eq(schema.ContentVerification.entityId, aideId));
      expect(led.length).toBeGreaterThanOrEqual(3);
      expect(led.every((l) => l.evidenceNote !== 'tampered')).toBe(true);
    });
  });

  describe('structures: directory search and detail follow the same contract', () => {
    const tag = `d5s-${TS}`;
    const mkStructure = (key, o = {}) => db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, launch_eligible, verification_status, verified_by, territory_verified, publication_hold, data_origin, date_verification, source_url, "updatedAt", "createdAt")
      VALUES (${`${tag}-${key}`}, ${`Structure ${tag} ${key}`}, ${`${tag}-${key}`}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', ${o.eligible ?? false}, ${o.status ?? 'UNVERIFIED'}, ${o.by ?? null}, ${o.territory ?? false}, ${o.hold ?? null}, 'official', ${o.verified ?? null}, 'https://www.service-public.fr/x', NOW(), NOW())`);
    beforeAll(async () => {
      const recent = new Date(Date.now() - 5 * DAY);
      await mkStructure('ok', { eligible: true, status: 'VERIFIED', by: 'rev-1', territory: true, verified: recent });
      await mkStructure('unverified');
      await mkStructure('held', { eligible: true, status: 'VERIFIED', by: 'rev-1', territory: true, verified: recent, hold: 'PRIVACY_REVIEW' });
    });
    afterAll(async () => { await db.execute(sql`DELETE FROM "Structure" WHERE id LIKE ${tag + '%'}`); });

    it('POST /api/search-pro (citizen directory search) lists only the verified structure', async () => {
      process.env.ADA_PUBLIC_CONTENT_MODE = 'strict';
      const { default: searchPro } = await import('../../api/_handlers/search-pro.js');
      const r = mk(); await searchPro({ method: 'POST', url: '/api/search-pro', headers: { host: 'localhost' }, body: { q: tag, limit: 50 } }, r);
      expect(r.statusCode, JSON.stringify(r.body).slice(0, 200)).toBe(200);
      const slugs = (r.body.structures || []).map((x) => x.slug);
      expect(slugs).toContain(`${tag}-ok`); expect(slugs).not.toContain(`${tag}-unverified`); expect(slugs).not.toContain(`${tag}-held`);
    });
    it('GET /api/structures?slug= answers 200 for the verified one only, without reviewer data', async () => {
      process.env.ADA_PUBLIC_CONTENT_MODE = 'strict';
      const { default: structures } = await import('../../api/_handlers/structures.js');
      const get = async (slug) => { const r = mk(); await structures({ method: 'GET', url: '/api/structures', headers: { host: 'localhost' }, query: { slug } }, r); return r; };
      const ok = await get(`${tag}-ok`); expect(ok.statusCode).toBe(200);
      expect(ok.body.provenance.contentStatus).toBe('VERIFIED'); expect(ok.body).not.toHaveProperty('verified_by'); expect(JSON.stringify(ok.body)).not.toContain('rev-1');
      expect((await get(`${tag}-unverified`)).statusCode).toBe(404); expect((await get(`${tag}-held`)).statusCode).toBe(404);
    });
  });

  describe('public read path (aide detail)', () => {
    let aideHandler;
    const get = async (query) => { const r = mk(); await aideHandler({ method: 'GET', url: '/api/aides', headers: { host: 'localhost' }, query }, r); return r; };
    const ID = { verified: `${P}-rv`, draft: `${P}-rd`, stale: `${P}-rs`, held: `${P}-rh`, lab: `${P}-rl` };
    const prevMode = process.env.ADA_PUBLIC_CONTENT_MODE;
    beforeAll(async () => {
      ({ default: aideHandler } = await import('../../api/_handlers/aides.js'));
      const rows = [
        [ID.verified, { ...base, date_verification: new Date() }],
        [ID.draft, { ...base, statut: 'brouillon', date_verification: new Date() }],
        [ID.stale, { ...base, date_verification: new Date(Date.now() - 400 * DAY) }],
        [ID.held, { ...base, publication_hold: 'SAFETY_REVIEW', date_verification: new Date() }],
        [ID.lab, { statut: 'publie' }],   // defaults: unclassified, unverified (a pre-D-5 fixture)
      ];
      for (const [id, v] of rows) { ids.push(id); await db.insert(schema.Aide).values({ id, slug: 'slug-' + id, titre: 'T ' + id, ...v }); }
    });
    afterAll(() => { if (prevMode === undefined) delete process.env.ADA_PUBLIC_CONTENT_MODE; else process.env.ADA_PUBLIC_CONTENT_MODE = prevMode; });

    it('strict: only the verified row is served; draft, stale, held and unverified are 404 by direct URL', async () => {
      process.env.ADA_PUBLIC_CONTENT_MODE = 'strict';
      const ok = await get({ slug: 'slug-' + ID.verified });
      expect(ok.statusCode, JSON.stringify(ok.body).slice(0, 200)).toBe(200);
      for (const k of ['draft', 'stale', 'held', 'lab']) expect((await get({ slug: 'slug-' + ID[k] })).statusCode, k).toBe(404);
    });
    it('strict: a client-supplied statut cannot expose a draft in the list', async () => {
      process.env.ADA_PUBLIC_CONTENT_MODE = 'strict';
      const r = await get({ statut: 'brouillon', limit: '100', q: 'T ' + P });
      const got = JSON.stringify(r.body);
      expect(got).not.toContain(ID.draft); expect(got).not.toContain(ID.lab);
    });
    it('lab: the pre-D-5 fixture is served but labelled LAB_UNVERIFIED, never verified; held/draft/stale official rows stay hidden', async () => {
      process.env.ADA_PUBLIC_CONTENT_MODE = 'lab';
      const lab = await get({ slug: 'slug-' + ID.lab });
      expect(lab.statusCode).toBe(200);
      expect(JSON.stringify(lab.body)).toContain('LAB_UNVERIFIED');
      expect(JSON.stringify(lab.body)).not.toMatch(/"contentStatus":"VERIFIED"/);
      for (const k of ['draft', 'stale', 'held']) expect((await get({ slug: 'slug-' + ID[k] })).statusCode, k).toBe(404);
    });
    it('the same ids exist in the table (the 404s are policy, not absence)', async () => {
      const r = await db.select({ id: schema.Aide.id }).from(schema.Aide).where(inArray(schema.Aide.id, Object.values(ID)));
      expect(r).toHaveLength(5);
    });
  });
});
