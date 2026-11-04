// R44 — migration safety guard (scripts/db-migrate-guard.mjs, scripts/db-deploy-migrate.mjs, drizzle.config.ts): the obsolete 0043 / 0044 can never be
// applied to Production by journal order, history and physical-schema drift are detected, and drizzle's own migrator behaves as the guard assumes.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  CHECK_MARKERS, OBSOLETE_MANIFEST, OBSOLETE_MIGRATIONS, auditHistory, expectedObjects, isLocalDatabaseUrl, loadMigrations, physicalDrift, planDeploy,
  replayObjects, sha256, stockMigrateRefusal, verifyJournal,
} from '../../scripts/db-migrate-guard.mjs';
import * as deploy from '../../scripts/db-deploy-migrate.mjs';

const real = loadMigrations('drizzle');
const E = real.entries;
const byTag = (t) => E.find((e) => e.tag === t);
const T42 = '0042_r31_orientation_funding_pilot';
const T43 = '0043_r38_guest_booking';
const T44 = '0044_r39_guest_reminder_consent';
const T45 = '0045_r43_appointment_notice_kinds';
/** the history rows a database holds after these tags (drizzle's shape: id, sha256 of the file, created_at = « when ») */
const rowsFor = (tags) => tags.map((t, i) => ({ id: i + 1, hash: real.files[t].hash, created_at: String(byTag(t).when) }));
const upTo = (idx) => E.filter((e) => e.idx <= idx).map((e) => e.tag);
const PROD_0042 = upTo(42);

/** runs drizzle-orm's REAL PgDialect.migrate() against a fake session; returns the tags it would apply (marker statements) */
async function drizzleWouldApply(lastCreatedAt) {
  const dialect = new PgDialect();
  const applied = [];
  const migrations = E.map((e) => ({ sql: [`/*${e.tag}*/`], bps: true, folderMillis: e.when, hash: real.files[e.tag].hash }));
  const session = {
    execute: async () => [],
    all: async () => (lastCreatedAt === null ? [] : [{ id: 1, hash: 'x', created_at: String(lastCreatedAt) }]),
    transaction: async (fn) => fn({ execute: async (q) => { const s = dialect.sqlToQuery(q).sql; const m = s.match(/^\/\*(.+)\*\/$/); if (m) applied.push(m[1]); } }),
  };
  await dialect.migrate(migrations, /** @type {never} */ (session), { migrationsFolder: 'drizzle' });
  return applied;
}

describe('drizzle-orm migrator semantics (the guard depends on them)', () => {
  it('compares « when » with the NEWEST created_at only — on Production 0042 it would apply 0043, 0044 and 0045', async () => {
    expect(await drizzleWouldApply(byTag(T42).when)).toEqual([T43, T44, T45]);
  });
  it('after 0045 applied out of order, nothing is pending: 0043 / 0044 are skipped for good', async () => {
    expect(await drizzleWouldApply(byTag(T45).when)).toEqual([]);
  });
  it('planDeploy() computes the same pending set as drizzle for every level, and refuses while an obsolete one is pending', async () => {
    for (const lvl of [null, ...E.map((e) => e.when)]) {
      const drizzleSet = await drizzleWouldApply(lvl);
      const p = planDeploy(E, lvl);
      if (drizzleSet.some((t) => OBSOLETE_MIGRATIONS.includes(t))) expect(p).toEqual({ ok: false, reason: 'OBSOLETE_MIGRATION_PENDING', pending: drizzleSet });
      else expect(p.ok && p.apply.map((e) => e.tag)).toEqual(drizzleSet);
    }
  });
  it('a future 0046 after 0045 is the only pending migration on Production 0042 + 0045', () => {
    const e46 = { idx: 46, when: byTag(T45).when + 1000, tag: '0046_future' };
    const p = planDeploy([...E, e46], byTag(T45).when);
    expect(p.ok && p.apply.map((e) => e.tag)).toEqual(['0046_future']);
  });
});

