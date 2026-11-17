/**
 * A-22 (RTL) — the citizen account screens use LOGICAL direction utilities (ms-/me-/ps-/pe-/text-start/text-end/start-/end-), so margins, paddings and
 * alignment follow the reading direction in Arabic. A physical utility (ml-, mr-, pl-, pr-, text-left, text-right, left-N, right-N, rounded-l/-r, border-l/-r,
 * float-left/right) in one of these files fails this test.
 * Not covered here: src/pages/CompteRendezVous.jsx (booking page, owned by the booking work; one `mr-4` remains at the time of writing).
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const FILES = [
  'src/pages/CompteProfil.jsx', 'src/pages/CompteParametres.jsx', 'src/components/account/NotificationCenter.jsx', 'src/components/sharing/CitizenSharingPanel.jsx',
  'src/pages/CompteMessages.jsx', 'src/pages/UserPassport.jsx', 'src/components/sharing/DossierThreads.jsx', 'src/pages/ComptePartageDetail.jsx',
];
// a class token: preceded by a quote, a space, a backtick or a variant prefix (sm:, hover:, rtl:…), optionally negative
const PHYSICAL = /(?<=["'`\s:])-?(?:(?:ml|mr|pl|pr)-(?:\d|\[|px|auto)|text-(?:left|right)(?![\w-])|(?:left|right)-(?:\d|\[|px|auto|full|1\/2)|rounded-(?:l|r|tl|tr|bl|br)(?:-|(?![\w-]))|border-(?:l|r)(?:-|(?![\w-]))|float-(?:left|right))[\w./[\]-]*/g;

describe('A-22 logical direction utilities in the citizen account screens', () => {
  it('the detector itself sees physical utilities and accepts logical ones', () => {
    const hits = (s) => s.match(PHYSICAL) || [];
    expect(hits('className="ml-2 text-left sm:pr-4 -mr-1 rounded-l-md border-l left-0 hover:right-2"')).toHaveLength(8);
    expect(hits('className="ms-2 text-start sm:pe-4 -me-1 rounded-s-md border-s start-0 items-left-ish html-left"')).toEqual([]);
  });
  for (const file of FILES) {
    it(`${file} has no physical-direction utility`, () => {
      const found = [];
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => { for (const m of line.match(PHYSICAL) || []) found.push(`${i + 1}: ${m}`); });
      expect(found, `${file} — replace with the logical utility (ms-/me-/ps-/pe-/text-start/text-end/start-/end-)`).toEqual([]);
    });
  }
});
