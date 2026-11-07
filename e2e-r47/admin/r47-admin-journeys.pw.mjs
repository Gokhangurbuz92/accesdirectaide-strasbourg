// @ts-nocheck
/**
 * R47 — administration, institution, protected-data and AI journeys against the REAL backend (e2e-r47/admin/serve.mjs: built app + api/index.js, final
 * Production-equivalent configuration, synthetic fixtures, loopback mocks). Serial: one story, state carried between steps. Never :3000, never Production.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as otp from 'otplib';

const C = JSON.parse(fs.readFileSync(process.env.R47_CREDS, 'utf8'));
const B = C.base;
const [A, A2] = C.admins;
const code = (secret, ahead = 0) => otp.generateSync({ secret, epoch: Math.floor(Date.now() / 1000) + 30 * ahead });
let ip = 0;
const xff = () => { ip += 1; return `10.48.${Math.floor(ip / 250) % 250}.${(ip % 250) + 1}`; };
const CSRF = crypto.randomUUID();
/** API call: bearer (admin / pro / institution) or citizen cookie (with the double-submit CSRF pair) */
async function api(request, method, path, { bearer, cookie, data, raw } = {}) {
  const headers = { 'x-forwarded-for': xff(), 'x-csrf-token': CSRF, cookie: [`__csrf=${CSRF}`, cookie ? `ada_user_session=${cookie}` : null].filter(Boolean).join('; ') };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const r = await request.fetch(`${B}${path}`, { method, headers, data, maxRedirects: 0 });
  const buf = await r.body(); let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { json = null; }
  return raw ? { status: r.status(), buf, headers: r.headers(), json } : { status: r.status(), json, text: buf.toString('utf8'), headers: r.headers() };
}
const control = (request, p, data = {}) => request.post(`${C.control}${p}`, { data });
const S = {};   // state carried along the story

test.describe.configure({ mode: 'serial' });
test.afterEach(async ({ request }) => { await control(request, '/restore'); });

// ───────────── administration
test('A01/A16: administrator sign-in with password + TOTP in the browser, then just-in-time elevation with a fresh code', async ({ page, request }) => {
  await page.goto(`${B}/admin/login`);
  await page.locator('#email').fill(A.email); await page.locator('#password').fill(A.password);
  await page.locator('form').filter({ has: page.locator('#password') }).getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByTestId('admin-mfa-form')).toBeVisible();
  await page.locator('#mfa-code').fill(code(A.secret)); await page.getByRole('button', { name: 'Valider' }).click();
  await page.waitForURL((u) => /\/admin(\/|$)/.test(u.pathname) && !u.pathname.startsWith('/admin/login'));
  S.mfa = await page.evaluate(() => sessionStorage.getItem('access_token'));
  expect(S.mfa).toBeTruthy();
  // a write that needs elevation is refused without it
  expect((await api(request, 'POST', '/api/admin/audit-log', { bearer: S.mfa, data: { reason: 'export de contrôle R47' } })).json?.error).toBe('ELEVATION_REQUIRED');
  // a reused code is refused; the next step's code elevates
  expect((await api(request, 'POST', '/api/admin/elevation', { bearer: S.mfa, data: { action: 'elevate', code: code(A.secret), reason: 'parcours de recette R47 synthétique' } })).status).toBe(403);
  const el = await api(request, 'POST', '/api/admin/elevation', { bearer: S.mfa, data: { action: 'elevate', code: code(A.secret, 1), reason: 'parcours de recette R47 synthétique' } });
  expect(el.status).toBe(200); expect(el.json.elevation.kind).toBe('JIT');
  S.elev = el.json.token;
  expect((await api(request, 'GET', '/api/admin/elevation', { bearer: S.elev })).json.elevated).toBe(true);
  // the second administrator (two-person rules below) signs in through the API
  const l2 = await api(request, 'POST', '/api/admin/login', { data: { email: A2.email, password: A2.password } });
  expect(l2.json.mfa_required).toBe(true);
  const v2 = await api(request, 'POST', '/api/admin/mfa-verify', { bearer: l2.json.token, data: { code: code(A2.secret) } });
  expect(v2.status).toBe(200); S.mfa2 = v2.json.token;
});

