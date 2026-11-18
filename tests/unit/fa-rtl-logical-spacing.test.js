/**
 * FA-RTL (Arabic) — the professional, structure, institution and administration screens use LOGICAL direction utilities, so margins, paddings,
 * offsets, borders and corners follow the reading direction. FA-D4 converted text alignment (fa4-rtl-text-alignment.test.js) and A-22 the citizen
 * account screens (a22-citizen-logical-utilities.test.js); this guard covers src/pages/pro, src/pages/admin, src/pages/Admin*.jsx,
 * src/pages/institution, src/components/pro, src/components/admin and the shared primitives in src/components/ui (shadcn: used by every surface).
 *  - physical ml-/mr-/pl-/pr-/left-/right-/border-l/-r/rounded-l/-r/-tl/-tr/-bl/-br/float-left/-right → ms-/me-/ps-/pe-/start-/end-/border-s/-e/rounded-s/-e/-ss/-se/-es/-ee
 *  - space-x-N / divide-x on a flex row must carry rtl:space-x-reverse / rtl:divide-x-reverse (or use gap-N)
 *  - directional glyphs (ArrowLeft/Right, ChevronLeft/Right) mirror in Arabic (rtl:-scale-x-100 or rtl:rotate-180)
 * A utility that is physical BY DESIGN is listed in ALLOWED with its reason; a stale allowlist entry fails too.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = ['src/pages/pro', 'src/pages/admin', 'src/pages/institution', 'src/components/pro', 'src/components/admin', 'src/components/ui'];
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return files(p);
  return /\.(jsx?|tsx?)$/.test(e.name) && !/\.(test|stories)\./.test(e.name) ? [p] : [];
});
const SCOPE = [...ROOTS.flatMap(files), ...fs.readdirSync('src/pages').filter((f) => /^Admin.*\.jsx$/.test(f)).map((f) => `src/pages/${f}`)].sort();

// same token detector as A-22, plus space-x / divide-x
const PHYSICAL = /(?<=["'`\s:])-?(?:(?:ml|mr|pl|pr)-(?:\d|\[|px|auto)|text-(?:left|right)(?![\w-])|(?:left|right)-(?:\d|\[|px|auto|full|1\/2)|rounded-(?:l|r|tl|tr|bl|br)(?:-|(?![\w-]))|border-(?:l|r)(?:-|(?![\w-]))|float-(?:left|right))[\w./[\]-]*/g;
const SPACE_X = /(?<=["'`\s:])(?:space-x-(?:\d|px|\[)|divide-x(?:-\d|(?![\w-])))[\w./[\]-]*/g;
const GLYPH = /<(?:ArrowLeft|ArrowRight|ChevronLeft|ChevronRight|ChevronsLeft|ChevronsRight)\b[^>]*>/g;

// physical by design: file + the line fragment the tokens must sit in + the tokens + why
const UNUSED_SIDEBAR = 'shadcn Sidebar (not imported anywhere): its side="left"|"right" prop is a physical API — offsets, borders, rail and inset margin all derive from it';
const ALLOWED = [
  { file: 'src/pages/pro/Login.jsx', near: 'absolute -top-1 -right-1', tokens: ['-right-1'], why: 'shield badge on the brand icon (Building2): a non-directional pictogram, not mirrored' },
  { file: 'src/pages/pro/MfaSettings.jsx', near: 'absolute top-2 right-2', tokens: ['right-2'], why: 'copy button over the TOTP secret, a centred left-to-right code block (font-mono) — anchored to the code, not to the reading direction' },
  { file: 'src/components/ui/HideScreenButton.jsx', near: 'right-4 z-[40] sm:right-6', tokens: ['right-4', 'right-6'], why: 'stacked above the assistant launcher (src/components/chat/ChatAssistant.jsx, fixed right-6): both floating buttons must share one edge — move them together or not at all' },
  { file: 'src/components/ui/dialog.jsx', near: 'fixed left-[50%] top-[50%]', tokens: ['left-[50%]'], why: 'centring (left 50 % + translate-x -50 %): symmetric, identical in both directions' },
  { file: 'src/components/ui/alert-dialog.jsx', near: 'fixed left-[50%] top-[50%]', tokens: ['left-[50%]'], why: 'centring (left 50 % + translate-x -50 %): symmetric, identical in both directions' },
  { file: 'src/components/ui/carousel.jsx', near: '"-ml-4"', tokens: ['-ml-4'], why: 'shadcn Carousel (not imported): Embla scrolls along the physical x axis unless direction:"rtl" is passed; track offset and slide gutters must stay physical with it' },
  { file: 'src/components/ui/carousel.jsx', near: '"pl-4"', tokens: ['pl-4'], why: 'Embla physical axis (see -ml-4)' },
  { file: 'src/components/ui/carousel.jsx', near: '-left-12 top-1/2', tokens: ['-left-12'], why: 'previous button on the physical side Embla scrolls from (see -ml-4)' },
  { file: 'src/components/ui/carousel.jsx', near: '-right-12 top-1/2', tokens: ['-right-12'], why: 'next button on the physical side Embla scrolls to (see -ml-4)' },
  { file: 'src/components/ui/carousel.jsx', near: '<ArrowLeft className="h-4 w-4" />', tokens: ['ArrowLeft'], why: 'points at the physical previous side of the Embla track (see -ml-4)' },
  { file: 'src/components/ui/carousel.jsx', near: '<ArrowRight className="h-4 w-4" />', tokens: ['ArrowRight'], why: 'points at the physical next side of the Embla track (see -ml-4)' },
  { file: 'src/components/ui/carousel.jsx', near: 'left-1/2 -translate-x-1/2 rotate-90', tokens: ['left-1/2'], why: 'centring of the vertical-carousel buttons: symmetric' },
  { file: 'src/components/ui/navigation-menu.jsx', near: 'rotate-45 rounded-tl-sm', tokens: ['rounded-tl-sm'], why: 'the indicator is a square rotated 45°: the rounded top-left corner is its upward tip, a geometric (physical) corner' },
  { file: 'src/components/ui/resizable.jsx', near: 'after:left-1/2 after:w-1 after:-translate-x-1/2', tokens: ['after:left-1/2', 'after:left-0'], why: 'grab area centred on the handle (left 50 % + translate -50 %) or full width when vertical: symmetric' },
  { file: 'src/components/ui/scroll-area.jsx', near: 'border-l border-l-transparent', tokens: ['border-l', 'border-l-transparent'], why: 'Radix ScrollArea places the vertical scrollbar physically on the right (no DirectionProvider in the app): its separating border is on its physical left' },
  { file: 'src/components/ui/sheet.jsx', near: 'inset-y-0 left-0 h-full w-3/4 border-r', tokens: ['left-0', 'border-r'], why: 'the caller picks side="left" explicitly: a physical API (slide-in-from-left)' },
  { file: 'src/components/ui/sheet.jsx', near: 'inset-y-0 right-0 h-full w-3/4 border-l', tokens: ['right-0', 'border-l'], why: 'the caller picks side="right" explicitly: a physical API (slide-in-from-right)' },
  { file: 'src/components/ui/toast.jsx', near: 'fixed left-0 top-0 z-[100]', tokens: ['left-0', 'sm:left-auto', 'sm:right-0'], why: 'Radix Toast swipe-to-dismiss is physical (default swipeDirection "right", translate-x on data-[swipe]): the viewport stays on the edge the toast is swiped toward' },
  { file: 'src/components/ui/sidebar.jsx', near: '? "left-0 group-data-[collapsible=offcanvas]:left-[calc', tokens: ['left-0', 'group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]'], why: UNUSED_SIDEBAR },
  { file: 'src/components/ui/sidebar.jsx', near: ': "right-0 group-data-[collapsible=offcanvas]:right-[calc', tokens: ['right-0', 'group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]'], why: UNUSED_SIDEBAR },
  { file: 'src/components/ui/sidebar.jsx', near: 'group-data-[side=left]:border-r group-data-[side=right]:border-l', tokens: ['group-data-[side=left]:border-r', 'group-data-[side=right]:border-l'], why: UNUSED_SIDEBAR },
  { file: 'src/components/ui/sidebar.jsx', near: 'group-data-[side=left]:-right-4 group-data-[side=right]:left-0', tokens: ['after:left-1/2', 'group-data-[side=left]:-right-4', 'group-data-[side=right]:left-0'], why: UNUSED_SIDEBAR },
  { file: 'src/components/ui/sidebar.jsx', near: 'group-data-[collapsible=offcanvas]:after:left-full', tokens: ['group-data-[collapsible=offcanvas]:after:left-full'], why: UNUSED_SIDEBAR },
  { file: 'src/components/ui/sidebar.jsx', near: '[[data-side=left][data-collapsible=offcanvas]_&]:-right-2', tokens: ['[[data-side=left][data-collapsible=offcanvas]_&]:-right-2'], why: UNUSED_SIDEBAR },
  { file: 'src/components/ui/sidebar.jsx', near: '[[data-side=right][data-collapsible=offcanvas]_&]:-left-2', tokens: ['[[data-side=right][data-collapsible=offcanvas]_&]:-left-2'], why: UNUSED_SIDEBAR },
  { file: 'src/components/ui/sidebar.jsx', near: 'peer-data-[variant=inset]:ml-2 md:peer-data-[variant=inset]:ml-0', tokens: ['md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-2', 'md:peer-data-[variant=inset]:ml-0'], why: UNUSED_SIDEBAR },
];

const scan = (file) => {
  const out = [];
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.match(PHYSICAL) || []) {
      if (!ALLOWED.some((a) => a.file === file && line.includes(a.near) && a.tokens.some((t) => t.includes(m)))) out.push(`${file}:${i + 1} ${m}`);
    }
    for (const m of line.match(SPACE_X) || []) {
      const rev = m.startsWith('divide') ? 'rtl:divide-x-reverse' : 'rtl:space-x-reverse';
      if (!line.includes(rev)) out.push(`${file}:${i + 1} ${m} without ${rev}`);
    }
    for (const m of line.match(GLYPH) || []) if (!/rtl:(?:-scale-x-100|rotate-180)/.test(m) && !ALLOWED.some((a) => a.file === file && line.includes(a.near) && a.tokens.includes(m.match(/^<(\w+)/)[1]))) out.push(`${file}:${i + 1} ${m.slice(0, 40)}… not mirrored in RTL`);
  });
  return out;
};

