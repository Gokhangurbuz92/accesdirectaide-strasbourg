/**
 * PKG-11 / D12 · P07 · P28 — the official INSEE reference on real PostgreSQL, in a private schema dropped afterwards (no network, nothing left behind):
 *  - the whole national reference loads through the COG and INSEE EPCI connectors (before: discover() threw on PostgreSQL, so nothing could ever load),
 *    and a second load creates nothing;
 *  - every commune is PART_OF its département, every département PART_OF its région, every commune of an EPCI MEMBER_OF it; the service territory is
 *    exactly the 33 communes INSEE lists for the Eurométropole de Strasbourg;
 *  - the assistant resolver on the real catalogue: hierarchy narrowest first with the EPCI, names without accents / case, exact names first, homonyms
 *    ambiguous, five digits never resolved (postal codes collide with INSEE codes), outside the service territory / too broad, a name read from the
 *    message only after « à »;
 *  - applicability with two real territories (national scalability): the search pre-filter keeps an Eurométropole entity in Strasbourg, a Mulhouse
 *    Alsace Agglomération entity in Mulhouse, and a narrower commune exclusion wins over a département inclusion.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

const bridge = vi.hoisted(() => ({ db: null }));
vi.mock('../../src/db/index.js', () => ({
  db: new Proxy({}, { get: (_t, key) => {
    if (!bridge.db) throw new Error('PKG11_GEO_DB_NOT_READY');
    const value = bridge.db[key];
    return typeof value === 'function' ? value.bind(bridge.db) : value;
  } }),
}));

// R12 (P08): the /api/search handler runs here too; its result cache is not under test (pass-through, no store)
vi.mock('../../api/lib/search-cache.js', () => ({ cachedSearch: async (_p, fn) => ({ data: await fn(), cached: false }), bumpContentEpoch: async () => ({ bumped: false }) }));
vi.mock('../../api/lib/EmbeddingProvider.js', () => ({ generateEmbedding: async () => null, getActiveEmbeddingModel: () => null }));

const SCHEMA = `pkg11_geo_${process.pid}_${Date.now().toString(36)}`;
const TABLES = ['Territory', 'TerritoryLabelHistory', 'TerritoryRelation', 'Applicability', 'SourceRegistryEntry', 'Aide'];
const reference = JSON.parse(fs.readFileSync('data/geography/insee-2026.v1.json', 'utf8'));
const service = JSON.parse(fs.readFileSync('data/geography/service-territory.v1.json', 'utf8'));
const WORD = 'pkg11territoire';
let client;
let db;
let schemas;
let first;
let firstSeconds;

function checkedTestUrl() {
  const raw = process.env.DATABASE_URL_TEST;
  if (!raw) throw new Error('LOCAL_TEST_DATABASE_REQUIRED_NO_SKIP');
  const url = new URL(raw);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (url.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || !/^[A-Za-z0-9_]+$/.test(name) || !/(^|_)test(_|$)/.test(name)) throw new Error('UNSAFE_TEST_DATABASE_REFUSED');
  return raw;
}
const q = async (text, params = []) => (await client.query(text, params)).rows;
const idOf = async (type, code) => (await q('SELECT id FROM "Territory" WHERE type = $1 AND official_code = $2', [type, code]))[0].id;

beforeAll(async () => {
  client = new pg.Client({ connectionString: checkedTestUrl(), ssl: false, connectionTimeoutMillis: 5000 });
  await client.connect();
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  for (const t of TABLES) await client.query(`CREATE TABLE ${SCHEMA}."${t}" (LIKE public."${t}" INCLUDING ALL)`);
  await client.query(`SET search_path = ${SCHEMA}, public`);
  const bound = await q(`SELECT ${TABLES.map((t, i) => `to_regclass('"${t}"') = to_regclass('${SCHEMA}."${t}"') AS b${i}`).join(', ')}`);
  expect(Object.values(bound[0])).toEqual(TABLES.map(() => true));   // every unqualified name is the private copy, never public
  schemas = await import('../../src/db/schema.js');
  db = drizzle(client, { schema: schemas });
  bridge.db = db;
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('UNEXPECTED_NETWORK_IN_TERRITORY_REFERENCE'); }));
  const { loadTerritoryReference } = await import('../../api/lib/geography/territoryReference.js');
  const started = Date.now();
  first = await loadTerritoryReference(reference, { db, schemas });
  firstSeconds = (Date.now() - started) / 1000;
}, 240000);

afterAll(async () => {
  bridge.db = null;
  vi.unstubAllGlobals();
  if (client) {
    try { await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`); } finally { await client.end(); }
  }
});

describe('PKG-11 / D12 the national reference loads and stays consistent', () => {
  it('loads the whole INSEE reference (régions, départements, communes, municipal arrondissements, EPCI) and registers both sources', async () => {
    expect(first.ok, JSON.stringify({ cog: first.cog.stats, epci: first.epci?.stats })).toBe(true);
    const byType = Object.fromEntries((await q('SELECT type::text AS type, count(*)::int AS n FROM "Territory" GROUP BY type')).map((r) => [r.type, r.n]));
    expect(byType).toEqual({ REGION: 18, DEPARTEMENT: 101, COMMUNE: 34875, MUNICIPAL_ARRONDISSEMENT: 45, EPCI: 1253 });
    expect(reference.counts).toEqual({ regions: 18, departements: 101, communes: 34875, arrondissementsMunicipaux: 45, epcis: 1253 });
    const labels = await q('SELECT count(*)::int AS n, count(DISTINCT territory_id)::int AS t FROM "TerritoryLabelHistory"');
    expect(labels[0]).toEqual({ n: 36292, t: 36292 });
    const sources = await q('SELECT source_id, type::text AS type, "last_success_at" IS NOT NULL AS ok FROM "SourceRegistryEntry" ORDER BY source_id').catch(async () =>
      q('SELECT source_id, type::text AS type, true AS ok FROM "SourceRegistryEntry" ORDER BY source_id'));
    expect(sources.map((s) => [s.source_id, s.type])).toEqual([['INSEE_COG', 'CSV'], ['INSEE_EPCI', 'CSV']]);
    expect(firstSeconds).toBeLessThan(180);
  });

  it('links every level: commune PART_OF département PART_OF région, arrondissement PART_OF commune, commune MEMBER_OF its EPCI — nothing dangling', async () => {
    const rel = Object.fromEntries((await q(`SELECT s.type::text || '>' || r.type::text || '>' || t.type::text AS k, count(*)::int AS n
      FROM "TerritoryRelation" r JOIN "Territory" s ON s.id = r.source_territory_id JOIN "Territory" t ON t.id = r.target_territory_id GROUP BY 1`)).map((r) => [r.k, r.n]));
    const withEpci = reference.communes.filter((c) => c[3]).length;
    expect(rel).toEqual({ 'DEPARTEMENT>PART_OF>REGION': 101, 'COMMUNE>PART_OF>DEPARTEMENT': 34875, 'MUNICIPAL_ARRONDISSEMENT>PART_OF>COMMUNE': 45, 'COMMUNE>MEMBER_OF>EPCI': withEpci });
    const dangling = await q(`SELECT count(*)::int AS n FROM "TerritoryRelation" r WHERE NOT EXISTS (SELECT 1 FROM "Territory" t WHERE t.id = r.target_territory_id)
      OR NOT EXISTS (SELECT 1 FROM "Territory" s WHERE s.id = r.source_territory_id)`);
    expect(dangling[0].n).toBe(0);
    const ems = await q(`SELECT c.official_code FROM "TerritoryRelation" r JOIN "Territory" c ON c.id = r.source_territory_id JOIN "Territory" e ON e.id = r.target_territory_id
      WHERE r.type = 'MEMBER_OF' AND e.official_code = '246700488' ORDER BY 1`);
    expect(ems.map((r) => r.official_code)).toEqual(service.communes.map((c) => c[0]));
    expect(service.communes).toHaveLength(33);
    expect(service.validation.status).toBe('PENDING_HUMAN_VALIDATION');
    const val = await q(`SELECT t.type::text AS type FROM "Territory" t WHERE t.official_code = '94' ORDER BY 1`);
    expect(val.map((r) => r.type)).toEqual(['DEPARTEMENT', 'REGION']);   // Val-de-Marne stays a département, Corse a région (no re-typing by code)
  });

  it('a second load creates nothing and changes nothing (idempotent, never deletes)', async () => {
    const before = await q('SELECT (SELECT count(*) FROM "Territory")::int AS t, (SELECT count(*) FROM "TerritoryRelation")::int AS r, (SELECT count(*) FROM "TerritoryLabelHistory")::int AS l');
    const { loadTerritoryReference } = await import('../../api/lib/geography/territoryReference.js');
    const again = await loadTerritoryReference(reference, { db, schemas });
    expect(again.ok).toBe(true);
    expect(again.cog.stats.created).toBe(0);
    expect(again.cog.stats.unchanged).toBe(18 + 101 + 34875 + 45);
    expect(again.epci.stats.created).toBe(0);
    const after = await q('SELECT (SELECT count(*) FROM "Territory")::int AS t, (SELECT count(*) FROM "TerritoryRelation")::int AS r, (SELECT count(*) FROM "TerritoryLabelHistory")::int AS l');
    expect(after).toEqual(before);
  });

  it('PKG-11 / A06: an empty source run keeps the last known good reference (PARTIAL, nothing deleted)', async () => {
    const { COGConnector } = await import('../../api/lib/geography/COGIngestion.js');
    const counts = () => q('SELECT (SELECT count(*) FROM "Territory")::int AS t, (SELECT count(*) FROM "TerritoryRelation")::int AS r, (SELECT count(*) FROM "TerritoryLabelHistory")::int AS l');
    const before = await counts();
    const c = new COGConnector(db, schemas);
    c.setData({ regions: [], departments: [], communes: [], arrondissements: [], replacements: [], cogVersion: '2027' });
    const run = await c.execute();
    expect(run.state).toBe('PARTIAL');
    expect(run.stats.errors.join(' ')).toMatch(/last-known-good/);
    expect(await counts()).toEqual(before);
  });

  it('a partial load keeps every région / département and loads an EPCI only when all its communes are loaded', async () => {
    const { referenceItems } = await import('../../api/lib/geography/territoryReference.js');
    const part = referenceItems(reference, { departements: ['67', '68'] });
    expect(part.regions).toHaveLength(18);
    expect(part.departments).toHaveLength(101);
    expect(part.communes).toHaveLength(880);
    expect(part.epcis.map((e) => e.code)).toContain('246700488');
    expect(part.skippedEpcis).toEqual(['200070746']);   // an EPCI with communes outside the two départements is not loaded half-way
  });
});

describe('PKG-11 / P07 the assistant resolver on the official catalogue', () => {
  let resolve;
  beforeAll(async () => {
    ({ resolveAssistantTerritory: resolve } = await import('../../api/lib/geography/AssistantTerritoryResolver.js'));
  });
  const r = (input) => resolve(input, db);

  it('Strasbourg: commune, Eurométropole, Bas-Rhin, Grand Est — narrowest first; the canonical id resolves the same', async () => {
    const res = await r({ rawTerritory: 'Strasbourg' });
    expect(res.status).toBe('RESOLVED');
    expect(res.territory.hierarchy.map((h) => [h.type, h.officialCode])).toEqual([['COMMUNE', '67482'], ['EPCI', '246700488'], ['DEPARTEMENT', '67'], ['REGION', '44']]);
    expect(res.territory).toMatchObject({ communeCode: '67482', epciCode: '246700488', departmentCode: '67', regionCode: '44', inServiceTerritory: true, label: 'Strasbourg' });
    const byId = await r({ rawTerritory: res.territory.id });
    expect(byId.status).toBe('RESOLVED');
    expect(byId.territory.territoryIds).toEqual(res.territory.territoryIds);
  });

  it('names are read without case / accents / ligatures, an exact name first, homonyms stay ambiguous', async () => {
    expect((await r({ rawTerritory: 'hoenheim' })).territory).toMatchObject({ officialCode: '67204', label: 'Hœnheim' });
    expect((await r({ rawTerritory: 'ILLKIRCH GRAFFENSTADEN' })).territory).toMatchObject({ officialCode: '67218' });
    expect(await r({ rawTerritory: 'Villé' })).toMatchObject({ status: 'OUTSIDE_SERVICE_TERRITORY', territory: { officialCode: '67507', label: 'Villé' } });
    expect(await r({ rawTerritory: 'Bouxwiller' })).toEqual({ status: 'AMBIGUOUS' });   // 67061 and 68049
    expect(await r({ rawTerritory: 'Saint-Louis' })).toEqual({ status: 'AMBIGUOUS' });
  });

  it('five digits are never resolved: a postal code is often the INSEE code of another commune (67100 = Donnenheim for INSEE)', async () => {
    expect(await r({ rawTerritory: '67100' })).toEqual({ status: 'POSTAL_CODE' });
    expect(await r({ rawTerritory: '67000' })).toEqual({ status: 'POSTAL_CODE' });
  });

  it('outside the Eurométropole: a commune is OUTSIDE_SERVICE_TERRITORY, a département / région TOO_BROAD; the Eurométropole itself is served', async () => {
    expect(await r({ rawTerritory: 'Mulhouse' })).toMatchObject({ status: 'OUTSIDE_SERVICE_TERRITORY', territory: { type: 'COMMUNE', officialCode: '68224', label: 'Mulhouse' } });
    expect(await r({ rawTerritory: 'Lyon' })).toMatchObject({ status: 'OUTSIDE_SERVICE_TERRITORY' });
    expect(await r({ rawTerritory: 'Bas-Rhin' })).toMatchObject({ status: 'TOO_BROAD', territory: { type: 'DEPARTEMENT' } });
    expect(await r({ rawTerritory: 'Grand Est' })).toMatchObject({ status: 'TOO_BROAD', territory: { type: 'REGION' } });
    expect(await r({ rawTerritory: 'Eurométropole de Strasbourg' })).toMatchObject({ status: 'RESOLVED', territory: { type: 'EPCI', officialCode: '246700488' } });
  });

  it('a name is read from the message only after « à »: ordinary words that are commune names do not move the person', async () => {
    expect(await r({ message: 'Je dors dans la rue, quelles aides ?' })).toEqual({ status: 'UNRESOLVED' });          // Rue (Somme)
    expect(await r({ message: "Je cherche un plan pour m'en sortir" })).toEqual({ status: 'UNRESOLVED' });          // Plan (Isère)
    expect(await r({ message: 'Une aide de la ville pour les tours de garde' })).toEqual({ status: 'UNRESOLVED' }); // Ville, Tours
    const msg = await r({ message: 'Quelles aides logement à Strasbourg ?' });
    expect(msg).toMatchObject({ status: 'RESOLVED', matchedBy: 'MESSAGE_LABEL', territory: { officialCode: '67482' } });
    expect(await r({ message: "J'habite à Tours" })).toMatchObject({ status: 'OUTSIDE_SERVICE_TERRITORY', territory: { officialCode: '37261' } });
  });

  it('the endpoint hierarchy (démarches / structures) carries the EPCI after the commune', async () => {
    const { getHierarchy } = await import('../../api/lib/geography/TerritoryService.js');
    expect((await getHierarchy('67482', db, schemas)).hierarchy.map((h) => [h.type, h.code])).toEqual([['COMMUNE', '67482'], ['EPCI', '246700488'], ['DEPARTEMENT', '67'], ['REGION', '44']]);
    expect((await getHierarchy('68224', db, schemas)).hierarchy.map((h) => [h.type, h.code])).toEqual([['COMMUNE', '68224'], ['EPCI', '200066009'], ['DEPARTEMENT', '68'], ['REGION', '44']]);
  });
});

describe('PKG-11 / P28 applicability with two real territories (national scalability)', () => {
  const WHEN = '2026-01-02T03:04:05.000Z';
  async function addAide(id) {
    await q(`INSERT INTO "Aide" (id,slug,titre,title,description,cest_quoi,summary_falc,"status_code",statut,"category_code",source_url,date_verification,geo_scope,"updatedAt")
      VALUES ($1,$1,$2,$2,'Synthetic fixture only.','Synthetic fixture only.','Synthetic fixture only.','PUBLISHED','publie','AUTRE',$3,$4,'NATIONAL',$4)`,
    [id, `${WORD} ${id}`, `https://example.test/synthetic/${id}`, WHEN]);
  }
  async function rule(entity, territoryId, isExclusion) {
    await q(`INSERT INTO "Applicability" (id, entity_type, entity_id, territory_id, is_exclusion) VALUES ($1, 'BENEFIT', $2, $3, $4)`,
      [`${entity}-${territoryId}-${isExclusion}`, entity, territoryId, isExclusion]);
  }
  let search;
  let hierarchyOf;
  beforeAll(async () => {
    for (const id of ['geo-ems', 'geo-m2a', 'geo-bas-rhin', 'geo-national']) await addAide(id);
    await rule('geo-ems', await idOf('EPCI', '246700488'), false);
    await rule('geo-m2a', await idOf('EPCI', '200066009'), false);
    await rule('geo-bas-rhin', await idOf('DEPARTEMENT', '67'), false);
    await rule('geo-bas-rhin', await idOf('COMMUNE', '67378'), true);   // excluded for Plobsheim only
    ({ searchAidesHybrid: search } = await import('../../api/lib/hybrid-search.js'));
    const { getHierarchy } = await import('../../api/lib/geography/TerritoryService.js');
    hierarchyOf = async (code) => (await getHierarchy(code, db, schemas)).hierarchy.map((h) => h.id);
  });
  const found = async (code) => (await search({ query: WORD, limit: 10, embedding: null, embeddingModel: null, territoryFilter: { userTerritoryIds: await hierarchyOf(code) } }))
    .items.map((i) => i.id).sort();

  it('Strasbourg sees the Eurométropole, Bas-Rhin and national entities, never the Mulhouse one', async () => {
    expect(await found('67482')).toEqual(['geo-bas-rhin', 'geo-ems', 'geo-national']);
  });
  it('Plobsheim: the narrower commune exclusion wins over the département inclusion', async () => {
    expect(await found('67378')).toEqual(['geo-ems', 'geo-national']);
  });
  it('Mulhouse (second territory) sees its own agglomeration and the national entity only', async () => {
    expect(await found('68224')).toEqual(['geo-m2a', 'geo-national']);
  });
  it('R12 (P08): through POST /api/search the commune code reaches the pre-filter (it used to be stripped by validation); a postal code is refused', async () => {
    const { default: handler } = await import('../../api/_handlers/search.js');
    const call = async (body) => { const r = { statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } };
      await handler({ method: 'POST', url: '/api/search', body, headers: { host: 'localhost' } }, r); return r; };
    const ids = (r) => (r.body.items || r.body.aides || r.body.results || []).map((i) => i.id).filter((id) => String(id).startsWith('geo-')).sort();
    const strasbourg = await call({ query: WORD, territory: '67482' });
    expect(strasbourg.statusCode, JSON.stringify(strasbourg.body)).toBe(200);
    expect(ids(strasbourg)).toEqual(['geo-bas-rhin', 'geo-ems', 'geo-national']);
    expect(ids(await call({ query: WORD, territory: '68224' }))).toEqual(['geo-m2a', 'geo-national']);
    expect(ids(await call({ query: WORD }))).toEqual(['geo-bas-rhin', 'geo-ems', 'geo-m2a', 'geo-national']);
    expect((await call({ query: WORD, territory: 'Strasbourg' })).statusCode).toBe(400);
  });
  it('the deterministic engine agrees on the same rules and real hierarchies', async () => {
    const { evaluateApplicability } = await import('../../api/lib/geography/ApplicabilityEngine.js');
    const rows = await q('SELECT a.entity_id, a.territory_id, a.is_exclusion, t.type::text AS type FROM "Applicability" a JOIN "Territory" t ON t.id = a.territory_id');
    const types = new Map(rows.map((x) => [x.territory_id, x.type]));
    const rulesOf = (e) => rows.filter((x) => x.entity_id === e).map((x) => ({ territoryId: x.territory_id, territoryType: x.type, isExclusion: x.is_exclusion }));
    const state = async (e, code) => evaluateApplicability(rulesOf(e), await hierarchyOf(code), types);
    expect(await state('geo-bas-rhin', '67378')).toBe('NOT_APPLICABLE');
    expect(await state('geo-bas-rhin', '67482')).toBe('APPLICABLE');
    expect(await state('geo-ems', '68224')).toBe('NOT_APPLICABLE');
    expect(await state('geo-m2a', '68224')).toBe('APPLICABLE');
  });
});
