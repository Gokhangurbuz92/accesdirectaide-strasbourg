/**
 * R40 — « aide active à mourir loi » listed the APL, the RSA and the ALS. Root cause, through the real pipeline: « aide » and « à » are stop words, so the
 * words searched were « active », « mourir », « loi »; the French stemmer reduces « loyer » to « loi » (french_stem: loyer → loi), so the aides' OR query
 * matched every rent aide, « active » matched « revenu de solidarité ACTIVE », and as substrings « loi » was in « emploi » and « active » in
 * « activité ». Nothing in the catalogue said « mourir ». The fix: legal words are not search words, the end-of-life debate is the official expression
 * « fin de vie » searched as one phrase, and a term of at most 3 letters matches whole words only. The crisis signal now reads WHO speaks: a wish to
 * die said by the person or about someone close always shows the 3114, a question about suicide as a subject (law, statistics, history) does not.
 */
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
vi.mock('../../src/db/index.js', () => ({ db: {} }));
const { searchWords, wordTerms, wordPlan, isShortTerm } = await import('../../api/lib/search-query.js');
const { lexicalTerms } = await import('../../api/lib/hybrid-search.js');
const { safetySignal } = await import('../../api/lib/search-safety.js');
const { crossLanguageQuery } = await import('../../api/lib/search-crosslanguage.js');
const { offTopicIntent } = await import('../../api/lib/search-off-topic.js');
const { CASES, judge } = await import('../../scripts/acceptance/r40-search-quality.mjs');

const render = (q) => new PgDialect().sqlToQuery(q);

describe('R40 — the words searched', () => {
  it('« aide active à mourir loi » searches the official expression « fin de vie », not « active » nor « loi »', () => {
    expect(searchWords('aide active à mourir loi')).toEqual(['fin de vie']);
    for (const q of ['suicide assisté loi', 'aide à mourir', 'euthanasie', 'mourir dans la dignité', 'aide médicale à mourir', 'la fin de vie']) expect(searchWords(q), q).toEqual(['fin de vie']);
  });
  it('a legal word says « a question about a law », it is not what the law is about (and « loi » is the stem of « loyer »)', () => {
    expect(searchWords('loi')).toEqual([]);
    expect(searchWords('loi DALO')).toEqual(['dalo']);
    expect(searchWords('décret sur les loyers')).toEqual(['loyers']);
  });
  it('an expression is matched as written, without the synonyms of its words', () => {
    expect(wordTerms('fin de vie')).toEqual(['fin de vie']);
    expect(wordTerms('loyers')).toContain('loyer');
  });
  it('the aides\' OR query keeps an expression as one phrase and searches nothing for function words only', () => {
    expect(lexicalTerms('aide active à mourir loi')).toEqual({ singles: '', phrases: ['fin de vie'] });
    expect(lexicalTerms('fin de contrat')).toEqual({ singles: 'fin contrat', phrases: [] });
    expect(lexicalTerms('loi')).toEqual({ singles: '', phrases: [] });   // it used to search the raw query: « loi » found « loyer »
  });
  it('a term of at most 3 letters matches a whole word; longer terms keep the substring match', () => {
    expect(isShortTerm('vie')).toBe(true);
    expect(isShortTerm('ame')).toBe(true);
    expect(isShortTerm('loyer')).toBe(false);
    expect(isShortTerm('fin de vie')).toBe(false);
    const { sql: text, params } = render(wordPlan('AME logement', ['"titre"'], '"titre"', false).matchCount);
    expect(params).toContain('\\mame\\M');
    expect(params).toContain('%logement%');
    expect(text).toMatch(/~ \$\d+/);
    expect(text).toMatch(/LIKE \$\d+/);
  });
});

describe('R40 — the crisis signal reads who speaks', () => {
  it.each([
    'je veux mourir', "j'ai envie de me suicider", 'mon ami veut se suicider', 'ma fille parle de se tuer', "je n'ai plus envie de vivre",
    "je veux qu'on m'aide à mourir", 'aidez-moi à mourir', 'je pense au suicide', 'suicide', 'prévention du suicide', 'tentative de suicide de mon fils',
    'my friend wants to kill himself', "I don't want to live anymore", 'I don’t want to live anymore', 'ich will nicht mehr leben', 'хочу покінчити з собою',
    'أريد أن أنتحر', 'intihar etmek istiyorum', 'je cherche des statistiques sur le suicide de mon frère',
    // R34 / R39 cases stay detected
    'je veux en finir', 'I want to kill myself', 'pensées suicidaires', 'ich habe Suizidgedanken', 'у мене суїцидальні думки', 'intihara meyilliyim', 'أنتحر',
  ])('« %s » → 3114', (q) => {
    const s = safetySignal(q);
    expect(s?.kind).toBe('suicide');
    expect(s?.numbers[0]).toBe('3114');
  });
  it.each([
    'aide active à mourir loi', 'suicide assisté loi', 'loi fin de vie 2026', 'statistiques suicide France', 'taux de suicide chez les jeunes',
    'histoire du suicide Durkheim', 'film sur le suicide', 'actualité suicide assisté Sénat', 'assisted suicide law', 'suicide statistics in France',
    'euthanasie Belgique loi', 'aide à mourir', 'euthanasie et suicide assisté',
  ])('« %s » is a question about a subject, not a crisis', (q) => expect(safetySignal(q)).toBeNull());
  it('the French translation of an end-of-life query is not a crisis either', () => {
    const cross = crossLanguageQuery('assisted suicide law', 'en');
    expect(cross.query).toBe('fin de vie');
    expect(safetySignal('assisted suicide law', cross.query)).toBeNull();
  });
  it('« мене б’є » (word order of Ukrainian) is violence too', () => {
    expect(safetySignal('чоловік мене б’є')?.kind).toBe('violence');
  });
});

