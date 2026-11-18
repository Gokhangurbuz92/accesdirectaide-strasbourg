// FA-CAP / QA v50 (P28, DTA-B85): a territory filter matches the commune whatever its spelling in the record or in the page address
import { describe, it, expect } from 'vitest';
import { territorySlug } from '../../api/lib/search-query.js';

describe('territorySlug', () => {
  it('folds case, accents and separators to one slug', () => {
    for (const v of ['Strasbourg', 'strasbourg', 'STRASBOURG', ' Strasbourg ']) expect(territorySlug(v)).toBe('strasbourg');
    expect(territorySlug('Sélestat')).toBe('selestat');
    expect(territorySlug('Illkirch-Graffenstaden')).toBe(territorySlug('illkirch graffenstaden'));
    expect(territorySlug('France entière')).toBe('france-entiere');
    expect(territorySlug('67')).toBe('67');
  });
  it('keeps different communes different', () => {
    expect(territorySlug('Strasbourg')).not.toBe(territorySlug('Schiltigheim'));
  });
});
