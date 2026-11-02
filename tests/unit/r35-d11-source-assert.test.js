import { describe, it, expect } from 'vitest';
import { numbersIn, canonicalNumber, quotesIn, assessItems, splitCitations } from '../../scripts/d11-source-assert.mjs';
import { validatedRight } from '../../api/lib/validatedRules.js';

// R35 (§8, D11): the rule-source assertion harness checks numbers, quotes, fiche dates and legal bases against official texts — and decides nothing.
const fiche = (id, body, changed = '2026-01-01') => `<?xml version="1.0"?><Publication xmlns:dc="http://purl.org/dc/elements/1.1/" ID="${id}" type="Fiche Question-réponse" spUrl="https://www.service-public.gouv.fr/particuliers/vosdroits/${id}" dateDerniereModificationImportante="${changed}"><dc:title>T</dc:title><Texte><Paragraphe>${body}</Paragraphe></Texte></Publication>`;
const register = (conditions, consultedAt = '2026-10-21') => ({
  consultedAt, rights: [{ id: 'aah', status: 'RESEARCHED_UNVALIDATED', expertReview: null, referenceCases: [], sources: [{ url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F1234', consultedAt }], conditions }],
});
const legal = (etat = 'VIGUEUR', dateFin = '2999-01-01') => ({ references: [{ right: 'aah', resolved: [{ code: 'CSS', num: 'L821-1', etat, dateDebut: '2020-01-01', dateFin }] }] });
const run = ({ body = 'Plafond annuel : 12 499 € pour une personne seule. Vous devez avoir au moins 20 ans.', changed, conditions, cases = [], form, redirections = new Map(), fiches, legalData = legal() , livePages = null} = {}) => assessItems({
  register: register(conditions || [{ fact: 'resources', text: 'plafond 12 499 € sans enfant', source: 'F1234', draftCheck: { kind: 'max', max: 12499 } }]),
  cases: { cases },
  legal: legalData,
  form: form || [{ right: 'aah', item_type: 'condition', item_id: 'resources', text: '' }],
  archive: { fiches: fiches || new Map([['F1234', fiche('F1234', body, changed)]]), redirections },
  referenceDate: '2026-11-02',
  livePages,
});

describe('R35 D11 number reading', () => {
  it('reads French numbers with every thousands separator and keeps 112 499 apart from 12 499', () => {
    expect([...numbersIn('12 499 €, 12 499 €, 12 499 €, 12499 €, 12 499,00 €')]).toEqual(['12499']);
    expect(numbersIn('112 499 €').has('12499')).toBe(false);
    expect(numbersIn('651,69 €').has('651,69')).toBe(true);
    expect(canonicalNumber('3 214')).toBe('3214');
    expect(quotesIn('F2882 « 18 ans ou plus » : 18 inclus')).toEqual(['18 ans ou plus']);
  });
});

describe('R35 D11 source assertions', () => {
  it('confirms a ceiling the fiche states (narrow no-break space) and a quoted phrase', () => {
    const r = run({ cases: [{ id: 'aah-age-20', basis: 'F1234 « au moins 20 ans »' }], form: [{ right: 'aah', item_type: 'condition', item_id: 'resources', text: '' }, { right: 'aah', item_type: 'case', item_id: 'aah-age-20', text: '' }] });
    expect(r.rows.map((x) => x.verdict)).toEqual(['TEXT_CONFIRMED', 'TEXT_CONFIRMED']);
  });

  it('a changed figure, a paraphrased quote, a later DILA change date or a redirection is reported', () => {
    expect(run({ body: 'Plafond annuel : 12 600 €.' }).rows[0].verdict).toBe('NUMBER_NOT_FOUND');
    expect(run({ cases: [{ id: 'c', basis: 'F1234 « 20 ans ou plus »' }], form: [{ right: 'aah', item_type: 'case', item_id: 'c', text: '' }] }).rows[0].verdict).toBe('QUOTE_NOT_FOUND');
    expect(run({ changed: '2026-10-30' }).rows[0].verdict).toBe('SOURCE_REVISED');
    const moved = run({ fiches: new Map([['F9876', fiche('F9876', 'Plafond 12 499 €')]]), redirections: new Map([['F1234', 'F9876']]) });
    expect(moved.rows[0]).toMatchObject({ verdict: 'FICHE_REDIRECTED' });
    expect(run({ fiches: new Map() }).rows[0].verdict).toBe('FICHE_MISSING');
  });

  it('a source outside the archive, an ambiguity and an unquoted case are never machine-confirmed', () => {
    const r = run({
      conditions: [{ fact: 'age', text: '16 à 25 ans', source: 'strasbourg.eu' }],
      cases: [{ id: 'u', basis: 'conditions non lisibles' }],
      form: [{ right: 'aah', item_type: 'condition', item_id: 'age', text: '' }, { right: 'aah', item_type: 'ambiguity', item_id: '1', text: 'Montant 12 499 € sans date d’effet' }, { right: 'aah', item_type: 'case', item_id: 'u', text: '' }],
    });
    expect(r.rows.map((x) => x.verdict)).toEqual(['NO_ARCHIVE_SOURCE', 'NOT_MACHINE_CHECKABLE', 'NOT_MACHINE_CHECKABLE']);
    expect(r.rows[1].checks[0]).toMatchObject({ check: 'figure 12499 (information only)', result: 'FOUND' });
  });

  it('reports a legal basis no longer in force', () => {
    expect(run().legalBasis.aah).toMatchObject({ articles: 1, inForce: 1, notInForce: [], repealScheduled: [] });
    expect(run({ legalData: legal('ABROGE_DIFF', '2222-02-22') }).legalBasis.aah).toMatchObject({ inForce: 1, repealScheduled: ['CSS L821-1 (repeal scheduled 2222-02-22)'] });
    expect(run({ legalData: legal('ABROGE') }).legalBasis.aah.inForce).toBe(0);
    expect(run({ legalData: legal('VIGUEUR', '2026-06-01') }).legalBasis.aah.notInForce).toHaveLength(1);
  });

  it('R35: a cited legal text is checked against the legal basis, not read as thresholds', () => {
    expect(splitCitations('barème : arrêté du 27 septembre 2019, non reproduit').citations).toEqual(['arrêté du 27 septembre 2019']);
    const withOrder = { references: [{ right: 'aah', basis: 'Arrêté du 27 septembre 2019', resolved: [{ code: '', num: 'Arrêté du 27 septembre 2019 relatif au calcul', etat: 'VIGUEUR', dateDebut: '2019-10-01', dateFin: '2999-01-01' }] }] };
    const cond = [{ fact: 'resources', text: 'plafond 12 499 € (barème : arrêté du 27 septembre 2019)', source: 'F1234' }];
    const ok = run({ conditions: cond, legalData: withOrder });
    expect(ok.rows[0].verdict).toBe('TEXT_CONFIRMED');
    expect(ok.rows[0].checks.map((c) => c.check)).not.toContain('number 2019');
    expect(run({ conditions: cond }).rows[0].verdict).toBe('CITATION_NOT_IN_LEGI');
  });

  it('R35 --live: a source outside the archive is checked on the page read once (hash and date only)', () => {
    const page = { url: 'https://www.strasbourg.eu/x', fetchedAt: '2026-11-02T11:00:00Z', sha256: 'a'.repeat(64), flat: 'le fonds s’adresse aux jeunes de 16 à 25 ans'.replace('’', "'"), numbers: numbersIn('16 à 25 ans') };
    const conditions = [{ fact: 'age', text: '16 à 25 ans', source: 'strasbourg.eu' }];
    const cases = [{ id: 'f', basis: 'strasbourg.eu « 16 à 25 ans »' }, { id: 'g', basis: 'strasbourg.eu « 18 à 30 ans »' }];
    const form = [{ right: 'aah', item_type: 'condition', item_id: 'age', text: '' }, { right: 'aah', item_type: 'case', item_id: 'f', text: '' }, { right: 'aah', item_type: 'case', item_id: 'g', text: '' }];
    const r = run({ conditions, cases, form, livePages: new Map([['aah', page]]) });
    expect(r.rows.map((x) => x.verdict)).toEqual(['LIVE_PAGE_CONFIRMED', 'LIVE_PAGE_CONFIRMED', 'QUOTE_NOT_FOUND']);
    expect(run({ conditions, cases, form }).rows.map((x) => x.verdict)).toEqual(['NO_ARCHIVE_SOURCE', 'NOT_MACHINE_CHECKABLE', 'NOT_MACHINE_CHECKABLE']);
  });

  it('an all-confirmed report validates nothing: the expert gate stays closed', () => {
    const reg = register([{ fact: 'resources', text: 'plafond 12 499 €', source: 'F1234' }]);
    expect(run().summary).toEqual({ TEXT_CONFIRMED: 1 });
    expect(validatedRight(reg, 'aah')).toBeNull();
    expect(reg.rights[0].status).toBe('RESEARCHED_UNVALIDATED');
  });
});
