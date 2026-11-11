/**
 * K12 (11/11/2026): in Production the night is six cron slices; the withdrawal cap (20 % of a kind, at least 5) is the NIGHT's — the system HOLD
 * decisions already in the ledger in the last NIGHT_HOURS are taken off the next slice's allowance (nightCap). A single LAB run keeps its own count.
 * Synthetic rows only; skipped without DATABASE_URL.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = `nc${Date.now().toString(36)}`;

describe.skipIf(!hasDatabase)('K12 night withdrawal cap across cron slices (real DB)', () => {
  let db; let withdrawalCaps; let NIGHT_HOURS;
  const ctx = (nightCap, now = new Date()) => ({ db, nightCap, limits: {}, caps: {}, now: () => now });
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ withdrawalCaps, NIGHT_HOURS } = await import('../../api/_services/verification/chain.js'));
    const ins = (id, at) => db.execute(sql`INSERT INTO "ContentVerification" (id, "entityType", "entityId", outcome, "reviewerId", "reviewerRole", "createdAt", "verifiedAt")
      VALUES (${id}, 'aide', ${`${TS}-e-${id}`}, 'HOLD', 'ada-veille-automatique', 'system', ${at}, ${at})`);
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) await ins(`${TS}-in-${i}`, new Date(now - 2 * 3600000).toISOString());                 // tonight: 3 automatic withdrawals
    await ins(`${TS}-old`, new Date(now - (NIGHT_HOURS + 5) * 3600000).toISOString());                                   // an older night: not counted
    await db.execute(sql`INSERT INTO "ContentVerification" (id, "entityType", "entityId", outcome, "reviewerId", "reviewerRole") VALUES (${`${TS}-person`}, 'aide', ${`${TS}-p`}, 'HOLD', 'admin-1', 'admin')`);   // a person's hold: not the chain's
  });
  // the ledger is append-only (trigger « ContentVerification_append_only »): the synthetic rows stay, under ids of their own; no other test runs with nightCap

  it('nightCap: tonight\'s automatic withdrawals come off the allowance (older nights and a person\'s holds do not)', async () => {
    const base = ctx(false); await withdrawalCaps(base);
    const night = ctx(true); await withdrawalCaps(night);
    expect(night.priorWithdrawn.aide).toBeGreaterThanOrEqual(3);
    expect(night.caps.aide).toBe(Math.max(0, base.caps.aide - night.priorWithdrawn.aide));
    expect(night.caps.aide).toBeLessThan(base.caps.aide);
    expect(night.caps.structure).toBe(Math.max(0, base.caps.structure - (night.priorWithdrawn.structure || 0)));
  });
  it('without nightCap (one LAB run a night) the run\'s cap is unchanged', async () => {
    const c = ctx(false); await withdrawalCaps(c);
    expect(c.priorWithdrawn).toEqual({});
    expect(c.caps.aide).toBeGreaterThanOrEqual(5);
  });
});
