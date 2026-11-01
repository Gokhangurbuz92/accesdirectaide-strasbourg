// R32 — real-browser acceptance of the six-language interface, Arabic RTL, the page reader and the needs page. Read-only on public pages.
//   node scripts/acceptance/r32-accept.mjs <base> [result.json]       (PW_CHANNEL=chrome for the real Chrome and its system voices)
// Per language: <html lang dir>, French left in the INTERFACE (text outside lang="fr" elements, which hold the untranslated verified content), phone
// widths 375 and 320 without horizontal scroll, axe serious/critical, keyboard reach of the selector and the reader, language switch mid-journey
// (the reader stops, the page follows), the reader really speaking with a voice of the language (or honestly saying none is installed).
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const OUT = process.argv[3];
const axeSrc = fs.readFileSync(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const LANGS = (process.env.LANGS || 'fr,en,tr,ar,de,uk').split(',');
const ROUTES = ['/', '/aides', '/demarches', '/structures', '/besoins', '/actualites', '/mentions-legales'];
const res = []; const ok = (name, pass, detail = '') => { res.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${String(detail).slice(0, 160)}` : ''}`); };
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });

// French interface words that must not remain once the interface is in another language (outside lang="fr" content)
const FRENCH = /(?<![\p{L}])(les|des|pour|vous|votre|avec|dans|une|est|sont|aides|démarches|rechercher|accueil|voir|fiche|lieux)(?![\p{L}])/giu;
const residue = () => {
  const out = []; const walk = (n) => {
    if (n.nodeType === 3) { const p = n.parentElement; if (p && !p.closest('[lang="fr"],script,style,[aria-hidden="true"]') && p.offsetParent !== null) out.push(n.nodeValue); return; }
    for (const c of n.childNodes) walk(c);
  };
  walk(document.body); return out.join(' ');
};

for (const lang of LANGS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: lang === 'fr' ? 'fr-FR' : lang });
  await ctx.addInitScript((l) => { try { localStorage.setItem('ada_lang', l); localStorage.setItem('ada_onboarding_done', '1'); } catch { /* */ } }, lang);
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)));
  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => errors.push(`goto ${route}: ${e.message.slice(0, 80)}`));
    await page.waitForTimeout(1500);
    const doc = await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }));
    const text = await page.evaluate(residue);
    const words = (text.match(FRENCH) || []).length; const total = text.split(/\s+/).filter(Boolean).length;
    if (route === '/' || route === '/besoins') ok(`${lang} ${route} html lang/dir`, doc.lang === lang && doc.dir === (lang === 'ar' ? 'rtl' : 'ltr'), JSON.stringify(doc));
    if (lang !== 'fr') ok(`${lang} ${route} interface not left in French`, words <= Math.max(6, total * 0.03), `${words} French interface words of ${total}`);
    if (route === '/' || route === '/besoins' || route === '/aides') {
      await page.evaluate(axeSrc);
      const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] })).violations.filter((x) => ['serious', 'critical'].includes(x.impact)).map((x) => `${x.id}(${x.nodes.length})`));
      ok(`${lang} ${route} axe serious/critical`, v.length === 0, v.join(' '));
    }
  }
  for (const w of [375, 320]) {
    await page.setViewportSize({ width: w, height: 800 });
    for (const route of ['/', '/besoins', '/aides']) {
      await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(800);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(`${lang} ${w}px ${route} no horizontal scroll`, over <= 1, `${over}px`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  // reader: real speech synthesis of this browser
  await page.goto(`${BASE}/besoins`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(800);
  const voices = await page.evaluate(async (l) => { const get = () => speechSynthesis.getVoices(); let v = get(); for (let i = 0; !v.length && i < 20; i += 1) { await new Promise((r) => setTimeout(r, 100)); v = get(); } return v.filter((x) => x.lang.toLowerCase().startsWith(l)).map((x) => `${x.name}${x.localService ? '' : ' (online)'}`); }, lang).catch(() => []);
  const toggle = page.getByTestId('read-aloud-toggle');
  if (await toggle.count()) {
    await toggle.focus(); await page.keyboard.press('Enter');
    if (voices.length) {
      await page.getByTestId('read-page').click();
      await page.waitForTimeout(1200);
      const speaking = await page.evaluate(() => speechSynthesis.speaking);
      const lead = await page.evaluate(() => document.querySelector('.ada-reading')?.textContent?.slice(0, 60) || '');
      ok(`${lang} reader speaks with a ${lang} voice (${voices.length} on this device)`, speaking, `${voices[0]} — reading « ${lead} »`);
      await page.getByTestId('read-pause').click(); await page.waitForTimeout(300);
      ok(`${lang} reader pause stops speech`, !(await page.evaluate(() => speechSynthesis.speaking)));
      await page.getByTestId('read-resume').click(); await page.waitForTimeout(800);
      ok(`${lang} reader resume speaks again`, await page.evaluate(() => speechSynthesis.speaking));
      // switch language mid-reading: speech stops, the page follows
      const next = lang === 'fr' ? 'en' : 'fr';
      await page.selectOption('[data-testid="language-select"]', next).catch(async () => { await page.getByRole('button', { name: /menu/i }).click(); await page.selectOption('#language-select-mobile', next); });
      await page.waitForTimeout(800);
      ok(`${lang} → ${next} switch mid-reading stops speech and changes the page`, !(await page.evaluate(() => speechSynthesis.speaking)) && (await page.evaluate(() => document.documentElement.lang)) === next);
      await page.evaluate(() => speechSynthesis.cancel());
    } else {
      ok(`${lang} reader says honestly that no ${lang} voice is installed`, await page.getByTestId('read-no-voice').isVisible().catch(() => false), 'no voice on this device');
    }
  } else ok(`${lang} reader available`, false, 'no read-aloud control (speech unsupported in this browser?)');
  ok(`${lang} no page error`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
await browser.close();
const fails = res.filter((r) => !r.pass);
console.log(`R32_ACCEPT ${JSON.stringify({ base: BASE, pass: res.length - fails.length, fail: fails.length })}`);
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ base: BASE, ranAt: new Date().toISOString(), results: res }, null, 2));
