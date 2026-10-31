#!/usr/bin/env node
/**
 * R28 — official news feeds (data/news-sources.json) into EDITORIAL DRAFTS. Run by the operator from the LAB Mac (no cron runs in the public beta):
 *
 *   DATABASE_URL=… node scripts/news-ingest.mjs [--limit 40]
 *
 * The restricted-beta mode is forced for this run: every item is created as a draft (statut « brouillon »), a refresh never changes a person's decision,
 * the link must be https, each item keeps its source document, its dates and its de-duplication key (canonical address). Nothing becomes public here:
 * a named person publishes with scripts/review-actualites.mjs.
 */
process.env.ADA_PUBLIC_BETA_RESTRICTED = '1';
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg > 0 ? Math.max(1, Math.min(200, Number(process.argv[limitArg + 1]) || 40)) : 40;
const { runIngestActualitesRss } = await import('../api/_handlers/cron/ingest-actualites-rss.js');
const stats = await runIngestActualitesRss({ limit, runId: `operator-${new Date().toISOString()}` });
console.log(`NEWS_INGEST ${JSON.stringify({ fetched: stats.fetched, processed: stats.processed, created: stats.created, updated: stats.updated, skipped: stats.skippedExisting, errors: stats.errors.slice(0, 5) })}`);
process.exit(0);
