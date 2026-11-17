/**
 * D8 (owner 17/11: organisation ≠ establishment ≠ service) — a record that an ACTIVE « same organisation » decision of the duplicate register put aside
 * (StructureDuplicateDecision SAME_ENTITY, the other record kept) is not offered as a DESTINATION any more, on REAL PostgreSQL through the real entries:
 *   - a professional's referral receivers and the organizations a declining receiver may suggest (api/_services/referrals.js eligibleReceivers);
 *   - the organizations a person searches to share a dossier with, and the invitation itself (POST /api/public/dossier-grants);
 *   - the platform invitation of a structure's first administrator (api/_services/platform-invitation.js).
 * Before, the put-aside record stayed « actif » + « VERIFIED » with its members, so the same organisation appeared twice in every picker (same name, same
 * town) and a dossier, a referral or a new administrator could land on the record ADA itself recorded as the duplicate. A DISTINCT decision, or a SAME_ENTITY
 * decision that was replaced, excludes nothing. What already exists (members, grants, referrals) is not touched. Synthetic data only.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
// K = kept record, P = record put aside as its duplicate, D = a record declared DISTINCT from K, S = the sending organization (and the platform's own)
const O = { K: `d8a-K-${TS}`, P: `d8z-P-${TS}`, D: `d8b-D-${TS}`, S: `d8c-S-${TS}` };
const PRO = Object.fromEntries(Object.entries(O).map(([k, st]) => [k, { id: `d8-p${k}-${TS}`, st }]));
const ADMIN = `d8-superadmin-${TS}`;
const CIT = { id: `d8-cit-${TS}`, email: `d8-cit-${TS}@example.test` };
const CSRF = 'd8csrf' + TS;
const NAME = `D8 Mission Test ${TS}`;
function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('D8: a record put aside as a duplicate is not offered as a destination (real DB)', () => {
  let db, api, userAuth, referrals, platform; let share;
  const call = async (method, url, { body, headers = {} } = {}) => {
    const req = { method, url, query: {}, body: body ?? null, cookies: {}, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http',
      cookie: `${userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: CIT.id, email: CIT.email })).split(';')[0]}; __csrf=${CSRF}`, 'x-csrf-token': CSRF, ...headers } };
    const res = mkRes(); await api(req, res); return res;
  };
  const own = (action, extra = {}) => call('POST', '/api/public/dossier-grants', { body: { shareId: share.id, action, ...extra }, headers: { 'x-share-owner-secret': share.owner } });
  const decide = (decision, other, supersededAt = null) => {
    const [a, b] = [O.K, other].sort();
    return db.execute(sql`INSERT INTO "StructureDuplicateDecision" (id, "structureA", "structureB", decision, "primaryId", "evidenceUrl", note, "reviewerId", "versionA", "versionB", "supersededAt")
      VALUES (${`d8-dec-${decision}-${other}`}, ${a}, ${b}, ${decision}, ${decision === 'SAME_ENTITY' ? O.K : null}, 'https://annuaire-entreprises.data.gouv.fr/', 'D8 test', 'd8-reviewer', 'v', 'v', ${supersededAt})`);
  };
  const receivers = async (onlyId = null) => (await referrals.eligibleReceivers({ structureId: O.S, userId: PRO.S.id }, NAME, db, onlyId)).map((r) => r.id);
  const invitePlatform = (target) => platform.authorizePlatformInvitation({ dbh: db, actor: { userId: ADMIN, role: 'SUPERADMIN', mfa: true }, target, role: 'STRUCTURE_ADMIN' });

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; userAuth = await import('../../api/_utils/user-auth.js');
    referrals = await import('../../api/_services/referrals.js'); platform = await import('../../api/_services/platform-invitation.js');
    for (const [k, id] of Object.entries(O)) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${id}, ${k === 'S' ? `D8 Envoyeur ${TS}` : NAME}, ${id}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
      await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "updatedAt") VALUES (${PRO[k].id}, ${PRO[k].id + '@example.test'}, 'x', 'STRUCTURE_ADMIN', 'active', ${id}, NOW())`);
    }
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", mfa_enabled, "updatedAt") VALUES (${ADMIN}, ${ADMIN + '@example.test'}, 'x', 'SUPERADMIN', 'active', ${O.S}, true, NOW())`);
    await decide('SAME_ENTITY', O.P);
    await decide('DISTINCT', O.D);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${CIT.id}, ${CIT.email}, 'x', NOW(), NOW())`);
    const created = await call('POST', '/api/share/create', { body: { situation: { zipCode: '67000' }, results: { rights: [] } } });
    share = { id: created.body.shareId, owner: created.body.ownerSecret };
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "SharedDossierInvite" WHERE "sharedDiagnosticId" = ${share?.id || ''}`).catch(() => {});
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${share?.id || ''}`).catch(() => {});
    await db.execute(sql`DELETE FROM "StructureDuplicateDecision" WHERE id LIKE ${'d8-dec-%'} AND "reviewerId" = 'd8-reviewer'`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${ADMIN}`).catch(() => {});
    for (const id of Object.values(O)) {
      for (const t of ['ProNotification', 'ProUser']) await db.execute(sql`DELETE FROM ${sql.raw(`"${t}"`)} WHERE "structureId" = ${id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "Structure" WHERE id = ${id}`).catch(() => {});
    }
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id = ${CIT.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${CIT.id}`).catch(() => {});
  });

  it('referral receivers (and redirect suggestions): the kept record and a DISTINCT one, never the record put aside', async () => {
    const list = await receivers();
    expect(list).toEqual(expect.arrayContaining([O.K, O.D]));
    expect(list).not.toContain(O.P);
    expect(await receivers(O.P), 'propose() checks the chosen receiver with the same function').toEqual([]);
  });

  it('sharing a dossier: the put-aside record is not found, and an invitation to it is the same 404 as an unknown id', async () => {
    const found = (await own('find_organizations', { q: NAME })).body.organizations.map((o) => o.id);
    expect(found).toEqual(expect.arrayContaining([O.K, O.D]));
    expect(found).not.toContain(O.P);
    const unknown = await own('invite', { structureId: `nope-${TS}` });
    const putAside = await own('invite', { structureId: O.P });
    expect([putAside.statusCode, putAside.body]).toEqual([unknown.statusCode, unknown.body]);
    expect((await own('invite', { structureId: O.K })).statusCode).toBe(201);
  });

  it('platform invitation of a first administrator: refused for the put-aside record, with the record to use instead', async () => {
    const r = await invitePlatform(O.P);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe(platform.PLATFORM_INVITATION_CODES.NOT_ELIGIBLE);
    expect(r.body.error).toMatch(/doublon/i);
    expect((await invitePlatform(O.K)).ok).toBe(true);
    expect((await invitePlatform(O.D)).ok).toBe(true);
  });

  it('once the SAME_ENTITY decision is replaced (superseded), the record is a destination again', async () => {
    await db.execute(sql`UPDATE "StructureDuplicateDecision" SET "supersededAt" = NOW() WHERE id = ${`d8-dec-SAME_ENTITY-${O.P}`}`);
    expect(await receivers()).toContain(O.P);
    expect((await invitePlatform(O.P)).ok).toBe(true);
  });
});
