import { describe, it, expect } from 'vitest';
import fs from 'fs';

/**
 * G14 release 2 (QA v72 « schema_snapshot_generation ») — `drizzle-kit generate` against src/db/schema.ts must produce NO migration.
 *
 * The bge-m3 objects of migration 0060 ("embedding_m3", "embedding_m3_sha256", "embedding_m3_at" and "Aide_embedding_m3_hnsw_idx") are deliberately
 * NOT declared in src/db/schema.ts: Drizzle names every declared column in select() / insert(), so declaring them makes every read of "Aide" fail on a
 * database without the optional migration 0060 (access to them is raw SQL behind a presence check). The 0060–0062 snapshots therefore leave them out
 * too (the 0060 SQL and drizzle/rollback/0060_down.sql still create and drop them); otherwise drizzle-kit diffs the last snapshot against the schema
 * and emits a 0063 that DROPs them.
 */
const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
const last = journal.at(-1);
const lastSnapshot = JSON.parse(fs.readFileSync(`drizzle/meta/${String(last.idx).padStart(4, '0')}_snapshot.json`, 'utf8'));

describe('G14-R2 drizzle snapshots vs src/db/schema.ts', () => {
  it('the newest snapshot diffed against the declared schema yields no SQL statement (drizzle-kit generate is a no-op)', async () => {
    const { generateDrizzleJson, generateMigration } = await import('drizzle-kit/api');
    const schema = await import('../../src/db/schema.js');
    const current = generateDrizzleJson(schema, lastSnapshot.id);
    const statements = await generateMigration(lastSnapshot, current);
    expect(statements).toEqual([]);
  }, 60_000);

  it('the bge-m3 objects live in the 0060 SQL and rollback only, never in a snapshot or in the Drizzle schema', () => {
    expect(fs.readFileSync('drizzle/0060_g14_ai_bge_m3_index.sql', 'utf8')).toMatch(/ADD COLUMN IF NOT EXISTS "embedding_m3" vector\(1024\)/);
    expect(fs.readFileSync('drizzle/rollback/0060_down.sql', 'utf8')).toMatch(/embedding_m3/);
    for (const f of ['0060', '0061', '0062']) expect(fs.readFileSync(`drizzle/meta/${f}_snapshot.json`, 'utf8'), f).not.toMatch(/embedding_m3/);
    expect(fs.readFileSync('src/db/schema.ts', 'utf8')).not.toMatch(/(?:vector|text|timestamp)\('embedding_m3/);
  });
});
