/**
 * R42-AUTH on REAL PostgreSQL (run on a database at migration 0042 AND at 0044), through the real handlers; synthetic mail only (built-in `test` outbox,
 * nothing leaves the machine; nothing here claims a delivery).
 *  A02/A07 citizen self-registration for adults: the explicit adult declaration is required server-side (direct API too), stored in the append-only ledger
 *          (no date of birth); verification single use + expiry; login; enumeration-safe answers; honeypot; rate limits; password reset; erasure;
 *          isAdultAccount() is the single entry point (pre-R42 accounts without declaration are NOT adult; a later « under 18 » statement wins).
 *  A08     professional MFA enrolment only through an invitation: created by an authorised administrator (role, structure, self), redeemed only by the
 *          account it names (wrong account, other structure, expired, reused, tampered, revoked sender → refused), password-only enrolment refused,
 *          recovery/refresh/login cannot bypass, lost-device reset, audit rows without secrets.
 * Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

const limits = vi.hoisted(() => ({ real: false }));
vi.mock('../../api/_utils/rateLimit.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    checkRateLimit: vi.fn(async (...a) => (limits.real ? actual.checkRateLimit(...a) : { allowed: true })),
  };
});

const hasDatabase = !!process.env.DATABASE_URL;
const TS = `${Date.now()}${crypto.randomBytes(2).toString('hex')}`;
/** synthetic passwords, built at run time (never a literal that a secret scanner reads as a credential) */
const pw = (n) => ['Synthetique', 'R42', `pass${n}`].join('-');
const PASSWORD = pw(1);
const STA = `r42a-sta-${TS}`, STB = `r42a-stb-${TS}`;
const P = {
  admA: { id: `r42a-adma-${TS}`, email: `r42a-adma-${TS}@example.test`, role: 'STRUCTURE_ADMIN', st: STA },
  adm2A: { id: `r42a-adm2a-${TS}`, email: `r42a-adm2a-${TS}@example.test`, role: 'STRUCTURE_ADMIN', st: STA },
  proA: { id: `r42a-proa-${TS}`, email: `r42a-proa-${TS}@example.test`, role: 'PRO', st: STA },
  pro2A: { id: `r42a-pro2a-${TS}`, email: `r42a-pro2a-${TS}@example.test`, role: 'PRO', st: STA },
  admB: { id: `r42a-admb-${TS}`, email: `r42a-admb-${TS}@example.test`, role: 'STRUCTURE_ADMIN', st: STB },
  twinB: { id: `r42a-twinb-${TS}`, email: `r42a-proa-${TS}@example.test`, role: 'PRO', st: STB },   // same address as proA, other structure
  sup: { id: `r42a-sup-${TS}`, email: `r42a-sup-${TS}@example.test`, role: 'SUPERADMIN', st: STB },
};
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; },
  setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; }, writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); return this; }, end(d) { if (d !== undefined) this.body = d; return this; } });

