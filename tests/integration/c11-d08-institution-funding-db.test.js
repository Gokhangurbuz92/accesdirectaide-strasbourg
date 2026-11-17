/**
 * C11 / D08 (owner, Paket 4, 17/11/2026) on REAL PostgreSQL with the migrated schema: an Aides-territoires record (institution / structure / territory funding)
 * is never served as a citizen aide — the three forms of the visibility rule (decide, visibleWhere, visibleSql) agree on it, and the public aide list, the
 * aide detail (direct URL) and the sitemap leave it out, in strict and in lab mode, even when it is fully verified. Synthetic rows only; skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const P = `c11d08-${Date.now()}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); return this; }, write(d) { this.body = (this.body || '') + d; return true; }, send(d) { this.body = d; return this; }, end(d) { if (d !== undefined) this.body = d; return this; } });

describe.skipIf(!hasDatabase)('C11 / D08 — Aides-territoires records are never public citizen aid (real DB)', () => {
  let db, schema, vis;
  const prevMode = process.env.ADA_PUBLIC_CONTENT_MODE;
  const base = { statut: 'publie', launch_eligible: true, verification_status: 'VERIFIED', verified_by: 'chain', territory_verified: true, publication_hold: null,
    data_origin: 'official', source_url: 'https://www.service-public.fr/particuliers/vosdroits/F1' };
  const ROWS = {
    control: {},
    provider: { providerName: 'aides-territoires' },
    externalId: { externalId: `aides-territoires:${P}` },
    donnee: { source_donnee: 'Aides-Territoires' },
    url: { source_url: 'https://aides-territoires.beta.gouv.fr/aides/x/' },
    urlExact: { source_url_exact: 'https://aides-territoires.beta.gouv.fr/aides/y/' },
    labFixture: { providerName: 'aides-territoires', data_origin: 'unclassified', verification_status: 'UNVERIFIED', verified_by: null },
    lookAlike: { source_url: 'https://aides-territoires.beta.gouv.fr.example.org/x' },
  };
  const id = (k) => `${P}-${k}`;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    schema = await import('../../src/db/schema.js');
    vis = await import('../../api/lib/publicVisibility.js');
    for (const [k, v] of Object.entries(ROWS)) await db.insert(schema.Aide).values({ id: id(k), slug: `slug-${id(k)}`, titre: `T ${P} ${k}`, ...base, date_verification: new Date(), ...v });
  });
  afterAll(async () => {
    if (prevMode === undefined) delete process.env.ADA_PUBLIC_CONTENT_MODE; else process.env.ADA_PUBLIC_CONTENT_MODE = prevMode;
    if (db) await db.execute(sql`DELETE FROM "Aide" WHERE id LIKE ${P + '%'}`);
  });

  it('decide, visibleWhere and visibleSql agree, and only the control and the look-alike host are public', async () => {
    const rows = await db.select().from(schema.Aide).where(sql`${schema.Aide.id} LIKE ${P + '%'}`);
    expect(rows).toHaveLength(Object.keys(ROWS).length);
    for (const mode of ['strict', 'lab']) {
      const opts = { mode, now: new Date() };
      const viaJs = rows.filter((r) => vis.decide(r, 'aide', opts).visible).map((r) => r.id).sort();
      const viaDrizzle = (await db.select({ id: schema.Aide.id }).from(schema.Aide).where(and(sql`${schema.Aide.id} LIKE ${P + '%'}`, vis.visibleWhere(schema.Aide, 'aide', opts)))).map((r) => r.id).sort();
      const viaSql = (await db.execute(sql`SELECT a.id FROM "Aide" a WHERE a.id LIKE ${P + '%'} AND ${vis.visibleSql('aide', { ...opts, alias: 'a' })}`)).rows.map((r) => r.id).sort();
      expect({ mode, viaJs }).toEqual({ mode, viaJs: [id('control'), id('lookAlike')].sort() });
      expect(viaDrizzle).toEqual(viaJs);
      expect(viaSql).toEqual(viaJs);
    }
  });

  it('public aide detail: an Aides-territoires record is a 404 by direct URL (strict and lab); the control is served', async () => {
    const { default: aides } = await import('../../api/_handlers/aides.js');
    const get = async (query) => { const r = mk(); await aides({ method: 'GET', url: '/api/aides', headers: { host: 'localhost' }, query }, r); return r; };
    for (const mode of ['strict', 'lab']) {
      process.env.ADA_PUBLIC_CONTENT_MODE = mode;
      expect((await get({ slug: `slug-${id('control')}` })).statusCode, mode).toBe(200);
      for (const k of ['provider', 'externalId', 'donnee', 'url', 'urlExact', 'labFixture']) expect((await get({ slug: `slug-${id(k)}` })).statusCode, `${mode} ${k}`).toBe(404);
    }
  });

  it('public aide list and sitemap never carry an Aides-territoires record', async () => {
    const { default: aides } = await import('../../api/_handlers/aides.js');
    const { default: sitemap } = await import('../../api/_handlers/sitemap.js');
    for (const mode of ['strict', 'lab']) {
      process.env.ADA_PUBLIC_CONTENT_MODE = mode;
      const list = mk(); await aides({ method: 'GET', url: '/api/aides', headers: { host: 'localhost' }, query: { q: `T ${P}`, limit: '50' } }, list);
      const body = JSON.stringify(list.body);
      expect(list.statusCode, body.slice(0, 200)).toBe(200);
      expect(body, `${mode} list control`).toContain(id('control'));
      for (const k of ['provider', 'externalId', 'donnee', 'url', 'urlExact', 'labFixture']) expect(body, `${mode} list ${k}`).not.toContain(id(k));
      const sm = mk(); await sitemap({ method: 'GET', url: '/sitemap.xml', headers: { host: 'localhost' } }, sm);
      const xml = String(sm.body);
      expect(xml).toContain(`slug-${id('control')}`);
      for (const k of ['provider', 'externalId', 'donnee', 'url', 'urlExact', 'labFixture']) expect(xml, `${mode} sitemap ${k}`).not.toContain(`slug-${id(k)}`);
    }
  });

  it('the administration still sees the record and why it is hidden', async () => {
    const [row] = await db.select().from(schema.Aide).where(sql`${schema.Aide.id} = ${id('provider')}`);
    expect(row).toBeTruthy();
    expect(vis.decide(row, 'aide', { mode: 'strict' }).reasons).toEqual(['INSTITUTION_FUNDING_SOURCE']);
  });
});
