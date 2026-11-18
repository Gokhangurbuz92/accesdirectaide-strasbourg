/**
 * FA-D7 — the partner referral adapter (ada.partner-referral/1) and the referral lifecycle gaps, on REAL PostgreSQL with a LOCAL MOCK PARTNER (an HTTP server on
 * 127.0.0.1 standing for « the partner organization's own tool »). LAB_SYNTHETIC: no real partner, no real person, nothing leaves the machine.
 * Organizations: X (sender: admin, x1) · Y (connected partner: admin ya, delegate y1, colleague y2) · Z (native ADA Pro receiver, NOT connected).
 * Proves:
 *   - graceful no-integration: without configuration the outbox reads nothing; a referral to Z (not connected) is never sent to the partner;
 *   - consent first: nothing reaches the partner before the person authorizes (a refused proposal is never disclosed);
 *   - signed, minimal, idempotent outbound events (same Idempotency-Key on every retry), bounded retries, abandonment after the bound, audit rows;
 *   - signed inbound answers THROUGH THE REAL API ENTRY (api/index.js: beta gate, capability gate, CSRF exemption under /monitor/): closed → 503;
 *     replay → same answer, nothing applied twice; a key reused for another command → 409; two concurrent accepts → one step;
 *   - accountability: every step is the named delegate's (ReferralEvent.actorId), who cannot bypass the case assignment nor act once inactive;
 *   - tenant isolation: a partner cannot touch a referral addressed to another organization (404);
 *   - lifecycle: consent withdrawal → referral.cancelled; expiry → referral.expired (SYSTEM, no actor id); the sender's close → referral.closed.
 * Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429),
  rateLimit: vi.fn().mockResolvedValue({ allowed: true }), default: vi.fn().mockResolvedValue({ allowed: true }) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const S = { X: `fa7-X-${TS}`, Y: `fa7-Y-${TS}`, Z: `fa7-Z-${TS}` };
const P = { xa: { id: `fa7-xa-${TS}`, st: S.X, role: 'STRUCTURE_ADMIN' }, x1: { id: `fa7-x1-${TS}`, st: S.X, role: 'PRO' },
  ya: { id: `fa7-ya-${TS}`, st: S.Y, role: 'STRUCTURE_ADMIN' }, y1: { id: `fa7-y1-${TS}`, st: S.Y, role: 'PRO' }, y2: { id: `fa7-y2-${TS}`, st: S.Y, role: 'PRO' },
  z: { id: `fa7-z-${TS}`, st: S.Z, role: 'PRO' } };
const CIT = { id: `fa7-cit-${TS}`, email: `fa7-cit-${TS}@example.test` };
const DOSSIER = `fa7-dos-${TS}`;
const SECRET = `fa7-lab-partner-secret-not-real-${TS}`;
const PARTNER = 'fa7-lab-partner';
const SECRET_ENV = 'ADA_PARTNER_SECRET_FA7_LAB_PARTNER';
const LAB_HDS = `HDS1:lab-synthetic:FA7-SYNTHETIC-NOT-A-CERT:2099-12-31:${'0'.repeat(64)}`;
const ENV_KEYS = ['ADA_PUBLIC_BETA_RESTRICTED', 'ADA_BETA_OPEN_SURFACES', 'ADA_BETA_ACCOUNTS_SCOPE', 'ADA_CAPABILITIES_OPEN', 'ADA_HDS_CERTIFIED_HOSTING', 'ADA_PARTNER_ADAPTERS', SECRET_ENV, 'MAILER_PROVIDER', 'MAILER_FROM'];
const setEnv = (vars) => { for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
const mk = () => { const headers = {}; return { statusCode: 200, body: null, headers, headersSent: false, on() { return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = v; }, getHeader(k) { return headers[String(k).toLowerCase()]; },
  status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, end(d) { if (d !== undefined) this.body = d; return this; } }; };

describe.skipIf(!hasDatabase)('FA-D7 partner referral adapter + lifecycle gaps (real DB, local mock partner)', () => {
  let db, auth, userAuth, H, C, svc, refs, api, server, endpoint;
  const saved = {};
  /** the mock partner: records every request; `mode` decides the answer (ok | down) */
  const partnerSide = { mode: 'ok', got: [] };
  let caseId;
  const tok = (p) => auth.signProToken({ id: p.id, email: `${p.id}@example.test`, structureId: p.st, role: p.role });
  const pro = async (h, p, { method = 'GET', query = {}, body } = {}) => { const r = mk(); await h({ method, url: '/api/pro/x', query, body, headers: { host: 'localhost', authorization: `Bearer ${tok(p)}` } }, r); return r; };
  const cit = async (h, { method = 'GET', query = {}, body } = {}) => { const r = mk(); const c = userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: CIT.id, email: CIT.email })).split(';')[0];
    await h({ method, url: '/api/x', query, body, headers: { host: 'localhost', cookie: c } }, r); return r; };
  const ref = (p, body) => pro(H.refs, p, { method: 'POST', body });
  const propose = async (to) => { const r = await ref(P.x1, { action: 'propose', caseId, toStructureId: to, reasonCode: 'HOUSING', message: `Message synthétique FA7 ${TS}` }); expect(r.statusCode, JSON.stringify(r.body)).toBe(201); return r.body.referral.id; };
  const decide = (id, decision = 'accept') => cit(H.citRefs, { method: 'POST', body: { id, decision } });
  const owner = (action, extra = {}) => cit(H.grants, { method: 'POST', body: { shareId: DOSSIER, action, ...extra } });
  const row = async (id) => (await db.execute(sql`SELECT * FROM "Referral" WHERE id = ${id}`)).rows[0];
  const trail = async (id) => (await db.execute(sql`SELECT "actorType" AS actor, "actorId" AS "by", "fromStatus" AS "from", "toStatus" AS "to" FROM "ReferralEvent" WHERE "referralId" = ${id} ORDER BY "createdAt"`)).rows;
  const free = () => db.execute(sql`UPDATE "Referral" SET status = 'CANCELLED', "closedAt" = NOW() WHERE "sharedDiagnosticId" = ${DOSSIER} AND status NOT IN ('EXPIRED', 'CANCELLED', 'CLOSED', 'COMPLETED', 'DECLINED')`);
  const partnerEnv = () => ({ ADA_PARTNER_ADAPTERS: JSON.stringify([{ id: PARTNER, structureId: S.Y, endpoint, delegateProUserId: P.y1.id }]), [SECRET_ENV]: SECRET });
  const outbox = (envVars = partnerEnv()) => svc.runPartnerOutbox({ envVars, sleep: async () => {} });
  const eventsFor = (refId) => partnerSide.got.filter((g) => g.body.referral.id === refId);
  /** the partner's signed answer, through the REAL API entry */
  const answer = async (body, { secret = SECRET, partner = PARTNER } = {}) => {
    const req = { method: 'POST', url: `/api/monitor/partner/referral-events?partner=${partner}`, query: { partner }, body, cookies: {}, socket: {},
      headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', 'content-type': 'application/json', 'ada-signature': C.signHeader(secret, body) } };
    const r = mk(); await api(req, r); return r;
  };
  let n = 0;
  const cmd = (referralId, action, extra = {}) => ({ contract: C.PARTNER_CONTRACT, idempotencyKey: `fa7-key-${TS}-${(n += 1)}`, referralId, action, occurredAt: new Date().toISOString(), ...extra });

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    server = http.createServer((req, res) => {
      let raw = ''; req.on('data', (d) => { raw += d; });
      req.on('end', () => {
        partnerSide.got.push({ headers: req.headers, body: JSON.parse(raw), raw });
        res.statusCode = partnerSide.mode === 'ok' ? 204 : 503; res.end();
      });
    });
    await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
    endpoint = `http://127.0.0.1:${server.address().port}/ada-events`;
    setEnv({ MAILER_PROVIDER: 'test', MAILER_FROM: 'qa@example.test', ADA_PUBLIC_BETA_RESTRICTED: undefined, ADA_BETA_OPEN_SURFACES: undefined, ADA_CAPABILITIES_OPEN: undefined, ADA_HDS_CERTIFIED_HOSTING: undefined, ...partnerEnv() });
    ({ db } = await import('../../src/db/index.js'));
    auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js');
    C = await import('../../api/lib/partner-adapter/contract.js'); svc = await import('../../api/_services/partner-adapter.js'); refs = await import('../../api/_services/referrals.js');
    api = (await import('../../api/index.js')).default;
    H = { cases: (await import('../../api/_handlers/pro/cases.js')).default, refs: (await import('../../api/_handlers/pro/referrals.js')).default,
      citRefs: (await import('../../api/_handlers/citizen/referrals.js')).default, grants: (await import('../../api/_handlers/public/dossier-grants.js')).default };
    for (const id of Object.values(S)) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${id}, ${'Org ' + id.split('-')[1]}, ${id}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    }
    for (const p of Object.values(P)) await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${p.id}, ${p.id + '@example.test'}, 'x', ${p.role}, 'active', ${p.st}, false, NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${CIT.id}, ${CIT.email}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId") VALUES (${DOSSIER}, NOW() + interval '30 days', '{}'::jsonb, '{}'::jsonb, 0, ${'h' + DOSSIER}, ${'t' + DOSSIER}, 'GUEST_SHARE', ${CIT.id})`);
    await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", "grantedVia") VALUES (${'g-' + DOSSIER}, ${DOSSIER}, ${S.X}, ${P.x1.id}, 'invite')`);
    const queue = (await pro(H.cases, P.x1, { query: { scope: 'unassigned' } })).body.cases;
    caseId = queue.find((c) => c.dossierId === DOSSIER).id;
    expect((await pro(H.cases, P.xa, { method: 'POST', body: { action: 'assign', id: caseId, userId: P.x1.id } })).statusCode).toBe(200);
  }, 60000);

  afterAll(async () => {
    setEnv(saved);
    await new Promise((r) => { if (server) server.close(r); else r(); });
    if (!db) return;
    const sts = sql.join(Object.values(S).map((s) => sql`${s}`), sql`, `);
    const refIds = sql`SELECT id FROM "Referral" WHERE "sharedDiagnosticId" = ${DOSSIER}`;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity = 'ReferralEvent' AND entity_id IN (SELECT e.id FROM "ReferralEvent" e WHERE e."referralId" IN (${refIds}))`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity = 'PartnerCallback' AND entity_id LIKE ${`${PARTNER}:fa7-key-${TS}-%`}`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity = 'Referral' AND entity_id IN (${refIds})`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'shareId' = ${DOSSIER}`).catch(() => {});
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${DOSSIER}`);
    await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" IN (${sts})`);
    await db.execute(sql`DELETE FROM "ProAuditLog" WHERE "structureId" IN (${sts})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${sts})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${sts})`);
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id = ${CIT.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${CIT.id}`);
  });

  const J = {};

  it('graceful no-integration: without configuration the outbox reads nothing; a referral to a NOT connected organization never reaches the partner', async () => {
    expect(await outbox({})).toMatchObject({ state: 'NOT_CONFIGURED', noIntegration: true, partners: 0, delivered: 0 });
    const toZ = await propose(S.Z);
    expect((await decide(toZ)).statusCode).toBe(200);
    expect((await ref(P.z, { action: 'acknowledge', id: toZ })).statusCode, 'the native ADA Pro path is unchanged').toBe(200);
    expect(await outbox()).toMatchObject({ state: 'CONFIGURED', partners: 1, delivered: 0 });
    expect(partnerSide.got).toHaveLength(0);
    await free();
  });

  it('consent first: a proposal — and its refusal by the person — is never disclosed to the partner', async () => {
    const refused = await propose(S.Y);
    expect((await outbox()).delivered).toBe(0);
    expect((await decide(refused, 'refuse')).statusCode).toBe(200);
    expect((await row(refused)).status).toBe('CANCELLED');
    expect((await outbox()).delivered).toBe(0);
    expect(partnerSide.got).toHaveLength(0);
  });

  it('after the person authorizes: ONE signed, minimal event; delivered once; audited with identifiers only', async () => {
    J.ref = await propose(S.Y);
    expect((await decide(J.ref)).statusCode).toBe(200);
    expect(await outbox()).toMatchObject({ delivered: 1, failed: 0 });
    const [got] = eventsFor(J.ref);
    expect(got.body).toMatchObject({ contract: C.PARTNER_CONTRACT, type: 'referral.received', referral: { id: J.ref, status: 'SENT', reasonCode: 'HOUSING' } });
    const [sentEv] = (await db.execute(sql`SELECT id FROM "ReferralEvent" WHERE "referralId" = ${J.ref} AND "toStatus" = 'SENT'`)).rows;
    expect(got.body.eventId).toBe(sentEv.id); expect(got.headers['idempotency-key']).toBe(sentEv.id);
    expect(C.verifySignature({ header: got.headers['ada-signature'], body: got.body, secret: SECRET })).toEqual({ ok: true });
    // nothing about the person or the exchange
    for (const s of [CIT.email, CIT.id, DOSSIER, 'Message synthétique', P.x1.id, S.X]) expect(got.raw, s).not.toContain(s);
    expect((await outbox()).delivered, 'settled: never sent twice').toBe(0);
    const [a] = (await db.execute(sql`SELECT details FROM "AuditLog" WHERE action = 'PARTNER_EVENT_DELIVERED' AND entity_id = ${sentEv.id}`)).rows;
    expect(a.details).toMatchObject({ partner: PARTNER, type: 'referral.received', attempts: 1, httpStatus: 204 });
  });

  it('the partner answers through the real API entry: refused while the capability is closed; applied once opened; replay and key reuse are safe', async () => {
    const ack = cmd(J.ref, 'acknowledge');
    // restricted beta, nothing opened: the beta gate lets the configured callback through, the capability gate refuses before the handler (no data)
    setEnv({ ADA_PUBLIC_BETA_RESTRICTED: '1' });
    const closed = await answer(ack);
    expect(closed.statusCode).toBe(503); expect(closed.body.code).toBe('CAPABILITY_NOT_OPEN');
    // opened in the LAB with a SYNTHETIC HDS attestation (format check only — not a certificate)
    setEnv({ ADA_BETA_OPEN_SURFACES: 'accounts,pro,documents', ADA_BETA_ACCOUNTS_SCOPE: 'full', ADA_HDS_CERTIFIED_HOSTING: LAB_HDS,
      ADA_CAPABILITIES_OPEN: 'partner.referral_adapter,pro.referrals,pro.case_management,citizen.shared_dossier,citizen.orientation_records' });
    expect((await answer(ack, { secret: `${SECRET}-wrong` })).statusCode).toBe(401);
    expect((await answer(ack, { partner: 'unknown-partner' })).statusCode).toBe(404);
    const ok = await answer(ack);
    expect(ok.statusCode, JSON.stringify(ok.body)).toBe(200); expect(ok.body).toEqual({ ok: true, referral: { id: J.ref, status: 'ACKNOWLEDGED' } });
    const replay = await answer(ack);
    expect(replay.statusCode).toBe(200); expect(replay.body.replay).toBe(true);
    expect((await trail(J.ref)).filter((e) => e.to === 'ACKNOWLEDGED')).toEqual([{ actor: 'RECEIVER', by: P.y1.id, from: 'SENT', to: 'ACKNOWLEDGED' }]);
    const reused = await answer({ ...ack, action: 'start' });
    expect(reused.statusCode).toBe(409); expect(reused.body.error).toBe('IDEMPOTENCY_KEY_REUSED');
    // two concurrent accepts (different keys): one step only
    const [a, b] = await Promise.all([answer(cmd(J.ref, 'accept')), answer(cmd(J.ref, 'accept'))]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect((await trail(J.ref)).filter((e) => e.to === 'ACCEPTED')).toHaveLength(1);
    // the partner's own steps are not echoed back to it
    expect((await outbox()).delivered).toBe(0);
    const applied = (await db.execute(sql`SELECT details FROM "AuditLog" WHERE action = 'PARTNER_CALLBACK_APPLIED' AND entity_id = ${`${PARTNER}:${ack.idempotencyKey}`}`)).rows;
    expect(applied).toHaveLength(1); expect(applied[0].details).toMatchObject({ partner: PARTNER, action: 'acknowledge', actorProUserId: P.y1.id });
  });

  it('accountability and isolation: the delegate cannot bypass the case assignment, cannot act once inactive, cannot touch another organization\'s referral', async () => {
    const [yCase] = (await db.execute(sql`SELECT id FROM "ProCase" WHERE "structureId" = ${S.Y} AND "sharedDiagnosticId" = ${DOSSIER}`)).rows;
    expect((await pro(H.cases, P.ya, { method: 'POST', body: { action: 'assign', id: yCase.id, userId: P.y2.id } })).statusCode).toBe(200);
    const blocked = await answer(cmd(J.ref, 'start'));
    expect(blocked.statusCode).toBe(409); expect((await row(J.ref)).status).toBe('ACCEPTED');
    expect((await pro(H.cases, P.ya, { method: 'POST', body: { action: 'assign', id: yCase.id, userId: P.y1.id } })).statusCode).toBe(200);
    await db.execute(sql`UPDATE "ProUser" SET status = 'disabled' WHERE id = ${P.y1.id}`);
    const inactive = await answer(cmd(J.ref, 'start'));
    expect(inactive.statusCode).toBe(409); expect(inactive.body.error).toBe('DELEGATE_NOT_ACTIVE');
    await db.execute(sql`UPDATE "ProUser" SET status = 'active' WHERE id = ${P.y1.id}`);
    expect((await answer(cmd(J.ref, 'start'))).body.referral.status).toBe('IN_PROGRESS');
    // a referral addressed to Z: the same 404 as an unknown id, nothing changes
    const [toZ] = (await db.execute(sql`SELECT id, status FROM "Referral" WHERE "sharedDiagnosticId" = ${DOSSIER} AND "toStructureId" = ${S.Z} ORDER BY "createdAt" DESC LIMIT 1`)).rows;
    const foreign = await answer(cmd(toZ.id, 'accept'));
    expect(foreign.statusCode).toBe(404); expect((await row(toZ.id)).status).toBe(toZ.status);
    expect((await answer(cmd('00000000-0000-4000-8000-000000000000', 'accept'))).statusCode).toBe(404);
  });

  it('consent withdrawal: the person stops sharing with Y → the partner is told « cancelled »; its later answers are refused', async () => {
    expect((await owner('revoke', { structureId: S.Y })).statusCode).toBe(200);
    expect(await row(J.ref)).toMatchObject({ status: 'CANCELLED', outcome: 'CITIZEN_WITHDREW' });
    expect((await outbox()).delivered).toBe(1);
    expect(eventsFor(J.ref).map((g) => g.body.type)).toEqual(['referral.received', 'referral.cancelled']);
    const late = await answer(cmd(J.ref, 'complete', { outcome: 'SUPPORT_COMPLETED' }));
    expect(late.statusCode).toBe(409); expect((await row(J.ref)).status).toBe('CANCELLED');
  });

  it('expiry and retries: a partner that is down gets the SAME event (same key) on the next runs; after the bound the event is abandoned (ADA Pro keeps it)', async () => {
    J.exp = await propose(S.Y);
    expect((await decide(J.exp)).statusCode).toBe(200);
    expect((await outbox()).delivered).toBe(1);
    await db.execute(sql`UPDATE "Referral" SET "dueAt" = NOW() - make_interval(days => ${refs.EXPIRE_AFTER_DUE_DAYS + 1}) WHERE id = ${J.exp}`);
    await refs.runReferralTimeouts({ now: new Date() });
    expect((await row(J.exp)).status).toBe('EXPIRED');
    expect((await trail(J.exp)).pop()).toMatchObject({ actor: 'SYSTEM', by: null, to: 'EXPIRED' });
    partnerSide.mode = 'down';
    expect(await outbox()).toMatchObject({ delivered: 0, failed: 1 });
    expect(await outbox()).toMatchObject({ delivered: 0, failed: 1 });
    partnerSide.mode = 'ok';
    expect((await outbox()).delivered).toBe(1);
    const expired = eventsFor(J.exp).filter((g) => g.body.type === 'referral.expired');
    expect(expired.length).toBeGreaterThanOrEqual(3);
    expect(new Set(expired.map((g) => g.headers['idempotency-key'])).size, 'one key for every attempt').toBe(1);
    // the sender closes the expired referral; the partner is down for good → abandoned after the bound, then never tried again
    expect((await ref(P.x1, { action: 'close', id: J.exp })).statusCode).toBe(200);
    partnerSide.mode = 'down';
    let last;
    for (let i = 0; i < svc.OUTBOX_MAX_FAILED_RUNS; i += 1) last = await outbox();
    expect(last).toMatchObject({ failed: 1, abandoned: 1 });
    const before = partnerSide.got.length;
    expect(await outbox()).toMatchObject({ failed: 0, delivered: 0 });
    expect(partnerSide.got.length).toBe(before);
    partnerSide.mode = 'ok';
    const [closedEv] = (await db.execute(sql`SELECT id FROM "ReferralEvent" WHERE "referralId" = ${J.exp} AND "toStatus" = 'CLOSED'`)).rows;
    const states = (await db.execute(sql`SELECT action FROM "AuditLog" WHERE entity = 'ReferralEvent' AND entity_id = ${closedEv.id} ORDER BY timestamp`)).rows.map((r) => r.action);
    expect(states.filter((s) => s === 'PARTNER_EVENT_FAILED')).toHaveLength(svc.OUTBOX_MAX_FAILED_RUNS); expect(states.at(-1)).toBe('PARTNER_EVENT_ABANDONED');
  });

  it('actor accountability over the whole test: every human step names its actor, only the platform\'s own steps have none; audit rows hold no text', async () => {
    const all = (await db.execute(sql`SELECT e."actorType" AS actor, e."actorId" AS "by" FROM "ReferralEvent" e JOIN "Referral" r ON r.id = e."referralId" WHERE r."sharedDiagnosticId" = ${DOSSIER}`)).rows;
    expect(all.length).toBeGreaterThan(10);
    for (const e of all) {
      if (e.actor === 'SYSTEM') expect(e.by).toBeNull(); else expect(e.by, JSON.stringify(e)).toBeTruthy();
    }
    const allowed = new Set([P.x1.id, P.y1.id, P.z.id, CIT.id]);
    for (const e of all.filter((x) => x.by)) expect(allowed.has(e.by), e.by).toBe(true);
    const audit = JSON.stringify((await db.execute(sql`SELECT details FROM "AuditLog" WHERE action LIKE 'PARTNER_%' AND (details->>'partner') = ${PARTNER}`)).rows);
    for (const s of ['Message synthétique', CIT.email, SECRET, endpoint]) expect(audit).not.toContain(s);
  });
});
