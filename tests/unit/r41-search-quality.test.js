/**
 * R41 — the six cases Production still failed after R40 (201/207). Each root cause was traced through the real pipeline (cross-language → crisis signal →
 * search words → best-match word plan), on the published catalogue:
 *  - « aide pour payer la nounou »: the only meaningful word, « nounou », is in no record; the sheet F38243 says « mode de garde ».
 *  - « Schwerbehindertenausweis », « بطاقة الإعاقة »: a disability CARD was translated to « handicap » alone; the CMI sheet (F34049) never says
 *    « handicap », so the carers' leave sheet (F16920) came first.
 *  - « combien de temps garder ses papiers »: « temps » matched « en même temps » in the lost / stolen papers sheets; F19134 says « durée de conservation ».
 *  - « dépression qui consulter »: « dépression » is in no record (F34917, psychologue / psychiatre, says « santé mentale »).
 *  - « mutuelle pas chère »: the C2S aide never says « mutuelle »; the public complementary insurance for modest incomes is the C2S.
 * The fixes are equivalences of meaning (everyday words → the official expression), never a route to one record, and the crisis signal is unchanged.
 */
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/db/index.js', () => ({ db: {} }));
const { searchWords, wordTerms, foldAccents } = await import('../../api/lib/search-query.js');
const { lexicalTerms } = await import('../../api/lib/hybrid-search.js');
const { safetySignal } = await import('../../api/lib/search-safety.js');
const { crossLanguageQuery } = await import('../../api/lib/search-crosslanguage.js');

/**
 * The guides' best-match rule of api/_handlers/search.js, in JS (same words, same terms, same order: title hits, then words matched): a record must
 * match the most words any record matches. Titles and intros below are the published Service-Public texts of the sheets involved.
 */
const SHEETS = [
  ['F38243', 'Vous avez trouvé un mode de garde pour votre enfant : aides financières', "Si vous avez trouvé un mode de garde pour votre enfant, vous pouvez bénéficier d'aides financières, sous certaines conditions. garde d’enfants"],
  ['F34049', 'Carte mobilité inclusion (CMI)', 'La CMI permet de faciliter les déplacements des personnes en perte d’autonomie en leur donnant des droits (ex : accès prioritaire, facilités de stationnement) mobilité'],
  ['F16920', 'Congé de proche aidant', "Le congé de proche aidant permet au salarié de s'occuper d'une personne handicapée ou âgée ou en perte d'autonomie. proche aidant aidants congé"],
  ['F19134', 'Durée de conservation des papiers', 'Il est prudent de conserver certains papiers de la vie courante (impôts, logement, travail …) pendant une durée minimale, variable selon les documents. papiers'],
  ['F31421', "Que faire en cas de perte de tous ses papiers d'identité en même temps ?", 'Si vous avez perdu tous vos papiers en même temps, vous devez d’abord demander une nouvelle carte d’identité ou un nouveau passeport. papiers urgence'],
  ['F10774', "Que faire en cas de vol de tous ses papiers d'identité en même temps ?", "Si tous vos papiers d'identité ont été volés en même temps, vous devez d'abord demander une nouvelle carte d'identité ou un nouveau passeport. papiers urgence"],
  ['F34917', "Consultation d'un psychologue ou d'un psychiatre : quelle prise en charge ?", 'Les consultations chez un psychologue ou un psychiatre ne sont pas remboursées de la même manière. santé mentale'],
  ['F33954', "Numéros d'urgence et d'écoute", "Des numéros d'urgence et d'écoute existent. numéro écoute suicide urgence"],
];
const isShort = (t) => t.length <= 3 && !t.includes(' ');
const has = (text, t) => (isShort(t) ? new RegExp(`(?<![a-z0-9_])${t}(?![a-z0-9_])`).test(text) : text.includes(t));
function topGuides(query) {
  const words = searchWords(query);
  if (!words.length) return [];
  const scored = SHEETS.map(([id, title, body]) => {
    const all = foldAccents(`${title} ${body}`); const tt = foldAccents(title);
    return { id, mc: words.filter((w) => wordTerms(w).some((t) => has(all, t))).length, th: words.filter((w) => wordTerms(w).some((t) => has(tt, t))).length };
  });
  const best = Math.max(1, ...scored.map((s) => s.mc));
  return scored.filter((s) => s.mc >= best).sort((a, b) => b.th - a.th || b.mc - a.mc).map((s) => s.id);
}

