/**
 * R32 — cross-language search: realistic needs typed in the five target languages become French search words; a French query is never rewritten;
 * a query of which nothing is understood is left empty (the handler then abstains instead of listing every record).
 */
import { describe, expect, it } from 'vitest';
import { crossLanguageQuery, fold } from '../../api/lib/search-crosslanguage.js';
import { searchWords } from '../../api/lib/search-query.js';

const q = (s, lang) => crossLanguageQuery(s, lang);

describe('cross-language search', () => {
  it.each([
    ['rent assistance Strasbourg', 'en', ['loyer', 'Strasbourg']],
    ['disability allowance', 'en', ['handicap']],
    ['residence permit', 'en', ['titre de séjour']],
    ['food bank 67000', 'en', ['alimentaire', '67000']],
    ['kira yardımı', 'tr', ['loyer']],
    ['engelli çocuk yardımı', 'tr', ['allocations familiales', 'handicap']],
    ['sağlık sigortası', 'tr', ['assurance maladie']],
    ['إيجار', 'ar', ['loyer']],
    ['مساعدة السكن في ستراسبورغ', 'ar', ['loyer', 'Strasbourg']],
    ['تصريح الإقامة', 'ar', ['titre de séjour']],
    ['Wohngeld beantragen', 'de', ['loyer']],
    ['Mietzuschuss Straßburg', 'de', ['Strasbourg', 'loyer']],
    ['Arbeitslosengeld', 'de', ['chômage']],
    ['допомога на оренду', 'uk', ['loyer']],
    ['тимчасовий захист', 'uk', ['protection temporaire']],
    ['житло в Страсбурзі', 'uk', ['logement', 'Strasbourg']],
  ])('%s (%s) → French search words', (text, lang, words) => {
    const r = q(text, lang);
    expect(r.changed).toBe(true);
    for (const w of words) expect(r.query).toContain(w);
    expect(searchWords(r.query).length).toBeGreaterThan(0);
  });
  it('never rewrites a French query, whatever the interface language', () => {
    for (const lang of ['fr', 'en', 'tr', 'de']) {
      expect(q('logement social', lang).changed).toBe(false);
      expect(q('aide au loyer CAF', lang).changed).toBe(false);
    }
    expect(q('pension alimentaire', 'fr').changed).toBe(false);
  });
  it('leaves nothing usable for a query it does not understand (the search then abstains)', () => {
    for (const [s, l] of [['привіт', 'uk'], ['مرحبا', 'ar'], ['Здравствуйте як справи', 'uk']]) {
      const r = q(s, l);
      expect(r.changed).toBe(true);
      expect(searchWords(r.query)).toEqual([]);
    }
  });
  it('folds case, accents, Arabic vowel marks and letter variants, Turkish dotless i', () => {
    expect(fold('KIRA')).toBe('kira');
    expect(fold('yardımı')).toBe('yardimi');
    expect(fold('إِيجَار')).toBe('ايجار');
    expect(fold('Straße')).toBe('strasse');
  });
});
