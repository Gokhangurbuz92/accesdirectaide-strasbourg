/**
 * FA-D1 — synthetic citizen PERSONAS on the REAL API (run-lab.mjs), LAB_SYNTHETIC. Each persona walks a real journey — public search / orientation → rights
 * information with its official sources → local services → (account + Mon Parcours where approved) → a next step they can read — and meets the error states
 * of the directive: no result, closed surface / service unavailable, stale source, refusal, retry, network loss, administrator recovery. Every step is
 * checked on the SERVER side too (API status, database rows), never by a click alone. Not a test with real people: real-user acceptance is NOT_YET_PERFORMED.
 */
import { test, expect } from '@playwright/test';
import { BASE, BASE_CLOSED, CREDS, person, bearer, db, citizenSignIn, outbox, axe, overflow, evidence, closeDb, finalResponse, settle } from './lib.mjs';

test.describe.configure({ mode: 'serial' });
test.afterAll(async () => { await closeDb(); });
const C = CREDS.citizens; const ORG = CREDS.structures;
const guide = (sheet) => CREDS.guides.find((g) => g.sheet === sheet);
const searchFor = async (page, q) => {
  const resp = finalResponse(page, (u, m) => u.endsWith('/api/search') && m === 'POST');
  await page.goto(`${BASE}/recherche?q=${encodeURIComponent(q)}`);
  return resp;
};
const parcoursRows = (userId) => db(`SELECT id, title, status, "planStep" FROM "ParcoursItem" WHERE "userId" = $1 ORDER BY "createdAt"`, [userId]);

// ───────────────────────────── P1 older adult with reduced autonomy ─────────────────────────────
test('P1 older adult, reduced autonomy: orientation « aide à domicile » with official sheets → the LAB page of the sheet → places serving Strasbourg → Mon Parcours step with the next action', async ({ browser }) => {
  const p = await person(browser);
  const page = await p.context.newPage();
  const resp = await searchFor(page, "j'ai 82 ans, je vis seule, je perds mon autonomie et j'ai besoin d'aide à domicile");
  const r = await resp; expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body.orientation.needs.map((n) => n.id)).toContain('aide-domicile');
  const need = page.getByTestId('orientation-need-aide-domicile');
  await expect(need).toBeVisible();
  // official sources: the APA sheet resolves to its LAB page, the others to service-public.gouv.fr
  await expect(need.locator(`a[href="/bonnes-pratiques/${guide('F10009').slug}"]`)).toBeVisible();
  expect(await need.locator('a[href^="https://www.service-public.gouv.fr/particuliers/vosdroits/"]').count()).toBeGreaterThan(0);
  await axe(page, 'P1 orientation');
  evidence('P1 older adult', 'orientation with official sheets', `POST /api/search 200, needs=${body.orientation.needs.map((n) => n.id)}`);
  await need.locator(`a[href="/bonnes-pratiques/${guide('F10009').slug}"]`).click();
  await expect(page.getByTestId('guide-detail')).toBeVisible();
  await expect(page.getByTestId('guide-detail').locator('a[href="https://www.service-public.gouv.fr/particuliers/vosdroits/F10009"]')).toHaveCount(1);
  evidence('P1 older adult', 'rights information with its source', 'guide page links F10009 on service-public.gouv.fr');
  // local services: the places serving Strasbourg, never the Haut-Rhin one
  const list = page.waitForResponse((x) => x.url().includes('/api/structures') && x.url().includes('serves=67482'));
  await page.goto(`${BASE}/annuaire?serves=67482`);
  const lr = await list; expect(lr.status()).toBe(200);
  const ids = (await lr.json()).items.map((i) => i.id);
  expect(ids).toEqual(expect.arrayContaining([ORG.X.id, ORG.Y.id, ORG.Z.id])); expect(ids).not.toContain(ORG.M.id);
  await expect(page.getByTestId('annuaire-serves-filter')).toBeVisible();
  await expect(page.getByTestId('structures-results-list')).toContainText(ORG.Z.nom);
  await expect(page.getByTestId('structures-results-list')).not.toContainText(ORG.M.nom);
  evidence('P1 older adult', 'territory-correct services', `GET /api/structures?serves=67482 → ${ids.length} places, Haut-Rhin excluded`);
  // account + Mon Parcours: the need becomes a step from the orientation itself
  await citizenSignIn(page, C.aine, '/compte');
  await searchFor(page, "j'ai 82 ans, je vis seule, je perds mon autonomie et j'ai besoin d'aide à domicile");
  const add = page.getByTestId('orientation-need-aide-domicile').getByTestId('parcours-add-record-button');
  const posted = finalResponse(page, (u, m) => u.endsWith('/api/citizen/parcours') && m === 'POST');
  await add.click();
  expect((await posted).status()).toBe(201);
  await expect(page.getByTestId('orientation-need-aide-domicile').getByTestId('parcours-add-record-status')).toBeVisible();
  const rows = await parcoursRows(C.aine.id);
  expect(rows).toHaveLength(1); expect(rows[0].planStep).toMatchObject({ need: 'aide-domicile', nextActionKey: 'read_record' });
  await page.goto(`${BASE}/compte/parcours`);
  await expect(page.getByTestId('parcours-item')).toHaveCount(1);
  await expect(page.getByTestId('parcours-next-action').first()).toBeVisible();
  await axe(page, 'P1 Mon Parcours');
  evidence('P1 older adult', 'Mon Parcours step + next action', `ParcoursItem ${rows[0].id} planStep.need=aide-domicile`);
  expect(p.serverErrors).toEqual([]); expect(p.external).toEqual([]);
  await p.context.close();
});