test('A03/A09/D01: editorial review → verified publication through D-5 v2 (sole writer), refusals without evidence, the record becomes public', async ({ page, request }) => {
  const slug = C.aide.slug;
  expect((await api(request, 'GET', `/api/aides/${slug}`)).status).toBe(404);   // published but unverified: not public
  const g = await api(request, 'GET', `/api/admin/content-verification?entityType=aide&entityId=${C.aide.id}`, { bearer: S.mfa });
  expect(g.status).toBe(200); expect(g.json.decision.visible).toBe(false);
  const body = { entityType: 'aide', entityId: C.aide.id, action: 'VERIFY', expectedVersion: g.json.version, sourceUrl: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006',
    evidenceNote: 'Fiche officielle relue le jour même : conditions et montants conformes (test R47 synthétique).', territoryConfirmed: true };
  expect((await api(request, 'POST', '/api/admin/content-verification', { bearer: S.mfa, data: { ...body, territoryConfirmed: false } })).json.error).toBe('TERRITORY_CONFIRMATION_REQUIRED');
  expect((await api(request, 'POST', '/api/admin/content-verification', { bearer: S.mfa, data: { ...body, sourceUrl: 'https://blog.example.test/aide' } })).json.error).toBe('EVIDENCE_URL_NOT_ALLOWED');
  expect((await api(request, 'POST', '/api/admin/content-verification', { bearer: S.mfa, data: { ...body, evidenceNote: 'trop court' } })).json.error).toBe('EVIDENCE_NOTE_REQUIRED');
  const v = await api(request, 'POST', '/api/admin/content-verification', { bearer: S.mfa, data: body });
  expect(v.status).toBe(200); expect(v.json.decision.visible).toBe(true);
  expect((await api(request, 'GET', `/api/aides/${slug}`)).status).toBe(200);
  await page.goto(`${B}/aides/${slug}`);
  await expect(page.getByRole('heading', { name: C.aide.titre })).toBeVisible();
});

test('A07: withdraw (hold) hides the record at once, release republishes it; version history and audited rollback', async ({ request }) => {
  const slug = C.aide.slug;
  let g = await api(request, 'GET', `/api/admin/content-verification?entityType=aide&entityId=${C.aide.id}`, { bearer: S.mfa });
  expect((await api(request, 'POST', '/api/admin/content-verification', { bearer: S.mfa, data: { entityType: 'aide', entityId: C.aide.id, action: 'HOLD', holdReason: 'retrait de contrôle R47' } })).status).toBe(200);
  expect((await api(request, 'GET', `/api/aides/${slug}`)).status).toBe(404);
  g = await api(request, 'GET', `/api/admin/content-verification?entityType=aide&entityId=${C.aide.id}`, { bearer: S.mfa });
  const rel = await api(request, 'POST', '/api/admin/content-verification', { bearer: S.mfa, data: { entityType: 'aide', entityId: C.aide.id, action: 'RELEASE_HOLD', evidenceNote: 'retrait levé après contrôle', expectedVersion: g.json.version } });
  expect(rel.status).toBe(200);
  expect((await api(request, 'GET', `/api/aides/${slug}`)).status).toBe(200);
  const vs = await api(request, 'GET', `/api/admin/content-versions?entityType=aide&entityId=${C.aide.id}`, { bearer: S.mfa });
  expect(vs.status).toBe(200); expect(vs.json.versions.length).toBeGreaterThan(0);
  const pv = await api(request, 'GET', `/api/admin/content-versions?versionId=${vs.json.versions[0].id}`, { bearer: S.mfa });
  expect(pv.status).toBe(200);
  expect((await api(request, 'POST', '/api/admin/content-versions', { bearer: S.mfa, data: { versionId: vs.json.versions[0].id, reason: 'court' } })).json.error).toBe('REASON_REQUIRED');
  const rb = await api(request, 'POST', '/api/admin/content-versions', { bearer: S.mfa, data: { versionId: vs.json.versions[0].id, reason: 'retour à la version vérifiée (test R47)' } });
  expect(rb.status).toBe(200); expect(rb.json.ok).toBe(true);
});

