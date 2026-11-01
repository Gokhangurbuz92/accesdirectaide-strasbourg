/**
 * R32 — content translations: fingerprint of the French source, segmentation, protection of official names, automatic checks and the
 * publication decision (what the public API may return). Pure logic; the engines themselves are exercised by scripts/translation-benchmark.mjs.
 */
import { describe, expect, it } from 'vitest';
import { FIELDS, SCHEMA, checkField, chrF, fieldStatus, protect, publicView, recordStatus, restore, sourceHash, unitsOf } from '../../api/lib/contentTranslation.js';

const aide = { slug: 'apl', titre: 'Aide personnalisée au logement (APL)', cest_quoi: 'Une aide de la CAF pour payer le loyer.', pour_qui: '- Locataires\n- Pas automatique : faites la demande', etapes: ['Simulez', 'Demandez'], verified_by: 'x', date_verification: '2026-10-01' };

describe('fingerprint of the French source', () => {
  it('changes when a translated field changes, not when an untranslated field changes', () => {
    const h = sourceHash('aide', aide);
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(sourceHash('aide', { ...aide, date_verification: '2026-11-01', verified_by: 'y' })).toBe(h);
    expect(sourceHash('aide', { ...aide, pour_qui: '- Locataires\n- Automatique' })).not.toBe(h);
    expect(sourceHash('guide', { titre: 'G', contenu_json: { intro: 'a', provenance: { checkedAt: '1' } } })).toBe(sourceHash('guide', { titre: 'G', contenu_json: { intro: 'a', provenance: { checkedAt: '2' } } }));
  });
  it('covers the displayed fields, with the conditions, documents and steps classed high risk', () => {
    expect(FIELDS.aide).toMatchObject({ pour_qui: 'high', documents_necessaires: 'high', etapes: 'high', cest_quoi: 'normal' });
    expect(FIELDS.demarche.contenu_detaille).toBe('high');
  });
});

describe('segmentation', () => {
  it('cuts lines and bullets, keeps structure, ids and links, and rebuilds the same shape', () => {
    const v = [{ titre: 'Étape un', description: 'Faites ceci.\n- puis cela', url: 'https://x.fr', ordre: 1 }];
    const u = unitsOf(v);
    expect(u.units).toEqual(['Étape un', 'Faites ceci.', 'puis cela']);
    expect(u.rebuild(['Step one', 'Do this.', 'then that'])).toEqual([{ titre: 'Step one', description: 'Do this.\n- then that', url: 'https://x.fr', ordre: 1 }]);
    const g = unitsOf({ intro: 'Intro.', steps: [{ titre: 'T', texte: 'Texte.' }], provenance: { sourceUrl: 'https://s' } });
    expect(g.units).toEqual(['Intro.', 'T', 'Texte.']);
    expect(g.rebuild(['I.', 'T2', 'X.']).provenance).toEqual({ sourceUrl: 'https://s' });
  });
});

describe('official names', () => {
  it('are replaced by placeholders, restored in French, and glossed once per field by the project — never by the engine', () => {
    const p = protect('Contactez la CAF ou France Travail ; la CAF répond.');
    expect(p.text).toBe('Contactez la [[T2]] ou [[T1]] ; la [[T3]] répond.');
    const r = restore('Contact the [[T2]] or [[T1]]; the [[T3]] answers.', p.slots, 'en', new Set());
    expect(r).toEqual({ text: 'Contact the CAF (family benefits office) or France Travail (public employment service); the CAF answers.', missing: [] });
    expect(restore('Contact the office.', p.slots, 'en').missing).toEqual(['[[T1]]', '[[T2]]', '[[T3]]']);
  });
});

