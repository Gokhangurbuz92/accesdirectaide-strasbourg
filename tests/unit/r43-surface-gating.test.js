/**
 * R43 — surface gating hardening for a staged opening (opening-sequence review E1, E2, E4 and the role-escalation check). Default closed everywhere:
 *  E1  opening `pro` no longer opens public structure self-registration (ADA_PRO_SELF_REGISTRATION=open, exact; also enforced by the handler in
 *      Production and during the beta, so lifting the beta later does not reopen it);
 *  E2  opening `accounts` opens the booking scope only (sign-up/in, rights, profile, adult statement); the rest of the citizen space needs
 *      ADA_BETA_ACCOUNTS_SCOPE=full; the browser mirrors it;
 *  E4  the Outlook release check states the real production prerequisites instead of a blanket FAIL;
 *  —   a self-registered citizen can never obtain a professional, structure, territory (institution) or administration role through any path.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const mail = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../api/_utils/mailer.js', async (importOriginal) => ({ ...(await importOriginal()), sendMail: vi.fn(async () => { mail.calls += 1; return { outcome: 'TEST_RECORDED' }; }) }));
// the gate runs before any database access: a database call here is a failure
vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get() { throw new Error('database touched'); } }) }));

const { isAllowedInPublicBeta, proSelfRegistrationOpen, accountsScope, inAccountsBookingScope, ACCOUNTS_BOOKING_SCOPE, surfaceOf } = await import('../../api/_utils/public-beta.js');
const { isBetaRestrictedPath } = await import('../../src/lib/publicBeta.js');
const { evaluateReleasePreflight } = await import('../../scripts/release-preflight.mjs');

const beta = (extra = {}) => ({ ADA_PUBLIC_BETA_RESTRICTED: '1', ...extra });

describe('E1 — structure self-registration is a separate switch, closed by default', () => {
  it('opening « pro » keeps pro/auth/register closed; every other pro route of the surface is served', () => {
    const env = beta({ ADA_BETA_OPEN_SURFACES: 'pro' });
    for (const m of ['POST', 'GET']) expect(isAllowedInPublicBeta(m, 'pro/auth/register', env), m).toBe(false);
    for (const p of ['pro/auth/login', 'pro/auth/register-invite', 'pro/mfa-enrolment', 'pro/mfa-setup', 'pro/invite', 'pro/team', 'pro/services', 'pro/rdv-settings'])
      expect(isAllowedInPublicBeta('POST', p, env), p).toBe(true);
  });
  it('opens only with the exact value « open »', () => {
    expect(isAllowedInPublicBeta('POST', 'pro/auth/register', beta({ ADA_BETA_OPEN_SURFACES: 'pro', ADA_PRO_SELF_REGISTRATION: 'open' }))).toBe(true);
    expect(isAllowedInPublicBeta('POST', 'pro/auth/register', beta({ ADA_BETA_OPEN_SURFACES: 'pro', ADA_PRO_SELF_REGISTRATION: ' Open ' }))).toBe(true);
    for (const v of [undefined, '', '1', 'true', 'yes', 'on', 'opened', '*']) expect(proSelfRegistrationOpen({ ADA_PRO_SELF_REGISTRATION: v }), String(v)).toBe(false);
    // the switch alone opens nothing: the « pro » surface must be open too
    expect(isAllowedInPublicBeta('POST', 'pro/auth/register', beta({ ADA_PRO_SELF_REGISTRATION: 'open' }))).toBe(false);
  });
  it('the handler refuses in Production and during the beta before reading anything (no database, no e-mail), and stays open in LAB outside the beta', async () => {
    const mod = await import('../../api/_handlers/pro/auth/register.js');
    expect(mod.proSelfRegistrationAllowed({ VERCEL_ENV: 'production' })).toBe(false);
    expect(mod.proSelfRegistrationAllowed({ VERCEL_ENV: 'preview', ADA_PUBLIC_BETA_RESTRICTED: '1' })).toBe(false);
    expect(mod.proSelfRegistrationAllowed({ VERCEL_ENV: 'production', ADA_PRO_SELF_REGISTRATION: 'open' })).toBe(true);
    expect(mod.proSelfRegistrationAllowed({ VERCEL_ENV: 'development' })).toBe(true);
    vi.stubEnv('VERCEL_ENV', 'production');
    try {
      let status = 0; let body = null;
      const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
      await mod.default({ method: 'POST', headers: {}, body: { email: 'x@example.test', password: 'Abcdefgh1234', structureName: 'Structure fictive' } }, res);
      expect(status).toBe(403);
      expect(body).toEqual(mod.PRO_SELF_REGISTRATION_CLOSED);
      expect(mail.calls).toBe(0);
    } finally { vi.unstubAllEnvs(); }
  });
  it('the browser hides the sign-up screen unless the build opens it; the invitation screen follows the pro surface', () => {
    const narrow = { accountsScope: 'booking', proSelfRegistration: false };
    expect(isBetaRestrictedPath('/pro/register', ['pro'], narrow)).toBe(true);
    expect(isBetaRestrictedPath('/pro/register', ['pro'], { ...narrow, proSelfRegistration: true })).toBe(false);
    expect(isBetaRestrictedPath('/pro/register-invite', ['pro'], narrow)).toBe(false);
    expect(isBetaRestrictedPath('/pro/login', ['pro'], narrow)).toBe(false);
  });
});

describe('E2 — « accounts » opens the booking scope unless ADA_BETA_ACCOUNTS_SCOPE=full', () => {
  const open = beta({ ADA_BETA_OPEN_SURFACES: 'accounts' });
  const BOOKING = ['auth/signup', 'auth/login', 'auth/logout', 'auth/verify-email', 'auth/resend-verification', 'auth/forgot-password', 'auth/reset-password',
    'auth/delete-account', 'auth/export-data', 'citizen/profile', 'citizen/age-declaration', 'citizen/email-change', 'citizen/email-change-confirm', 'citizen/phone',
    'citizen/preferences', 'citizen/restriction', 'citizen/espace'];
  const REST = ['citizen/household', 'citizen/guardians', 'citizen/push', 'citizen/shares', 'citizen/parcours', 'citizen/favorites', 'citizen/history',
    'citizen/delegations', 'citizen/referrals'];
  it('serves what booking and the rights need, refuses the rest of the citizen space', () => {
    for (const p of BOOKING) expect(isAllowedInPublicBeta('POST', p, open), p).toBe(true);
    for (const p of REST) for (const m of ['GET', 'POST']) expect(isAllowedInPublicBeta(m, p, open), `${m} ${p}`).toBe(false);
    expect(accountsScope({})).toBe('booking');
    expect(accountsScope({ ADA_BETA_ACCOUNTS_SCOPE: 'FULL' })).toBe('full');
    for (const v of ['all', '1', 'true', 'wide']) expect(accountsScope({ ADA_BETA_ACCOUNTS_SCOPE: v }), v).toBe('booking');
  });
  it('every citizen route of the router belongs to exactly one decision (booking scope, the rest, or another surface)', () => {
    const routes = [...readFileSync(resolve(process.cwd(), 'api/routes.js'), 'utf8').matchAll(/path: '((?:citizen|auth)\/[^']+)'/g)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThan(20);
    for (const r of routes) {
      const s = surfaceOf(r);
      if (s !== 'accounts') { expect(['documents', 'appointments']).toContain(s); continue; }   // the Coffre / dossier (documents), the Outlook callback (appointments)
      expect(inAccountsBookingScope(r) || REST.includes(r), r).toBe(true);
    }
    for (const x of ACCOUNTS_BOOKING_SCOPE) expect(surfaceOf(x === 'auth' ? 'auth/login' : x), x).toBe('accounts');
  });
  it('« full » restores the whole accounts surface; documents and communications stay separate surfaces', () => {
    const full = beta({ ADA_BETA_OPEN_SURFACES: 'accounts', ADA_BETA_ACCOUNTS_SCOPE: 'full' });
    for (const p of [...BOOKING, ...REST]) expect(isAllowedInPublicBeta('POST', p, full), p).toBe(true);
    for (const p of ['citizen/coffre', 'citizen/dossier', 'messages', 'contact']) expect(isAllowedInPublicBeta('POST', p, full), p).toBe(false);
  });
  it('the browser shows only the booking screens in the narrow scope', () => {
    const sub = { accountsScope: 'booking', proSelfRegistration: false };
    for (const p of ['/login', '/auth/login', '/auth/signup', '/auth/verify-email', '/auth/reset', '/compte', '/compte/rendez-vous', '/compte/parametres'])
      expect(isBetaRestrictedPath(p, ['accounts'], sub), p).toBe(false);
    for (const p of ['/compte/profil', '/compte/parcours', '/compte/favoris', '/compte/historique', '/compte/delegations', '/compte/coffre', '/compte/orientations', '/compte/messages'])
      expect(isBetaRestrictedPath(p, ['accounts'], sub), p).toBe(true);
    expect(isBetaRestrictedPath('/compte/parcours', ['accounts'], { ...sub, accountsScope: 'full' })).toBe(false);
    expect(isBetaRestrictedPath('/compte', [], sub)).toBe(true);
  });
});

describe('E4 — the Outlook release check names the real prerequisites', () => {
  const GOOD = { APP_BASE_URL: 'https://www.example.test', ADA_VAULT_KEY: 'cd'.repeat(32) };
  const ON = { ...GOOD, OUTLOOK_ENABLED: 'true', CALENDAR_PRODUCTION_APPROVED: 'true', OUTLOOK_CLIENT_ID: 'id', OUTLOOK_CLIENT_SECRET: 'synthetic',
    OUTLOOK_REDIRECT_URI: 'https://www.example.test/api/auth/callback/outlook' };
  const check = (env) => evaluateReleasePreflight(env, { legalText: 'ok' }).find((r) => r.id === 'outlook.disabled_until_redesign');
  it('off is PASS; on without the owner approval is FAIL and says so', () => {
    expect(check(GOOD).status).toBe('PASS');
    const { CALENDAR_PRODUCTION_APPROVED: _a, ...noApproval } = ON;
    expect(check(noApproval)).toMatchObject({ status: 'FAIL', detail: expect.stringContaining('CALENDAR_PRODUCTION_APPROVED') });
  });
  it('approved and fully configured is PASS (no stale « token formats » reason)', () => {
    expect(check(ON)).toMatchObject({ status: 'PASS' });
    expect(check(ON).detail).not.toMatch(/inconsistent/);
  });
  it('every missing piece is a FAIL: credentials, callback on the public https host, vault key, sandbox endpoints, the appointments surface in the beta', () => {
    for (const bad of [{ OUTLOOK_CLIENT_ID: '' }, { OUTLOOK_CLIENT_SECRET: '' }, { OUTLOOK_REDIRECT_URI: 'http://www.example.test/api/auth/callback/outlook' },
      { OUTLOOK_REDIRECT_URI: 'https://evil.example.test/api/auth/callback/outlook' }, { OUTLOOK_REDIRECT_URI: 'https://www.example.test/callback' }, { ADA_VAULT_KEY: 'short' },
      { OUTLOOK_AUTHORITY_URL: 'http://127.0.0.1:9/fake' }, { OUTLOOK_GRAPH_BASE_URL: 'http://127.0.0.1:9/graph' }, { ADA_PUBLIC_BETA_RESTRICTED: '1' }])
      expect(check({ ...ON, ...bad }).status, JSON.stringify(bad)).toBe('FAIL');
    expect(check({ ...ON, ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'appointments' }).status).toBe('PASS');
    expect(JSON.stringify(check({ ...ON, OUTLOOK_CLIENT_SECRET: 'PLANTED-SECRET', OUTLOOK_CLIENT_ID: '' }))).not.toContain('PLANTED-SECRET');
  });
  it('the R43 sub-switches are visible in the gate: PASS when closed / narrow, WARN when widened', () => {
    const st = (env, id) => evaluateReleasePreflight(env, { legalText: 'ok' }).find((r) => r.id === id)?.status;
    expect(st(beta(), 'beta.pro_self_registration')).toBe('PASS');
    expect(st(beta({ ADA_PRO_SELF_REGISTRATION: 'open' }), 'beta.pro_self_registration')).toBe('WARN');
    expect(st(beta({ ADA_BETA_OPEN_SURFACES: 'accounts' }), 'beta.accounts_scope')).toBe('PASS');
    expect(st(beta({ ADA_BETA_OPEN_SURFACES: 'accounts', ADA_BETA_ACCOUNTS_SCOPE: 'full' }), 'beta.accounts_scope')).toBe('WARN');
    expect(st(beta(), 'beta.accounts_scope')).toBeUndefined();
  });
});

describe('a self-registered citizen never obtains a professional, structure, territory or administration role', () => {
  it('a citizen session is refused by every other token family (professional, MFA enrolment, administration)', async () => {
    vi.stubEnv('JWT_SECRET', 'j'.repeat(40)); vi.stubEnv('AUTH_SECRET', 's'.repeat(40));
    try {
      vi.resetModules();
      const userAuth = await import('../../api/_utils/user-auth.js');
      const auth = await import('../../api/_utils/auth.js');
      const enrol = await import('../../api/_utils/pro-mfa-enrolment.js');
      const citizen = userAuth.signUserSessionToken({ userId: 'cit-1', email: 'citoyen@example.test' });
      expect(userAuth.verifyUserSessionToken(citizen)).toMatchObject({ role: 'user', scope: 'user' });
      expect(auth.verifyProToken(citizen)).toBeNull();
      expect(auth.verifyProMfaPendingToken(citizen)).toBeNull();
      expect(enrol.verifyMfaEnrolmentGrant(citizen)).toBeNull();
      expect(auth.verifyAdminSessionToken(citizen)).toBeNull();
      // the same secret signing a forged professional claim set without the professional audience is refused too
      const forged = auth.signJwt({ scope: 'pro', userId: 'cit-1', structureId: 's-1', role: 'SUPERADMIN' }, 'j'.repeat(40), { algorithm: 'HS256', expiresIn: '1h', issuer: 'accesdirectaide', audience: 'accesdirectaide-user' });
      expect(auth.verifyProToken(forged)).toBeNull();
      // and a citizen session carries no role but « user », whatever the sign-up body contained
      expect(userAuth.verifyUserSessionToken(citizen).role).toBe('user');
    } finally { vi.unstubAllEnvs(); vi.resetModules(); }
  });
  it('the citizen account has no role column, and the citizen sign-up writes only citizen tables', () => {
    const schema = readFileSync(resolve(process.cwd(), 'src/db/schema.ts'), 'utf8');
    const citizenTable = schema.slice(schema.indexOf("export const CitizenUser = pgTable('CitizenUser'"), schema.indexOf('export const AuthToken'));
    expect(citizenTable).not.toMatch(/\brole\b|structureId|territory/);
    const signup = readFileSync(resolve(process.cwd(), 'api/_handlers/auth/signup.js'), 'utf8');
    expect(signup).not.toMatch(/ProUser|AdminUser|InstitutionAccount|Invitation\b|insert\(Structure\)/);
    expect([...signup.matchAll(/db\.insert\((\w+)\)/g)].map((m) => m[1]).sort()).toEqual(['AuthToken', 'CitizenUser']);
  });
  it('every code path that writes a professional, administration or institution account, or an invitation, is one of the reviewed paths', () => {
    // a new writer must be reviewed here: each entry says why a citizen cannot reach it
    const REVIEWED = {
      'api/_handlers/pro/auth/register.js': 'public structure sign-up — closed in Production and the beta by default (E1)',
      'api/_handlers/pro/auth/register-invite.js': 'needs an administrator’s hashed invitation; never a platform role (PRO / STRUCTURE_ADMIN only)',
      'api/_handlers/pro/auth/reset-password.js': 'password of an EXISTING professional account (no role written)',
      'api/_handlers/pro/invite.js': 'STRUCTURE_ADMIN / SUPERADMIN only; structure roles only',
      'api/_handlers/pro/mfa-invitation.js': 'STRUCTURE_ADMIN / SUPERADMIN only; the role equals the member’s',
      'api/_handlers/pro/mfa-setup.js': 'second factor of the signed-in professional (enrolment grant required in Production)',
      'api/_handlers/pro/team.js': 'STRUCTURE_ADMIN / SUPERADMIN only; VALID_ROLES = PRO, STRUCTURE_ADMIN',
      'api/_services/pro-notifications.js': 'notification preferences of the signed-in professional',
      'api/_handlers/admin/mfa-setup.js': 'administration console (admin surface, MFA)',
      'api/_handlers/admin/mfa-verify.js': 'administration console (admin surface, MFA)',
      'api/_services/admin-identity.js': 'administration console, elevated superadmin only',
      'api/_services/institutions.js': 'institution accounts are created by an administrator under a signed agreement',
      'api/_utils/totp-guard.js': 'TOTP replay guard of an existing account',
      'api/_utils/auth.js': 'ends the sessions of an existing professional account (sessionsValidAfter only)',
      'api/_services/org-closure.js': 'anonymises the members of a closed organisation (administration)',
    };
    const files = []; const walk = (d) => { for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) { if (n !== 'tests' && n !== 'node_modules') walk(f); } else if (/\.(m?js|ts)$/.test(n) && !/\.test\./.test(n)) files.push(f); } };
    walk(resolve(process.cwd(), 'api'));
    const writer = /\.insert\((ProUser|AdminUser|InstitutionAccount|Invitation)\)|INSERT INTO "(ProUser|AdminUser|InstitutionAccount|Invitation)"|\.update\((ProUser|AdminUser|InstitutionAccount)\)|UPDATE "(ProUser|AdminUser|InstitutionAccount)"/;
    const found = files.filter((f) => writer.test(readFileSync(f, 'utf8'))).map((f) => relative(process.cwd(), f)).sort();
    expect(found).toEqual(Object.keys(REVIEWED).sort());
    // the only role write of a professional account offers structure roles only
    const team = readFileSync(resolve(process.cwd(), 'api/_handlers/pro/team.js'), 'utf8');
    expect(team).toContain("const VALID_ROLES = ['PRO', 'STRUCTURE_ADMIN'];");
    const invite = readFileSync(resolve(process.cwd(), 'api/_handlers/pro/auth/register-invite.js'), 'utf8');
    expect(invite).toContain("role: ['PRO', 'STRUCTURE_ADMIN'].includes(invitation.role) ? invitation.role : 'PRO'");
  });
  it('with « pro » and « accounts » open for the pilot, the only self-service account creation left is the citizen one', () => {
    const env = beta({ ADA_BETA_OPEN_SURFACES: 'pro,accounts,appointments' });
    expect(isAllowedInPublicBeta('POST', 'auth/signup', env)).toBe(true);
    expect(isAllowedInPublicBeta('POST', 'pro/auth/register', env)).toBe(false);
    for (const p of ['institution/login', 'institution/register', 'admin/login', 'admin/institutions']) expect(isAllowedInPublicBeta('POST', p, env), p).toBe(false);
  });
});