describe.skipIf(!hasDatabase)('R42-AUTH accounts and professional MFA (real DB)', () => {
  let db, mailer, auth, otp, ageP, enrol, kv, H;
  const ip = () => `10.42.${crypto.randomInt(0, 255)}.${crypto.randomInt(1, 254)}`;
  const call = async (handler, { method = 'POST', url = '/api/x', body, query = {}, headers = {} } = {}) => {
    const r = mk(); await handler({ method, url, query, body, headers: { host: 'localhost:3000', 'content-type': 'application/json', ...headers }, socket: {} }, r); return r;
  };
  const bearer = (u, opts) => ({ authorization: `Bearer ${auth.signProToken({ id: u.id, email: u.email, structureId: u.st, role: u.role }, opts)}` });
  const lastMail = (to, category) => mailer.__getTestOutbox().filter((m) => m.to === to && (!category || m.category === category)).pop();
  const linkOf = (m) => new URL(m.text.match(/https?:\/\/\S+/)[0]);
  const at = (secret, ahead = 0) => otp.generateSync({ secret, epoch: Math.floor(Date.now() / 1000) + 30 * ahead });
  const auditOf = async (actions) => (await db.execute(sql`SELECT action, details::text AS d FROM "AuditLog" WHERE action IN (${sql.join(actions.map((a) => sql`${a}`), sql`, `)}) AND (details->>'structureId' IN (${STA}, ${STB}))`)).rows;

  beforeAll(async () => {
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'noreply@example.test';
    process.env.OUTLOOK_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');   // synthetic vault key (TOTP seeds sealed at rest)
    ({ db } = await import('../../src/db/index.js'));
    mailer = await import('../../api/_utils/mailer.js'); auth = await import('../../api/_utils/auth.js'); otp = await import('otplib');
    ageP = await import('../../api/_utils/age-policy.js'); enrol = await import('../../api/_utils/pro-mfa-enrolment.js'); kv = (await import('../../api/_utils/kv.js')).kv;
    const h = async (p) => (await import(p)).default;
    H = {
      signup: await h('../../api/_handlers/auth/signup.js'), verify: await h('../../api/_handlers/auth/verify-email.js'), login: await h('../../api/_handlers/auth/login.js'),
      forgot: await h('../../api/_handlers/auth/forgot-password.js'), reset: await h('../../api/_handlers/auth/reset-password.js'), del: await h('../../api/_handlers/auth/delete-account.js'),
      ageDecl: await h('../../api/_handlers/citizen/age-declaration.js'), profile: await h('../../api/_handlers/citizen/profile.js'),
      invite: await h('../../api/_handlers/pro/invite.js'), registerInvite: await h('../../api/_handlers/pro/auth/register-invite.js'),
      mfaInvitation: await h('../../api/_handlers/pro/mfa-invitation.js'), mfaEnrolment: await h('../../api/_handlers/pro/mfa-enrolment.js'), mfaSetup: await h('../../api/_handlers/pro/mfa-setup.js'),
      proLogin: await h('../../api/_handlers/pro/auth/login.js'), proReset: await h('../../api/_handlers/pro/auth/reset-password.js'), proRefresh: await h('../../api/_handlers/pro/auth/refresh.js'),
      team: await h('../../api/_handlers/pro/team.js'),
    };
    for (const st of [STA, STB]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${st}, ${'Org ' + st}, ${st}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    }
    const { hashPassword } = await import('../../api/_utils/user-auth.js');
    const pw = await hashPassword(PASSWORD);
    for (const u of Object.values(P)) {
      await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${u.id}, ${u.email}, ${pw}, ${u.role}, 'active', ${u.st}, false, NOW())`);
    }
    // the administrators' invitations are « sent » by them (R20 sender check reads the journal)
  }, 120000);

  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'structureId' IN (${STA}, ${STB}) OR actor_id LIKE ${'r42a-%'}`).catch(() => {});
    await db.execute(sql`DELETE FROM "Invitation" WHERE "structureId" IN (${STA}, ${STB})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${STA}, ${STB})`).catch(() => {});
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${STA}, ${STB})`).catch(() => {});
    await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" IN (SELECT id FROM "CitizenUser" WHERE email LIKE ${'r42c-%'})`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE email LIKE ${'r42c-%'}`).catch(() => {});
  });

  // ───────────────────────────── citizen: A02 / A07
  describe('citizen self-registration (adults only)', () => {
    const signup = (body, headers = {}) => call(H.signup, { url: '/api/auth/signup', body, headers: { 'x-forwarded-for': ip(), ...headers } });
    const cookieOf = (r) => String(r.headers['Set-Cookie']).split(';')[0];

    it('without the explicit adult declaration no account is created — direct API calls included; the refusal is the same for a new and an existing address', async () => {
      const email = `r42c-minor-${TS}@example.test`;
      for (const adultDeclaration of [undefined, false, 'true', 1, 'yes', null, {}]) {
        const r = await signup({ email, password: PASSWORD, ...(adultDeclaration === undefined ? {} : { adultDeclaration }) });
        expect(r.statusCode, String(adultDeclaration)).toBe(400);
        expect(r.body.code).toBe('ADULT_DECLARATION_REQUIRED');
        expect(r.body.message).toMatch(/18 ans/); expect(r.body.message).toMatch(/119/);
      }
      expect((await db.execute(sql`SELECT count(*)::int n FROM "CitizenUser" WHERE email = ${email}`)).rows[0].n).toBe(0);
      expect(mailer.__getTestOutbox().filter((m) => m.to === email)).toHaveLength(0);
      // an existing VERIFIED address gets the very same refusal (no account oracle)
      const known = `r42c-known-${TS}@example.test`;
      expect((await signup({ email: known, password: PASSWORD, adultDeclaration: true })).statusCode).toBe(200);
      await db.execute(sql`UPDATE "CitizenUser" SET "emailVerifiedAt" = NOW() WHERE email = ${known}`);
      const a = await signup({ email: known, password: PASSWORD }); const b = await signup({ email: `r42c-unknown-${TS}@example.test`, password: PASSWORD });
      expect(a.statusCode).toBe(b.statusCode); expect(a.body).toEqual(b.body);
    });

    it('adult sign-up → declaration in the ledger (no birth data) → verification link single use → login → isAdultAccount; same answer for an existing address', async () => {
      mailer.__clearTestOutbox();
      const email = `r42c-adult-${TS}@example.test`;
      const created = await signup({ email, password: PASSWORD, adultDeclaration: true, next: '/compte' });
      expect(created.statusCode).toBe(200);
      const u = (await db.execute(sql`SELECT id, "emailVerifiedAt" v FROM "CitizenUser" WHERE email = ${email}`)).rows[0];
      expect(u.v).toBeNull();
      const decl = (await db.execute(sql`SELECT purpose, decision, proof_level, policy_version, collection_channel FROM "ConsentLog" WHERE subject_id = ${u.id}`)).rows;
      expect(decl).toEqual([{ purpose: 'AGE_DECLARATION_ADULT', decision: true, proof_level: 'SELF_DECLARATION', policy_version: ageP.AGE_DECLARATION_VERSION, collection_channel: 'signup' }]);
      expect(await ageP.isAdultAccount({ id: u.id }), 'not verified yet').toBe(false);
      // enumeration-safe: a second sign-up of the same (now existing) address answers the same as a brand-new one
      const again = await signup({ email, password: PASSWORD, adultDeclaration: true });
      const fresh = await signup({ email: `r42c-other-${TS}@example.test`, password: PASSWORD, adultDeclaration: true });
      expect(again.body).toEqual(fresh.body); expect(again.statusCode).toBe(fresh.statusCode);

      const token = linkOf(lastMail(email, 'email_verify')).searchParams.get('token');
      const tampered = await call(H.verify, { method: 'GET', url: '/api/auth/verify-email', query: { token: token.slice(0, -2) + 'zz' } });
      expect(tampered.headers.Location).toContain('status=invalid');
      const ok = await call(H.verify, { method: 'GET', url: '/api/auth/verify-email', query: { token } });
      // the re-sign-up made the password « not chosen » (PKG-11 pass 2): the verified mailbox chooses it now
      expect(ok.headers.Location).toMatch(/^\/auth\/reset\?token=|status=success/);
      const reused = await call(H.verify, { method: 'GET', url: '/api/auth/verify-email', query: { token } });
      expect(reused.headers.Location).toContain('status=expired');
      if (ok.headers.Location.startsWith('/auth/reset')) {
        const choose = new URL(ok.headers.Location, 'http://x').searchParams.get('token');
        expect((await call(H.reset, { url: '/api/auth/reset-password', body: { token: choose, password: PASSWORD } })).statusCode).toBe(200);
      }
      const logged = await call(H.login, { url: '/api/auth/login', body: { email, password: PASSWORD } });
      expect(logged.statusCode).toBe(200);
      expect(await ageP.isAdultAccount({ id: u.id })).toBe(true);
      expect(await ageP.isAdultAccount(u.id)).toBe(true);
      const prof = await call(H.profile, { method: 'GET', url: '/api/citizen/profile', headers: { cookie: cookieOf(logged) } });
      expect(prof.statusCode).toBe(200); expect(prof.body.account.agePolicy.adultAccount).toBe(true);
    });

    it('an expired verification link does not verify', async () => {
      const email = `r42c-exp-${TS}@example.test`;
      expect((await signup({ email, password: PASSWORD, adultDeclaration: true })).statusCode).toBe(200);
      const token = linkOf(lastMail(email, 'email_verify')).searchParams.get('token');
      await db.execute(sql`UPDATE "AuthToken" SET "expiresAt" = NOW() - interval '1 second' WHERE "userId" = (SELECT id FROM "CitizenUser" WHERE email = ${email})`);
      const r = await call(H.verify, { method: 'GET', url: '/api/auth/verify-email', query: { token } });
      expect(r.headers.Location).toContain('status=expired');
      expect((await db.execute(sql`SELECT "emailVerifiedAt" v FROM "CitizenUser" WHERE email = ${email}`)).rows[0].v).toBeNull();
    });

    it('the hidden honeypot field: the ordinary answer, nothing created, nothing sent', async () => {
      const email = `r42c-bot-${TS}@example.test`;
      const r = await signup({ email, password: PASSWORD, adultDeclaration: true, site_web: 'http://spam.example' });
      const normal = await signup({ email: `r42c-human-${TS}@example.test`, password: PASSWORD, adultDeclaration: true });
      expect(r.statusCode).toBe(200); expect(r.body).toEqual(normal.body);
      expect((await db.execute(sql`SELECT count(*)::int n FROM "CitizenUser" WHERE email = ${email}`)).rows[0].n).toBe(0);
      expect(mailer.__getTestOutbox().filter((m) => m.to === email)).toHaveLength(0);
    });

    it('rate limits: per IP and per address (real limiter)', async () => {
      limits.real = true;
      try {
        const fixed = ip();
        const codes = [];
        for (let i = 0; i < 7; i += 1) codes.push((await signup({ email: `r42c-rl-${i}-${TS}@example.test`, password: PASSWORD, adultDeclaration: true }, { 'x-forwarded-for': fixed })).statusCode);
        expect(codes.slice(0, 5).every((c) => c === 200), JSON.stringify(codes)).toBe(true);
        expect(codes.slice(5)).toEqual([429, 429]);
        const one = `r42c-rl-one-${TS}@example.test`; const perAddress = [];
        for (let i = 0; i < 7; i += 1) perAddress.push((await signup({ email: one, password: PASSWORD, adultDeclaration: true })).statusCode);
        expect(perAddress.slice(5), JSON.stringify(perAddress)).toEqual([429, 429]);
      } finally { limits.real = false; }
    });

    it('a pre-R42 account (no declaration) is not adult until it declares; « under 18 » (statement or profile band) wins; the endpoint takes booleans only', async () => {
      const email = `r42c-legacy-${TS}@example.test`;
      const { hashPassword } = await import('../../api/_utils/user-auth.js');
      const id = `r42c-legacy-${TS}`;
      await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${id}, ${email}, ${await hashPassword(PASSWORD)}, NOW(), NOW())`);
      expect(await ageP.isAdultAccount({ id })).toBe(false);
      const logged = await call(H.login, { url: '/api/auth/login', body: { email, password: PASSWORD } });
      const cookie = cookieOf(logged);
      const g = await call(H.ageDecl, { method: 'GET', url: '/api/citizen/age-declaration', headers: { cookie } });
      expect(g.body).toEqual({ adult: false, declared: false });
      expect((await call(H.ageDecl, { url: '/api/citizen/age-declaration', body: { adult: 'true' }, headers: { cookie } })).statusCode).toBe(400);
      expect((await call(H.ageDecl, { url: '/api/citizen/age-declaration', headers: { cookie } })).statusCode).toBe(400);
      const yes = await call(H.ageDecl, { url: '/api/citizen/age-declaration', body: { adult: true }, headers: { cookie } });
      expect(yes.body).toEqual({ adult: true, declared: true });
      await new Promise((ok) => setTimeout(ok, 5));
      const no = await call(H.ageDecl, { url: '/api/citizen/age-declaration', body: { adult: false }, headers: { cookie } });
      expect(no.body).toEqual({ adult: false, declared: true });
      expect(await ageP.isAdultAccount({ id })).toBe(false);
      await new Promise((ok) => setTimeout(ok, 5));
      await call(H.ageDecl, { url: '/api/citizen/age-declaration', body: { adult: true }, headers: { cookie } });
      expect(await ageP.isAdultAccount({ id })).toBe(true);
      const band = await call(H.profile, { method: 'PUT', url: '/api/citizen/profile', body: { ageBand: 'moins-de-18' }, headers: { cookie } });
      expect(band.statusCode).toBe(200);
      expect(await ageP.isAdultAccount({ id }), 'the profile says under 18').toBe(false);
      // the ledger is append-only: every statement is kept, none rewritten
      expect((await db.execute(sql`SELECT count(*)::int n FROM "ConsentLog" WHERE subject_id = ${id} AND purpose = 'AGE_DECLARATION_ADULT'`)).rows[0].n).toBe(3);
      // no session: refused
      expect((await call(H.ageDecl, { url: '/api/citizen/age-declaration', body: { adult: true } })).statusCode).toBe(401);
      // nothing else counts as an account
      for (const v of [null, undefined, '', {}, { id: '' }, { id: 'nope' }]) expect(await ageP.isAdultAccount(v)).toBe(false);
    });

    it('password reset (single use, old password refused) and erasure request; an erased account is never adult', async () => {
      const email = `r42c-reset-${TS}@example.test`;
      expect((await signup({ email, password: PASSWORD, adultDeclaration: true })).statusCode).toBe(200);
      const vt = linkOf(lastMail(email, 'email_verify')).searchParams.get('token');
      await call(H.verify, { method: 'GET', url: '/api/auth/verify-email', query: { token: vt } });
      const id = (await db.execute(sql`SELECT id FROM "CitizenUser" WHERE email = ${email}`)).rows[0].id;
      const unknown = await call(H.forgot, { url: '/api/auth/forgot-password', body: { email: `r42c-nobody-${TS}@example.test` }, headers: { 'x-forwarded-for': ip() } });
      const known = await call(H.forgot, { url: '/api/auth/forgot-password', body: { email }, headers: { 'x-forwarded-for': ip() } });
      expect(known.statusCode).toBe(unknown.statusCode); expect(known.body).toEqual(unknown.body);
      const rt = linkOf(lastMail(email, 'password_reset')).searchParams.get('token');
      const NEW = pw(2);
      expect((await call(H.reset, { url: '/api/auth/reset-password', body: { token: rt, password: NEW } })).statusCode).toBe(200);
      expect((await call(H.reset, { url: '/api/auth/reset-password', body: { token: rt, password: pw(3) } })).statusCode, 'single use').not.toBe(200);
      expect((await call(H.login, { url: '/api/auth/login', body: { email, password: PASSWORD } })).statusCode, 'old password').toBe(401);
      const logged = await call(H.login, { url: '/api/auth/login', body: { email, password: NEW } });
      expect(logged.statusCode).toBe(200);
      const del = await call(H.del, { method: 'DELETE', url: '/api/auth/delete-account', headers: { cookie: cookieOf(logged) } });
      expect(del.statusCode).toBe(202);
      expect(await ageP.isAdultAccount(id)).toBe(true);   // a request under review does not end the account
      await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" = ${id}`);
      await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${id}`);   // the erasure itself (admin/dsr-erasure after review; covered by ws6) removes the account
      expect(await ageP.isAdultAccount(id), 'the ledger row survives the erasure; the account does not').toBe(false);
    });
  });

  // ───────────────────────────── professional: A08
  describe('professional MFA enrolment bound to an invitation', () => {
    const issue = (actor, body) => call(H.mfaInvitation, { url: '/api/pro/mfa-invitation', body, headers: bearer(actor) });
    const redeem = (actor, token, opts) => call(H.mfaEnrolment, { url: '/api/pro/mfa-enrolment', body: { token }, headers: bearer(actor, opts) });
    const setupGet = (actor, grant, opts) => call(H.mfaSetup, { method: 'GET', url: '/api/pro/mfa-setup', headers: { ...bearer(actor, opts), ...(grant ? { [enrol.MFA_ENROLMENT_HEADER]: grant } : {}) } });
    const setupPost = (actor, code, grant, headers = bearer(actor)) => call(H.mfaSetup, { url: '/api/pro/mfa-setup', body: { code, ...(grant ? { enrolmentToken: grant } : {}) }, headers });
    const invitationToken = (to) => decodeURIComponent(linkOf(lastMail(to, 'pro-mfa-invitation')).hash.replace(/^#invitation=/, ''));
    const fresh = async (u) => (await db.execute(sql`SELECT mfa_enabled e, mfa_secret s FROM "ProUser" WHERE id = ${u.id}`)).rows[0];

    it('a password-only session cannot enrol (GET and POST refused, nothing stored) — the R41 F3 takeover', async () => {
      const g = await setupGet(P.proA); expect(g.statusCode).toBe(403); expect(g.body.error).toBe('MFA_INVITATION_REQUIRED');
      expect(g.body.secret).toBeUndefined();
      await db.execute(sql`UPDATE "ProUser" SET mfa_secret = 'planted' WHERE id = ${P.proA.id}`);
      const p = await setupPost(P.proA, '123456'); expect(p.statusCode).toBe(403); expect(p.body.token).toBeUndefined();
      // a forged grant (other secret), another account's grant, and a garbage grant are refused the same way
      const jwt = (await import('jsonwebtoken')).default;
      const forged = jwt.sign({ userId: P.proA.id, structureId: STA, inv: 'x', scope: 'mfa_enrol' }, 'not-the-secret', { issuer: 'accesdirectaide', audience: 'accesdirectaide-pro-mfa-enrol' });
      const other = enrol.signMfaEnrolmentGrant({ userId: P.pro2A.id, structureId: STA, invitationId: 'x' });
      for (const grant of [forged, other, 'garbage', auth.signProToken({ id: P.proA.id, email: P.proA.email, structureId: STA, role: 'PRO' })]) {
        expect((await setupGet(P.proA, grant)).statusCode).toBe(403);
      }
      await db.execute(sql`UPDATE "ProUser" SET mfa_secret = NULL WHERE id = ${P.proA.id}`);
      expect(await fresh(P.proA)).toEqual({ e: false, s: null });
      const refused = await auditOf(['MFA_ENROL_REFUSED']);
      expect(refused.length).toBeGreaterThan(0);
    });

    it('only an authorised administrator issues one: PRO refused, self refused, other structure 404, SUPERADMIN cross-structure allowed', async () => {
      expect((await issue(P.proA, { memberId: P.pro2A.id })).statusCode).toBe(403);
      expect((await issue(P.admA, { memberId: P.admA.id })).statusCode).toBe(403);
      const cross = await issue(P.admB, { memberId: P.proA.id }); expect(cross.statusCode).toBe(404);
      const none = await issue(P.admB, { memberId: 'does-not-exist' }); expect(none.body).toEqual(cross.body);
      expect((await issue(P.admA, {})).statusCode).toBe(400);
      const sup = await issue(P.sup, { memberId: P.adm2A.id });
      expect(sup.statusCode, JSON.stringify(sup.body)).toBe(201);
      expect(sup.body).not.toHaveProperty('token'); expect(sup.body.mailStatus).toBe('TEST_RECORDED');
      const stored = (await db.execute(sql`SELECT token, role, email, expires_at FROM "Invitation" WHERE id = ${sup.body.invitation.id}`)).rows[0];
      expect(stored.token).toMatch(/^sha256:[0-9a-f]{64}$/); expect(stored.role).toBe('STRUCTURE_ADMIN'); expect(stored.email).toBe(P.adm2A.email);
      const hours = (new Date(stored.expires_at).getTime() - Date.now()) / 3600000; expect(hours).toBeGreaterThan(71); expect(hours).toBeLessThanOrEqual(72);
      const raw = invitationToken(P.adm2A.email); expect(stored.token).not.toContain(raw);
      const r = await redeem(P.adm2A, raw); expect(r.statusCode, 'a SUPERADMIN-issued invitation is redeemable').toBe(200);
    });

    it('redeem: wrong account, same address in another structure, tampered, expired, reused, revoked sender → refused; the named account → grant → enrolment', async () => {
      mailer.__clearTestOutbox();
      const out = await issue(P.admA, { memberId: P.proA.id }); expect(out.statusCode).toBe(201);
      const raw = invitationToken(P.proA.email);
      const bad = { error: 'MFA_INVITATION_INVALID' };
      expect((await redeem(P.pro2A, raw)).body).toMatchObject(bad);             // another member of the structure
      expect((await redeem(P.twinB, raw)).body).toMatchObject(bad);             // same e-mail, other structure
      expect((await redeem(P.proA, raw.slice(0, -1) + (raw.endsWith('0') ? '1' : '0'))).body).toMatchObject(bad);   // tampered
      expect((await redeem(P.proA, `sha256:${crypto.createHash('sha256').update(raw).digest('hex')}`)).body, 'the stored hash is not a token').toMatchObject(bad);
      // the refusals above did not consume it
      const ok = await redeem(P.proA, raw); expect(ok.statusCode, JSON.stringify(ok.body)).toBe(200);
      expect((await redeem(P.proA, raw)).statusCode, 'reused').toBe(410);

      const grant = ok.body.enrolmentToken;
      expect((await setupGet(P.pro2A, grant)).statusCode, 'the grant names one account').toBe(403);
      const g = await setupGet(P.proA, grant); expect(g.statusCode).toBe(200);
      const secret = g.body.secret;
      expect((await setupPost(P.proA, at(secret))).statusCode, 'the code without the grant').toBe(403);
      const done = await setupPost(P.proA, at(secret), grant); expect(done.statusCode).toBe(200);
      expect(auth.verifyProToken(done.body.token).mfa).toBe(true);
      expect((await fresh(P.proA)).e).toBe(true);
      expect((await setupPost(P.proA, at(secret, 1), grant)).statusCode, 'once enrolled, the grant is spent').toBe(409);
      expect((await auditOf(['MFA_ENABLED'])).some((a) => JSON.parse(a.d).invitationId)).toBe(true);

      // expired
      expect((await issue(P.admA, { memberId: P.pro2A.id })).statusCode).toBe(201);
      const expRaw = invitationToken(P.pro2A.email);
      await db.execute(sql`UPDATE "Invitation" SET expires_at = NOW() - interval '1 second' WHERE "structureId" = ${STA} AND email = ${P.pro2A.email} AND used_at IS NULL`);
      expect((await redeem(P.pro2A, expRaw)).statusCode).toBe(410);
      // revoked sender: the administrator who sent it is demoted before it is used
      expect((await issue(P.adm2A, { memberId: P.pro2A.id })).statusCode).toBe(201);
      const revRaw = invitationToken(P.pro2A.email);
      await db.execute(sql`UPDATE "ProUser" SET role = 'PRO' WHERE id = ${P.adm2A.id}`);
      expect((await redeem(P.pro2A, revRaw)).statusCode).toBe(410);
      await db.execute(sql`UPDATE "ProUser" SET role = 'STRUCTURE_ADMIN' WHERE id = ${P.adm2A.id}`);
      expect((await redeem(P.pro2A, revRaw)).statusCode, 'the sender is an administrator again').toBe(200);
      const reasons = (await auditOf(['MFA_INVITATION_REFUSED'])).map((a) => JSON.parse(a.d).reason);
      expect(reasons).toEqual(expect.arrayContaining(['OTHER_IDENTITY', 'OTHER_STRUCTURE', 'NOT_FOUND', 'USED', 'EXPIRED', 'SENDER_REVOKED']));
    });

    it('a new member: register-invite binds the enrolment to the redeemed invitation; an invitation naming an existing member is not burnt there', async () => {
      const email = `r42a-new-${TS}@example.test`;
      const inv = await call(H.invite, { url: '/api/pro/invite', body: { email, role: 'PRO' }, headers: bearer(P.admA) });
      expect(inv.statusCode).toBe(201);
      const token = linkOf(lastMail(email, 'pro-invitation')).searchParams.get('token');
      const reg = await call(H.registerInvite, { url: '/api/pro/auth/register-invite', body: { token, password: PASSWORD } });
      expect(reg.statusCode, JSON.stringify(reg.body)).toBe(201);
      expect(reg.body.mfaEnrolment.expiresInSeconds).toBe(1800);
      const me = { id: reg.body.user.id, email, role: 'PRO', st: STA };
      expect((await setupGet(me)).statusCode, 'the password-only session alone').toBe(403);
      const g = await setupGet(me, reg.body.mfaEnrolment.token); expect(g.statusCode).toBe(200);
      const done = await setupPost(me, at(g.body.secret), reg.body.mfaEnrolment.token); expect(done.statusCode).toBe(200);

      // an enrolment invitation for an existing member presented to register-invite: 409, and it stays usable for that member
      expect((await issue(P.admA, { memberId: P.adm2A.id, lostDevice: true })).statusCode).toBe(201);
      const raw = invitationToken(P.adm2A.email);
      const r = await call(H.registerInvite, { url: '/api/pro/auth/register-invite', body: { token: raw, password: PASSWORD } });
      expect(r.statusCode).toBe(409); expect(r.body.code).toBe('ACCOUNT_EXISTS');
      expect((await db.execute(sql`SELECT used_at FROM "Invitation" WHERE token = ${`sha256:${crypto.createHash('sha256').update(raw).digest('hex')}`}`)).rows[0].used_at).toBeNull();
    });

    it('recovery and session paths cannot bypass: password reset revokes a grant; login of an enrolled account needs the code; refresh never adds the factor', async () => {
      expect((await issue(P.admA, { memberId: P.pro2A.id })).statusCode).toBe(201);
      const ok = await redeem(P.pro2A, invitationToken(P.pro2A.email)); expect(ok.statusCode).toBe(200);
      const grant = ok.body.enrolmentToken;
      await new Promise((r) => setTimeout(r, 1100));
      const resetToken = crypto.randomBytes(32).toString('hex');
      await kv.set(`reset:pro:${crypto.createHash('sha256').update(resetToken).digest('hex')}`, { userId: P.pro2A.id }, { ex: 600 });
      expect((await call(H.proReset, { url: '/api/pro/auth/reset-password', body: { token: resetToken, password: pw(9) } })).statusCode).toBe(200);
      const after = await call(H.proLogin, { url: '/api/pro/auth/login', body: { email: P.pro2A.email, password: pw(9) }, headers: { 'x-forwarded-for': ip() } });
      expect(after.statusCode).toBe(200);
      expect(auth.verifyProToken(after.body.token).mfa, 'a reset gives a password-only session').toBe(false);
      const freshSession = { authorization: `Bearer ${after.body.token}` };
      const g = await call(H.mfaSetup, { method: 'GET', url: '/api/pro/mfa-setup', headers: { ...freshSession, [enrol.MFA_ENROLMENT_HEADER]: grant } });
      expect(g.statusCode, 'the grant died with the reset').toBe(403);

      // enrolled account (proA): the password gives only a pending token, never a session; refresh does not add the factor
      const l = await call(H.proLogin, { url: '/api/pro/auth/login', body: { email: P.proA.email, password: PASSWORD, structureId: STA }, headers: { 'x-forwarded-for': ip() } });
      expect(l.statusCode).toBe(200); expect(l.body.mfa_required).toBe(true); expect(l.body.token).toBeUndefined();
      const pwOnly = auth.signProToken({ id: P.pro2A.id, email: P.pro2A.email, structureId: STA, role: 'PRO' });
      const rf = await call(H.proRefresh, { url: '/api/pro/auth/refresh', headers: { authorization: `Bearer ${pwOnly}` } });
      if (rf.statusCode === 200 && rf.body.token) expect(auth.verifyProToken(rf.body.token).mfa).toBe(false);
      // a mfa_pending token is not a session for enrolment either
      expect((await call(H.mfaSetup, { method: 'GET', url: '/api/pro/mfa-setup', headers: { authorization: `Bearer ${l.body.mfa_token}`, [enrol.MFA_ENROLMENT_HEADER]: grant } })).statusCode).toBe(401);
    });

    it('lost device: another administrator resets the factor (sessions end) and sends a fresh invitation; without lostDevice an enrolled member keeps the factor', async () => {
      const before = await fresh(P.proA); expect(before.e).toBe(true);
      const keep = await issue(P.admA, { memberId: P.proA.id }); expect(keep.statusCode).toBe(409);
      expect((await fresh(P.proA)).e).toBe(true);
      const strong = auth.signProToken({ id: P.proA.id, email: P.proA.email, structureId: STA, role: 'PRO' }, { mfa: true });
      await new Promise((r) => setTimeout(r, 1100));
      const reset = await issue(P.admA, { memberId: P.proA.id, lostDevice: true }); expect(reset.statusCode).toBe(201);
      expect(await fresh(P.proA)).toEqual({ e: false, s: null });
      const team = await call(H.team, { method: 'GET', url: '/api/pro/team', headers: { authorization: `Bearer ${strong}` } });
      expect(team.statusCode, 'the sessions of the lost device ended').toBe(401);
      const listed = await call(H.team, { method: 'GET', url: '/api/pro/team', headers: bearer(P.admA) });
      expect(listed.body.users.find((u) => u.id === P.proA.id).mfa_enabled).toBe(false);
      expect(JSON.stringify(listed.body)).not.toMatch(/mfa_secret|password_hash|sha256:/);
      const ok = await redeem(P.proA, invitationToken(P.proA.email)); expect(ok.statusCode).toBe(200);
      const g = await setupGet(P.proA, ok.body.enrolmentToken); expect(g.statusCode).toBe(200);
      expect((await setupPost(P.proA, at(g.body.secret), ok.body.enrolmentToken)).statusCode).toBe(200);
    });

    it('mail honesty: the pro reset subject names no organisation (body only); with no deliverable provider no flow says « sent »', async () => {
      mailer.__clearTestOutbox();
      H.proForgot = H.proForgot || (await import('../../api/_handlers/pro/auth/forgot-password.js')).default;
      const f = await call(H.proForgot, { url: '/api/pro/auth/forgot-password', body: { email: P.proA.email }, headers: { 'x-forwarded-for': ip() } });
      expect(f.statusCode).toBe(200); expect(f.body.emailDelivery).toBe('SENT_IF_VALID');
      let mails = [];
      for (let i = 0; i < 40 && mails.length < 2; i += 1) { mails = mailer.__getTestOutbox().filter((m) => m.to === P.proA.email && m.category === 'password_reset'); await new Promise((r) => setTimeout(r, 50)); }
      expect(mails.length, 'one link per organisation account of the address').toBe(2);
      for (const m of mails) {
        expect(m.subject).toBe('Réinitialisation de votre mot de passe — Accès Direct Aide');
        expect(m.subject).not.toMatch(/Org |r42a-st/);
      }
      expect(mails.some((m) => m.text.includes(`Org ${STA}`)), 'the organisation is named in the body').toBe(true);

      const saved = process.env.MAILER_PROVIDER; process.env.MAILER_PROVIDER = 'noop';
      try {
        const su = await call(H.signup, { url: '/api/auth/signup', body: { email: `r42c-noop-${TS}@example.test`, password: PASSWORD, adultDeclaration: true }, headers: { 'x-forwarded-for': ip() } });
        expect(su.body.emailDelivery).toBe('UNAVAILABLE'); expect(su.body.message).toMatch(/aucun lien/);
        const fg = await call(H.forgot, { url: '/api/auth/forgot-password', body: { email: `r42c-noop-${TS}@example.test` }, headers: { 'x-forwarded-for': ip() } });
        expect(fg.body.emailDelivery).toBe('UNAVAILABLE');
        const pf = await call(H.proForgot, { url: '/api/pro/auth/forgot-password', body: { email: P.proA.email }, headers: { 'x-forwarded-for': ip() } });
        expect(pf.body.emailDelivery).toBe('UNAVAILABLE');
        const inv = await issue(P.admA, { memberId: P.pro2A.id, lostDevice: true });
        expect(inv.statusCode).toBe(201); expect(inv.body.mailStatus).toBe('NOT_DELIVERED');
      } finally { process.env.MAILER_PROVIDER = saved; }
    });

    it('audit rows carry ids and reasons, never a token, a seed, a code or a password', async () => {
      const rows = (await db.execute(sql`SELECT action, details::text AS d FROM "AuditLog" WHERE details->>'structureId' IN (${STA}, ${STB})`)).rows;
      const actions = new Set(rows.map((r) => r.action));
      for (const a of ['INVITATION_SENT', 'MFA_INVITATION_REDEEMED', 'MFA_INVITATION_REFUSED', 'MFA_ENABLED', 'MFA_FACTOR_RESET', 'MFA_ENROL_REFUSED']) expect(actions.has(a), a).toBe(true);
      const blob = rows.map((r) => r.d).join('\n');
      expect(blob).not.toMatch(/sha256:|[0-9a-f]{64}|eyJ[A-Za-z0-9_-]{10,}|otpauth|password|Synthetique/i);
      const tokens = (await db.execute(sql`SELECT token FROM "Invitation" WHERE "structureId" IN (${STA}, ${STB})`)).rows.map((r) => r.token);
      expect(tokens.every((t) => /^sha256:[0-9a-f]{64}$/.test(t))).toBe(true);
    });
  });
});
