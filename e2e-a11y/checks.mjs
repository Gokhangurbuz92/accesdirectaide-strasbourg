// @ts-nocheck
/**
 * G14-CHAN (Part B) — the checks of the CI accessibility slice (playwright.a11y-ci.config.mjs). Adapted from the FA-D4 RGAA audit
 * (e2e-r47/rgaa/rgaa-audit.pw.mjs, which needs the LAB server and only REPORTS) to the mocked `vite preview` of CI, where every finding FAILS.
 * Automated checks only: they find regressions, they are not an RGAA audit and say nothing about real users (no user test exists).
 */
import AxeBuilder from '@axe-core/playwright';

/** every axe tag the project tests with (WCAG 2.0 / 2.1 / 2.2 A + AA, and axe's best practices) */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/**
 * Findings accepted on purpose, each with its reason (rule id → justification). Empty: every finding of the CI sample was fixed or is not one.
 * A new entry needs a written justification here, never a silent filter.
 * @type {Readonly<Record<string, string>>}
 */
export const AXE_BASELINE = Object.freeze({});

/** the public pages of the CI sample (they render with the mocked API) */
export const SAMPLE = ['/', '/aides', '/demarches', '/annuaire', '/recherche?q=logement', '/orientation', '/auth/login', '/contact', '/accessibilite', '/mentions-legales'];

export const SPACING = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }';

/** opens a page in a language and waits until the route transition and data settled */
export async function open(page, route, lang = 'fr') {
  await page.addInitScript((l) => { try { localStorage.setItem('ada_lang', l); localStorage.setItem('ada_onboarding_done', '1');
    localStorage.setItem('ada_cookie_consent', JSON.stringify({ necessary: true, analytics: false, accepted: true, date: new Date().toISOString() })); } catch { /* */ } }, lang);
  const resp = await page.goto(route, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main, [role="main"]', { state: 'attached', timeout: 20_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await settle(page);
  return resp;
}
export async function settle(page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming?.().iterations === Infinity), null, { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(250);
}

/** axe violations (every impact) not in the baseline, as short strings */
export async function axeFindings(page, { forcedColors = false } = {}) {
  // in forced colours the system palette replaces the authored colours: axe's color-contrast reads authored values there (it flagged text on the hero
  // gradient that the system draws as Canvas / CanvasText) — that one rule is left out in that mode only; the normal run checks it (justified exclusion)
  const b = new AxeBuilder({ page }).withTags(AXE_TAGS);
  const r = await (forcedColors ? b.disableRules(['color-contrast']) : b).analyze();
  return r.violations.filter((v) => !AXE_BASELINE[v.id]).map((v) => `${v.impact}:${v.id}(${v.nodes.length}) ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
}

export const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** the deepest elements past the edges: where a reflow problem comes from */
export const culprits = (page) => page.evaluate(() => { const vw = document.documentElement.clientWidth;
  return [...document.querySelectorAll('body *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > vw + 1 || b.left < -1) && ![...e.children].some((c) => { const cb = c.getBoundingClientRect(); return cb.right > vw + 1 || cb.left < -1; }); })
    .filter((e) => !e.closest('[class*="overflow-x-auto"], [class*="overflow-auto"], .sr-only')).slice(0, 3).map((e) => `${e.tagName}.${String(e.className).slice(0, 50)} « ${(e.textContent || '').trim().slice(0, 30)} »`).join(' | '); });

/** a keyboard-only walk from the top: skip link first, focus always visible, no trap (RGAA 10.7, 12.7, 12.9) */
export async function keyboardWalk(page, stops = 40) {
  const findings = [];
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  await page.keyboard.press('Tab');
  const skip = await page.evaluate(() => { const a = document.activeElement; return a && a.tagName === 'A' && /#(main|contenu|content)/.test(a.getAttribute('href') || '') ? a.getAttribute('href') : null; });
  if (!skip) findings.push('skip link is not the first focus stop');
  const invisible = new Set(); const seq = []; let trap = null;
  for (let i = 0; i < stops; i += 1) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return null; const s = getComputedStyle(a);
      const pickerFocus = /^(date|time|datetime-local|month|week)$/.test(a.type || '') && !a.matches(':focus');
      const visible = pickerFocus || (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
      const r = a.getBoundingClientRect();
      return { visible, id: `${a.tagName}#${a.id}.${(a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 30)}@${Math.round(r.top + scrollY)}:${Math.round(r.left)}`,
        label: `${a.tagName}#${a.id} « ${(a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 30)} »`, offscreen: r.width < 2 || r.height < 2,
        segmented: /^(date|time|datetime-local|month|week)$/.test(a.type || '') }; });
    if (!f) continue;
    if (!f.visible && !f.offscreen) invisible.add(f.label);
    seq.push(f.id);
    const need = f.segmented ? 7 : 4;
    if (seq.length >= need && seq.slice(-need).every((x) => x === seq[seq.length - 1])) { trap = f.label; break; }
  }
  if (invisible.size) findings.push(`focus not visible: ${[...invisible].slice(0, 5).join(' | ')}`);
  if (trap) findings.push(`keyboard trap at ${trap}`);
  await page.keyboard.press('Escape');
  return findings;
}

