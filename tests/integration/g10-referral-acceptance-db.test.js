/**
 * G10 — acceptance of the consent-based REFERRAL journey (orientation of a person's dossier from one organization to another), LAB_SYNTHETIC, on REAL
 * PostgreSQL and THROUGH THE REAL API ENTRY (api/index.js: CSRF, restricted beta, surface gate, R45 capability gate incl. the HDS attestation check):
 *
 *   gate: in the Production profile (surfaces admin,accounts; nothing named) every referral route is refused before any database access; naming the
 *         capabilities WITHOUT an HDS attestation still refuses them (requiresHds) — only then, inside this test env, the synthetic LAB attestation opens them
 *   → the person's dossier is followed by organization X; X proposes an orientation to Y — nothing reaches Y (nor W) before the person's consent
 *   → expired consent: a dossier past its expiry cannot be authorized; a referral grant past its answer deadline + 14 days closes without the cron
 *   → the person authorizes → only Y sees it (W, another organization, sees nothing) → Y acknowledges and accepts; Y's administrator assigns the case to y1:
 *     another professional of Y (y2) no longer opens the dossier nor acts → the person sees each status in « Mes orientations »
 *   → a platform administrator (no break-glass, and even with one) never opens the dossier nor the referral
 *   → the person withdraws Y's access: the referral ends CITIZEN_WITHDREW at once, Y loses the dossier, the texts and every action immediately
 *   → the export (art. 15/20) holds the referral, its message, the access history and the PURP-06 consent rows
 *   → the reviewed erasure (two administrators) removes the dossier, the referral, its events, texts, grants and cases.
 * Synthetic data only (example.test, test mailer outbox). Not: a real partner, a real HDS host (the attestation is a SYNTHETIC token, format check only).
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0, lpush: async () => 1, ltrim: async () => 'OK', lrange: async () => [] } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = `${Date.now()}${crypto.randomBytes(2).toString('hex')}`;
const CASE = `g10ref-${TS}`;
const S = { X: `${CASE}-X`, Y: `${CASE}-Y`, W: `${CASE}-W` };
const NAME = { X: `G10 Accueil ${TS}`, Y: `G10 Logement ${TS}`, W: `G10 Autre ${TS}` };
const P = { xa: { id: `${CASE}-xa`, st: S.X, role: 'STRUCTURE_ADMIN' }, x1: { id: `${CASE}-x1`, st: S.X, role: 'PRO' },
  ya: { id: `${CASE}-ya`, st: S.Y, role: 'STRUCTURE_ADMIN' }, y1: { id: `${CASE}-y1`, st: S.Y, role: 'PRO' }, y2: { id: `${CASE}-y2`, st: S.Y, role: 'PRO' },
  w1: { id: `${CASE}-w1`, st: S.W, role: 'STRUCTURE_ADMIN' } };
const CIT = { id: `${CASE}-cit`, email: `${CASE}-cit@example.test` };
const OTHER = { id: `${CASE}-oth`, email: `${CASE}-oth@example.test` };
const ADM = { A: `${CASE}-a@example.test`, B: `${CASE}-b@example.test` };
const MESSAGE = `orientation-logement-${CASE}`;
const CSRF = `g10csrf${TS}`;
const LAB_HDS = `HDS1:lab-synthetic:G10-SYNTHETIC-NOT-A-CERT:2099-12-31:${'0'.repeat(64)}`;
const ENV_KEYS = ['ADA_PUBLIC_BETA_RESTRICTED', 'ADA_BETA_OPEN_SURFACES', 'ADA_BETA_ACCOUNTS_SCOPE', 'ADA_BETA_ACCOUNTS_EXTRA', 'ADA_CAPABILITIES_OPEN', 'ADA_HDS_CERTIFIED_HOSTING',
  'ADA_BETA_OPEN_JOBS', 'ADA_JOBS_APPROVED', 'MAILER_PROVIDER', 'MAILER_FROM'];
/** what Production runs today (CONTROL: public beta, surfaces admin + accounts, narrow scope, nothing named, no attestation) */
const PRODUCTION = { ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'admin,accounts', ADA_BETA_ACCOUNTS_SCOPE: undefined, ADA_BETA_ACCOUNTS_EXTRA: undefined,
  ADA_CAPABILITIES_OPEN: undefined, ADA_HDS_CERTIFIED_HOSTING: undefined, ADA_BETA_OPEN_JOBS: undefined, ADA_JOBS_APPROVED: undefined, MAILER_PROVIDER: 'test', MAILER_FROM: 'qa@example.test' };
