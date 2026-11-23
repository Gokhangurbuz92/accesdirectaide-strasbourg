/**
 * G14-AID — « mode accompagnant » on REAL PostgreSQL, through the real router (api/routes.js: capability gate + assisted-session gate) and handlers:
 *   next to the person: consent + password, adult only, legal mandate out of scope, ADA Pro helper only with a valid code of an ACTIVE member WITH MFA
 *   (never Mon Coffre), only the areas opened, the account's security never (e-mail, export, deletion, delegations), every view / action / refusal in the
 *   person's history, end at once (sign-out) or with the password, end from another device, automatic expiry;
 *   at a distance: a trusted person's request waits for the person's confirmation (single use, 48 h), « agir pour moi » (password) executes at once,
 *   sensitive steps and other people's appointments are unknown, revocation stops everything, both sides see what happened.
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const PASSWORD = 'Synthetique-G14aid-2026x';
const P = { id: `aid-p-${TS}`, email: `aid-p-${TS}@example.test` };   // the person helped
const D = { id: `aid-d-${TS}`, email: `aid-d-${TS}@example.test` };   // a trusted person (remote)
const X = { id: `aid-x-${TS}`, email: `aid-x-${TS}@example.test` };   // a stranger
const M = { id: `aid-m-${TS}`, email: `aid-m-${TS}@example.test` };   // a person who declared a legal mandate
const N = { id: `aid-n-${TS}`, email: `aid-n-${TS}@example.test` };   // no adult statement
const STR = `aid-str-${TS}`; const SVC = `aid-svc-${TS}`;
const PRO = { id: `aid-pro-${TS}`, email: `aid-pro-${TS}@example.test` }; const PRO_NOMFA = { id: `aid-pro2-${TS}`, email: `aid-pro2-${TS}@example.test` };
const APT = `aid-apt-${TS}`; const APT_X = `aid-aptx-${TS}`; const ITEM = `aid-item-${TS}`; const ITEM_S = `aid-items-${TS}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const cookieOf = (res) => String([].concat(res.headers['Set-Cookie'] || '')[0] || '').split(';')[0];

describe.skipIf(!hasDatabase)('G14-AID — mode accompagnant (real DB)', () => {
  let db, userAuth, routes, svc, normal;
  const route = async (path) => (await routes.find((r) => r.path === path).handler()).default;
  /** through the router (both gates), as api/index.js runs it */
  const http = async (path, { method = 'GET', body, query = {}, cookie, suffix = '' } = {}) => {
    const r = mk(); const h = await route(path);
    await h({ method, url: `/api/${path}${suffix}`, query, body, headers: { host: 'localhost', ...(cookie ? { cookie } : {}) } }, r); return r;
  };
  const assist = (cookie, body) => http('citizen/assist', { method: 'POST', cookie, body });
  const auditOf = async (userId) => (await db.execute(sql`SELECT action, details FROM "AuditLog" WHERE entity = 'CitizenUser' AND entity_id = ${userId} ORDER BY timestamp, id`)).rows;
  const START = { action: 'start', consent: true, helperName: 'Marie Exemple', helperRole: 'CONSEILLER_FRANCE_SERVICES', structureName: 'France Services Test', areas: ['RDV', 'PARCOURS'], minutes: 60, password: PASSWORD };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    userAuth = await import('../../api/_utils/user-auth.js');
    ({ routes } = await import('../../api/routes.js'));
    svc = await import('../../api/_services/assisted-mode.js');
    const { recordAgeDeclaration } = await import('../../api/_utils/age-policy.js');
    const hash = await userAuth.hashPassword(PASSWORD);
    for (const u of [P, D, X, M, N]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${u.id}, ${u.email}, ${hash}, NOW(), NOW())`);
    for (const u of [P, D, X, M]) await recordAgeDeclaration(u.id, { adult: true, channel: 'account' });
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, "updatedAt", "createdAt")
      VALUES (${STR}, 'France Services Aid Test', ${`aid-slug-${TS}`}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${SVC}, ${STR}, 'S', 30, NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", mfa_enabled, "updatedAt") VALUES (${PRO.id}, ${PRO.email}, 'x', 'AGENT', 'active', ${STR}, true, NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", mfa_enabled, "updatedAt") VALUES (${PRO_NOMFA.id}, ${PRO_NOMFA.email}, 'x', 'AGENT', 'active', ${STR}, false, NOW())`);
    const start = new Date(Date.now() + 5 * 864e5);
    for (const [id, owner] of [[APT, P.id], [APT_X, X.id]]) await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "createdByProUserId", "citizenUserId", "createdAt", "updatedAt")
      VALUES (${id}, ${STR}, ${SVC}, ${start}, ${new Date(start.getTime() + 1_800_000)}, 'confirmed', 'Personne Test', ${PRO.id}, ${owner}, NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", title, "updatedAt") VALUES (${ITEM}, ${P.id}, 'MANUAL', 'custom', 'Déposer le dossier CAF', NOW())`);
    await db.execute(sql`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", title, "updatedAt") VALUES (${ITEM_S}, ${P.id}, 'MANUAL', 'custom', 'Constituer le dossier MDPH', NOW())`);
    await db.execute(sql`INSERT INTO "CitizenDelegation" (id, "principalUserId", "inviteEmail", role, scopes, status, "proofStatus", "expiresAt") VALUES (${`aid-legal-${TS}`}, ${M.id}, 'tuteur@example.test', 'TUTEUR', '{PARCOURS_READ}', 'INVITED', 'REQUIRED_NOT_VERIFIED', NOW() + interval '30 days')`);
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
    normal = (u) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: u.id, email: u.email })).split(';')[0];
  });
  afterAll(async () => {
    if (!db) return;
    const ids = [P.id, D.id, X.id, M.id, N.id, PRO.id, PRO_NOMFA.id];
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) OR actor_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM "AppointmentNotice" WHERE "appointmentId" IN (${APT}, ${APT_X})`);
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE id IN (${APT}, ${APT_X})`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id IN (${PRO.id}, ${PRO_NOMFA.id})`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${SVC}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${sql.join(ids.slice(0, 5).map((i) => sql`${i}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${STR}`);
  });

  describe('next to the person', () => {
    let assisted;
    it('refuses without consent, with a wrong password, for a non-adult account, for a declared legal mandate, beyond 2 h', async () => {
      expect((await assist(normal(P), { ...START, consent: false })).body.error).toBe('CONSENT_REQUIRED');
      expect((await assist(normal(P), { ...START, password: 'wrong' })).statusCode).toBe(403);
      expect((await assist(normal(P), { ...START, minutes: 240 })).body.error).toBe('INVALID_DURATION');
      expect((await assist(normal(P), { ...START, areas: ['SECURITY'] })).body.error).toBe('INVALID_AREAS');
      expect((await assist(normal(N), START)).body.error).toBe('ASSIST_ADULT_ONLY');
      expect((await assist(normal(M), START)).body.error).toBe('ASSIST_LEGAL_PROTECTION_OUT_OF_SCOPE');
      expect((await db.execute(sql`SELECT count(*)::int n FROM "AuthToken" WHERE "userId" IN (${P.id}, ${N.id}, ${M.id}) AND type = 'ASSIST_SESSION'`)).rows[0].n).toBe(0);
    });

    it('starts with consent + password: the cookie becomes the assisted session (≤ 1 h here), recorded as consent and in the history', async () => {
      const r = await assist(normal(P), START);
      expect(r.statusCode, JSON.stringify(r.body)).toBe(201);
      expect(r.body.session).toMatchObject({ areas: ['RDV', 'PARCOURS'], helper: { name: 'Marie Exemple', role: 'CONSEILLER_FRANCE_SERVICES', structureName: 'France Services Test', verifiedPro: false } });
      expect(String(r.headers['Set-Cookie'])).toMatch(/Max-Age=3600/);
      assisted = cookieOf(r);
      const claims = userAuth.verifyUserSessionToken(decodeURIComponent(assisted.split('=')[1]));
      expect(claims.assist).toMatchObject({ areas: ['RDV', 'PARCOURS'], pro: false, name: 'Marie Exemple' });
      const [tok] = (await db.execute(sql`SELECT "tokenHash" h, "expiresAt" e FROM "AuthToken" WHERE "userId" = ${P.id} AND type = 'ASSIST_SESSION'`)).rows;
      expect(tok.h).toMatch(/^assist:[0-9a-f]{64}$/); expect(tok.h).not.toContain(claims.assist.sid);
      expect(new Date(tok.e).getTime()).toBeLessThanOrEqual(Date.now() + 3600000 + 1000);
      const [c] = (await db.execute(sql`SELECT decision, proof_level FROM "ConsentLog" WHERE subject_id = ${P.id} AND purpose = 'ASSISTED_MODE'`)).rows;
      expect(c).toEqual({ decision: true, proof_level: 'PASSWORD_REAUTH' });
      expect((await auditOf(P.id)).map((a) => a.action)).toContain('ASSIST_STARTED');
      // a second start from the assisted session itself is refused
      expect((await assist(assisted, START)).body.error).toBe('ASSIST_ALREADY_ACTIVE');
    });

    it('the account\'s security, the delegations and the parts not opened are refused (403, logged); the opened parts are served and logged', async () => {
      for (const [path, method, body] of [['citizen/email-change', 'POST', { newEmail: 'x@example.test', password: PASSWORD }], ['auth/export-data', 'GET'], ['auth/delete-account', 'DELETE'],
        ['citizen/delegations', 'GET'], ['citizen/delegations', 'POST', { action: 'invite', email: 'y@example.test', role: 'AIDANT', scopes: ['RDV_READ'], days: 30 }], ['citizen/profile', 'GET'],
        ['citizen/coffre', 'GET'], ['citizen/restriction', 'POST', { action: 'request' }], ['citizen/phone', 'PUT', { phone: '0612345678' }]]) {
        const r = await http(path, { method, body, cookie: assisted });
        expect(r.statusCode, `${method} ${path}`).toBe(403); expect(r.body.error).toBe('ASSIST_NOT_ALLOWED');
      }
      expect((await db.execute(sql`SELECT count(*)::int n FROM "CitizenDelegation" WHERE "principalUserId" = ${P.id}`)).rows[0].n).toBe(0);
      expect((await http('citizen/espace', { cookie: assisted })).statusCode).toBe(200);
      const me = await http('auth/me', { cookie: assisted });
      expect(me.body.session.assist).toMatchObject({ helper: { name: 'Marie Exemple' }, areas: ['RDV', 'PARCOURS'] });
      expect((await http('citizen/parcours', { cookie: assisted })).statusCode).toBe(200);
      const st = await http('citizen/parcours', { method: 'POST', cookie: assisted, body: { action: 'status', id: ITEM, status: 'IN_PROGRESS' } });
      expect(st.statusCode, JSON.stringify(st.body)).toBe(200);
      const log = await auditOf(P.id);
      expect(log.filter((a) => a.action === 'ASSIST_REFUSED').length).toBeGreaterThanOrEqual(6);
      expect(log.find((a) => a.action === 'ASSIST_VIEW')?.details).toMatchObject({ area: 'PARCOURS' });
      expect(log.find((a) => a.action === 'ASSIST_ACTION')?.details).toMatchObject({ area: 'PARCOURS', label: 'PARCOURS_CHANGED', outcome: 200 });
    });

    it('a handler called directly (outside the router) refuses too (citizen handler wrapper, export, deletion)', async () => {
      const call = async (mod, method) => { const r = mk(); await (await import(mod)).default({ method, url: '/api/x', query: {}, body: {}, headers: { host: 'localhost', cookie: assisted } }, r); return r; };
      expect((await call('../../api/_handlers/citizen/profile.js', 'GET')).statusCode).toBe(403);
      expect((await call('../../api/_handlers/auth/export-data.js', 'GET')).statusCode).toBe(403);
      expect((await call('../../api/_handlers/auth/delete-account.js', 'DELETE')).statusCode).toBe(403);
    });

    it('the person sees « fait avec l\'aide de … »: helper, areas, views, actions, refusals — and in the assisted session only that session', async () => {
      const r = await http('citizen/assist', { cookie: assisted });
      expect(r.statusCode).toBe(200);
      expect(r.body.current).toMatchObject({ helper: { name: 'Marie Exemple' } });
      expect(r.body.sessions).toHaveLength(1);
      const s = r.body.sessions[0];
      expect(s).toMatchObject({ live: true, helper: { name: 'Marie Exemple', structureName: 'France Services Test' }, areas: ['RDV', 'PARCOURS'] });
      expect(s.events.map((e) => e.kind)).toEqual(expect.arrayContaining(['VIEW', 'ACTION', 'REFUSED']));
    });

    it('« continuer seul » needs the password (a wrong one ends nothing); « arrêter » signs out at once and the assisted cookie is dead', async () => {
      const wrong = await assist(assisted, { action: 'end', continueAlone: true, password: 'nope' });
      expect(wrong.statusCode).toBe(403);
      expect((await http('citizen/espace', { cookie: assisted })).statusCode).toBe(200);
      const end = await assist(assisted, { action: 'end' });
      expect(end.body).toMatchObject({ ended: true, signedOut: true });
      expect(String(end.headers['Set-Cookie'])).toMatch(/Max-Age=0/);
      const after = await http('citizen/espace', { cookie: assisted });
      expect(after.statusCode).toBe(401); expect(after.body.error).toBe('ASSIST_ENDED');
      expect((await auditOf(P.id)).filter((a) => a.action === 'ASSIST_ENDED').map((a) => a.details.by)).toEqual(['PERSON']);
    });

    it('« continuer seul » with the password gives a normal session back', async () => {
      const a = cookieOf(await assist(normal(P), { ...START, minutes: 30 }));
      const r = await assist(a, { action: 'end', continueAlone: true, password: PASSWORD });
      expect(r.body).toMatchObject({ ended: true, signedOut: false });
      const back = cookieOf(r);
      expect(userAuth.verifyUserSessionToken(decodeURIComponent(back.split('=')[1])).assist).toBeNull();
      expect((await http('citizen/profile', { cookie: back })).statusCode).toBe(200);
      expect((await http('citizen/espace', { cookie: a })).statusCode).toBe(401);
    });

    it('expires by itself, and can be ended from another (normal) session of the person', async () => {
      const a = cookieOf(await assist(normal(P), START));
      await db.execute(sql`UPDATE "AuthToken" SET "expiresAt" = NOW() - interval '1 second' WHERE "userId" = ${P.id} AND type = 'ASSIST_SESSION' AND "usedAt" IS NULL`);
      expect((await http('citizen/espace', { cookie: a })).statusCode).toBe(401);
      const b = cookieOf(await assist(normal(P), START));
      const list = await http('citizen/assist', { cookie: normal(P) });
      const live = list.body.sessions.filter((s) => s.live);
      expect(live).toHaveLength(1);
      expect((await assist(b, { action: 'end-session', sid: live[0].sid })).statusCode).toBe(403);   // not from the assisted session
      expect((await assist(normal(P), { action: 'end-session', sid: live[0].sid })).body).toMatchObject({ ended: true });
      expect((await http('citizen/espace', { cookie: b })).statusCode).toBe(401);
    });

    it('an ADA Pro helper only with a valid code of an ACTIVE member with MFA; the structure comes from the database; never Mon Coffre', async () => {
      expect((await svc.issueProHelperCode({ userId: PRO.id, structureId: STR, mfa: false })).code).toBe('PRO_MFA_REQUIRED');
      expect((await svc.issueProHelperCode({ userId: PRO_NOMFA.id, structureId: STR, mfa: true })).code).toBe('PRO_NOT_ELIGIBLE');
      const issued = await svc.issueProHelperCode({ userId: PRO.id, structureId: STR, mfa: true });
      expect(issued).toMatchObject({ ok: true, structureName: 'France Services Aid Test' }); expect(issued.code).toMatch(/^\d{4} \d{4}$/);
      expect((await assist(normal(P), { ...START, proEmail: PRO.email, proCode: '00000000' })).body.error).toBe('PRO_HELPER_NOT_VERIFIED');
      expect((await assist(normal(P), { ...START, proEmail: PRO_NOMFA.email, proCode: svc.proHelperCode(PRO_NOMFA.id) })).body.error).toBe('PRO_HELPER_NOT_VERIFIED');
      expect((await assist(normal(P), { ...START, areas: ['RDV', 'COFFRE'], proEmail: PRO.email, proCode: issued.code })).body.error).toBe('AREA_NOT_ALLOWED_FOR_PRO');
      const r = await assist(normal(P), { ...START, structureName: 'typed name ignored', proEmail: PRO.email.toUpperCase(), proCode: issued.code });
      expect(r.statusCode, JSON.stringify(r.body)).toBe(201);
      expect(r.body.session.helper).toMatchObject({ verifiedPro: true, structureName: 'France Services Aid Test' });
      const a = cookieOf(r);
      expect((await http('citizen/coffre', { cookie: a })).statusCode).toBe(403);
      // the professional's own trail says they helped someone, never who
      const [pro] = (await db.execute(sql`SELECT details FROM "AuditLog" WHERE action = 'ASSIST_PRO_HELPED' AND entity_id = ${PRO.id}`)).rows;
      expect(JSON.stringify(pro.details)).not.toContain(P.id);
      await assist(a, { action: 'end' });
    });

    it('signing out of an assisted session ends it in the history', async () => {
      const a = cookieOf(await assist(normal(P), START));
      const r = await http('auth/logout', { method: 'POST', cookie: a });
      expect(r.statusCode).toBe(200);
      expect((await auditOf(P.id)).filter((x) => x.action === 'ASSIST_ENDED').map((x) => x.details.by)).toContain('SIGN_OUT');
    });
  });

  describe('at a distance (trusted person)', () => {
    const DLG = `aid-dlg-${TS}`; const DLG_R = `aid-dlgr-${TS}`;
    const dlg = (u, body, query) => http('citizen/delegations', { method: body ? 'POST' : 'GET', cookie: normal(u), body, query });
    const ask = (u, body) => dlg(u, { action: 'request-action', ...body });
    beforeAll(async () => {
      await db.execute(sql`INSERT INTO "CitizenDelegation" (id, "principalUserId", "delegateUserId", "inviteEmail", role, scopes, status, "proofStatus", "expiresAt", "acceptedAt")
        VALUES (${DLG}, ${P.id}, ${D.id}, ${D.email}, 'AIDANT', '{RDV_READ,PARCOURS_READ}', 'ACTIVE', 'NOT_REQUIRED', NOW() + interval '30 days', NOW())`);
      await db.execute(sql`INSERT INTO "CitizenDelegation" (id, "principalUserId", "delegateUserId", "inviteEmail", role, scopes, status, "proofStatus", "expiresAt", "acceptedAt")
        VALUES (${DLG_R}, ${X.id}, ${D.id}, ${D.email}, 'AIDANT', '{RDV_READ}', 'ACTIVE', 'NOT_REQUIRED', NOW() + interval '30 days', NOW())`);
      await db.execute(sql`UPDATE "ProAppointment" SET status = 'confirmed' WHERE id IN (${APT}, ${APT_X})`);
      // G14: a delegate's Mon Parcours part (read, and so the requests on it) is open only with ADA_PARCOURS_DELEGATE_READ=on (limited contract)
      process.env.ADA_PARCOURS_DELEGATE_READ = 'on';
    });
    afterAll(() => { delete process.env.ADA_PARCOURS_DELEGATE_READ; });

    let pendingId;
    it('read-only by default: a request waits for the person (nothing done), shown to the person and in the notification centre', async () => {
      const r = await ask(D, { id: DLG, type: 'RDV_CANCEL', appointmentId: APT });
      expect(r.statusCode, JSON.stringify(r.body)).toBe(202);
      expect(r.body).toMatchObject({ executed: false });
      expect((await db.execute(sql`SELECT status FROM "ProAppointment" WHERE id = ${APT}`)).rows[0].status).toBe('confirmed');
      const list = await dlg(P);
      expect(list.body.actions).toMatchObject({ open: true, actForMe: { [DLG]: { RDV_READ: false, PARCOURS_READ: false } } });
      expect(list.body.requests).toEqual([expect.objectContaining({ delegationId: DLG, type: 'RDV_CANCEL', delegateEmail: D.email, target: expect.objectContaining({ appointmentId: APT, structure: 'France Services Aid Test' }) })]);
      pendingId = list.body.requests[0].id;
      const inbox = await http('citizen/notifications', { cookie: normal(P) });
      expect(inbox.body.notifications.map((n) => n.kind)).toContain('DELEGATION_ACTION_REQUEST');
      const [tok] = (await db.execute(sql`SELECT "tokenHash" h FROM "AuthToken" WHERE id = ${pendingId}`)).rows;
      expect(tok.h).toMatch(/^dlgact:[0-9a-f]{64}$/);
    });

    it('scope, ownership and sensitivity: unknown to the trusted person (no oracle), nothing stored', async () => {
      expect((await ask(X, { id: DLG, type: 'RDV_CANCEL', appointmentId: APT })).statusCode).toBe(404);   // not the delegate
      expect((await ask(D, { id: DLG, type: 'RDV_CANCEL', appointmentId: APT_X })).statusCode).toBe(404);   // someone else's appointment
      expect((await ask(D, { id: DLG, type: 'PARCOURS_STATUS', itemId: ITEM_S, status: 'CLOSED' })).statusCode).toBe(404);   // sensitive step (G8)
      expect((await ask(D, { id: DLG_R, type: 'PARCOURS_STATUS', itemId: ITEM, status: 'CLOSED' })).statusCode).toBe(403);   // part not shared
      expect((await ask(D, { id: DLG, type: 'DELETE_ACCOUNT' })).body.error).toBe('INVALID_ACTION');
      expect((await ask(D, { id: DLG, type: 'PARCOURS_STATUS', itemId: ITEM, status: 'BOGUS' })).body.error).toBe('INVALID_STATUS');
      expect((await dlg(P)).body.requests).toHaveLength(1);
    });

    it('the person confirms: done as their own decision (the appointment\'s own cancellation path), single use', async () => {
      expect((await dlg(X, { action: 'resolve-request', requestId: pendingId, accept: true })).statusCode).toBe(404);   // not the person
      const r = await dlg(P, { action: 'resolve-request', requestId: pendingId, accept: true });
      expect(r.statusCode, JSON.stringify(r.body)).toBe(200); expect(r.body.done).toBe(true);
      expect((await db.execute(sql`SELECT status, "cancelledBy" FROM "ProAppointment" WHERE id = ${APT}`)).rows[0]).toEqual({ status: 'cancelled', cancelledBy: 'USER' });
      expect((await dlg(P, { action: 'resolve-request', requestId: pendingId, accept: true })).body.error).toBe('REQUEST_NOT_FOUND');
    });

    it('the person refuses: nothing changes', async () => {
      const r = await ask(D, { id: DLG, type: 'PARCOURS_STATUS', itemId: ITEM, status: 'SUBMITTED' });
      expect(r.statusCode).toBe(202);
      const refused = await dlg(P, { action: 'resolve-request', requestId: r.body.request.id, accept: false });
      expect(refused.body.done).toBe(false);
      expect((await db.execute(sql`SELECT status FROM "ParcoursItem" WHERE id = ${ITEM}`)).rows[0].status).toBe('IN_PROGRESS');
    });

    it('an expired request cannot be confirmed', async () => {
      const r = await ask(D, { id: DLG, type: 'PARCOURS_STATUS', itemId: ITEM, status: 'READY' });
      await db.execute(sql`UPDATE "AuthToken" SET "expiresAt" = NOW() - interval '1 second' WHERE id = ${r.body.request.id}`);
      expect((await dlg(P, { action: 'resolve-request', requestId: r.body.request.id, accept: true })).body.error).toBe('REQUEST_NOT_FOUND');
    });

    it('« agir pour moi »: password re-entered, then executed at once and logged; withdrawn at once', async () => {
      expect((await dlg(P, { action: 'act-for-me', id: DLG, scope: 'PARCOURS_READ', on: true, password: 'nope' })).statusCode).toBe(403);
      expect((await dlg(P, { action: 'act-for-me', id: DLG, scope: 'COFFRE_LIST', on: true, password: PASSWORD })).body.error).toBe('INVALID_SCOPES');
      expect((await dlg(D, { action: 'act-for-me', id: DLG, scope: 'PARCOURS_READ', on: true, password: PASSWORD })).statusCode).toBe(404);   // only the person
      expect((await dlg(P, { action: 'act-for-me', id: DLG, scope: 'PARCOURS_READ', on: true, password: PASSWORD })).body).toMatchObject({ on: true });
      const r = await ask(D, { id: DLG, type: 'PARCOURS_STATUS', itemId: ITEM, status: 'SUBMITTED' });
      expect(r.body).toMatchObject({ executed: true, mode: 'ACT_FOR_ME' });
      expect((await db.execute(sql`SELECT status FROM "ParcoursItem" WHERE id = ${ITEM}`)).rows[0].status).toBe('SUBMITTED');
      expect((await dlg(P, { action: 'act-for-me', id: DLG, scope: 'PARCOURS_READ', on: false })).body).toMatchObject({ on: false });
      expect((await ask(D, { id: DLG, type: 'PARCOURS_STATUS', itemId: ITEM, status: 'READY' })).statusCode).toBe(202);
    });

    it('both sides see what happened (the person\'s log, the trusted person\'s own requests)', async () => {
      const log = await dlg(P, undefined, { log: DLG });
      expect(log.body.actionEvents.map((e) => e.event)).toEqual(expect.arrayContaining(['REQUESTED', 'CONFIRMED', 'REFUSED', 'EXECUTED']));
      const mine = await dlg(D, undefined, { requests: DLG });
      expect(mine.body.requests.map((x) => x.state)).toEqual(expect.arrayContaining(['DONE', 'REFUSED', 'EXPIRED', 'PENDING']));
      expect((await dlg(X, undefined, { requests: DLG })).statusCode).toBe(404);
    });

    it('revocation stops everything: no new request, a pending one cannot be confirmed', async () => {
      const pending = (await dlg(P)).body.requests.find((r) => r.delegationId === DLG);
      expect(pending).toBeTruthy();
      expect((await dlg(P, { action: 'end', id: DLG })).statusCode).toBe(200);
      expect((await ask(D, { id: DLG, type: 'PARCOURS_STATUS', itemId: ITEM, status: 'CLOSED' })).statusCode).toBe(404);
      expect((await dlg(P, { action: 'resolve-request', requestId: pending.id, accept: true })).body.error).toBe('DELEGATION_INACTIVE');
      expect((await db.execute(sql`SELECT status FROM "ParcoursItem" WHERE id = ${ITEM}`)).rows[0].status).toBe('SUBMITTED');
    });

    it('closed capability or closed part: nothing is read or written', async () => {
      const { requestAction } = await import('../../api/_services/delegation-actions.js');
      const r = await requestAction(D, { id: DLG_R, type: 'RDV_CANCEL', appointmentId: APT_X }, { isOpen: (c) => c !== 'citizen.assisted_mode' });
      expect(r).toMatchObject({ ok: false, status: 404, code: 'CAPABILITY_NOT_OPEN' });
      expect(await requestAction(D, { id: DLG_R, type: 'RDV_CANCEL', appointmentId: APT_X }, { isOpen: (c) => c !== 'citizen.booking' })).toMatchObject({ status: 404, code: 'CAPABILITY_NOT_OPEN' });
      const before = (await db.execute(sql`SELECT count(*)::int n FROM "AuthToken" WHERE type = 'DELEGATION_ACTION' AND "userId" = ${X.id}`)).rows[0].n;
      delete process.env.ADA_PARCOURS_DELEGATE_READ;
      await db.execute(sql`UPDATE "CitizenDelegation" SET scopes = '{RDV_READ,PARCOURS_READ}' WHERE id = ${DLG_R}`);
      expect((await ask(D, { id: DLG_R, type: 'PARCOURS_STATUS', itemId: ITEM, status: 'CLOSED' })).body.error).toBe('CAPABILITY_NOT_OPEN');
      expect((await db.execute(sql`SELECT count(*)::int n FROM "AuthToken" WHERE type = 'DELEGATION_ACTION' AND "userId" = ${X.id}`)).rows[0].n).toBe(before);
      process.env.ADA_PARCOURS_DELEGATE_READ = 'on';
    });
  });
});