describe('obsolete manifest and journal integrity', () => {
  it('pins 0043 / 0044 exactly as the repository holds them (idx, when, sha256 of the file)', () => {
    expect(OBSOLETE_MIGRATIONS).toEqual([T43, T44]);
    for (const m of OBSOLETE_MANIFEST) {
      expect(byTag(m.tag)).toMatchObject({ idx: m.idx, when: m.when });
      expect(sha256(fs.readFileSync(`drizzle/${m.tag}.sql`, 'utf8'))).toBe(m.sha256);
    }
    expect(Object.isFrozen(OBSOLETE_MANIFEST) && OBSOLETE_MANIFEST.every((m) => Object.isFrozen(m))).toBe(true);
  });
  it('the repository journal passes', () => {
    expect(verifyJournal(real)).toEqual({ ok: true, problems: [] });
  });
  const mk = (entries, files = null, sqlFiles = null) => ({
    entries, files: files || Object.fromEntries(entries.map((e) => [e.tag, real.files[e.tag] || { hash: sha256(e.tag) }])), sqlFiles: sqlFiles || entries.map((e) => `${e.tag}.sql`),
  });
  const codes = (r) => r.problems.map((p) => p.code);
  it('refuses a later migration whose « when » is not after the previous one (drizzle would skip it silently)', () => {
    const r = verifyJournal(mk([...E, { idx: 46, when: byTag(T45).when, tag: '0046_x' }]));
    expect(codes(r)).toContain('WHEN_NOT_INCREASING');
  });
  it('refuses idx gaps, duplicate tags, unnumbered tags, missing files and files without an entry', () => {
    expect(codes(verifyJournal(mk([...E, { idx: 47, when: 9e12, tag: '0047_x' }])))).toContain('IDX_NOT_CONTIGUOUS');
    expect(codes(verifyJournal(mk([...E, { idx: 46, when: 9e12, tag: '0099_x' }])))).toContain('TAG_NOT_NUMBERED_BY_IDX');
    expect(codes(verifyJournal(mk([...E, { ...E[45], idx: 46, when: 9e12 }])))).toContain('DUPLICATE_TAG');
    const files = { ...real.files }; delete files[T42];
    expect(codes(verifyJournal(mk(E, files)))).toContain('MISSING_FILE');
    expect(codes(verifyJournal(mk(E, null, [...real.sqlFiles, '0046_orphan.sql'])))).toContain('FILE_WITHOUT_ENTRY');
  });
  it('refuses an obsolete migration removed, moved, edited or renamed', () => {
    expect(codes(verifyJournal(mk(E.filter((e) => e.tag !== T44))))).toEqual(expect.arrayContaining(['OBSOLETE_ENTRY_MISSING']));
    expect(codes(verifyJournal(mk(E.map((e) => (e.tag === T43 ? { ...e, when: e.when + 1 } : e)))))).toContain('OBSOLETE_ENTRY_CHANGED');
    expect(codes(verifyJournal(mk(E, { ...real.files, [T43]: { hash: sha256('edited'), text: 'edited' } })))).toContain('OBSOLETE_FILE_CHANGED');
    const renamed = E.map((e) => (e.tag === T43 ? { ...e, tag: '0043_renamed' } : e));
    const files = { ...real.files, '0043_renamed': real.files[T43] };
    expect(codes(verifyJournal(mk(renamed, files)))).toEqual(expect.arrayContaining(['OBSOLETE_ENTRY_MISSING', 'OBSOLETE_MIGRATION_RENAMED']));
  });
});

