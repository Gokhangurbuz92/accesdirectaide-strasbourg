/**
 * Catalogue (12/11/2026): the classification of a Service-Public fiche, the Level 1 official content (Licence Ouverte 2.0 attribution, no text written,
 * FALC pending), the category aliases of the public filters, the public payload (the official text on a detail view only).
 */
import { describe, expect, it } from 'vitest';
import { classifyFiche, canonicalCategory, categoryVariants, TAXONOMY_CATEGORIES } from '../../api/_services/verification/classify.js';
import { officialContent, officialPatch, officialLead, plausibleDay, OFFICIAL_TEXT_MAX } from '../../api/_services/verification/chain.js';
import { publicAutoCheck, publicOfficial } from '../../api/lib/publicVisibility.js';
import { officialBlocks } from '../../src/lib/officialBlocks.js';

const path = (theme, ...rest) => [{ id: 'Particuliers', title: 'Accueil particuliers' }, { id: 'N1', title: theme }, ...rest.map((t, i) => ({ id: `N${i + 2}`, title: t }))];
const meta = (title, theme, extra = {}) => ({ id: 'F1', kind: "Fiche d'information conditionnée", title, description: '', coverage: 'France entière', path: [...path(theme), { id: 'F1', title }], ...extra });

describe('classification of a Service-Public fiche', () => {
  it('a benefit with an amount chapter is an aide; its category follows the reference (APL → logement)', () => {
    const c = classifyFiche(meta('Aide personnalisée au logement (APL)', 'Logement'), { text: '## Conditions\n## Montant\n', online: [] });
    expect(c).toMatchObject({ ok: true, kind: 'aide', categorie: 'logement', domain: 'logement', subdomain: 'aides-logement' });
    expect(c.reasons.join(' ')).toMatch(/thème Service-Public « Logement »/);
  });
  it('a procedure with an online service is a démarche', () => {
    const c = classifyFiche(meta("Carte d'identité : demande", 'Papiers - Citoyenneté - Élections'), { text: '## Démarche\n', online: [{ type: 'Téléservice', title: 'Pré-demande' }] });
    expect(c).toMatchObject({ ok: true, kind: 'demarche', categorie: 'papiers-citoyennete' });
  });
  it('an explanation that is neither is a dispositif / guide; a leave is never an aide', () => {
    expect(classifyFiche(meta('Congé parental dans la fonction publique', 'Travail - Formation'), { text: '## Durée\n', online: [] }).kind).toBe('dispositif');
  });
  it('the handicap subdomain decides the category over the Service-Public theme', () => {
    expect(classifyFiche(meta('Allocation aux adultes handicapés (AAH)', 'Social - Santé'), { text: '## Montant\n' })).toMatchObject({ kind: 'aide', categorie: 'handicap', domain: 'handicap' });
  });
  it('« Impôt sur le revenu » is not a minimum income (generic keyword ignored)', () => {
    expect(classifyFiche(meta('Impôt sur le revenu - Dons aux associations', 'Argent - Impôts - Consommation')).subdomain).not.toBe('minima-sociaux');
  });
  it('no invented placement: an unmapped theme, a question-answer, another territory are PENDING with their reason', () => {
    expect(classifyFiche(meta('Créer une association', 'Associations, fondations et fonds de dotation'))).toMatchObject({ ok: false, pending: 'THEME_UNMAPPED' });
    expect(classifyFiche({ ...meta('Peut-on… ?', 'Logement'), kind: 'Fiche Question-réponse conditionnée' })).toMatchObject({ ok: false, pending: 'NOT_A_CATALOGUE_KIND' });
    expect(classifyFiche(meta('Aide outre-mer', 'Logement', { coverage: 'Guadeloupe' }))).toMatchObject({ ok: false, pending: 'COVERAGE_ELSEWHERE' });
  });
});