test('A13: audit search finds the verification; the export needs elevation and gives a CSV', async ({ request }) => {
  const s = await api(request, 'GET', '/api/admin/audit-log?action=CONTENT_', { bearer: S.mfa });
  expect(s.status).toBe(200); expect(s.json.items.map((i) => i.action)).toEqual(expect.arrayContaining(['CONTENT_VERIFIED']));
  const e = await api(request, 'POST', '/api/admin/audit-log', { bearer: S.elev, data: { reason: 'export de contrôle R47', action: 'CONTENT_' } });
  expect(e.status).toBe(200); expect(e.headers['content-type']).toMatch(/text\/csv/);
  expect(e.text.replace(/^﻿/, '').split(/\r\n/)[0]).toBe('id,at,action,actor,entity,entityId,target,details,ipHash');
  expect((await api(request, 'GET', '/api/admin/audit-log?action=AUDIT_EXPORTED', { bearer: S.mfa })).json.items.length).toBeGreaterThan(0);
});

test('A15: a feature flag forced off (elevated, audited) closes the public route at once; cleared, it reopens', async ({ request }) => {
  const fb = { contentType: 'aide', contentId: C.aide.id, type: 'erreur', message: 'Signalement synthétique R47 sans donnée personnelle.' };
  expect((await api(request, 'POST', '/api/admin/platform', { bearer: S.mfa, data: { action: 'flag', key: 'PUBLIC_FEEDBACK', forcedOff: true, reason: 'test de coupure R47' } })).json.error).toBe('ELEVATION_REQUIRED');
  const off = await api(request, 'POST', '/api/admin/platform', { bearer: S.elev, data: { action: 'flag', key: 'PUBLIC_FEEDBACK', forcedOff: true, reason: 'test de coupure R47' } });
  expect(off.status).toBe(200); expect(off.json.flags.find((f) => f.key === 'PUBLIC_FEEDBACK').effective).toBe('OFF');
  const r = await api(request, 'POST', '/api/feedback', { data: fb });
  expect(r.status).toBe(503); expect(r.json.error).toBe('FEATURE_DISABLED');
  const on = await api(request, 'POST', '/api/admin/platform', { bearer: S.elev, data: { action: 'flag', key: 'PUBLIC_FEEDBACK', forcedOff: false, reason: 'fin du test de coupure R47' } });
  expect(on.json.flags.find((f) => f.key === 'PUBLIC_FEEDBACK').effective).toBe('ON');
  expect((await api(request, 'GET', '/api/admin/audit-log?action=FEATURE_', { bearer: S.mfa })).json.items.map((i) => i.action)).toEqual(expect.arrayContaining(['FEATURE_FORCED_OFF', 'FEATURE_OVERRIDE_CLEARED']));
});

test('A17/N10/M04: provider-status and security-signal pages render the real API answer (final configuration: providers connected)', async ({ page, request }) => {
  const ps = await api(request, 'GET', '/api/admin/provider-status', { bearer: S.mfa });
  expect(ps.json.providers.find((p) => p.id === 'video').state).toBe('CONNECTED');
  expect(JSON.stringify(ps.json)).not.toContain(process.env.R47_NEVER || 'SYNTHETIC-TEST-ONLY-');   // names and states only, never a value
  await page.addInitScript((t) => sessionStorage.setItem('access_token', t), S.mfa);
  await page.goto(`${B}/admin/fournisseurs`);
  await expect(page.getByRole('heading', { name: 'Fournisseurs et intégrations' })).toBeVisible();
  await expect(page.getByTestId('admin-providers-summary')).toBeVisible();
  await page.goto(`${B}/admin/securite`);
  await expect(page.getByRole('heading', { name: 'Signaux de sécurité' })).toBeVisible();
  expect((await api(request, 'GET', '/api/admin/security-signals', { bearer: S.mfa })).status).toBe(200);
});

