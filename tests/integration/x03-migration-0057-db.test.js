/**
 * X03 — migration 0057 (Entraide) on a THROWAWAY database of the local cluster: up → down → code without 0057 → up.
 *   up      every migration through drizzle's own migrator: the six tables, their CHECKs (closed categories / areas / reasons, note limits, suspension needs a
 *           reason, no self-report or self-block, e-mail shape), the ten cascading foreign keys, the indexes (pseudonym unique without regard to case, one
 *           active request per offer and person); 0057 recorded and the newest; NOTHING seeded; no address / position / score / message column; deleting the
 *           account deletes everything under it
 *   down    drizzle/rollback/0057_down.sql: the six tables gone, the journal row forgotten, 0056 / 0055 / 0054 / 0053 and everything else untouched (idempotent)
 *   without the code on a database behind it: the member side says « not available », browse and every write answer 503 ENTRAIDE_NOT_AVAILABLE, the
 *           moderation answers the same, the export sections are empty (not a failed read)
 *   up again only 0057 is applied
 * Synthetic rows only. Skipped without DATABASE_URL (a local cluster where the test role may create a database).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '../../src/db/schema.js';

const hasDatabase = !!process.env.DATABASE_URL;
const NAME = `ada_x03_mig_${Date.now().toString(36)}_test`;
const TAG = '0057_x03_entraide';
const withDb = (url, name) => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
const Z = '00000000-0000-4000-8000-000000000000';
const TABLES = ['EntraideMember', 'EntraideOffer', 'EntraideRequest', 'EntraideContactShare', 'EntraideReport', 'EntraideBlock'];

describe.skipIf(!hasDatabase)('migration 0057: up → down → code without it → up', () => {
  let admin; let pool; let when; let db;
  const q = async (text, params) => (await pool.query(text, params)).rows;
  const tables = async () => (await q(`SELECT ${TABLES.map((t, i) => `to_regclass('public."${t}"') IS NOT NULL AS t${i}`).join(', ')}, to_regclass('public."JobListing"') IS NOT NULL AS x05,
    to_regclass('public."CommunityStory"') IS NOT NULL AS x01`))[0];
  const ALL_UP = { t0: true, t1: true, t2: true, t3: true, t4: true, t5: true, x05: true, x01: true };
  const ALL_DOWN = { t0: false, t1: false, t2: false, t3: false, t4: false, t5: false, x05: true, x01: true };
  const journalRow = async () => (await q('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations WHERE created_at = $1', [when]))[0].n;
  const up = () => migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  const down = async () => { for (const f of ['drizzle/rollback/0059_down.sql', 'drizzle/rollback/0058_down.sql', 'drizzle/rollback/0057_down.sql']) await pool.query(fs.readFileSync(f, 'utf8')); };   // G13: 0058 is newer and is rolled back first
  const REL = `(${TABLES.map((t) => `'"${t}"'::regclass`).join(', ')})`;

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

  it('up: six tables, CHECKs, ten cascading foreign keys, the indexes; 0057 is the newest recorded; nothing seeded; no address, position, score or message column', async () => {
    expect(await tables()).toEqual(ALL_UP); expect(await journalRow()).toBe(1);
    const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
    const at = journal.findIndex((e) => e.tag === TAG);   // G13: 0058 (sole administrator) follows 0057
    expect(journal[at]).toMatchObject({ idx: 57, tag: TAG }); expect(journal[at - 1].tag).toBe('0056_x05_job_board'); expect(when).toBeGreaterThan(journal[at - 1].when);
    expect(journal.slice(at + 1).map((e) => e.tag)).toEqual(['0058_g12_sole_admin_checks', '0059_g14_moderation_dsa']);   // G14: 0059 (moderation, DSA) follows
    const fks = await q(`SELECT conname, confdeltype FROM pg_constraint WHERE conrelid IN ${REL} AND contype = 'f' ORDER BY 1`);
    expect(fks).toHaveLength(10); for (const f of fks) expect(f.confdeltype, f.conname).toBe('c');
    expect((await q(`SELECT conname FROM pg_constraint WHERE conrelid IN ${REL} AND contype = 'c' ORDER BY 1`)).map((r) => r.conname)).toEqual([
      'EntraideBlock_self_check', 'EntraideContactShare_email_check', 'EntraideMember_pseudonym_check', 'EntraideMember_status_check', 'EntraideOffer_area_check',
      'EntraideOffer_category_check', 'EntraideOffer_note_check', 'EntraideOffer_status_check', 'EntraideReport_reason_check', 'EntraideReport_self_check',
      'EntraideRequest_note_check', 'EntraideRequest_status_check']);
    const idx = (await q(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename LIKE 'Entraide%' ORDER BY 1`));
    expect(idx.find((i) => i.indexname === 'EntraideMember_pseudonym_key').indexdef).toMatch(/UNIQUE INDEX .* \(lower\(pseudonym\)\)/);
    expect(idx.find((i) => i.indexname === 'EntraideRequest_active_key').indexdef).toMatch(/UNIQUE INDEX .*WHERE \(status = ANY/);
    for (const t of TABLES) expect((await q(`SELECT count(*)::int AS n FROM "${t}"`))[0].n, t).toBe(0);
    const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'Entraide%'`)).map((r) => r.column_name.toLowerCase());
    for (const c of cols) expect(c, c).not.toMatch(/address|adresse|street|postal|lat|lng|longitude|geo|score|rank|match|message|body|health|handicap|disab|religio|ethni|sexu/);
    // the account's deletion takes the member and everything under it
    await pool.query(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "updatedAt") VALUES ('gone', 'gone@example.test', 'x', NOW())`);
    await pool.query(`INSERT INTO "EntraideMember" (id, "citizenUserId", pseudonym, "charterVersion", "charterAcceptedAt", "updatedAt") VALUES ('m1', 'gone', 'FixtureMig', 'v', NOW(), NOW())`);
    await pool.query(`INSERT INTO "EntraideOffer" (id, "memberId", category, area, "updatedAt") VALUES ('o1', 'm1', 'SHOPPING', 'OSTWALD', NOW())`);
    await expect(pool.query(`INSERT INTO "EntraideOffer" (id, "memberId", category, area, "updatedAt") VALUES ('o2', 'm1', 'MENTAL_HEALTH', 'OSTWALD', NOW())`)).rejects.toThrow(/EntraideOffer_category_check/);
    await expect(pool.query(`INSERT INTO "EntraideMember" (id, "citizenUserId", pseudonym, "charterVersion", "charterAcceptedAt", "updatedAt") VALUES ('m2', 'gone', 'fixturemig', 'v', NOW(), NOW())`)).rejects.toThrow(/EntraideMember_(user|pseudonym)_key/);
    await pool.query(`DELETE FROM "CitizenUser" WHERE id = 'gone'`);
    for (const t of TABLES) expect((await q(`SELECT count(*)::int AS n FROM "${t}"`))[0].n, t).toBe(0);
  });

  it('down: the six tables gone, the journal row forgotten; running it twice is harmless; 0056, 0055 and CitizenUser untouched', async () => {
    await pool.query(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "updatedAt") VALUES ('keep', 'keep@example.test', 'x', NOW())`);
    await down(); await down();
    expect(await tables()).toEqual(ALL_DOWN); expect(await journalRow()).toBe(0);
    expect((await q(`SELECT id FROM "CitizenUser"`)).map((r) => r.id)).toEqual(['keep']);
  });

  it('the code on a database without 0057: « not available », browse / writes / moderation 503, empty export sections (not a failed read)', async () => {
    const e = await import('../../api/_services/entraide.js');
    expect(await e.entraideSchemaAvailable(db)).toBe(false);
    const s = e.citizenEntraide({ db, isAdult: async () => true });
    expect(await s.mine('keep')).toMatchObject({ ok: true, available: false, member: null, offers: [], sent: [], received: [], blocks: [] });
    const citizen = { id: 'keep', email: 'keep@example.test' };
    for (const out of [await s.browse('keep'), await s.join(citizen, { pseudonym: 'Lune', charter: true, charterVersion: e.CHARTER_VERSION }), await s.offerCreate(citizen, {}),
      await s.requestCreate(citizen, { offerId: Z }), await s.contactShare(citizen, { requestId: Z }), await s.report(citizen, { offerId: Z, reason: 'SPAM' }),
      await s.block('keep', { offerId: Z }), await s.leave('keep')]) {
      expect(out).toMatchObject({ ok: false, status: 503, code: 'ENTRAIDE_NOT_AVAILABLE' });
    }
    await expect(e.entraideModeration({ db }).list('a@example.test', 'reported')).rejects.toMatchObject({ code: 'ENTRAIDE_NOT_AVAILABLE', status: 503 });
    await expect(e.entraideModeration({ db }).suspend('a@example.test', 'Lune', 'SPAM')).rejects.toMatchObject({ code: 'ENTRAIDE_NOT_AVAILABLE', status: 503 });
    const { accountLinkedSections } = await import('../../api/_services/export-account-sections.js');
    let failed = 0;
    const rows = async (query) => { try { return (await db.execute(query)).rows; } catch { failed += 1; return []; } };
    const out = await accountLinkedSections('keep', rows, { hasModerationTables: async () => (await import('../../api/_services/moderation-dsa.js')).moderationSchemaAvailable(db), hasEntraideTables: () => e.entraideSchemaAvailable(db) });
    for (const k of ['entraideMember', 'entraideOffers', 'entraideRequests', 'entraideRequestsReceived', 'entraideContactShares', 'entraideReports', 'entraideBlocks']) expect(out[k], k).toEqual([]);
    expect(failed).toBe(0);
  });

  it('up again applies 0057 only, on the rows as they are', async () => {
    await up();
    expect(await tables()).toEqual(ALL_UP); expect(await journalRow()).toBe(1);
    expect((await q(`SELECT id FROM "CitizenUser"`)).map((r) => r.id)).toEqual(['keep']);
  });
});
