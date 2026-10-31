#!/usr/bin/env node
/**
 * R29 — check every news draft against the automatic publication rules (api/_services/news-verification.js) and publish those that pass.
 *
 *   DATABASE_URL=… node scripts/verify-actualites.mjs            → dry run: what would be published, and why the others stay drafts
 *   DATABASE_URL=… node scripts/verify-actualites.mjs --apply
 */
import { verifyNewsDrafts } from '../api/_services/news-verification.js';

async function main() {
  const apply = process.argv.includes('--apply');
  const { db } = await import('../src/db/index.js');
  const schema = await import('../src/db/schema.js');
  const ops = await import('drizzle-orm');
  const result = await verifyNewsDrafts({ db, schema, ops, apply, log: (s) => console.log(s) });
  console.log(`NEWS_VERIFY ${JSON.stringify({ apply, ...result })}`);
  process.exit(0);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(`NEWS_VERIFY {"ok":false,"error":${JSON.stringify(String(e?.message || e).slice(0, 200))}}`); process.exit(1); });
