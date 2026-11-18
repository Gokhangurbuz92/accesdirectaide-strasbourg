/**
 * FA-CAP — PUBLIC surface: one capability per test (title starts with the register id). Open-in-Production capabilities are tested on the PRODUCTION
 * configuration server (PROD); a capability closed in Production is tested twice: its effect on the OPEN LAB server, and the refusal on PROD (« the gate
 * holds »). Every assertion reads a real server answer, a database row or the visible page. LAB_SYNTHETIC records only (e2e-fab/seed.mjs).
 */
import { test, expect } from '@playwright/test';
import { OPEN, PROD, CREDS, db, closeDb, visitor, anon, ips, expectClosed, finalResponse, settle, citizenSignIn } from './lib.mjs';

const nextIp = ips(10, 59);
const CAT = CREDS.catalogue;
/** a synthetic questionnaire (the shape of tests/integration/dta-diagnostic-persistence-db.test.js) */
const ANSWERS = { birthDate: '1987-04-09', householdSize: 1, income: { salary: 600, unemployment: 0 }, housing: { status: 'locataire', rent: 500, charges: 12 }, zipCode: '67000', territory: '67000' };
test.afterAll(async () => { await closeDb(); });

/** an anonymous visitor's page on a server */
async function open(browser, base = PROD, opts = {}) {
  const P = await visitor(browser, nextIp, { base, ...opts });
  const page = await P.context.newPage();
  return { P, page };
}

