// R31 LAB acceptance (synthetic data, isolated server http://127.0.0.1:5173): R18 selections, P27 funding dossiers, Q14 pilot, isolation, axe, phone width.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { generate } from 'otplib';
const BASE = process.env.LAB_BASE || 'http://127.0.0.1:5173';
const acc = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const shots = process.argv[3];
const axeSrc = fs.readFileSync(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const res = []; const ok = (name, pass, detail = '') => { res.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });

async function axe(page, label) {
  await page.evaluate(axeSrc);
  const r = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] })).violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}(${v.nodes.length})`));
  ok(`axe ${label}`, r.length === 0, r.join(' '));
}
async function overflow(page, label) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(`no horizontal scroll at phone width: ${label}`, w <= 1, `${w}px`);
}
const errorsOf = (page) => { const e = []; page.on('pageerror', (x) => e.push(String(x.message || x))); page.on('response', (r) => { if (r.status() >= 500) e.push(`${r.status()} ${r.url()}`); }); return e; };

async function proLogin(ctx, who) {
  const page = await ctx.newPage(); const errs = errorsOf(page);
  // the first-visit welcome guide is stored as done (it is checked separately below)
  await ctx.addInitScript(() => { try { localStorage.setItem('ada_onboarding_done', 'true'); } catch { /* none */ } });
  await page.goto(`${BASE}/pro/login`);
  await page.fill('#email', acc[who].email); await page.fill('#password', acc[who].password);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/pro\/(dashboard|rdv|dossiers|selections)/, { timeout: 20000 }).catch(() => {});
  ok(`sign-in ${who}`, !/\/pro\/login/.test(page.url()), page.url());
  if (/\/pro\/login/.test(page.url())) throw new Error(`sign-in failed for ${who}: ${(await page.locator('main').innerText()).slice(0, 200)}`);
  return { page, errs };
}

// ── R18 as the author (structure administrator of s1)
let detailUrl = '';
{
  const ctx = await browser.newContext(); const { page, errs } = await proLogin(ctx, 'pro');
  ok('R18 pro sign-in', /\/pro\//.test(page.url()) && !/login/.test(page.url()), page.url());
  await page.goto(`${BASE}/pro/selections`);
  await page.getByTestId('pro-selections').waitFor({ timeout: 15000 });
  ok('R18 navigation entry « Sélections d’orientation »', await page.getByRole('link', { name: 'Sélections d’orientation' }).first().isVisible());
  ok('R18 notice: orientation, not a decision', (await page.getByTestId('selection-notice').innerText()).includes('ne dit pas si une personne a droit'));
  await page.fill('#sel-label', 'Logement, premier entretien (test)');
  await page.check('#new-need-LOGEMENT');
  await page.click('[data-testid=selection-create] button[type=submit]');
  await page.getByTestId('pro-selection-detail').waitFor({ timeout: 15000 });
  detailUrl = page.url();
  ok('R18 selection created and opened', /\/pro\/selections\/[0-9a-f-]{36}$/.test(detailUrl), detailUrl);
  ok('R18 breadcrumb says « Sélections d’orientation » and « Détail »', /Sélections d’orientation[\s\S]*Détail/.test(await page.getByRole('navigation', { name: "Fil d'Ariane" }).innerText().catch(() => '')));
  await page.fill('#sel-q', 'loyer');
  await page.click('form[role=search] button[type=submit]');
  await page.getByTestId('selection-results').waitFor({ timeout: 15000 });
  const results = await page.getByTestId('selection-result').allInnerTexts();
  ok('R18 search finds the verified fictitious aide and démarche', results.some((t) => t.includes('Aide fictive au paiement du loyer')), `${results.length} result(s)`);
  const first = page.getByTestId('selection-result').filter({ hasText: 'Aide fictive au paiement du loyer' });
  await first.locator('input').fill('Retard de loyer (test)');
  await first.getByRole('button', { name: 'Ajouter' }).click();
  await page.getByTestId('selection-entry').first().waitFor({ timeout: 15000 });
  const entry = await page.getByTestId('selection-entry').first().innerText();
  ok('R18 entry shows why (need + reason), official source and date', entry.includes('« Logement, hébergement »') && entry.includes('Retard de loyer (test)') && entry.includes('service-public.gouv.fr') && entry.includes('vérifiée le'), entry.replace(/\s+/g, ' ').slice(0, 160));
  await page.selectOption('[id^=fu-]', 'PROPOSE');
  await page.getByText('Suivi enregistré.').waitFor({ timeout: 10000 });
  ok('R18 follow-up saved', true);
  await page.selectOption('#sel-case', 'r31-case');
  await page.getByText('Sélection reliée au dossier.').waitFor({ timeout: 10000 });
  await page.getByTestId('selection-share').click();
  await page.getByText('Récapitulatif transmis').waitFor({ timeout: 15000 });
  ok('R18 summary sent to the person through the linked case', true);
  const printText = await page.getByTestId('selection-print').evaluate((el) => el.textContent);
  ok('R18 printout: person-facing text, no working label or reason', printText.includes('préparées pour vous') && printText.includes('pas une décision') && !printText.includes('premier entretien') && !printText.includes('Retard de loyer'));
  await axe(page, '/pro/selections/:id');
  await page.goto(`${BASE}/pro/dossiers/r31-case`);
  await page.getByTestId('pro-cases').or(page.locator('main')).first().waitFor();
  const caseText = await page.locator('main').innerText();
  ok('R18 the case shows the citizen-visible note with the summary', caseText.includes('Pistes d’orientation préparées pour vous'), '');
  ok('R18 no page error / 5xx during the journey', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.setViewportSize({ width: 375, height: 812 }); await page.goto(detailUrl); await page.getByTestId('pro-selection-detail').waitFor(); await overflow(page, '/pro/selections/:id');
  if (shots) await page.screenshot({ path: `${shots}/r18-selection-phone.png`, fullPage: false });
    await ctx.close();
}

// ── R18 isolation: a colleague (PRO, same organization) and another organization
for (const who of ['pro2', 'other']) {
  const ctx = await browser.newContext(); const { page } = await proLogin(ctx, who);
  await page.goto(`${BASE}/pro/selections`); await page.getByTestId('pro-selections').waitFor({ timeout: 15000 });
  ok(`R18 ${who === 'pro2' ? 'colleague' : 'other organization'}: the author's selection is not listed`, (await page.getByTestId('selection-item').count()) === 0);
  await page.goto(detailUrl);
  ok(`R18 ${who === 'pro2' ? 'colleague' : 'other organization'}: direct address refused`, await page.getByText('Cette sélection n’existe pas ou ne vous est pas ouverte.').waitFor({ timeout: 10000 }).then(() => true, () => false));
  await ctx.close();
}

