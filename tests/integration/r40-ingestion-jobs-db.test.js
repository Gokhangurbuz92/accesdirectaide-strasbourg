/**
 * R40 — the ingestion jobs on a REAL PostgreSQL, without any network (fetch is replaced: every outside call fails):
 *  G3e  a record is found by the provider's stable id, then the exact source URL — never by title: two aids with the same title are two records
 *  G4   ingest-aids and ingest-structures write a CronRun row (running → failed / partial / success), which health-alert reads
 *  G8   health-alert does not report the veille stale while the veille is closed in the beta
 *  G9   the RSS seed keeps an administrator's « disabled » and never re-enables a feed the manifest disables
 * Run: DBN=ada_r40_jobs_test bash $S/r40/jobs/int.sh tests/integration/r40-ingestion-jobs-db.test.js
 */
import { vi } from 'vitest';
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
const kvState = vi.hoisted(() => ({ store: new Map() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: {
  incr: async () => 1, expire: async () => 1,
  get: async (k) => kvState.store.get(k) ?? null,
  set: async (k, v, o) => { if (o?.nx && kvState.store.has(k)) return null; kvState.store.set(k, v); return 'OK'; },
  del: async (k) => (kvState.store.delete(k) ? 1 : 0),
} }));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const offline = async () => { throw new Error('offline test: no network'); };