test('P01 landing, navigation, mobile menu and tiles: the home page leads to the catalogue (desktop and 375 px)', async ({ browser }) => {
  const { P, page } = await open(browser);
  await page.goto(`${PROD}/`);
  await expect(page.locator('main h1').first()).toBeVisible();
  await expect(page.locator('header nav').getByRole('link').first()).toBeVisible();
  await P.context.close();
  const M = await open(browser, PROD, { viewport: { width: 375, height: 812 } });
  await M.page.goto(`${PROD}/`);
  const burger = M.page.locator('header button[aria-controls="mobile-menu"]');
  await expect(burger).toBeVisible();
  await burger.click();
  await expect(burger).toHaveAttribute('aria-expanded', 'true');
  const menu = M.page.locator('#mobile-menu');
  await menu.getByRole('button', { name: /aides/i }).first().click();   // « Aides » is a group: its entries open under it
  await menu.getByRole('link').filter({ hasText: /aides|recherche|besoins/i }).first().click();
  await M.page.waitForURL(/\/(aides|besoins|recherche)/);
  await expect(burger).toHaveAttribute('aria-expanded', 'false');   // a new page closes the menu
  expect(await M.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(P.serverErrors.concat(M.P.serverErrors)).toEqual([]);
  await M.P.context.close();
});

test('P02 aides catalogue: the list shows the verified records, the theme filter narrows it, hidden records never appear', async ({ browser }) => {
  const { P, page } = await open(browser);
  await page.goto(`${PROD}/aides`);
  await expect(page.getByTestId('aides-success-state')).toBeVisible();
  const titles = page.getByTestId('aide-title');
  await expect(titles.filter({ hasText: 'Aide FAB logement (test)' })).toBeVisible();
  await expect(titles.filter({ hasText: 'Aide FAB emploi (test)' })).toBeVisible();
  for (const hidden of ['Aide FAB non éligible au lancement (test)', 'Aide FAB retenue (test)', 'Aide FAB sans date de vérification (test)', 'Financement FAB collectivités (test Aides-territoires)']) await expect(page.getByText(hidden)).toHaveCount(0);
  await page.goto(`${PROD}/aides/theme/logement`);
  await expect(titles.filter({ hasText: 'Aide FAB logement (test)' })).toBeVisible();
  await expect(titles.filter({ hasText: 'Aide FAB emploi (test)' })).toHaveCount(0);
  const api = await anon('GET', '/api/aides?category=emploi&pageSize=50', undefined, { base: PROD, ip: nextIp() });
  const slugs = (api.json.items || api.json.data || []).map((a) => a.slug);
  expect(slugs).toContain('fab-aide-emploi'); expect(slugs).not.toContain('fab-aide-logement');
  expect(P.serverErrors).toEqual([]); await P.context.close();
});

test('P04 démarches: list and detail page of a verified démarche', async ({ browser }) => {
  const { P, page } = await open(browser);
  await page.goto(`${PROD}/demarches`);
  await expect(page.getByTestId('demarches-success-state')).toBeVisible();
  await expect(page.getByTestId('demarches-results-list')).toContainText('Démarche FAB logement (test)');
  await expect(page.getByTestId('demarches-results-list').locator(`a[href$="/demarches/${CAT.demarche}"]`).first()).toBeAttached();
  await page.goto(`${PROD}/demarches/${CAT.demarche}`);
  await expect(page.locator('h1')).toContainText('Démarche FAB logement (test)');
  expect((await anon('GET', `/api/demarches/${CAT.demarche}`, undefined, { base: PROD, ip: nextIp() })).status).toBe(200);
  expect(P.serverErrors).toEqual([]); await P.context.close();
});

test('P06 structure detail and booking entry: OPEN — the detail page offers booking and the slots answer; PROD — the detail stays public, booking is refused (gate holds)', async ({ browser }) => {
  const { P, page } = await open(browser, OPEN);
  await citizenSignIn(page, CREDS.citizens.autre, '/compte', OPEN);   // booking is account-bound (R42): a signed-in adult
  await page.goto(`${OPEN}/structures/cdgg-conseil`);
  await expect(page.locator('h1')).toContainText('CDGG Conseil');
  const book = page.locator('a[href*="/rdv/cdgg-conseil"]').first();
  await expect(book).toBeVisible();
  const services = await P.api('GET', '/api/rdv/structures/cdgg-conseil/services');
  expect(services.status).toBe(200);
  expect(JSON.stringify(services.json)).toContain('service fictif de test');
  await book.click();
  await page.waitForURL(/\/rdv\/cdgg-conseil/);
  await P.context.close();
  // Production: the official directory record is public, the appointment path is closed
  const Q = await open(browser, PROD);
  await Q.page.goto(`${PROD}/structures/${CAT.structure}`);
  await expect(Q.page.locator('h1')).toContainText('Centre FAB Strasbourg (test)');
  await expect(Q.page.locator('a[href*="/rdv/"]')).toHaveCount(0);
  expectClosed(await anon('GET', '/api/rdv/structures/cdgg-conseil/services', undefined, { base: PROD, ip: nextIp() }), 'P06 booking services');
  expectClosed(await anon('POST', '/api/rdv/appointments', { structureSlug: 'cdgg-conseil' }, { base: PROD, ip: nextIp() }), 'P06 booking');
  await Q.P.context.close();
});

test('P07 territorial navigation: a postal code resolves to its communes, EPCI and département; QPV lookup; ambiguity is said', async ({ browser }) => {
  const one = await anon('GET', '/api/territory/postal?code=67000', undefined, { base: PROD, ip: nextIp() });
  expect(one.status).toBe(200);
  expect(JSON.stringify(one.json)).toMatch(/Strasbourg/);
  expect(JSON.stringify(one.json)).toMatch(/67482/);
  const many = await anon('GET', '/api/territory/postal?code=67120', undefined, { base: PROD, ip: nextIp() });   // several communes share it
  expect(many.status).toBe(200);
  expect(many.json.status).toBe('MULTIPLE');
  expect(many.json.candidates.length).toBeGreaterThan(1);
  const qpv = await anon('GET', '/api/territory/qpv?commune=67482', undefined, { base: PROD, ip: nextIp() });
  expect(qpv.status).toBe(200);
  expect(JSON.stringify(qpv.json)).toMatch(/QN0|qpv/i);
  const bad = await anon('GET', '/api/territory/postal?code=ABCDE', undefined, { base: PROD, ip: nextIp() });
  expect(bad.status).toBe(400);
  const { P, page } = await open(browser);
  await page.goto(`${PROD}/territoire`);
  await expect(page.getByTestId('territoire-communes')).toBeVisible();
  await expect(page.getByTestId('territoire-communes')).toContainText('Strasbourg');
  await P.context.close();
});

test('P09 dispositifs: list and detail of a verified dispositif', async ({ browser }) => {
  const { P, page } = await open(browser);
  await page.goto(`${PROD}/dispositifs`);
  await expect(page.getByTestId('dispositifs-list')).toContainText('Dispositif FAB accueil (test)');
  await page.goto(`${PROD}/dispositifs/${CAT.dispositif}`);
  await expect(page.locator('h1')).toContainText('Dispositif FAB accueil (test)');
  expect(P.serverErrors).toEqual([]); await P.context.close();
});

test('P10 actualités: the published news list (newest first) and a news detail with its official source', async ({ browser }) => {
  const { P, page } = await open(browser);
  await page.goto(`${PROD}/actualites`);
  const list = page.getByTestId('actualites-results-list');
  await expect(list).toContainText('Actualité FAB alpha logement (test)');
  const order = await list.innerText();
  expect(order.indexOf('Actualité FAB alpha logement (test)')).toBeLessThan(order.indexOf('Actualité FAB gamma famille (test)'));
  await page.goto(`${PROD}/actualites/${CAT.actualite}`);
  await expect(page.locator('h1')).toContainText('Actualité FAB alpha logement (test)');
  await expect(page.locator('a[href*="service-public.gouv.fr"]').first()).toBeVisible();
  await P.context.close();
});

test('P11 guides, bonnes pratiques, outils, glossaire: each page answers with its content', async ({ browser }) => {
  const { P, page } = await open(browser);
  const g = await anon('GET', '/api/guides?pageSize=50', undefined, { base: PROD, ip: nextIp() });
  expect(g.status).toBe(200); expect(JSON.stringify(g.json)).toContain('fab-guide-logement');
  await page.goto(`${PROD}/bonnes-pratiques`);
  await expect(page.locator('main h1').first()).toBeVisible();
  await page.goto(`${PROD}/outils`);
  await expect(page.locator('main h1').first()).toBeVisible();
  const gl = await anon('GET', '/api/glossaire', undefined, { base: PROD, ip: nextIp() });
  expect(gl.status).toBe(200);
  const terms = gl.json.terms || gl.json.items || gl.json;
  expect(Array.isArray(terms) ? terms.length : Object.keys(terms).length).toBeGreaterThan(5);
  await page.goto(`${PROD}/glossaire`);
  await expect(page.locator('main h1').first()).toBeVisible();
  await expect(page.locator('main h2').first()).toBeVisible();
  expect(P.serverErrors).toEqual([]); await P.context.close();
});

test('P12 ressources: the emergency numbers are always shown (built-in fallback), with their tel: links', async ({ browser }) => {
  const { P, page } = await open(browser);
  // with no document published the numbers are on the page itself; once documents exist they are one link away (« Voir les numéros d’urgence »)
  await page.goto(`${PROD}/ressources`);
  await expect(page.getByTestId('emergency-resources').or(page.getByTestId('emergency-link')).first()).toBeVisible();
  await page.goto(`${PROD}/ressources?emergency=1`);
  const em = page.getByTestId('emergency-resources');
  await expect(em).toBeVisible();
  for (const n of ['112', '15', '115']) await expect(em.locator(`a[href="tel:${n}"]`).first()).toBeVisible();
  const api = await anon('GET', '/api/ressources?emergency=1', undefined, { base: PROD, ip: nextIp() });
  expect(api.status).toBe(200);
  expect(JSON.stringify(api.json)).toContain('115');
  await P.context.close();
});

/** the account-free questionnaire in the browser (steps of e2e/diagnostic-flow.spec.js), on the REAL API */
async function questionnaire(page, base) {
  await page.goto(`${base}/orientation`);
  await page.locator('button', { hasText: /logement/i }).first().click();
  await page.locator('input[aria-label="Ville ou code postal"]').fill('67000');
  await page.locator('button[type="submit"]', { hasText: /continuer|passer/i }).click();
  await page.locator('[role="radiogroup"][aria-label="Situation familiale"] button[role="radio"]').first().click();
  await page.locator('[role="radiogroup"][aria-label="Statut actuel"] button[role="radio"]').first().click();
  await page.locator('button', { hasText: /continuer/i }).click();
  await page.locator('[role="radiogroup"][aria-label*="urgence" i] button[role="radio"]').first().click();
  await page.locator('button', { hasText: /^continuer$/i }).click();
  await page.locator('#diag-birthdate').fill('1992-06-15');
  await page.locator('#diag-salary').fill('0'); await page.locator('#diag-unemployment').fill('0');
  await page.locator('#diag-rent').fill('520'); await page.locator('#diag-charges').fill('50');
  await page.getByRole('radio', { name: 'Locataire', exact: true }).click();
  const resp = finalResponse(page, (u, m) => u.endsWith('/api/diagnostic') && m === 'POST');
  await page.locator('button', { hasText: /voir les pistes à vérifier/i }).click();
  return resp;
}

test('P14 plan d’action (account-free): OPEN — the questionnaire gives the assessment and a printable plan, nothing stored; PROD — refused (gate holds)', async ({ browser }) => {
  const { P, page } = await open(browser, OPEN);
  await page.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
  const writes = []; page.on('request', (r) => { const u = new URL(r.url()); if (r.method() !== 'GET' && /^\/api\/(share|citizen|public\/dossier|pro|auth)/.test(u.pathname)) writes.push(u.pathname); });
  const r = await questionnaire(page, OPEN);
  expect(r.status()).toBe(200);
  await expect(page.getByTestId('assessment-item-rsa')).toBeVisible();
  await expect(page.getByTestId('assessment-state-rsa')).toHaveText(/vérifier/i);   // never an entitlement
  await page.getByTestId('action-plan-print').click();
  expect(await page.evaluate(() => window.__printed)).toBe(1);
  expect(writes, 'account-free: the estimate and the plan save nothing (no share, no account call)').toEqual([]);
  await P.context.close();
  expectClosed(await anon('POST', '/api/diagnostic', { mode: 'SIMULATION_MODE', answers: ANSWERS }, { base: PROD, ip: nextIp() }), 'P14 diagnostic');
  const Q = await open(browser, PROD);
  await Q.page.goto(`${PROD}/orientation`);
  await expect(Q.page.getByTestId('public-beta-unavailable').first()).toBeVisible();
  await Q.P.context.close();
});

test('P15 aide / démarche PDF exports: the PDF is generated from the published record; a hidden record has no PDF', async () => {
  const r = await fetch(`${PROD}/api/pdf/aides/${CAT.aide}`, { headers: { 'x-forwarded-for': nextIp() } });
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toContain('application/pdf');
  const buf = Buffer.from(await r.arrayBuffer());
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  const d = await fetch(`${PROD}/api/pdf/demarches/${CAT.demarche}`, { headers: { 'x-forwarded-for': nextIp() } });
  expect(d.status).toBe(200);
  const hidden = await fetch(`${PROD}/api/pdf/aides/fab-aide-not-eligible`, { headers: { 'x-forwarded-for': nextIp() } });
  expect(hidden.status).toBe(404);
});

test('P18 FALC toggle: switching easy-to-read mode shows the FALC text of the record and is remembered', async ({ browser }) => {
  const { P, page } = await open(browser);
  await page.goto(`${PROD}/aides/${CAT.aide}`);
  await expect(page.locator('h1')).toContainText('Aide FAB logement (test)');
  const toggle = page.getByRole('switch').or(page.getByRole('button', { name: /facile à lire|FALC|simplifi/i })).first();
  await toggle.click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('falc-mode'))).toBe('true');
  await expect(page.getByText('Texte FALC FAB : une aide pour payer le logement (test).')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Texte FALC FAB : une aide pour payer le logement (test).')).toBeVisible();
  await P.context.close();
});