const CAPS = 'citizen.orientation_records,citizen.shared_dossier,citizen.saved_diagnostic,pro.case_management,pro.referrals';
/** the opening this journey needs once K8 + K9 exist (the attestation here is SYNTHETIC) */
const OPENED = { ...PRODUCTION, ADA_BETA_OPEN_SURFACES: 'admin,accounts,pro,documents,diagnostic', ADA_BETA_ACCOUNTS_SCOPE: 'full', ADA_CAPABILITIES_OPEN: CAPS, ADA_HDS_CERTIFIED_HOSTING: LAB_HDS };
const setEnv = (vars) => { for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };

function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = v; }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('G10 acceptance — consent-based referral: consent → receiver only → accept → status → withdrawal → export → erasure (real API entry, real PostgreSQL)', () => {
  let db, api, auth, userAuth, review;
  const saved = {}; const J = {};
  const call = async (method, url, { as = {}, body } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const h = { host: 'localhost:3000', 'x-forwarded-proto': 'http', 'x-csrf-token': CSRF, cookie: `__csrf=${CSRF}` };
    const citizen = (who) => `${userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: who.id, email: who.email })).split(';')[0]}; __csrf=${CSRF}`;
    if (as.cit) h.cookie = citizen(CIT);
    if (as.other) h.cookie = citizen(OTHER);
    if (as.pro) h.authorization = `Bearer ${auth.signProToken({ id: as.pro.id, email: `${as.pro.id}@example.test`, structureId: as.pro.st, role: as.pro.role })}`;
    if (as.admin) h.authorization = `Bearer ${auth.signAdminSessionToken({ email: ADM.A, role: 'admin', mfa_verified: true, ...(as.elevated ? { elev_kind: 'BREAK_GLASS', elev_until: Date.now() + 600000, elev_id: `${CASE}-bg` } : {}) })}`;
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, socket: {}, headers: h };
    const res = mkRes(); await api(req, res);
    await (await import('../../api/_utils/after-response.js')).settleAfterResponse().catch(() => {});
    return res;
  };
  const ok = (r, code) => { if (code) expect(r.statusCode, JSON.stringify(r.body)).toBe(code); else expect(r.statusCode, JSON.stringify(r.body)).toBeLessThan(300); return r.body; };
  const refused = (r, what = '') => expect([401, 403, 404, 409, 410], `${what} ${JSON.stringify(r.body)}`).toContain(r.statusCode);
  const rows = async (q) => (await db.execute(q)).rows;
  const owner = (action, extra = {}, as = { cit: true }) => call('POST', '/api/public/dossier-grants', { as, body: { shareId: J.shareId, action, ...extra } });
  const refPost = (p, body) => call('POST', '/api/pro/referrals', { as: { pro: p }, body });
  const refOne = (p, id = J.ref) => call('GET', `/api/pro/referrals?id=${encodeURIComponent(id)}`, { as: { pro: p } });
  const inbox = async (p) => ok(await call('GET', '/api/pro/referrals?box=inbox', { as: { pro: p } })).referrals.filter((r) => r.id === J.ref);
  const dossier = (p) => call('GET', `/api/pro/dossier?shareId=${encodeURIComponent(J.shareId)}`, { as: { pro: p } });
  const mine = async () => ok(await call('GET', '/api/citizen/referrals', { as: { cit: true } })).referrals.find((r) => r.id === J.ref);
  const grantActive = async (st) => (await rows(sql`SELECT count(*)::int n FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${J.shareId} AND "structureId" = ${st} AND "revokedAt" IS NULL`))[0].n;
  const refRow = async () => (await rows(sql`SELECT * FROM "Referral" WHERE id = ${J.ref}`))[0];

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    setEnv(PRODUCTION);
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js');
    review = await import('../../api/_services/dsr-erasure-review.js');
    for (const k of ['X', 'Y', 'W']) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, departement, insee_codes, services, publics_accueillis, categories_aidees, statut, verification_status, data_origin, "updatedAt", "createdAt")
        VALUES (${S[k]}, ${NAME[k]}, ${S[k]}, 'association', '1 rue fictive', 'Strasbourg', '67000', '67', '{67482}'::text[], '{accompagnement}'::text[], '{tout_public}'::text[], '{social}'::text[], 'actif', 'VERIFIED', 'synthetic_fixture', NOW(), NOW())`);
    }
    for (const p of Object.values(P)) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${p.id}, ${p.id + '@example.test'}, 'x', ${p.role}, 'active', ${p.st}, false, NOW())`);
    for (const c of [CIT, OTHER]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
    for (const e of Object.values(ADM)) await db.execute(sql`INSERT INTO "AdminUser" (id, email, password, role, "updatedAt", "failedLoginAttempts", "mfaEnabled") VALUES (${'id-' + e}, ${e}, 'x', 'admin', NOW(), 0, true)`);
  }, 90000);

  afterAll(async () => {
    try {
      if (!db) return;
      const sts = sql.join(Object.values(S).map((s) => sql`${s}`), sql`, `);
      for (const id of [J.shareId, J.share3]) if (id) await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'shareId' = ${J.shareId || '-'} OR (entity = 'Referral' AND entity_id = ${J.ref || '-'})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" IN (${sts})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProAuditLog" WHERE "structureId" IN (${sts})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${sts})`).catch(() => {});
      await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${sts})`).catch(() => {});
      for (const c of [CIT, OTHER]) {
        await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" = ${c.id}`).catch(() => {});
        await db.execute(sql`DELETE FROM "NotificationPreference" WHERE "userId" = ${c.id}`).catch(() => {});
        await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${c.id}`).catch(() => {});
      }
      for (const e of Object.values(ADM)) await db.execute(sql`DELETE FROM "AdminUser" WHERE email = ${e}`).catch(() => {});
    } finally { setEnv(saved); }
  });

  it('1 · HDS gate: in the Production profile every referral route is refused before any database access; naming the capabilities without an HDS attestation still refuses them', async () => {
    const probes = [['GET', '/api/citizen/referrals', { cit: true }], ['POST', '/api/citizen/referrals', { cit: true }, { id: 'x', decision: 'accept' }], ['GET', '/api/pro/referrals?box=inbox', { pro: P.y1 }],
      ['POST', '/api/pro/referrals', { pro: P.x1 }, { action: 'accept', id: 'x' }], ['POST', '/api/public/dossier-grants', { cit: true }, { shareId: 'x', action: 'list' }],
      ['GET', '/api/pro/dossier?shareId=x', { pro: P.y1 }], ['POST', '/api/pro/cases', { pro: P.xa }, { action: 'assign', id: 'x', userId: 'x' }]];
    for (const [m, u, as, body] of probes) {
      const r = await call(m, u, { as, body: body || {} });
      expect([403, 404, 503], `${m} ${u} (Production)`).toContain(r.statusCode);
      expect(JSON.stringify(r.body)).not.toContain(CASE);
    }
    setEnv({ ...OPENED, ADA_HDS_CERTIFIED_HOSTING: undefined });   // everything named, no attestation: requiresHds keeps them closed
    for (const [m, u, as, body] of probes) {
      const r = await call(m, u, { as, body: body || {} });
      expect(r.statusCode, `${m} ${u} (named, no HDS)`).toBe(503);
      expect(r.body.error).toBe('CAPABILITY_NOT_OPEN');
    }
    setEnv(OPENED);
    expect((await call('GET', '/api/citizen/referrals', { as: { cit: true } })).statusCode).toBe(200);
  });

  it('2 · the person’s dossier is followed by X; X proposes an orientation to Y — nothing reaches Y or W before the person’s consent', async () => {
    const created = ok(await call('POST', '/api/share/create', { as: { cit: true }, body: { situation: { zipCode: '67000', needs: ['aides-logement'] }, results: { rights: [] } } }));
    J.shareId = created.shareId;
    const inv = ok(await owner('invite', { structureId: S.X }), 201);
    ok(await call('POST', '/api/pro/dossier/redeem', { as: { pro: P.x1 }, body: { shareId: J.shareId, inviteToken: inv.inviteToken } }));
    J.caseX = ok(await call('GET', '/api/pro/cases?scope=unassigned', { as: { pro: P.xa } })).cases.find((c) => c.dossierId === J.shareId).id;
    refused(await refPost(P.w1, { action: 'propose', caseId: J.caseX, toStructureId: S.Y, reasonCode: 'HOUSING' }), 'another organization proposes on X’s case');
    const p = ok(await refPost(P.x1, { action: 'propose', caseId: J.caseX, toStructureId: S.Y, reasonCode: 'HOUSING', message: MESSAGE, idempotencyKey: `${CASE}-k` }), 201);
    J.ref = p.referral.id;
    expect(p.referral).toMatchObject({ status: 'PENDING_CITIZEN', to: NAME.Y });
    expect(await grantActive(S.Y)).toBe(0);
    for (const who of [P.y1, P.ya, P.w1]) { expect((await refOne(who)).statusCode, who.id).toBe(404); expect(await inbox(who)).toEqual([]); expect((await dossier(who)).statusCode).toBe(404); }
    expect(await mine()).toMatchObject({ status: 'PENDING_CITIZEN', from: NAME.X, to: NAME.Y, message: MESSAGE, nextAction: { code: 'CITIZEN_DECIDE', by: 'CITIZEN' } });
    // another person cannot see nor decide it
    expect(ok(await call('GET', '/api/citizen/referrals', { as: { other: true } })).referrals.find((r) => r.id === J.ref)).toBeUndefined();
    refused(await call('POST', '/api/citizen/referrals', { as: { other: true }, body: { id: J.ref, decision: 'accept' } }), 'another person');
    expect(await grantActive(S.Y)).toBe(0);
  });

  it('3 · expired consent: a dossier past its expiry cannot be authorized (nothing is shared)', async () => {
    const [{ e }] = await rows(sql`SELECT "expiresAt" e FROM "SharedDiagnostic" WHERE id = ${J.shareId}`);
    await db.execute(sql`UPDATE "SharedDiagnostic" SET "expiresAt" = NOW() - interval '1 minute' WHERE id = ${J.shareId}`);
    try {
      refused(await call('POST', '/api/citizen/referrals', { as: { cit: true }, body: { id: J.ref, decision: 'accept' } }), 'expired dossier');
      expect(await grantActive(S.Y)).toBe(0);
      expect((await refRow()).status).toBe('PENDING_CITIZEN');
    } finally { await db.execute(sql`UPDATE "SharedDiagnostic" SET "expiresAt" = ${e} WHERE id = ${J.shareId}`); }
  });

  it('4 · the person authorizes: Y — and only Y — sees it; Y acknowledges and accepts; the person sees each status', async () => {
    ok(await call('POST', '/api/citizen/referrals', { as: { cit: true }, body: { id: J.ref, decision: 'accept' } }));
    refused(await call('POST', '/api/citizen/referrals', { as: { cit: true }, body: { id: J.ref, decision: 'accept' } }), 'decided twice');
    expect(await grantActive(S.Y)).toBe(1);
    expect(await grantActive(S.W)).toBe(0);
    expect(await mine()).toMatchObject({ status: 'SENT', nextAction: { code: 'RECEIVER_ANSWER', by: 'RECEIVER' } });
    expect((await inbox(P.y1))[0]).toMatchObject({ status: 'SENT', fromName: NAME.X, dossierId: J.shareId });
    expect(ok(await refOne(P.y1))).toMatchObject({ side: 'RECEIVER', referral: { message: MESSAGE, textsHidden: false } });
    ok(await dossier(P.y1));
    // another organization: nothing (inbox, referral, dossier, actions)
    expect(await inbox(P.w1)).toEqual([]);
    expect((await refOne(P.w1)).statusCode).toBe(404);
    expect((await dossier(P.w1)).statusCode).toBe(404);
    refused(await refPost(P.w1, { action: 'accept', id: J.ref }), 'W accepts');
    ok(await refPost(P.y1, { action: 'acknowledge', id: J.ref }));
    expect((await mine()).status).toBe('ACKNOWLEDGED');
    ok(await refPost(P.y1, { action: 'accept', id: J.ref }));
    expect(await mine()).toMatchObject({ status: 'ACCEPTED', nextAction: { code: 'RECEIVER_FIRST_STEP', by: 'RECEIVER' } });
    expect((await rows(sql`SELECT count(*)::int n FROM "ProCase" WHERE "sharedDiagnosticId" = ${J.shareId} AND "structureId" = ${S.Y}`))[0].n).toBe(1);
    expect((await rows(sql`SELECT "toStatus" s, "actorType" a FROM "ReferralEvent" WHERE "referralId" = ${J.ref} ORDER BY "createdAt", id`)).map((e) => `${e.a}:${e.s}`))
      .toEqual(['SENDER:PENDING_CITIZEN', 'CITIZEN:SENT', 'RECEIVER:ACKNOWLEDGED', 'RECEIVER:ACCEPTED']);
    // the message is sealed at rest (never the clear text in the row)
    const r = await refRow();
    expect(String(r.messageEncrypted)).not.toContain(MESSAGE);
  });

  it('5 · another professional: once Y’s administrator assigns the case to y1, y2 no longer opens the dossier nor acts on the referral', async () => {
    const yCase = (await rows(sql`SELECT id FROM "ProCase" WHERE "sharedDiagnosticId" = ${J.shareId} AND "structureId" = ${S.Y}`))[0].id;
    refused(await call('POST', '/api/pro/cases', { as: { pro: P.y2 }, body: { action: 'assign', id: yCase, userId: P.y1.id } }), 'a plain member assigns to someone else');
    ok(await call('POST', '/api/pro/cases', { as: { pro: P.ya }, body: { action: 'assign', id: yCase, userId: P.y1.id } }));
    expect((await dossier(P.y2)).statusCode).toBe(404);
    refused(await refPost(P.y2, { action: 'start', id: J.ref }), 'y2 acts');
    expect((await refRow()).status).toBe('ACCEPTED');
    ok(await dossier(P.y1));
    ok(await refPost(P.y1, { action: 'start', id: J.ref }));
    expect(await mine()).toMatchObject({ status: 'IN_PROGRESS' });
  });

  it('6 · a platform administrator — without break-glass, and even with one — never opens the dossier nor the referral', async () => {
    for (const elevated of [false, true]) {
      for (const url of [`/api/pro/dossier?shareId=${encodeURIComponent(J.shareId)}`, `/api/pro/referrals?id=${encodeURIComponent(J.ref)}`, '/api/pro/referrals?box=inbox', '/api/citizen/referrals']) {
        const r = await call('GET', url, { as: { admin: true, elevated } });
        expect([401, 403, 404], `${url} elevated=${elevated}`).toContain(r.statusCode);
        expect(JSON.stringify(r.body || {})).not.toContain(MESSAGE);
      }
      refused(await call('POST', '/api/pro/referrals', { as: { admin: true, elevated }, body: { action: 'complete', id: J.ref, outcome: 'SUPPORT_COMPLETED' } }), 'admin acts');
      refused(await call('POST', '/api/public/dossier-grants', { as: { admin: true, elevated }, body: { shareId: J.shareId, action: 'list' } }), 'admin lists the grants');
    }
  });

  it('7 · expired consent (receiver side): a referral grant past its answer deadline + 14 days closes at once, without the cron', async () => {
    // a second, independent dossier of the same person with a referral to W that W never answered
    const created = ok(await call('POST', '/api/share/create', { as: { cit: true }, body: { situation: { zipCode: '67000', needs: ['aides-logement'] }, results: { rights: [] } } }));
    J.share2 = created.shareId;
    const inv = ok(await call('POST', '/api/public/dossier-grants', { as: { cit: true }, body: { shareId: J.share2, action: 'invite', structureId: S.X } }), 201);
    ok(await call('POST', '/api/pro/dossier/redeem', { as: { pro: P.x1 }, body: { shareId: J.share2, inviteToken: inv.inviteToken } }));
    const c2 = ok(await call('GET', '/api/pro/cases?scope=unassigned', { as: { pro: P.xa } })).cases.find((c) => c.dossierId === J.share2).id;
    const r2 = ok(await refPost(P.x1, { action: 'propose', caseId: c2, toStructureId: S.W, reasonCode: 'OTHER' }), 201).referral.id;
    ok(await call('POST', '/api/citizen/referrals', { as: { cit: true }, body: { id: r2, decision: 'accept' } }));
    const d2 = () => call('GET', `/api/pro/dossier?shareId=${encodeURIComponent(J.share2)}`, { as: { pro: P.w1 } });
    ok(await d2());
    await db.execute(sql`UPDATE "Referral" SET "dueAt" = NOW() - interval '15 days' WHERE id = ${r2}`);
    expect((await d2()).statusCode).toBe(404);
    refused(await refPost(P.w1, { action: 'accept', id: r2 }), 'W accepts a lapsed referral');
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${J.share2}`);
  });

  it('7b · completion: the receiver’s outcome message and its case closing message reach the person, and are sealed at rest (never stored in clear)', async () => {
    const SUMMARY = `vous-etes-accompagne-${CASE}`; const CLOSING = `dossier-clos-${CASE}`;
    J.share3 = ok(await call('POST', '/api/share/create', { as: { cit: true }, body: { situation: { zipCode: '67000', needs: ['aides-logement'] }, results: { rights: [] } } })).shareId;
    const inv = ok(await call('POST', '/api/public/dossier-grants', { as: { cit: true }, body: { shareId: J.share3, action: 'invite', structureId: S.X } }), 201);
    ok(await call('POST', '/api/pro/dossier/redeem', { as: { pro: P.x1 }, body: { shareId: J.share3, inviteToken: inv.inviteToken } }));
    const c3 = ok(await call('GET', '/api/pro/cases?scope=unassigned', { as: { pro: P.xa } })).cases.find((c) => c.dossierId === J.share3).id;
    const r3 = ok(await refPost(P.x1, { action: 'propose', caseId: c3, toStructureId: S.W, reasonCode: 'OTHER' }), 201).referral.id;
    ok(await call('POST', '/api/citizen/referrals', { as: { cit: true }, body: { id: r3, decision: 'accept' } }));
    const wCase = ok(await refPost(P.w1, { action: 'accept', id: r3 })).caseId;
    ok(await refPost(P.w1, { action: 'complete', id: r3, outcome: 'SUPPORT_COMPLETED', citizenSummary: SUMMARY }));
    ok(await call('POST', '/api/pro/cases', { as: { pro: P.w1 }, body: { action: 'close', id: wCase, outcome: 'SUPPORT_COMPLETED', citizenSummary: CLOSING } }));
    const [stored] = await rows(sql`SELECT r."outcomeCitizenSummary" AS r, c."outcomeCitizenSummary" AS c FROM "Referral" r, "ProCase" c WHERE r.id = ${r3} AND c.id = ${wCase}`);
    expect(String(stored.r)).not.toContain(SUMMARY); expect(String(stored.r).startsWith('v2:')).toBe(true);
    expect(String(stored.c)).not.toContain(CLOSING); expect(String(stored.c).startsWith('v2:')).toBe(true);
    expect(ok(await call('GET', '/api/citizen/referrals', { as: { cit: true } })).referrals.find((r) => r.id === r3)).toMatchObject({ status: 'COMPLETED', outcomeSummary: SUMMARY });
    expect(ok(await refOne(P.x1, r3)).referral.outcomeSummary).toBe(SUMMARY);
    expect(ok(await call('GET', `/api/citizen/dossier?shareId=${encodeURIComponent(J.share3)}&view=followups`, { as: { cit: true } })).followUps.find((f) => f.organization === NAME.W).summary).toBe(CLOSING);
    expect(ok(await call('GET', `/api/pro/cases?id=${encodeURIComponent(wCase)}`, { as: { pro: P.w1 } })).case.outcomeCitizenSummary).toBe(CLOSING);
    const exp = ok(await call('GET', '/api/auth/export-data', { as: { cit: true } }));
    expect(exp.referrals.find((r) => r.id === r3).summary).toBe(SUMMARY);
    expect(exp.caseFollowUps.find((c) => c.dossierId === J.share3 && c.organization === NAME.W).summary).toBe(CLOSING);
    expect(exp.exportInfo.completeness).toBe('COMPLETED');
  });

  it('8 · the person withdraws Y’s access: the referral ends CITIZEN_WITHDREW at once and Y loses the dossier, the texts and every action immediately', async () => {
    refused(await owner('revoke', { structureId: S.Y }, { other: true }), 'another person revokes');
    expect(await grantActive(S.Y)).toBe(1);
    ok(await owner('revoke', { structureId: S.Y }));
    expect(await grantActive(S.Y)).toBe(0);
    expect(await grantActive(S.X)).toBe(1);   // X keeps what the person did not withdraw
    expect(await refRow()).toMatchObject({ status: 'CANCELLED', outcome: 'CITIZEN_WITHDREW' });
    for (const who of [P.y1, P.ya]) expect((await dossier(who)).statusCode, who.id).toBe(404);
    const seen = ok(await refOne(P.y1));
    expect(seen.referral).toMatchObject({ status: 'CANCELLED', textsHidden: true, message: '', dossierId: null });
    expect((await inbox(P.y1))[0]).toMatchObject({ status: 'CANCELLED', dossierId: null });
    for (const action of ['complete', 'start', 'accept']) refused(await refPost(P.y1, { action, id: J.ref, outcome: 'SUPPORT_COMPLETED' }), `Y ${action} after withdrawal`);
    expect((await rows(sql`SELECT count(*)::int n FROM "ProNotification" WHERE "structureId" = ${S.Y} AND type = 'referral_cancelled' AND metadata->>'referralId' = ${J.ref}`))[0].n).toBeGreaterThan(0);
    expect(await mine()).toMatchObject({ status: 'CANCELLED', outcome: 'CITIZEN_WITHDREW' });
  });

  it('9 · the export (art. 15/20) holds the referral, its message, the access history and the PURP-06 consent rows', async () => {
    const exp = ok(await call('GET', '/api/auth/export-data', { as: { cit: true } }));
    const ref = exp.referrals.find((r) => r.id === J.ref);
    expect(ref).toMatchObject({ dossierId: J.shareId, from: NAME.X, to: NAME.Y, status: 'CANCELLED', outcome: 'CITIZEN_WITHDREW', message: MESSAGE, reasonCode: 'HOUSING' });
    expect(exp.referralTextHistory.map((m) => m.text)).toContain(MESSAGE);
    const y = exp.dossierAccesses.find((a) => a.organization === NAME.Y);
    expect(y).toMatchObject({ grantedVia: 'referral' });
    expect(y.revokedAt).toBeTruthy();
    expect(exp.dossierAccesses.find((a) => a.organization === NAME.X).revokedAt).toBeNull();
    const yConsents = exp.dossierPurposeConsents.filter((c) => c.dossierAndOrganization === `${J.shareId}:${S.Y}` && c.purpose === 'PURP-06');
    expect(yConsents.map((c) => c.decision)).toEqual([true, false]);
    expect(exp.caseFollowUps.filter((c) => c.dossierId === J.shareId).map((c) => c.organization).sort()).toEqual([NAME.X, NAME.Y].sort());
    expect(JSON.stringify(exp)).not.toMatch(/tokenHash|rightsSecretHash|shareTokenHash/);
  });

  it('10 · the reviewed erasure (two administrators) removes the dossier, the referral, its events and texts, the grants and the cases; no organization keeps a trace in its boxes', async () => {
    const counts = async () => (await rows(sql`SELECT
        (SELECT count(*)::int FROM "SharedDiagnostic" WHERE id = ${J.shareId}) AS dossier,
        (SELECT count(*)::int FROM "Referral" WHERE "sharedDiagnosticId" = ${J.shareId}) AS referrals,
        (SELECT count(*)::int FROM "ReferralEvent" WHERE "referralId" = ${J.ref}) AS events,
        (SELECT count(*)::int FROM "ReferralMessage" WHERE "referralId" = ${J.ref}) AS texts,
        (SELECT count(*)::int FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${J.shareId}) AS grants,
        (SELECT count(*)::int FROM "ProCase" WHERE "sharedDiagnosticId" = ${J.shareId}) AS cases,
        (SELECT count(*)::int FROM "SharedDiagnostic" WHERE id = ${J.share3 || '-'}) AS other,
        (SELECT count(*)::int FROM "CitizenUser" WHERE id = ${CIT.id}) AS account`))[0];
    expect(await counts()).toMatchObject({ dossier: 1, referrals: 1, grants: 2, cases: 2, other: 1, account: 1 });
    const req = ok(await call('DELETE', '/api/auth/delete-account', { as: { cit: true } }), 202);
    expect((await review.proposeErasure(req.requestId, { decision: 'APPROVE' }, ADM.A, db)).ok).toBe(true);
    const [{ o }] = await rows(sql`SELECT "reviewOutcome" AS o FROM "DSRRequest" WHERE id = ${req.requestId}`);
    expect((await review.readErasure(req.requestId, ADM.B, db)).ok).toBe(true);
    const done = await review.confirmErasure(req.requestId, { action: 'confirm', note: 'Deuxième relecture, identité vérifiée', proposedAt: o.proposal.proposedAt }, ADM.B, db);
    expect(done.request?.status, JSON.stringify(done)).toBe('COMPLETED');
    expect(await counts()).toEqual({ dossier: 0, referrals: 0, events: 0, texts: 0, grants: 0, cases: 0, other: 0, account: 0 });
    for (const p of [P.x1, P.y1, P.w1]) {
      expect(ok(await call('GET', '/api/pro/referrals?box=outbox', { as: { pro: p } })).referrals.find((r) => r.id === J.ref)).toBeUndefined();
      expect(await inbox(p)).toEqual([]);
    }
    J.shareId = null;
  });
});
