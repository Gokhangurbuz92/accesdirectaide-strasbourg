/**
 * P2b (owner decision 08/11/2026, D2 V2 option B) — REAL PostgreSQL, real profile service: the display preferences are kept on the device only.
 *   - a value sent to the profile API is never stored (in every environment, LAB included) and never returned;
 *   - a value stored by an earlier version is erased at the next profile save, and is not returned meanwhile;
 *   - nothing else of the profile changes.
 * Synthetic data only. Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const U = { id: `p2b-${TS}`, email: `p2b-${TS}@example.test` };

describe.skipIf(!hasDatabase)('P2b — display preferences are never stored in the account (real DB)', () => {
  let db, acc;
  const storedPrefs = async () => (await db.execute(sql`SELECT "accessibilityPrefs" a, "displayName" n FROM "CitizenProfile" WHERE "userId" = ${U.id}`)).rows[0];

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    acc = await import('../../api/_services/citizen-account.js');
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "createdAt", "updatedAt") VALUES (${U.id}, ${U.email}, 'x', NOW(), NOW(), NOW())`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id = ${U.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenProfile" WHERE "userId" = ${U.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${U.id}`).catch(() => {});
  });

  it('a display preference sent with the profile is not stored and not returned; the rest of the profile is saved', async () => {
    const r = await acc.saveProfile(U.id, { displayName: 'Personne fictive', accessibilityPrefs: { falc: true, highContrast: true, reduceMotion: true, voice: true, textScale: 'xlarge' } });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await storedPrefs()).toEqual({ a: {}, n: 'Personne fictive' });
    expect(r.account.profile).not.toHaveProperty('accessibilityPrefs');
    expect((await acc.getAccount(U.id)).profile).not.toHaveProperty('accessibilityPrefs');
  });

  it('a request carrying only display preferences changes nothing (no empty update, no error)', async () => {
    const r = await acc.saveProfile(U.id, { accessibilityPrefs: { falc: true } });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect((await storedPrefs()).a).toEqual({});
  });

  it('a value stored by an earlier version is not returned, and is erased at the next profile save', async () => {
    await db.execute(sql`UPDATE "CitizenProfile" SET "accessibilityPrefs" = '{"falc": true, "textScale": "large"}'::jsonb WHERE "userId" = ${U.id}`);
    expect((await acc.getAccount(U.id)).profile).not.toHaveProperty('accessibilityPrefs');
    const r = await acc.saveProfile(U.id, { displayName: 'Personne fictive' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect((await storedPrefs()).a).toEqual({});
  });
});