test('P19 feedback, content report, suggest a structure: OPEN — each is stored (ContentReport / PartnershipRequest); PROD — refused (gate holds)', async () => {
  const tag = `fab-p19-${Date.now()}`;
  const fb = await anon('POST', '/api/feedback', { type: 'aide', slug: CAT.aide, message: `Lien à vérifier ${tag}`, pageUrl: `/aides/${CAT.aide}` }, { ip: nextIp() });
  expect([200, 201]).toContain(fb.status);
  const rp = await anon('POST', '/api/reports', { contentType: 'DEMARCHE', contentId: 'fab-dem-1', reason: 'INFO_OBSOLETE', message: `Info obsolète ${tag}` }, { ip: nextIp() });
  expect([200, 201]).toContain(rp.status);
  expect((await db(`SELECT count(*)::int n FROM "ContentReport" WHERE message LIKE $1`, [`%${tag}%`]))[0].n).toBe(2);
  const sg = await anon('POST', '/api/public/suggest-structure', { structureName: `Structure suggérée ${tag}`, city: 'Strasbourg', consent: true }, { ip: nextIp() });
  expect([200, 201]).toContain(sg.status);
  expect((await db(`SELECT count(*)::int n FROM "PartnershipRequest" WHERE "structureName" = $1`, [`Structure suggérée ${tag}`]))[0].n).toBe(1);
  for (const [p, b] of [['/api/feedback', { type: 'aide', slug: CAT.aide, message: 'fermé ?' }], ['/api/reports', { contentType: 'AIDE', contentId: 'x', reason: 'AUTRE' }], ['/api/public/suggest-structure', { structureName: 'x', city: 'y', consent: true }]]) {
    expectClosed(await anon('POST', p, b, { base: PROD, ip: nextIp() }), `P19 ${p}`);
  }
});

