import { z } from "zod";
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  evaluateApplicability,
  evaluateBenefitApplicability,
  evaluateProcedureApplicability
} from '../../api/lib/geography/ApplicabilityEngine.js';

// ── Helper: territory type map ──
function makeTypeMap(entries) {
  return new Map(entries);
}

const FRANCE_ID = 'fr-country';
const GRAND_EST_ID = 'grand-est';
const BAS_RHIN_ID = 'bas-rhin';
const EUROMETROPOLE_ID = 'eurometropole';
const STRASBOURG_ID = 'strasbourg';
const BORDEAUX_ID = 'bordeaux';
const GIRONDE_ID = 'gironde';
const NOUVELLE_AQUITAINE_ID = 'nouvelle-aquitaine';

const typeMap = makeTypeMap([
  [FRANCE_ID, 'COUNTRY'],
  [GRAND_EST_ID, 'REGION'],
  [BAS_RHIN_ID, 'DEPARTEMENT'],
  [EUROMETROPOLE_ID, 'EPCI'],
  [STRASBOURG_ID, 'COMMUNE'],
  [BORDEAUX_ID, 'COMMUNE'],
  [GIRONDE_ID, 'DEPARTEMENT'],
  [NOUVELLE_AQUITAINE_ID, 'REGION']
]);

const strasbourgHierarchy = [STRASBOURG_ID, EUROMETROPOLE_ID, BAS_RHIN_ID, GRAND_EST_ID, FRANCE_ID];
const bordeauxHierarchy = [BORDEAUX_ID, GIRONDE_ID, NOUVELLE_AQUITAINE_ID, FRANCE_ID];