test('A12/X11: privacy console — legal hold blocks an approved erasure (two administrators), restriction requested and listed', async ({ page, request }) => {
  await page.addInitScript((t) => sessionStorage.setItem('access_token', t), S.mfa);
  await page.goto(`${B}/admin/privacy`);
  await expect(page.getByRole('heading', { name: 'Console de protection des données' })).toBeVisible();
  const h = await api(request, 'POST', '/api/admin/privacy', { bearer: S.mfa, data: { action: 'hold_place', dataCategory: 'CitizenUser', recordId: C.citizen2.id, reasonCode: 'conservation pour litige (test R47)' } });
  expect(h.status).toBe(200);
  const d = await api(request, 'DELETE', '/api/auth/delete-account', { cookie: C.citizen2.cookie });
  expect(d.status).toBe(202); const id = d.json.requestId;
  const p = await api(request, 'POST', '/api/admin/dsr-erasure', { bearer: S.mfa, data: { id, decision: 'APPROVE', reason: 'demande légitime de la personne (test R47)' } });
  expect(p.status).toBe(200);
  expect((await api(request, 'POST', '/api/admin/dsr-erasure', { bearer: S.mfa, data: { id, action: 'confirm', note: 'même administrateur', proposedAt: p.json.proposedAt || p.json.request?.proposedAt } })).status).toBe(403);
  expect((await api(request, 'GET', `/api/admin/dsr-erasure?id=${id}`, { bearer: S.mfa2 })).status).toBe(200);   // the second reviewer reads it first
  const open = await api(request, 'GET', '/api/admin/dsr-erasure', { bearer: S.mfa2 });
  const proposedAt = JSON.stringify(open.json).match(new RegExp(`"id":"${id}"[^}]*?"proposedAt":"([^"]+)"`))?.[1];
  expect(proposedAt).toBeTruthy();
  const cf = await api(request, 'POST', '/api/admin/dsr-erasure', { bearer: S.mfa2, data: { id, action: 'confirm', note: 'second contrôle (test R47)', proposedAt } });
  expect(cf.status).toBe(200); expect(cf.json.blockedBy).toBe('LEGAL_HOLD_ACTIVE');
  // restriction (art. 18): requested by the person, listed for the administrators
  const rq = await api(request, 'POST', '/api/citizen/restriction', { cookie: C.citizen.cookie, data: { action: 'request', ground: 'ACCURACY_CONTESTED' } });
  expect([200, 201]).toContain(rq.status);
  const lr = await api(request, 'GET', '/api/admin/processing-restrictions', { bearer: S.mfa });
  expect(lr.status).toBe(200);
  const mine = lr.json.restrictions.find((x) => x.ground === 'ACCURACY_CONTESTED');
  expect(mine).toBeTruthy(); expect(mine.account).not.toBe(C.citizen.email); expect(mine.account).toMatch(/…@example\.test$/);   // the address is masked
  const lift = await api(request, 'POST', '/api/admin/processing-restrictions', { bearer: S.mfa, data: { id: mine.id, reason: 'exactitude vérifiée (test R47)' } });
  expect(lift.status).toBe(200);
  expect((await api(request, 'GET', '/api/admin/processing-restrictions', { bearer: S.mfa })).json.restrictions.find((x) => x.id === mine.id)).toBeFalsy();
});

test('C05: guardianship verification screen — policy configured, the waiting link listed', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('access_token', t), S.mfa);
  await page.goto(`${B}/admin/representants-legaux`);
  await expect(page.getByTestId('admin-guardians-policy')).toHaveAttribute('data-state', 'CONFIGURED');
  await expect(page.getByTestId('admin-guardians-count')).toContainText('1');
});