test('P20 contact form: OPEN — the channel status is said before typing and the message reaches the (test) outbox; PROD — refused (gate holds)', async ({ browser }) => {
  const { P, page } = await open(browser, OPEN);
  await page.goto(`${OPEN}/contact`);
  await expect(page.getByTestId('contact-channel-status')).toBeVisible();
  const st = await anon('GET', '/api/contact', undefined, { ip: nextIp() });
  expect(st.json.channel).toBe('TEST');
  const sent = await P.api('POST', '/api/contact', { nom: 'Personne FAB', email: 'fab-contact@usagers.example.test', sujet: 'question', message: 'Question de test FAB (LAB_SYNTHETIC).' });
  expect(sent.status).toBe(200);
  const box = await (await fetch(`${OPEN}/__lab/outbox?to=contact@accesdirectaide.fr`)).json();
  expect(box.some((m) => /Question de test FAB/.test(m.text))).toBe(true);
  await P.context.close();
  expectClosed(await anon('POST', '/api/contact', { email: 'a@example.test', sujet: 'question', message: 'x' }, { base: PROD, ip: nextIp() }), 'P20 contact');
});

test('P21 legal and trust pages: mentions légales, CGU, confidentialité, accessibilité render their headings and the publisher block', async ({ browser }) => {
  const { P, page } = await open(browser);
  for (const p of ['/mentions-legales', '/cgu', '/confidentialite', '/accessibilite', '/securite-et-rgpd']) {
    const r = await page.goto(`${PROD}${p}`);
    expect(r.status(), p).toBe(200);
    await expect(page.locator('main h1').first(), p).toBeVisible();
    expect((await page.locator('main').innerText()).length, p).toBeGreaterThan(400);
  }
  await page.goto(`${PROD}/mentions-legales`);
  await expect(page.locator('main')).toContainText(/éditeur|Éditeur|publication/);
  expect(P.serverErrors).toEqual([]); await P.context.close();
});

