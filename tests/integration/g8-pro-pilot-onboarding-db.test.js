/**
 * G8 (19/11/2026) — functional acceptance of a REAL pilot-partner onboarding of ADA Pro + Espace Structures, on REAL PostgreSQL, THROUGH THE REAL API ENTRY
 * (api/index.js: CSRF, restricted beta surface gate, R45 capability gate), with the configuration a narrow Production opening would have:
 *   ADA_PUBLIC_BETA_RESTRICTED=1, ADA_BETA_OPEN_SURFACES=admin,accounts,pro, NO ADA_CAPABILITIES_OPEN, NO HDS attestation, PRO_MFA_REQUIRED=true, the
 *   approved legal list of Production G7 (cgu-citoyen v7, notice / cgu-professionnel / conditions-structures v8) and VERCEL_ENV=production for the sign-ups.
 * The journey, step by step (runbook CONTROL/master/completion/G8_PRO_PILOT_RUNBOOK_FR.md):
 *   1. ADA (/admin, MFA) verifies the partner's identity on an official source and activates it — before that, no first administrator can be invited;
 *   2. the first platform SUPERADMIN is created by the owner's CLI (scripts/pro-superadmin-bootstrap.mjs, a child process as the owner runs it), signs in
 *      password-only (nothing but the enrolment is reachable), redeems the enrolment link, enrols the factor, signs in with the code;
 *   3. platform invitation of the partner's STRUCTURE_ADMIN → invited sign-up with the professional terms (document@version recorded) → factor → code;
 *   4. the administrator upkeeps the directory record (proposal → ADA review → published), the public profile, invites a PRO member;
 *   5. the PRO member signs up (cgu-professionnel only), enrols, signs in; what each role can do with referrals / cases / agenda closed;
 *   6. every HDS / out-of-AIPD module is closed (503) and no beneficiary data is reachable from any served route, the export included;
 *   7. the audit trail of the whole journey (ADA journal + the structure's own journal);
 *   8. offboarding: a member disabled (session ends, sign-in refused), the structure administrator replaced (platform invitation of a successor who disables
 *      the former), the end of the agreement (ADA opens the closure; two reviewers; members anonymised; nobody of the structure gets in).
 * Synthetic identities only; the mailer is the in-memory « test » provider. Skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pro-rdv-rate-limit.js', () => ({ enforceProRdvRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));
vi.mock('../../api/lib/search-cache.js', () => ({ bumpContentEpoch: vi.fn().mockResolvedValue({ bumped: false }) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = `${Date.now()}${crypto.randomBytes(2).toString('hex')}`;
const PILOT = `g8p-pilot-${TS}`, OTHER = `g8p-other-${TS}`;
const SUPER_EMAIL = `g8p-exploitation-${TS}@example.test`;
const ADMIN_EMAIL = `g8p-admin-${TS}@example.test`, MEMBER_EMAIL = `g8p-membre-${TS}@example.test`, SUCCESSOR_EMAIL = `g8p-admin2-${TS}@example.test`;
const ADA = [`g8p-ada-1-${TS}@example.test`, `g8p-ada-2-${TS}@example.test`];
const CIT = { id: `g8p-cit-${TS}`, email: `g8p-beneficiaire-${TS}@example.test` };
const DOSSIER = `g8p-dossier-${TS}`;
const pw = (n) => ['Synthetique', 'G8P', `Pass${n}word`].join('-');
const CSRF = `g8pcsrf${TS}`;
const ENV_KEYS = ['ADA_PUBLIC_BETA_RESTRICTED', 'ADA_BETA_OPEN_SURFACES', 'ADA_BETA_ACCOUNTS_SCOPE', 'ADA_CAPABILITIES_OPEN', 'ADA_HDS_CERTIFIED_HOSTING', 'ADA_PRO_SELF_REGISTRATION',
  'PRO_MFA_REQUIRED', 'MAILER_PROVIDER', 'MAILER_FROM', 'OUTLOOK_TOKEN_ENCRYPTION_KEY', 'VERCEL_ENV', 'VITE_LEGAL_DOCS_APPROVED_VERSION'];
const setEnv = (vars) => { for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };

function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe.skipIf(!hasDatabase)('G8 — pilot partner onboarding of ADA Pro, end to end (real API entry, real DB, narrow pro opening)', () => {
  let db, api, auth, mailer, otp, legal, tmp;
  const saved = {};
  const J = {};   // the journey's state: accounts, secrets, sessions
  const call = async (method, url, { bearer, body, headers = {} } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const h = { host: 'localhost:3000', 'x-forwarded-proto': 'http', cookie: `__csrf=${CSRF}`, 'x-csrf-token': CSRF, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...headers };
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, socket: {}, headers: h };
    const res = mkRes(); await api(req, res);
    await (await import('../../api/_utils/after-response.js')).settleAfterResponse();
    return res;
  };
  const ada = (i, mfa = true) => auth.signAdminSessionToken({ email: ADA[i], role: 'admin', mfa_verified: mfa });
  const at = (secret, ahead = 0) => otp.generateSync({ secret, epoch: Math.floor(Date.now() / 1000) + 30 * ahead });
  const tokenFromMail = (to) => { const m = mailer.__getTestOutbox().filter((x) => x.to === to).pop(); expect(m, `invitation e-mail to ${to}`).toBeTruthy(); return new URL(m.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token'); };
  const ledger = async (userId) => (await db.execute(sql`SELECT purpose, policy_version, proof_level FROM "ConsentLog" WHERE subject_type = 'PRO_USER' AND subject_id = ${userId} ORDER BY purpose`)).rows;
  const audit = async (pred) => (await db.execute(sql`SELECT action, actor_id, entity, entity_id, details FROM "AuditLog" WHERE ${pred} ORDER BY "timestamp", id`)).rows;
  const prodSignUp = () => setEnv({ VERCEL_ENV: 'production' });
  const labAgain = () => setEnv({ VERCEL_ENV: saved.VERCEL_ENV });
  /** sign-in with password then the TOTP code; returns the second-factor session */
  const signIn = async (email, password, secret, ahead) => {
    const login = await call('POST', '/api/pro/auth/login', { body: { email, password } });
    expect(login.statusCode, JSON.stringify(login.body)).toBe(200);
    expect(login.body.mfa_required, `${email}: the password alone opens nothing`).toBe(true); expect(login.body.token).toBeUndefined();
    const v = await call('POST', '/api/pro/auth/mfa-verify', { body: { mfa_token: login.body.mfa_token, code: at(secret, ahead) } });
    expect(v.statusCode, JSON.stringify(v.body)).toBe(200);
    expect(auth.verifyProToken(v.body.token).mfa).toBe(true);
    return v.body.token;
  };
  /** invited sign-up with the terms, then the factor bound to the invitation; returns { id, secret } */
  const redeem = async (token, password, expectedDocs) => {
    const check = await call('GET', `/api/pro/auth/register-invite?token=${encodeURIComponent(token)}`);
    expect(check.statusCode).toBe(200);
    expect(check.body.terms).toEqual({ inForce: true, documents: expectedDocs });
    const refused = await call('POST', '/api/pro/auth/register-invite', { body: { token, password } });
    expect([refused.statusCode, refused.body.code]).toEqual([400, 'PRO_TERMS_ACCEPTANCE_REQUIRED']);
    prodSignUp();
    let reg;
    try { reg = await call('POST', '/api/pro/auth/register-invite', { body: { token, password, termsAccepted: true } }); } finally { labAgain(); }
    expect(reg.statusCode, JSON.stringify(reg.body)).toBe(201);
    // password-only session: the console refuses it; only the enrolment is possible
    const me0 = await call('GET', '/api/pro/me', { bearer: reg.body.token });
    expect(me0.body.session).toEqual({ mfa: false, mfaRequired: true });
    for (const p of ['/api/pro/team', '/api/pro/structure', '/api/pro/audit']) expect((await call('GET', p, { bearer: reg.body.token })).statusCode, p).toBe(403);
    const grant = reg.body.mfaEnrolment.token;
    const g = await call('GET', '/api/pro/mfa-setup', { bearer: reg.body.token, headers: { 'x-ada-mfa-enrolment': grant } });
    expect(g.statusCode, JSON.stringify(g.body)).toBe(200);
    const done = await call('POST', '/api/pro/mfa-setup', { bearer: reg.body.token, body: { code: at(g.body.secret), enrolmentToken: grant } });
    expect(done.statusCode, JSON.stringify(done.body)).toBe(200);
    return { id: reg.body.user.id, secret: g.body.secret, role: reg.body.user.role };
  };

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    ({ db } = await import('../../src/db/index.js'));
    legal = await import('../../src/config/legal-drafts.js');
    setEnv({ ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'admin,accounts,pro', ADA_BETA_ACCOUNTS_SCOPE: undefined, ADA_CAPABILITIES_OPEN: undefined,
      ADA_HDS_CERTIFIED_HOSTING: undefined, ADA_PRO_SELF_REGISTRATION: undefined, PRO_MFA_REQUIRED: 'true', MAILER_PROVIDER: 'test', MAILER_FROM: 'qa@example.test',
      OUTLOOK_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
      // Production G7's approved list, exactly as named there (id@version)
      VITE_LEGAL_DOCS_APPROVED_VERSION: `cgu-citoyen@${legal.LEGAL_DRAFTS_V7},notice-confidentialite@${legal.LEGAL_DRAFTS_V8},cgu-professionnel@${legal.LEGAL_DRAFTS_V8},conditions-structures@${legal.LEGAL_DRAFTS_V8}` });
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js'); mailer = await import('../../api/_utils/mailer.js');
    otp = await import('otplib');
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g8p-'));
    // the partner as the directory holds it before onboarding: an official record, not yet verified by ADA, not active
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, horaires, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, data_origin, source_url, "updatedAt", "createdAt")
      VALUES (${PILOT}, 'Association pilote G8 (synthétique)', ${PILOT}, 'association', '1 rue du Test', 'Strasbourg', '67000', 'Lundi 9h-12h', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'brouillon', 'UNVERIFIED', 'official', 'https://annuaire.service-public.fr/test-g8', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${OTHER}, 'Autre structure G8', ${OTHER}, 'association', '2 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    // a beneficiary who shared a dossier with the partner (closed functions): nothing of it may be reachable from the opened console
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${CIT.id}, ${CIT.email}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId")
      VALUES (${DOSSIER}, NOW() + interval '30 days', ${JSON.stringify({ prenom: 'Beneficiaire-G8' })}::jsonb, '{}'::jsonb, 0, ${'h' + TS}, ${'t' + TS}, 'GUEST_SHARE', ${CIT.id})`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", mfa_enabled, "notificationEmailEnabled", "updatedAt") VALUES (${'g8p-om-' + TS}, ${'g8p-om-' + TS + '@example.test'}, 'x', 'PRO', 'active', ${OTHER}, true, false, NOW())`);
    await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", "grantedVia") VALUES (${'g8p-grant-' + TS}, ${DOSSIER}, ${PILOT}, ${'g8p-om-' + TS}, 'referral')`);
    mailer.__clearTestOutbox();
  }, 120000);

  afterAll(async () => {
    try {
      if (!db) return;
      const sts = [PILOT, OTHER, ...(J.platformCreated ? [J.platformStructureId] : [])];
      const inSts = sql.join(sts.map((x) => sql`${x}`), sql`, `);
      const ids = (await db.execute(sql`SELECT id FROM "ProUser" WHERE "structureId" IN (${inSts})`)).rows.map((r) => r.id);
      const inIds = ids.length ? sql.join(ids.map((x) => sql`${x}`), sql`, `) : sql`NULL`;
      await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_type = 'PRO_USER' AND subject_id IN (${inIds})`).catch(() => {});
      await db.execute(sql`DELETE FROM "AuditLog" WHERE details->>'structureId' IN (${inSts}) OR entity_id IN (${inSts}) OR actor_id IN (${inIds}) OR actor_id LIKE ${'g8p-%'}`).catch(() => {});
      await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" IN (${inSts})`).catch(() => {});
      await db.execute(sql`DELETE FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${DOSSIER}`).catch(() => {});
      await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${DOSSIER}`).catch(() => {});
      await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${CIT.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "Invitation" WHERE "structureId" IN (${inSts})`).catch(() => {});
      await db.execute(sql`DELETE FROM "Notification" WHERE "structureId" IN (${inSts})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProProfile" WHERE "proUserId" IN (${inIds})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" IN (${inSts})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ContentVerification" WHERE "entityId" IN (${inSts})`).catch(() => {});
      await db.execute(sql`DELETE FROM "ContentVersion" WHERE "entityId" IN (${inSts})`).catch(() => {});
      await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${inSts})`).catch(() => {});
    } finally { setEnv(saved); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  it('1. ADA verifies the partner\'s identity on an official source (MFA) and activates it; until both are done no first administrator can be invited', async () => {
    const list = await call('GET', `/api/admin/organizations?q=${encodeURIComponent('pilote G8')}`, { bearer: ada(0) });
    expect(list.statusCode, JSON.stringify(list.body)).toBe(200);
    // G8: the card gives the identifier and the short address the platform invitation asks for (ADA Pro → Équipe → « Structure partenaire »)
    expect(list.body.organizations.find((o) => o.id === PILOT)).toMatchObject({ slug: PILOT, statut: 'brouillon', identity: 'UNVERIFIED', canReceiveNew: false, activeMembers: 0 });
    const read = await call('GET', `/api/admin/content-verification?entityType=structure&entityId=${PILOT}`, { bearer: ada(0) });
    expect(read.statusCode).toBe(200);
    const verify = { entityType: 'structure', entityId: PILOT, action: 'VERIFY', sourceUrl: 'https://annuaire.service-public.fr/test-g8', territoryConfirmed: true, expectedVersion: read.body.version,
      evidenceNote: 'Identité, SIREN et adresse vérifiés sur l’Annuaire de l’administration ; convention pilote signée.' };
    expect((await call('POST', '/api/admin/content-verification', { bearer: ada(0, false), body: verify })).statusCode, 'no decision without MFA').toBe(403);
    const v = await call('POST', '/api/admin/content-verification', { bearer: ada(0), body: verify });
    expect(v.statusCode, JSON.stringify(v.body)).toBe(200);
    expect((await call('POST', '/api/admin/organizations', { bearer: ada(0, false), body: { id: PILOT, action: 'REACTIVATE', reason: 'Convention pilote signée.' } })).statusCode).toBe(403);
    // verified but still a draft: the platform invitation is refused later (asserted in step 3 before activation)
    J.activate = async () => {
      const a = await call('POST', '/api/admin/organizations', { bearer: ada(0), body: { id: PILOT, action: 'REACTIVATE', reason: 'Convention pilote signée le 19/11/2026.' } });
      expect(a.statusCode, JSON.stringify(a.body)).toBe(200);
    };
    const row = (await db.execute(sql`SELECT statut, verification_status, verified_by FROM "Structure" WHERE id = ${PILOT}`)).rows[0];
    expect(row).toEqual({ statut: 'brouillon', verification_status: 'VERIFIED', verified_by: ADA[0] });
  });

  it('2. the owner creates the first SUPERADMIN with the CLI; password-only it reaches nothing but the enrolment; then factor and code', async () => {
    const u = new URL(process.env.DATABASE_URL);
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase(); const dbName = decodeURIComponent(u.pathname.slice(1));
    const before = Number((await db.execute(sql`SELECT count(*)::int AS n FROM "ProUser" WHERE upper(role) = 'SUPERADMIN'`)).rows[0].n);
    const linkFile = path.join(tmp, 'lien-activation.txt');
    const r = spawnSync(process.execPath, ['scripts/pro-superadmin-bootstrap.mjs', '--confirm-host', host, '--confirm-database', dbName, '--email', SUPER_EMAIL, '--name', 'Titulaire Exploitation G8',
      '--attest-one-account', '--link-file', linkFile], { input: `${pw(0)}\n${pw(0)}\n`, encoding: 'utf8', timeout: 60000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TZ: 'Europe/Paris', DATABASE_URL: process.env.DATABASE_URL, APP_BASE_URL: 'http://localhost:5285' } });
    let enrolLink;
    if (before === 0) {
      expect(r.stderr).toBe(''); expect(r.status).toBe(0);
      for (const secret of [pw(0), process.env.DATABASE_URL]) expect(r.stdout).not.toContain(secret);
      enrolLink = fs.readFileSync(linkFile, 'utf8').trim();
      expect(r.stdout).not.toContain(enrolLink);
      const [s] = (await db.execute(sql`SELECT u.id, u."structureId", u.mfa_enabled, s.statut, s.verification_status FROM "ProUser" u JOIN "Structure" s ON s.id = u."structureId" WHERE u.email = ${SUPER_EMAIL}`)).rows;
      expect(s).toMatchObject({ mfa_enabled: false, statut: 'brouillon', verification_status: 'UNVERIFIED' });
      J.super = { id: s.id, email: SUPER_EMAIL, st: s.structureId };
      J.platformStructureId = s.structureId; J.platformCreated = true;
      expect((await audit(sql`action = 'PRO_SUPERADMIN_BOOTSTRAP' AND entity_id = ${s.id}`)).length).toBe(1);
      // one-time: a second run is refused
      const again = spawnSync(process.execPath, ['scripts/pro-superadmin-bootstrap.mjs', '--confirm-host', host, '--confirm-database', dbName, '--email', `x-${SUPER_EMAIL}`, '--name', 'Autre Personne',
        '--attest-one-account', '--link-file', path.join(tmp, 'second.txt')], { input: `${pw(0)}\n${pw(0)}\n`, encoding: 'utf8', timeout: 60000,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, DATABASE_URL: process.env.DATABASE_URL, APP_BASE_URL: 'http://localhost:5285' } });
      expect(again.status).toBe(1); expect(again.stderr).toContain('SUPERADMIN existe déjà');
    } else {
      // shared integration database where another suite holds a SUPERADMIN: the CLI must refuse (one-time); the journey continues with an equivalent account
      expect(r.status).toBe(1); expect(r.stderr).toContain('SUPERADMIN existe déjà');
      const mod = await import('../../scripts/pro-superadmin-bootstrap.mjs');
      const { hashPassword } = await import('../../api/_utils/password-hash.js'); const { hashInviteToken, newInviteToken } = await import('../../api/_utils/invite-token.js');
      const id = `g8p-super-${TS}`; const token = newInviteToken();
      J.platformStructureId = `g8p-platform-${TS}`; J.platformCreated = true;
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, services, publics_accueillis, categories_aidees, statut, is_pro_enabled, "createdAt", "updatedAt") VALUES (${J.platformStructureId}, 'G8 plateforme', ${J.platformStructureId}, '{}', '{}', '{}', 'brouillon', false, NOW(), NOW())`);
      await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", mfa_enabled, "updatedAt") VALUES (${id}, ${SUPER_EMAIL}, ${await hashPassword(pw(0))}, 'SUPERADMIN', 'active', ${J.platformStructureId}, false, NOW())`);
      await db.execute(sql`INSERT INTO "Invitation" (id, "structureId", email, role, token, expires_at) VALUES (${'g8p-inv-' + TS}, ${J.platformStructureId}, ${SUPER_EMAIL}, 'SUPERADMIN', ${hashInviteToken(token)}, ${new Date(Date.now() + mod.INVITATION_TTL_MS).toISOString()})`);
      enrolLink = mod.invitationLink('http://localhost:5285', token);
      J.super = { id, email: SUPER_EMAIL, st: J.platformStructureId };
    }
    const enrolToken = decodeURIComponent(new URL(enrolLink).hash.replace(/^#invitation=/, ''));

    // password-only sign-in: a session that reaches only /me and the enrolment (PRO_MFA_REQUIRED)
    const login = await call('POST', '/api/pro/auth/login', { body: { email: SUPER_EMAIL, password: pw(0) } });
    expect(login.statusCode, JSON.stringify(login.body)).toBe(200);
    const pwOnly = login.body.token;
    expect((await call('GET', '/api/pro/me', { bearer: pwOnly })).body.session).toEqual({ mfa: false, mfaRequired: true });
    const early = await call('POST', '/api/pro/invite', { bearer: pwOnly, body: { email: ADMIN_EMAIL, role: 'STRUCTURE_ADMIN', structure: PILOT } });
    expect(early.statusCode, 'no platform invitation without the second factor').toBe(403);
    const redeemed = await call('POST', '/api/pro/mfa-enrolment', { bearer: pwOnly, body: { token: enrolToken } });
    expect(redeemed.statusCode, JSON.stringify(redeemed.body)).toBe(200);
    const g = await call('GET', '/api/pro/mfa-setup', { bearer: pwOnly, headers: { 'x-ada-mfa-enrolment': redeemed.body.enrolmentToken } });
    expect(g.statusCode, JSON.stringify(g.body)).toBe(200);
    const done = await call('POST', '/api/pro/mfa-setup', { bearer: pwOnly, body: { code: at(g.body.secret), enrolmentToken: redeemed.body.enrolmentToken } });
    expect(done.statusCode, JSON.stringify(done.body)).toBe(200);
    expect((await call('POST', '/api/pro/mfa-enrolment', { bearer: pwOnly, body: { token: enrolToken } })).statusCode, 'the link is single-use').not.toBe(200);
    J.super.secret = g.body.secret;
    J.super.session = await signIn(SUPER_EMAIL, pw(0), J.super.secret, 1);
  });

  it('3. platform invitation of the partner\'s first administrator (only once ADA verified AND activated it) → sign-up with both terms (document@version) → factor → code', async () => {
    // the platform's console: its own (internal) team page, where the « Structure partenaire » field is
    const own = await call('GET', '/api/pro/team', { bearer: J.super.session });
    expect(own.statusCode, JSON.stringify(own.body)).toBe(200);
    expect(own.body.users.map((u) => u.email)).toContain(SUPER_EMAIL);
    const body = { email: ADMIN_EMAIL, role: 'STRUCTURE_ADMIN', structure: PILOT };
    const notYet = await call('POST', '/api/pro/invite', { bearer: J.super.session, body });
    expect([notYet.statusCode, notYet.body.code], 'verified but not active').toEqual([409, 'PLATFORM_INVITATION_STRUCTURE_NOT_ELIGIBLE']);
    expect((await call('POST', '/api/pro/invite', { bearer: J.super.session, body: { ...body, role: 'PRO' } })).body.code, 'a platform invitation names an administrator only').toBe('PLATFORM_INVITATION_ROLE');
    await J.activate();
    const inv = await call('POST', '/api/pro/invite', { bearer: J.super.session, body });
    expect(inv.statusCode, JSON.stringify(inv.body)).toBe(201);
    expect(inv.body).toMatchObject({ structure: { id: PILOT }, mailStatus: expect.any(String) });
    J.admin = await redeem(tokenFromMail(ADMIN_EMAIL), pw(1), ['cgu-professionnel', 'conditions-structures']);
    expect(J.admin.role).toBe('STRUCTURE_ADMIN');
    expect(await ledger(J.admin.id)).toEqual([
      { purpose: 'TERMS_ACCEPTANCE_CGU_PROFESSIONNEL', policy_version: `cgu-professionnel@${legal.LEGAL_DRAFTS_V8}`, proof_level: 'CONTRACT_ACCEPTANCE' },
      { purpose: 'TERMS_ACCEPTANCE_CONDITIONS_STRUCTURES', policy_version: `conditions-structures@${legal.LEGAL_DRAFTS_V8}`, proof_level: 'CONTRACT_ACCEPTANCE' },
    ]);
    J.admin.session = await signIn(ADMIN_EMAIL, pw(1), J.admin.secret, 1);
    // the platform account reads nothing of the partner's space through its own console
    expect(JSON.stringify((await call('GET', '/api/pro/team', { bearer: J.super.session })).body)).not.toContain(ADMIN_EMAIL);
    const me = await call('GET', '/api/pro/me', { bearer: J.admin.session });
    expect(me.body.user).toMatchObject({ role: 'STRUCTURE_ADMIN', structureId: PILOT, mfa_enabled: true });
    expect(JSON.stringify(me.body)).not.toMatch(/mfa_secret|password_hash/);
  });

  it('4. the administrator upkeeps the directory record (proposal → ADA review → published), sets the public profile and invites a PRO member', async () => {
    const st = await call('GET', '/api/pro/structure', { bearer: J.admin.session });
    expect(st.statusCode).toBe(200); expect(st.body.canPropose).toBe(true);
    const prop = await call('POST', '/api/pro/structure', { bearer: J.admin.session, body: { action: 'propose', field: 'horaires', value: 'Lundi-vendredi 9h-17h' } });
    expect(prop.statusCode, JSON.stringify(prop.body)).toBe(201);
    expect((await db.execute(sql`SELECT horaires FROM "Structure" WHERE id = ${PILOT}`)).rows[0].horaires, 'nothing published before ADA review').toBe('Lundi 9h-12h');
    const queue = await call('GET', '/api/admin/structure-proposals', { bearer: ada(1) });
    expect(queue.body.proposals?.map((p) => p.id) ?? queue.body.items?.map((p) => p.id)).toContain(prop.body.proposal.id);
    const ok = await call('POST', '/api/admin/structure-proposals', { bearer: ada(1), body: { id: prop.body.proposal.id, decision: 'ACCEPT', note: 'Vu sur le site officiel.', sourceUrl: 'https://annuaire.service-public.fr/test-g8' } });
    expect(ok.statusCode, JSON.stringify(ok.body)).toBe(200);
    expect((await db.execute(sql`SELECT horaires FROM "Structure" WHERE id = ${PILOT}`)).rows[0].horaires).toBe('Lundi-vendredi 9h-17h');

    const prof = await call('PUT', '/api/pro/profile', { bearer: J.admin.session, body: { displayName: 'Responsable accueil', jobTitle: 'Coordinatrice' } });
    expect(prof.statusCode, JSON.stringify(prof.body)).toBe(200);

    const member = await call('POST', '/api/pro/invite', { bearer: J.admin.session, body: { email: MEMBER_EMAIL, role: 'PRO' } });
    expect(member.statusCode, JSON.stringify(member.body)).toBe(201);
    const team = await call('GET', '/api/pro/team', { bearer: J.admin.session });
    expect(team.statusCode).toBe(200);
    expect(team.body.users.map((u) => u.email)).toEqual([ADMIN_EMAIL]);
    expect(JSON.stringify(team.body.invitations ?? team.body)).toContain(MEMBER_EMAIL);
  });

  it('5. the PRO member signs up (cgu-professionnel only), enrols, signs in; each role reaches exactly its own console', async () => {
    J.member = await redeem(tokenFromMail(MEMBER_EMAIL), pw(2), ['cgu-professionnel']);
    expect(J.member.role).toBe('PRO');
    expect(await ledger(J.member.id)).toEqual([{ purpose: 'TERMS_ACCEPTANCE_CGU_PROFESSIONNEL', policy_version: `cgu-professionnel@${legal.LEGAL_DRAFTS_V8}`, proof_level: 'CONTRACT_ACCEPTANCE' }]);
    J.member.session = await signIn(MEMBER_EMAIL, pw(2), J.member.secret, 1);

    const me = await call('GET', '/api/pro/me', { bearer: J.member.session });
    expect(me.body.modules).toEqual({ cases: false, referrals: false, selections: false, dossiers: false, agenda: false, outlook: false, video: false, messages: false,
      team: true, structure: true, reports: true, regional: true, audit: true });
    // the member: reads the record (cannot propose), keeps their own public profile, their notifications; administration stays with the administrator
    const st = await call('GET', '/api/pro/structure', { bearer: J.member.session });
    expect([st.statusCode, st.body.canPropose]).toEqual([200, false]);
    expect((await call('PUT', '/api/pro/profile', { bearer: J.member.session, body: { displayName: 'Conseiller accueil', jobTitle: 'Travailleur social' } })).statusCode).toBe(200);
    expect((await call('PUT', '/api/pro/profile', { bearer: J.member.session, body: { memberId: J.admin.id, displayName: 'Autre nom' } })).statusCode).toBe(403);
    expect((await call('GET', '/api/pro/notifications', { bearer: J.member.session })).statusCode).toBe(200);
    for (const [m, u, b] of [['GET', '/api/pro/team'], ['POST', '/api/pro/invite', { email: `g8p-x-${TS}@example.test`, role: 'PRO' }], ['GET', '/api/pro/reports'],
      ['GET', '/api/pro/structure?export=1'], ['POST', '/api/pro/structure', { action: 'propose', field: 'telephone', value: '03 88 00 00 00' }]]) {
      expect((await call(m, u, { bearer: J.member.session, body: b })).statusCode, `PRO ${m} ${u}`).toBe(403);
    }
    // the administrator: team, reports, own journal
    expect((await call('GET', '/api/pro/reports', { bearer: J.admin.session })).statusCode).toBe(200);
    const team = await call('GET', '/api/pro/team', { bearer: J.admin.session });
    expect(team.body.users.map((u) => u.email).sort()).toEqual([ADMIN_EMAIL, MEMBER_EMAIL].sort());
  });

  it('6. every HDS / out-of-AIPD module is closed (503) for both roles, and no beneficiary data is reachable from any served route — the export included', async () => {
    const closed = [['GET', '/api/pro/cases?scope=mine'], ['GET', '/api/pro/referrals?box=inbox'], ['POST', '/api/pro/referrals', { action: 'create', sharedDiagnosticId: DOSSIER }],
      ['GET', `/api/pro/dossier?shareId=${DOSSIER}`], ['GET', '/api/pro/consent'], ['GET', '/api/pro/selections'], ['GET', '/api/pro/messages'], ['GET', '/api/pro/appointments'],
      ['GET', '/api/pro/slots'], ['POST', '/api/pro/services', { name: 'x' }], ['GET', '/api/pro/availability'], ['GET', '/api/pro/rdv/settings'], ['GET', '/api/pro/rdv/hours'], ['GET', `/api/pro/dossier/export?shareId=${DOSSIER}`]];
    for (const s of [J.admin.session, J.member.session]) {
      for (const [m, u, body] of closed) {
        const r = await call(m, u, { bearer: s, body });
        expect([r.statusCode, ['CAPABILITY_NOT_OPEN', 'PUBLIC_BETA_RESTRICTED'].includes(r.body?.error)], `${m} ${u}`).toEqual([503, true]);
      }
    }
    // every routed pro path, as administrator and as member: whatever is served must not carry the beneficiary, their dossier or its content
    const { routes } = await import('../../api/routes.js');
    const paths = [...new Set(routes.map((r) => r.path).filter((p) => p.startsWith('pro/') && !p.startsWith('pro/auth/')))];
    let served = 0;
    for (const s of [J.admin.session, J.member.session]) {
      for (const p of [...paths, 'pro/structure?export=1', 'pro/reports?format=csv', 'pro/audit?limit=200']) {
        const r = await call('GET', `/api/${p}`, { bearer: s });
        if (r.statusCode === 200) served += 1;
        const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? '');
        for (const leak of [CIT.email, CIT.id, DOSSIER, 'Beneficiaire-G8']) expect(text.includes(leak), `${p} leaks ${leak}`).toBe(false);
      }
    }
    expect(served).toBeGreaterThan(10);
    const ex = await call('GET', '/api/pro/structure?export=1', { bearer: J.admin.session });
    expect(ex.statusCode).toBe(200);
    expect(ex.body.export.team.map((m) => m.email).sort()).toEqual([ADMIN_EMAIL, MEMBER_EMAIL].sort());
    expect(JSON.stringify(ex.body.export)).not.toMatch(/password_hash|mfa_secret|scrypt:/);
    // and no cross-tenant read: the other structure is invisible
    expect(JSON.stringify((await call('GET', '/api/pro/structure', { bearer: J.admin.session })).body)).not.toContain(OTHER);
  });

  it('7. the journey is in the audit trail: ADA decisions with the reviewer, every account step with ids (never a password, a token or a TOTP seed)', async () => {
    const adaRows = await audit(sql`entity_id = ${PILOT} AND action IN ('CONTENT_VERIFIED', 'ORGANIZATION_REACTIVATED')`);
    expect(adaRows.map((r) => [r.action, r.actor_id])).toEqual([['CONTENT_VERIFIED', ADA[0]], ['ORGANIZATION_REACTIVATED', ADA[0]]]);
    const pro = await audit(sql`details->>'structureId' = ${PILOT}`);
    const actions = pro.map((r) => r.action);
    for (const a of ['INVITATION_SENT', 'REGISTER_VIA_INVITE', 'MFA_CHALLENGE', 'PRO_PROFILE_UPDATED', 'ORGANIZATION_EXPORTED']) expect(actions, a).toContain(a);
    expect(pro.find((r) => r.action === 'INVITATION_SENT' && r.details.platform === true)).toMatchObject({ actor_id: J.super.id });
    const everything = JSON.stringify(await audit(sql`details->>'structureId' IN (${PILOT}, ${J.super.st}) OR entity_id IN (${PILOT}, ${J.super.id})`));
    for (const secret of [pw(0), pw(1), pw(2), J.super.secret, J.admin.secret, J.member.secret]) expect(everything).not.toContain(secret);
    // the structure reads its own journal; the member's journal access follows the route's own rule
    const own = await call('GET', '/api/pro/audit', { bearer: J.admin.session });
    expect(own.statusCode).toBe(200);
    expect(JSON.stringify(own.body)).not.toContain(OTHER);
  });

  it('8a. offboarding a member: disabled by the administrator, their session ends at once and the sign-in is refused; reactivation is possible', async () => {
    expect((await call('DELETE', `/api/pro/team?userId=${J.admin.id}`, { bearer: J.admin.session })).statusCode, 'no self-disable').toBe(400);
    const off = await call('DELETE', `/api/pro/team?userId=${J.member.id}`, { bearer: J.admin.session });
    expect(off.statusCode, JSON.stringify(off.body)).toBe(200);
    expect((await call('GET', '/api/pro/structure', { bearer: J.member.session })).statusCode).not.toBe(200);
    expect((await call('POST', '/api/pro/auth/login', { body: { email: MEMBER_EMAIL, password: pw(2) } })).statusCode).toBe(403);
    expect((await audit(sql`action = 'USER_DISABLED' AND details->>'structureId' = ${PILOT}`)).length).toBe(1);
    // a departure can be undone by the administrator (same password and factor); then the member leaves again
    expect((await call('PATCH', '/api/pro/team', { bearer: J.admin.session, body: { targetUserId: J.member.id, reactivate: true } })).statusCode).toBe(200);
    await db.execute(sql`UPDATE "ProUser" SET mfa_last_time_step = mfa_last_time_step - 2 WHERE id = ${J.member.id}`);   // as if 60 s had passed (each code works once)
    J.member.session = await signIn(MEMBER_EMAIL, pw(2), J.member.secret, 0);
    expect((await call('DELETE', `/api/pro/team?userId=${J.member.id}`, { bearer: J.admin.session })).statusCode).toBe(200);
  });

  it('8a-bis. ADA administers a professional account itself (MFA, reason, journal): disables an account on incident, erases a former member on request', async () => {
    // a third member (seeded) whose account must be cut by ADA itself — e.g. a lost device reported while the structure administrator is away
    const EXTRA = { id: `g8p-extra-${TS}`, email: `g8p-extra-${TS}@example.test` };
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", mfa_enabled, mfa_secret, "notificationEmailEnabled", "updatedAt") VALUES (${EXTRA.id}, ${EXTRA.email}, 'x', 'PRO', 'active', ${PILOT}, true, 'seed', false, NOW())`);
    await db.execute(sql`INSERT INTO "ProCase" (id, "sharedDiagnosticId", "structureId", status, "assigneeProUserId", "openedAt", "updatedAt") VALUES (${'g8p-case-' + TS}, ${DOSSIER}, ${PILOT}, 'IN_PROGRESS', ${EXTRA.id}, NOW(), NOW())`);
    const extraSession = auth.signProToken({ id: EXTRA.id, email: EXTRA.email, structureId: PILOT, role: 'PRO' }, { mfa: true });
    expect((await call('GET', '/api/pro/me', { bearer: extraSession })).statusCode).toBe(200);
    const members = await call('GET', `/api/admin/organizations?members=${encodeURIComponent(PILOT)}`, { bearer: ada(0, false) });
    expect(members.statusCode, JSON.stringify(members.body)).toBe(200);
    expect(members.body.members.map((m) => [m.email, m.role, m.status]).sort()).toEqual([[ADMIN_EMAIL, 'STRUCTURE_ADMIN', 'active'], [MEMBER_EMAIL, 'PRO', 'disabled'], [EXTRA.email, 'PRO', 'active']].sort());
    expect(JSON.stringify(members.body)).not.toMatch(/password_hash|mfa_secret|scrypt:/);
    const act = (bearer, body) => call('POST', '/api/admin/organizations', { bearer, body });
    expect((await act(ada(0, false), { action: 'ERASE_PRO_ACCOUNT', userId: J.member.id, reason: 'Demande d’effacement du 19/11.' })).statusCode, 'MFA').toBe(403);
    expect((await act(ada(0), { action: 'ERASE_PRO_ACCOUNT', userId: J.member.id, reason: 'x' })).body.error).toBe('reason_required');
    expect((await act(ada(0), { action: 'ERASE_PRO_ACCOUNT', userId: J.admin.id, reason: 'Demande d’effacement du 19/11.' })).body.error, 'an active account is disabled first').toBe('pro_account_active');
    expect((await act(ada(0), { action: 'DISABLE_PRO_ACCOUNT', userId: J.super.id, reason: 'Essai sur le compte plateforme.' })).statusCode, 'never the platform account').toBe(404);
    // ADA disables: refused while the member still holds work the structure must hand over (never an orphan); then the session ends at once
    const held = await act(ada(0), { action: 'DISABLE_PRO_ACCOUNT', userId: EXTRA.id, reason: 'Appareil perdu signalé le 19/11.' });
    expect([held.statusCode, held.body.error, held.body.holds]).toEqual([409, 'handover_required', { openCases: 1, pendingProposals: 0, futureAppointments: 0, referentRoles: 0 }]);
    await db.execute(sql`UPDATE "ProCase" SET status = 'CLOSED', "closedAt" = NOW() WHERE id = ${'g8p-case-' + TS}`);
    const cut = await act(ada(0), { action: 'DISABLE_PRO_ACCOUNT', userId: EXTRA.id, reason: 'Appareil perdu signalé le 19/11.' });
    expect(cut.statusCode, JSON.stringify(cut.body)).toBe(200);
    expect((await call('GET', '/api/pro/me', { bearer: extraSession })).statusCode).toBe(401);
    expect((await act(ada(0), { action: 'DISABLE_PRO_ACCOUNT', userId: EXTRA.id, reason: 'Appareil perdu signalé le 19/11.' })).statusCode, 'already disabled').toBe(404);
    expect((await audit(sql`action = 'PRO_ACCOUNT_DISABLED' AND entity_id = ${EXTRA.id}`)).map((r) => [r.actor_id, r.details.structureId])).toEqual([[ADA[0], PILOT]]);
    await db.execute(sql`DELETE FROM "ProCaseEvent" WHERE "caseId" = ${'g8p-case-' + TS}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProCase" WHERE id = ${'g8p-case-' + TS}`);
    await db.execute(sql`INSERT INTO "LegalHold" (id, "dataCategory", "recordId", "reasonCode", "createdBy", status) VALUES (${'g8p-lh-' + TS}, 'Structure', ${PILOT}, 'QA_LITIGATION', 'qa', 'ACTIVE')`);
    expect((await act(ada(0), { action: 'ERASE_PRO_ACCOUNT', userId: J.member.id, reason: 'Demande d’effacement reçue le 19/11/2026.' })).body.error, 'a legal hold blocks it').toBe('legal_hold_active');
    await db.execute(sql`DELETE FROM "LegalHold" WHERE id = ${'g8p-lh-' + TS}`);
    const erased = await act(ada(0), { action: 'ERASE_PRO_ACCOUNT', userId: J.member.id, reason: 'Demande d’effacement reçue le 19/11/2026.' });
    expect(erased.statusCode, JSON.stringify(erased.body)).toBe(200);
    // nothing that names or authenticates the former member remains; the acceptance proof (ids + version, no address) and the journal stay
    for (const [t, q] of [['ProUser', sql`SELECT count(*)::int n FROM "ProUser" WHERE lower(email) = ${MEMBER_EMAIL}`], ['Invitation', sql`SELECT count(*)::int n FROM "Invitation" WHERE lower(email) = ${MEMBER_EMAIL}`],
      ['ProProfile', sql`SELECT count(*)::int n FROM "ProProfile" WHERE "proUserId" = ${J.member.id} AND ("displayName" IS NOT NULL OR "jobTitle" IS NOT NULL)`],
      ['secrets', sql`SELECT count(*)::int n FROM "ProUser" WHERE id = ${J.member.id} AND (mfa_secret IS NOT NULL OR mfa_enabled OR password_hash LIKE 'scrypt:%')`]]) {
      expect(Number((await db.execute(q)).rows[0].n), t).toBe(0);
    }
    expect((await call('POST', '/api/pro/auth/login', { body: { email: MEMBER_EMAIL, password: pw(2) } })).statusCode).toBe(401);
    expect((await ledger(J.member.id)).length).toBe(1);
    expect((await act(ada(0), { action: 'ERASE_PRO_ACCOUNT', userId: J.member.id, reason: 'Deuxième demande.' })).statusCode, 'once').toBe(404);
    const rows = await audit(sql`action IN ('PRO_ACCOUNT_ERASED', 'PRO_ACCOUNT_DISABLED') AND entity_id = ${J.member.id}`);
    expect(rows.map((r) => [r.action, r.actor_id])).toEqual([['PRO_ACCOUNT_ERASED', ADA[0]]]);
    expect(JSON.stringify(rows)).not.toContain(MEMBER_EMAIL);
  });

  it('8b. replacing the structure administrator: the platform invites a successor, who disables the former; the former is locked out', async () => {
    const inv = await call('POST', '/api/pro/invite', { bearer: J.super.session, body: { email: SUCCESSOR_EMAIL, role: 'STRUCTURE_ADMIN', structure: PILOT } });
    expect(inv.statusCode, JSON.stringify(inv.body)).toBe(201);
    J.successor = await redeem(tokenFromMail(SUCCESSOR_EMAIL), pw(3), ['cgu-professionnel', 'conditions-structures']);
    J.successor.session = await signIn(SUCCESSOR_EMAIL, pw(3), J.successor.secret, 1);
    const off = await call('DELETE', `/api/pro/team?userId=${J.admin.id}`, { bearer: J.successor.session });
    expect(off.statusCode, JSON.stringify(off.body)).toBe(200);
    expect((await call('GET', '/api/pro/team', { bearer: J.admin.session })).statusCode).not.toBe(200);
    expect((await call('POST', '/api/pro/auth/login', { body: { email: ADMIN_EMAIL, password: pw(1) } })).statusCode).toBe(403);
  });

  it('8c. end of the agreement: ADA opens the closure, two reviewers decide, the members are anonymised and nobody of the structure gets in', async () => {
    const o = await call('POST', '/api/admin/org-closure', { bearer: ada(0), body: { action: 'open', structureId: PILOT, reason: 'Fin de la convention pilote.' } });
    expect(o.statusCode, JSON.stringify(o.body)).toBe(201); const id = o.body.request.id;
    expect((await call('GET', '/api/pro/structure', { bearer: J.successor.session })).body.closure).toMatchObject({ id });
    expect((await call('POST', '/api/admin/org-closure', { bearer: ada(0), body: { id, decision: 'APPROVE' } })).statusCode).toBe(200);
    const pa = (await call('GET', '/api/admin/org-closure', { bearer: ada(1) })).body.requests.find((x) => x.id === id).proposedAt;
    expect((await call('GET', `/api/admin/org-closure?id=${id}`, { bearer: ada(1) })).statusCode).toBe(200);
    const done = await call('POST', '/api/admin/org-closure', { bearer: ada(1), body: { id, action: 'confirm', proposedAt: pa, note: 'Convention échue, vérifiée.' } });
    expect([done.statusCode, done.body.request?.status], JSON.stringify(done.body)).toEqual([200, 'COMPLETED']);
    expect(done.body.summary.membersAnonymized, 'the three not yet erased').toBe(3);
    const members = (await db.execute(sql`SELECT email FROM "ProUser" WHERE "structureId" = ${PILOT}`)).rows.map((r) => r.email);
    expect(members.every((e) => /^closed-.*@closed\.invalid$/.test(e))).toBe(true);
    expect((await call('GET', '/api/pro/team', { bearer: J.successor.session })).statusCode).not.toBe(200);
    expect((await call('POST', '/api/pro/auth/login', { body: { email: SUCCESSOR_EMAIL, password: pw(3) } })).statusCode).toBe(401);
    // the members' addresses are gone everywhere the space kept them — the redeemed invitations included
    expect(Number((await db.execute(sql`SELECT count(*)::int n FROM "Invitation" WHERE lower(email) IN (${ADMIN_EMAIL}, ${SUCCESSOR_EMAIL}, ${MEMBER_EMAIL})`)).rows[0].n)).toBe(0);
    // what ADA keeps after the end: its own journal and the terms-acceptance proof (the retention of the latter is an owner decision — runbook § 7)
    expect((await audit(sql`entity_id = ${PILOT} AND action LIKE 'ORGANIZATION_CLOSURE%'`)).length).toBeGreaterThan(0);
  });
});