describe('history audit', () => {
  it('Production 0042 (43 rows) and 0042 + 0045 (44 rows) are clean under Production rules', () => {
    expect(auditHistory(E, real.files, rowsFor(PROD_0042), { forbidObsoleteApplied: true })).toMatchObject({ ok: true, lastCreatedAt: byTag(T42).when });
    const h = auditHistory(E, real.files, rowsFor([...PROD_0042, T45]), { forbidObsoleteApplied: true });
    expect(h).toMatchObject({ ok: true, findings: [], lastCreatedAt: byTag(T45).when });
    expect(h.applied).toEqual([...PROD_0042, T45]);
  });
  it('the LAB full chain is clean under LAB rules, refused under Production rules', () => {
    expect(auditHistory(E, real.files, rowsFor(upTo(45))).ok).toBe(true);
    const h = auditHistory(E, real.files, rowsFor(upTo(45)), { forbidObsoleteApplied: true });
    expect(h.findings.map((f) => [f.code, f.tag])).toEqual([['OBSOLETE_MIGRATION_RECORDED', T43], ['OBSOLETE_MIGRATION_RECORDED', T44]]);
  });
  it('an empty database has no finding and no newest row', () => {
    expect(auditHistory(E, real.files, [])).toEqual({ ok: true, findings: [], applied: [], lastCreatedAt: null });
  });
  it('finds unknown rows, hash mismatches, duplicates and migrations skipped behind the newest row', () => {
    const rows = rowsFor(PROD_0042);
    const codesOf = (rs) => auditHistory(E, real.files, rs).findings.map((f) => f.code);
    expect(codesOf([...rows, { id: 99, hash: 'x', created_at: '1700000000000' }])).toEqual(['UNKNOWN_HISTORY_ROW']);
    expect(codesOf([...rows, { id: 99, hash: 'x', created_at: null }])).toEqual(['UNKNOWN_HISTORY_ROW']);
    expect(codesOf(rows.map((r, i) => (i === 9 ? { ...r, hash: 'x' } : r)))).toEqual(['HISTORY_HASH_MISMATCH']);
    expect(codesOf([...rows, { ...rows[42], id: 44 }])).toEqual(['DUPLICATE_HISTORY_ROW']);
    expect(codesOf(rows.filter((_, i) => i !== 30))).toEqual(['SKIPPED_MIGRATION']);
    // 0043 / 0044 behind 0045 are the intended skip, never reported
    expect(codesOf(rowsFor([...PROD_0042, T45]))).toEqual([]);
  });
});