describe('R41 — fa-3: a childminder is a « mode de garde »', () => {
  it('« nounou » / « nourrice » search the official expressions', () => {
    expect(searchWords('aide pour payer la nounou')).toEqual(['mode de garde', 'assistante maternelle']);
    expect(searchWords('payer une nourrice')).toEqual(['mode de garde', 'assistante maternelle']);
    expect(lexicalTerms('aide pour payer la nounou')).toEqual({ singles: '', phrases: ['mode de garde', 'assistante maternelle'] });
    expect(topGuides('aide pour payer la nounou')).toEqual(['F38243']);
  });
});

describe('R41 — di-6 / di-8: a disability card, in another language, finds the French card (CMI) without being called equivalent', () => {
  it.each([
    ['Schwerbehindertenausweis', 'de'], ['Behindertenausweis beantragen', 'de'], ['بطاقة الإعاقة', 'ar'], ['بطاقة معاق', 'ar'], ['disability card', 'en'],
    ['blue badge parking', 'en'], ['engelli kartı', 'tr'], ['посвідчення особи з інвалідністю', 'uk'],
  ])('%s (%s) → carte mobilité inclusion → F34049', (q, l) => {
    const fr = crossLanguageQuery(q, l).query;
    expect(fr.startsWith('carte mobilité inclusion')).toBe(true);
    expect(topGuides(fr)[0]).toBe('F34049');
  });
  it('the French name is one expression (its words alone found the « carte de séjour » démarches)', () => {
    expect(searchWords('carte mobilité inclusion')).toEqual(['carte mobilite inclusion']);
    expect(searchWords('carte de mobilité inclusion stationnement')).toEqual(['carte mobilite inclusion', 'stationnement']);
  });
  it('a disability alone is still « handicap », a residence card still a residence permit, an identity card still papers', () => {
    expect(crossLanguageQuery('Behinderung', 'de').query).toBe('handicap');
    expect(crossLanguageQuery('engelli maaşı', 'tr').query).toBe('handicap maaşı');
    expect(crossLanguageQuery('بطاقة الإقامة', 'ar').query).toBe('titre de séjour');
    expect(crossLanguageQuery('identity card', 'en').query).toBe('papiers');
  });
  it('the vocabulary says it only finds the French sheet: no equivalence of a foreign card is stated', () => {
    const c = JSON.parse(fs.readFileSync('data/i18n/search-lexicon.json', 'utf8')).concepts.find((x) => x.id === 'disability-card');
    expect(c.fr).toBe('carte mobilité inclusion');
    expect(c.note).toMatch(/never says that a foreign card .* is equivalent/);
  });
});

describe('R41 — pr-5: how long to keep papers is the « durée de conservation »', () => {
  it.each(['combien de temps garder ses papiers', 'pendant combien de temps faut-il conserver ses factures', "jusqu'à quand garder mes fiches de paie", 'combien de temps dois-je garder mes papiers'])('« %s »', (q) => {
    expect(searchWords(q)[0]).toBe('duree de conservation');
  });
  it('F19134 first, not the lost / stolen papers sheets (« en même temps »)', () => {
    expect(topGuides('combien de temps garder ses papiers')).toEqual(['F19134']);
    expect(topGuides("j'ai perdu tous mes papiers")[0]).toBe('F31421');
    expect(searchWords('perdu mes papiers en même temps')).not.toContain('duree de conservation');
  });
});

