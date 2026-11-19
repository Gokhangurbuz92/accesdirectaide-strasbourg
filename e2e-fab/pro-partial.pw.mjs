/**
 * G3 (19/11/2026, SD Track 2/3 gap A(c)) — the PARTIAL ADA Pro opening in the browser, on the « pro-only » server of e2e-fab/run-lab.mjs (FAB_BASE_PRO:
 * restricted beta with admin, accounts and pro open, NO capability named, NO HDS attestation, the second factor required; its own build). A platform
 * operator invites the first administrator of a verified structure; the person creates the access in the browser under the professional terms (recorded),
 * enrols the second factor, signs in again with password + code, administers the structure; every out-of-AIPD / HDS module of the console says « pas encore
 * ouvert » and its API answers 503; nothing crosses to another structure. LAB_SYNTHETIC only.
 */
import { test, expect } from '@playwright/test';
import { generateCode } from '../api/lib/totp.js';
import { CREDS, db, closeDb, bearer, anon, outbox, visitor, ips } from './lib.mjs';

const PRO = process.env.FAB_BASE_PRO || '';
const nextIp = ips(200, 219);
const STAMP = Date.now().toString(36);
const PLATFORM = 'fab-g3-platform', PILOT = `fab-g3-pilot-${STAMP}`;
const A = { email: `fab-g3-admin-${STAMP}@pros.example.test`, password: ['Synthetique', 'G3', `pro${STAMP}`].join('-') };
const S = {};
test.describe.configure({ mode: 'serial' });
test.skip(!PRO, 'needs the pro-only server started by e2e-fab/run-lab.mjs (FAB_BASE_PRO)');