test('P22 SEO: the sitemap lists the verified records and not the hidden ones; record pages carry a canonical; private pages are noindex', async ({ browser }) => {
  const sm = await (await fetch(`${PROD}/sitemap.xml`, { headers: { 'x-forwarded-for': nextIp() } })).text();
  expect(sm).toContain('<urlset');
  expect(sm).toContain(`/aides/${CAT.aide}`);
  for (const hidden of ['fab-aide-not-eligible', 'fab-aide-held', 'fab-aide-no-date', 'fab-aide-at']) expect(sm).not.toContain(hidden);
  const html = await (await fetch(`${PROD}/aides/${CAT.aide}`, { headers: { 'x-forwarded-for': nextIp() } })).text();
  expect(html).toMatch(/<link[^>]+rel="canonical"[^>]+\/aides\/fab-aide-logement/);
  expect(html).toContain('Aide FAB logement (test)');   // record content in the initial HTML (prerender / page head)
  // the PRODUCTION build: a public record page is indexable, a private console page is noindex
  const { P, page } = await open(browser);
  await page.goto(`${PROD}/aides/${CAT.aide}`);
  await expect(page.locator('h1')).toContainText('Aide FAB logement (test)');
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
  await page.goto(`${PROD}/admin`);
  await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
  const robots = await (await fetch(`${PROD}/robots.txt`)).text();
  expect(robots).toMatch(/Sitemap:/i);
  await P.context.close();
});

