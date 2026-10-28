import { describe, expect, it } from 'vitest';
import {
  appendNext,
  appendRdvJourneyContext,
  buildPublicRdvPath,
  normalizeNextPath,
} from '../../src/lib/rdvRouting.js';

describe('WS7 RDV routing', () => {
  it('keeps next paths local and rejects redirect-shaped input', () => {
    expect(normalizeNextPath('/aides/apl')).toBe('/aides/apl');
    expect(normalizeNextPath('https://evil.example', '/safe')).toBe('/safe');
    expect(normalizeNextPath('//evil.example', '/safe')).toBe('/safe');
    expect(normalizeNextPath('%2F%2Fevil.example', '/safe')).toBe('/safe');
    expect(normalizeNextPath('/\\evil.example', '/safe')).toBe('/safe');
  });

  it('appends a normalized local next path', () => {
    expect(appendNext('/rdv/strasbourg', '/aides/apl')).toBe(
      '/rdv/strasbourg?next=%2Faides%2Fapl',
    );
    expect(appendNext('/rdv/strasbourg', '//evil.example')).toBe('/rdv/strasbourg');
  });

  it('builds the slug booking route and preserves non-sensitive journey context', () => {
    expect(
      buildPublicRdvPath(
        { id: 'structure-1', slug: 'ccas-strasbourg' },
        {
          nextPath: '/aides/apl',
          aideSlug: 'apl',
          origin: 'aide',
        },
      ),
    ).toBe(
      '/rdv/ccas-strasbourg/booking?next=%2Faides%2Fapl&aide=apl&origin=aide',
    );
  });

  it('uses the id fallback without allowing arbitrary origin syntax', () => {
    const path = appendRdvJourneyContext(
      buildPublicRdvPath({ id: 'structure 1' }),
      { origin: 'bad origin!', nextPath: '/annuaire' },
    );

    expect(path).toBe(
      '/rdv/structure%201/booking?structureId=structure%201&next=%2Fannuaire',
    );
  });
});