describe('automatic checks', () => {
  it('stop changed numbers, lost names, links, entitlement claims and untranslated French; accept reformatted numbers and times', () => {
    const ok = (source, target, lang = 'en') => checkField({ lang, risk: 'normal', source, target }).critical;
    expect(ok('Ouvert de 9h à 12h30, 1 234,56 € avant le 31 mars 2026.', 'Open 9:00–12:30, €1,234.56 before 31 March 2026.')).toEqual([]);
    expect(ok('De 16 à 25 ans.', 'Aged 16 to 26.')).toEqual(['numbers']);
    expect(ok('Voir https://www.caf.fr.', 'See https://www.caf.com.')).toEqual(['links']);
    expect(ok('Vous pouvez peut-être en bénéficier.', 'You are entitled to it.')).toEqual(['entitlement']);
    expect(ok('Vous pouvez peut-être en bénéficier.', 'يحق لك الحصول عليها.', 'ar')).toEqual(['entitlement']);
    expect(ok('Les aides de la CAF pour les jeunes de 16 à 25 ans.', 'Les aides de la CAF pour les jeunes de 16 à 25 ans.', 'ar')).toEqual(['untranslated']);
    expect(checkField({ lang: 'en', risk: 'normal', source: 'a', target: 'b', missing: ['[[T1]]'] }).critical).toContain('names');
  });
  it('use the back-translation to catch a lost negation or uncertainty: blocking for high-risk fields, a warning otherwise', () => {
    const high = checkField({ lang: 'en', risk: 'high', source: 'Ce n’est pas automatique.', target: 'It is automatic.', back: 'C’est automatique.' });
    expect(high.critical).toContain('negation');
    const normal = checkField({ lang: 'en', risk: 'normal', source: 'Vous pouvez peut-être en bénéficier.', target: 'You benefit.', back: 'Vous en bénéficiez.' });
    expect(normal.critical).toEqual([]); expect(normal.warnings).toContain('modality');
    expect(fieldStatus(normal, 'normal')).toBe('auto_checked');
    expect(fieldStatus(normal, 'high')).toBe('withheld');
    expect(chrF('le chat est noir', 'le chat est noir')).toBe(100);
  });
});

describe('publication decision', () => {
  const file = (over = {}) => ({ schema: SCHEMA, kind: 'aide', slug: 'apl', source: { hash: sourceHash('aide', aide) },
    translations: { en: { engine: 'ollama:translategemma:4b', translatedAt: '2026-11-01T08:00:00Z', fields: {
      titre: { text: 'Personalised housing allowance (APL)', status: 'auto_checked' },
      pour_qui: { text: '- Tenants\n- Automatic', status: 'withheld' },
      etapes: { text: ['Simulate', 'Apply'], status: 'machine_draft' } }, ...over } } });
  it('returns only the fields that passed, and nothing at all once the French text has changed', () => {
    const v = publicView(file(), 'en', 'aide', aide);
    expect(v.status).toBe('partial');
    expect(v.fields).toEqual({ titre: 'Personalised housing allowance (APL)' });
    expect(v.fieldStatus).toEqual({ titre: 'auto_checked', pour_qui: 'withheld', etapes: 'machine_draft' });
    const changed = publicView(file(), 'en', 'aide', { ...aide, cest_quoi: 'Texte modifié.' });
    expect(changed).toMatchObject({ status: 'outdated', fields: {} });
    expect(publicView(file(), 'tr', 'aide', aide).status).toBe('unavailable');
    expect(publicView(file({ withheld: true }), 'en', 'aide', aide)).toMatchObject({ status: 'withheld', fields: {} });
  });
  it('calls a translation « reviewed by a person » only when every shown field has a recorded human review', () => {
    expect(recordStatus({ fields: { a: { text: 'x', status: 'auto_checked' } } })).toBe('auto_checked');
    expect(recordStatus({ fields: { a: { text: 'x', status: 'human_reviewed' }, b: { text: 'y', status: 'auto_checked' } } })).toBe('auto_checked');
    expect(recordStatus({ fields: { a: { text: 'x', status: 'human_reviewed' } } })).toBe('human_reviewed');
    expect(fieldStatus({ critical: [], warnings: [] }, 'high', false)).toBe('auto_checked');
    expect(fieldStatus(null, 'high')).toBe('machine_draft');
  });
});