// ───────────── institution
test('I01/I02/I04: institution credentials in the browser → authorized dashboard; small cells suppressed (k = 5, secondary suppression)', async ({ page, request }) => {
  await page.goto(`${B}/institution`);
  await page.locator('#inst-email').fill(C.institution.email); await page.locator('#inst-pass').fill(C.institution.password);
  await page.locator('form').filter({ has: page.locator('#inst-email') }).getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByTestId('institution-space')).toBeVisible();
  await expect(page.getByTestId('institution-by-need')).toBeVisible();
  S.inst = await page.evaluate(() => sessionStorage.getItem('institution_token'));
  const o = await api(request, 'GET', '/api/institution/observatoire', { bearer: S.inst });
  expect(o.json.kAnonymityMin).toBe(5);
  const byNeed = Object.fromEntries(o.json.byNeed.map((r) => [r.need, r]));
  expect(byNeed.HOUSING.sent).toBe(7);              // published
  expect(byNeed.EMPLOYMENT.sent).toBeNull();        // 2 < 5: primary suppression
  expect(byNeed.HEALTH.sent).toBeNull();            // secondary: the smallest published cell of a column with one masked cell
  expect(byNeed.HOUSING.unmet).toBeNull();          // 2 unmet < 5
});

test('I03: permitted export (CSV, licence pending), then the institution token opens no individual dossier', async ({ request }) => {
  const e = await api(request, 'GET', '/api/institution/export?period=quarter', { bearer: S.inst });
  expect(e.status).toBe(200); expect(e.text).toMatch(/PENDING_OWNER_DECISION/); expect(e.text).not.toMatch(/@example\.test/);
  for (const p of ['/api/citizen/dossier', '/api/citizen/coffre', '/api/pro/cases', '/api/admin/privacy']) expect([401, 403, 404]).toContain((await api(request, 'GET', p, { bearer: S.inst })).status);
  await control(request, '/env', { name: 'OPEN_DATA_EXPORT_ENABLED', value: null });
  expect((await api(request, 'GET', '/api/institution/export?period=quarter', { bearer: S.inst })).json.error).toBe('EXPORT_NOT_OPEN');
});

// ───────────── protected data (ProtectedStore, certified-host stand-in)
const pdf = Buffer.from('%PDF-1.4\n% SYNTHETIC-TEST-ONLY R47 coffre\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').toString('base64');
test('C09/C14/C17/R13: a synthetic document through the ProtectedStore — authorized access, share to an organisation, revoke, delete', async ({ request }) => {
  const before = await (await control(request, '/hds')).json();
  const up = await api(request, 'POST', '/api/citizen/coffre', { cookie: C.citizen.cookie, data: { category: 'logement', originalName: 'quittance-synthetique.pdf', mimeType: 'application/pdf', fileBase64: pdf } });
  expect(up.status).toBe(201); S.doc = up.json.document.id;
  expect((await (await control(request, '/hds')).json()).objects).toBe(before.objects + 1);
  const dl = await api(request, 'GET', `/api/citizen/coffre?download=${S.doc}`, { cookie: C.citizen.cookie, raw: true });
  expect(dl.status).toBe(200); expect(dl.buf.toString('utf8')).toContain('SYNTHETIC-TEST-ONLY R47 coffre');
  // another person cannot read it
  expect((await api(request, 'GET', `/api/citizen/coffre?download=${S.doc}`, { cookie: C.citizen2.cookie, raw: true })).status).toBe(404);
  // share: a dossier, an invitation of the organisation, its member redeems it, the document is shared into the dossier
  const sh = await api(request, 'POST', '/api/share/create', { cookie: C.citizen.cookie, data: { situation: { territoire: 'Strasbourg' }, results: { synthetic: true } } });
  expect(sh.status).toBe(200); S.share = sh.json;
  const inv = await api(request, 'POST', '/api/public/dossier-grants', { cookie: C.citizen.cookie, data: { shareId: S.share.shareId, action: 'invite', structureId: C.pro.structureId, rightsSecret: S.share.ownerSecret } });
  expect(inv.status).toBe(201);
  const rd = await api(request, 'POST', '/api/pro/dossier/redeem', { bearer: C.pro.token, data: { shareId: S.share.shareId, inviteToken: inv.json.inviteToken } });
  expect(rd.status).toBeLessThan(300);
  const fs1 = await api(request, 'POST', '/api/citizen/coffre', { cookie: C.citizen.cookie, data: { action: 'share', documentId: S.doc, shareId: S.share.shareId, structureId: C.pro.structureId } });
  expect(fs1.status).toBe(201);
  const pd = await api(request, 'GET', `/api/pro/dossier?shareId=${encodeURIComponent(S.share.shareId)}`, { bearer: C.pro.token });
  expect(pd.status).toBe(200);
  // revoke: the organisation loses the dossier at once
  const rv = await api(request, 'POST', '/api/public/dossier-grants', { cookie: C.citizen.cookie, data: { shareId: S.share.shareId, action: 'revoke', structureId: C.pro.structureId, rightsSecret: S.share.ownerSecret } });
  expect(rv.status).toBeLessThan(300);
  expect([403, 404]).toContain((await api(request, 'GET', `/api/pro/dossier?shareId=${encodeURIComponent(S.share.shareId)}`, { bearer: C.pro.token })).status);
  // delete: gone from the certified host too
  const n = (await (await control(request, '/hds')).json()).objects;
  expect((await api(request, 'DELETE', '/api/citizen/coffre', { cookie: C.citizen.cookie, data: { id: S.doc } })).status).toBe(200);
  expect((await (await control(request, '/hds')).json()).objects).toBe(n - 1);
});