test('P23 cookie / consent banner: shown on a first visit; refusing keeps analytics off and is remembered', async ({ browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': nextIp() } });
  const page = await context.newPage();
  const third = []; page.on('request', (r) => { const h = new URL(r.url()).hostname; if (h !== '127.0.0.1') third.push(h); });
  await page.goto(`${PROD}/`);
  const banner = page.locator('#cookie-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute('role', 'region');   // information, not a consent dialog: nothing to accept (no audience measurement)
  await banner.locator('#cookie-close-btn').click();
  await expect(banner).toBeHidden();
  const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('ada_cookie_consent')));
  expect(stored.seen).toBe(true);
  await page.reload();
  await expect(page.locator('#cookie-banner')).toHaveCount(0);
  expect(third).toEqual([]);
  await page.goto(`${PROD}/cookies`);
  await expect(page.getByTestId('beta-no-analytics').or(page.getByTestId('no-analytics')).first()).toBeVisible();
  await context.close();
});

test('P24 public status page and health: real components in plain words, no internals', async ({ browser }) => {
  const s = await anon('GET', '/api/status', undefined, { base: PROD, ip: nextIp() });
  expect(s.status).toBe(200);
  expect(s.json.components.map((c) => c.id)).toEqual(expect.arrayContaining(['comptes', 'donnees']));
  expect(JSON.stringify(s.json)).not.toMatch(/127\.0\.0\.1|postgres|stack/i);
  const h = await anon('GET', '/api/health/live', undefined, { base: PROD, ip: nextIp() });
  expect(h.status).toBe(200);
  const { P, page } = await open(browser);
  await page.goto(`${PROD}/status`);
  await expect(page.getByTestId('status-last-checked')).toBeVisible();
  await P.context.close();
});

test('P25 impact, partners, mission: measured outcomes only — no invented figure is shown', async ({ browser }) => {
  const { P, page } = await open(browser);
  await page.goto(`${PROD}/impact`);
  await expect(page.getByTestId('impact-no-figures')).toBeVisible();
  await page.goto(`${PROD}/partenaires`);
  await expect(page.getByTestId('partners-beta-now')).toBeVisible();
  await page.goto(`${PROD}/notre-mission`);
  await expect(page.getByTestId('mission-next-steps')).toBeVisible();
  await P.context.close();
});

test('P26 voice / read-aloud: speaks on the device (speechSynthesis), the retired server TTS answers 410 and calls no provider', async ({ browser }) => {
  const { P, page } = await open(browser);
  await P.context.addInitScript(() => {
    // record what the page asks the device to say (no audio in the LAB browser)
    window.__spoken = [];
    const s = window.speechSynthesis;
    if (s) { s.speak = (u) => { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(new Event('end')), 0); }; s.cancel = () => {}; }
  });
  await page.goto(`${PROD}/aides/${CAT.aide}`);
  await expect(page.locator('h1')).toContainText('Aide FAB logement (test)');
  await page.getByTestId('read-aloud-toggle').first().click();
  await page.getByTestId('read-page').click();
  await expect.poll(() => page.evaluate(() => window.__spoken.join(' '))).toContain('Aide FAB logement');
  const tts = await anon('POST', '/api/tts', { text: 'bonjour' }, { base: OPEN, ip: nextIp() });
  expect(tts.status).toBe(410);
  await P.context.close();
});

test('P28 AccesDirectAide Local: a territorial view lists the records of that commune only', async ({ browser }) => {
  const { P, page } = await open(browser);
  await page.goto(`${PROD}/aides/theme/logement/strasbourg`);
  await expect(page.locator('main h1').first()).toContainText(/Strasbourg/);
  // the page address carries the commune as a slug (« strasbourg »); the records name it as the catalogue writes it (« Strasbourg »): the commune's own
  // record must be listed (before the fix: the slug was sent as is and matched nothing, every territorial view was empty)
  const titles = page.getByTestId('aide-title');
  await expect(titles.filter({ hasText: 'Aide FAB logement (test)' })).toBeVisible();
  const s = await anon('GET', '/api/structures?city=Strasbourg&pageSize=50', undefined, { base: PROD, ip: nextIp() });
  const names = JSON.stringify(s.json);
  expect(names).toContain('Centre FAB Strasbourg (test)'); expect(names).not.toContain('Centre FAB Mulhouse (test)');
  await P.context.close();
});

