import { describe, it, expect } from 'vitest';
import { NormalizedBenefit, NormalizedProcedure, NormalizedStructure } from '../../api/lib/ingestion/normalization/index.js';

describe('NormalizedBenefit Schema', () => {
  it('passes validation with valid input', () => {
    const valid = {
      sourceId: 'cnaf-1',
      externalId: 'rsa',
      title: 'RSA'
    };
    const result = NormalizedBenefit.parse(valid);
    expect(result.sourceId).toBe('cnaf-1');
    expect(result.language).toBe('fr');
    expect(result.categoryCode).toBe('AUTRE');
    expect(result.fetchedAt).toBeInstanceOf(Date);
  });

  it('fails when missing required fields', () => {
    const invalid = { sourceId: '1' }; // missing externalId and title
    expect(() => NormalizedBenefit.parse(invalid)).toThrow();
  });

  it('accepts optional fields and passthrough', () => {
    const valid = {
      sourceId: 'cnaf-1',
      externalId: 'rsa',
      title: 'RSA',
      financials: { amount: 100 },
      extraField: 'allowed'
    };
    const result = NormalizedBenefit.parse(valid);
    expect(result.financials.amount).toBe(100);
    expect(result.extraField).toBe('allowed');
  });

  it('rejects invalid URLs', () => {
    const invalid = {
      sourceId: '1', externalId: '2', title: 'A', sourceUrl: 'not-a-url'
    };
    expect(() => NormalizedBenefit.parse(invalid)).toThrow();
  });
  
  it('validates category enum', () => {
    const valid = {
      sourceId: 'cnaf-1', externalId: 'rsa', title: 'RSA', categoryCode: 'LOGEMENT'
    };
    const result = NormalizedBenefit.parse(valid);
    expect(result.categoryCode).toBe('LOGEMENT');
  });
});

describe('NormalizedProcedure Schema', () => {
  it('passes validation with valid input', () => {
    const valid = {
      sourceId: 'sp-1',
      externalId: 'p1',
      title: 'Procedure 1',
      sourceUrl: 'https://example.com'
    };
    const result = NormalizedProcedure.parse(valid);
    expect(result.title).toBe('Procedure 1');
    expect(result.language).toBe('fr');
  });

  it('fails when missing required fields', () => {
    const invalid = { sourceId: '1' };
    expect(() => NormalizedProcedure.parse(invalid)).toThrow();
  });
});

describe('NormalizedStructure Schema', () => {
  it('passes validation with valid input', () => {
    const valid = {
      sourceId: 'anct-1',
      externalId: 's1',
      name: 'Structure 1',
      address: '123 Rue de la Paix',
      city: 'Paris',
      postalCode: '75000',
      sourceUrl: 'https://example.com'
    };
    const result = NormalizedStructure.parse(valid);
    expect(result.name).toBe('Structure 1');
    expect(result.language).toBe('fr');
  });

  it('fails when missing required fields', () => {
    const invalid = { sourceId: '1' };
    expect(() => NormalizedStructure.parse(invalid)).toThrow();
  });
});