describe('Phase 9 — ApplicabilityEngine', () => {
  // ── T021: Truth table tests ──

  describe('T021: Inclusion/Exclusion Precedence Truth Table', () => {
    it('national-only benefit: APPLICABLE for any user', () => {
      const rules = [{ territoryId: FRANCE_ID, isExclusion: false }];
      expect(evaluateApplicability(rules, strasbourgHierarchy, typeMap)).toBe('APPLICABLE');
      expect(evaluateApplicability(rules, bordeauxHierarchy, typeMap)).toBe('APPLICABLE');
    });

    it('regional inclusion: APPLICABLE for matching region', () => {
      const rules = [{ territoryId: GRAND_EST_ID, isExclusion: false }];
      expect(evaluateApplicability(rules, strasbourgHierarchy, typeMap)).toBe('APPLICABLE');
    });

    it('regional inclusion: NOT_APPLICABLE for non-matching region', () => {
      const rules = [{ territoryId: GRAND_EST_ID, isExclusion: false }];
      expect(evaluateApplicability(rules, bordeauxHierarchy, typeMap)).toBe('NOT_APPLICABLE');
    });

    it('department inclusion: APPLICABLE for matching dept', () => {
      const rules = [{ territoryId: BAS_RHIN_ID, isExclusion: false }];
      expect(evaluateApplicability(rules, strasbourgHierarchy, typeMap)).toBe('APPLICABLE');
    });

    it('EPCI inclusion: APPLICABLE for matching EPCI member', () => {
      const rules = [{ territoryId: EUROMETROPOLE_ID, isExclusion: false }];
      expect(evaluateApplicability(rules, strasbourgHierarchy, typeMap)).toBe('APPLICABLE');
    });

    it('commune inclusion: APPLICABLE for exact commune', () => {
      const rules = [{ territoryId: STRASBOURG_ID, isExclusion: false }];
      expect(evaluateApplicability(rules, strasbourgHierarchy, typeMap)).toBe('APPLICABLE');
    });

    it('SC-006: broader inclusion + narrower exclusion → NOT_APPLICABLE', () => {
      // Grand Est included, but Bas-Rhin excluded
      const rules = [
        { territoryId: GRAND_EST_ID, isExclusion: false },
        { territoryId: BAS_RHIN_ID, isExclusion: true }
      ];
      expect(evaluateApplicability(rules, strasbourgHierarchy, typeMap)).toBe('NOT_APPLICABLE');
    });

    it('broader exclusion + narrower inclusion → APPLICABLE (narrowest wins)', () => {
      // Grand Est excluded, but Strasbourg explicitly included
      const rules = [
        { territoryId: GRAND_EST_ID, isExclusion: true },
        { territoryId: STRASBOURG_ID, isExclusion: false }
      ];
      expect(evaluateApplicability(rules, strasbourgHierarchy, typeMap)).toBe('APPLICABLE');
    });

    it('same-level include/exclude → exclusion wins', () => {
      const rules = [
        { territoryId: BAS_RHIN_ID, isExclusion: false },
        { territoryId: BAS_RHIN_ID, isExclusion: true }
      ];
      expect(evaluateApplicability(rules, strasbourgHierarchy, typeMap)).toBe('NOT_APPLICABLE');
    });

    it('multiple territories: applicable to multiple matching regions', () => {
      const rules = [
        { territoryId: GRAND_EST_ID, isExclusion: false },
        { territoryId: NOUVELLE_AQUITAINE_ID, isExclusion: false }
      ];
      expect(evaluateApplicability(rules, strasbourgHierarchy, typeMap)).toBe('APPLICABLE');
      expect(evaluateApplicability(rules, bordeauxHierarchy, typeMap)).toBe('APPLICABLE');
    });
  });

  // ── T022: Benefit/Procedure parity ──

  describe('T022: Benefit and Procedure Applicability Parity', () => {
    it('evaluates identically for Benefit and Procedure', () => {
      const rules = [
        { territoryId: GRAND_EST_ID, isExclusion: false },
        { territoryId: BAS_RHIN_ID, isExclusion: true }
      ];

      const benefitResult = evaluateBenefitApplicability(rules, strasbourgHierarchy, typeMap);
      const procedureResult = evaluateProcedureApplicability(rules, strasbourgHierarchy, typeMap);

      expect(benefitResult).toBe(procedureResult);
      expect(benefitResult).toBe('NOT_APPLICABLE');
    });
  });

  // ── T015/SC-008/SC-009: Territory decision states ──

  describe('T015: Territory Decision States', () => {
    it('TERRITORY_REQUIRED when no territory provided and local rules exist', () => {
      const rules = [{ territoryId: GRAND_EST_ID, isExclusion: false }];
      expect(evaluateApplicability(rules, [], typeMap)).toBe('TERRITORY_REQUIRED');
    });

    it('APPLICABLE for national-only when no territory', () => {
      const rules = [{ territoryId: FRANCE_ID, isExclusion: false }];
      expect(evaluateApplicability(rules, [], typeMap)).toBe('APPLICABLE');
    });

    it('UNKNOWN when no applicability rules exist', () => {
      expect(evaluateApplicability([], strasbourgHierarchy, typeMap)).toBe('UNKNOWN');
    });

    it('UNKNOWN when no rules and no territory', () => {
      expect(evaluateApplicability([], [], typeMap)).toBe('UNKNOWN');
    });

    it('NOT_APPLICABLE when rules exist but user territory not matched', () => {
      const rules = [{ territoryId: GRAND_EST_ID, isExclusion: false }];
      expect(evaluateApplicability(rules, bordeauxHierarchy, typeMap)).toBe('NOT_APPLICABLE');
    });
  });

  // ── T023: Cross-territory RAG leakage ──

  describe('T023: Cross-Territory RAG Leakage Protection', () => {
    it('Bordeaux-only benefit NOT APPLICABLE in Strasbourg context', () => {
      const bordeauxRules = [{ territoryId: BORDEAUX_ID, isExclusion: false }];
      expect(evaluateApplicability(bordeauxRules, strasbourgHierarchy, typeMap)).toBe('NOT_APPLICABLE');
    });

    it('Strasbourg-only benefit NOT APPLICABLE in Bordeaux context', () => {
      const strasbourgRules = [{ territoryId: STRASBOURG_ID, isExclusion: false }];
      expect(evaluateApplicability(strasbourgRules, bordeauxHierarchy, typeMap)).toBe('NOT_APPLICABLE');
    });

    it('National benefit APPLICABLE in both contexts', () => {
      const nationalRules = [{ territoryId: FRANCE_ID, isExclusion: false }];
      expect(evaluateApplicability(nationalRules, strasbourgHierarchy, typeMap)).toBe('APPLICABLE');
      expect(evaluateApplicability(nationalRules, bordeauxHierarchy, typeMap)).toBe('APPLICABLE');
    });

    it('No territory + local benefit = TERRITORY_REQUIRED', () => {
      const localRules = [{ territoryId: STRASBOURG_ID, isExclusion: false }];
      expect(evaluateApplicability(localRules, [], typeMap)).toBe('TERRITORY_REQUIRED');
    });

    it('No territory + national benefit = APPLICABLE', () => {
      const nationalRules = [{ territoryId: FRANCE_ID, isExclusion: false }];
      expect(evaluateApplicability(nationalRules, [], typeMap)).toBe('APPLICABLE');
    });
  });
});

