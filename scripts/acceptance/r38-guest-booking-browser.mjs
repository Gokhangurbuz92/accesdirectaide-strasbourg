#!/usr/bin/env node
/**
 * R38 — account-free booking in a REAL browser, LAB only:  node scripts/acceptance/r38-guest-booking-browser.mjs http://127.0.0.1:5173 [--out result.json]
 * The LAB server runs the beta build with the appointments surface open and ADA_GUEST_BOOKING_ENABLED=true, MAILER_PROVIDER=test (the code and the manage link
 * are read from the LAB outbox, /__lab/outbox, which only the LAB server has). The structure « r31-s1 » must allow guest booking for one service (the LAB
 * fixture, --fixture, writes the two operator switches the Pro screens set: StructureRdvSettings.allowGuestBooking and ProRdvService.guestBookable, plus opening
 * hours). Journey: structure page → « sans compte » → service and slot → name, e-mail, consent → code from the e-mail → confirmed → the e-mailed personal
 * link → move to another slot → cancel; a wrong code shows the attempts left; a tampered link shows nothing; no login page at any step; axe on each screen;
 * no horizontal scroll at 390 px; Arabic page right-to-left.
 */
import fs from 'node:fs';
const base = (process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:5173').replace(/\/$/, '');
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const rows = []; const check = (step, ok, detail = '') => { rows.push({ step, pass: Boolean(ok), detail: String(detail).slice(0, 300) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${ok ? '' : ` — ${detail}`}`); };

if (process.argv.includes('--fixture')) {
  const pg = (await import('pg')).default; const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  if (new URL(process.env.DATABASE_URL).hostname !== '127.0.0.1') throw new Error('local database only');
  await c.connect();
  const sid = (await c.query(`SELECT id FROM "Structure" WHERE slug = 'r31-s1'`)).rows[0].id;
  await c.query(`UPDATE "Structure" SET is_pro_enabled = true WHERE id = $1`, [sid]);
  await c.query(`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "allowGuestBooking", "updatedAt") VALUES ('r38-set-' || $1, $1, true, 'IN_PERSON', true, NOW())
    ON CONFLICT ("structureId") DO UPDATE SET "isPublished" = true, "allowGuestBooking" = true`, [sid]);
  for (const wd of [1, 2, 3, 4, 5, 6]) await c.query(`INSERT INTO "ProAvailabilityRule" (id, "structureId", weekday, "startTime", "endTime", timezone, "isActive", "updatedAt") VALUES ($1, $2, $3, '09:00', '12:00', 'Europe/Paris', true, NOW()) ON CONFLICT (id) DO NOTHING`, [`r38-rule-${wd}`, sid, wd]);
  await c.query(`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "guestBookable", "updatedAt") VALUES ('r38-svc-guest', $1, 'Premier accueil (sans compte)', 30, 0, 0, true, true, NOW()),
    ('r38-svc-account', $1, 'Suivi de dossier (avec compte)', 30, 0, 0, true, false, NOW()) ON CONFLICT (id) DO NOTHING`, [sid]);
  await c.end(); console.log('FIXTURE r31-s1 allows guest booking for one service'); process.exit(0);
}

// a radio is styled as its label: a person clicks the label
const pick = async (radio) => { const id = await radio.getAttribute('id'); const label = id ? radio.page().locator(`label[for="${id}"]`) : radio.locator('xpath=ancestor::label[1]'); await ((await label.count()) ? label.first() : radio).click(); };
const outbox = async (to) => (await (await fetch(`${base}/__lab/outbox?to=${encodeURIComponent(to)}`)).json());
const { chromium } = await import('playwright'); const AxeBuilder = (await import('@axe-core/playwright')).default;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });
const audit = async (page, step) => { await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null)))); const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze(); check(`${step}: axe WCAG A/AA`, r.violations.length === 0, r.violations.map((v) => `${v.id} ${v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} ${n.any?.[0]?.message || ''}`).join(' ; ')}`).join(' | ')); };
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr' });
await ctx.addInitScript(() => { try { localStorage.setItem('ada_lang', 'fr'); localStorage.setItem('ada_onboarding_done', '1'); } catch { /* */ } });
let page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e.message)));
const visited = []; page.on('framenavigated', (f) => { if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname); });
const email = `guest.r38.${Date.now()}@lab.test`;
try {
  await page.goto(`${base}/structures/r31-s1`, { waitUntil: 'domcontentloaded' });
  const cta = page.getByTestId('structure-guest-booking');
  check('structure page offers « sans compte »', await cta.waitFor({ timeout: 20000 }).then(() => true, () => false));
  await cta.click();
  await page.getByRole('heading', { name: 'Prendre rendez-vous sans compte' }).waitFor({ timeout: 20000 });
  check('guest page opens without any login', !visited.some((p) => /login|connexion/.test(p)), visited.join(' → '));
  await audit(page, 'guest page');
  const services = page.getByRole('group', { name: 'Motif du rendez-vous' }).getByRole('radio');
  check('only the guest-bookable service is offered', (await services.count()) === 1 && (await page.getByText('Suivi de dossier (avec compte)').count()) === 0, `${await services.count()} services`);
  await pick(services.first());
  const slots = page.getByRole('group', { name: 'Créneau (heure de Paris)' }).getByRole('radio');
  await slots.first().waitFor({ timeout: 20000 });
  // the last slot offered (about two weeks ahead): a booking can be moved online only well before it (RESCHEDULE_MIN_NOTICE_HOURS, the citizens' rule)
  const firstSlot = await slots.last().getAttribute('value');
  await pick(slots.last());
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel('Nom ou initiales').fill('C. D.');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel(/J’accepte de recevoir par e-mail/).check();
  // R39: the optional J-1 reminder is a separate, unticked box
  const reminderBox = page.getByLabel(/Recevoir aussi un rappel par e-mail la veille/);
  check('R39: the J-1 reminder box exists and is unticked by default', (await reminderBox.count()) === 1 && !(await reminderBox.isChecked()));
  await reminderBox.check();
  await page.getByRole('button', { name: 'Recevoir le code' }).click();
  await page.getByLabel('Code reçu par e-mail').waitFor({ timeout: 20000 });
  const mail1 = await outbox(email); const code = (/\b(\d{6})\b/.exec(mail1.map((m) => m.text).join('\n')) || [])[1];
  check('a 6-digit code is e-mailed (LAB test outbox)', Boolean(code), `${mail1.length} message(s)`);
  await page.getByLabel('Code reçu par e-mail').fill(code === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: 'Confirmer le rendez-vous' }).click();
  check('a wrong code says how many attempts are left', await page.getByText(/Essais restants : 4/).waitFor({ timeout: 10000 }).then(() => true, () => false));
  await page.getByLabel('Code reçu par e-mail').fill(code);
  await page.getByRole('button', { name: 'Confirmer le rendez-vous' }).click();
  check('the right code confirms the booking', await page.getByTestId('guest-confirmed').waitFor({ timeout: 20000 }).then(() => true, () => false));
  await audit(page, 'confirmation');
  const mail2 = await outbox(email); const link = (/(https?:\/\/[^\s]+\/sans-compte\/gerer\?[^\s]+)/.exec(mail2.map((m) => m.text).join('\n')) || [])[1];
  check('a personal link is e-mailed', Boolean(link), `${mail2.length} message(s)`);
  const local = link ? `${base}${new URL(link).pathname}${new URL(link).search}${new URL(link).hash}` : null;
  // a tampered link shows nothing
  if (local) {
    const tampered = local.replace(/(manage=)([A-Za-z0-9_-])/, (m, a, c) => `${a}${c === 'A' ? 'B' : 'A'}`);
    await page.goto(tampered, { waitUntil: 'domcontentloaded' });
    check('a tampered personal link is refused', await page.getByTestId('guest-manage-invalid').waitFor({ timeout: 15000 }).then(() => true, () => false));
    // the e-mailed link opens in a new tab (a URL that differs only after « # » would not reload this one)
    const tab = await ctx.newPage(); tab.on('pageerror', (e) => errors.push(String(e.message)));
    await page.close(); page = tab;
    await page.goto(local, { waitUntil: 'domcontentloaded' });
    const box = page.getByTestId('guest-manage');
    check('the personal link opens the booking', await box.waitFor({ timeout: 15000 }).then(() => true, () => false));
    check('the token is removed from the address bar', !page.url().includes('manage='), page.url());
    const shown = await box.innerText().catch(() => '');
    check('the page masks the e-mail address', !shown.includes(email) && /\*/.test(shown), shown.slice(0, 160));
    await audit(page, 'personal link');
    // R39: the reminder chosen at booking is shown, and can be withdrawn here (the new state is announced)
    const state = page.getByTestId('guest-reminder-state');
    check('R39: the personal link shows the reminder as on', /Rappel activé/.test(await state.innerText().catch(() => '')));
    await page.getByTestId('guest-manage-reminder').getByRole('button').click();
    check('R39: the reminder is withdrawn from the personal link', await page.getByText(/Rappel désactivé/).waitFor({ timeout: 15000 }).then(() => true, () => false));
    await page.getByRole('button', { name: 'Déplacer' }).click();
    const moveSlots = page.getByRole('group', { name: 'Créneau (heure de Paris)' }).getByRole('radio');
    await moveSlots.first().waitFor({ timeout: 15000 });
    const values = await moveSlots.evaluateAll((els) => els.map((e) => e.value));
    const other = values.find((v) => v !== firstSlot);
    await pick(page.locator(`input[type="radio"][value="${other}"]`));
    await page.getByRole('button', { name: /Déplacer|Confirmer/ }).last().click();
    check('the booking is moved to another slot', await page.getByText('Le rendez-vous est déplacé').waitFor({ timeout: 15000 }).then(() => true, () => false));
    await page.getByRole('button', { name: 'Annuler le rendez-vous' }).click();
    const confirmBtn = page.getByRole('button', { name: /Confirmer l’annulation|Oui, annuler|Annuler le rendez-vous/ }).last();
    if (await confirmBtn.isVisible().catch(() => false)) await confirmBtn.click();
    check('the booking is cancelled', await page.getByText('Le rendez-vous est annulé').waitFor({ timeout: 15000 }).then(() => true, () => false));
  }
  check('no login page at any step', !visited.some((p) => /\/(auth|pro)\/login|\/compte/.test(p)), [...new Set(visited)].join(' '));
  // phone width and Arabic
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar' });
  await m.addInitScript(() => { try { localStorage.setItem('ada_lang', 'ar'); localStorage.setItem('ada_onboarding_done', '1'); } catch { /* */ } });
  const mp = await m.newPage(); await mp.goto(`${base}/rdv/r31-s1/sans-compte`, { waitUntil: 'domcontentloaded' });
  await mp.getByRole('group').first().waitFor({ timeout: 20000 }).catch(() => {});
  const v = await mp.evaluate(() => ({ dir: document.documentElement.dir, overflow: document.documentElement.scrollWidth > window.innerWidth + 1, h1: document.querySelector('h1')?.textContent || '' }));
  check('Arabic at 390 px: right-to-left, translated title, no horizontal scroll', v.dir === 'rtl' && !v.overflow && !/sans compte/.test(v.h1), JSON.stringify(v));
  await audit(mp, 'guest page (ar, 390 px)');
  await m.close();
} catch (e) { check('journey ran to the end', false, e.message); }
check('no page error', errors.length === 0, errors.join(' | '));
await browser.close();
const summary = { base, at: new Date().toISOString(), total: rows.length, pass: rows.filter((r) => r.pass).length, fail: rows.filter((r) => !r.pass).length };
console.log(`R38_GUEST_BOOKING ${JSON.stringify(summary)}`);
if (out) fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
process.exit(summary.fail ? 1 : 0);