describe('physical schema vs history', () => {
  it('parses the objects a migration creates and drops', () => {
    const ops = expectedObjects([
      '-- ALTER TABLE "Ignored" ADD COLUMN "x" text;',
      'CREATE TYPE "public"."Mood" AS ENUM(\'A\');--> statement-breakpoint',
      'CREATE TABLE "T" (\n\t"id" text PRIMARY KEY NOT NULL,\n\t"n" integer,\n\tCONSTRAINT "T_n_unique" UNIQUE("n")\n);',
      'ALTER TABLE "T" ADD COLUMN IF NOT EXISTS "m" text;',
      'ALTER TABLE "T" ADD CONSTRAINT "T_m_check" CHECK ("m" <> \'\');',
      'ALTER TABLE "T" DROP CONSTRAINT "T_m_check";',
      'CREATE UNIQUE INDEX "T_m_idx" ON "T" USING btree ("m");',
      'CREATE FUNCTION "t_fn"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;',
      'CREATE TRIGGER "T_trg" BEFORE UPDATE ON "T" FOR EACH ROW EXECUTE FUNCTION "t_fn"();',
      'DROP TABLE "Old" CASCADE;',
    ].join('\n'));
    expect(ops.map((o) => `${o.op}:${o.kind}:${o.key}`)).toEqual([
      'add:type:Mood', 'add:table:T', 'add:column:T.id', 'add:column:T.n', 'add:constraint:T.T_n_unique', 'add:column:T.m', 'add:constraint:T.T_m_check',
      'drop:constraint:T.T_m_check', 'add:index:T_m_idx', 'add:function:t_fn', 'add:trigger:T.T_trg', 'drop:table:Old',
    ]);
  });
  it('0043 adds the guest columns, indexes and CHECKs; 0044 one column; 0045 only re-creates the kind CHECK', () => {
    const k = (t) => expectedObjects(real.files[t].text).filter((o) => o.op === 'add').map((o) => `${o.kind}:${o.key}`);
    expect(k(T43).filter((x) => x.startsWith('column:ProAppointment.guest'))).toHaveLength(10);
    expect(k(T43)).toEqual(expect.arrayContaining(['index:ProAppointment_guestManageTokenHash_key', 'column:StructureRdvSettings.allowGuestBooking']));
    expect(k(T44)).toEqual(['column:ProAppointment.guestReminderConsentAt']);
    expect(k(T45)).toEqual(['constraint:AppointmentNotice.AppointmentNotice_kind_check']);
  });
  it('a dropped table takes its columns with it (0001 drops ProMessage)', () => {
    const objs = replayObjects(real.files, upTo(1));
    expect([...objs.keys()].some((k) => k === 'table:ProMessage' || k.startsWith('column:ProMessage.'))).toBe(false);
  });
  const catalogueOf = (tags, checkDef) => ({
    keys: new Set([...replayObjects(real.files, tags).keys()]), checks: { 'AppointmentNotice.AppointmentNotice_kind_check': checkDef },
  });
  const SEVEN = "CHECK ((kind = ANY (ARRAY['BOOKED_BY_STRUCTURE'::text, 'RESCHEDULED'::text])))";
  const ELEVEN = "CHECK ((kind = ANY (ARRAY['BOOKED_BY_STRUCTURE'::text, 'REQUEST_RECEIVED'::text])))";
  it('a Production-shaped catalogue matches its history (0042, then 0042 + 0045)', () => {
    expect(physicalDrift(E, real.files, PROD_0042, catalogueOf(PROD_0042, SEVEN))).toMatchObject({ ok: true, findings: [] });
    expect(physicalDrift(E, real.files, [...PROD_0042, T45], catalogueOf(PROD_0042, ELEVEN)).ok).toBe(true);
  });
  it('reports an unrecorded guest column, a missing object, and CHECK changes without / with their history row', () => {
    const cat = catalogueOf(PROD_0042, SEVEN); cat.keys.add('column:ProAppointment.guestEmail'); cat.keys.delete('table:PilotSession');
    const f = physicalDrift(E, real.files, PROD_0042, cat).findings;
    expect(f).toEqual(expect.arrayContaining([
      { code: 'PHYSICAL_OBJECT_UNRECORDED', kind: 'column', key: 'ProAppointment.guestEmail', tag: T43 },
      { code: 'PHYSICAL_OBJECT_MISSING', kind: 'table', key: 'PilotSession', tag: T42 },
    ]));
    expect(physicalDrift(E, real.files, PROD_0042, catalogueOf(PROD_0042, ELEVEN)).findings).toEqual([{ code: 'CHECK_CHANGE_UNRECORDED', tag: T45, key: 'AppointmentNotice.AppointmentNotice_kind_check' }]);
    expect(physicalDrift(E, real.files, [...PROD_0042, T45], catalogueOf(PROD_0042, SEVEN)).findings).toEqual([{ code: 'CHECK_CHANGE_MISSING', tag: T45, key: 'AppointmentNotice.AppointmentNotice_kind_check' }]);
    expect(CHECK_MARKERS.map((m) => m.tag)).toEqual([T43, T45]);
  });
});