describe.skipIf(!hasDatabase)('R40 ingestion jobs (real DB, no network)', () => {
  let db, schema;
  const realFetch = globalThis.fetch;
  const call = async (handler, url, query = {}) => { const r = mk(); await handler({ method: 'GET', url, query, headers: { host: 'x', 'x-cron-secret': process.env.CRON_SECRET } }, r); return r; };
  const one = async (q) => (await db.execute(q)).rows[0];

  beforeAll(async () => {
    globalThis.fetch = offline;
    ({ db } = await import('../../src/db/index.js')); schema = await import('../../src/db/schema.js');
  });
  afterAll(async () => {
    globalThis.fetch = realFetch;
    if (!db) return;
    await db.execute(sql`DELETE FROM "EntityVersion" WHERE entity_id IN (SELECT id FROM "Aide" WHERE "providerName" = ${'r40-fake-' + TS})`);
    await db.execute(sql`DELETE FROM "Aide" WHERE "providerName" = ${'r40-fake-' + TS}`);
    await db.execute(sql`DELETE FROM "CronRun" WHERE metrics->>'r40' = ${String(TS)} OR "startedAt" > NOW() - INTERVAL '1 hour' AND job IN ('ingest-aids', 'ingest-structures')`);
  });

  it('G3e: two aids with the same title and different provider ids are two records; an update finds its record by id, not by title', async () => {
    const { IngestionPipelineCore } = await import('../../api/lib/ingestion/IngestionPipelineCore.js');
    const { AidIngestSchema } = await import('../../api/lib/ingestion/validators.js');
    const name = `r40-fake-${TS}`;
    const items = (v) => [
      { title: `Aide au permis de conduire ${TS}`, description: `Ville A ${v}`, content: `Contenu A ${v}`, source_url: `https://example.test/a-${TS}`, external_id: `r40:${TS}:1` },
      { title: `Aide au permis de conduire ${TS}`, description: 'Ville B', content: 'Contenu B', source_url: `https://example.test/b-${TS}`, external_id: `r40:${TS}:2` },
    ];
    const connector = (list) => ({ name, getDetailUrls: async () => list.map((x) => x.source_url), fetch: async (u) => JSON.stringify(list.find((x) => x.source_url === u)), parse: async (j) => JSON.parse(j) });
    const run = (list) => new IngestionPipelineCore({ modelName: 'aide', schema: AidIngestSchema, connector: connector(list), runId: `r40-${TS}` }).run();
    const s1 = await run(items(1));
    expect([s1.created, s1.updated, s1.errors]).toEqual([2, 0, []]);
    const rows = async () => (await db.execute(sql`SELECT "externalId", summary_falc, statut FROM "Aide" WHERE "providerName" = ${name} ORDER BY "externalId"`)).rows;
    expect((await rows()).map((r) => [r.externalId, r.summary_falc, r.statut])).toEqual([[`r40:${TS}:1`, 'Ville A 1', 'brouillon'], [`r40:${TS}:2`, 'Ville B', 'brouillon']]);
    const s2 = await run(items(2));
    expect([s2.created, s2.updated, s2.skippedExisting]).toEqual([0, 1, 1]);
    expect((await rows()).map((r) => r.summary_falc)).toEqual(['Ville A 2', 'Ville B']);   // the other record of the same title is untouched
    // a record imported before ids were kept (no externalId, same URL) is found by its URL and gets the id; never a second record
    await db.execute(sql`UPDATE "Aide" SET "externalId" = NULL WHERE "externalId" = ${`r40:${TS}:2`}`);
    const s3 = await run(items(2));
    expect(s3.created).toBe(0);
    expect((await rows()).map((r) => r.externalId)).toEqual([`r40:${TS}:1`, `r40:${TS}:2`]);
  });

  it('G4: ingest-aids records its run in CronRun — no Aides-territoires key: « failed » with the typed reason, nothing fetched elsewhere', async () => {
    delete process.env.AIDES_TERRITOIRES_API_KEY;
    const { default: handler } = await import('../../api/_handlers/cron/ingest-aids.js');
    const r = await call(handler, '/api/cron/ingest-aids');
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    expect(Object.keys(r.body.results)).toEqual(['aides-territoires']);   // G3: Grand Est, AGEFIPH and DREES are not run
    const row = await one(sql`SELECT status, "errorSample", metrics FROM "CronRun" WHERE job = 'ingest-aids' AND metrics->>'runId' = ${r.body.runId}`);
    expect(row.status).toBe('failed');
    expect(row.errorSample).toMatch(/AT_CREDENTIALS_MISSING/);
    const refused = await call(handler, '/api/cron/ingest-aids', { source: 'Grand Est' });
    expect([refused.statusCode, refused.body.error]).toEqual([403, 'SOURCE_NOT_AUTHORISED']);
  });

  it('G4: ingest-structures records its run in CronRun (the open-data fetch fails offline: nothing removed, the run is not « success »)', async () => {
    const { default: handler } = await import('../../api/_handlers/cron/ingest-structures.js');
    const before = Number((await one(sql`SELECT count(*)::int AS n FROM "CronRun" WHERE job = 'ingest-structures'`)).n);
    const r = await call(handler, '/api/cron/ingest-structures');
    expect([200, 500]).toContain(r.statusCode);
    const rows = (await db.execute(sql`SELECT status FROM "CronRun" WHERE job = 'ingest-structures' ORDER BY "startedAt" DESC`)).rows;
    expect(rows.length).toBe(before + 1);
    expect(['failed', 'partial']).toContain(rows[0].status);
  });

  it('G8: in the beta with the veille closed, health-alert reports the veille check as skipped and fires no veille alert', async () => {
    process.env.ADA_PUBLIC_BETA_RESTRICTED = '1'; delete process.env.ADA_BETA_OPEN_JOBS;
    try {
      const { default: handler } = await import('../../api/_handlers/cron/health-alert.js');
      const r = await call(handler, '/api/cron/health-alert');
      expect(r.body.checks.veille).toEqual({ ok: true, skipped: 'JOB_NOT_OPENED' });
      expect([...kvState.store.keys()].some((k) => /veille\.stale/.test(k))).toBe(false);
      process.env.ADA_BETA_OPEN_JOBS = 'veille';   // opened: the check runs again (no veille run recorded here → not ok)
      const r2 = await call(handler, '/api/cron/health-alert');
      expect(r2.body.checks.veille.skipped).toBeUndefined();
    } finally { delete process.env.ADA_PUBLIC_BETA_RESTRICTED; delete process.env.ADA_BETA_OPEN_JOBS; }
  });

  it('G9: the RSS seed keeps a feed an administrator disabled, and never re-enables a feed the manifest disables', async () => {
    const SP = 'https://www.service-public.gouv.fr/abonnements/rss/actu-actualites-particuliers.rss';   // enabled in the manifest
    const GE = 'https://www.grandest.fr/feed/';                                                         // disabled in the manifest (reuse not authorised)
    const prior = (await db.execute(sql`SELECT feed_url, enabled FROM "RssSource" WHERE feed_url IN (${SP}, ${GE})`)).rows;
    try {
      for (const [u, en] of [[SP, false], [GE, true]]) {
        await db.execute(sql`INSERT INTO "RssSource" (id, name, feed_url, domain, trust_level, enabled, error_count, "updatedAt") VALUES (${`r40-${TS}-${en}`}, 'x', ${u}, 'x', 'OFFICIAL', ${en}, 0, NOW())
          ON CONFLICT (feed_url) DO UPDATE SET enabled = ${en}`);
      }
      const { runIngestActualitesRss } = await import('../../api/_handlers/cron/ingest-actualites-rss.js');
      await runIngestActualitesRss({ limit: 1, runId: `r40-${TS}` });
      const now = Object.fromEntries((await db.execute(sql`SELECT feed_url, enabled FROM "RssSource" WHERE feed_url IN (${SP}, ${GE})`)).rows.map((x) => [x.feed_url, x.enabled]));
      expect(now).toEqual({ [SP]: false, [GE]: false });
    } finally {
      for (const p of prior) await db.execute(sql`UPDATE "RssSource" SET enabled = ${p.enabled} WHERE feed_url = ${p.feed_url}`);
      if (!prior.length) await db.execute(sql`DELETE FROM "RssSource" WHERE id LIKE ${`r40-${TS}-%`}`);
    }
  });
});
