/**
 * X01 — migration 0055 (community pseudonyms, stories, reports) on a THROWAWAY database of the local cluster: up → down → code without 0055 → up.
 *   up      every migration through drizzle's own migrator: the three tables, their CHECKs, the four cascading foreign keys, the indexes (pseudonym unique
 *           without regard to case); 0055 recorded; NO member or story row exists after the migration (nothing seeded)
 *   down    drizzle/rollback/0055_down.sql: the three tables gone, the journal row forgotten, 0054 / 0053 and everything else untouched (idempotent; the later 0056 is rolled back first)
 *   without the code on a database behind it: the public list is empty, the person's list says « not available », writes answer 503
 *           STORIES_NOT_AVAILABLE, the moderation answers the same, the export sections are empty (not a failed read)
 *   up again only 0055 is applied
 * Synthetic rows only. Skipped without DATABASE_URL (a local cluster where the test role may create a database).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '../../src/db/schema.js';

const hasDatabase = !!process.env.DATABASE_URL;
const NAME = `ada_x01_mig_${Date.now().toString(36)}_test`;
const TAG = '0055_x01_community_stories';
const withDb = (url, name) => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
const Z = '00000000-0000-4000-8000-000000000000';

describe.skipIf(!hasDatabase)('migration 0055: up → down → code without it → up', () => {
  let admin; let pool; let when; let db;
  const q = async (text, params) => (await pool.query(text, params)).rows;
  const tables = async () => (await q(`SELECT to_regclass('public."CommunityMember"') IS NOT NULL AS m, to_regclass('public."CommunityStory"') IS NOT NULL AS s,
    to_regclass('public."CommunityStoryReport"') IS NOT NULL AS r, to_regclass('public."Testimonial"') IS NOT NULL AS x02, to_regclass('public."AcademyItem"') IS NOT NULL AS x04`))[0];
  const journalRow = async () => (await q('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations WHERE created_at = $1', [when]))[0].n;
  const up = () => migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  // drizzle re-applies only what is later than the NEWEST recorded migration: the later 0056 (X05) is rolled back first, then 0055
  const down = async () => { for (const f of ['drizzle/rollback/0057_down.sql', 'drizzle/rollback/0056_down.sql', 'drizzle/rollback/0055_down.sql'].filter((x) => fs.existsSync(x))) await pool.query(fs.readFileSync(f, 'utf8')); };
  const REL = `('"CommunityMember"'::regclass, '"CommunityStory"'::regclass, '"CommunityStoryReport"'::regclass)`;

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

  it('up: the three tables, the CHECKs, the unique indexes and the cascading foreign keys exist; 0055 is the newest recorded; nothing is seeded', async () => {
    expect(await tables()).toEqual({ m: true, s: true, r: true, x02: true, x04: true }); expect(await journalRow()).toBe(1);
    const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
    const at = journal.findIndex((e) => e.tag === TAG);   // X05: 0056 comes after it now
    expect(journal[at]).toMatchObject({ idx: 55, tag: TAG }); expect(journal[at - 1].tag).toBe('0054_x02_testimonials'); expect(when).toBeGreaterThan(journal[at - 1].when);
    const fks = await q(`SELECT conname, confdeltype FROM pg_constraint WHERE conrelid IN ${REL} AND contype = 'f' ORDER BY 1`);
    expect(fks).toEqual([{ conname: 'CommunityMember_user_fkey', confdeltype: 'c' }, { conname: 'CommunityStoryReport_story_fkey', confdeltype: 'c' },
      { conname: 'CommunityStoryReport_user_fkey', confdeltype: 'c' }, { conname: 'CommunityStory_member_fkey', confdeltype: 'c' }]);
    const checks = (await q(`SELECT conname FROM pg_constraint WHERE conrelid IN ${REL} AND contype = 'c' ORDER BY 1`)).map((r) => r.conname);
    expect(checks).toEqual(['CommunityMember_pseudonym_check', 'CommunityStoryReport_reason_check', 'CommunityStory_lang_check', 'CommunityStory_length_check',
      'CommunityStory_published_check', 'CommunityStory_reason_check', 'CommunityStory_status_check', 'CommunityStory_text_state_check']);
    expect((await q(`SELECT indexdef FROM pg_indexes WHERE indexname = 'CommunityMember_pseudonym_key'`))[0].indexdef).toMatch(/UNIQUE INDEX .* \(lower\(pseudonym\)\)/);
    for (const t of ['CommunityMember', 'CommunityStory', 'CommunityStoryReport']) expect((await q(`SELECT count(*)::int AS n FROM "${t}"`))[0].n, t).toBe(0);
    // the database refuses a duplicate pseudonym in another case, a published story without its moderator, an erased story that keeps its text
    await pool.query(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "updatedAt") VALUES ('u1', 'u1@example.test', 'x', NOW()), ('u2', 'u2@example.test', 'x', NOW())`);
    await pool.query(`INSERT INTO "CommunityMember" (id, "citizenUserId", pseudonym) VALUES ('m1', 'u1', 'Lune')`);
    await expect(pool.query(`INSERT INTO "CommunityMember" (id, "citizenUserId", pseudonym) VALUES ('m2', 'u2', 'LUNE')`)).rejects.toThrow(/CommunityMember_pseudonym_key/);
    const text = 'FIXTURE SYNTHÉTIQUE — texte de test pour la migration 0055, assez long pour la règle.';
    await expect(pool.query(`INSERT INTO "CommunityStory" (id, "memberId", status, title, body, lang, "consentVersion", "publishedAt", "updatedAt") VALUES ('s1', 'm1', 'published', 'Titre', $1, 'fr', 'v', NOW(), NOW())`, [text])).rejects.toThrow(/CommunityStory_published_check/);
    await expect(pool.query(`INSERT INTO "CommunityStory" (id, "memberId", status, title, body, lang, "consentVersion", "updatedAt") VALUES ('s2', 'm1', 'withdrawn', 'Titre', $1, 'fr', 'v', NOW())`, [text])).rejects.toThrow(/CommunityStory_text_state_check/);
    // deleting the account takes the pseudonym and its stories with it
    await pool.query(`INSERT INTO "CommunityStory" (id, "memberId", status, title, body, lang, "consentVersion", "updatedAt") VALUES ('s3', 'm1', 'pending', 'Titre', $1, 'fr', 'v', NOW())`, [text]);
    await pool.query(`DELETE FROM "CitizenUser" WHERE id IN ('u1', 'u2')`);
    expect((await q(`SELECT (SELECT count(*) FROM "CommunityMember")::int AS m, (SELECT count(*) FROM "CommunityStory")::int AS s`))[0]).toEqual({ m: 0, s: 0 });
  });

  it('down: the three tables gone, the journal row forgotten; running it twice is harmless; 0054, 0053 and CitizenUser untouched', async () => {
    await pool.query(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "updatedAt") VALUES ('keep', 'keep@example.test', 'x', NOW())`);
    await down(); await down();
    expect(await tables()).toEqual({ m: false, s: false, r: false, x02: true, x04: true }); expect(await journalRow()).toBe(0);
    expect((await q(`SELECT id FROM "CitizenUser"`)).map((r) => r.id)).toEqual(['keep']);
  });

  it('the code on a database without 0055: nothing listed, writes 503, moderation 503, export sections empty and complete', async () => {
    const c = await import('../../api/_services/community-stories.js');
    expect(await c.communitySchemaAvailable(db)).toBe(false);
    expect(await c.publicStories({ db })).toEqual([]);
    const s = c.citizenStories({ db, isAdult: async () => true });
    expect(await s.mine('keep')).toMatchObject({ ok: true, available: false, member: null, stories: [] });
    expect(await s.join({ id: 'keep', email: 'keep@example.test' }, { pseudonym: 'Lune' })).toMatchObject({ ok: false, status: 503, code: 'STORIES_NOT_AVAILABLE' });
    expect(await s.submit({ id: 'keep' }, { consent: true, consentVersion: c.STORY_CONSENT_VERSION })).toMatchObject({ status: 503, code: 'STORIES_NOT_AVAILABLE' });
    expect(await s.withdraw('keep', Z)).toMatchObject({ status: 503 });
    expect(await s.leave('keep')).toMatchObject({ status: 503 });
    expect(await s.report('keep', Z, 'OFFENSIVE')).toMatchObject({ status: 503 });
    await expect(c.storyModeration({ db }).list('a@example.test', 'pending')).rejects.toMatchObject({ code: 'STORIES_NOT_AVAILABLE', status: 503 });
    const { accountLinkedSections } = await import('../../api/_services/export-account-sections.js');
    let failed = 0;
    const rows = async (query) => { try { return (await db.execute(query)).rows; } catch { failed += 1; return []; } };
    const ev = await import('../../api/_services/academy-events.js');
    const tm = await import('../../api/_services/testimonials.js');
    const out = await accountLinkedSections('keep', rows, { hasEventTables: () => ev.academySchemaAvailable(db), hasTestimonialTables: () => tm.testimonialsSchemaAvailable(db),
      hasCommunityTables: () => c.communitySchemaAvailable(db),
      // X03: the later 0057 is rolled back too here — its sections are asked of THIS database
      hasEntraideTables: async () => (await import('../../api/_services/entraide.js')).entraideSchemaAvailable(db) });
    expect(out.communityMember).toEqual([]); expect(out.communityStories).toEqual([]); expect(out.communityStoryReports).toEqual([]); expect(failed).toBe(0);
  });

  it('up again applies 0055 (and the later 0056) only, on the rows as they are', async () => {
    await up();
    expect(await tables()).toEqual({ m: true, s: true, r: true, x02: true, x04: true }); expect(await journalRow()).toBe(1);
    expect((await q(`SELECT id FROM "CitizenUser"`)).map((r) => r.id)).toEqual(['keep']);
  });
});