describe('R40 — cross-language vocabulary', () => {
  it.each([
    ['assisted suicide law', 'en', 'fin de vie'], ['Sterbehilfe Gesetz', 'de', 'fin de vie'], ['ötanazi yasası', 'tr', 'fin de vie'], ['القتل الرحيم', 'ar', 'fin de vie'],
    ['закон про евтаназію', 'uk', 'fin de vie'], ['Zwangsräumung', 'de', 'expulsion'], ['виселення з квартири', 'uk', 'logement expulsion'],
    ['tek ebeveyn yardımı', 'tr', 'famille monoparentale'], ['alleinerziehend', 'de', 'famille monoparentale'], ['Schuldnerberatung', 'de', 'dettes'],
    ['Schwerbehindertenausweis', 'de', 'carte mobilité inclusion'] /* R41: the card, not the disability alone (the CMI sheet F34049) */, ['рахунок за газ', 'uk', 'énergie'], ['не можу оплатити рахунок за світло', 'uk', 'énergie'],
    ['банк відмовив відкрити рахунок', 'uk', 'compte bancaire'], ['oturma izni', 'tr', 'titre de séjour'],
  ])('%s (%s) → %s', (q, l, fr) => expect(crossLanguageQuery(q, l).query).toBe(fr));
  it('« without papers » is the French « sans papiers » (→ the AME sheet\'s « situation irrégulière »)', () => {
    const q = crossLanguageQuery('health insurance without documents', 'en').query;
    expect(q).toContain('sans papiers');
    expect(searchWords(q)).toContain('irreguliere');
  });
  it('« банківський рахунок » is still a bank account and « рахунок за електрику » still energy', () => {
    expect(crossLanguageQuery('банківський рахунок', 'uk').query).toBe('compte bancaire');
    expect(crossLanguageQuery('неоплачений рахунок за електрику', 'uk').query).toBe('énergie');
  });
});

describe('R40 — off-topic', () => {
  it('a gambling ban is a social need (Interdiction de jeux, F15814), a casino night is not', () => {
    expect(offTopicIntent('interdiction de casino')).toBeNull();
    expect(offTopicIntent('casino ce soir')).toEqual({ kind: 'leisure' });
  });
});

describe('R40 — the evaluation harness', () => {
  it('has more than 120 cases over the six languages, crisis false negatives and false positives included', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(120);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    for (const l of ['fr', 'en', 'tr', 'ar', 'de', 'uk']) expect(CASES.some((c) => c.lang === l), l).toBe(true);
    expect(CASES.filter((c) => c.cat === 'crisis-fn').length).toBeGreaterThanOrEqual(15);
    expect(CASES.filter((c) => c.cat === 'crisis-fp').length).toBeGreaterThanOrEqual(10);
  });
  it('every case agrees with the crisis signal of the code (the signal is pure: no catalogue needed)', () => {
    const kOk = (w, g) => (Array.isArray(w) ? w.includes(g) : (w ?? null) === (g ?? null));
    const wrong = CASES.filter((c) => {
      const cross = crossLanguageQuery(c.q, c.lang);
      return !kOk(c.safety, safetySignal(c.q, cross.changed ? cross.query : '')?.kind || null);
    }).map((c) => c.id);
    expect(wrong).toEqual([]);
  });
  it('judges top-3 expectations, forbidden results and the safety kind', () => {
    const c = { id: 'x', lang: 'fr', cat: 't', q: 'q', g: ['F1'], notA: ['apl'] };
    expect(judge(c, { guides: [{ slug: 'a-f2' }, { slug: 'b-f1' }], items: [] }).pass).toBe(true);
    expect(judge(c, { guides: [{ slug: 'b-f1' }], items: [{ slug: 'apl' }] }).fails).toEqual(['unrelated aides apl']);
    expect(judge(c, { guides: [{ slug: 'b-f1' }], safety: { kind: 'suicide' } }).pass).toBe(false);
    expect(judge({ ...c, safety: ['enfant', 'violence'] }, { guides: [{ slug: 'b-f1' }], safety: { kind: 'violence' } }).pass).toBe(true);
  });
});
