/**
 * R12 (E01) — professional sign-up on real PostgreSQL: the organization and its first administrator are created in ONE transaction, and simultaneous
 * sign-ups with the same address (in any letter case) create exactly one organization and one account — no orphan organization.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const TS = Date.now();
const EMAIL = `r12-reg-${TS}@example.test`;
const NAME = `R12 Inscription ${TS}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });

describe.skipIf(!hasDatabase)('R12 pro registration transaction (real DB)', () => {
  let db; let handler;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    handler = (await import('../../api/_handlers/pro/auth/register.js')).default;
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
  });
  afterAll(async () => {
    if (!db) return;
    const ids = (await db.execute(sql`SELECT "structureId" AS id FROM "ProUser" WHERE lower(email) = ${EMAIL}`)).rows.map((r) => r.id);
    await db.execute(sql`DELETE FROM "ProUser" WHERE lower(email) = ${EMAIL}`);
    await db.execute(sql`DELETE FROM "ProAuditLog" WHERE "structureId" IN (SELECT id FROM "Structure" WHERE nom = ${NAME})`).catch(() => {});
    await db.execute(sql`DELETE FROM "Structure" WHERE nom = ${NAME}`);
    expect(ids.length).toBeLessThanOrEqual(1);
  });

  it('four simultaneous sign-ups with one address (mixed case): one organization, one account, the others get the neutral refusal', async () => {
    const call = async (i) => { const r = mk(); await handler({ method: 'POST', url: '/api/pro/auth/register', headers: { host: 'localhost', 'x-forwarded-for': `10.9.${i}.1` },
      body: { email: i % 2 ? EMAIL.toUpperCase() : EMAIL, password: 'Synthetic-QA-pass-0001', structureName: NAME } }, r); return r; };
    const out = await Promise.all([0, 1, 2, 3].map(call));
    expect(out.map((r) => r.statusCode).sort(), JSON.stringify(out.map((r) => r.body))).toEqual([200, 400, 400, 400]);
    const users = (await db.execute(sql`SELECT "structureId" FROM "ProUser" WHERE lower(email) = ${EMAIL}`)).rows;
    const orgs = (await db.execute(sql`SELECT id FROM "Structure" WHERE nom = ${NAME}`)).rows;
    expect(users.length).toBe(1); expect(orgs.length, 'no orphan organization').toBe(1);
    expect(orgs[0].id).toBe(users[0].structureId);
  });
});
