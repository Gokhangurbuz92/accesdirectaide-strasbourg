// R38 (F3) — the multi-need orientation in the six interface languages: the person's own words (and their French translation by the cross-language
// search) reach the same needs as in French, the urgent ones first; Arabic words with attached prefixes and Cyrillic stems are found; no false positive.
import { describe, expect, it } from 'vitest';
import { analyseNeeds } from '../../api/lib/multi-need.js';
import { crossLanguageQuery } from '../../api/lib/search-crosslanguage.js';

const ids = (q, lang) => (analyseNeeds([q, crossLanguageQuery(q, lang).query]) || { needs: [] }).needs.map((n) => n.id);
const cautions = (q, lang) => (analyseNeeds([q, crossLanguageQuery(q, lang).query]) || { cautions: [] }).cautions.map((c) => c.id);
const CASES = {
  en: ['I have debts and they will cut off my electricity', 'I have no residence permit and nowhere to sleep', 'I want to kill myself', 'my husband hits me and I must leave home'],
  tr: ['Borçlarım var ve elektriğimi kesecekler', 'Oturum iznim yok ve kalacak yerim yok', 'intihar etmek istiyorum', 'kocam beni dövüyor'],
  ar: ['عندي ديون وسيقطعون الكهرباء', 'ليس لدي أوراق ولا مكان أنام فيه', 'أفكر في الانتحار', 'زوجي يضربني'],
  de: ['Ich habe Schulden und mir wird der Strom abgestellt', 'Ich habe keinen Aufenthaltstitel und bin obdachlos', 'ich denke an Selbstmord', 'mein Mann schlägt mich'],
  uk: ['У мене борги і мені відключать електрику', 'У мене немає документів і житла', 'я думаю про самогубство', "чоловік мене б'є"],
};
describe.each(Object.entries(CASES))('orientation in %s', (lang, [energy, noPermitNoHome, crisis, violence]) => {
  it('debts + electricity cut → energie, surendettement', () => { expect(ids(energy, lang)).toEqual(['energie', 'surendettement']); });
  it('no permit + no home → accommodation first, rights without a permit, with the housing-aid cautions', () => {
    expect(ids(noPermitNoHome, lang)).toEqual(['hebergement-urgence', 'droits-sans-titre']);
    expect(cautions(noPermitNoHome, lang)).toEqual(expect.arrayContaining(['permit-housing-aid', 'no-home-housing-aid']));
  });
  it('suicidal words → crise-suicide (3114)', () => { expect(ids(crisis, lang)[0]).toBe('crise-suicide'); });
  it('a violent partner → violences-conjugales first', () => { expect(ids(violence, lang)[0]).toBe('violences-conjugales'); });
});
describe('no false positive in the other languages', () => {
  it.each([['uk', 'шукаю житло в Страсбурзі'], ['en', 'opening hours of the town hall'], ['tr', 'kimlik kartı yenileme'], ['ar', 'تجديد بطاقة الهوية'], ['de', 'Personalausweis verlängern'], ['uk', 'поновити паспорт'],
    ['en', 'pay my electricity bill online'], ['de', 'Wohnung in Strasbourg suchen']])('%s « %s »', (lang, q) => { expect(ids(q, lang)).not.toContain('crise-suicide'); expect(ids(q, lang)).not.toContain('violences-conjugales'); expect(ids(q, lang)).not.toContain('hebergement-urgence'); });
});