test('C09 fail-closed: no HDS token → 503 CAPABILITY_NOT_OPEN; a Preview deployment with the LAB driver → 503 PROTECTED_STORE_REFUSED; nothing stored; rollback reopens', async ({ request }) => {
  const up = () => api(request, 'POST', '/api/citizen/coffre', { cookie: C.citizen.cookie, data: { category: 'autre', originalName: 'refus.pdf', mimeType: 'application/pdf', fileBase64: pdf } });
  const n0 = (await (await control(request, '/hds')).json()).objects;
  await control(request, '/env', { name: 'ADA_HDS_CERTIFIED_HOSTING', value: null });
  let r = await up(); expect(r.status).toBe(503); expect(r.json).toMatchObject({ code: 'CAPABILITY_NOT_OPEN', capability: 'citizen.vault' });
  expect(Object.keys(r.json).sort()).toEqual(['capability', 'code', 'error', 'message']);
  await control(request, '/restore');
  await control(request, '/env', { name: 'VERCEL_ENV', value: 'preview' }); await control(request, '/env', { name: 'ADA_PROTECTED_STORE', value: 'lab' });
  r = await up(); expect(r.status).toBe(503); expect(r.json.error).toBe('PROTECTED_STORE_REFUSED');
  expect((await (await control(request, '/hds')).json()).objects).toBe(n0);
  await control(request, '/restore');
  r = await up(); expect(r.status).toBe(201);
  await api(request, 'DELETE', '/api/citizen/coffre', { cookie: C.citizen.cookie, data: { id: r.json.document.id } });
});

// ───────────── AI and eligibility
test('P16/P17/D17/D18: public orientation page; sourced answer; abstention out of scope; an invented eligibility claim is refused', async ({ page, request }) => {
  await page.goto(`${B}/orientation`);
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByTestId('public-beta-unavailable')).toHaveCount(0);   // the screen is open in this build (diagnostic surface)
  // R47 defect fix: with accounts / appointments / documents opened by the build, the banner no longer claims they are « pas encore ouverts »
  await expect(page.getByTestId('public-beta-banner')).toContainText('Certaines fonctions ouvrent progressivement');
  await expect(page.getByTestId('public-beta-banner')).not.toContainText('pas encore ouverts');
  const ok = await api(request, 'POST', '/api/public/assistant/orient', { data: { message: 'Aide synthétique pour payer le loyer', territory: 'Strasbourg' } });
  expect(ok.status).toBe(200); expect(ok.json.abstention).toBe(false); expect(ok.json.grounded).toBe(true);
  expect(ok.json.citations[0].sourceUrl).toMatch(/^https:\/\/www\.service-public\.gouv\.fr\//);
  const law = await api(request, 'POST', '/api/public/assistant/orient', { data: { message: 'Rédigez-moi des conclusions d’avocat pour attaquer mon bailleur au tribunal', territory: 'Strasbourg' } });
  expect(law.json.abstention).toBe(true); expect(law.json.meta.reason).toBe('legal_advice_out_of_scope');
  const away = await api(request, 'POST', '/api/public/assistant/orient', { data: { message: 'Aide pour payer le loyer', territory: 'Marseille' } });
  expect(away.json.abstention).toBe(true); expect(away.json.meta.reason).toMatch(/^territory_/);
  const inv = await api(request, 'POST', '/api/public/assistant/orient', { data: { message: 'Aide synthétique pour payer le loyer promesse-synthetique', territory: 'Strasbourg' } });
  expect(inv.json.abstention).toBe(true); expect(inv.json.meta.reason).toBe('eligibility_claim_blocked');
  expect(inv.json.answer).not.toMatch(/vous avez droit/i);
});

