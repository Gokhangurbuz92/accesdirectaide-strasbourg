/**
 * C3 — owner decision of 18/11/2026: the ten « Associations » fiches that concern a person become catalogue candidates one by one (explicit allow-list);
 * the theme stays unmapped, so the 24 organisation-side fiches stay out and the 9 whose rules differ in Alsace-Moselle stay held (named D11 reviewer).
 * IDs and titles: DILA Particuliers feed 3.5, archive of 17/11/2026 (FA-D2 review, CONTROL/master/completion/FA_D2_CATALOGUE_20x86_2026-11-18.md §5).
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyFiche, ASSOCIATION_ALLOWLIST, TAXONOMY_CATEGORIES } from '../../api/_services/verification/classify.js';

const THEME = 'Associations, fondations et fonds de dotation';
const C3_PUBLISH = ['F1218', 'F13091', 'F1126', 'F1390', 'F2335', 'F34105', 'F21899', 'F15870', 'F3175', 'F24418'];
const C3_EXCLUDED = ['F34326', 'F638', 'F34245', 'F34104', 'F31023', 'F766', 'F1131', 'F24345', 'F1178', 'F31016', 'F1127', 'F1319', 'F1813', 'F1124', 'F1928', 'F3180',
  'F34668', 'F21565', 'F24469', 'F21925', 'F34667', 'F15854', 'F22365', 'F1927'];
const C3_HELD_ALSACE_MOSELLE = ['F1121', 'F34797', 'F1120', 'F11966', 'F1123', 'F1926', 'F1122', 'F1119', 'F2722'];
const REF = JSON.parse(fs.readFileSync('data/reference/social-domains.v1.json', 'utf8'));
const meta = (id, title, theme = THEME, extra = {}) => ({ id, kind: "Fiche d'information", title, description: '', coverage: 'France entière',
  path: [{ id: 'Particuliers', title: 'Accueil particuliers' }, { id: 'N31331', title: theme }, { id, title }], ...extra });
const src = { text: '## Qui est concerné ?\n## Comment faire ?\n', online: [] };

describe('C3 — the « Associations » allow-list', () => {
  it('lists exactly the ten fiches of the decision, none of the 24 or the 9, each placed in the reference', () => {
    expect(Object.keys(ASSOCIATION_ALLOWLIST).sort()).toEqual([...C3_PUBLISH].sort());
    expect(C3_EXCLUDED).toHaveLength(24); expect(C3_HELD_ALSACE_MOSELLE).toHaveLength(9);
    for (const id of [...C3_EXCLUDED, ...C3_HELD_ALSACE_MOSELLE]) expect(ASSOCIATION_ALLOWLIST[id], id).toBeUndefined();
    for (const [id, a] of Object.entries(ASSOCIATION_ALLOWLIST)) {
      expect(TAXONOMY_CATEGORIES, id).toContain(a.categorie);
      const d = REF.domains.find((x) => x.id === a.domain); expect(d, id).toBeTruthy();
      if (a.subdomain) expect(d.subdomains.map((s) => s.id), id).toContain(a.subdomain);
    }
  });

  it('the ten are candidates with their recorded placement and the owner decision in their reasons', () => {
    for (const id of C3_PUBLISH) {
      const c = classifyFiche(meta(id, `Fiche ${id}`), src);
      expect(c, id).toMatchObject({ ok: true, allowList: 'C3', categorie: ASSOCIATION_ALLOWLIST[id].categorie, domain: ASSOCIATION_ALLOWLIST[id].domain, subdomain: ASSOCIATION_ALLOWLIST[id].subdomain, audience: 'particuliers' });
      expect(c.reasons.join(' '), id).toMatch(/décision du propriétaire C3 du 18\/11\/2026/);
    }
    expect(classifyFiche(meta('F13091', 'Association familiale'), src).subdomains).toEqual(['famille/parentalite']);
    expect(classifyFiche(meta('F1218', 'Association de locataires'), src).subdomains).toEqual([]);   // no subdomain invented
  });

  it('the 24 organisation-side fiches and the 9 Alsace-Moselle fiches stay pending (THEME_UNMAPPED)', () => {
    for (const id of [...C3_EXCLUDED, ...C3_HELD_ALSACE_MOSELLE]) expect(classifyFiche(meta(id, `Fiche ${id}`), src), id).toMatchObject({ ok: false, pending: 'THEME_UNMAPPED' });
  });

  it('the allow-list opens nothing else: another territory, a question-answer, the same number under another unmapped theme stay out', () => {
    expect(classifyFiche(meta('F1218', 'Association de locataires', THEME, { coverage: 'Guadeloupe' }), src)).toMatchObject({ ok: false, pending: 'COVERAGE_ELSEWHERE' });
    expect(classifyFiche(meta('F1218', 'Association de locataires', THEME, { kind: 'Fiche Question-réponse' }), src)).toMatchObject({ ok: false, pending: 'NOT_A_CATALOGUE_KIND' });
    expect(classifyFiche(meta('F1218', 'Association de locataires', 'Un thème inconnu'), src)).toMatchObject({ ok: false, pending: 'THEME_UNMAPPED' });
  });
});