/** a call with the new administrator's own session (not one of the run's pre-signed tokens) */
const asAdmin = async (method, p, body) => {
  const r = await fetch(`${PRO}${p}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${S.session}`, 'x-forwarded-for': nextIp() }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const step = () => Math.floor(Date.now() / 30000);

test.beforeAll(async () => {
  await db(`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
    VALUES ($1, 'Plateforme ADA (LAB G3)', $1, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'brouillon', 'UNVERIFIED', NOW(), NOW()),
           ($2, 'Structure pilote fictive G3', $2, 'association', '2 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING`, [PLATFORM, PILOT]);
  await db(`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", mfa_enabled, "notificationEmailEnabled", "updatedAt")
    VALUES ('fab-g3-op', 'fab-g3-op@pros.example.test', 'x', 'SUPERADMIN', 'active', $1, true, false, NOW()) ON CONFLICT (id) DO NOTHING`, [PLATFORM]);
});
test.afterAll(async () => { await closeDb(); });

test('G3 pro-only: invitation → access created in the browser under the professional terms → MFA enrolment → sign-in with the code', async ({ browser }) => {
  const inv = await bearer('g3_op', 'POST', '/api/pro/invite', { email: A.email, role: 'STRUCTURE_ADMIN', structure: PILOT }, { base: PRO, ip: nextIp() });
  expect(inv.status, JSON.stringify(inv.json)).toBe(201);
  let mails = [];
  await expect.poll(async () => (mails = await outbox(A.email, PRO)).length, { timeout: 20000 }).toBeGreaterThanOrEqual(1);
  const link = new URL(mails.at(-1).text.match(/https?:\/\/\S+\/pro\/register-invite\?token=\S+/)[0]);

  const P = await visitor(browser, nextIp, { base: PRO });
  const page = await P.context.newPage();
  await page.goto(`${PRO}${link.pathname}${link.search}`);
  const terms = page.getByTestId('pro-register-terms-statement');
  await expect(terms).toContainText('conditions d’utilisation des professionnels');
  await expect(terms).toContainText('conditions pour les structures');
  await page.locator('#reg-password').fill(A.password); await page.locator('#reg-confirm').fill(A.password);
  await page.getByRole('button', { name: 'Créer mon accès' }).click();
  await page.waitForURL('**/pro/mfa-settings**', { timeout: 30000 });
  const row = (await db('SELECT id FROM "ProUser" WHERE email = $1', [A.email]))[0];
  S.id = row.id;
  const ledger = await db(`SELECT purpose, policy_version, proof_level FROM "ConsentLog" WHERE subject_type = 'PRO_USER' AND subject_id = $1 ORDER BY purpose`, [S.id]);
  expect(ledger.map((x) => x.purpose)).toEqual(['TERMS_ACCEPTANCE_CGU_PROFESSIONNEL', 'TERMS_ACCEPTANCE_CONDITIONS_STRUCTURES']);
  expect(ledger.every((x) => x.proof_level === 'CONTRACT_ACCEPTANCE' && /@v\d/.test(x.policy_version))).toBe(true);

  const [setup] = await Promise.all([page.waitForResponse((r) => new URL(r.url()).pathname === '/api/pro/mfa-setup' && r.request().method() === 'GET'), page.getByRole('button', { name: 'Configurer le MFA' }).click()]);
  expect(setup.status()).toBe(200);
  S.secret = (await setup.json()).secret;
  await page.getByRole('button', { name: /J.ai ajouté le secret/ }).click();
  S.enrolStep = step();
  await page.locator('#verify-code').fill(generateCode(S.secret, S.enrolStep));
  await page.getByRole('button', { name: 'Activer le MFA' }).click();
  await expect(page.getByText('Votre compte est protégé par la double authentification.')).toBeVisible();

  // a fresh sign-in: the password alone gives no session, the code of a later step does
  const login = await anon('POST', '/api/pro/auth/login', { email: A.email, password: A.password }, { base: PRO, ip: nextIp() });
  expect(login.status).toBe(200); expect(login.json.mfa_required).toBe(true); expect(login.json.token).toBeUndefined();
  const v = await anon('POST', '/api/pro/auth/mfa-verify', { mfa_token: login.json.mfa_token, code: generateCode(S.secret, S.enrolStep + 1) }, { base: PRO, ip: nextIp() });
  expect(v.status, JSON.stringify(v.json)).toBe(200);
  S.session = v.json.token;
  expect(P.serverErrors).toEqual([]);
  await P.context.close();
});

test('G3 pro-only: the console says « pas encore ouvert » for every closed module, structure administration works, the closed APIs answer 503', async ({ browser }) => {
  const P = await visitor(browser, nextIp, { base: PRO, allow503: ['PUBLIC_BETA_RESTRICTED'] });
  await P.context.addInitScript((t) => { try { localStorage.setItem('pro_token', t); } catch { /* storage refused */ } }, S.session);
  const page = await P.context.newPage();
  await page.goto(`${PRO}/pro/dashboard`);
  await expect(page.getByTestId('pro-queue-not-open')).toContainText('pas encore ouverts');
  await expect(page.getByTestId('pro-dashboard-agenda-not-open')).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/indisponible/i);
  const nav = page.getByRole('navigation').first();
  for (const label of ['Dossiers suivis', 'Orientations', 'Agenda RDV', 'Messages']) await expect(nav.getByTestId('pro-nav-closed').filter({ hasText: label })).toContainText('pas encore ouvert');
  await expect(nav.locator('a[href="/pro/team"]')).toBeVisible();
  for (const screen of ['/pro/dossiers', '/pro/orientations', '/pro/rdv/agenda', '/pro/messages', '/pro/selections']) {
    await page.goto(`${PRO}${screen}`);
    await expect(page.getByTestId('pro-module-not-open'), screen).toContainText('Pas encore ouvert');
  }
  await page.goto(`${PRO}/pro/team`);
  await expect(page.locator('main')).toContainText(A.email);
  expect(P.serverErrors, 'no outage').toEqual([]);
  expect(P.designed, 'the console never requests a closed module').toEqual([]);
  await P.context.close();

  // the API itself: account and structure administration served, every HDS / out-of-AIPD module refused before its handler
  expect((await asAdmin('GET', '/api/pro/me')).json.modules).toMatchObject({ cases: false, referrals: false, dossiers: false, agenda: false, messages: false, team: true, structure: true });
  expect((await asAdmin('GET', '/api/pro/team')).status).toBe(200);
  expect((await asAdmin('GET', '/api/pro/structure')).status).toBe(200);
  expect((await asAdmin('POST', '/api/pro/invite', { email: `fab-g3-member-${STAMP}@pros.example.test`, role: 'PRO' })).status).toBe(201);
  for (const [m, p] of [['GET', '/api/pro/cases?scope=mine'], ['GET', '/api/pro/referrals?box=inbox'], ['GET', '/api/pro/selections'], ['GET', '/api/pro/dossier?shareId=x'],
    ['GET', '/api/pro/messages'], ['GET', '/api/pro/appointments'], ['POST', '/api/pro/cases']]) {
    const r = await asAdmin(m, p, m === 'POST' ? { action: 'status', id: 'x', status: 'IN_PROGRESS' } : undefined);
    expect([r.status, ['CAPABILITY_NOT_OPEN', 'PUBLIC_BETA_RESTRICTED'].includes(r.json?.error)], `${m} ${p}`).toEqual([503, true]);
  }
});

test('G3 pro-only: no cross-tenant access (another structure\'s members are neither listed nor changeable)', async () => {
  const other = CREDS.pros[Object.keys(CREDS.pros)[0]];
  expect(other.structureId).not.toBe(PILOT);
  expect(JSON.stringify((await asAdmin('GET', '/api/pro/team')).json)).not.toContain(other.email);
  for (const body of [{ targetUserId: other.id, role: 'STRUCTURE_ADMIN' }, { targetUserId: other.id, canManageSchedule: true }]) expect((await asAdmin('PATCH', '/api/pro/team', body)).status).not.toBe(200);
  expect((await asAdmin('POST', '/api/pro/invite', { email: `fab-g3-x-${STAMP}@pros.example.test`, role: 'STRUCTURE_ADMIN', structure: other.structureId })).status).toBe(403);
  const row = (await db('SELECT role, status, "structureId" FROM "ProUser" WHERE id = $1', [other.id]))[0];
  expect(row).toEqual({ role: other.role, status: 'active', structureId: other.structureId });
});
