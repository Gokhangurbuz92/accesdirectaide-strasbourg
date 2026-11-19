/**
 * C12 — migration 0050 (publication of the /ressources documents) on a THROWAWAY database of the local cluster: up → down → (pre-0050 rows) → up → up.
 *   up      every migration through drizzle's own migrator: eight nullable columns, the CHECK, the append-only ledger
 *   down    drizzle/rollback/0050_down.sql: columns, CHECK and ledger gone, documents kept, the journal row forgotten
 *   rows    rows written as on a database without 0050 (a « published » one, a draft) — then 0050 again (only it): every former column and status of those
 *           rows is unchanged, every new column is NULL (no source, date or reviewer is invented), the table file is not rewritten (same relfilenode)
 *   twice   the file run a second time by hand changes nothing (idempotent)
 * Synthetic rows only. Skipped without DATABASE_URL (a local cluster where the test role may create a database).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const hasDatabase = !!process.env.DATABASE_URL;
const NAME = `ada_c12_mig_${Date.now().toString(36)}_test`;
const TAG = '0050_rs_resource_publication';
const COLS = ['published_at', 'reviewer_id', 'reviewer_type', 'source_publisher', 'verified_at', 'verified_version', 'withdrawal_reason', 'withdrawn_at'];
const withDb = (url, name) => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
const statements = (file) => fs.readFileSync(file, 'utf8').split('--> statement-breakpoint').map((x) => x.trim()).filter(Boolean);

describe.skipIf(!hasDatabase)('migration 0050: up → down → up on a throwaway database', () => {
  let admin; let pool; let when;
  const q = async (text, params) => (await pool.query(text, params)).rows;
  const columns = async () => (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ResourceAccessibility' AND column_name = ANY($1) ORDER BY 1`, [COLS])).map((r) => r.column_name);
  const ledger = async () => (await q(`SELECT to_regclass('public."ResourcePublicationEvent"') IS NOT NULL AS e`))[0].e;
  const check = async () => (await q(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'ResourceAccessibility_verification_check'`))[0].n;
  const journalRow = async () => (await q('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations WHERE created_at = $1', [when]))[0].n;
  const up = () => migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  // drizzle re-applies only what is later than the NEWEST recorded migration: the later ones (0057 X03, 0056 X05, 0055 X01, 0054 X02, 0053 X04, 0052 C8, 0051 P19) are rolled back first, newest first,
  // then 0050 — otherwise the next `up` would never re-apply 0050 (each rollback file is idempotent and forgets its own journal row)
  const LATER_DOWNS = ['drizzle/rollback/0057_down.sql', 'drizzle/rollback/0056_down.sql', 'drizzle/rollback/0055_down.sql', 'drizzle/rollback/0054_down.sql', 'drizzle/rollback/0053_down.sql', 'drizzle/rollback/0052_down.sql', 'drizzle/rollback/0051_down.sql'].filter((f) => fs.existsSync(f));
  const down = async () => { for (const f of [...LATER_DOWNS, 'drizzle/rollback/0050_down.sql']) await pool.query(fs.readFileSync(f, 'utf8')); };
  const legacyRows = () => q(`SELECT id, slug, title, type, content, source_url, territory_scope, status, "createdAt", "updatedAt" FROM "ResourceAccessibility" ORDER BY id`);

  beforeAll(async () => {
    when = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries.find((e) => e.tag === TAG).when;
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL }); await admin.connect();
    await admin.query(`CREATE DATABASE ${NAME}`);
    await admin.query(`ALTER DATABASE ${NAME} SET timezone TO 'UTC'`);
    pool = new pg.Pool({ connectionString: withDb(process.env.DATABASE_URL, NAME), max: 2 });
    await pool.query('CREATE EXTENSION IF NOT EXISTS unaccent; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS vector;');
    await up();
  }, 180000);
  afterAll(async () => {
    await pool?.end().catch(() => {});
    await admin?.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`).catch(() => {});
    await admin?.end().catch(() => {});
  });

  it('up: the eight columns, the CHECK, the ledger and its append-only trigger exist; 0050 is recorded', async () => {
    expect(await columns()).toEqual(COLS);
    expect(await check()).toBe(1); expect(await ledger()).toBe(true); expect(await journalRow()).toBe(1);
    const trig = await q(`SELECT tgname FROM pg_trigger WHERE tgrelid = '"ResourcePublicationEvent"'::regclass AND NOT tgisinternal`);
    expect(trig.map((t) => t.tgname)).toEqual(['ResourcePublicationEvent_append_only']);
  });

  it('down: columns, CHECK and ledger gone, documents kept, the journal row forgotten; running it twice is harmless', async () => {
    await pool.query(`INSERT INTO "ResourceAccessibility" (id, slug, title, type, status, "updatedAt") VALUES ('keep', 'keep', 'Gardé', 'guide', 'draft', NOW())`);
    await down(); await down();
    expect(await columns()).toEqual([]); expect(await check()).toBe(0); expect(await ledger()).toBe(false); expect(await journalRow()).toBe(0);
    expect((await legacyRows()).map((r) => r.id)).toEqual(['keep']);
  });

  it('rows of a database without 0050 survive 0050 unchanged, with nothing invented; the file is idempotent', async () => {
    await pool.query(`INSERT INTO "ResourceAccessibility" (id, slug, title, type, content, source_url, status, "updatedAt", "createdAt") VALUES
      ('old-pub', 'old-pub', 'Ancien publié', 'guide', 'Texte', 'https://www.caf.fr/x', 'published', NOW(), NOW() - interval '400 days'),
      ('old-draft', 'old-draft', 'Ancien brouillon', 'document', NULL, NULL, 'draft', NOW(), NOW() - interval '10 days')`);
    const before = await legacyRows();
    const file = (await q(`SELECT relfilenode FROM pg_class WHERE relname = 'ResourceAccessibility'`))[0].relfilenode;
    await up();   // applies 0050 and the later migrations rolled back with it (the newest recorded migration is 0049)
    expect(await journalRow()).toBe(1);
    expect(await legacyRows()).toEqual(before);
    const added = await q(`SELECT ${COLS.map((c) => `"${c}"`).join(', ')} FROM "ResourceAccessibility"`);
    for (const r of added) expect(Object.values(r).every((v) => v === null)).toBe(true);
    expect((await q(`SELECT relfilenode FROM pg_class WHERE relname = 'ResourceAccessibility'`))[0].relfilenode).toBe(file);
    for (const s of statements(`drizzle/${TAG}.sql`)) await pool.query(s);   // a second run by hand: same schema, same rows
    expect(await columns()).toEqual(COLS); expect(await check()).toBe(1);
    expect(await legacyRows()).toEqual(before);
    const trig = await q(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = '"ResourcePublicationEvent"'::regclass AND NOT tgisinternal`);
    expect(trig[0].n).toBe(1);
  });

  it('the database refuses an incomplete verification, an unknown ledger action and any change of the ledger', async () => {
    await expect(pool.query(`UPDATE "ResourceAccessibility" SET verified_at = NOW() WHERE id = 'old-pub'`)).rejects.toThrow(/ResourceAccessibility_verification_check/);
    await expect(pool.query(`INSERT INTO "ResourcePublicationEvent" (id, "resourceId", action, "toStatus", "actorType", "actorId") VALUES ('e0', 'old-pub', 'AUTO_PUBLISH', 'published', 'system', 'x')`)).rejects.toThrow(/ResourcePublicationEvent_action_check/);
    await pool.query(`INSERT INTO "ResourcePublicationEvent" (id, "resourceId", action, "toStatus", "actorType", "actorId") VALUES ('e1', 'old-pub', 'EDIT', 'draft', 'admin', 'a@example.test')`);
    await expect(pool.query(`UPDATE "ResourcePublicationEvent" SET note = 'x'`)).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM "ResourcePublicationEvent"`)).rejects.toThrow(/append-only/);
  });
});
