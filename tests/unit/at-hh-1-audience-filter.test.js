// AT-HH-1 — Aides-territoires: only aids whose targeted_audiences include private persons are imported as citizen « Aide » records.
// Fail closed: missing / empty / organisation-only audience ⇒ excluded and counted. Synthetic inline fixtures, no network, no DB.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const inserted = [];
vi.mock('../../src/db/index.js', () => ({
  db: {
    insert: () => ({ values: async (v) => { inserted.push(v); return []; } }),
  },
}));

const { AidesTerritoiresConnector, isCitizenAudience, CITIZEN_AUDIENCE } = await import('../../api/lib/ingestion/AidesTerritoiresConnector.js');
const { IngestionPipelineCore } = await import('../../api/lib/ingestion/IngestionPipelineCore.js');
const { AidIngestSchema } = await import('../../api/lib/ingestion/validators.js');

const item = (id, targeted_audiences) => ({
  id,
  slug: `aide-${id}`,
  name: `Aide synthétique ${id}`,
  description: '<p>Description synthétique suffisamment longue pour la validation.</p>',
  url: `https://aides-territoires.beta.gouv.fr/aides/aide-${id}/`,
  ...(targeted_audiences === undefined ? {} : { targeted_audiences }),
});

async function parsedOf(raw) {
  const c = new AidesTerritoiresConnector();
  return c.parse(JSON.stringify(raw), 'u');
}

describe('AT-HH-1 audience rule (connector)', () => {
  it('the citizen value is private_person', () => {
    expect(CITIZEN_AUDIENCE).toBe('private_person');
  });

  it('private_person is kept', async () => {
    const c = new AidesTerritoiresConnector();
    expect(c.excludeFromCitizenCatalogue(await parsedOf(item(1, ['private_person'])))).toBe(false);
  });

  it('commune-only is excluded', async () => {
    const c = new AidesTerritoiresConnector();
    expect(c.excludeFromCitizenCatalogue(await parsedOf(item(2, ['commune'])))).toBe(true);
  });

  it('organisation audiences only (epci, association, private_sector, farmer, researcher, public_cies) are excluded', async () => {
    const c = new AidesTerritoiresConnector();
    const p = await parsedOf(item(3, ['commune', 'epci', 'association', 'private_sector', 'farmer', 'researcher', 'public_cies']));
    expect(c.excludeFromCitizenCatalogue(p)).toBe(true);
  });

  it('mixed [private_person, association] is kept', async () => {
    const c = new AidesTerritoiresConnector();
    expect(c.excludeFromCitizenCatalogue(await parsedOf(item(4, ['private_person', 'association'])))).toBe(false);
  });

  it('missing, empty, null or malformed audience is excluded (fail closed)', async () => {
    const c = new AidesTerritoiresConnector();
    expect(c.excludeFromCitizenCatalogue(await parsedOf(item(5, undefined)))).toBe(true);
    expect(c.excludeFromCitizenCatalogue(await parsedOf(item(6, [])))).toBe(true);
    expect(c.excludeFromCitizenCatalogue(await parsedOf(item(7, null)))).toBe(true);
    expect(c.excludeFromCitizenCatalogue(await parsedOf(item(8, 'private_person')))).toBe(true);
    expect(c.excludeFromCitizenCatalogue(await parsedOf(item(9, [{ slug: 'private_person' }])))).toBe(true);
    expect(c.excludeFromCitizenCatalogue(null)).toBe(true);
    expect(c.excludeFromCitizenCatalogue(undefined)).toBe(true);
  });

  it('isCitizenAudience tolerates case and surrounding spaces only', () => {
    expect(isCitizenAudience([' Private_Person '])).toBe(true);
    expect(isCitizenAudience(['private_persons'])).toBe(false);
    expect(isCitizenAudience(['private'])).toBe(false);
  });
});

describe('AT-HH-1 run summary (pipeline)', () => {
  beforeEach(() => { inserted.length = 0; });

  it('non-citizen aids are never upserted and are counted as excludedNonCitizen', async () => {
    const c = new AidesTerritoiresConnector();
    const fixtures = [
      item(101, ['private_person']),
      item(102, ['commune']),
      item(103, ['private_person', 'association']),
      item(104, undefined),
      item(105, []),
      item(106, ['epci', 'private_sector']),
    ];
    vi.spyOn(c, 'getDetailUrls').mockImplementation(async () => {
      c._cache.clear();
      for (const f of fixtures) c._cache.set(`${c.baseUrl}/aides/${f.slug}/`, f);
      return Array.from(c._cache.keys());
    });

    const pipeline = new IngestionPipelineCore({ modelName: 'aide', schema: AidIngestSchema, connector: c, runId: 'at-hh-1-test', batchSize: 50 });
    const upserted = [];
    vi.spyOn(pipeline, '_flushBatch').mockImplementation(async (batch) => { upserted.push(...batch); });

    const stats = await pipeline.run();

    expect(stats.fetched).toBe(6);
    expect(stats.processed).toBe(6);
    expect(stats.excludedNonCitizen).toBe(4);
    expect(upserted.map((b) => b.data.external_id).sort()).toEqual(['aides-territoires:101', 'aides-territoires:103']);
    // the excluded items are not errors
    expect(stats.errors.filter((e) => !String(e).includes('Graceful'))).toEqual([]);
    // the count reaches the persisted SyncRun stats
    const syncRun = inserted.find((v) => v && v.stats);
    expect(syncRun.stats.excluded_non_citizen).toBe(4);
  });
});
