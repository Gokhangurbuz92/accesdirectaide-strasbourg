/**
 * G3 (19/11/2026, SD Track 2/3 gap A(c)) — the PARTIAL opening of ADA Pro, on REAL PostgreSQL, THROUGH THE REAL API ENTRY (api/index.js: CSRF, the restricted
 * beta surface gate and the R45 capability gate all run):
 *   ADA_PUBLIC_BETA_RESTRICTED=1, ADA_BETA_OPEN_SURFACES=admin,accounts,pro, NO ADA_CAPABILITIES_OPEN, NO HDS attestation, the second factor required
 *   (PRO_MFA_REQUIRED=true, as VERCEL_ENV=production does) — « pro open + every out-of-AIPD / HDS capability closed ».
 * Proven: platform invitation of a first structure administrator → invited sign-up WITH the professional terms (recorded, versioned) → MFA enrolment bound
 * to the invitation → sign-in with the code → structure administration works (team, structure, invitation of a member); case management, referrals, the
 * shared dossier, selections, messaging and the agenda answer 503 (capability or surface gate) and /api/pro/me says they are not open; nothing crosses to
 * another structure. Then the professional terms in a Production profile: refused (fail-closed) while no pro version is approved, accepted and recorded
 * with the approved version once one is named. Synthetic data only; the mailer is the in-memory « test » provider. Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = `${Date.now()}${crypto.randomBytes(2).toString('hex')}`;
const PLATFORM = `g3p-pf-${TS}`, PILOT = `g3p-pi-${TS}`, OTHER = `g3p-ot-${TS}`;
const OP = { id: `g3p-op-${TS}`, email: `g3p-op-${TS}@example.test`, st: PLATFORM, role: 'SUPERADMIN' };
const OA = { id: `g3p-oa-${TS}`, email: `g3p-oa-${TS}@example.test`, st: OTHER, role: 'STRUCTURE_ADMIN' };
const OM = { id: `g3p-om-${TS}`, email: `g3p-om-${TS}@example.test`, st: OTHER, role: 'PRO' };
const ADMIN_EMAIL = `g3p-first-admin-${TS}@example.test`;
const pw = (n) => ['Synthetique', 'G3P', `pass${n}`].join('-');
const PASSWORD = pw(1);
const CSRF = `g3pcsrf${TS}`;
const ENV_KEYS = ['ADA_PUBLIC_BETA_RESTRICTED', 'ADA_BETA_OPEN_SURFACES', 'ADA_BETA_ACCOUNTS_SCOPE', 'ADA_CAPABILITIES_OPEN', 'ADA_HDS_CERTIFIED_HOSTING', 'ADA_PRO_SELF_REGISTRATION',
  'PRO_MFA_REQUIRED', 'MAILER_PROVIDER', 'MAILER_FROM', 'OUTLOOK_TOKEN_ENCRYPTION_KEY', 'VERCEL_ENV', 'VITE_LEGAL_DOCS_APPROVED_VERSION'];
const PRO_ONLY = { ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'admin,accounts,pro', ADA_BETA_ACCOUNTS_SCOPE: undefined, ADA_CAPABILITIES_OPEN: undefined,
  ADA_HDS_CERTIFIED_HOSTING: undefined, ADA_PRO_SELF_REGISTRATION: undefined, PRO_MFA_REQUIRED: 'true', MAILER_PROVIDER: 'test', MAILER_FROM: 'qa@example.test' };
const setEnv = (vars) => { for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };

function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('G3 — ADA Pro opened alone: accounts, MFA and structure administration; every HDS / out-of-AIPD module closed (real API entry)', () => {
  let db, api, auth, mailer, otp, enrol;
  const saved = {};
  const J = {};
  const call = async (method, url, { bearer, body, headers = {} } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const h = { host: 'localhost:3000', 'x-forwarded-proto': 'http', cookie: `__csrf=${CSRF}`, 'x-csrf-token': CSRF, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...headers };
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, socket: {}, headers: h };
    const res = mkRes(); await api(req, res);
    await (await import('../../api/_utils/after-response.js')).settleAfterResponse();
    return res;
  };
  const sign = (u, mfa = true) => auth.signProToken({ id: u.id, email: u.email, structureId: u.st, role: u.role }, { mfa });
  const tokenFromMail = (to) => { const m = mailer.__getTestOutbox().filter((x) => x.to === to).pop(); expect(m, `invitation e-mail to ${to}`).toBeTruthy(); return new URL(m.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token'); };
  const at = (secret, ahead = 0) => otp.generateSync({ secret, epoch: Math.floor(Date.now() / 1000) + 30 * ahead });
  const ledger = async (userId) => (await db.execute(sql`SELECT subject_type, purpose, decision, policy_version, proof_level, collection_channel FROM "ConsentLog" WHERE subject_id = ${userId} ORDER BY purpose`)).rows;
  const invitationUsed = async (email) => (await db.execute(sql`SELECT used_at FROM "Invitation" WHERE email = ${email}`)).rows.map((r) => r.used_at !== null);

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    setEnv({ ...PRO_ONLY, OUTLOOK_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') });   // synthetic vault key (TOTP seeds sealed at rest)
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js'); mailer = await import('../../api/_utils/mailer.js');
    otp = await import('otplib'); enrol = await import('../../api/_utils/pro-mfa-enrolment.js');
    for (const [sid, statut, ver] of [[PLATFORM, 'brouillon', 'UNVERIFIED'], [PILOT, 'actif', 'VERIFIED'], [OTHER, 'actif', 'VERIFIED']]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${sid}, ${'G3 ' + sid}, ${sid + '-slug'}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], ${statut}, ${ver}, NOW(), NOW())`);
    }
    for (const u of [OP, OA, OM]) {
      await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", mfa_enabled, "notificationEmailEnabled", "updatedAt") VALUES (${u.id}, ${u.email}, 'x', ${u.role}, 'active', ${u.st}, true, false, NOW())`);
    }
    mailer.__clearTestOutbox();
  }, 90000);

  afterAll(async () => {
    try {
      if (!db) return;
      const all = [PLATFORM, PILOT, OTHER];
      const ids = (await db.execute(sql`SELECT id FROM "ProUser" WHERE "structureId" IN (${sql.join(all.map((x) => sql`${x}`), sql`, `)})`)).rows.map((r) => r.id);
      if (ids.length) await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_type = 'PRO_USER' AND subject_id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`).catch(() => {});
      await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'structureId' IN (${sql.join(all.map((x) => sql`${x}`), sql`, `)}) OR actor_id LIKE ${'g3p-%'}`).catch(() => {});
      await db.execute(sql`DELETE FROM "Invitation" WHERE "structureId" IN (${sql.join(all.map((x) => sql`${x}`), sql`, `)})`);
      await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${sql.join(all.map((x) => sql`${x}`), sql`, `)})`);
      await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${sql.join(all.map((x) => sql`${x}`), sql`, `)})`);
    } finally { setEnv(saved); }
  });

  it('platform invitation → invited sign-up only WITH the professional terms (recorded, versioned) → MFA enrolment → sign-in with the code', async () => {
    const inv = await call('POST', '/api/pro/invite', { bearer: sign(OP), body: { email: ADMIN_EMAIL, role: 'STRUCTURE_ADMIN', structure: PILOT } });
    expect(inv.statusCode, JSON.stringify(inv.body)).toBe(201);
    const token = tokenFromMail(ADMIN_EMAIL);

    const check = await call('GET', `/api/pro/auth/register-invite?token=${encodeURIComponent(token)}`);
    expect(check.statusCode).toBe(200);
    expect(check.body.terms).toEqual({ inForce: true, documents: ['cgu-professionnel', 'conditions-structures'] });

    for (const termsAccepted of [undefined, false, 'true', 1]) {
      const r = await call('POST', '/api/pro/auth/register-invite', { body: { token, password: PASSWORD, ...(termsAccepted === undefined ? {} : { termsAccepted }) } });
      expect(r.statusCode, String(termsAccepted)).toBe(400); expect(r.body.code).toBe('PRO_TERMS_ACCEPTANCE_REQUIRED');
    }
    expect(await invitationUsed(ADMIN_EMAIL), 'a refused sign-up does not consume the invitation').toEqual([false]);

    const reg = await call('POST', '/api/pro/auth/register-invite', { body: { token, password: PASSWORD, termsAccepted: true } });
    expect(reg.statusCode, JSON.stringify(reg.body)).toBe(201);
    J.admin = { id: reg.body.user.id, email: ADMIN_EMAIL, st: PILOT, role: 'STRUCTURE_ADMIN' };
    expect(reg.body.user).toMatchObject({ role: 'STRUCTURE_ADMIN', structureId: PILOT });
    const { LEGAL_DRAFTS_V8 } = await import('../../src/config/legal-drafts.js');
    expect(await ledger(J.admin.id)).toEqual([
      { subject_type: 'PRO_USER', purpose: 'TERMS_ACCEPTANCE_CGU_PROFESSIONNEL', decision: true, policy_version: `cgu-professionnel@${LEGAL_DRAFTS_V8}`, proof_level: 'CONTRACT_ACCEPTANCE', collection_channel: 'register-invite' },
      { subject_type: 'PRO_USER', purpose: 'TERMS_ACCEPTANCE_CONDITIONS_STRUCTURES', decision: true, policy_version: `conditions-structures@${LEGAL_DRAFTS_V8}`, proof_level: 'CONTRACT_ACCEPTANCE', collection_channel: 'register-invite' },
    ]);

    // the password-only session can only enrol the factor: /api/pro/me says so; every other console route refuses it
    const me0 = await call('GET', '/api/pro/me', { bearer: reg.body.token });
    expect(me0.statusCode).toBe(200); expect(me0.body.session).toEqual({ mfa: false, mfaRequired: true });
    expect((await call('GET', '/api/pro/team', { bearer: reg.body.token })).statusCode).toBe(403);

    const grant = reg.body.mfaEnrolment.token;
    const g = await call('GET', '/api/pro/mfa-setup', { bearer: reg.body.token, headers: { [enrol.MFA_ENROLMENT_HEADER]: grant } });
    expect(g.statusCode, JSON.stringify(g.body)).toBe(200);
    J.secret = g.body.secret;
    const done = await call('POST', '/api/pro/mfa-setup', { bearer: reg.body.token, body: { code: at(J.secret), enrolmentToken: grant } });
    expect(done.statusCode, JSON.stringify(done.body)).toBe(200);

    const login = await call('POST', '/api/pro/auth/login', { body: { email: ADMIN_EMAIL, password: PASSWORD } });
    expect(login.statusCode, JSON.stringify(login.body)).toBe(200);
    expect(login.body.mfa_required).toBe(true); expect(login.body.token).toBeUndefined();
    const v = await call('POST', '/api/pro/auth/mfa-verify', { body: { mfa_token: login.body.mfa_token, code: at(J.secret, 1) } });
    expect(v.statusCode, JSON.stringify(v.body)).toBe(200);
    expect(auth.verifyProToken(v.body.token).mfa).toBe(true);
    J.session = v.body.token;
  });

  it('/api/pro/me says which modules are open: account and structure administration yes; cases, referrals, dossiers, selections, agenda, messages, video no', async () => {
    const me = await call('GET', '/api/pro/me', { bearer: J.session });
    expect(me.statusCode).toBe(200);
    expect(me.body.modules).toEqual({ cases: false, referrals: false, selections: false, dossiers: false, agenda: false, outlook: false, video: false, messages: false,
      team: true, structure: true, reports: true, regional: true, audit: true });
    expect(JSON.stringify(me.body.modules)).not.toMatch(/HDS1|@|ADA_/);
  });

  it('structure administration works: team, structure record, reports, own audit trail, inviting a member', async () => {
    const team = await call('GET', '/api/pro/team', { bearer: J.session });
    expect(team.statusCode, JSON.stringify(team.body)).toBe(200);
    expect(team.body.users.map((u) => u.email)).toEqual([ADMIN_EMAIL]);
    const st = await call('GET', '/api/pro/structure', { bearer: J.session });
    expect(st.statusCode, JSON.stringify(st.body)).toBe(200);
    expect(st.body.structure.nom).toBe(`G3 ${PILOT}`); expect(st.body.canPropose).toBe(true);
    expect((await call('GET', '/api/pro/audit', { bearer: J.session })).statusCode).toBe(200);
    const member = await call('POST', '/api/pro/invite', { bearer: J.session, body: { email: `g3p-member-${TS}@example.test`, role: 'PRO' } });
    expect(member.statusCode, JSON.stringify(member.body)).toBe(201);
    expect((await db.execute(sql`SELECT "structureId" FROM "Invitation" WHERE email = ${`g3p-member-${TS}@example.test`}`)).rows[0].structureId).toBe(PILOT);
  });

  it('every HDS / out-of-AIPD module answers 503 (capability or surface gate), reads and writes alike, before its handler runs', async () => {
    const closed = [
      ['GET', '/api/pro/cases?scope=mine', 'CAPABILITY_NOT_OPEN', 'pro.case_management'],
      ['POST', '/api/pro/cases', 'CAPABILITY_NOT_OPEN', 'pro.case_management', { action: 'status', id: 'x', status: 'IN_PROGRESS' }],
      ['GET', '/api/pro/referrals?box=inbox', 'CAPABILITY_NOT_OPEN', 'pro.referrals'],
      ['POST', '/api/pro/referrals', 'CAPABILITY_NOT_OPEN', 'pro.referrals', { action: 'create' }],
      // the shared dossier belongs to the « documents » surface: refused there, before its capability (citizen.shared_dossier, HDS) is even read
      ['GET', '/api/pro/dossier?shareId=x', 'PUBLIC_BETA_RESTRICTED'],
      ['POST', '/api/pro/dossier/redeem', 'PUBLIC_BETA_RESTRICTED', undefined, { shareId: 'x', inviteToken: 'y' }],
      ['GET', '/api/pro/consent', 'CAPABILITY_NOT_OPEN', 'citizen.shared_dossier'],
      ['GET', '/api/pro/dossier-synthesis', 'CAPABILITY_NOT_OPEN', 'ai.processing'],
      ['GET', '/api/pro/selections', 'CAPABILITY_NOT_OPEN', 'pro.orientation_selections'],
      ['GET', '/api/pro/messages', 'PUBLIC_BETA_RESTRICTED'],
      ['GET', '/api/pro/appointments', 'PUBLIC_BETA_RESTRICTED'],
      ['GET', '/api/pro/slots', 'PUBLIC_BETA_RESTRICTED'],
      // « pro/services » belongs to the pro surface, but its capability pro.agenda follows « appointments »
      ['POST', '/api/pro/services', 'CAPABILITY_NOT_OPEN', 'pro.agenda', { name: 'x' }],
      ['GET', '/api/pro/outlook?action=status', 'PUBLIC_BETA_RESTRICTED'],
      ['GET', '/api/pro/appointments/visio', 'PUBLIC_BETA_RESTRICTED'],
    ];
    for (const [m, u, code, capability, body] of closed) {
      const r = await call(m, u, { bearer: J.session, body });
      expect([r.statusCode, r.body?.error], `${m} ${u}`).toEqual([503, code]);
      if (capability) expect(r.body.capability).toBe(capability);
    }
    // every routed pro path, swept: only the account and structure-administration routes are served; all others answer 503 before their handler
    const { routes } = await import('../../api/routes.js');
    const SERVED = /^pro\/(auth\/(forgot-password|login|logout|mfa-verify|proconnect|refresh|register-invite|reset-password)|me|mfa-(setup|enrolment|invitation)|notifications(\/unread-count)?|profile|audit|team(\/stats)?|invite|resend-invite|structure|reports|regional-stats|health-check|system-maintenance)$/;
    const paths = [...new Set(routes.map((r) => r.path).filter((p) => p.startsWith('pro/')))];
    expect(paths.length).toBeGreaterThan(40);
    for (const p of paths) {
      const r = await call('GET', `/api/${p}`, { bearer: J.session });
      const gated = r.statusCode === 503 && ['CAPABILITY_NOT_OPEN', 'PUBLIC_BETA_RESTRICTED'].includes(r.body?.error);   // (ProConnect answers its own 503: not connected)
      expect(gated, `${p} ${SERVED.test(p) ? 'is served' : 'is closed'} (${r.statusCode} ${r.body?.error})`).toBe(!SERVED.test(p));
    }
    // and public self-registration of a structure stays closed although « pro » is open
    expect((await call('POST', '/api/pro/auth/register', { body: { email: `g3p-self-${TS}@example.test`, password: PASSWORD } })).statusCode).toBe(503);
  });

  it('no cross-tenant access: the other structure\'s members and records are neither listed nor changeable', async () => {
    const team = await call('GET', '/api/pro/team', { bearer: J.session });
    expect(JSON.stringify(team.body)).not.toContain(OM.email);
    for (const body of [{ targetUserId: OM.id, role: 'STRUCTURE_ADMIN' }, { targetUserId: OM.id, canManageSchedule: true }, { targetUserId: OM.id, reactivate: true }]) {
      const r = await call('PATCH', '/api/pro/team', { bearer: J.session, body });
      expect(r.statusCode, JSON.stringify(body)).not.toBe(200);
    }
    const del = await call('DELETE', `/api/pro/team?userId=${OM.id}`, { bearer: J.session, body: { targetUserId: OM.id } });
    expect(del.statusCode).not.toBe(200);
    expect((await db.execute(sql`SELECT role, status, "structureId" FROM "ProUser" WHERE id = ${OM.id}`)).rows[0]).toEqual({ role: 'PRO', status: 'active', structureId: OTHER });
    // an ordinary administrator cannot invite into another structure (the platform rule is SUPERADMIN-only)
    const x = await call('POST', '/api/pro/invite', { bearer: J.session, body: { email: `g3p-x-${TS}@example.test`, role: 'STRUCTURE_ADMIN', structure: OTHER } });
    expect(x.statusCode).toBe(403);
    // the other structure's administrator sees only its own structure
    const ot = await call('GET', '/api/pro/structure', { bearer: sign(OA) });
    expect(ot.statusCode).toBe(200); expect(ot.body.structure.nom).toBe(`G3 ${OTHER}`);
    expect(JSON.stringify((await call('GET', '/api/pro/team', { bearer: sign(OA) })).body)).not.toContain(ADMIN_EMAIL);
  });

  it('Production profile: the invited sign-up is refused (fail-closed) while no professional terms version is approved; accepted and recorded once one is', async () => {
    const { LEGAL_DRAFTS_V6, LEGAL_DRAFTS_V7 } = await import('../../src/config/legal-drafts.js');
    const email = `g3p-prod-${TS}@example.test`;
    expect((await call('POST', '/api/pro/invite', { bearer: sign(J.admin), body: { email, role: 'PRO' } })).statusCode).toBe(201);
    const token = tokenFromMail(email);
    const prodEnv = (approved) => setEnv({ VERCEL_ENV: 'production', VITE_LEGAL_DOCS_APPROVED_VERSION: approved });
    try {
      // the citizen documents alone (Production today, 6B) or nothing approved: refused, nothing read, the invitation stays usable
      for (const approved of [undefined, `cgu-citoyen@${LEGAL_DRAFTS_V6},notice-confidentialite@${LEGAL_DRAFTS_V6}`, `cgu-professionnel@${LEGAL_DRAFTS_V7}`]) {
        prodEnv(approved);
        const g = await call('GET', `/api/pro/auth/register-invite?token=${encodeURIComponent(token)}`);
        expect(g.statusCode).toBe(200); expect(g.body.terms.inForce, String(approved)).toBe(false);
        const r = await call('POST', '/api/pro/auth/register-invite', { body: { token, password: PASSWORD, termsAccepted: true } });
        expect([r.statusCode, r.body.code], String(approved)).toEqual([503, 'PRO_TERMS_NOT_IN_FORCE']);
        expect(r.body.error).toMatch(/pas encore en vigueur/);
      }
      expect(await invitationUsed(email)).toEqual([false]);
      expect((await db.execute(sql`SELECT count(*)::int n FROM "ProUser" WHERE email = ${email}`)).rows[0].n).toBe(0);
      // once the owner names the professional documents (and the notice), the sign-up records THE APPROVED version
      prodEnv(`cgu-citoyen@${LEGAL_DRAFTS_V6},cgu-professionnel@${LEGAL_DRAFTS_V6},conditions-structures@${LEGAL_DRAFTS_V6},notice-confidentialite@${LEGAL_DRAFTS_V6}`);
      const ok = await call('POST', '/api/pro/auth/register-invite', { body: { token, password: PASSWORD, termsAccepted: true } });
      expect(ok.statusCode, JSON.stringify(ok.body)).toBe(201);
      expect((await ledger(ok.body.user.id)).map((x) => [x.purpose, x.policy_version])).toEqual([['TERMS_ACCEPTANCE_CGU_PROFESSIONNEL', `cgu-professionnel@${LEGAL_DRAFTS_V6}`]]);
    } finally { setEnv({ VERCEL_ENV: saved.VERCEL_ENV, VITE_LEGAL_DOCS_APPROVED_VERSION: saved.VITE_LEGAL_DOCS_APPROVED_VERSION }); }
  });
});
