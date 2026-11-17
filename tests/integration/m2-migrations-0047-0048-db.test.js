/**
 * M2 — migrations 0047 (referral redirect, follow-up notice, « référent de parcours ») and 0048 (history of the referral texts) on a THROWAWAY database of
 * the local cluster: up → down → up.
 *   up      every migration through drizzle's own migrator; existing-style rows (no new column named) are accepted, the new columns are NULL
 *   down    drizzle/rollback/0047_down.sql: the two tables and the three columns are gone, a REDIRECT_SUGGESTED decline becomes OTHER, the referral and its
 *           history stay, the migration's journal row is forgotten (otherwise a later run would skip 0047 silently)
 *   up      the migrator applies 0047 and 0048 again (and only them); the files are idempotent (run a second time by hand: same schema, same rows)
 *   0048    the texts that existed become the first rows of the history (the ciphertext copied as it is); the table is append-only except for re-sealing;
 *           its rollback (run BEFORE 0047's: drizzle only re-applies what is later than the newest recorded migration) drops the history and keeps the two
 *           current texts of "Referral"
 * Synthetic rows only. Skipped without DATABASE_URL (a local cluster where the test role may create a database).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const hasDatabase = !!process.env.DATABASE_URL;
const NAME = `ada_m2_mig_${Date.now().toString(36)}_test`;
const TAG = '0047_m2_referral_redirect_referent';
const TAG48 = '0048_m2_referral_message_history';
const withDb = (url, name) => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
/** the migrations recorded after 0048 (0049 …): drizzle re-applies only what is later than the newest recorded row, so they are rolled back first, newest first */
const laterThan48 = () => JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries.filter((e) => e.idx > 48).reverse();
const statements = (file) => fs.readFileSync(file, 'utf8').split('--> statement-breakpoint').map((x) => x.trim()).filter(Boolean);

