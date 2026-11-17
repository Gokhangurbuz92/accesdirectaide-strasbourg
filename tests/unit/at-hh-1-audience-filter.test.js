// AT-HH-1 mechanism (bd3ce38, cherry-picked) with the C11 / D08 rule (owner, 17/11/2026): the pipeline drops an item its connector excludes from the
// citizen catalogue, before validation and upsert, and counts it; Aides-territoires excludes EVERY item (institution / structure / territory funding,
// never citizen aid). Synthetic inline fixtures, no network, no DB.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const inserted = [];
vi.mock('../../src/db/index.js', () => ({
  db: {
    insert: () => ({ values: async (v) => { inserted.push(v); return []; } }),
  },
}));

const { AidesTerritoiresConnector } = await import('../../api/lib/ingestion/AidesTerritoiresConnector.js');
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

describe('C11 / D08 — no Aides-territoires item is a citizen aid (connector)', () => {
  it('every item is excluded, whatever its audience — private_person included (owner C11 supersedes AT-HH-1)', async () => {
    const c = new AidesTerritoiresConnector();
    for (const [i, aud] of [[1, ['private_person']], [2, ['commune']], [3, ['private_person', 'association']], [4, undefined], [5, []], [6, null], [7, 'private_person']].entries()) {
      expect(c.excludeFromCitizenCatalogue(await parsedOf(item(aud[0] ?? i, aud[1]))), JSON.stringify(aud)).toBe(true);
    }
    expect(c.excludeFromCitizenCatalogue(null)).toBe(true);
    expect(c.excludeFromCitizenCatalogue(undefined)).toBe(true);
  });
});

describe('C11 / D08 run summary (pipeline, AT-HH-1 mechanism)', () => {
  beforeEach(() => { inserted.length = 0; });

  it('no Aides-territoires item is ever upserted; each is counted as excludedNonCitizen, not as an error', async () => {
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
    expect(stats.excludedNonCitizen).toBe(6);
    expect(upserted).toEqual([]);
    // the excluded items are not errors
    expect(stats.errors.filter((e) => !String(e).includes('Graceful'))).toEqual([]);
    // the count reaches the persisted SyncRun stats
    const syncRun = inserted.find((v) => v && v.stats);
    expect(syncRun.stats.excluded_non_citizen).toBe(6);
  });
});