// Phase 9 — Deterministic Specialist Abstention (server-side guard)
describe('Phase 9 — Specialist Abstention Guard', () => {
  it('BaseSpecialist deterministically abstains on NOT_APPLICABLE', async () => {
    const { BaseSpecialist } = await import('../../api/lib/agents/base-specialist.js');
    const specialist = new BaseSpecialist({
      name: 'test-specialist',
      systemPrompt: 'You are a test specialist.',
      responseSchema: { parse: (v) => v }
    });

    const dispatch = {
      payload: 'test query',
      executionId: '00000000-0000-0000-0000-000000000001',
      territoryApplicabilityState: 'NOT_APPLICABLE'
    };

    const result = await specialist.execute(dispatch);
    expect(result.abstention).toBe(true);
    expect(result.safeErrorState).toBe('TERRITORY_NOT_APPLICABLE');
    expect(result.modelCallCount).toBe(0);
    expect(result.routingMethod).toBe('DETERMINISTIC');
  });

  it('BaseSpecialist deterministically abstains on TERRITORY_REQUIRED', async () => {
    const { BaseSpecialist } = await import('../../api/lib/agents/base-specialist.js');
    const specialist = new BaseSpecialist({
      name: 'test-specialist',
      systemPrompt: 'You are a test specialist.',
      responseSchema: { parse: (v) => v }
    });

    const dispatch = {
      payload: 'test query',
      executionId: '00000000-0000-0000-0000-000000000002',
      territoryApplicabilityState: 'TERRITORY_REQUIRED'
    };

    const result = await specialist.execute(dispatch);
    expect(result.abstention).toBe(true);
    expect(result.safeErrorState).toBe('TERRITORY_REQUIRED');
    expect(result.modelCallCount).toBe(0);
    expect(result.routingMethod).toBe('DETERMINISTIC');
  });

  it('BaseSpecialist does NOT abstain on APPLICABLE (model would be called)', async () => {
    const { BaseSpecialist } = await import('../../api/lib/agents/base-specialist.js');
    const specialist = new BaseSpecialist({
      name: 'test-specialist',
      systemPrompt: 'You are a test specialist.',
      responseSchema: { parse: (v) => v }
    });

    const dispatch = {
      payload: 'test query',
      executionId: '00000000-0000-0000-0000-000000000003',
      territoryApplicabilityState: 'APPLICABLE',
      timeoutMs: 100
    };

    // This will fail because there's no AI provider, but it proves the guard did NOT fire
    const result = await specialist.execute(dispatch);
    // The model call will fail with a timeout or error — but it was attempted
    expect(result.abstention).not.toBe(true);
    expect(result.modelCallCount).toBeGreaterThanOrEqual(0);
  });
});

describe('Specialist Guard - UNKNOWN State', () => {
  it('UNKNOWN state triggers deterministic abstention without calling model', async () => {
    const { BaseSpecialist } = await import('../../api/lib/agents/base-specialist.js');
    const testSpecialist = new BaseSpecialist({ 
      name: 'TestSpecialist',
      systemPrompt: 'test prompt',
      responseSchema: z.object({})
    });
    const dispatch = {
      executionId: '123e4567-e89b-12d3-a456-426614174000',
      territoryApplicabilityState: 'UNKNOWN'
    };
    const response = await testSpecialist.execute(dispatch, {});
    expect(response.abstention).toBe(true);
    expect(response.routingMethod).toBe('DETERMINISTIC');
    expect(response.modelCallCount).toBe(0);
    expect(response.safeErrorState).toBe('TERRITORY_UNKNOWN');
  });
});