// ── P27 and Q14 as the administrator (password + MFA)
{
  const ctx = await browser.newContext({ acceptDownloads: true }); const page = await ctx.newPage(); const errs = errorsOf(page);
  await page.goto(`${BASE}/admin/login`);
  await page.fill('#email', acc.admin.email); await page.fill('#password', acc.admin.password); await page.click('button[type=submit]');
  await page.getByTestId('admin-mfa-form').waitFor({ timeout: 15000 });
  await page.fill('#mfa-code', await generate({ secret: acc.admin.totp })); await page.click('[data-testid=admin-mfa-form] button[type=submit]');
  await page.waitForURL(/\/admin(?!\/login)/, { timeout: 20000 });
  ok('admin sign-in with MFA', !/login/.test(page.url()), page.url());
  await page.goto(`${BASE}/admin/financement`); await page.getByTestId('admin-funding').waitFor({ timeout: 15000 });
  ok('P27 navigation entry « Dossiers de financement »', await page.getByRole('link', { name: 'Dossiers de financement' }).first().isVisible().catch(() => false));
  await page.fill('#fd-title', 'Demande de subvention fictive (test LAB)'); await page.fill('#fd-funder', 'Financeur fictif'); await page.fill('#fd-deadline', '2099-03-31');
  await page.getByRole('button', { name: 'Créer le dossier' }).click();
  await page.getByText('Dossier créé et prérempli').waitFor({ timeout: 15000 });
  await page.getByTestId('admin-funding-item').first().getByRole('link', { name: 'Ouvrir' }).click();
  await page.getByTestId('admin-funding-detail').waitFor({ timeout: 15000 });
  const warn = await page.getByTestId('funding-warnings').innerText();
  ok('P27 prefilled from validated facts, warnings listed', (await page.inputValue('#fdd-sec-presentation')).includes('en cours de constitution') && warn.includes('Bloquant') && warn.includes('pas encore inscrite'), warn.replace(/\s+/g, ' ').slice(0, 140));
  for (const k of ['objectifs', 'publics', 'activites', 'besoins']) await page.fill(`#fdd-sec-${k}`, `Texte fictif pour ${k}.`);
  const amount = page.locator('input[type=number]').first(); await amount.fill('240');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.getByText(/Enregistré \(version 2\)/).waitFor({ timeout: 15000 });
  ok('P27 saved as version 2', true);
  const warn2 = await page.getByTestId('funding-warnings').innerText();
  ok('P27 unbalanced budget detected after the save', warn2.includes('Budget non équilibré'), '');
  await page.getByRole('button', { name: 'Prêt pour la validation du porteur' }).click();
  ok('P27 « ready » refused while blocking points remain', await page.getByTestId('admin-funding-detail-problem').getByText('n’est pas prêt').waitFor({ timeout: 10000 }).then(() => true, () => false));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), page.getByRole('button', { name: /Télécharger le document de travail/ }).click()]);
  const md = dl ? fs.readFileSync(await dl.path(), 'utf8') : '';
  ok('P27 Markdown working document downloaded', md.includes('Document de travail') && md.includes('n’est pas une demande déposée'), dl ? dl.suggestedFilename() : 'no download');
  ok('P27 versions listed', (await page.locator('#fd-versions').locator('xpath=..').innerText()).includes('Version 2'));
  await axe(page, '/admin/financement/:id');
  await page.goto(`${BASE}/admin/pilote`); await page.getByTestId('admin-pilot').waitFor({ timeout: 15000 });
  const tech = await page.getByTestId('pilot-technical').innerText();
  ok('Q14 technical indicators measured from the product', /Aides\s+\d+/.test(tech) && tech.includes('Actualités publiées'), tech.replace(/\s+/g, ' ').slice(0, 120));
  ok('Q14 « no session » stated, no figure invented', await page.getByTestId('pilot-none').isVisible());
  await page.getByRole('button', { name: 'Tirer un nouveau code' }).click();
  await page.waitForFunction(() => /^P-[A-Z2-9]{6}$/.test(document.querySelector('#pi-code')?.value || ''), null, { timeout: 10000 });
  await page.fill('#pi-duration', '95'); await page.fill('#pi-obs', 'A cherché le bouton « Lire la fiche ».');
  await page.getByRole('button', { name: 'Enregistrer la séance' }).click();
  ok('Q14 a session without consent is refused', await page.getByTestId('admin-pilot-problem').innerText({ timeout: 10000 }).then((t) => t.includes('consentement')).catch(() => false));
  await page.check('#pi-consent'); await page.getByRole('button', { name: 'Enregistrer la séance' }).click();
  await page.getByText('Séance enregistrée.').waitFor({ timeout: 10000 });
  const results = await page.getByTestId('pilot-results').innerText();
  ok('Q14 one session: result suppressed below 5', results.includes('moins de 5 séances'), '');
  // 01/11/2026: pseudonymised data — stated on the page; an assistive technology needs the separate explicit consent; health words are refused
  ok('Q14 the page says sessions are not anonymous', (await page.getByTestId('admin-pilot').innerText()).includes('ne sont pas anonymes'));
  await page.selectOption('#pi-at', 'LECTEUR_ECRAN'); await page.check('#pi-consent');
  ok('Q14 the explicit-consent box appears for an assistive technology', await page.locator('#pi-explicit').waitFor({ timeout: 5000 }).then(() => true, () => false));
  await page.getByRole('button', { name: 'Enregistrer la séance' }).click();
  ok('Q14 an assistive technology without the explicit consent is refused', await page.getByTestId('admin-pilot-problem').getByText('accord séparé').waitFor({ timeout: 10000 }).then(() => true, () => false));
  await page.fill('#pi-obs', 'La personne est malvoyante.'); await page.check('#pi-explicit'); await page.getByRole('button', { name: 'Enregistrer la séance' }).click();
  ok('Q14 a health word in the observation is refused', await page.getByTestId('admin-pilot-problem').getByText('jamais la santé').waitFor({ timeout: 10000 }).then(() => true, () => false));
  await page.fill('#pi-obs', 'Le bouton « Lire la fiche » n’est pas annoncé.'); await page.getByRole('button', { name: 'Enregistrer la séance' }).click();
  ok('Q14 with the explicit consent the session is recorded', await page.getByText('Séance enregistrée.').waitFor({ timeout: 10000 }).then(() => true, () => false));
  await axe(page, '/admin/pilote');
  ok('admin journeys: no page error / 5xx', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.setViewportSize({ width: 375, height: 812 }); await page.reload(); await page.getByTestId('admin-pilot').waitFor(); await overflow(page, '/admin/pilote');
  if (shots) await page.screenshot({ path: `${shots}/q14-pilot-phone.png` });
  await ctx.close();
}
await browser.close();
console.log(`R31_LAB_ACCEPT ${JSON.stringify({ pass: res.filter((r) => r.pass).length, fail: res.filter((r) => !r.pass).length })}`);
fs.writeFileSync(process.argv[4] || '/dev/null', JSON.stringify(res, null, 2));