describe('R41 — mh-6: depression → which professional, not a crisis', () => {
  it('« dépression » is « santé mentale » (« consulter » is left as is: as a synonym « consultation » it also brought family-counselling places (EVARS) into the places section)', () => {
    expect(searchWords('dépression qui consulter')).toEqual(['sante mentale', 'consulter']);
    expect(searchWords('je suis déprimée')).toEqual(['sante mentale']);
    expect(wordTerms('consulter')).not.toContain('consultation');
    expect(topGuides('dépression qui consulter')).toEqual(['F34917']);
  });
  it.each(['dépression qui consulter', 'je suis déprimé', 'mon fils est dépressif', 'dépression post-partum', 'depression psychologue remboursé'])('« %s » shows no emergency number', (q) => {
    expect(safetySignal(q)).toBeNull();
  });
  it.each(['je suis en dépression et je veux mourir', 'dépression, je pense au suicide', "ma fille est en dépression elle parle de se tuer", 'depressed and I want to kill myself', 'депресія, не хочу жити'])('« %s » → 3114 first', (q) => {
    expect(safetySignal(q)?.numbers[0]).toBe('3114');
  });
});

describe('R41 — ev-3: a cheap complementary insurance → the C2S, the general démarche kept', () => {
  it('the price words become the C2S expression, « mutuelle » stays', () => {
    expect(searchWords('mutuelle pas chère')).toEqual(['mutuelle', 'complementaire sante solidaire']);
    expect(searchWords('mutuelle gratuite')).toEqual(['mutuelle', 'complementaire sante solidaire']);
    expect(lexicalTerms('mutuelle pas chère')).toEqual({ singles: 'mutuelle', phrases: ['complementaire sante solidaire'] });
  });
  it('« mutuelle » alone or with another need is not rewritten', () => {
    expect(searchWords('mutuelle')).toEqual(['mutuelle']);
    expect(searchWords('changer de mutuelle')).toEqual(['changer', 'mutuelle']);
  });
});

describe('R41 — the crisis signal is unchanged around the new expressions', () => {
  it.each([
    ['je veux mourir', 'suicide'], ["je n'en peux plus de ma dépression je veux en finir", 'suicide'], ['mon ami veut se suicider', 'suicide'],
    ['I want to end my life', 'suicide'], ['أريد أن أنتحر', 'suicide'], ['хочу покінчити з собою', 'suicide'], ['не хочу жити', 'suicide'],
    ['mon copain me frappe', 'violence'], ['je suis à la rue ce soir avec mes enfants', 'sans-abri'],
  ])('« %s » → %s', (q, kind) => expect(safetySignal(q)?.kind).toBe(kind));
  it.each([
    'statistiques suicide France', 'histoire du suicide Durkheim', 'suicide assisté loi', 'taux de dépression chez les jeunes', 'mourir de rire',
    'je meurs de faim', "c'est à mourir d'ennui", 'tuer le temps', 'نسبة الانتحار في فرنسا قانون', 'статистика самогубств закон',
  ])('« %s » is not a crisis', (q) => expect(safetySignal(q)).toBeNull());
});

describe('R41 — two crisis errors found by the extended check (present since before R41)', () => {
  const signal = (q, l) => { const c = crossLanguageQuery(q, l); return safetySignal(q, c.changed ? c.query : '')?.kind || null; };
  it.each([['صديقي يريد أن ينتحر'], ['ابني يريد أن ينتحر'], ['أختي تنتحر'], ['سأنتحر'], ['أنتحر'], ['أريد الانتحار']])('Arabic « %s » → 3114 (the verb in every person)', (q) => {
    expect(signal(q, 'ar')).toBe('suicide');
  });
  it('words that only share letters with the verb are not a crisis', () => {
    for (const q of ['انتخابات', 'منتخب']) expect(signal(q, 'ar'), q).toBeNull();
  });
  it('a query AS TYPED about suicide as a subject is not overridden by its translation (which drops the unknown « статистика », « закон »)', () => {
    expect(crossLanguageQuery('статистика самогубств закон', 'uk').query).toBe('numéro écoute suicide');
    expect(signal('статистика самогубств закон', 'uk')).toBeNull();
    expect(signal('قانون الانتحار', 'ar')).toBeNull();
    expect(signal('intihar yasası', 'tr')).toBeNull();
  });
  it('distress in the query as typed keeps the number, whatever its translation', () => {
    expect(signal('закон про самогубство я хочу покінчити з собою', 'uk')).toBe('suicide');
    expect(signal('самогубство', 'uk')).toBe('suicide');
    expect(signal('intihar etmek istiyorum', 'tr')).toBe('suicide');
    expect(signal('my friend wants to kill himself', 'en')).toBe('suicide');
  });
});
