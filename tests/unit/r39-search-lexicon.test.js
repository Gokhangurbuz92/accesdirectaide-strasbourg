// R39 (H) — multilingual search gaps measured in Production (17/25): « abortion » had no concept in any language, « housing benefit » went to « rent »,
// the Ukrainian « рахунок » (a bill, or an account) always meant « compte bancaire », and suicide prevention found a psychologist instead of the 3114 sheet.
import { describe, expect, it } from 'vitest';
import { crossLanguageQuery } from '../../api/lib/search-crosslanguage.js';
const { searchWords } = await import('../../api/lib/search-query.js');

describe('R39 lexicon', () => {
  it.each([['abortion', 'en'], ['kürtaj', 'tr'], ['الإجهاض', 'ar'], ['Abtreibung', 'de'], ['аборт', 'uk']])('%s (%s) → IVG', (q, l) => { expect(crossLanguageQuery(q, l).query).toBe('IVG'); });
  it('housing benefit → the housing-aid sheets, rent stays rent', () => {
    expect(crossLanguageQuery('housing benefit to pay my rent', 'en').query).toContain('allocation logement');
    expect(crossLanguageQuery('kira yardımı', 'tr').query).toBe('loyer');
  });
  it('« рахунок » alone is no longer a bank account; « банківський рахунок » still is', () => {
    expect(crossLanguageQuery('неоплачений рахунок за електрику', 'uk').query).toBe('énergie');
    expect(crossLanguageQuery('банківський рахунок', 'uk').query).toBe('compte bancaire');
  });
  it('suicide prevention → the national listening line (F33954), in French too', () => {
    expect(crossLanguageQuery('suicide prevention helpline', 'en').query).toContain('numéro écoute suicide');
    expect(searchWords('prévention du suicide')).toEqual(['numero', 'ecoute', 'suicide']);
  });
});