/** reflow at 320 px, 400 % zoom (1280 × 1024 / 4 = 320 × 256 CSS px), text spacing at 1280 and 320 px (WCAG 1.4.10, 1.4.4, 1.4.12) */
export async function layoutFindings(page) {
  const findings = [];
  const at = async (w, h, label, css = null) => {
    await page.setViewportSize({ width: w, height: h }); const st = css ? await page.addStyleTag({ content: css }) : null; await page.waitForTimeout(250);
    const o = await overflowX(page);
    if (o > 1) findings.push(`${label}: ${o}px sideways scroll — ${await culprits(page)}`);
    if (st) await st.evaluate((n) => n.remove());
  };
  await at(320, 800, 'reflow-320');
  await at(320, 256, 'zoom-400 (320×256)');
  await at(1280, 900, 'text-spacing-1280', SPACING);
  await at(320, 800, 'text-spacing-320', SPACING);
  // 400 %: the main content must still be reachable (not hidden behind a fixed header taller than the viewport)
  await page.setViewportSize({ width: 320, height: 256 }); await page.waitForTimeout(200);
  const fixedTall = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => { const cs = getComputedStyle(e); if (!['fixed', 'sticky'].includes(cs.position)) return false;
    const b = e.getBoundingClientRect(); return b.width > 0 && b.height > window.innerHeight * 0.5 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[role="dialog"]'); })
    .slice(0, 3).map((e) => `${e.tagName}.${String(e.className).slice(0, 40)}`));
  if (fixedTall.length) findings.push(`zoom-400: fixed/sticky block over half the viewport: ${fixedTall.join(' | ')}`);
  await page.setViewportSize({ width: 1280, height: 900 });
  return findings;
}

/** with prefers-reduced-motion: reduce, nothing keeps moving and no transition / animation lasts longer than 0.2 s (WCAG 2.3.3 / RGAA 13.8) */
export async function reducedMotionFindings(page) {
  return page.evaluate(() => {
    const out = [];
    const infinite = document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming?.().iterations === Infinity);
    if (infinite.length) out.push(`${infinite.length} infinite animation(s): ${infinite.slice(0, 3).map((a) => a.effect?.target?.className?.toString?.().slice(0, 40)).join(' | ')}`);
    const secs = (v) => Math.max(0, ...String(v).split(',').map((x) => (x.trim().endsWith('ms') ? parseFloat(x) / 1000 : parseFloat(x) || 0)));
    const long = [...document.querySelectorAll('body *')].filter((e) => { const cs = getComputedStyle(e); return secs(cs.animationDuration) > 0.2 && cs.animationName !== 'none' && cs.animationPlayState === 'running'; })
      .slice(0, 3).map((e) => `${e.tagName}.${String(e.className).slice(0, 40)}`);
    if (long.length) out.push(`animations longer than 0.2 s: ${long.join(' | ')}`);
    const smooth = getComputedStyle(document.documentElement).scrollBehavior === 'smooth';
    if (smooth) out.push('scroll-behavior: smooth on the page');
    return out;
  });
}

/** lang / dir of the document for an interface language; Arabic: right-to-left and no Arabic text block physically aligned to the left (RGAA 8.3, 8.4) */
export async function langDirFindings(page, lang) {
  return page.evaluate((l) => {
    const out = []; const html = document.documentElement;
    if (html.lang !== l) out.push(`html lang « ${html.lang} » ≠ ${l}`);
    if (html.dir !== (l === 'ar' ? 'rtl' : 'ltr')) out.push(`html dir « ${html.dir} » for ${l}`);
    if (l === 'ar') {
      const AR = /[؀-ۿ]/;
      const left = [...document.querySelectorAll('p, li, td, th, h1, h2, h3, h4, label, dd, dt, caption, div')].filter((e) => { const b = e.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && e.children.length === 0 && AR.test(e.textContent || '') && getComputedStyle(e).textAlign === 'left' && getComputedStyle(e).direction === 'rtl'; })
        .map((e) => e.textContent.trim().slice(0, 30));
      if (left.length) out.push(`${left.length} Arabic block(s) aligned left: ${left.slice(0, 4).join(' | ')}`);
    }
    return out;
  }, lang);
}

/** WCAG relative luminance contrast of two « rgb(a) » colours (alpha composited over `under`) */
export const CONTRAST_SRC = `
  const parse = (c) => { const m = String(c).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // the colour behind an element: its own and its ancestors' backgrounds composited; null when an image / gradient makes it unknowable
  const bgOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
    const c = parse(cs.backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
    let acc = { r: 255, g: 255, b: 255, a: 1 }; for (const l of layers.reverse()) acc = over(l, acc); return acc; };
`;
