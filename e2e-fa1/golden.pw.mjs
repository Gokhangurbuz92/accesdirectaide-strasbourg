/**
 * FA-D1 — the GOLDEN JOURNEY (master directive § E), browser layer on the REAL API (run-lab.mjs), LAB_SYNTHETIC. ONE synthetic case (CASE, carried by every
 * free text the journey writes and searched for where it must NOT appear): a tenant who lost their income, is behind with the rent, needs disability-related
 * help and reads Arabic. The person acts in the browser (Arabic interface, right to left); the organisations act through their sessions on the same API
 * (their screens are covered by e2e-r46 / e2e-r47); every step is checked in the database. The API / database layer of the same journey, with the
 * cross-tenant attacks, is tests/integration/fa1-golden-journey-db.test.js. The decline is a SYNTHETIC answer; nothing here is a real partner's decision,
 * a legal entitlement or a delivered e-mail.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, CREDS, LANGS, person, bearer, db, citizenSignIn, axe, overflow, evidence, closeDb, finalResponse } from './lib.mjs';

test.describe.configure({ mode: 'serial' });
test.afterAll(async () => { await closeDb(); });
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const locale = (lang, ns) => JSON.parse(fs.readFileSync(path.join(ROOT, `src/i18n/locales/${lang}/${ns}.json`), 'utf8'));
const AR = { messaging: locale('ar', 'messaging'), pro: locale('ar', 'pro') };
const CASE = `fa1-golden-browser-${Date.now().toString(36)}`;
const G = CREDS.citizens.golden; const ORG = CREDS.structures;
const S = {};   // the case's ids, stage by stage
const FRENCH_STATUS = ['Déclinée', 'Annulée', 'Acceptée', 'En attente de l’accord de la personne', 'La personne n’a pas poursuivi', 'Logement'];
const grants = async (st) => (await db(`SELECT count(*)::int n FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = $1 ${st ? 'AND "structureId" = $2' : ''} AND "revokedAt" IS NULL`, st ? [S.shareId, st] : [S.shareId]))[0].n;
const referral = async (id) => (await db(`SELECT status, outcome, "previousReferralId", "toStructureId" FROM "Referral" WHERE id = $1`, [id]))[0];

let P; let page;
test.beforeAll(async ({ browser }) => {
  P = await person(browser, { lang: 'ar' });
  page = await P.context.newPage();
  await citizenSignIn(page, G, '/compte');
});
test.afterAll(async () => { await P?.context.close(); });

test('GB1 · limited French: the situation said in Arabic → three needs with official sources (French text marked French) → three Mon Parcours steps chosen in the closed list, in Arabic, right to left', async () => {
  const resp = finalResponse(page, (u, m) => u.endsWith('/api/search') && m === 'POST');
  await page.goto(`${BASE}/recherche?q=${encodeURIComponent('لا أستطيع دفع الإيجار، ليس لدي دخل، وأحتاج ملف الإعاقة')}`);
  const out = await (await resp).json();
  expect(out.orientation.needs.map((n) => n.id)).toEqual(expect.arrayContaining(['expulsion-impayes', 'minima-sociaux', 'mdph-droits']));
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  // G14 (limited Mon Parcours): the orientation no longer turns a need into a step (no « add to my plan » button: records are refused); the person
  // chooses generic steps in the closed list, in their language. The disability need (« mdph-droits ») has NO step type by design (RGPD art. 9).
  await expect(page.getByTestId('parcours-add-record-button')).toHaveCount(0);
  await page.goto(`${BASE}/compte/parcours`);
  for (const code of ['FSL_DEMANDE', 'RSA_DEMANDE', 'AIDE_LOGEMENT_DEMANDE']) {
    await page.getByTestId('parcours-type-select').selectOption(code);
    const posted = finalResponse(page, (u, m) => u.endsWith('/api/citizen/parcours') && m === 'POST');
    await page.getByTestId('parcours-add').click();
    expect((await posted).status()).toBe(201);
    await expect(page.getByTestId('parcours-type-select')).toHaveValue('');   // the form is emptied for the next choice
  }
  await expect(page.getByTestId('compte-parcours')).toHaveAttribute('data-contract', 'limited');
  await expect(page.getByTestId('parcours-new-title')).toHaveCount(0);   // no free title
  await expect(page.getByTestId('parcours-item')).toHaveCount(3);
  await axe(page, 'GB1 Mon Parcours ar');
  const rows = await db(`SELECT id, title, "itemCodes", "planStep" FROM "ParcoursItem" WHERE "userId" = $1 ORDER BY "createdAt"`, [G.id]);
  expect(rows.map((r) => r.itemCodes)).toEqual([['steptype:FSL_DEMANDE'], ['steptype:RSA_DEMANDE'], ['steptype:AIDE_LOGEMENT_DEMANDE']]);
  expect(rows.every((r) => r.planStep === null)).toBe(true);
  S.steps = rows.map((r) => r.id);
  evidence('GOLDEN (browser)', 'need → possible rights → Mon Parcours plan (ar, RTL)', `case ${CASE}; ParcoursItem ${S.steps.join(',')}`);
});

test('GB2 · consented sharing from the dossier page: the person finds the territory-correct organisation X and confirms; X redeems the single-use invitation; nobody else has access', async () => {
  const created = await P.api('POST', '/api/share/create', { situation: { zipCode: '67000', note: CASE }, results: { rights: [] } });   // the diagnostic screen's own call
  expect(created.status).toBe(200);
  S.shareId = created.json.shareId;
  await page.goto(`${BASE}/compte/partages/${encodeURIComponent(S.shareId)}`);
  await page.locator('#org-search').fill('FA1 Accueil');
  await page.getByRole('button', { name: new RegExp(ORG.X.nom) }).click();
  await expect(page.getByTestId('share-summary')).toBeVisible();
  const inv = finalResponse(page, (u, m) => u.endsWith('/api/public/dossier-grants') && m === 'POST');
  await page.getByTestId('share-summary').getByRole('button', { name: AR.messaging['sharing.confirm_share'] }).click();
  const ir = await inv; expect(ir.status()).toBe(201);
  await expect(page.getByTestId('invite-ready')).toBeVisible();
  const link = await page.getByTestId('invite-ready').locator('input[readonly]').inputValue();
  const token = decodeURIComponent(/#invite=([^&]+)/.exec(link)[1]);
  expect((await bearer('pro_m1', 'POST', '/api/pro/dossier/redeem', { shareId: S.shareId, inviteToken: token })).status, 'another tenant cannot use it').not.toBe(200);
  expect((await bearer('pro_x1', 'POST', '/api/pro/dossier/redeem', { shareId: S.shareId, inviteToken: token })).status).toBe(200);
  expect(await grants(ORG.X.id)).toBe(1); expect(await grants()).toBe(1);
  evidence('GOLDEN (browser)', 'consented sharing (UI invite → X)', `SharedDiagnostic ${S.shareId}; grant X only; M refused`);
});

test('GB3 · ADA Pro referral authorized in « Mes orientations » (Arabic): nothing reaches Y before the person accepts', async () => {
  const cases = (await bearer('pro_xa', 'GET', '/api/pro/cases?scope=unassigned')).json.cases;
  S.caseId = cases.find((c) => c.dossierId === S.shareId).id;
  expect((await bearer('pro_xa', 'POST', '/api/pro/cases', { action: 'assign', id: S.caseId, userId: CREDS.pros.x1.id })).status).toBe(200);
  const p = await bearer('pro_x1', 'POST', '/api/pro/referrals', { action: 'propose', caseId: S.caseId, toStructureId: ORG.Y.id, reasonCode: 'HOUSING', message: `logement ${CASE}` });
  expect(p.status, p.text).toBe(201); S.a = p.json.referral.id;
  expect(await grants(ORG.Y.id)).toBe(0);
  await page.goto(`${BASE}/compte/orientations`);
  await expect(page.getByTestId('orientation-pending')).toHaveCount(1);
  for (const w of FRENCH_STATUS) await expect(page.getByTestId('orientation-pending')).not.toContainText(w);   // D-FA1-1: the motive in Arabic
  await axe(page, 'GB3 orientations ar');
  const decided = finalResponse(page, (u, m) => u.endsWith('/api/citizen/referrals') && m === 'POST');
  await page.getByTestId('orientation-accept').click();
  expect((await decided).status()).toBe(200);
  expect(await grants(ORG.Y.id)).toBe(1);
  evidence('GOLDEN (browser)', 'consented referral X → Y (accept in ar UI)', `Referral ${S.a}; grant Y`);
});

test('GB4 · synthetic decline (LAB_SYNTHETIC) with a suggestion → the person reads it in Arabic (status translated, suggested organisation, nothing sent to it) → the linked second route is authorized in the browser', async () => {
  expect((await bearer('pro_y1', 'POST', '/api/pro/referrals', { action: 'decline', id: S.a, responseCode: 'REDIRECT_SUGGESTED', suggestedStructureId: ORG.Z.id, message: `note interne ${CASE}` })).status).toBe(200);
  expect(await grants(ORG.Y.id)).toBe(0);
  await page.goto(`${BASE}/compte/orientations`);
  const item = page.getByTestId('orientation-item').filter({ hasText: ORG.Y.nom });
  await expect(item.getByTestId('orientation-item-status')).toHaveText(AR.pro['case_labels.referral.declined']);
  await expect(item.getByTestId('orientation-suggested')).toContainText(ORG.Z.nom);
  await expect(page.locator('body')).not.toContainText(`note interne ${CASE}`);
  const b = await bearer('pro_x1', 'POST', '/api/pro/referrals', { action: 'propose', caseId: S.caseId, toStructureId: ORG.Z.id, reasonCode: 'HOUSING', previousReferralId: S.a, message: `suite ${CASE}` });
  expect(b.status, b.text).toBe(201); S.b = b.json.referral.id;
  await page.reload();
  await expect(page.getByTestId('orientation-pending').getByTestId('orientation-follows')).toBeVisible();
  const decided = finalResponse(page, (u, m) => u.endsWith('/api/citizen/referrals') && m === 'POST');
  await page.getByTestId('orientation-accept').click();
  expect((await decided).status()).toBe(200);
  expect(await referral(S.b)).toMatchObject({ previousReferralId: S.a, toStructureId: ORG.Z.id });
  expect(await grants(ORG.Z.id)).toBe(1);
  const z = await bearer('pro_z1', 'GET', `/api/pro/referrals?id=${encodeURIComponent(S.b)}`);
  for (const hidden of [S.a, `note interne ${CASE}`, ORG.Y.nom]) expect(z.text).not.toContain(hidden);
  expect((await bearer('pro_z1', 'POST', '/api/pro/referrals', { action: 'acknowledge', id: S.b })).status).toBe(200);
  expect((await bearer('pro_z1', 'POST', '/api/pro/referrals', { action: 'accept', id: S.b })).status).toBe(200);
  evidence('GOLDEN (browser)', 'synthetic decline → linked second route (accept in ar UI)', `Referral ${S.a} DECLINED (REDIRECT_SUGGESTED → Z) → ${S.b} ACCEPTED by Z; Z sees nothing of Y`);
});

test('GB5 · consent withdrawal on the dossier page (Arabic): every access ends, the accepted referral closes as « the person did not continue », the organisations cannot read; the Observatoire shows nothing of the case', async () => {
  await page.goto(`${BASE}/compte/partages/${encodeURIComponent(S.shareId)}`);
  await page.getByRole('button', { name: AR.messaging['sharing.stop_all'] }).click();
  const stop = finalResponse(page, (u, m) => u.endsWith('/api/public/dossier-grants') && m === 'POST');
  await page.getByRole('button', { name: AR.messaging['sharing.yes_stop'] }).click();
  const sr = await stop; expect(sr.status()).toBe(200);
  expect(await sr.json()).toMatchObject({ grants: 2, referralsClosed: 1 });
  expect(await grants()).toBe(0);
  expect(await referral(S.b)).toMatchObject({ status: 'CANCELLED', outcome: 'CITIZEN_WITHDREW' });
  for (const t of ['pro_x1', 'pro_z1', 'pro_y1']) expect((await bearer(t, 'GET', `/api/pro/dossier?shareId=${encodeURIComponent(S.shareId)}`)).status, t).toBe(404);
  await page.goto(`${BASE}/compte/orientations`);
  const item = page.getByTestId('orientation-item').filter({ has: page.getByTestId('orientation-outcome') });   // the second route (the first one has no outcome)
  await expect(item).toHaveCount(1);
  await expect(item.getByTestId('orientation-item-status')).toHaveText(AR.pro['case_labels.referral.cancelled']);
  await expect(item.getByTestId('orientation-outcome')).toContainText(AR.pro['case_labels.outcome.citizen_withdrew']);
  const obs = await bearer('inst67', 'GET', '/api/institution/observatoire');
  expect(obs.status).toBe(200);
  for (const hidden of [CASE, S.shareId, S.a, S.b, S.caseId, ORG.X.id, ORG.Y.id, ORG.Z.id, ORG.X.nom, ORG.Z.nom, G.email]) expect(obs.text).not.toContain(hidden);
  expect((await bearer('inst68', 'GET', '/api/institution/observatoire?territory=Bas-Rhin')).status).toBe(400);
  expect((await bearer('inst67', 'GET', '/api/citizen/referrals')).status).not.toBe(200);
  const trail = (await db(`SELECT action FROM "AuditLog" WHERE details->>'shareId' = $1 OR (entity = 'Referral' AND entity_id IN ($2, $3))`, [S.shareId, S.a, S.b])).map((r) => r.action);
  expect(trail).toEqual(expect.arrayContaining(['DOSSIER_INVITE_CREATED', 'DOSSIER_SHARING_STOPPED_BY_OWNER', 'REFERRAL_REDIRECT_SUGGESTED']));
  evidence('GOLDEN (browser)', 'consent withdrawal (stop sharing in ar UI) + Observatoire', `grants 0; ${S.b} CANCELLED/CITIZEN_WITHDREW; observatoire 200 without any case id; audit ${[...new Set(trail)].join(',')}`);
  expect(P.serverErrors).toEqual([]); expect(P.external).toEqual([]);
});

test('GB6 · six languages: « Mes orientations » and Mon Parcours of the case in fr, en, tr, ar, de, uk — lang / dir set, no French status or motive in the other five, axe 0 serious; Arabic at 320 px without sideways scroll', async ({ browser }) => {
  const state = await P.context.storageState();
  for (const lang of LANGS) {
    const q = await person(browser, { lang });
    await q.context.addCookies(state.cookies);
    const pg = await q.context.newPage();
    for (const route of ['/compte/orientations', '/compte/parcours']) {
      await pg.goto(`${BASE}${route}`);
      await expect(pg.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
      await expect(pg.locator('html')).toHaveAttribute('lang', new RegExp(`^${lang}`));
      if (route === '/compte/orientations') {
        await expect(pg.getByTestId('orientation-item')).toHaveCount(2);
        if (lang !== 'fr') for (const w of FRENCH_STATUS) await expect(pg.getByTestId('compte-orientations')).not.toContainText(w);
      } else await expect(pg.getByTestId('parcours-item')).toHaveCount(3);
      await axe(pg, `GB6 ${lang} ${route}`);
    }
    expect(q.serverErrors).toEqual([]);
    await q.context.close();
  }
  const n = await person(browser, { lang: 'ar', viewport: { width: 320, height: 720 } });
  await n.context.addCookies(state.cookies);
  const np = await n.context.newPage();
  for (const route of ['/compte/orientations', '/compte/parcours']) { await np.goto(`${BASE}${route}`); await expect(np.locator('h1')).toBeVisible(); expect(await overflow(np), route).toBeLessThanOrEqual(0); }
  await n.context.close();
  evidence('GOLDEN (browser)', 'six-language UI of the case', 'fr/en/tr/ar/de/uk: lang+dir, no French codes outside fr, axe 0 serious; ar 320 px no overflow');
});
