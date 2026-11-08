/**
 * Release B (owner directions 08/11/2026, D2 V2 minimisation) — REAL PostgreSQL, real profile service: with the Production-like narrow scope the age band
 * and the département are not stored (a value sent is dropped; null still erases), the rest of the profile saves normally, GET tells the screen what is
 * collected, and the adult declaration stays the age element (a band can no longer be used to turn the account into a minor's or an adult's). The LAB
 * (no beta) keeps the fields. Synthetic data only. Skipped without DATABASE_URL.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const U = { id: `relbp-${TS}`, email: `relbp-${TS}@example.test` };
const GATES = ['ADA_PUBLIC_BETA_RESTRICTED', 'ADA_BETA_OPEN_SURFACES', 'ADA_BETA_ACCOUNTS_SCOPE', 'ADA_CAPABILITY_ENFORCEMENT'];

describe.skipIf(!hasDatabase)('Release B — age band and département not collected in the narrow V2 scope (real DB)', () => {
  let db, acc, age, saved;
  const narrow = () => { process.env.ADA_PUBLIC_BETA_RESTRICTED = '1'; process.env.ADA_BETA_OPEN_SURFACES = 'admin,accounts'; process.env.ADA_CAPABILITY_ENFORCEMENT = '1'; delete process.env.ADA_BETA_ACCOUNTS_SCOPE; };
  const stored = async () => (await db.execute(sql`SELECT "ageBand", departement, "displayName" FROM "CitizenProfile" WHERE "userId" = ${U.id}`)).rows[0];

  beforeAll(async () => {
    saved = Object.fromEntries(GATES.map((k) => [k, process.env[k]]));
    ({ db } = await import('../../src/db/index.js'));
    acc = await import('../../api/_services/citizen-account.js'); age = await import('../../api/_utils/age-policy.js');
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "createdAt", "updatedAt") VALUES (${U.id}, ${U.email}, 'x', NOW(), NOW(), NOW())`);
    await age.recordAgeDeclaration(U.id, { adult: true, channel: 'signup' });
  }, 60000);
  afterEach(() => { for (const k of GATES) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id = ${U.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenProfile" WHERE "userId" = ${U.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${U.id}`).catch(() => {});
  });

  it('narrow scope: a band and a département sent are not stored; the rest of the profile is; GET says they are not collected', async () => {
    narrow();
    const r = await acc.saveProfile(U.id, { displayName: 'Personne fictive', ageBand: '25-59', departement: '67', accessibilityPrefs: { highContrast: true } });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await stored()).toEqual({ ageBand: null, departement: null, displayName: 'Personne fictive' });
    const a = await acc.getAccount(U.id);
    expect(a.collect).toEqual({ ageBand: false, departement: false, phone: false });
    expect(a.profile).not.toHaveProperty('accessibilityPrefs');   // P2b: device only
  });

  it('narrow scope: a band cannot turn an adult account into a minor one (nor the reverse) — the adult declaration stays the age element', async () => {
    narrow();
    await acc.saveProfile(U.id, { ageBand: 'moins-de-18' });
    expect((await stored()).ageBand).toBeNull();
    // the adult declaration was recorded at sign-up; the account is adult once verified (already) — a band sent changed nothing
    expect(await age.isAdultAccount({ id: U.id })).toBe(true);
  });

  it('narrow scope: null erases a value stored earlier (art. 17)', async () => {
    await db.execute(sql`UPDATE "CitizenProfile" SET "ageBand" = '18-24', departement = '68' WHERE "userId" = ${U.id}`);
    narrow();
    const r = await acc.saveProfile(U.id, { ageBand: null, departement: null });
    expect(r.ok).toBe(true);
    expect(await stored()).toMatchObject({ ageBand: null, departement: null });
  });

  it('LAB (no beta): the fields are collected as before', async () => {
    const r = await acc.saveProfile(U.id, { ageBand: '25-59', departement: '67' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await stored()).toMatchObject({ ageBand: '25-59', departement: '67' });
    expect((await acc.getAccount(U.id)).collect).toEqual({ ageBand: true, departement: true, phone: true });
  });
});
