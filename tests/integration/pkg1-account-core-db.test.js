/**
 * PKG-1 / K0 on REAL PostgreSQL with the MIGRATED schema (0015): account-scoped identity, profile + household, consent ledger + notification preferences enforced server-side,
 * account-based dossier ownership BESIDE the owner secret, uniform 404s for non-owners, and the data-subject export/erasure coverage of the new tables.
 * Synthetic users only; skipped without DATABASE_URL. Drives the real handlers with real signed session cookies.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const A = { id: `pkg1-a-${TS}`, email: `pkg1-a-${TS}@example.test` };
const B = { id: `pkg1-b-${TS}`, email: `pkg1-b-${TS}@example.test` };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('PKG-1 account core (real DB)', () => {
  let db, userAuth, H, svc;
  const cookie = (u) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: u.id, email: u.email })).split(';')[0];
  const call = async (handler, { method = 'GET', body, query = {}, headers = {}, as } = {}) => {
    const r = mk();
    await handler({ method, url: '/api/x', query, body, headers: { host: 'localhost', ...(as ? { cookie: cookie(as) } : {}), ...headers } }, r);
    return r;
  };
  const shares = [];

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    userAuth = await import('../../api/_utils/user-auth.js');
    svc = await import('../../api/_services/citizen-account.js');
    H = {
      profile: (await import('../../api/_handlers/citizen/profile.js')).default,
      household: (await import('../../api/_handlers/citizen/household.js')).default,
      prefs: (await import('../../api/_handlers/citizen/preferences.js')).default,
      shares: (await import('../../api/_handlers/citizen/shares.js')).default,
      create: (await import('../../api/_handlers/share/create.js')).default,
      grants: (await import('../../api/_handlers/public/dossier-grants.js')).default,
      revoke: (await import('../../api/_handlers/public/dossier-revoke.js')).default,
    };
    for (const u of [A, B]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${u.id}, ${u.email}, 'x', NOW(), NOW())`);
  });
  afterAll(async () => {
    if (!db) return;
    if (shares.length) await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id IN (${sql.join(shares.map((i) => sql`${i}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id IN (${A.id}, ${B.id})`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${A.id}, ${B.id})`);   // cascades profile, household, preferences
  });

  describe('authentication boundary', () => {
    it('every account endpoint refuses anonymous callers, forged cookies and Bearer tokens', async () => {
      for (const h of [H.profile, H.household, H.prefs, H.shares]) {
        expect((await call(h)).statusCode).toBe(401);
        expect((await call(h, { headers: { cookie: 'ada_user_session=forged.token.value' } })).statusCode).toBe(401);
        expect((await call(h, { headers: { authorization: 'Bearer anything' } })).statusCode).toBe(401);
      }
    });
    it('a session for an unverified account is refused', async () => {
      const u = { id: `pkg1-u-${TS}`, email: `pkg1-u-${TS}@example.test` };
      await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "updatedAt") VALUES (${u.id}, ${u.email}, 'x', NOW())`);
      try { expect((await call(H.profile, { as: u })).statusCode).toBe(401); } finally { await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${u.id}`); }
    });
  });

  describe('profile and household', () => {
    it('a new account reads safe defaults; saving is scoped to the session user', async () => {
      const g = await call(H.profile, { as: A });
      expect(g.statusCode).toBe(200);
      expect(g.body.account.profile).toMatchObject({ preferredLanguage: 'fr', ageBand: null, prefillConsent: false });
      const p = await call(H.profile, { method: 'PUT', as: A, body: { displayName: 'Alex', ageBand: '25-59', departement: '67', accessibilityPrefs: { falc: true, textScale: 'large', junk: 1 } } });
      expect(p.statusCode, JSON.stringify(p.body)).toBe(200);
      expect(p.body.account.profile).toMatchObject({ displayName: 'Alex', ageBand: '25-59', departement: '67' });
      expect(p.body.account.profile.accessibilityPrefs).toEqual({ falc: true, textScale: 'large' });
      expect((await call(H.profile, { as: B })).body.account.profile.displayName).toBeNull();   // B sees nothing of A
    });
    it('a body userId cannot redirect the write to another account', async () => {
      await call(H.profile, { method: 'PUT', as: A, body: { displayName: 'Mine', userId: B.id } });
      expect((await call(H.profile, { as: B })).body.account.profile.displayName).toBeNull();
    });
    it('rejects unknown age bands, bad départements and unsupported languages without changing anything', async () => {
      for (const body of [{ ageBand: '12-17' }, { departement: '999999' }, { preferredLanguage: 'de' }, { displayName: '' }]) {
        expect((await call(H.profile, { method: 'PUT', as: A, body })).statusCode, JSON.stringify(body)).toBe(400);
      }
      expect((await call(H.profile, { as: A })).body.account.profile.ageBand).toBe('25-59');
    });
    it('household: add / list / remove, owner-scoped, capped at 12', async () => {
      const add = await call(H.household, { method: 'POST', as: A, body: { relation: 'child', ageBand: 'moins-de-18', label: 'Enfant' } });
      expect(add.statusCode).toBe(201);
      const id = add.body.member.id;
      expect((await call(H.household, { method: 'DELETE', as: B, body: { id } })).statusCode).toBe(404);   // not B's member
      expect((await call(H.household, { method: 'DELETE', as: A, body: { id } })).statusCode).toBe(200);
      for (let i = 0; i < svc.MAX_HOUSEHOLD; i++) expect((await call(H.household, { method: 'POST', as: A, body: { relation: 'other' } })).statusCode).toBe(201);
      expect((await call(H.household, { method: 'POST', as: A, body: { relation: 'other' } })).statusCode).toBe(409);
    });
  });

  describe('age policy (no legal threshold invented)', () => {
    it('a self-declared minor keeps public information but is held back from sensitive account features with an explanatory 409', async () => {
      const minor = { id: `pkg1-m-${TS}`, email: `pkg1-m-${TS}@example.test` };
      await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${minor.id}, ${minor.email}, 'x', NOW(), NOW())`);
      try {
        expect((await call(H.profile, { method: 'PUT', as: minor, body: { ageBand: 'moins-de-18' } })).statusCode).toBe(200);
        const g = await call(H.profile, { as: minor });
        expect(g.body.account.agePolicy).toMatchObject({ allowed: false, accountFeatures: 'POLICY_PENDING', publicInformation: 'ALL_AGES', status: 'REQUIRES_LEGAL_VALIDATION' });
        const sms = await call(H.prefs, { method: 'PUT', as: minor, body: { channel: 'sms', category: 'service', enabled: true, consentGiven: true } });
        expect(sms.statusCode).toBe(409); expect(sms.body.error).toBe('AGE_POLICY_PENDING');
        expect((await call(H.profile, { method: 'PUT', as: minor, body: { prefillConsent: true } })).statusCode).toBe(409);
        expect((await call(H.household, { method: 'POST', as: minor, body: { relation: 'parent' } })).statusCode).toBe(409);
        // switching the safe things off is never blocked
        expect((await call(H.prefs, { method: 'PUT', as: minor, body: { channel: 'email', category: 'reminder', enabled: false } })).statusCode).toBe(200);
      } finally {
        await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id = ${minor.id}`);
        await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${minor.id}`);
      }
    });
  });

  describe('consent ledger and notification preferences', () => {
    it('defaults: service/reminder e-mail and in-app on; sms, push and all marketing off', async () => {
      const g = await call(H.prefs, { as: B });
      expect(g.body.preferences).toMatchObject({ 'email.service': true, 'email.reminder': true, 'inapp.service': false, 'sms.service': false, 'push.service': false, 'email.marketing': false, 'inapp.marketing': false });
    });
    it('enabling marketing or SMS needs explicit consent; the refusal changes nothing and writes no ledger row', async () => {
      const r = await call(H.prefs, { method: 'PUT', as: A, body: { channel: 'email', category: 'marketing', enabled: true } });
      expect(r.statusCode).toBe(400); expect(r.body.error).toBe('CONSENT_REQUIRED');
      expect((await call(H.prefs, { as: A })).body.preferences['email.marketing']).toBe(false);
      const n = (await db.execute(sql`SELECT count(*)::int AS n FROM "ConsentLog" WHERE subject_id = ${A.id} AND purpose = 'NOTIF_EMAIL_MARKETING'`)).rows[0].n;
      expect(n).toBe(0);
    });
    it('consent is an append-only ledger: grant then withdraw leaves two rows and the LATEST decision wins; canNotify follows it', async () => {
      const on = await call(H.prefs, { method: 'PUT', as: A, body: { channel: 'email', category: 'marketing', enabled: true, consentGiven: true } });
      expect(on.statusCode).toBe(200);
      expect(await svc.canNotify(A.id, 'email', 'marketing')).toBe(true);
      await call(H.prefs, { method: 'PUT', as: A, body: { channel: 'email', category: 'marketing', enabled: false } });
      expect(await svc.canNotify(A.id, 'email', 'marketing')).toBe(false);
      const rows = (await db.execute(sql`SELECT decision FROM "ConsentLog" WHERE subject_id = ${A.id} AND purpose = 'NOTIF_EMAIL_MARKETING' ORDER BY created_at`)).rows;
      expect(rows.map((r) => r.decision)).toEqual([true, false]);
    });
    it('a preference that is on WITHOUT a ledger grant still cannot notify (consent-required pairs)', async () => {
      await db.execute(sql`INSERT INTO "NotificationPreference" ("userId", channel, category, enabled, "updatedAt") VALUES (${B.id}, 'sms', 'service', true, NOW())`);
      expect(await svc.canNotify(B.id, 'sms', 'service')).toBe(false);
    });
    it('email.service is the same switch the existing senders already read (CitizenUser.notificationEmailEnabled)', async () => {
      await call(H.prefs, { method: 'PUT', as: A, body: { channel: 'email', category: 'service', enabled: false } });
      expect((await db.execute(sql`SELECT "notificationEmailEnabled" AS f FROM "CitizenUser" WHERE id = ${A.id}`)).rows[0].f).toBe(false);
      expect(await svc.canNotify(A.id, 'email', 'service')).toBe(false);
      await call(H.prefs, { method: 'PUT', as: A, body: { channel: 'email', category: 'service', enabled: true } });
      expect((await db.execute(sql`SELECT "notificationEmailEnabled" AS f FROM "CitizenUser" WHERE id = ${A.id}`)).rows[0].f).toBe(true);
    });
    it('unknown channels and categories are refused', async () => {
      for (const body of [{ channel: 'fax', category: 'service', enabled: true }, { channel: 'email', category: 'spam', enabled: true }, { channel: 'email', category: 'service', enabled: 'yes' }]) {
        expect((await call(H.prefs, { method: 'PUT', as: A, body })).statusCode, JSON.stringify(body)).toBe(400);
      }
      expect(await svc.canNotify(A.id, 'fax', 'service')).toBe(false);
    });
  });

  describe('account-based dossier ownership beside the owner secret', () => {
    const newShare = async (as) => {
      const r = await call(H.create, { method: 'POST', as, body: { situation: { zipCode: '67000' }, results: { rights: [] } } });
      expect(r.statusCode, JSON.stringify(r.body).slice(0, 200)).toBe(200);
      shares.push(r.body.shareId);
      return { id: r.body.shareId, owner: r.body.ownerSecret };
    };
    it('a dossier created under a session belongs to the account and is listed; B sees nothing', async () => {
      const s = await newShare(A);
      const owner = (await db.execute(sql`SELECT "ownerCitizenId" AS o, "privacySubjectId" AS p FROM "SharedDiagnostic" WHERE id = ${s.id}`)).rows[0];
      expect(owner).toEqual({ o: A.id, p: A.id });
      expect((await call(H.shares, { as: A })).body.shares.map((x) => x.id)).toContain(s.id);
      expect((await call(H.shares, { as: B })).body.shares).toEqual([]);
    });
    it('the account can manage its dossier WITHOUT the owner secret; another account and an anonymous caller cannot (uniform 404)', async () => {
      const s = await newShare(A);
      const body = { shareId: s.id, action: 'invite', structureId: 'does-not-matter' };
      const asOwner = await call(H.grants, { method: 'POST', as: A, body: { shareId: s.id, action: 'list' } });
      expect([200, 201]).toContain(asOwner.statusCode);
      for (const caller of [{ as: B }, {}]) {
        const r = await call(H.grants, { method: 'POST', body, ...caller });
        expect(r.statusCode).toBe(404);
      }
    });
    it('the owner secret keeps working for an anonymous holder (unchanged behaviour)', async () => {
      const s = await newShare(undefined);
      const r = await call(H.grants, { method: 'POST', body: { shareId: s.id, action: 'list' }, headers: { 'x-share-owner-secret': s.owner } });
      expect([200, 201]).toContain(r.statusCode);
      expect((await db.execute(sql`SELECT "ownerCitizenId" AS o FROM "SharedDiagnostic" WHERE id = ${s.id}`)).rows[0].o).toBeNull();
    });
    it('claim needs BOTH the session and the owner secret; B cannot claim A\'s dossier even with the secret', async () => {
      const s = await newShare(undefined);
      expect((await call(H.shares, { method: 'POST', as: A, body: { shareId: s.id } })).statusCode).toBe(404);   // session alone
      expect((await call(H.shares, { method: 'POST', body: { shareId: s.id }, headers: { 'x-share-owner-secret': s.owner } })).statusCode).toBe(401);   // secret alone
      expect((await call(H.shares, { method: 'POST', as: A, body: { shareId: s.id }, headers: { 'x-share-owner-secret': 'wrong' } })).statusCode).toBe(404);
      expect((await call(H.shares, { method: 'POST', as: A, body: { shareId: s.id }, headers: { 'x-share-owner-secret': s.owner } })).statusCode).toBe(200);
      expect((await call(H.shares, { method: 'POST', as: B, body: { shareId: s.id }, headers: { 'x-share-owner-secret': s.owner } })).statusCode).toBe(404);   // already A's
      expect((await call(H.shares, { as: A })).body.shares.map((x) => x.id)).toContain(s.id);
    });
    it('a legacy dossier (no share token) can never be owned through the account', async () => {
      const id = `pkg1-legacy-${TS}`; shares.push(id);
      await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "subjectType", "ownerCitizenId") VALUES (${id}, NOW() + interval '2 days', '{}'::jsonb, '{}'::jsonb, 0, 'deadbeef', 'GUEST_SHARE', ${A.id})`);
      expect((await call(H.revoke, { method: 'POST', as: A, body: { shareId: id } })).statusCode).toBe(404);
    });
    it('the owning account can erase its dossier (right to erasure) and a second attempt is a 404', async () => {
      const s = await newShare(A);
      expect((await call(H.revoke, { method: 'POST', as: B, body: { shareId: s.id } })).statusCode).toBe(404);
      expect((await call(H.revoke, { method: 'POST', as: A, body: { shareId: s.id } })).statusCode).toBe(200);
      expect((await call(H.revoke, { method: 'POST', as: A, body: { shareId: s.id } })).statusCode).toBe(404);
      expect((await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDiagnostic" WHERE id = ${s.id}`)).rows[0].n).toBe(0);
    });
  });

  describe('data-subject rights cover the new tables', () => {
    it('the privacy export includes profile, household and notification preferences', async () => {
      const { createPrivacyRightsService } = await import('../../api/_services/privacy.js');
      const nodeCrypto = await import('node:crypto');
      const out = await createPrivacyRightsService({ db, cryptoLib: nodeCrypto }).getExportData(A.id);
      expect(out).toBeTruthy();
      expect(out.accountProfile.map((p) => p.displayName)).toContain('Mine');   // profile saved above
      expect(out.household.length).toBeGreaterThan(0);
      expect(out.notificationPreferences.length).toBeGreaterThan(0);
    });
    it('deleting the account removes profile, household and preferences (cascade)', async () => {
      const gone = { id: `pkg1-g-${TS}`, email: `pkg1-g-${TS}@example.test` };
      await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${gone.id}, ${gone.email}, 'x', NOW(), NOW())`);
      await call(H.profile, { method: 'PUT', as: gone, body: { displayName: 'Gone' } });
      await call(H.household, { method: 'POST', as: gone, body: { relation: 'partner' } });
      await call(H.prefs, { method: 'PUT', as: gone, body: { channel: 'inapp', category: 'reminder', enabled: false } });
      await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${gone.id}`);
      for (const t of ['CitizenProfile', 'HouseholdMember', 'NotificationPreference']) {
        expect((await db.execute(sql.raw(`SELECT count(*)::int AS n FROM "${t}" WHERE "userId" = '${gone.id}'`))).rows[0].n, t).toBe(0);
      }
    });
  });
});
