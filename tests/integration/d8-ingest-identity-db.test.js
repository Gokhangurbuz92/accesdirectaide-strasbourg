/**
 * D8 (owner 17/11: organisation ≠ establishment ≠ service) — identification of the places of the open-data directory ingestion (api/_handlers/cron/ingest-structures.js)
 * on REAL PostgreSQL; the source and the geocoder are STUBS (nothing leaves the machine).
 *
 * Evidence (public dataset mediation_numerique_lieux of opendata.strasbourg.eu, read on 17/11/2026, 69 records): two records named « Etape numérique Neuhof
 * Lizé », same postal code and same street, are two different operators (different SIRET in the `pivot` field, different telephone); and 18 places (the
 * « Centres médico-sociaux ») carry ONE SIRET, the manager's. Identity was « dataset + SIRET, else dataset + name + postal code »:
 *  - the two operators became ONE record, overwritten by the other one on every run (a version snapshot each time; a verified record got a review item for a
 *    difference that is only the other operator);
 *  - with a SIRET shared by several places, every place was the first one's record.
 * Now: a SIRET identifies a place only when one record of the fetch carries it; a record already matched in this run is never matched again; among several
 * records of the same identity, the one whose facts agree best is taken (the same content first).
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const DATASET = 'mediation_numerique_lieux';
const TS = Date.now();
const NAME = `D8 Lieu partagé ${TS}`;
const op = (n, extra = {}) => ({ nom: NAME, adresse: '3 rue des Tests', code_postal: '67100', commune: 'Strasbourg', tel: `03 88 29 00 0${n}`, mail: `operateur${n}@example.test`, ...extra });
// one manager SIRET for several places (synthetic, 14 digits)
const SHARED_SIRET = `9${String(TS).slice(-8)}00012`.slice(0, 14);
const cms = (n, cp) => ({ nom: `D8 Centre ${n} ${TS}`, adresse: `${n} rue du Centre`, code_postal: cp, commune: 'Strasbourg', tel: `03 68 98 00 0${n}`, siret: SHARED_SIRET });
let pages = [];

describe('D8: the ingestion never makes two places one record (real DB, stubbed source)', () => {
  let db; let ingest;
  const mine = async () => (await db.execute(sql`SELECT id, nom, telephone, code_postal, siret FROM "Structure" WHERE source_id = ${DATASET} AND nom LIKE ${'D8 %' + TS} ORDER BY nom, telephone`)).rows;
  const versions = async () => Number((await db.execute(sql`SELECT count(*)::int AS n FROM "EntityVersion" v JOIN "Structure" s ON s.id = v.entity_id
    WHERE v.entity_type = 'Structure' AND s.source_id = ${DATASET} AND s.nom LIKE ${'D8 %' + TS}`)).rows[0].n);

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const u = new URL(String(input));
      if (u.hostname === 'api-adresse.data.gouv.fr') return new Response(JSON.stringify({ features: [{ geometry: { coordinates: [7.75, 48.58] }, properties: { score: 0.9 } }] }), { status: 200 });
      if (u.hostname === 'opendata.strasbourg.eu') {
        const offset = Number(u.searchParams.get('offset') || 0); const limit = Number(u.searchParams.get('limit') || 100);
        return new Response(JSON.stringify({ total_count: pages.length, results: pages.slice(offset, offset + limit) }), { status: 200 });
      }
      throw new Error(`UNEXPECTED_NETWORK ${u.hostname}`);
    }));
    ({ db } = await import('../../src/db/index.js'));
    ({ runIngestStructures: ingest } = await import('../../api/_handlers/cron/ingest-structures.js'));
    await db.execute(sql`DELETE FROM "Structure" WHERE source_id = ${DATASET}`);   // this suite owns the dataset in the test database (as the D14 suite)
  }, 60000);
  afterAll(async () => {
    vi.unstubAllGlobals();
    if (!db) return;
    const ids = (await db.execute(sql`SELECT id FROM "Structure" WHERE source_id = ${DATASET}`)).rows.map((r) => r.id);
    if (ids.length) {
      await db.execute(sql`DELETE FROM "ReviewQueueItem" WHERE "entityType" = 'structure' AND "entityId" IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`).catch(() => {});
      await db.execute(sql`DELETE FROM "EntityVersion" WHERE entity_type = 'Structure' AND entity_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`).catch(() => {});
    }
    await db.execute(sql`DELETE FROM "Structure" WHERE source_id = ${DATASET}`).catch(() => {});
  });

  it('two operators with the same name at the same address are two records', async () => {
    pages = [op(1), op(2)];
    const out = await ingest({});
    expect(out.errors).toEqual([]);
    expect(out.created).toBe(2);
    expect((await mine()).map((r) => r.telephone)).toEqual(['03 88 29 00 01', '03 88 29 00 02']);
  }, 60000);

  it('the same source again changes nothing — no record is overwritten by the other operator (no flip-flop, no version)', async () => {
    const before = await versions();
    const out = await ingest({});
    expect([out.created, out.updated, out.skippedExisting]).toEqual([0, 0, 2]);
    expect(await versions()).toBe(before);
  }, 60000);

  it('the source order does not move one operator\'s facts onto the other\'s record', async () => {
    const ids = Object.fromEntries((await mine()).map((r) => [r.telephone, r.id]));
    pages = [op(2), op(1)];
    const out = await ingest({});
    expect([out.created, out.updated]).toEqual([0, 0]);
    expect(Object.fromEntries((await mine()).map((r) => [r.telephone, r.id]))).toEqual(ids);
  }, 60000);

  it('a real change of one operator updates THAT operator\'s record only', async () => {
    const ids = Object.fromEntries((await mine()).map((r) => [r.telephone, r.id]));
    pages = [op(1), op(2, { mail: 'operateur2-nouveau@example.test' })];
    const out = await ingest({});
    expect([out.created, out.updated]).toEqual([0, 1]);
    const v = (await db.execute(sql`SELECT entity_id FROM "EntityVersion" WHERE entity_type = 'Structure' AND entity_id IN (${ids['03 88 29 00 01']}, ${ids['03 88 29 00 02']})`)).rows.map((r) => r.entity_id);
    expect(v).toEqual([ids['03 88 29 00 02']]);
  }, 60000);

  it('several places carrying their manager\'s SIRET are several records; the SIRET is held by one of them and the next run is stable', async () => {
    pages = [op(1), op(2, { mail: 'operateur2-nouveau@example.test' }), cms(1, '67000'), cms(2, '67100'), cms(3, '67200')];
    const out = await ingest({});
    expect(out.errors).toEqual([]);
    expect(out.created).toBe(3);
    const centres = (await mine()).filter((r) => r.nom.startsWith('D8 Centre'));
    expect(centres.map((r) => r.code_postal)).toEqual(['67000', '67100', '67200']);
    expect(centres.filter((r) => r.siret === SHARED_SIRET)).toHaveLength(1);   // Structure.siret is unique: one record holds it, never a wrong merge
    const again = await ingest({});
    expect([again.created, again.updated]).toEqual([0, 0]);
    pages = [cms(3, '67200'), cms(2, '67100'), cms(1, '67000'), op(2, { mail: 'operateur2-nouveau@example.test' }), op(1)];
    const reversed = await ingest({});
    expect([reversed.created, reversed.updated]).toEqual([0, 0]);
  }, 60000);

  it('a SIRET that only ONE record of the fetch carries still identifies it through a renaming (D14 rule kept)', async () => {
    const only = `8${String(TS).slice(-8)}00034`.slice(0, 14);
    pages = [{ nom: `D8 Seul ${TS}`, adresse: '9 rue Seule', code_postal: '67000', commune: 'Strasbourg', tel: '03 88 11 11 11', siret: only }];
    expect((await ingest({})).created).toBe(1);
    pages = [{ nom: `D8 Seul renommé ${TS}`, adresse: '9 rue Seule', code_postal: '67000', commune: 'Strasbourg', tel: '03 88 11 11 11', siret: only }];
    const out = await ingest({});
    expect([out.created, out.updated]).toEqual([0, 1]);
    expect((await mine()).filter((r) => r.siret === only).map((r) => r.nom)).toEqual([`D8 Seul renommé ${TS}`]);
  }, 60000);
});
