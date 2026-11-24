/**
 * X02 — migration 0054 (testimonials, reports) on a THROWAWAY database of the local cluster: up → down → code without 0054 → up.
 *   up      every migration through drizzle's own migrator: the two tables, their CHECKs, the three cascading foreign keys, the indexes; 0054 recorded;
 *           NO testimonial row exists after the migration (nothing seeded)
 *   down    drizzle/rollback/0054_down.sql: both tables gone, the journal row forgotten, 0053 and everything else untouched (idempotent)
 *   without the code on a database behind it: the public list is empty, the person's list says « not available », writes answer 503
 *           TESTIMONIALS_NOT_AVAILABLE, the moderation answers the same, the export sections are empty (not a failed read)
 *   up again only 0054 is applied
 * Synthetic rows only. Skipped without DATABASE_URL (a local cluster where the test role may create a database).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '../../src/db/schema.js';

const hasDatabase = !!process.env.DATABASE_URL;
const NAME = `ada_x02_mig_${Date.now().toString(36)}_test`;
const TAG = '0054_x02_testimonials';
const withDb = (url, name) => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };

describe.skipIf(!hasDatabase)('migration 0054: up → down → code without it → up', () => {
  let admin; let pool; let when; let db;
  const q = async (text, params) => (await pool.query(text, params)).rows;
  const tables = async () => (await q(`SELECT to_regclass('public."Testimonial"') IS NOT NULL AS t, to_regclass('public."TestimonialReport"') IS NOT NULL AS r, to_regclass('public."AcademyItem"') IS NOT NULL AS x04`))[0];
  const journalRow = async () => (await q('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations WHERE created_at = $1', [when]))[0].n;
  const up = () => migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  // drizzle re-applies only what is later than the NEWEST recorded migration: the later 0055 (X01) is rolled back first, then 0054
  const down = async () => { for (const f of ['drizzle/rollback/0064_down.sql', 'drizzle/rollback/0063_down.sql', 'drizzle/rollback/0062_down.sql', 'drizzle/rollback/0061_down.sql', 'drizzle/rollback/0060_down.sql', 'drizzle/rollback/0059_down.sql', 'drizzle/rollback/0058_down.sql', 'drizzle/rollback/0057_down.sql', 'drizzle/rollback/0056_down.sql', 'drizzle/rollback/0055_down.sql', 'drizzle/rollback/0054_down.sql'].filter((x) => fs.existsSync(x))) await pool.query(fs.readFileSync(f, 'utf8')); };

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

  it('up: both tables, the CHECKs, the partial unique index and the cascading foreign keys exist; 0054 is recorded; nothing is seeded', async () => {
    expect(await tables()).toEqual({ t: true, r: true, x04: true }); expect(await journalRow()).toBe(1);
    const fks = await q(`SELECT conname, confdeltype FROM pg_constraint WHERE conrelid IN ('"Testimonial"'::regclass, '"TestimonialReport"'::regclass) AND contype = 'f' ORDER BY 1`);
    expect(fks).toEqual([{ conname: 'TestimonialReport_testimonial_fkey', confdeltype: 'c' }, { conname: 'TestimonialReport_user_fkey', confdeltype: 'c' }, { conname: 'Testimonial_user_fkey', confdeltype: 'c' }]);
    const checks = (await q(`SELECT conname FROM pg_constraint WHERE conrelid IN ('"Testimonial"'::regclass, '"TestimonialReport"'::regclass) AND contype = 'c' ORDER BY 1`)).map((r) => r.conname);
    expect(checks).toEqual(['TestimonialReport_reason_check', 'Testimonial_lang_check', 'Testimonial_length_check', 'Testimonial_published_check', 'Testimonial_reason_check',
      'Testimonial_status_check', 'Testimonial_text_state_check']);
    expect((await q(`SELECT indexdef FROM pg_indexes WHERE indexname = 'Testimonial_active_user_key'`))[0].indexdef).toMatch(/UNIQUE INDEX .* WHERE \(status = ANY/);
    expect((await q('SELECT count(*)::int AS n FROM "Testimonial"'))[0].n).toBe(0);
    // a published testimonial without its moderator, or a withdrawn one that keeps its text, is refused by the database itself
    await pool.query(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "updatedAt") VALUES ('u1', 'u1@example.test', 'x', NOW())`);
    const text = 'FIXTURE SYNTHÉTIQUE — texte de test pour la migration 0054.';
    await expect(pool.query(`INSERT INTO "Testimonial" (id, "citizenUserId", status, "displayName", body, lang, "consentVersion", "publishedAt", "updatedAt") VALUES ('t1', 'u1', 'published', 'Fx', $1, 'fr', 'v', NOW(), NOW())`, [text])).rejects.toThrow(/Testimonial_published_check/);
    await expect(pool.query(`INSERT INTO "Testimonial" (id, "citizenUserId", status, "displayName", body, lang, "consentVersion", "updatedAt") VALUES ('t2', 'u1', 'withdrawn', 'Fx', $1, 'fr', 'v', NOW())`, [text])).rejects.toThrow(/Testimonial_text_state_check/);
    await pool.query(`DELETE FROM "CitizenUser" WHERE id = 'u1'`);
  });

  it('down: both tables gone, the journal row forgotten; running it twice is harmless; 0053 and CitizenUser untouched', async () => {
    await pool.query(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "updatedAt") VALUES ('keep', 'keep@example.test', 'x', NOW())`);
    await down(); await down();
    expect(await tables()).toEqual({ t: false, r: false, x04: true }); expect(await journalRow()).toBe(0);
    expect((await q(`SELECT id FROM "CitizenUser"`)).map((r) => r.id)).toEqual(['keep']);
  });

  it('the code on a database without 0054: nothing listed, writes 503, moderation 503, export sections empty and complete', async () => {
    const t = await import('../../api/_services/testimonials.js');
    expect(await t.testimonialsSchemaAvailable(db)).toBe(false);
    expect(await t.publicTestimonials({ db })).toEqual([]);
    const c = t.citizenTestimonials({ db, isAdult: async () => true });
    expect(await c.mine('keep')).toMatchObject({ ok: true, available: false, testimonials: [] });
    expect(await c.submit({ id: 'keep' }, { consent: true, consentVersion: t.TESTIMONIAL_CONSENT_VERSION })).toMatchObject({ ok: false, status: 503, code: 'TESTIMONIALS_NOT_AVAILABLE' });
    expect(await c.withdraw('keep', '00000000-0000-4000-8000-000000000000')).toMatchObject({ status: 503 });
    expect(await c.report('keep', '00000000-0000-4000-8000-000000000000', 'OFFENSIVE')).toMatchObject({ status: 503 });
    await expect(t.testimonialModeration({ db }).list('a@example.test', 'pending')).rejects.toMatchObject({ code: 'TESTIMONIALS_NOT_AVAILABLE', status: 503 });
    const { accountLinkedSections } = await import('../../api/_services/export-account-sections.js');
    let failed = 0;
    const rows = async (query) => { try { return (await db.execute(query)).rows; } catch { failed += 1; return []; } };
    const ev = await import('../../api/_services/academy-events.js');
    // X01: the later 0055 is rolled back too here — its sections are asked of THIS database, not of the default one
    const cs = await import('../../api/_services/community-stories.js');
    const out = await accountLinkedSections('keep', rows, { hasLegalProtectionTable: async () => (await import('../../api/_services/legal-protection.js')).legalProtectionInstalled(db), hasModerationTables: async () => (await import('../../api/_services/moderation-dsa.js')).moderationSchemaAvailable(db), hasEventTables: () => ev.academySchemaAvailable(db), hasTestimonialTables: () => t.testimonialsSchemaAvailable(db),
      hasCommunityTables: () => cs.communitySchemaAvailable(db),
      // X03: the later 0057 is rolled back too here — its sections are asked of THIS database
      hasEntraideTables: async () => (await import('../../api/_services/entraide.js')).entraideSchemaAvailable(db),
      // G14-PS: the later 0061 is rolled back too here — its section is asked of THIS database
      hasSocialReferralTables: async () => { const sr = await import('../../api/_services/social-referrals.js'); sr.forgetSocialReferralSchema(db); return sr.socialReferralsAvailable(db); } });
    expect(out.testimonials).toEqual([]); expect(out.testimonialReports).toEqual([]); expect(failed).toBe(0);
  });

  it('up again applies 0054 (and the later 0055) only, on the rows as they are', async () => {
    await up();
    expect(await tables()).toEqual({ t: true, r: true, x04: true }); expect(await journalRow()).toBe(1);
    expect((await q(`SELECT id FROM "CitizenUser"`)).map((r) => r.id)).toEqual(['keep']);
  });
});