describe('stock drizzle-kit entry points and the deploy CLI', () => {
  it('drizzle-kit migrate / push are refused against a non-local database; local, socket and other commands pass', () => {
    const neon = 'postgresql://u@ep-x-123.eu-central-1.aws.neon.tech/neondb?sslmode=require';
    expect(stockMigrateRefusal(['node', 'drizzle-kit', 'migrate'], neon)).toMatch(/refused/);
    expect(stockMigrateRefusal(['node', 'drizzle-kit', 'push', '--force'], neon)).toMatch(/refused/);
    expect(stockMigrateRefusal(['node', 'drizzle-kit', '--verbose', 'migrate'], 'postgres://u@db.example.invalid/x')).toMatch(/refused/);
    expect(stockMigrateRefusal(['node', 'drizzle-kit', 'migrate'], 'postgresql://ada_test@127.0.0.1:55434/x_test')).toBeNull();
    expect(stockMigrateRefusal(['node', 'drizzle-kit', 'migrate'], 'postgresql://u@localhost/x')).toBeNull();
    expect(stockMigrateRefusal(['node', 'drizzle-kit', 'generate'], neon)).toBeNull();
    expect(stockMigrateRefusal(['node', 'drizzle-kit', 'migrate'], '')).toBeNull();
    expect(isLocalDatabaseUrl('postgresql:///db?host=/tmp')).toBe(true);
    expect(isLocalDatabaseUrl('postgresql:///db')).toBe(false);
    expect(isLocalDatabaseUrl('postgresql://u@127.0.0.2/db')).toBe(false);
    expect(isLocalDatabaseUrl('not a url')).toBe(false);
  });
  it('drizzle.config.ts applies the refusal after loading .env / .env.local, before defineConfig', () => {
    const cfg = fs.readFileSync('drizzle.config.ts', 'utf8');
    const at = cfg.indexOf('stockMigrateRefusal(process.argv, process.env.DATABASE_URL)');
    expect(at).toBeGreaterThan(cfg.lastIndexOf("dotenv.config({ path: '.env.local'"));
    expect(at).toBeLessThan(cfg.indexOf('export default defineConfig'));
    expect(cfg).toMatch(/if \(refusal\) throw new Error\(refusal\);/);
  });
  it('no npm script points drizzle-kit at another config, and no CI workflow migrates a database', () => {
    const scripts = Object.values(JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts).join('\n');
    expect(scripts).not.toMatch(/drizzle-kit[^\n]*--config/);
    for (const f of fs.readdirSync('.github/workflows')) {
      expect(fs.readFileSync(`.github/workflows/${f}`, 'utf8'), f).not.toMatch(/drizzle-kit (migrate|push)|db:migrate|db:push|db-deploy-migrate/);
    }
  });
  it('the deploy CLI keeps its R43 surface and refuses loopback; the rehearsal flag accepts only a local *_test database', () => {
    expect(deploy.OBSOLETE_MIGRATIONS).toEqual([T43, T44]);
    expect(deploy.planDeploy).toBe(planDeploy);
    expect(deploy.targetOf('postgresql://u@127.0.0.1:55434/x_test')).toEqual({ ok: false, reason: 'LOOPBACK_REFUSED' });
    expect(deploy.targetOf('postgresql://u@ep-x-pooler.eu-central-1.aws.neon.tech/neondb')).toEqual({ ok: false, reason: 'POOLED_URL_REFUSED' });
    expect(deploy.rehearsalTargetOf('postgresql://u@127.0.0.1:55434/ada_r44_migrate_prod_test')).toMatchObject({ ok: true, database: 'ada_r44_migrate_prod_test' });
    expect(deploy.rehearsalTargetOf('postgresql://u@127.0.0.1:55434/ada_lab_local')).toEqual({ ok: false, reason: 'REHEARSAL_NEEDS_A_TEST_DATABASE' });
    expect(deploy.rehearsalTargetOf('postgresql://u@ep-x.eu-central-1.aws.neon.tech/neondb_test')).toEqual({ ok: false, reason: 'REHEARSAL_NEEDS_A_LOCAL_DATABASE' });
  });
  it('the --migrations folder override exists only in rehearsal mode', () => {
    const src = fs.readFileSync('scripts/db-deploy-migrate.mjs', 'utf8');
    expect(src).toMatch(/const folder = rehearsal && migAt > 0 \?/);
    expect(src).not.toMatch(/from 'drizzle-orm\/node-postgres\/migrator'/);
  });
});