test('P13/D10/D11/D20: OpenFisca states — simulation (non-authoritative), engine up (indicative, no expert-validated rule), engine down (503 OPENFISCA_UNAVAILABLE)', async ({ request }) => {
  const answers = { birthDate: '1990-01-01', situationFamiliale: 'celibataire', revenusMensuels: 900, logement: 'locataire', loyer: 500, codePostal: '67000' };
  const sim = await api(request, 'POST', '/api/diagnostic', { data: { mode: 'SIMULATION_MODE', answers } });
  expect(sim.status).toBe(200); expect(sim.json).toMatchObject({ mode: 'SIMULATION_NON_AUTHORITATIVE', authoritative: false });
  const up = await api(request, 'POST', '/api/diagnostic', { data: { mode: 'AUTHORITATIVE_MODE', answers } });
  expect(up.status).toBe(200); expect(up.json.authoritative).toBe(false); expect(up.json.meta.source).toBe('openfisca');
  const text = JSON.stringify(up.json.estimates);
  expect(text).toContain('NOT_EXPERT_VALIDATED'); expect(text).not.toContain('"EXPERT_VALIDATED"');
  await control(request, '/openfisca', { up: false });
  const down = await api(request, 'POST', '/api/diagnostic', { data: { mode: 'AUTHORITATIVE_MODE', answers } });
  expect(down.status).toBe(503); expect(down.json.code).toBe('OPENFISCA_UNAVAILABLE'); expect(down.json.assessment.items.map((i) => i.state)).toEqual(['ENGINE_UNAVAILABLE']);
});

test('G-3 (V1a): with ONLY « admin » open (« accounts » closed) the console opens after MFA — never « momentanément indisponible »; an invalid session goes back to sign-in; every other surface stays closed', async ({ page, request }) => {
  await control(request, '/env', { name: 'ADA_BETA_OPEN_SURFACES', value: 'admin' });
  // the session check of the console (auth/me) with the MFA session of step A01
  const probe = await api(request, 'GET', '/api/auth/me', { bearer: S.mfa });
  expect(probe.status, probe.text).toBe(200); expect(probe.json.session.kind).toBe('admin');
  // the browser: the same MFA session opens the console
  await page.goto(`${B}/admin/login`);
  await page.evaluate((t) => sessionStorage.setItem('access_token', t), S.mfa);
  await page.goto(`${B}/admin`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('service-unavailable')).toHaveCount(0);
  expect(new URL(page.url()).pathname).toMatch(/^\/admin(\/(?!login)[a-z-]+)?$/);   // the console (e.g. /admin/dashboard), not the sign-in page
  await expect(page.locator('main')).toBeVisible();
  // an invalid session: back to the sign-in page (signed out), not an outage
  await page.evaluate(() => sessionStorage.setItem('access_token', 'invalid.session.token'));
  await page.goto(`${B}/admin`);
  await page.waitForURL((u) => u.pathname === '/admin/login');
  await expect(page.getByTestId('service-unavailable')).toHaveCount(0);
  expect((await api(request, 'GET', '/api/auth/me', { bearer: 'invalid.session.token' })).status).toBe(401);
  // citizen and professional sessions are not recognised while their surfaces are closed; their routes stay closed
  expect((await api(request, 'GET', '/api/auth/me', { cookie: C.citizen.cookie })).status).toBe(401);
  expect((await api(request, 'GET', '/api/auth/me', { bearer: C.pro.token })).status).toBe(401);
  for (const [p, o] of [['/api/citizen/espace', { cookie: C.citizen.cookie }], ['/api/pro/me', { bearer: C.pro.token }], ['/api/pro/notifications', { bearer: C.pro.token }],
    ['/api/rdv/appointments', { cookie: C.citizen.cookie }], ['/api/institution/me', {}], ['/api/diagnostic', {}], ['/api/messages', {}], ['/api/contact', {}], ['/api/citizen/coffre', { cookie: C.citizen.cookie }]]) {   // (jobs: this LAB server opens them in its final configuration; their closure is proven on Production by the V1a probe)
    const r = await api(request, 'GET', p, o);
    expect(r.status, p).toBe(503); expect(r.json?.error, p).toBe('PUBLIC_BETA_RESTRICTED');
  }
  // the console API itself stays behind the administrator session
  expect((await api(request, 'GET', '/api/admin/provider-status')).status).toBe(401);
  expect((await api(request, 'GET', '/api/admin/provider-status', { bearer: S.mfa })).status).toBe(200);
});

