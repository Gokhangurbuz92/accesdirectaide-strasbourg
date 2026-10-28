/**
 * Launch-readiness item 62 on REAL PostgreSQL — the retention report counts, deletes nothing:
 *  - the inactivity of a citizen account is measured from its last sign-in (lastSeenAt, set by a successful login);
 *  - a category with a decided duration reports how many records are past it; an undecided one says « à décider »;
 *  - running the report leaves every row in place.
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const OLD = `ret-old-${TS}`; const NEW = `ret-new-${TS}`; const LOGIN = `ret-login-${TS}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; },
  end() { return this; }, setHeader(k, v) { this.headers[k] = v; }, getHeader() { return undefined; } });

describe.skipIf(!hasDatabase)('retention report (real DB)', () => {
  let db, retention;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    retention = await import('../../api/_services/retention.js');
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "lastSeenAt", "updatedAt") VALUES
      (${OLD}, ${`${OLD}@example.test`}, 'x', NOW(), NOW() - interval '800 days', NOW()), (${NEW}, ${`${NEW}@example.test`}, 'x', NOW(), NOW() - interval '3 days', NOW())`);
  }, 60000);
  afterAll(async () => { if (db) await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${OLD}, ${NEW}, ${LOGIN})`).catch(() => {}); });

  it('a successful sign-in records the last sign-in (the measurement starts there)', async () => {
    const { hashPassword } = await import('../../api/_utils/password-hash.js');
    const email = `${LOGIN}@example.test`; const password = `Planted-Pass-${TS}`;
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${LOGIN}, ${email}, ${await hashPassword(password)}, NOW(), NOW())`);
    const login = (await import('../../api/_handlers/auth/login.js')).default;
    const r = mk();
    await login({ method: 'POST', url: '/api/auth/login', query: {}, headers: { host: 'localhost', 'x-forwarded-for': '203.0.113.50' }, body: { email, password } }, r);
    expect(r.statusCode).toBe(200);
    const [row] = (await db.execute(sql`SELECT "lastSeenAt" FROM "CitizenUser" WHERE id = ${LOGIN}`)).rows;
    expect(row.lastSeenAt).not.toBeNull();
  });

  it('counts what is past the decided duration and deletes nothing', async () => {
    const before = (await db.execute(sql`SELECT count(*)::int AS n FROM "CitizenUser"`)).rows[0].n;
    const r = await retention.retentionReport(db, {});
    expect(r.deletes).toBe(false);
    const acc = r.items.find((i) => i.key === 'INACTIVE_ACCOUNT');
    expect(acc).toMatchObject({ durationDays: 730, durationFrom: 'registre produit', deletion: 'aucune (rapport seulement)' });
    expect(acc.overdue).toBeGreaterThanOrEqual(1);
    expect(acc.total).toBeGreaterThanOrEqual(2);
    expect(r.items.find((i) => i.key === 'RDV_MESSAGES')).toMatchObject({ durationDays: null, durationFrom: 'à décider', overdue: null });
    expect(r.items.every((i) => !i.error), JSON.stringify(r.items.filter((i) => i.error))).toBe(true);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "CitizenUser"`)).rows[0].n).toBe(before);
    expect(JSON.stringify(r)).not.toContain('@example.test');
  });

  it('a duration from the environment is reported as such', async () => {
    const r = await retention.retentionReport(db, { RETENTION_RDV_MESSAGES_DAYS: '365' });
    expect(r.items.find((i) => i.key === 'RDV_MESSAGES')).toMatchObject({ durationDays: 365, durationFrom: 'environnement' });
  });
});