describe('the category filters', () => {
  it('every legacy value of the catalogue maps to a public category (8 of 16 Production aides matched no chip)', () => {
    for (const v of ['social', 'santé', 'social-sante', 'mobilite', 'credit', 'budget', 'logement']) expect(TAXONOMY_CATEGORIES).toContain(canonicalCategory(v));
    expect(categoryVariants('social-sante')).toEqual(expect.arrayContaining(['social-sante', 'social', 'santé']));
    expect(categoryVariants('transports')).toContain('mobilite');
    expect(canonicalCategory('n-importe')).toBeNull();
  });
});

describe('Level 1: the official fiche as it is', () => {
  const src = { id: 'F12', title: 'Une fiche', description: 'La description officielle de la fiche, assez longue pour être montrée.', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12',
    text: '## Conditions\n- Avoir 18 ans\nMontant | 100 €\n', fingerprint: 'abc', importantChangeAt: '2620-05-01', modifiedAt: '2026-11-10', online: [{ title: 'Faire la demande', url: 'https://x.gouv.fr/a', type: 'Téléservice' }, { title: 'http', url: 'http://insecure' }], references: [] };
  it('carries the attribution the Licence Ouverte 2.0 and the DILA ask: publisher, licence, file, its date, the fiche address — and no impossible date', () => {
    const o = officialContent(src, 'F12', { builtAt: '2026-11-11' });
    expect(o).toMatchObject({ mode: 'OFFICIAL_SOURCE', publisher: 'Service-Public.gouv.fr / DILA', licence: 'Licence Ouverte 2.0 (Etalab)', sourceId: 'F12', url: src.url, truncated: false,
      archive: { file: 'vosdroits-latest.zip', date: '2026-11-11' }, importantChangeAt: null, modifiedAt: '2026-11-10' });
    expect(o.archive.url).toMatch(/^https:\/\/lecomarquage\.service-public\.gouv\.fr\//);
    expect(o.online).toHaveLength(1);
    expect(plausibleDay('0002-03-22')).toBeNull();
  });
  it('a long fiche is cut at a heading and says so', () => {
    const long = { ...src, text: `${'Paragraphe. '.repeat(3000)}\n## Suite\n${'x '.repeat(30000)}` };
    const o = officialContent(long, 'F12', null);
    expect(o.truncated).toBe(true); expect(o.text.length).toBeLessThanOrEqual(OFFICIAL_TEXT_MAX); expect(o.chars).toBe(long.text.length);
  });
  it('writes no text: the card lead is the fiche\'s own description, quoted and attributed; FALC fields are empty', () => {
    expect(officialLead(src)).toBe('Résumé officiel (Service-Public.gouv.fr) : « La description officielle de la fiche, assez longue pour être montrée. »');
    const p = officialPatch('aide', src);
    expect(p).toMatchObject({ summary_falc: null, conditions_falc: null, falc_origin: null, montant_falc: null, pour_qui: null, etapes: [] });
    expect(officialPatch('demarche', src)).toMatchObject({ description_courte: officialLead(src), summary_falc: null });
  });
  it('the official text is public on a detail view only; a list says that there is one', () => {
    const a = { checkedAt: '2026-11-12', texts: { mode: 'OFFICIAL_SOURCE', at: '2026-11-12' }, official: officialContent(src, 'F12', null) };
    expect(publicAutoCheck(a, { detail: true })).toMatchObject({ textsMode: 'OFFICIAL_SOURCE', falcPending: true, official: { sourceId: 'F12', text: expect.stringContaining('Avoir 18 ans') } });
    const list = publicAutoCheck(a);
    expect(list.official).toBeUndefined(); expect(list.hasOfficial).toBe(true);
    expect(publicOfficial({ mode: 'OTHER', text: 'x' })).toBeNull();
  });
  it('the page renders headings, lists and table rows as text blocks (never HTML)', () => {
    expect(officialBlocks('## Titre\n- a\n- b\nx | y\n<b>gras</b>')).toEqual([{ type: 'h3', text: 'Titre' }, { type: 'ul', items: ['a', 'b'] }, { type: 'table', rows: [['x', 'y']] }, { type: 'p', text: '<b>gras</b>' }]);
  });
});