test('G-4 (V1a): sign-in → MFA → console and the redirects of the administration never leave a blank page (no fade between administration pages)', async ({ page, request }) => {
  await control(request, '/env', { name: 'ADA_BETA_OPEN_SURFACES', value: 'admin' });
  // samples the opacity of the administration wrapper every 50 ms until stop() — the minimum after the first full paint must stay visible
  const opacity = () => page.evaluate(() => { const w = document.querySelector('#root .w-full.h-full.min-h-screen'); return w ? Number(getComputedStyle(w).opacity) : -1; });
  const watch = () => { const seen = []; let on = true; const run = (async () => { while (on) { seen.push(await opacity().catch(() => -1)); await page.waitForTimeout(50); } })(); return async () => { on = false; await run; return seen; }; };
  const afterFullPaint = (seen) => seen.slice(Math.max(0, seen.findIndex((v) => v >= 0.99)));
  // 1. a protected page without a session → the sign-in page (redirect), visible
  await page.goto(`${B}/admin/dashboard`);
  await page.waitForURL((u) => u.pathname === '/admin/login');
  await expect.poll(opacity).toBeGreaterThanOrEqual(0.99);
  // 2. sign-in → MFA → /admin → /admin/dashboard: the page never fades out (the code of a fresh 30-s window: the administrator's earlier codes are spent)
  await page.locator('#email').fill(A2.email); await page.locator('#password').fill(A2.password);
  await page.locator('form').filter({ has: page.locator('#password') }).getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByTestId('admin-mfa-form')).toBeVisible();
  const wait = 30 - (Math.floor(Date.now() / 1000) % 30) + 1; await page.waitForTimeout(wait * 1000);
  await page.locator('#mfa-code').fill(code(A2.secret));
  const stop = watch();
  await page.getByRole('button', { name: 'Valider' }).click();
  await page.waitForURL((u) => u.pathname === '/admin/dashboard');
  await page.waitForTimeout(1200);
  const seen = afterFullPaint(await stop());
  expect(Math.min(...seen), `opacity samples ${seen.join(',')}`).toBeGreaterThanOrEqual(0.99);
  await expect(page.locator('main')).toBeVisible();
  // 3. an in-app redirect inside the administration (/admin → /admin/dashboard) keeps the page visible
  const stop2 = watch();
  await page.evaluate(() => { window.history.pushState({}, '', '/admin'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForURL((u) => u.pathname === '/admin/dashboard');
  await page.waitForTimeout(800);
  const seen2 = await stop2();
  expect(Math.min(...seen2), `opacity samples ${seen2.join(',')}`).toBeGreaterThanOrEqual(0.99);
});
