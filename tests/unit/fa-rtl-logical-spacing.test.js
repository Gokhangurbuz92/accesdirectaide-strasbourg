/**
 * FA-RTL (Arabic) — the professional, structure, institution and administration screens use LOGICAL direction utilities, so margins, paddings,
 * offsets, borders and corners follow the reading direction. FA-D4 converted text alignment (fa4-rtl-text-alignment.test.js) and A-22 the citizen
 * account screens (a22-citizen-logical-utilities.test.js); this guard covers src/pages/pro, src/pages/admin, src/pages/Admin*.jsx,
 * src/pages/institution, src/components/pro and src/components/admin.
 *  - physical ml-/mr-/pl-/pr-/left-/right-/border-l/-r/rounded-l/-r/-tl/-tr/-bl/-br/float-left/-right → ms-/me-/ps-/pe-/start-/end-/border-s/-e/rounded-s/-e/-ss/-se/-es/-ee
 *  - space-x-N / divide-x on a flex row must carry rtl:space-x-reverse / rtl:divide-x-reverse (or use gap-N)
 *  - directional glyphs (ArrowLeft/Right, ChevronLeft/Right) mirror in Arabic (rtl:-scale-x-100 or rtl:rotate-180)
 * A utility that is physical BY DESIGN is listed in ALLOWED with its reason; a stale allowlist entry fails too.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = ['src/pages/pro', 'src/pages/admin', 'src/pages/institution', 'src/components/pro', 'src/components/admin'];
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

// physical by design: file + token + the line fragment it must sit in + why
const ALLOWED = [
  { file: 'src/pages/pro/Login.jsx', token: '-right-1', near: 'absolute -top-1 -right-1', why: 'shield badge on the brand icon (Building2): a non-directional pictogram, not mirrored' },
  { file: 'src/pages/pro/MfaSettings.jsx', token: 'right-2', near: 'absolute top-2 right-2', why: 'copy button over the TOTP secret, a centred left-to-right code block (font-mono) — anchored to the code, not to the reading direction' },
];

const scan = (file) => {
  const out = [];
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.match(PHYSICAL) || []) {
      if (!ALLOWED.some((a) => a.file === file && a.token === m && line.includes(a.near))) out.push(`${file}:${i + 1} ${m}`);
    }
    for (const m of line.match(SPACE_X) || []) {
      const rev = m.startsWith('divide') ? 'rtl:divide-x-reverse' : 'rtl:space-x-reverse';
      if (!line.includes(rev)) out.push(`${file}:${i + 1} ${m} without ${rev}`);
    }
    for (const m of line.match(GLYPH) || []) if (!/rtl:(?:-scale-x-100|rotate-180)/.test(m)) out.push(`${file}:${i + 1} ${m.slice(0, 40)}… not mirrored in RTL`);
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
});