describe('FA-RTL logical direction utilities in the pro / structure / institution / admin screens', () => {
  it('the detectors see physical utilities and accept logical ones', () => {
    expect('className="ml-2 sm:pr-4 -mr-1 rounded-tr-sm border-l-4 focus:left-4 -right-0.5"'.match(PHYSICAL)).toHaveLength(7);
    expect('className="ms-2 sm:pe-4 -me-1 rounded-se-sm border-s-4 focus:start-4 -end-0.5 html-left"'.match(PHYSICAL)).toBeNull();
    expect('className="flex space-x-2"'.match(SPACE_X)).toHaveLength(1);
    expect('className="flex space-y-2 gap-x-2"'.match(SPACE_X)).toBeNull();
    expect('<ArrowLeft className="me-2 h-4 w-4" />'.match(GLYPH)).toHaveLength(1);
  });
  it('the scope is not empty (the roots still exist)', () => {
    expect(SCOPE.length).toBeGreaterThan(40);
  });
  it('no physical-direction utility, unreversed space-x or unmirrored arrow outside the allowlist', () => {
    expect(SCOPE.flatMap(scan), 'use ms-/me-/ps-/pe-/start-/end-/border-s/-e/rounded-s/-e, rtl:space-x-reverse, rtl:-scale-x-100 — or add a reasoned ALLOWED entry').toEqual([]);
  });
  it('every allowlist entry is still present (no stale exemption)', () => {
    for (const a of ALLOWED) {
      const src = fs.readFileSync(a.file, 'utf8');
      expect(src.includes(a.near), `${a.file}: « ${a.near} » no longer present — drop the ALLOWED entry`).toBe(true);
      expect(a.why.length).toBeGreaterThan(20);
    }
  });
  it('Radix roots receive the interface direction (without a DirectionProvider Radix writes dir="ltr" and arrow keys run left-to-right)', () => {
    // caller's own dir (in props) still wins: {...props} comes after dir={dir}
    for (const f of ['select', 'dropdown-menu', 'tabs', 'accordion', 'radio-group', 'toggle-group'].map((n) => `src/components/ui/${n}.jsx`)) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src, f).toMatch(/const \{ dir \} = useLanguage\(\);/);
      expect(src, f).toMatch(/<\w+Primitive\.Root\s[^>]*?dir=\{dir\}[^>]*?\{\.\.\.props\}/s);
    }
  });
});
