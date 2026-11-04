import { describe, it, expect } from 'vitest';
import { validateLaunchReadiness, CURRENT_LEGAL_ENTITY, LegalEntityConfig } from '../../src/config/legal-entity';

describe('LegalEntityConfig', () => {
  // R42-A01 (owner addendum, 04/11/2026): no association exists; the operator is the natural-person project carrier
  it('states the present operator: no legal person created, a natural person carries the project', () => {
    expect(CURRENT_LEGAL_ENTITY.status).toBe('NOT_CREATED');
    expect(CURRENT_LEGAL_ENTITY.operatorKind).toBe('NATURAL_PERSON');
    expect(CURRENT_LEGAL_ENTITY.operatorRole).toMatch(/Porteur du projet AccesDirectAide/);
    expect(CURRENT_LEGAL_ENTITY.plannedLegalForm).toMatch(/envisagée, non créée, non inscrite/);
    // nothing invented: no name in source, no identifiers, no address or telephone
    for (const k of ['legalName', 'legalForm', 'siren', 'siret', 'rne', 'vatNumber', 'registeredOffice', 'contactPhone', 'publicationDirector', 'dpoContact'] as const) {
      expect(CURRENT_LEGAL_ENTITY[k], k).toBeNull();
    }
    const result = validateLaunchReadiness(CURRENT_LEGAL_ENTITY);
    expect(result.ready).toBe(false);
  });

  it('should identify missing fields when ACTIVE', () => {
    const config: LegalEntityConfig = {
      ...CURRENT_LEGAL_ENTITY,
      status: 'ACTIVE'
    };
    const result = validateLaunchReadiness(config);
    expect(result.ready).toBe(false);
    expect(result.missingFields).toContain('legalName');
    expect(result.missingFields).toContain('legalForm');
    expect(result.missingFields).toContain('siren');
  });

  it('should be ready when all required fields are present and ACTIVE', () => {
    const config: LegalEntityConfig = {
      ...CURRENT_LEGAL_ENTITY,
      status: 'ACTIVE',
      legalName: 'TEST COMPANY',
      legalForm: 'SASU',
      siren: '123456789',
      registeredOffice: 'Paris',
      publicationDirector: 'Director'
    };
    const result = validateLaunchReadiness(config);
    expect(result.ready).toBe(true);
    expect(result.missingFields).toHaveLength(0);
    expect(result.pendingLegalReview).toBe(true);
  });
});
