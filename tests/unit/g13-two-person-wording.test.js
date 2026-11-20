/**
 * G13 — the data-protection wording matches the sole-administrator rule (api/_services/sole-admin.js, unchanged): another enabled MFA administrator
 * confirms at once; while there is exactly one, that administrator may confirm their own proposal after 24 h (and, for access / erasure / closure
 * reviews, a fresh logged reading). No screen states the two-person rule as absolute any more — in French (code fallbacks) and in the 5 locales.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const LANGS = ['en', 'de', 'tr', 'ar', 'uk'];
const json = (lang, ns) => JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/${ns}.json`, 'utf8'));
/** French fallback of a key in a page */
const fr = (file, key) => {
  const m = new RegExp(`t\\('${key.replace(/[.:]/g, (c) => `\\${c}`)}', '([^']*)'`).exec(fs.readFileSync(file, 'utf8'));
  expect(m, `${file} ${key}`).toBeTruthy(); return m[1];
};
const ADMIN_SOLE = ['k5.privacy.erase_intro', 'k5.privacy.closure_intro', 'k5.privacy.proposal_saved', 'k5.privacy.release_proposed', 'k5.privacy.rec_proposed', 'dashboard.card.privacy.todo'];
const FR_FILE = (k) => (k.startsWith('dashboard') ? 'src/pages/AdminDashboard.jsx' : 'src/pages/admin/k5/Privacy.jsx');

describe('G13 — two-person wording with the sole-administrator rule', () => {
  it('French: « en principe » two people, and the sole active MFA administrator after 24 h', () => {
    for (const k of ADMIN_SOLE) expect(fr(FR_FILE(k), `admin:${k}`), k).toMatch(/24 h/);
    for (const k of ['k5.privacy.erase_intro', 'k5.privacy.closure_intro']) {
      expect(fr(FR_FILE(k), `admin:${k}`)).toMatch(/^En principe deux personnes : .*une autre confirme\. Tant qu’un seul administrateur actif avec MFA existe, il peut confirmer sa propre proposition après 24 h et une nouvelle lecture journalisée\./);
    }
    expect(fr('src/pages/admin/k5/Privacy.jsx', 'admin:k5.privacy.proposal_saved')).not.toMatch(/doit confirmer/);
    expect(fr('src/pages/admin/k5/Privacy.jsx', 'admin:k5.privacy.confirm_release')).toBe('Confirmer la levée');
    expect(fr('src/pages/pro/Structure.jsx', 'pro:structure.deux_personnes_equipe_ada')).toMatch(/^L’équipe ADA examine la demande : en principe deux personnes .* seul après 24 h/);
    for (const k of ['structure.closure.in_review', 'structure.closure_confirm', 'structure.closure_sent']) expect(fr('src/pages/pro/Structure.jsx', `pro:${k}`), k).not.toMatch(/deux personnes/i);
  });

  it('every locale says it too (24 h), and the absolute « another person must confirm » is gone', () => {
    for (const lang of LANGS) {
      const a = json(lang, 'admin'); const p = json(lang, 'pro');
      for (const k of ADMIN_SOLE) expect(a[k], `${lang} ${k}`).toMatch(/24/);
      expect(p['structure.deux_personnes_equipe_ada'], lang).toMatch(/24/);
      expect(a['k5.privacy.confirm_release'], lang).not.toMatch(/[(（]/);
      expect(p['structure.closure.in_review'], lang).not.toMatch(/[(（]/);
    }
    expect(json('en', 'admin')['k5.privacy.erase_intro']).toMatch(/^As a rule, two people: .*another confirms\. While there is only one active administrator with MFA, they may confirm their own proposal after 24 h and a fresh logged reading\./);
    expect(json('en', 'admin')['k5.privacy.proposal_saved']).not.toMatch(/must confirm/);
    expect(json('en', 'pro')['structure.closure_sent']).not.toMatch(/two people/);
  });

  it('the rule itself is unchanged (wording only)', () => {
    const src = fs.readFileSync('api/_services/sole-admin.js', 'utf8');
    expect(src).toMatch(/export const SOLE_ADMIN_DELAY_MS = 24 \* 3600 \* 1000;/);
    expect(src).toMatch(/sole: self === 1 && others === 0/);
  });
});

describe('G13 break-glass review wording (no delay for the sole administrator)', () => {
  it('French fallback and the five locales name the sole-administrator case', () => {
    expect(fr('src/pages/AdminDashboard.jsx', 'admin:dashboard.card.bg.todo')).toMatch(/seul administrateur actif avec MFA/);
    for (const lang of ['en', 'de', 'tr', 'ar', 'uk']) {
      const a = JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/admin.json`, 'utf8'));
      expect(a['dashboard.card.bg.todo'], lang).toMatch(lang === 'ar' ? /المصادقة متعددة العوامل/ : /MFA/);
    }
  });
});
