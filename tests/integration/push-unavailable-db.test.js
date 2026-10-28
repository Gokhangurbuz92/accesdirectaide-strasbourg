/**
 * Launch-readiness item 59 (N04) on REAL PostgreSQL — web push does not exist: switching it on is refused (409 CHANNEL_UNAVAILABLE) even with a consent, and
 * no consent is recorded for it; without the consent the usual CONSENT_REQUIRED answer comes first (the consent rule cannot be bypassed). Synthetic data only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const U = `push-${Date.now().toString(36)}`;

describe.skipIf(!hasDatabase)('web push unavailable (real DB)', () => {
  let db, svc;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    svc = await import('../../api/_services/citizen-account.js');
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${U}, ${`${U}@example.test`}, 'x', NOW(), NOW())`);
  }, 60000);
  afterAll(async () => { if (db) await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${U}`).catch(() => {}); });

  it('refuses to switch push on and records no consent for it', async () => {
    expect(await svc.setPreference(U, { channel: 'push', category: 'reminder', enabled: true })).toMatchObject({ ok: false, code: 'CONSENT_REQUIRED' });
    expect(await svc.setPreference(U, { channel: 'push', category: 'reminder', enabled: true, consentGiven: true })).toMatchObject({ ok: false, status: 409, code: 'CHANNEL_UNAVAILABLE' });
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "ConsentLog" WHERE subject_id = ${U}`)).rows[0].n).toBe(0);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "NotificationPreference" WHERE "userId" = ${U} AND channel = 'push' AND enabled`)).rows[0].n).toBe(0);
    expect(await svc.setPreference(U, { channel: 'push', category: 'reminder', enabled: false })).toMatchObject({ ok: true });   // switching it off stays possible
  });
});
