import { describe, it, expect } from 'vitest';
import capabilityService from '../../api/lib/services/source-capability.js';

describe('Source Capability Service', () => {
  it('returns true when capabilities match (EligibilitySpecialist)', () => {
    const capabilities = ['LEGAL', 'BENEFIT_RULE'];
    expect(capabilityService.isSourceCompatible(capabilities, 'EligibilitySpecialist')).toBe(true);
  });

  it('returns false when no overlap', () => {
    const capabilities = ['DIRECTORY'];
    expect(capabilityService.isSourceCompatible(capabilities, 'EligibilitySpecialist')).toBe(false);
  });

  it('returns true for unknown specialist (fail-open)', () => {
    const capabilities = ['DIRECTORY'];
    expect(capabilityService.isSourceCompatible(capabilities, 'UnknownSpecialist')).toBe(true);
  });

  it('filters compatible sources correctly', () => {
    const sources = [
      { id: '1', capabilities: ['LEGAL'] },
      { id: '2', capabilities: ['DIRECTORY'] },
      { id: '3', capabilities: ['PROCEDURAL'] }
    ];
    const filtered = capabilityService.filterCompatibleSources(sources, 'OrientationSpecialist');
    expect(filtered).toHaveLength(2);
    expect(filtered.map(s => s.id)).toEqual(['2', '3']);
  });

  it('warns on STATISTICAL + BENEFIT_RULE', () => {
    const warnings = capabilityService.validateCapabilityConsistency(['BENEFIT_RULE'], 'STATISTICAL');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('should not claim BENEFIT_RULE');
  });

  it('warns on OPEN_DATA_CATALOG + LEGAL', () => {
    const warnings = capabilityService.validateCapabilityConsistency(['LEGAL'], 'OPEN_DATA_CATALOG');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('should not claim LEGAL');
  });

  it('CNAF statistical data does NOT qualify for EligibilitySpecialist', () => {
    // A statistical source only has STATISTICAL capability or similar
    const cnafStats = { capabilities: ['STATISTICAL'] };
    expect(capabilityService.isSourceCompatible(cnafStats.capabilities, 'EligibilitySpecialist')).toBe(false);
  });

  it('ANCT France Services DIRECTORY qualifies for OrientationSpecialist', () => {
    const anct = { capabilities: ['DIRECTORY', 'LOCAL_SERVICE'] };
    expect(capabilityService.isSourceCompatible(anct.capabilities, 'OrientationSpecialist')).toBe(true);
  });
});
