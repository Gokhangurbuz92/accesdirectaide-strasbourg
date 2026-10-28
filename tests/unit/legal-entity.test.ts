import { describe, it, expect } from 'vitest';
import { validateLaunchReadiness, CURRENT_LEGAL_ENTITY, LegalEntityConfig } from '../../src/config/legal-entity';

describe('LegalEntityConfig', () => {
  it('should allow IN_FORMATION locally', () => {
    expect(CURRENT_LEGAL_ENTITY.status).toBe('IN_FORMATION');
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