test('D02 launch eligibility enforced on every public read path: list, detail, search, PDF, sitemap, favourites never show a non-eligible / held record', async () => {
  for (const slug of ['fab-aide-not-eligible', 'fab-aide-held']) {
    expect((await anon('GET', `/api/aides/${slug}`, undefined, { base: PROD, ip: nextIp() })).status, slug).toBe(404);
    expect((await fetch(`${PROD}/api/pdf/aides/${slug}`, { headers: { 'x-forwarded-for': nextIp() } })).status, slug).toBe(404);
  }
  const list = JSON.stringify((await anon('GET', '/api/aides?pageSize=100', undefined, { base: PROD, ip: nextIp() })).json);
  expect(list).not.toContain('fab-aide-not-eligible'); expect(list).not.toContain('fab-aide-held');
  const s = await anon('POST', '/api/search', { query: 'Aide FAB retenue' }, { base: PROD, ip: nextIp() });
  expect(s.status).toBe(200);
  expect(JSON.stringify(s.json)).not.toMatch(/fab-aide-(not-eligible|held)/);
});

test('D03 verification date model: a record without a verification date is never shown as verified (unknown stays unknown); the shown date is the stored one', async ({ browser }) => {
  expect((await anon('GET', '/api/aides/fab-aide-no-date', undefined, { base: PROD, ip: nextIp() })).status).toBe(404);
  const ok = await anon('GET', `/api/aides/${CAT.aide}`, undefined, { base: PROD, ip: nextIp() });
  const stored = (await db(`SELECT date_verification FROM "Aide" WHERE id = 'fab-aide-logement'`))[0].date_verification;
  const shown = ok.json.date_verification || ok.json.data?.date_verification || ok.json.aide?.date_verification;
  expect(new Date(shown).toISOString()).toBe(new Date(stored).toISOString());
  const { P, page } = await open(browser);
  await page.goto(`${PROD}/aides/${CAT.aide}`);
  const d = new Date(stored);
  await expect(page.locator('main')).toContainText(new RegExp(`${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}|${d.getUTCFullYear()}`));
  await P.context.close();
});

test('D08 Aides-territoires: an institution-funding record is never a citizen aide (list, detail, search, sitemap, PDF)', async () => {
  expect((await anon('GET', '/api/aides/fab-aide-at', undefined, { base: PROD, ip: nextIp() })).status).toBe(404);
  expect(JSON.stringify((await anon('GET', '/api/aides?pageSize=100', undefined, { base: PROD, ip: nextIp() })).json)).not.toContain('fab-aide-at');
  expect(JSON.stringify((await anon('POST', '/api/search', { query: 'Financement FAB collectivités' }, { base: PROD, ip: nextIp() })).json)).not.toContain('fab-aide-at');
  expect((await fetch(`${PROD}/api/pdf/aides/fab-aide-at`, { headers: { 'x-forwarded-for': nextIp() } })).status).toBe(404);
  // the administration still sees it (never deleted)
  expect((await db(`SELECT count(*)::int n FROM "Aide" WHERE id = 'fab-aide-at'`))[0].n).toBe(1);
});

test('D12 territory model: a postal code resolves to communes with their département and service-territory membership; QPV per commune', async () => {
  const sch = await anon('GET', '/api/territory/postal?code=67300', undefined, { base: PROD, ip: nextIp() });   // Schiltigheim: inside the Eurométropole
  expect(sch.status).toBe(200);
  const c = sch.json.candidates.find((x) => x.code === '67447');
  expect(c).toMatchObject({ departement: '67', inServiceTerritory: true });
  const mul = await anon('GET', '/api/territory/postal?code=68100', undefined, { base: PROD, ip: nextIp() });   // Mulhouse: outside the service territory
  expect(mul.json.candidates.every((x) => x.inServiceTerritory === false)).toBe(true);
  expect(mul.json.serviceTerritory.anyCandidateInside).toBe(false);
  const sxb = await anon('GET', '/api/territory/postal?code=67000', undefined, { base: PROD, ip: nextIp() });
  expect(sxb.json.candidates.find((x) => x.code === '67482').quartiersPrioritaires.length).toBeGreaterThan(0);
  expect(sxb.json.qpvScope).toBe('COMMUNE_ONLY');   // never « this address is in a QPV »
});

