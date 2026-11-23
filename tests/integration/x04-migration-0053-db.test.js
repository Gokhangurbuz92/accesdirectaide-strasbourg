/**
 * X04 — migration 0053 (academy pages, events, registrations) on a THROWAWAY database of the local cluster: up → down → code without 0053 → up.
 *   up      every migration through drizzle's own migrator: the two tables, their CHECKs, the two cascading foreign keys, the indexes; 0053 recorded
 *   down    drizzle/rollback/0053_down.sql: both tables gone, the journal row forgotten, nothing else touched (idempotent)
 *   without the code on a database behind it: the public lists are empty, a registration answers 503 ACADEMY_NOT_AVAILABLE, the export section is
 *           empty (not a failed read), the notification centre has no event item, the editorial answers ACADEMY_NOT_AVAILABLE
 *   up again only 0053 is applied
 * Synthetic rows only. Skipped without DATABASE_URL (a local cluster where the test role may create a database).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '../../src/db/schema.js';

const hasDatabase = !!process.env.DATABASE_URL;
const NAME = `ada_x04_mig_${Date.now().toString(36)}_test`;
const TAG = '0053_x04_academy_events';
const withDb = (url, name) => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };

describe.skipIf(!hasDatabase)('migration 0053: up → down → code without it → up', () => {
  let admin; let pool; let when; let db;
  const q = async (text, params) => (await pool.query(text, params)).rows;
  const tables = async () => (await q(`SELECT to_regclass('public."AcademyItem"') IS NOT NULL AS a, to_regclass('public."EventRegistration"') IS NOT NULL AS r`))[0];
  const journalRow = async () => (await q('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations WHERE created_at = $1', [when]))[0].n;
  const up = () => migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  // drizzle re-applies only what is later than the NEWEST recorded migration: the later 0055 (X01) and 0054 (X02) are rolled back first, then 0053
  const down = async () => { for (const f of ['drizzle/rollback/0062_down.sql', 'drizzle/rollback/0061_down.sql', 'drizzle/rollback/0060_down.sql', 'drizzle/rollback/0059_down.sql', 'drizzle/rollback/0058_down.sql', 'drizzle/rollback/0057_down.sql', 'drizzle/rollback/0056_down.sql', 'drizzle/rollback/0055_down.sql', 'drizzle/rollback/0054_down.sql', 'drizzle/rollback/0053_down.sql'].filter((x) => fs.existsSync(x))) await pool.query(fs.readFileSync(f, 'utf8')); };

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

  it('up: both tables, the CHECKs and the cascading foreign keys exist; 0053 is recorded', async () => {
    expect(await tables()).toEqual({ a: true, r: true }); expect(await journalRow()).toBe(1);
    const fks = await q(`SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = '"EventRegistration"'::regclass AND contype = 'f' ORDER BY 1`);
    expect(fks).toEqual([{ conname: 'EventRegistration_item_fkey', confdeltype: 'c' }, { conname: 'EventRegistration_user_fkey', confdeltype: 'c' }]);
    const checks = (await q(`SELECT conname FROM pg_constraint WHERE conrelid IN ('"EventRegistration"'::regclass, '"AcademyItem"'::regclass) AND contype = 'c' ORDER BY 1`)).map((r) => r.conname);
    expect(checks).toEqual(['AcademyItem_capacity_check', 'AcademyItem_dates_check', 'AcademyItem_event_check', 'AcademyItem_kind_check', 'AcademyItem_published_check', 'AcademyItem_status_check',
      'EventRegistration_need_check', 'EventRegistration_need_state_check', 'EventRegistration_status_check']);
    // a published event without a venue or capacity, or a published item without its approver, is refused by the database itself
    await expect(pool.query(`INSERT INTO "AcademyItem" (id, kind, status, slug, title, "createdBy", "updatedBy", "updatedAt", "publishedAt", "approvedBy") VALUES ('e1', 'EVENT', 'published', 'e1', 'T', 'a', 'a', NOW(), NOW(), 'b')`)).rejects.toThrow(/AcademyItem_event_check/);
    await expect(pool.query(`INSERT INTO "AcademyItem" (id, kind, status, slug, title, "createdBy", "updatedBy", "updatedAt") VALUES ('l1', 'LESSON', 'published', 'l1', 'T', 'a', 'a', NOW())`)).rejects.toThrow(/AcademyItem_published_check/);
  });

  it('down: both tables gone, the journal row forgotten; running it twice is harmless; CitizenUser untouched', async () => {
    await pool.query(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "updatedAt") VALUES ('keep', 'keep@example.test', 'x', NOW())`);
    await down(); await down();
    expect(await tables()).toEqual({ a: false, r: false }); expect(await journalRow()).toBe(0);
    expect((await q(`SELECT id FROM "CitizenUser"`)).map((r) => r.id)).toEqual(['keep']);
  });

  it('the code on a database without 0053: nothing listed, writes 503, export empty and complete, no event notice', async () => {
    const ev = await import('../../api/_services/academy-events.js');
    expect(await ev.academySchemaAvailable(db)).toBe(false);
    expect(await ev.publicList('EVENT', { db })).toEqual([]); expect(await ev.publicList('LESSON', { db })).toEqual([]);
    expect(await ev.publicDetail('un-evenement', { db })).toBeNull();
    const reg = ev.eventRegistrations({ db, isAdult: async () => true });
    expect(await reg.register('keep', { itemId: '00000000-0000-4000-8000-000000000000' })).toMatchObject({ ok: false, status: 503, code: 'ACADEMY_NOT_AVAILABLE' });
    expect(await reg.mine('keep')).toMatchObject({ ok: true, available: false, registrations: [] });
    await expect(ev.academyEditorial({ db }).list()).rejects.toMatchObject({ code: 'ACADEMY_NOT_AVAILABLE', status: 503 });
    expect(await ev.eventInboxItems('keep', { db })).toEqual([]);
    const { accountLinkedSections } = await import('../../api/_services/export-account-sections.js');
    let failed = 0;
    const rows = async (query) => { try { return (await db.execute(query)).rows; } catch { failed += 1; return []; } };
    // X02: the later 0054 is rolled back too here — its sections are asked of THIS database, not of the default one
    const tm = await import('../../api/_services/testimonials.js');
    const cs = await import('../../api/_services/community-stories.js');   // X01: the later 0055 too
    const out = await accountLinkedSections('keep', rows, { hasModerationTables: async () => (await import('../../api/_services/moderation-dsa.js')).moderationSchemaAvailable(db), hasEventTables: () => ev.academySchemaAvailable(db), hasTestimonialTables: () => tm.testimonialsSchemaAvailable(db),
      hasCommunityTables: () => cs.communitySchemaAvailable(db),
      // X03: the later 0057 is rolled back too here — its sections are asked of THIS database
      hasEntraideTables: async () => (await import('../../api/_services/entraide.js')).entraideSchemaAvailable(db) });
    expect(out.eventRegistrations).toEqual([]); expect(failed).toBe(0);
  });

  it('up again applies 0053 (and the later 0054, 0055) only, on the rows as they are', async () => {
    await up();
    expect(await tables()).toEqual({ a: true, r: true }); expect(await journalRow()).toBe(1);
    expect((await q(`SELECT id FROM "CitizenUser"`)).map((r) => r.id)).toEqual(['keep']);
  });
});