// ───────────────────────────── P2 tenant: rent arrears + loss of income ─────────────────────────────
test('P2 tenant with rent arrears and no income: two needs, the local sheet page, a step organised with a professional — and a NETWORK LOSS while saving, then a retry that succeeds', async ({ browser }) => {
  const p = await person(browser);
  const page = await p.context.newPage();
  await citizenSignIn(page, C.locataire, '/compte');
  const r = await (await searchFor(page, "je n'arrive plus à payer mon loyer et j'ai perdu mes revenus"));
  const ids = (await r.json()).orientation.needs.map((n) => n.id);
  expect(ids).toEqual(expect.arrayContaining(['expulsion-impayes', 'minima-sociaux']));
  await expect(page.getByTestId('orientation-need-expulsion-impayes')).toBeVisible();
  await expect(page.getByTestId('orientation-need-minima-sociaux')).toBeVisible();
  evidence('P2 tenant', 'multi-need orientation', `needs=${ids}`);
  // NETWORK LOSS (simulated: route.abort) on the save — the person is told, nothing is half-saved, then the retry succeeds
  await page.route('**/api/citizen/parcours', (route) => route.abort('internetdisconnected'));
  const add = page.getByTestId('orientation-need-expulsion-impayes').getByTestId('parcours-add-record-button');
  await add.click();
  await expect(page.getByTestId('orientation-need-expulsion-impayes').getByTestId('parcours-add-record-error')).toBeVisible();
  expect(await parcoursRows(C.locataire.id)).toHaveLength(0);
  evidence('P2 tenant', 'network loss while saving', 'route.abort → parcours-add-record-error, 0 ParcoursItem rows');
  await page.unroute('**/api/citizen/parcours');
  const posted = finalResponse(page, (u, m) => u.endsWith('/api/citizen/parcours') && m === 'POST');
  await add.click();
  expect((await posted).status()).toBe(201);
  const rows = await parcoursRows(C.locataire.id);
  expect(rows).toHaveLength(1); expect(rows[0].planStep.need).toBe('expulsion-impayes');
  evidence('P2 tenant', 'retry after network loss', `POST /api/citizen/parcours 201, ParcoursItem ${rows[0].id}`);
  // organise the step: a professional acts, next action = share the dossier (the person's own words on the screen)
  await page.goto(`${BASE}/compte/parcours`);
  await page.getByTestId('parcours-item').first().locator('button[aria-controls^="parcours-detail-"]').click();
  await page.getByTestId('parcours-actor-select').selectOption('professional');
  const saved = finalResponse(page, (u, m) => u.endsWith('/api/citizen/parcours') && m === 'POST');
  await page.getByTestId('parcours-organise-save').click();
  expect((await saved).status()).toBe(200);
  await expect.poll(async () => (await parcoursRows(C.locataire.id))[0].planStep?.actor?.kind).toBe('professional');
  await expect(page.getByTestId('parcours-actor').first()).toBeVisible();
  evidence('P2 tenant', 'next step understood (who acts)', 'planStep.actor.kind=professional, shown as parcours-actor');
  expect(p.serverErrors).toEqual([]);
  await p.context.close();
});

