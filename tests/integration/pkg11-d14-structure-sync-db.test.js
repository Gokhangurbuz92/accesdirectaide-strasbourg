/**
 * PKG-11 / D14 — spec 002 semantics of the structure directory ingestion on REAL PostgreSQL. The open-data source and the address geocoder are STUBS (fetch is
 * replaced): nothing leaves the machine.
 *  - idempotent: the same source twice creates nothing the second time;
 *  - identity is not the content: a changed phone number updates the same structure (prior row versioned in the A07 store) instead of creating a second one;
 *  - METADATA_ONLY_CHANGED (raw record changed, normalized facts equal) moves only traceability links;
 *  - a VERIFIED structure is never overwritten by the source: one review item carries the difference, and is not duplicated on the next run;
 *  - a record absent from a COMPLETE fetch is soft-removed (kept); an empty or failed fetch removes nothing (last known good);
 *  - every page of the dataset is read (the source used to be cut at 100 records).
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const DATASET = 'mediation_numerique_lieux';
const TS = Date.now();
const rec = (n, extra = {}) => ({ nom: `D14 Lieu ${n} ${TS}`, adresse: `${n} rue des Tests`, code_postal: '67000', commune: 'Strasbourg', tel: '03 88 00 00 0' + (n % 10), mail: `lieu${n}@example.test`, ...extra });
let pages = [];        // the source as the stub serves it (records)
let failNext = false;  // the next dataset request fails

describe('PKG-11 / D14 structure ingestion semantics (real DB, stubbed source)', () => {
  let db; let ingest;
  const mine = async () => (await db.execute(sql`SELECT id, nom, telephone, import_status, verification_status FROM "Structure" WHERE source_id = ${DATASET} AND nom LIKE ${'D14 Lieu %' + TS} ORDER BY nom`)).rows;

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const u = new URL(String(input));
      if (u.hostname === 'api-adresse.data.gouv.fr') return new Response(JSON.stringify({ features: [{ geometry: { coordinates: [7.75, 48.58] }, properties: { score: 0.9 } }] }), { status: 200 });
      if (u.hostname === 'opendata.strasbourg.eu') {
        if (failNext) { failNext = false; return new Response('upstream down', { status: 503 }); }
        const offset = Number(u.searchParams.get('offset') || 0); const limit = Number(u.searchParams.get('limit') || 100);
        return new Response(JSON.stringify({ total_count: pages.length, results: pages.slice(offset, offset + limit) }), { status: 200 });
      }
      throw new Error(`UNEXPECTED_NETWORK ${u.hostname}`);
    }));
    ({ db } = await import('../../src/db/index.js'));
    ({ runIngestStructures: ingest } = await import('../../api/_handlers/cron/ingest-structures.js'));
    await db.execute(sql`DELETE FROM "Structure" WHERE source_id = ${DATASET}`);   // this suite owns the dataset in the test database
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

  it('reads every page (250 records), and a second identical run creates nothing (idempotent)', async () => {
    pages = Array.from({ length: 250 }, (_, i) => rec(i + 1));
    const first = await ingest({});
    expect([first.fetched, first.created]).toEqual([250, 250]);
    const second = await ingest({});
    expect([second.created, second.updated, second.skippedExisting, second.removed]).toEqual([0, 0, 250, 0]);
    expect((await mine()).length).toBe(250);
  }, 120000);

  it('a changed phone number updates the SAME structure and versions the prior facts', async () => {
    pages[0] = rec(1, { tel: '03 88 99 99 99' });
    const out = await ingest({});
    expect([out.created, out.updated]).toEqual([0, 1]);
    const rows = (await mine()).filter((r) => r.nom === `D14 Lieu 1 ${TS}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].telephone).toBe('03 88 99 99 99');
    const v = (await db.execute(sql`SELECT snapshot_json AS s, reason, actor_email FROM "EntityVersion" WHERE entity_type = 'Structure' AND entity_id = ${rows[0].id}`)).rows;
    expect(v).toHaveLength(1);
    expect(v[0].s.telephone).toBe('03 88 00 00 01');
    expect(v[0].reason).toMatch(/SOURCE_UPDATE mediation_numerique_lieux: telephone/); expect(v[0].actor_email).toBe('ingestion');
    expect(v[0].s.id).toBe(rows[0].id);   // the full row (A07 store), restorable from /admin/versions
  }, 120000);

  it('a raw change that is not a fact change (formatting, an unrelated field) only moves the traceability link', async () => {
    pages[1] = { ...rec(2), tel: '0388000002', horaires_internes: 'changed' };   // same digits, extra raw field
    const out = await ingest({});
    expect([out.created, out.updated, out.metadataOnly]).toEqual([0, 0, 1]);
  }, 120000);

  it('a VERIFIED structure is never overwritten: one review item carries the difference, not duplicated on the next run', async () => {
    const [row] = (await mine()).filter((r) => r.nom === `D14 Lieu 3 ${TS}`);
    await db.execute(sql`UPDATE "Structure" SET verification_status = 'VERIFIED', verified_by = 'rev-1' WHERE id = ${row.id}`);
    pages[2] = rec(3, { mail: 'nouveau@example.test' });
    const out = await ingest({});
    expect([out.updated, out.reviewQueued]).toEqual([0, 1]);
    expect((await db.execute(sql`SELECT email FROM "Structure" WHERE id = ${row.id}`)).rows[0].email).toBe('lieu3@example.test');
    const items = (await db.execute(sql`SELECT reason, status, details FROM "ReviewQueueItem" WHERE "entityType" = 'structure' AND "entityId" = ${row.id}`)).rows;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ reason: 'SOURCE_FACT_CHANGED', status: 'OPEN' });
    expect(items[0].details.diff.email).toEqual({ current: 'lieu3@example.test', source: 'nouveau@example.test' });
    const again = await ingest({});
    expect(again.reviewQueued).toBe(0);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "ReviewQueueItem" WHERE "entityId" = ${row.id}`)).rows[0].n).toBe(1);
  }, 120000);

  it('absent from a COMPLETE fetch → soft-removed and kept; an empty or failed fetch removes nothing', async () => {
    const before = (await mine()).length;
    failNext = true;
    const failed = await ingest({});
    expect(failed.removed).toBe(0);
    pages = [];
    const empty = await ingest({});
    expect(empty.removed).toBe(0);
    expect((await mine()).filter((r) => r.import_status === 'removed')).toHaveLength(0);
    pages = Array.from({ length: 250 }, (_, i) => rec(i + 1)).filter((_, i) => i !== 9);   // record 10 is gone
    pages[0] = rec(1, { tel: '03 88 99 99 99' }); pages[1] = { ...rec(2), tel: '0388000002', horaires_internes: 'changed' }; pages[2] = rec(3, { mail: 'nouveau@example.test' });
    const out = await ingest({});
    expect(out.removed).toBe(1);
    const rows = await mine();
    expect(rows).toHaveLength(before);   // nothing physically deleted
    expect(rows.filter((r) => r.import_status === 'removed').map((r) => r.nom)).toEqual([`D14 Lieu 10 ${TS}`]);
  }, 120000);
});