describe.skipIf(!hasDatabase)('migrations 0047 and 0048: up → down → up on a throwaway database', () => {
  let admin; let pool; let when; let when48;
  const q = async (text, params) => (await pool.query(text, params)).rows;
  const columns = async () => (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Referral' AND column_name IN ('previousReferralId', 'suggestedStructureId', 'followUpNotifiedAt') ORDER BY 1`)).map((r) => r.column_name);
  const tables = async () => (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('DossierReferent', 'DossierReferentEvent') ORDER BY 1`)).map((r) => r.table_name);
  const responseCheck = async () => (await q(`SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid WHERE t.relname = 'Referral' AND c.conname = 'Referral_response_check'`))[0].def;
  const journalRow = async (w = when) => (await q('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations WHERE created_at = $1', [w]))[0].n;
  const history = async () => q(`SELECT id, "referralId", side, "bodyEncrypted" FROM "ReferralMessage" ORDER BY id`);
  const hasHistory = async () => (await q(`SELECT to_regclass('public."ReferralMessage"') IS NOT NULL AS e`))[0].e;
  const up = () => migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  const org = (id) => pool.query(`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
    VALUES ($1, $2, $1, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`, [id, `Org test ${id}`]);

  beforeAll(async () => {
    const entries = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
    when = entries.find((e) => e.tag === TAG).when; when48 = entries.find((e) => e.tag === TAG48).when;
    expect(when48).toBeGreaterThan(when);
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL }); await admin.connect();
    await admin.query(`CREATE DATABASE ${NAME}`);
    await admin.query(`ALTER DATABASE ${NAME} SET timezone TO 'UTC'`);
    pool = new pg.Pool({ connectionString: withDb(process.env.DATABASE_URL, NAME), max: 2 });
    await pool.query('CREATE EXTENSION IF NOT EXISTS unaccent; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS vector;');
    await up();
    for (const id of ['mig-X', 'mig-Y', 'mig-Z']) await org(id);
    await pool.query(`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "updatedAt") VALUES ('mig-pro', 'mig-pro@example.test', 'x', 'PRO', 'active', 'mig-X', NOW())`);
    await pool.query(`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType") VALUES ('mig-dos', NOW() + interval '30 days', '{}'::jsonb, '{}'::jsonb, 0, 'h', 't', 'GUEST_SHARE')`);
    await pool.query(`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", "grantedVia") VALUES ('mig-g', 'mig-dos', 'mig-Y', 'mig-pro', 'referral')`);
  }, 180000);
  afterAll(async () => {
    await pool?.end().catch(() => {});
    await admin?.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`).catch(() => {});
    await admin?.end().catch(() => {});
  });

  it('up: the columns, the tables, the CHECKs and the append-only trigger exist; a row written as before 0047 is accepted with NULLs', async () => {
    expect(await columns()).toEqual(['followUpNotifiedAt', 'previousReferralId', 'suggestedStructureId']);
    expect(await tables()).toEqual(['DossierReferent', 'DossierReferentEvent']);
    expect(await responseCheck()).toContain('REDIRECT_SUGGESTED');
    expect(await journalRow()).toBe(1);
    // the statement the code of the previous release sends: no new column is named
    await pool.query(`INSERT INTO "Referral" (id, "sharedDiagnosticId", "fromStructureId", "toStructureId", status, "reasonCode", "updatedAt") VALUES ('mig-old', 'mig-dos', 'mig-X', 'mig-Z', 'PENDING_CITIZEN', 'HOUSING', NOW())`);
    expect((await q(`SELECT "previousReferralId", "suggestedStructureId", "followUpNotifiedAt" FROM "Referral" WHERE id = 'mig-old'`))[0]).toEqual({ previousReferralId: null, suggestedStructureId: null, followUpNotifiedAt: null });
    // rows of the new features
    await pool.query(`INSERT INTO "Referral" (id, "sharedDiagnosticId", "fromStructureId", "toStructureId", status, "reasonCode", "responseCode", "suggestedStructureId", "citizenDecisionAt", "grantId", "respondedAt", "updatedAt")
      VALUES ('mig-a', 'mig-dos', 'mig-X', 'mig-Y', 'DECLINED', 'HOUSING', 'REDIRECT_SUGGESTED', 'mig-Z', NOW(), 'mig-g', NOW(), NOW())`);
    await pool.query(`UPDATE "Referral" SET "previousReferralId" = 'mig-a' WHERE id = 'mig-old'`);
    await pool.query(`INSERT INTO "ReferralEvent" (id, "referralId", "actorType", "fromStatus", "toStatus") VALUES ('mig-ev', 'mig-a', 'RECEIVER', 'SENT', 'DECLINED')`);
    await pool.query(`INSERT INTO "DossierReferent" (id, "sharedDiagnosticId", "structureId", "proUserId", "displayName", status, "displayNameConsentAt", "updatedAt") VALUES ('mig-ref', 'mig-dos', 'mig-X', 'mig-pro', 'Camille (test)', 'PROPOSED', NOW(), NOW())`);
    await pool.query(`INSERT INTO "DossierReferentEvent" (id, "referentId", "actorType", "toStatus") VALUES ('mig-ref-ev', 'mig-ref', 'PROFESSIONAL', 'PROPOSED')`);
    // the database's own rules
    await expect(pool.query(`UPDATE "DossierReferentEvent" SET "toStatus" = 'ENDED' WHERE id = 'mig-ref-ev'`)).rejects.toThrow(/append-only/);
    await expect(pool.query(`UPDATE "DossierReferent" SET status = 'ACCEPTED_BY_CITIZEN' WHERE id = 'mig-ref'`)).rejects.toThrow(/DossierReferent_citizen_consent_check/);
    await expect(pool.query(`UPDATE "DossierReferent" SET status = 'ENDED' WHERE id = 'mig-ref'`)).rejects.toThrow(/DossierReferent_ended_check/);
    await expect(pool.query(`INSERT INTO "DossierReferent" (id, "sharedDiagnosticId", "structureId", "displayName", status, "displayNameConsentAt", "updatedAt") VALUES ('mig-ref2', 'mig-dos', 'mig-Y', 'Autre (test)', 'PROPOSED', NOW(), NOW())`)).rejects.toThrow(/DossierReferent_current_key/);
    await expect(pool.query(`UPDATE "Referral" SET "suggestedStructureId" = 'mig-Y' WHERE id = 'mig-old'`)).rejects.toThrow(/Referral_suggested_check/);
    await expect(pool.query(`UPDATE "Referral" SET "previousReferralId" = id WHERE id = 'mig-a'`)).rejects.toThrow(/Referral_previous_check/);
  });

  it('0048 up: the history table is append-only except for re-sealing; its rows leave only with their referral', async () => {
    expect(await hasHistory()).toBe(true);
    expect(await journalRow(when48)).toBe(1);
    await pool.query(`UPDATE "Referral" SET "messageEncrypted" = 'cipher-sender', "responseMessageEncrypted" = 'cipher-receiver' WHERE id = 'mig-a'`);
    await pool.query(`INSERT INTO "ReferralMessage" (id, "referralId", side, "bodyEncrypted") VALUES ('mig-m1', 'mig-a', 'SENDER', 'cipher-1')`);
    await expect(pool.query(`INSERT INTO "ReferralMessage" (id, "referralId", side, "bodyEncrypted") VALUES ('mig-m2', 'mig-a', 'CITIZEN', 'x')`)).rejects.toThrow(/ReferralMessage_side_check/);
    for (const change of [`side = 'RECEIVER'`, `"referralId" = 'mig-old'`, `"createdAt" = NOW() - interval '1 day'`, `id = 'mig-m9'`]) {
      await expect(pool.query(`UPDATE "ReferralMessage" SET ${change} WHERE id = 'mig-m1'`), change).rejects.toThrow(/append-only/);
    }
    await pool.query(`UPDATE "ReferralMessage" SET "bodyEncrypted" = 'cipher-1-resealed' WHERE id = 'mig-m1'`);   // a key rotation re-seals the text
    expect((await history()).map((m) => m.bodyEncrypted)).toEqual(['cipher-1-resealed']);
  });

  it('0048 down, then up: the history is dropped, the current texts stay; the texts that exist become the first rows, once', async () => {
    for (const e of laterThan48()) await pool.query(fs.readFileSync(`drizzle/rollback/${String(e.idx).padStart(4, '0')}_down.sql`, 'utf8'));
    for (const e of laterThan48()) expect(await journalRow(e.when), e.tag).toBe(0);
    await pool.query(fs.readFileSync('drizzle/rollback/0048_down.sql', 'utf8'));
    expect(await hasHistory()).toBe(false);
    expect(await journalRow(when48)).toBe(0);
    expect((await q(`SELECT "messageEncrypted" AS m, "responseMessageEncrypted" AS r FROM "Referral" WHERE id = 'mig-a'`))[0]).toEqual({ m: 'cipher-sender', r: 'cipher-receiver' });
    await pool.query(fs.readFileSync('drizzle/rollback/0048_down.sql', 'utf8'));   // idempotent
    const beforeUp = (await q('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations'))[0].n;
    await up();
    expect((await q('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations'))[0].n).toBe(beforeUp + 1 + laterThan48().length);   // 0048 and the later ones, nothing else
    expect(await journalRow(when48)).toBe(1);
    const first = await history();
    expect(first).toEqual([{ id: 'rm-r-mig-a', referralId: 'mig-a', side: 'RECEIVER', bodyEncrypted: 'cipher-receiver' }, { id: 'rm-s-mig-a', referralId: 'mig-a', side: 'SENDER', bodyEncrypted: 'cipher-sender' }]);
    for (const st of statements(`drizzle/${TAG48}.sql`)) await pool.query(st);   // the file run a second time: nothing is inserted twice
    expect(await history()).toEqual(first);
    // back to « 0047 only » for the next steps (the rollbacks go newest first)
    for (const e of laterThan48()) await pool.query(fs.readFileSync(`drizzle/rollback/${String(e.idx).padStart(4, '0')}_down.sql`, 'utf8'));
    await pool.query(fs.readFileSync('drizzle/rollback/0048_down.sql', 'utf8'));
  });

  it('down: the rollback removes the 0047 objects, keeps the referrals and their history, and forgets the migration', async () => {
    await pool.query(fs.readFileSync('drizzle/rollback/0047_down.sql', 'utf8'));
    expect(await columns()).toEqual([]);
    expect(await tables()).toEqual([]);
    expect(await responseCheck()).not.toContain('REDIRECT_SUGGESTED');
    expect(await journalRow()).toBe(0);
    const rows = await q(`SELECT id, status, "responseCode" FROM "Referral" WHERE id IN ('mig-a', 'mig-old') ORDER BY id`);
    expect(rows).toEqual([{ id: 'mig-a', status: 'DECLINED', responseCode: 'OTHER' }, { id: 'mig-old', status: 'PENDING_CITIZEN', responseCode: null }]);
    expect((await q(`SELECT count(*)::int AS n FROM "ReferralEvent" WHERE "referralId" = 'mig-a'`))[0].n).toBe(1);
    // the earlier CHECK is back: the code is refused again
    await expect(pool.query(`UPDATE "Referral" SET "responseCode" = 'REDIRECT_SUGGESTED' WHERE id = 'mig-a'`)).rejects.toThrow(/Referral_response_check/);
    // idempotent: a second run changes nothing and does not fail
    await pool.query(fs.readFileSync('drizzle/rollback/0047_down.sql', 'utf8'));
    expect(await columns()).toEqual([]);
  });

  it('up again: the migrator applies 0047, 0048 and the later migrations rolled back with them (and nothing else); running the 0047 file a second time gives the same schema', async () => {
    const before = (await q('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations'))[0].n;
    await up();
    expect((await q('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations'))[0].n).toBe(before + 2 + laterThan48().length);
    for (const e of laterThan48()) expect(await journalRow(e.when), e.tag).toBe(1);
    expect(await journalRow()).toBe(1);
    expect(await journalRow(when48)).toBe(1);
    expect(await hasHistory()).toBe(true);
    expect(await columns()).toEqual(['followUpNotifiedAt', 'previousReferralId', 'suggestedStructureId']);
    expect(await tables()).toEqual(['DossierReferent', 'DossierReferentEvent']);
    expect((await q(`SELECT "previousReferralId", "suggestedStructureId" FROM "Referral" WHERE id = 'mig-a'`))[0]).toEqual({ previousReferralId: null, suggestedStructureId: null });
    const shape = async () => JSON.stringify(await q(`SELECT c.conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid WHERE t.relname IN ('Referral', 'DossierReferent', 'DossierReferentEvent') ORDER BY 1`))
      + JSON.stringify(await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('Referral', 'DossierReferent', 'DossierReferentEvent') ORDER BY 1`))
      + JSON.stringify(await q(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = '"DossierReferentEvent"'::regclass ORDER BY 1`));
    const once = await shape();
    await pool.query(`INSERT INTO "DossierReferent" (id, "sharedDiagnosticId", "structureId", "displayName", status, "displayNameConsentAt", "updatedAt") VALUES ('mig-ref3', 'mig-dos', 'mig-X', 'Camille (test)', 'PROPOSED', NOW(), NOW())`);
    for (const st of statements(`drizzle/${TAG}.sql`)) await pool.query(st);
    expect(await shape()).toBe(once);
    expect((await q(`SELECT count(*)::int AS n FROM "DossierReferent"`))[0].n).toBe(1);   // re-running the file keeps the data
  });
});
