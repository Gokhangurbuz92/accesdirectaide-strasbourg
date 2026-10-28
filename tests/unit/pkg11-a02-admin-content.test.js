/**
 * PKG-11 / A02 — catalogue administration (pure + source checks): the server allow-list is the authority, the screens use the governed admin API (never the
 * public read-only endpoints nor the legacy field names), and the editor only offers fields the server accepts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { editorialValues, KINDS } from '../../api/_services/admin-content.js';
import { AIDE_FIELDS, DEMARCHE_FIELDS, DISPOSITIF_FIELDS, GUIDE_FIELDS, STRUCTURE_FIELDS } from '../../src/lib/adminCatalogueFields.js';

describe('PKG-11 / A02 admin content', () => {
  it('editorial values: allow-list, column types, trimmed lists, status draft ↔ published only', () => {
    expect(editorialValues('aide', { titre: '  Titre  ', documents_necessaires: [' a ', '', 'b'], est_urgent: true, statut: 'publie' }))
      .toEqual({ ok: true, values: { titre: 'Titre', documents_necessaires: ['a', 'b'], est_urgent: true, statut: 'publie' } });
    expect(editorialValues('aide', { verified_by: 'x' }).code).toBe('FIELD_NOT_EDITABLE');
    expect(editorialValues('aide', { conditions_falc: 'x' }).code).toBe('FALC_FIELD');
    expect(editorialValues('aide', { est_urgent: 1 }).code).toBe('INVALID_VALUE');
    expect(editorialValues('structure', { statut: 'publie' }).code).toBe('INVALID_STATUS');
    expect(editorialValues('structure', { statut: 'actif' }).ok).toBe(true);
    expect(editorialValues('aide', { cest_quoi: '' })).toEqual({ ok: true, values: { cest_quoi: null } });
    expect(editorialValues('aide', {}, { creating: true }).code).toBe('LABEL_REQUIRED');
    expect(editorialValues('actualite', { titre: 'x' }).code).toBe('UNKNOWN_KIND');
    expect(editorialValues('aide', { id: 'x', slug: 'y', updatedAt: 'z', titre: 'ok' })).toEqual({ ok: true, values: { titre: 'ok' } });   // echoed read-only keys are ignored
  });

  it('dispositifs and guides: validated structures, never free JSON; their easy-to-read texts have no review workflow', () => {
    expect(editorialValues('guide', { contenu_json: [{ titre: ' Étape ', texte: 'Texte', image: '/img/a.png' }, { titre: '', texte: '' }] }))
      .toEqual({ ok: true, values: { contenu_json: [{ titre: 'Étape', texte: 'Texte', image: '/img/a.png' }] } });
    expect(editorialValues('guide', { contenu_json: [{ titre: 'x' }] }).code).toBe('INVALID_VALUE');
    expect(editorialValues('guide', { contenu_json: { html: '<script>' } }).code).toBe('INVALID_VALUE');
    expect(editorialValues('dispositif', { liens: [{ nom: 'Service-Public', url: 'https://www.service-public.fr/' }] }).ok).toBe(true);
    expect(editorialValues('dispositif', { liens: [{ nom: 'x', url: 'http://example.test/' }] }).code).toBe('INVALID_VALUE');
    expect(editorialValues('dispositif', { liens: [{ nom: 'x', url: 'javascript:alert(1)' }] }).code).toBe('INVALID_VALUE');
    expect(editorialValues('dispositif', { summary_falc: 'Résumé', description_falc: 'Texte' }).ok).toBe(true);
    expect(editorialValues('guide', { resume_falc: 'Résumé' }).ok).toBe(true);
    expect(editorialValues('aide', { summary_falc: 'x' }).code).toBe('FALC_FIELD');
    expect(editorialValues('dispositif', { verification_status: 'VERIFIED' }).code).toBe('FIELD_NOT_EDITABLE');
  });

  it('the editor offers exactly fields the server accepts', () => {
    for (const [kind, fields] of [['aide', AIDE_FIELDS], ['demarche', DEMARCHE_FIELDS], ['structure', STRUCTURE_FIELDS], ['dispositif', DISPOSITIF_FIELDS], ['guide', GUIDE_FIELDS]]) {
      expect(fields.map((f) => f.name).sort()).toEqual([...KINDS[kind].fields].sort());
    }
  });

  it('the admin screens use the governed admin API, not the public endpoints or the legacy fields', () => {
    for (const f of ['AdminAides', 'AdminAideEdit', 'AdminDemarches', 'AdminDemarcheEdit', 'AdminStructures', 'AdminStructureEdit', 'AdminDispositifs', 'AdminDispositifEdit', 'AdminGuides', 'AdminGuideEdit']) {
      const src = readFileSync(`src/pages/${f}.jsx`, 'utf8');
      expect(src).not.toMatch(/entities\.(Aide|Demarche|Structure)|verified_at|content_falc/);
      expect(src).toMatch(/Catalogue(List|Editor)/);
    }
    const shared = readFileSync('src/components/admin/CatalogueList.jsx', 'utf8') + readFileSync('src/components/admin/CatalogueEditor.jsx', 'utf8');
    expect(shared).toMatch(/apiClient\.admin\.content\./);
    expect(shared).not.toMatch(/verification_status:|launch_eligible:/);
    const routes = readFileSync('src/pages/index.jsx', 'utf8');
    for (const r of ['structures/:id', 'dispositifs', 'dispositifs/:id', 'guides', 'guides/:id']) expect(routes).toContain(`path="${r}"`);
  });
});