test('D15 Légifrance legal basis: OPEN — each right of the assessment shows its legal references with Légifrance links; PROD — the diagnostic that carries them is refused (gate holds)', async ({ browser }) => {
  const { P, page } = await open(browser, OPEN);
  expect((await questionnaire(page, OPEN)).status()).toBe(200);
  await expect(page.getByTestId('assessment-item-rsa')).toBeVisible();
  await page.getByTestId('assessment-item-rsa').locator('details > summary').first().click();   // « pourquoi » opens the full text and the provenance
  await page.getByTestId('assessment-item-rsa').getByTestId('legal-reference-toggle').first().click();
  const legal = page.getByTestId('legal-texts-rsa');
  await expect(legal).toBeVisible();
  const links = legal.locator('a[href^="https://www.legifrance.gouv.fr/"]');
  expect(await links.count()).toBeGreaterThan(0);
  await P.context.close();
  expectClosed(await anon('POST', '/api/diagnostic', { mode: 'SIMULATION_MODE', answers: ANSWERS }, { base: PROD, ip: nextIp() }), 'D15 diagnostic');
});

test('D16 hybrid retrieval: the search answers from the lexical index when the embedding model is unreachable (no invented result)', async ({ browser }) => {
  const { P, page } = await open(browser);
  const resp = finalResponse(page, (u, m) => u.endsWith('/api/search') && m === 'POST');
  await page.goto(`${PROD}/recherche?q=${encodeURIComponent('Aide FAB logement')}`);
  const out = await (await resp).json();
  expect(JSON.stringify(out)).toContain('fab-aide-logement');
  await expect(page.getByText('Aide FAB logement (test)').first()).toBeVisible();
  const none = await anon('POST', '/api/search', { query: 'zzqxwvy' }, { base: PROD, ip: nextIp() });
  expect(none.status).toBe(200);
  expect((none.json.items || []).length).toBe(0);
  await P.context.close();
});

test('N11 map tiles / geocoding: the structure map uses no third-party tile host without consent; coordinates come from the record', async ({ browser }) => {
  const { P, page } = await open(browser);
  await page.goto(`${PROD}/structures/${CAT.structure}`);
  await expect(page.locator('h1')).toContainText('Centre FAB Strasbourg (test)');
  await settle(page);
  expect(P.external, 'no request leaves the site before the person asks for a map').toEqual([]);
  const s = await anon('GET', `/api/structures/${CAT.structure}`, undefined, { base: PROD, ip: nextIp() });
  const rec = s.json.data || s.json.structure || s.json;
  expect(Number(rec.latitude)).toBeCloseTo(48.58, 2);
  await P.context.close();
});

test('M01 PWA: manifest and service worker are served, the offline shell answers when the network is lost', async ({ browser }) => {
  const m = await fetch(`${PROD}/manifest.webmanifest`).then((r) => (r.ok ? r : fetch(`${PROD}/manifest.json`)));
  expect(m.status).toBe(200);
  const man = await m.json();
  expect(man.name || man.short_name).toBeTruthy(); expect(man.icons.length).toBeGreaterThan(0); expect(man.start_url).toBeTruthy();
  const context = await browser.newContext({ serviceWorkers: 'allow', extraHTTPHeaders: { 'x-forwarded-for': nextIp() } });
  const page = await context.newPage();
  await page.goto(`${PROD}/`);
  const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker?.ready.catch(() => null); return Boolean(r?.active); });
  expect(reg).toBe(true);
  await page.reload();
  await context.setOffline(true);
  await page.goto(`${PROD}/aides`).catch(() => {});
  await expect(page.locator('body')).not.toBeEmpty();
  await expect(page.locator('#root, main').first()).toBeVisible();
  await context.close();
});
