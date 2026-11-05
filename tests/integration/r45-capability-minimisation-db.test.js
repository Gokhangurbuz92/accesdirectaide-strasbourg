/**
 * R45 / ENG-LR-6 on REAL PostgreSQL — data minimisation of the narrow (AIPD) scope: with the capability gates enforced (production, beta lifted), the Mon Espace
 * summary returns only the booking parts (no parcours, vault, favourite or dossier count / flag / key) and the profile returns no household, although the rows
 * exist; in the LAB (enforcement off) the same account sees everything, unchanged. The data export (art. 15) still returns the stored rows. Synthetic data
 * only; skipped without DATABASE_URL. Columns used exist on the Production schema (0042).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const ID = (/** @type {string} */ k) => `r45g-${k}-${TS}`;

describe.skipIf(!hasDatabase)('R45 capability minimisation (real DB)', () => {
  /** @type {any} */ let db; /** @type {any} */ let espaceSummary; /** @type {any} */ let getAccount;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ espaceSummary } = await import('../../api/_services/mon-espace.js'));
    ({ getAccount } = await import('../../api/_services/citizen-account.js'));
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${ID('u')}, ${ID('u') + '@example.test'}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "HouseholdMember" (id, "userId", relation, label) VALUES (${ID('hm')}, ${ID('u')}, 'CHILD', 'Enfant fictif')`);
    await db.execute(sql`INSERT INTO "CitizenFavorite" ("userId", "entityType", "entityId") VALUES (${ID('u')}, 'aide', 'rsa')`);
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${ID('u')}`);
  });

  it('LAB (enforcement off): every part is returned, as before', async () => {
    const { summary } = await espaceSummary(ID('u'));
    expect(Object.keys(summary).sort()).toEqual(['documents', 'dossiers', 'favorites', 'messages', 'nextAppointment', 'parcours']);
    expect(summary.favorites).toBe(1);
    expect((await getAccount(ID('u'))).household).toHaveLength(1);
  });

  it('production, beta lifted: only the booking parts; no household; the rows are untouched', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const { summary } = await espaceSummary(ID('u'));
    expect(Object.keys(summary).sort()).toEqual(['messages', 'nextAppointment']);
    expect(JSON.stringify(summary)).not.toMatch(/favorites|parcours|documents|dossiers/);
    expect((await getAccount(ID('u'))).household).toEqual([]);
    const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM "HouseholdMember" WHERE "userId" = ${ID('u')}`)).rows;
    expect(n).toBe(1);   // closed is not deleted
  });

  it('opening a capability (non-HDS) brings its part back', async () => {
    vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('ADA_CAPABILITIES_OPEN', 'citizen.favorites,citizen.household');
    const { summary } = await espaceSummary(ID('u'));
    expect(summary.favorites).toBe(1);
    expect(summary).not.toHaveProperty('documents');   // HDS capability: no token
    expect((await getAccount(ID('u'))).household).toHaveLength(1);
  });
});