// ───────────────────────────── P3 family: school / disability ─────────────────────────────
test('P3 family, school and disability needs: MDPH + inclusive schooling with their sheets; a query with no answer offers a next step; a STALE official record is withheld, a current one shows its verification', async ({ browser }) => {
  const p = await person(browser);
  const page = await p.context.newPage();
  const r = await (await searchFor(page, "mon fils est handicapé, il n'a pas d'AESH à l'école et je dois faire un dossier MDPH"));
  const ids = (await r.json()).orientation.needs.map((n) => n.id);
  expect(ids).toEqual(expect.arrayContaining(['mdph-droits', 'scolarite-inclusive']));
  await expect(page.getByTestId('orientation-need-scolarite-inclusive').locator(`a[href="/bonnes-pratiques/${guide('F33865').slug}"]`)).toBeVisible();
  await expect(page.getByTestId('orientation-need-mdph-droits').locator(`a[href="/bonnes-pratiques/${guide('F24610').slug}"]`)).toBeVisible();
  evidence('P3 family', 'school + disability orientation', `needs=${ids}`);
  // no result: an honest empty state with somewhere to go next
  const nr = await (await searchFor(page, 'zqxwv plorkt'));
  expect(nr.status()).toBe(200);
  await expect(page.getByTestId('search-empty-state')).toBeVisible();
  await expect(page.getByTestId('search-empty-next')).toBeVisible();
  evidence('P3 family', 'no-results state', 'search-empty-state + search-empty-next');
  // stale source: beyond 180 days the official record is not shown (404 + honest page); a current one is
  const stale = page.waitForResponse((x) => x.url().includes(`/api/aides/${CREDS.aides.stale.slug}`));
  await page.goto(`${BASE}/aides/${CREDS.aides.stale.slug}`);
  expect((await stale).status()).toBe(404);
  // the honest « not available » page, with a person to ask — never the stale text
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Fiche non disponible');
  await expect(page.getByTestId('human-help-block')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Aide LAB synthétique (stale)');
  const fresh = page.waitForResponse((x) => x.url().includes(`/api/aides/${CREDS.aides.fresh.slug}`));
  await page.goto(`${BASE}/aides/${CREDS.aides.fresh.slug}`);
  const fr = await fresh; expect(fr.status()).toBe(200);
  expect((await fr.json()).provenance).toMatchObject({ contentStatus: 'VERIFIED', freshness: 'current' });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Aide LAB synthétique (fresh)');
  evidence('P3 family', 'stale source withheld', `GET /api/aides/${CREDS.aides.stale.slug} 404; fresh 200 VERIFIED/current`);
  expect(p.serverErrors).toEqual([]);
  await p.context.close();
});

// ───────────────────────────── P4 limited French (ar RTL, then tr) ─────────────────────────────
test('P4 limited French: Arabic (right to left) — the situation in Arabic gives the needs, the French official text is marked French, the frame is Arabic; Mon Parcours in Arabic; Turkish too', async ({ browser }) => {
  const p = await person(browser, { lang: 'ar' });
  const page = await p.context.newPage();
  await citizenSignIn(page, C.arabophone, '/compte');
  const r = await (await searchFor(page, 'لا أستطيع دفع الإيجار، ليس لدي دخل، وأحتاج ملف الإعاقة'));
  const body = await r.json();
  expect(body.orientation.needs.map((n) => n.id)).toEqual(expect.arrayContaining(['expulsion-impayes', 'minima-sociaux', 'mdph-droits']));
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', /^ar/);
  await expect(page.getByTestId('orientation-french-notice')).toBeVisible();
  // the official French wording is marked lang="fr" dir="ltr" inside the Arabic page
  const frLabel = page.getByTestId('orientation-need-expulsion-impayes').locator('h3 [lang="fr"]');
  await expect(frLabel).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('#orientation-title')).not.toContainText('Votre situation');
  await axe(page, 'P4 ar orientation');
  evidence('P4 limited French (ar)', 'orientation RTL, French text marked', `needs=${body.orientation.needs.map((n) => n.id)}; html dir=rtl`);
  const posted = finalResponse(page, (u, m) => u.endsWith('/api/citizen/parcours') && m === 'POST');
  await page.getByTestId('orientation-need-mdph-droits').getByTestId('parcours-add-record-button').click();
  expect((await posted).status()).toBe(201);
  await page.goto(`${BASE}/compte/parcours`);
  await expect(page.getByTestId('parcours-item')).toHaveCount(1);
  await expect(page.locator('h1')).not.toHaveText('Mon Parcours');
  await axe(page, 'P4 ar Mon Parcours');
  expect((await parcoursRows(C.arabophone.id))[0].planStep.need).toBe('mdph-droits');
  evidence('P4 limited French (ar)', 'Mon Parcours in Arabic', 'ParcoursItem planStep.need=mdph-droits; h1 not French');
  await p.context.close();
  const t = await person(browser, { lang: 'tr' });
  const tp = await t.context.newPage();
  const tr = await (await (async () => { const w = finalResponse(tp, (u) => u.endsWith('/api/search')); await tp.goto(`${BASE}/recherche?q=${encodeURIComponent('kiramı ödeyemiyorum, gelirim yok')}`); return w; })());
  expect((await tr.json()).orientation.needs.map((n) => n.id)).toEqual(expect.arrayContaining(['expulsion-impayes', 'minima-sociaux']));
  await expect(tp.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(tp.getByTestId('orientation-french-notice')).toBeVisible();
  await expect(tp.locator('#orientation-title')).not.toContainText('Votre situation');
  evidence('P4 limited French (tr)', 'orientation in Turkish', 'needs found; frame translated');
  expect([...p.serverErrors, ...t.serverErrors]).toEqual([]);
  await t.context.close();
});

// ───────────────────────────── P5 low digital literacy: keyboard, 200 % zoom, 320 px; administrator recovery ─────────────────────────────
test('P5 low digital literacy: keyboard only at 320 px and at 200 % zoom (no sideways scroll); lost access to the mailbox → two administrators recover the account → the person chooses a password and signs in', async ({ browser }) => {
  for (const vp of [{ name: '320 px', viewport: { width: 320, height: 720 } }, { name: '200 % zoom', viewport: { width: 640, height: 450 }, deviceScaleFactor: 2 }]) {
    const p = await person(browser, { viewport: vp.viewport, deviceScaleFactor: vp.deviceScaleFactor || 1 });
    const page = await p.context.newPage();
    await page.goto(`${BASE}/recherche`);
    await expect(page.locator('#aides-search-query')).toBeVisible();
    await settle(page);
    // keyboard only: Tab until the search field has the focus, type, Enter
    let found = false;
    for (let i = 0; i < 60 && !found; i += 1) { await page.keyboard.press('Tab'); found = await page.evaluate(() => document.activeElement?.id === 'aides-search-query'); }
    expect(found, `${vp.name}: the search field is reachable with Tab`).toBe(true);
    const resp = finalResponse(page, (u) => u.endsWith('/api/search'));
    await page.keyboard.type('aide pour payer le loyer');
    await page.keyboard.press('Enter');
    expect((await resp).status()).toBe(200);
    await expect(page.getByTestId('search-orientation')).toBeVisible();
    // the first link of the need is reachable with the keyboard and visibly focused
    const link = page.getByTestId('orientation-need-aides-logement').locator('a').first();
    await link.focus();
    await expect(link).toBeFocused();
    expect(await overflow(page), `${vp.name}: no sideways scroll`).toBeLessThanOrEqual(0);
    await axe(page, `P5 ${vp.name}`);
    evidence('P5 low digital literacy', `keyboard-only search at ${vp.name}`, 'Tab to #aides-search-query, Enter → POST /api/search 200, overflow 0');
    expect(p.serverErrors).toEqual([]);
    await p.context.close();
  }
  // administrator recovery: the person lost access to their mailbox; ADA checks identity offline; two different administrators propose and approve
  const newEmail = `fa1-clavier-nouvelle-${Date.now()}@usagers.example.test`;
  const prop = await bearer('admin', 'POST', '/api/admin/privacy', { action: 'recovery_propose', currentEmail: C.clavier.email, newEmail, evidenceNote: 'Identité vérifiée au guichet (LAB_SYNTHETIC, aucune pièce copiée).' });
  expect(prop.status, prop.text).toBe(200);
  const self = await bearer('admin', 'POST', '/api/admin/privacy', { action: 'recovery_decide', id: prop.json.id, decision: 'APPROVE', note: 'Même administrateur : refusé' });
  expect(self.status, 'the proposer cannot approve').toBe(403);
  const dec = await bearer('admin2', 'POST', '/api/admin/privacy', { action: 'recovery_decide', id: prop.json.id, decision: 'APPROVE', note: 'Vérification relue par un second administrateur (LAB).' });
  expect(dec.status, dec.text).toBe(200);
  expect((await db(`SELECT status FROM "OwnershipRecoveryCase" WHERE id = $1`, [prop.json.id]))[0].status).toBe('APPROVED');
  expect((await db(`SELECT email FROM "CitizenUser" WHERE id = $1`, [C.clavier.id]))[0].email).toBe(newEmail);
  const mail = (await outbox(newEmail)).find((m) => m.category === 'ownership_recovery');
  const link = /https?:\/\/[^\s]+\/api\/auth\/verify-email\?token=[^\s]+/.exec(mail?.text || '')?.[0];
  expect(link, 'the recovery link is in the LAB outbox (recorded, not delivered)').toBeTruthy();
  const p = await person(browser);
  const page = await p.context.newPage();
  await page.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
  await page.waitForURL((u) => u.pathname === '/auth/reset', { timeout: 30000 });
  const chosen = `Lab-${Date.now().toString(36)}-Chosen-9a`;
  await page.locator('#reset-password').fill(chosen);
  await page.locator('#reset-password-confirm').fill(chosen);
  await page.locator('form button[type="submit"]').first().click();
  await expect(page.locator('[role="alert"]').filter({ hasText: 'Mot de passe mis à jour' })).toBeVisible();
  await citizenSignIn(page, { email: newEmail, password: chosen }, '/compte');
  await expect(page.getByTestId('mon-espace')).toBeVisible();
  const audit = (await db(`SELECT action FROM "AuditLog" WHERE entity = 'OwnershipRecoveryCase' AND entity_id = $1`, [prop.json.id])).map((a) => a.action);
  expect(audit).toEqual(expect.arrayContaining(['OWNERSHIP_RECOVERY_PROPOSED', 'OWNERSHIP_RECOVERY_APPROVED']));
  evidence('P5 low digital literacy', 'administrator recovery path', `OwnershipRecoveryCase APPROVED (two-person), audit ${audit}, verify link → choose password → signed in`);
  expect(p.serverErrors).toEqual([]);
  await p.context.close();
});

// ───────────────────────────── P6 anonymous navigation ─────────────────────────────
test('P6 anonymous: searches, reads a sheet and the directory without an account; nothing personal is kept, nothing is offered that would fail; Mon Espace asks to sign in; the closed surface is honest', async ({ browser }) => {
  const p = await person(browser);
  const page = await p.context.newPage();
  const r = await (await searchFor(page, "je n'arrive plus à payer mon loyer et j'ai perdu mes revenus"));
  expect(r.status()).toBe(200);
  await expect(page.getByTestId('orientation-need-expulsion-impayes')).toBeVisible();
  await expect(page.getByTestId('parcours-add-record-button')).toHaveCount(0);   // no « add to my plan » for a visitor without an account
  await page.getByTestId('orientation-need-expulsion-impayes').locator(`a[href="/bonnes-pratiques/${guide('F31272').slug}"]`).click();
  await expect(page.getByTestId('guide-detail')).toBeVisible();
  await page.goto(`${BASE}/annuaire?serves=67482`);
  await expect(page.getByTestId('structures-results-list')).toContainText(ORG.X.nom);
  const cookies = (await p.context.cookies(BASE)).map((c) => c.name);
  expect(cookies.filter((n) => /session|token|ada_user/i.test(n)), `cookies: ${cookies}`).toEqual([]);
  expect((await p.api('POST', '/api/citizen/parcours', { action: 'add', title: 'anonyme' })).status).toBe(401);
  expect((await p.api('GET', '/api/citizen/referrals')).status).toBe(401);
  await page.goto(`${BASE}/compte/parcours`);
  await expect(page.locator('a[href^="/auth/login"]').first()).toBeVisible();
  evidence('P6 anonymous', 'public journey without an account', 'search 200, guide, directory; no session cookie; person routes 401; Mon Parcours asks to sign in');
  expect(p.external).toEqual([]);
  await p.context.close();
  // the Production default (nothing open): the public search still answers; signing in is refused with a message, not a crash
  const q = await person(browser, { base: BASE_CLOSED, allow503: ['PUBLIC_BETA_RESTRICTED'] });
  const cp = await q.context.newPage();
  const sr = finalResponse(cp, (u) => u.endsWith('/api/search'));
  await cp.goto(`${BASE_CLOSED}/recherche?q=${encodeURIComponent('aide pour payer le loyer')}`);
  expect((await sr).status()).toBe(200);
  await cp.goto(`${BASE_CLOSED}/auth/login?next=/compte/parcours`);
  await cp.locator('#auth-email').fill(C.autre.email); await cp.locator('#auth-password').fill(C.autre.password);
  const login = finalResponse(cp, (u, m) => u.includes('/api/auth/') && m === 'POST');
  await cp.locator('form button[type="submit"]').first().click();
  const lr = await login;
  expect(lr.status()).toBe(503);
  await expect(cp.locator('[role="alert"]').first()).toBeVisible();
  await expect(cp.locator('[role="alert"]').first()).not.toContainText('PUBLIC_BETA_RESTRICTED');   // words for a person, not a code
  expect(new URL(cp.url()).pathname).toBe('/auth/login');
  evidence('P6 anonymous', 'closed surface (Production default)', `public search 200; sign-in ${lr.status()} PUBLIC_BETA_RESTRICTED with a visible message`);
  expect(q.serverErrors).toEqual([]);
  await q.context.close();
});

// ───────────────────────────── P7 withdrawing consent ─────────────────────────────
test('P7 withdrawing consent: a proposal to share the dossier is REFUSED (nothing transmitted), then the person stops sharing with everyone; the organisations lose access; the trail is recorded', async ({ browser }) => {
  const p = await person(browser);
  const page = await p.context.newPage();
  await citizenSignIn(page, C.retrait, '/compte');
  // the person's dossier, shared with X (the person's own API calls, as the dossier screens make them; X redeems through its session)
  const created = await p.api('POST', '/api/share/create', { situation: { zipCode: '67000' }, results: { rights: [] } });
  expect(created.status).toBe(200);
  const shareId = created.json.shareId;
  const inv = await p.api('POST', '/api/public/dossier-grants', { shareId, action: 'invite', structureId: ORG.X.id });
  expect(inv.status).toBe(201);
  expect((await bearer('pro_x1', 'POST', '/api/pro/dossier/redeem', { shareId, inviteToken: inv.json.inviteToken })).status).toBe(200);
  const cases = (await bearer('pro_xa', 'GET', '/api/pro/cases?scope=unassigned')).json.cases;
  const caseId = cases.find((c) => c.dossierId === shareId).id;
  expect((await bearer('pro_xa', 'POST', '/api/pro/cases', { action: 'assign', id: caseId, userId: CREDS.pros.x1.id })).status).toBe(200);
  const prop = await bearer('pro_x1', 'POST', '/api/pro/referrals', { action: 'propose', caseId, toStructureId: ORG.Y.id, reasonCode: 'HOUSING' });
  expect(prop.status, prop.text).toBe(201);
  // REFUSAL in Mes orientations
  await page.goto(`${BASE}/compte/orientations`);
  await expect(page.getByTestId('orientation-pending')).toHaveCount(1);
  const decided = finalResponse(page, (u, m) => u.endsWith('/api/citizen/referrals') && m === 'POST');
  await page.getByTestId('orientation-refuse').click();
  expect((await decided).status()).toBe(200);
  await expect(page.getByTestId('orientation-status')).not.toBeEmpty();
  const ref = (await db(`SELECT status FROM "Referral" WHERE id = $1`, [prop.json.referral.id]))[0];
  expect(ref.status).not.toBe('PENDING_CITIZEN');
  expect((await db(`SELECT count(*)::int n FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = $1 AND "structureId" = $2 AND "revokedAt" IS NULL`, [shareId, ORG.Y.id]))[0].n).toBe(0);
  expect((await bearer('pro_y1', 'GET', `/api/pro/dossier?shareId=${encodeURIComponent(shareId)}`)).status).toBe(404);
  evidence('P7 withdrawing consent', 'refusal of a referral', `Referral ${prop.json.referral.id} → ${ref.status}; Y grant 0; Y dossier 404`);
  // STOP SHARING with everyone, from the dossier page
  await page.goto(`${BASE}/compte/partages/${encodeURIComponent(shareId)}`);
  await expect(page.getByTestId('grant-row')).toHaveCount(1);
  await page.getByRole('button', { name: /Arrêter de partager avec tout le monde/ }).click();
  const stop = finalResponse(page, (u, m) => u.endsWith('/api/public/dossier-grants') && m === 'POST');
  await page.getByRole('button', { name: /Oui, arrêter le partage/ }).click();
  const sr = await stop; expect(sr.status()).toBe(200);
  expect((await sr.json())).toMatchObject({ ok: true, grants: 1 });
  await expect(page.getByTestId('sharing-status')).not.toBeEmpty();
  expect((await db(`SELECT count(*)::int n FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = $1 AND "revokedAt" IS NULL`, [shareId]))[0].n).toBe(0);
  expect((await bearer('pro_x1', 'GET', `/api/pro/dossier?shareId=${encodeURIComponent(shareId)}`)).status).toBe(404);
  const trail = (await db(`SELECT action FROM "AuditLog" WHERE details->>'shareId' = $1`, [shareId])).map((a) => a.action);
  expect(trail).toEqual(expect.arrayContaining(['DOSSIER_INVITE_CREATED', 'DOSSIER_SHARING_STOPPED_BY_OWNER']));
  evidence('P7 withdrawing consent', 'stop sharing with everyone', `grants revoked; X dossier 404; AuditLog ${trail.join(',')}`);
  expect(p.serverErrors).toEqual([]);
  await p.context.close();
});
