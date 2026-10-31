#!/usr/bin/env node
/**
 * R28/R29 — official news feeds into drafts, then the automatic verification. Run by the operator from the LAB Mac (every cron is refused in the
 * public beta):
 *
 *   DATABASE_URL=… node scripts/news-ingest.mjs [--limit 40] [--no-verify]
 *
 * The ingestion only writes drafts (statut « brouillon »): the link must be https, each item keeps its source document, its dates and its
 * de-duplication key (canonical address), and a refresh never changes a decision. The verification that follows (api/_services/news-verification.js)
 * publishes the drafts that pass every check — reuse rights, audience, date, the publisher's own words, no duplicate, the live original page — and
 * writes the reasons on the others. No person is named and no human review is claimed.
 */
process.env.ADA_PUBLIC_BETA_RESTRICTED = '1';
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg > 0 ? Math.max(1, Math.min(200, Number(process.argv[limitArg + 1]) || 40)) : 40;
const { runIngestActualitesRss } = await import('../api/_handlers/cron/ingest-actualites-rss.js');
const stats = await runIngestActualitesRss({ limit, runId: `operator-${new Date().toISOString()}` });
console.log(`NEWS_INGEST ${JSON.stringify({ fetched: stats.fetched, processed: stats.processed, created: stats.created, updated: stats.updated, skipped: stats.skippedExisting, errors: stats.errors.slice(0, 5) })}`);
if (!process.argv.includes('--no-verify')) {
  const { verifyNewsDrafts } = await import('../api/_services/news-verification.js');
  const { db } = await import('../src/db/index.js');
  const schema = await import('../src/db/schema.js');
  const ops = await import('drizzle-orm');
  const v = await verifyNewsDrafts({ db, schema, ops });
  console.log(`NEWS_VERIFY ${JSON.stringify(v)}`);
}
process.exit(0);
