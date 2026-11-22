/**
 * X05 — migration 0056 (inclusive job board) on a THROWAWAY database of the local cluster: up → down → code without 0056 → up.
 *   up      every migration through drizzle's own migrator: the table, its CHECKs (closed lists, lengths, the https application channel, published ⇒ moderator),
 *           the cascading foreign key to Structure, the indexes; 0056 recorded and the newest; NO listing exists after the migration (nothing seeded); no
 *           applicant table, no column for a discriminatory criterion, no author column
 *   down    drizzle/rollback/0056_down.sql: the table gone, the journal row forgotten, 0055 / 0054 / 0053 and everything else untouched (idempotent; the later 0057 is rolled back first)
 *   without the code on a database behind it: the public list is empty, the employer side says « not available », writes and moderation answer 503
 *           JOBS_NOT_AVAILABLE, the organization closure skips the step
 *   up again only 0056 is applied
 * Synthetic rows only. Skipped without DATABASE_URL (a local cluster where the test role may create a database).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '../../src/db/schema.js';

const hasDatabase = !!process.env.DATABASE_URL;
const NAME = `ada_x05_mig_${Date.now().toString(36)}_test`;
const TAG = '0056_x05_job_board';
const withDb = (url, name) => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
const Z = '00000000-0000-4000-8000-000000000000';
const DESC = 'FIXTURE SYNTHÉTIQUE — description de test pour la migration 0056, assez longue pour la règle.';

describe.skipIf(!hasDatabase)('migration 0056: up → down → code without it → up', () => {
  let admin; let pool; let when; let db;
  const q = async (text, params) => (await pool.query(text, params)).rows;
  const tables = async () => (await q(`SELECT to_regclass('public."JobListing"') IS NOT NULL AS j, to_regclass('public."CommunityStory"') IS NOT NULL AS x01,
    to_regclass('public."Testimonial"') IS NOT NULL AS x02, to_regclass('public."AcademyItem"') IS NOT NULL AS x04`))[0];
  const journalRow = async () => (await q('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations WHERE created_at = $1', [when]))[0].n;
  const up = () => migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  // drizzle re-applies only what is later than the NEWEST recorded migration: the later 0057 (X03) is rolled back first, then 0056
  const down = async () => { for (const f of ['drizzle/rollback/0059_down.sql', 'drizzle/rollback/0058_down.sql', 'drizzle/rollback/0057_down.sql', 'drizzle/rollback/0056_down.sql'].filter((x) => fs.existsSync(x))) await pool.query(fs.readFileSync(f, 'utf8')); };
  const insert = (id, over = {}) => {
    const v = { status: 'draft', title: 'Agent d’accueil', contractType: 'CDI', city: 'Strasbourg', postalCode: '67000', description: DESC, accommodations: ['FLEXIBLE_HOURS'],
      applyMethod: 'url', applyTarget: 'https://employeur.example.test/x', publishedAt: null, moderatedBy: null, ...over };
    return pool.query(`INSERT INTO "JobListing" (id, "structureId", status, title, "contractType", city, "postalCode", description, accommodations, "applyMethod", "applyTarget", "expiresOn", "publishedAt", "moderatedBy", "updatedAt")
      VALUES ($1, 's1', $2, $3, $4, $5, $6, $7, $8, $9, $10, '2099-01-01', $11, $12, NOW())`, [id, v.status, v.title, v.contractType, v.city, v.postalCode, v.description, v.accommodations, v.applyMethod, v.applyTarget, v.publishedAt, v.moderatedBy]);
  };

  beforeAll(async () => {
    when = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries.find((e) => e.tag === TAG).when;
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL }); await admin.connect();
    await admin.query(`CREATE DATABASE ${NAME}`);
    await admin.query(`ALTER DATABASE ${NAME} SET timezone TO 'UTC'`);
    pool = new pg.Pool({ connectionString: withDb(process.env.DATABASE_URL, NAME), max: 3 });
    await pool.query('CREATE EXTENSION IF NOT EXISTS unaccent; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS vector;');
    db = drizzle(pool, { schema });
    await up();
  }, 180000);
  afterAll(async () => {
    await pool?.end().catch(() => {});
    await admin?.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`).catch(() => {});
    await admin?.end().catch(() => {});
  });

  it('up: the table, its CHECKs, the cascading foreign key and the indexes exist; 0056 is the newest recorded; nothing seeded; no applicant or criterion column', async () => {
    expect(await tables()).toEqual({ j: true, x01: true, x02: true, x04: true }); expect(await journalRow()).toBe(1);
    const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
    const at = journal.findIndex((e) => e.tag === TAG);   // X03: 0057 comes after it now
    expect(journal[at]).toMatchObject({ idx: 56, tag: TAG }); expect(journal[at - 1].tag).toBe('0055_x01_community_stories'); expect(when).toBeGreaterThan(journal[at - 1].when);
    expect(await q(`SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = '"JobListing"'::regclass AND contype = 'f'`)).toEqual([{ conname: 'JobListing_structure_fkey', confdeltype: 'c' }]);
    expect((await q(`SELECT conname FROM pg_constraint WHERE conrelid = '"JobListing"'::regclass AND contype = 'c' ORDER BY 1`)).map((r) => r.conname)).toEqual([
      'JobListing_accommodations_check', 'JobListing_apply_check', 'JobListing_contract_check', 'JobListing_length_check', 'JobListing_postal_check',
      'JobListing_published_check', 'JobListing_reason_check', 'JobListing_status_check']);
    expect((await q(`SELECT indexname FROM pg_indexes WHERE tablename = 'JobListing' ORDER BY 1`)).map((r) => r.indexname)).toEqual(['JobListing_pkey', 'JobListing_public_idx', 'JobListing_structure_idx']);
    expect((await q(`SELECT count(*)::int AS n FROM "JobListing"`))[0].n).toBe(0);
    const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'JobListing'`)).map((r) => r.column_name.toLowerCase());
    for (const c of cols) expect(c, c).not.toMatch(/age|sex|gender|origin|nationalit|health|handicap|disab|pregnan|religio|applicant|candidat|author|createdby|email/);
    // the database itself refuses an http channel, an unknown accommodation, a published row without its moderator; deleting the employer deletes its listings
    await pool.query(`INSERT INTO "Structure" (id, nom, slug, services, publics_accueillis, categories_aidees, "updatedAt") VALUES ('s1', 'FIXTURE employeur', 'fixture-employeur', ARRAY['x'], ARRAY['x'], ARRAY['x'], NOW())`);
    await expect(insert('j1', { applyTarget: 'http://employeur.example.test/x' })).rejects.toThrow(/JobListing_apply_check/);
    await expect(insert('j2', { accommodations: ['MASSAGE'] })).rejects.toThrow(/JobListing_accommodations_check/);
    await expect(insert('j3', { accommodations: [] })).rejects.toThrow(/JobListing_accommodations_check/);
    await expect(insert('j4', { status: 'published', publishedAt: new Date() })).rejects.toThrow(/JobListing_published_check/);
    await expect(insert('j5', { postalCode: '6700' })).rejects.toThrow(/JobListing_postal_check/);
    await insert('j6');
    // G13: the application channel may be erased (NULL) only on an ENDED listing
    await expect(insert('j7', { applyTarget: null })).rejects.toThrow(/JobListing_apply_check/);
    await insert('j8', { status: 'withdrawn', applyTarget: null });
    await expect(pool.query(`UPDATE "JobListing" SET "applyTarget" = NULL WHERE id = 'j6'`)).rejects.toThrow(/JobListing_apply_check/);
    await pool.query(`DELETE FROM "Structure" WHERE id = 's1'`);
    expect((await q(`SELECT count(*)::int AS n FROM "JobListing"`))[0].n).toBe(0);
  });

  it('down: the table gone, the journal row forgotten; running it twice is harmless; 0055, 0054, 0053 and Structure untouched', async () => {
    await pool.query(`INSERT INTO "Structure" (id, nom, slug, services, publics_accueillis, categories_aidees, "updatedAt") VALUES ('keep', 'FIXTURE garde', 'fixture-garde', ARRAY['x'], ARRAY['x'], ARRAY['x'], NOW())`);
    await down(); await down();
    expect(await tables()).toEqual({ j: false, x01: true, x02: true, x04: true }); expect(await journalRow()).toBe(0);
    expect((await q(`SELECT id FROM "Structure"`)).map((r) => r.id)).toEqual(['keep']);
  });

  it('the code on a database without 0056: nothing listed, the employer side « not available », writes and moderation 503, closure skips the step', async () => {
    const j = await import('../../api/_services/job-board.js');
    expect(await j.jobBoardSchemaAvailable(db)).toBe(false);
    expect(await j.publicListings({ db })).toEqual([]);
    const e = j.employerListings({ db, audit: async () => {} });
    const ctx = { structureId: 'keep', userId: 'u', role: 'structure_admin' };
    expect(await e.mine(ctx)).toMatchObject({ ok: true, available: false, listings: [] });
    for (const out of [await e.create(ctx, {}), await e.update(ctx, Z, {}), await e.submit(ctx, Z), await e.withdraw(ctx, Z), await e.remove(ctx, Z)]) {
      expect(out).toMatchObject({ ok: false, status: 503, code: 'JOBS_NOT_AVAILABLE' });
    }
    await expect(j.jobModeration({ db }).list('a@example.test', 'pending')).rejects.toMatchObject({ code: 'JOBS_NOT_AVAILABLE', status: 503 });
    await expect(j.jobModeration({ db }).approve('a@example.test', Z)).rejects.toMatchObject({ code: 'JOBS_NOT_AVAILABLE', status: 503 });
    expect(await db.transaction((tx) => j.withdrawForClosedOrganization(tx, 'keep'))).toBe(0);
  });

  it('up again applies 0056 (and the later 0057) only, on the rows as they are', async () => {
    await up();
    expect(await tables()).toEqual({ j: true, x01: true, x02: true, x04: true }); expect(await journalRow()).toBe(1);
    expect((await q(`SELECT id FROM "Structure"`)).map((r) => r.id)).toEqual(['keep']);
  });
});
