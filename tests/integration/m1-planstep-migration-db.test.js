/**
 * M1 — migration 0046 (drizzle/0046_m1_parcours_plan_step.sql) and its rollback (drizzle/rollback/0046_down.sql) on a THROWAWAY PostgreSQL database
 * migrated up to 0045: up → down → up, with the data impact measured on existing rows.
 *   - up: one nullable jsonb column, no default; existing rows read NULL; NO row is rewritten (same relfilenode = the table file is not rewritten; same
 *     ctid and xmin for every row = no row version was written); no index, no constraint, no trigger added; idempotent;
 *   - down: the column and its data go, every other column of every row is identical, the migration's history row is forgotten; idempotent;
 *   - up again: the column is back, empty.
 * Needs M1_MIGRATION_TEST_URL = a loopback database whose name matches ada_m1_*_test at level 0045 (never the suite's main database); skipped otherwise.
 * Synthetic data only.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.M1_MIGRATION_TEST_URL || '';
const target = (() => { try { const u = new URL(url); return { host: u.hostname, name: u.pathname.slice(1) }; } catch { return null; } })();
const usable = Boolean(target && ['127.0.0.1', 'localhost'].includes(target.host) && /^ada_m1_[a-z0-9_]*_test$/.test(target.name));
const UP = fs.readFileSync('drizzle/0046_m1_parcours_plan_step.sql', 'utf8');
const DOWN = fs.readFileSync('drizzle/rollback/0046_down.sql', 'utf8');
const ENTRY = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries.find((e) => e.tag === '0046_m1_parcours_plan_step');
const TS = Date.now();
const USER = `m1mig-u-${TS}`;

describe.skipIf(!usable)('M1 migration 0046: up → down → up (throwaway DB)', () => {
  /** @type {import('pg').Client} */ let c;
  const q = async (text, params) => (await c.query(text, params)).rows;
  const hasColumn = async () => (await q(`SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ParcoursItem' AND column_name = 'planStep'`))[0] || null;
  /** drizzle's own way: the statements of the file, then the history row (sha256 of the file, created_at = the journal « when ») */
  const applyUp = async () => {
    await c.query('BEGIN');
    for (const st of UP.split('--> statement-breakpoint')) if (st.trim()) await c.query(st);
    await c.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [crypto.createHash('sha256').update(UP).digest('hex'), ENTRY.when]);
    await c.query('COMMIT');
  };
  const applyDown = async () => { await c.query('BEGIN'); await c.query(DOWN); await c.query('COMMIT'); };
  /** the physical identity of the table and of each of our rows */
  const physical = async () => ({
    file: (await q(`SELECT relfilenode::text AS f FROM pg_class WHERE oid = '"ParcoursItem"'::regclass`))[0].f,
    rows: await q(`SELECT id, ctid::text AS ctid, xmin::text AS xmin FROM "ParcoursItem" WHERE "userId" = $1 ORDER BY id`, [USER]),
  });
  const FORMER = `id, "userId", origin, "sourceShareId", "planKey", "stepKind", "itemCodes", title, status, "dueDate", "dueSourceUrl", note, "createdAt", "updatedAt"`;
  const content = () => q(`SELECT ${FORMER} FROM "ParcoursItem" WHERE "userId" = $1 ORDER BY id`, [USER]);
  const objects = async () => ({
    indexes: (await q(`SELECT indexname FROM pg_indexes WHERE tablename = 'ParcoursItem' ORDER BY 1`)).map((r) => r.indexname),
    constraints: (await q(`SELECT conname FROM pg_constraint WHERE conrelid = '"ParcoursItem"'::regclass ORDER BY 1`)).map((r) => r.conname),
    triggers: (await q(`SELECT tgname FROM pg_trigger WHERE tgrelid = '"ParcoursItem"'::regclass AND NOT tgisinternal ORDER BY 1`)).map((r) => r.tgname),
    columns: (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ParcoursItem' ORDER BY ordinal_position`)).map((r) => r.column_name),
  });
  const history = async () => (await q('SELECT count(*)::int n FROM drizzle.__drizzle_migrations WHERE created_at = $1', [ENTRY.when]))[0].n;
  let before;

  beforeAll(async () => {
    c = new pg.Client({ connectionString: url }); await c.connect();
    // start from 0045 whatever a previous interrupted run left
    await c.query(DOWN);
    await c.query(`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES ($1, $2, 'x', NOW(), NOW())`, [USER, `${USER}@example.test`]);
    for (let n = 0; n < 200; n += 1) {
      await c.query(`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", title, status, note, "itemCodes", "updatedAt") VALUES ($1, $2, 'MANUAL', 'custom', $3, $4, $5, $6, NOW())`,
        [`m1mig-${TS}-${String(n).padStart(3, '0')}`, USER, `Étape de test ${n}`, n % 2 ? 'IN_PROGRESS' : 'CLOSED', n % 3 ? null : 'note de test', n % 5 ? '{}' : '{aide:exemple}']);
    }
    await c.query(`INSERT INTO "ParcoursEvent" (id, "itemId", "userId", kind, "toStatus") SELECT 'ev-' || id, id, "userId", 'CREATED', 'NOT_STARTED' FROM "ParcoursItem" WHERE "userId" = $1`, [USER]);
  });
  afterAll(async () => {
    if (!c) return;
    await c.query('ROLLBACK').catch(() => {});
    await c.query(`DELETE FROM "CitizenUser" WHERE id = $1`, [USER]);
    await c.query(DOWN);   // leave the database at 0045 for the next run
    await c.end();
  });

  it('starts at 0045: no "planStep" column, no history row of 0046; the journal entry of 0046 is the newest', async () => {
    expect(await hasColumn()).toBeNull(); expect(await history()).toBe(0);
    const entries = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
    expect(entries.at(-1).tag).toBe('0046_m1_parcours_plan_step'); expect(ENTRY.idx).toBe(46); expect(ENTRY.when).toBeGreaterThan(entries.at(-2).when);
    before = { physical: await physical(), content: await content(), objects: await objects() };
    expect(before.physical.rows.length).toBe(200);
  });

  it('up: one nullable jsonb column without default; existing rows read NULL and NONE is rewritten; nothing else is added; idempotent', async () => {
    await applyUp();
    expect(await hasColumn()).toEqual({ data_type: 'jsonb', is_nullable: 'YES', column_default: null });
    expect((await q(`SELECT count(*)::int n, count("planStep")::int filled FROM "ParcoursItem" WHERE "userId" = $1`, [USER]))[0]).toEqual({ n: 200, filled: 0 });
    // data impact: same table file (no table rewrite), same physical address and same creating transaction for every row (no row version written)
    expect(await physical()).toEqual(before.physical);
    expect(await content()).toEqual(before.content);
    const after = await objects();
    expect(after.columns).toEqual([...before.objects.columns, 'planStep']);
    expect({ ...after, columns: null }).toEqual({ ...before.objects, columns: null });
    expect(await history()).toBe(1);
    // running the statement again changes nothing (IF NOT EXISTS)
    for (const st of UP.split('--> statement-breakpoint')) if (st.trim()) await c.query(st);
    expect(await physical()).toEqual(before.physical);
    // the history of the steps is untouched and still append-only
    expect((await q(`SELECT count(*)::int n FROM "ParcoursEvent" WHERE "userId" = $1`, [USER]))[0].n).toBe(200);
    await expect(c.query(`UPDATE "ParcoursEvent" SET kind = 'NOTE' WHERE "userId" = $1`, [USER])).rejects.toThrow(/append-only/);
  });

  it('the column takes plan data; the former checks still hold', async () => {
    await c.query(`UPDATE "ParcoursItem" SET "planStep" = $2::jsonb WHERE id = $1`, [`m1mig-${TS}-000`, JSON.stringify({ v: 1, need: 'energie', closure: 'ABANDONED' })]);
    expect((await q(`SELECT "planStep" AS p FROM "ParcoursItem" WHERE id = $1`, [`m1mig-${TS}-000`]))[0].p).toEqual({ v: 1, need: 'energie', closure: 'ABANDONED' });
    await expect(c.query(`UPDATE "ParcoursItem" SET status = 'ABANDONED' WHERE id = $1`, [`m1mig-${TS}-001`])).rejects.toThrow(/ParcoursItem_status_check/);
  });

  it('down: the column and its data go, every former column of every row is identical, the history row is forgotten; idempotent', async () => {
    await applyDown();
    expect(await hasColumn()).toBeNull(); expect(await history()).toBe(0);
    expect(await objects()).toEqual(before.objects);
    // no former column of any row was touched by the rollback (the row that had plan data included)
    expect(await content()).toEqual(before.content);
    await applyDown();   // twice: IF EXISTS
    expect(await hasColumn()).toBeNull();
    // the former INSERT (the code before M1 never names the column) works
    await c.query(`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", title, "updatedAt") VALUES ($1, $2, 'MANUAL', 'custom', 'Étape après retour arrière', NOW())`, [`m1mig-${TS}-zzz`, USER]);
  });

  it('up again: the column is back and empty (the plan data written before the rollback is gone, as the rollback file says)', async () => {
    await applyUp();
    expect(await hasColumn()).toEqual({ data_type: 'jsonb', is_nullable: 'YES', column_default: null });
    expect((await q(`SELECT count(*)::int n, count("planStep")::int filled FROM "ParcoursItem" WHERE "userId" = $1`, [USER]))[0]).toEqual({ n: 201, filled: 0 });
    expect(await history()).toBe(1);
    expect((await content()).filter((r) => r.id !== `m1mig-${TS}-zzz`)).toEqual(before.content);
  });
});
