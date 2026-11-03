/**
 * R40 / G7 — cron/gdpr-purge on a REAL PostgreSQL: legal holds protect every purged table that can carry a held record (not only the shared dossiers), the
 * latest EntityVersion of a record is kept for rollback however old (superseded old versions still go after 90 days), and two runs never overlap
 * (pg_try_advisory_xact_lock). The retention durations are unchanged. Works on a 0042 and a 0044 database (raw SQL seeds).
 * Run: DBN=ada_r40_jobs_test bash $S/r40/jobs/int.sh tests/integration/r40-gdpr-purge-holds-db.test.js
 */
import { vi } from 'vitest';
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY);
const mk = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } });
const ID = { heldStr: `r40h-str-held-${TS}`, freeStr: `r40h-str-free-${TS}`, heldCit: `r40h-cit-held-${TS}`, freeCit: `r40h-cit-free-${TS}`, pro: `r40h-pro-${TS}` };

describe.skipIf(!hasDatabase)('R40 G7 — gdpr-purge legal holds, versions kept for rollback, one run at a time (real DB)', () => {
  let db, handler;
  const run = async () => { const r = mk(); await handler({ method: 'GET', url: '/api/cron/gdpr-purge', query: {}, headers: { 'x-cron-secret': process.env.CRON_SECRET } }, r); return r; };
  const count = async (q) => Number((await db.execute(q)).rows[0].n);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ default: handler } = await import('../../api/_handlers/cron/gdpr-purge.js'));
    for (const sid of [ID.heldStr, ID.freeStr]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, "updatedAt", "createdAt")
        VALUES (${sid}, 'R40 H', ${'slug-' + sid}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], NOW(), NOW())`);
    }
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "updatedAt") VALUES (${ID.pro}, ${`r40h-pro-${TS}@example.test`}, 'x', 'AGENT', 'active', ${ID.freeStr}, NOW())`);
    const hold = (id, cat, rec) => db.execute(sql`INSERT INTO "LegalHold" (id, "dataCategory", "recordId", "reasonCode", "createdBy", status, "createdAt") VALUES (${id}, ${cat}, ${rec}, 'R40 TEST', 'test', 'ACTIVE', NOW())`);
    await hold(`r40h-lh1-${TS}`, 'Structure', ID.heldStr);
    await hold(`r40h-lh2-${TS}`, 'CitizenUser', ID.heldCit);
    // AuditLog older than 365 days: one about a held structure, one about a held person (actor), one free
    await db.execute(sql`INSERT INTO "AuditLog" (id, action, actor_id, entity, entity_id, timestamp) VALUES
      (${`r40h-al1-${TS}`}, ${`R40H_${TS}`}, 'x', 'Structure', ${ID.heldStr}, ${ago(400)}),
      (${`r40h-al2-${TS}`}, ${`R40H_${TS}`}, ${ID.heldCit}, 'X', 'y', ${ago(400)}),
      (${`r40h-al3-${TS}`}, ${`R40H_${TS}`}, 'x', 'Structure', ${ID.freeStr}, ${ago(400)})`);
    // ProAuditLog older than 365 days, of a held and of a free structure
    await db.execute(sql`INSERT INTO "ProAuditLog" (id, "createdAt", "proUserId", action, "structureId") VALUES
      (${`r40h-pal1-${TS}`}, ${ago(400)}, ${ID.pro}, 'R40H', ${ID.heldStr}), (${`r40h-pal2-${TS}`}, ${ago(400)}, ${ID.pro}, 'R40H', ${ID.freeStr})`);
    // ConsentLog: two old decisions of the same person and purpose (the first superseded) — held person and free person
    for (const cit of [ID.heldCit, ID.freeCit]) {
      await db.execute(sql`INSERT INTO "ConsentLog" (id, policy_version, policy_hash, subject_type, subject_id, created_at, purpose, decision) VALUES
        (${`r40h-cl-a-${cit}`}, 'v1', 'h', 'citizen', ${cit}, ${ago(1200)}, 'R40H', true), (${`r40h-cl-b-${cit}`}, 'v1', 'h', 'citizen', ${cit}, ${ago(1150)}, 'R40H', false)`);
    }
    // EntityVersion: record A has three versions older than 90 days (the latest must stay), record B one old version (stays: it is its latest),
    // the held structure two old versions (both stay)
    const ev = (id, eid, d) => sql`(${id}, 'Structure', ${eid}, '{}'::jsonb, 'r40h', ${ago(d)})`;
    await db.execute(sql`INSERT INTO "EntityVersion" (id, entity_type, entity_id, snapshot_json, reason, "createdAt") VALUES
      ${ev(`r40h-ev-a1-${TS}`, `r40h-A-${TS}`, 300)}, ${ev(`r40h-ev-a2-${TS}`, `r40h-A-${TS}`, 200)}, ${ev(`r40h-ev-a3-${TS}`, `r40h-A-${TS}`, 100)},
      ${ev(`r40h-ev-b1-${TS}`, `r40h-B-${TS}`, 300)},
      ${ev(`r40h-ev-h1-${TS}`, ID.heldStr, 300)}, ${ev(`r40h-ev-h2-${TS}`, ID.heldStr, 200)}`);
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "LegalHold" WHERE id LIKE ${'r40h-lh%-' + TS}`);
    await db.execute(sql`DELETE FROM "AuditLog" WHERE action = ${'R40H_' + TS}`);
    await db.execute(sql`DELETE FROM "ProAuditLog" WHERE "proUserId" = ${ID.pro}`);
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE purpose = 'R40H'`);
    await db.execute(sql`DELETE FROM "EntityVersion" WHERE reason = 'r40h'`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${ID.pro}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${ID.heldStr}, ${ID.freeStr})`);
  });

  it('a second run while one holds the lock deletes nothing and answers 409 ALREADY_RUNNING', async () => {
    process.env.GDPR_PURGE_ENABLED = 'true';
    const other = new pg.Client({ connectionString: process.env.DATABASE_URL }); await other.connect();
    try {
      await other.query('BEGIN'); await other.query(`SELECT pg_advisory_xact_lock(hashtext('ada:gdpr-purge'))`);
      const r = await run();
      expect([r.statusCode, r.body.skipped, r.body.reason]).toEqual([409, true, 'ALREADY_RUNNING']);
      expect(await count(sql`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = ${'R40H_' + TS}`)).toBe(3);
    } finally { await other.query('ROLLBACK').catch(() => {}); await other.end(); delete process.env.GDPR_PURGE_ENABLED; }
  });

  it('holds protect AuditLog, ProAuditLog and ConsentLog rows; free rows of the same age are purged; the run succeeds', async () => {
    process.env.GDPR_PURGE_ENABLED = 'true';
    const r = await run().finally(() => { delete process.env.GDPR_PURGE_ENABLED; });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('success');
    const ids = async (q) => (await db.execute(q)).rows.map((x) => x.id).sort();
    expect(await ids(sql`SELECT id FROM "AuditLog" WHERE action = ${'R40H_' + TS}`)).toEqual([`r40h-al1-${TS}`, `r40h-al2-${TS}`]);
    expect(await ids(sql`SELECT id FROM "ProAuditLog" WHERE "proUserId" = ${ID.pro}`)).toEqual([`r40h-pal1-${TS}`]);
    expect(await ids(sql`SELECT id FROM "ConsentLog" WHERE purpose = 'R40H'`)).toEqual([`r40h-cl-a-${ID.heldCit}`, `r40h-cl-b-${ID.freeCit}`, `r40h-cl-b-${ID.heldCit}`].sort());
  });

  it('EntityVersion: superseded versions older than 90 days go, the latest version of each record stays, a held record keeps all of them', async () => {
    expect((await db.execute(sql`SELECT id FROM "EntityVersion" WHERE reason = 'r40h' ORDER BY id`)).rows.map((x) => x.id))
      .toEqual([`r40h-ev-a3-${TS}`, `r40h-ev-b1-${TS}`, `r40h-ev-h1-${TS}`, `r40h-ev-h2-${TS}`].sort());
  });
});
