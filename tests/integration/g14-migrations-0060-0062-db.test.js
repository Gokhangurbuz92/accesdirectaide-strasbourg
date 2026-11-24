/**
 * G14 release 2 (g14-r2 integration) — migrations 0060 (G14-AI bge-m3 index), 0061 (G14-PS social referrals) and 0062 (G14-OBS demand signals) on a
 * THROWAWAY database of the local cluster: up → down → up.
 *   up      every migration through drizzle's own migrator: the three bge-m3 columns and their HNSW index on "Aide", the two social-referral tables and
 *           their append-only trigger, the two demand-signal tables and the frozen-quarter trigger; 0060 / 0061 / 0062 recorded, 0062 the newest
 *   down    drizzle/rollback/0062_down.sql, 0061_down.sql, 0060_down.sql (newest first): everything they added is gone, their three journal rows are forgotten,
 *           0059 and the earlier schema are untouched; a second run changes nothing; 0061_down refuses while a social referral exists
 *   up again exactly 0060, 0061 and 0062 are re-applied
 * G14 release 3: 0063 (needs of bookable services, own booking pages) came after them: its rollback runs first (newest first) and it is re-applied with them.
 * Synthetic rows only. Skipped without DATABASE_URL (a local cluster where the test role may create a database).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Aide } from '../../src/db/schema.js';

const hasDatabase = !!process.env.DATABASE_URL;
const NAME = `ada_g14r2_mig_${Date.now().toString(36)}_test`;
const TAGS = ['0060_g14_ai_bge_m3_index', '0061_g14_ps_social_referrals', '0062_g14_obs_demand_signals'];
const withDb = (url, name) => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
const DOWNS = ['drizzle/rollback/0062_down.sql', 'drizzle/rollback/0061_down.sql', 'drizzle/rollback/0060_down.sql'];
// migrations journaled after 0062, rolled back first (newest first)
const LATER_DOWNS = ['drizzle/rollback/0063_down.sql'];

describe.skipIf(!hasDatabase)('migrations 0060–0062: up → down → up', () => {
  let admin; let pool; let journal;
  const q = async (text, params) => (await pool.query(text, params)).rows;
  const state = async () => (await q(`SELECT
      to_regclass('public."SocialReferral"') IS NOT NULL AS sr, to_regclass('public."SocialReferralEvent"') IS NOT NULL AS sre,
      to_regclass('public."DemandSignalDaily"') IS NOT NULL AS dsd, to_regclass('public."DemandSignalQuarter"') IS NOT NULL AS dsq,
      to_regclass('public."Aide_embedding_m3_hnsw_idx"') IS NOT NULL AS m3idx,
      (SELECT count(*)::int FROM information_schema.columns WHERE table_name = 'Aide' AND column_name LIKE 'embedding_m3%') AS m3cols,
      to_regclass('public."StructureExternalBooking"') IS NOT NULL AS ext, to_regclass('public."ProRdvServiceSubdomain"') IS NOT NULL AS needs`))[0];
  const rowsOf = async () => (await q('SELECT created_at::text AS w FROM drizzle.__drizzle_migrations ORDER BY created_at')).map((r) => r.w);
  const up = () => migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  const down = async () => { for (const f of [...LATER_DOWNS, ...DOWNS]) await pool.query(fs.readFileSync(f, 'utf8')); };
  const ALL_UP = { sr: true, sre: true, dsd: true, dsq: true, m3idx: true, m3cols: 3, ext: true, needs: true };
  const ALL_DOWN = { sr: false, sre: false, dsd: false, dsq: false, m3idx: false, m3cols: 0, ext: false, needs: false };
  const first = () => journal.findIndex((e) => e.tag === TAGS[0]);

  beforeAll(async () => {
    journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL }); await admin.connect();
    await admin.query(`CREATE DATABASE ${NAME}`);
    await admin.query(`ALTER DATABASE ${NAME} SET timezone TO 'UTC'`);
    pool = new pg.Pool({ connectionString: withDb(process.env.DATABASE_URL, NAME), max: 3 });
    await pool.query('CREATE EXTENSION IF NOT EXISTS unaccent; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS vector;');
    await up();
  }, 180000);
  afterAll(async () => {
    await pool?.end().catch(() => {});
    await admin?.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`).catch(() => {});
    await admin?.end().catch(() => {});
  });

  it('the journal: 0060, 0061, 0062 contiguous (idx 60, 61, 62), increasing « when », 0062 the newest; each rollback forgets its own row', () => {
    const at = journal.findIndex((e) => e.tag === TAGS[0]);
    expect(journal.slice(at, at + 3).map((e) => [e.idx, e.tag])).toEqual([[60, TAGS[0]], [61, TAGS[1]], [62, TAGS[2]]]);
    expect(journal.slice(at + 3).map((e) => e.tag)).toEqual(['0063_g14_r3_booking_needs_external']);
    expect(journal[at - 1].tag).toBe('0059_g14_moderation_dsa');
    for (let i = at; i < journal.length; i += 1) expect(journal[i].when).toBeGreaterThan(journal[i - 1].when);
    [...LATER_DOWNS, ...DOWNS].forEach((f, i) => expect(fs.readFileSync(f, 'utf8')).toContain(`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${journal[journal.length - 1 - i].when};`));
  });

  it('up: every object of the three migrations exists and the three rows are recorded', async () => {
    expect(await state()).toEqual(ALL_UP);
    const rows = await rowsOf();
    expect(rows).toEqual(journal.map((e) => String(e.when)));
  });

  it('0061_down refuses while a social referral exists (consents owed to persons), and changes nothing', async () => {
    await q(`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, "updatedAt", "createdAt")
      VALUES ('g14r2-a', 'A', 'g14r2-a', 'CCAS', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['x'], ARRAY['x'], 'actif', now(), now()),
             ('g14r2-b', 'B', 'g14r2-b', 'Association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['x'], ARRAY['x'], 'actif', now(), now())`);
    await q(`INSERT INTO "SocialReferral" (id, "fromStructureId", "toStructureId", "reasonCodes", "updatedAt") VALUES ('g14r2-r', 'g14r2-a', 'g14r2-b', '{HOUSING}', now())`);
    await expect(pool.query(fs.readFileSync(DOWNS[1], 'utf8'))).rejects.toThrow(/0061_down refused/);
    expect(await state()).toEqual(ALL_UP);
    await q(`DELETE FROM "SocialReferral" WHERE id = 'g14r2-r'`); await q(`DELETE FROM "Structure" WHERE id IN ('g14r2-a', 'g14r2-b')`);
  });

  it('down (newest first): everything is gone, the three rows are forgotten, the earlier ones stay; a second run changes nothing', async () => {
    const before = await rowsOf();
    await down();
    expect(await state()).toEqual(ALL_DOWN);
    expect(await rowsOf()).toEqual(before.slice(0, first()));
    // the code still reads "Aide" through Drizzle without 0060 (the bge-m3 columns are not declared in src/db/schema.ts: raw SQL behind a presence check)
    await expect(drizzle(pool).select().from(Aide).limit(1)).resolves.toEqual([]);
    await down();
    expect(await state()).toEqual(ALL_DOWN);
    expect(await rowsOf()).toEqual(before.slice(0, first()));
  });

  it('up again: exactly 0060, 0061 and 0062 are re-applied', async () => {
    await up();
    expect(await state()).toEqual(ALL_UP);
    expect(await rowsOf()).toEqual(journal.map((e) => String(e.when)));
  });
});
