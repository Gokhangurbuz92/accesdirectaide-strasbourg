// Usage: node scripts/q01-keyboard-journey.mjs [https://www.accesdirectaide.fr]   (PW_CHANNEL=chrome to use the installed Chrome)
// Q01 — keyboard-only journeys (no mouse): skip link, search, open a result, read it, menu on a phone. Reports focus visibility and traps.
import { chromium, devices } from 'playwright';
const [B = 'https://www.accesdirectaide.fr'] = process.argv.slice(2);
const b = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const res = [];
const ok = (name, pass, detail = '') => { res.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const focusInfo = (p) => p.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
  return { tag: e.tagName, text: (e.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').trim().slice(0, 50), href: e.getAttribute('href'),
    visible: r.width > 0 && r.height > 0, inView: r.bottom > 0 && r.top < innerHeight, ring: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none') }; });
async function tabUntil(p, pred, max = 60) { for (let i = 1; i <= max; i += 1) { await p.keyboard.press('Tab'); const f = await focusInfo(p); if (f && pred(f)) return { f, i }; } return null; }

// desktop journey
{ const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-FR' }); const p = await ctx.newPage();
  await p.goto(B + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  // dismiss the storage notice with the keyboard if it is focusable
  await p.keyboard.press('Tab'); const first = await focusInfo(p);
  ok('first Tab reaches the skip link', !!first && /contenu/i.test(first.text), JSON.stringify(first));
  await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  const afterSkip = await p.evaluate(() => (document.activeElement?.id || document.activeElement?.tagName));
  ok('skip link moves focus to the main content', /main|contenu|content/i.test(afterSkip), afterSkip);
  const s = await tabUntil(p, (f) => f.tag === 'INPUT');
  ok('search field reachable by keyboard', !!s, s ? `${s.i} Tab` : '');
  if (s) { ok('search field focus is visible', s.f.ring, JSON.stringify(s.f)); await p.keyboard.type('payer mon loyer'); await p.keyboard.press('Enter'); await p.waitForLoadState('networkidle'); await p.locator('main a[href^="/aides/"]').first().waitFor({ timeout: 15000 }).catch(() => {}); }
  ok('Enter in the search opens results', /q=|recherche|aides/.test(p.url()), p.url().replace(B, ''));
  const card = await tabUntil(p, (f) => f.tag === 'A' && /^\/aides\/[^?]/.test(f.href || ''), 120);
  ok('a result card is reachable by keyboard', !!card, card ? `${card.i} Tab → ${card.f.href}` : '');
  if (card) { ok('result card focus is visible', card.f.ring && card.f.inView, JSON.stringify(card.f)); await p.keyboard.press('Enter'); await p.waitForLoadState('networkidle'); await p.waitForTimeout(1500); }
  const h1 = await p.locator('h1').first().innerText().catch(() => '');
  ok('Enter opens the aid page, at its top', /\/aides\//.test(p.url()) && (await p.evaluate(() => scrollY)) < 50, `${p.url().replace(B, '')} | h1 « ${h1.slice(0, 60)} » | scrollY ${await p.evaluate(() => scrollY)}`);
  // no trap, every focused element visible
  const seen = new Set(); let invisible = 0; let noRing = []; let stuck = 0; let last = '';
  for (let i = 0; i < 70; i += 1) { await p.keyboard.press('Tab'); const f = await focusInfo(p); if (!f) continue; const k = `${f.tag}|${f.text}|${f.href}`; if (k === last) stuck += 1; last = k; seen.add(k); if (!f.visible) invisible += 1; if (!f.ring) noRing.push(f.text || f.tag); }
  ok('no keyboard trap on the aid page (70 Tab)', stuck < 3 && seen.size > 10, `${seen.size} distinct stops, ${stuck} repeats`);
  ok('every focus stop has a visible indicator', noRing.length === 0, noRing.slice(0, 6).join(' | '));
  ok('no focus on an invisible element', invisible === 0, String(invisible));
  await p.goBack(); await p.waitForTimeout(1200);
  ok('browser back returns to the results', /q=|recherche/.test(p.url()) || /\/aides\?/.test(p.url()), p.url().replace(B, ''));
  await ctx.close(); }

// phone: menu by keyboard
{ const ctx = await b.newContext({ ...devices['iPhone 13'], hasTouch: false, isMobile: false, locale: 'fr-FR' }); const p = await ctx.newPage();
  await p.goto(B + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  const m = await tabUntil(p, (f) => f.tag === 'BUTTON' && /menu/i.test(f.text), 30);
  ok('phone: menu button reachable by keyboard', !!m, m ? `${m.i} Tab, label « ${m.f.text} »` : '');
  if (m) { await p.keyboard.press('Enter'); await p.waitForTimeout(500);
    const open = await p.locator('a:visible', { hasText: 'Actualités' }).count();
    ok('phone: Enter opens the menu', open > 0, `${open} visible « Actualités » links`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    const back = await focusInfo(p);
    const still = await p.locator('#mobile-menu, nav[aria-label="Navigation mobile"]').count();
    ok('phone: Escape closes the menu and focus returns to its button', still === 0 && !!back && back.tag === 'BUTTON' && /ouvrir le menu/i.test(back.text), JSON.stringify(back) + ' menu panels ' + still); }
  await ctx.close(); }
await b.close();
console.log(`Q01_KEYBOARD ${JSON.stringify({ pass: res.filter((r) => r.pass).length, fail: res.filter((r) => !r.pass).length })}`);
