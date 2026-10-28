import { describe, it, expect, beforeEach } from 'vitest';
import { ORIENTATION_DEFINITION, ORIENTATION_RESPONSE_SCHEMA, registerOrientation } from '../../api/lib/agents/orientation.js';
import { ELIGIBILITY_DEFINITION, ELIGIBILITY_RESPONSE_SCHEMA, ELIGIBILITY_STATUS, registerEligibility } from '../../api/lib/agents/eligibility.js';
import { PROCEDURE_DEFINITION, PROCEDURE_RESPONSE_SCHEMA, registerProcedure } from '../../api/lib/agents/procedure.js';
import { DOCUMENT_DEFINITION, DOCUMENT_RESPONSE_SCHEMA, registerDocument } from '../../api/lib/agents/document.js';
import { FALC_DEFINITION, FALC_RESPONSE_SCHEMA, registerFalc } from '../../api/lib/agents/falc.js';
import { clearRegistry, hasComponent } from '../../api/lib/agents/registry.js';

describe('Phase 7 Specialist Agents', () => {
  beforeEach(() => clearRegistry());

  // ─── OrientationSpecialist ────────────────────
  describe('OrientationSpecialist', () => {
    it('definition name is "orientation"', () => {
      expect(ORIENTATION_DEFINITION.name).toBe('orientation');
    });

    it('systemPrompt > 100 chars', () => {
      expect(ORIENTATION_DEFINITION.systemPrompt.length).toBeGreaterThan(100);
    });

    it('all tools are isReadOnly', () => {
      for (const tool of ORIENTATION_DEFINITION.tools) {
        expect(tool.isReadOnly).toBe(true);
      }
    });

    it('has search_aides tool', () => {
      expect(ORIENTATION_DEFINITION.tools.some(t => t.name === 'search_aides')).toBe(true);
    });

    it('response schema validates correct sample', () => {
      const sample = {
        category: 'ORIENTATION',
        decisionSummary: 'Orientation vers les aides logement',
        relevantCategories: ['LOGEMENT', 'EMPLOI'],
        suggestedAides: [{ title: 'APL', description: 'Aide au logement' }],
        nextSteps: ['Contacter la CAF'],
        humanActionRequired: false,
        missingInformation: []
      };
      const parsed = ORIENTATION_RESPONSE_SCHEMA.parse(sample);
      expect(parsed.category).toBe('ORIENTATION');
    });

    it('response schema rejects invalid data', () => {
      expect(ORIENTATION_RESPONSE_SCHEMA.safeParse({ wrong: true }).success).toBe(false);
    });

    it('registration works', () => {
      registerOrientation();
      expect(hasComponent('orientation')).toBe(true);
    });
  });

  // ─── EligibilitySpecialist ────────────────────
  describe('EligibilitySpecialist', () => {
    it('definition name is "eligibility"', () => {
      expect(ELIGIBILITY_DEFINITION.name).toBe('eligibility');
    });

    it('systemPrompt > 100 chars', () => {
      expect(ELIGIBILITY_DEFINITION.systemPrompt.length).toBeGreaterThan(100);
    });

    it('all tools are isReadOnly', () => {
      for (const tool of ELIGIBILITY_DEFINITION.tools) {
        expect(tool.isReadOnly).toBe(true);
      }
    });

    it('ELIGIBILITY_STATUS enum does NOT include ELIGIBLE', () => {
      const validValues = ELIGIBILITY_STATUS.options;   // the public list (zod 4 no longer keeps _def.values)
      expect(validValues).not.toContain('ELIGIBLE');
      expect(validValues).toContain('UNKNOWN');
      expect(validValues).toContain('POSSIBLE');
      expect(validValues).toContain('MISSING_INFORMATION');
      expect(validValues).toContain('DETERMINISTIC_CHECK_REQUIRED');
    });

    it('humanActionRequired defaults to true', () => {
      const sample = {
        category: 'ELIGIBILITY',
        decisionSummary: 'Éligibilité indicative',
        eligibilityStatus: 'POSSIBLE',
        candidateBenefits: []
      };
      const parsed = ELIGIBILITY_RESPONSE_SCHEMA.parse(sample);
      expect(parsed.humanActionRequired).toBe(true);
      expect(parsed.limitations).toContain('OpenFisca');
    });

    it('response schema validates correct sample', () => {
      const sample = {
        category: 'ELIGIBILITY',
        decisionSummary: 'Éligibilité possible à l\'AAH',
        eligibilityStatus: 'POSSIBLE',
        candidateBenefits: [{
          name: 'AAH',
          status: 'POSSIBLE',
          conditions: ['Taux d\'incapacité >= 80%'],
          missingFacts: ['Justificatif MDPH']
        }],
        missingInformation: ['Justificatif MDPH']
      };
      const parsed = ELIGIBILITY_RESPONSE_SCHEMA.parse(sample);
      expect(parsed.eligibilityStatus).toBe('POSSIBLE');
    });

    it('response schema rejects invalid data', () => {
      expect(ELIGIBILITY_RESPONSE_SCHEMA.safeParse({ wrong: true }).success).toBe(false);
    });

    it('registration works', () => {
      registerEligibility();
      expect(hasComponent('eligibility')).toBe(true);
    });
  });

  // ─── ProcedureSpecialist ──────────────────────
  describe('ProcedureSpecialist', () => {
    it('definition name is "procedure"', () => {
      expect(PROCEDURE_DEFINITION.name).toBe('procedure');
    });

    it('systemPrompt > 100 chars', () => {
      expect(PROCEDURE_DEFINITION.systemPrompt.length).toBeGreaterThan(100);
    });

    it('has search_procedures tool', () => {
      expect(PROCEDURE_DEFINITION.tools.some(t => t.name === 'search_procedures')).toBe(true);
    });

    it('all tools are isReadOnly', () => {
      for (const tool of PROCEDURE_DEFINITION.tools) {
        expect(tool.isReadOnly).toBe(true);
      }
    });

    it('response schema validates correct sample', () => {
      const sample = {
        category: 'PROCEDURE',
        decisionSummary: 'Procédure de demande AAH',
        procedureTitle: 'Demande d\'AAH',
        steps: [{ stepNumber: 1, description: 'Remplir le formulaire MDPH' }],
        sourceIds: ['sp-aah-01']
      };
      const parsed = PROCEDURE_RESPONSE_SCHEMA.parse(sample);
      expect(parsed.category).toBe('PROCEDURE');
    });

    it('response schema rejects invalid data', () => {
      expect(PROCEDURE_RESPONSE_SCHEMA.safeParse({ wrong: true }).success).toBe(false);
    });

    it('registration works', () => {
      registerProcedure();
      expect(hasComponent('procedure')).toBe(true);
    });
  });

  // ─── DocumentSpecialist ───────────────────────
  describe('DocumentSpecialist', () => {
    it('definition name is "document"', () => {
      expect(DOCUMENT_DEFINITION.name).toBe('document');
    });

    it('systemPrompt > 100 chars', () => {
      expect(DOCUMENT_DEFINITION.systemPrompt.length).toBeGreaterThan(100);
    });

    it('no tools (empty array)', () => {
      expect(DOCUMENT_DEFINITION.tools).toHaveLength(0);
    });

    it('humanActionRequired defaults to true, isLegalAdjacent exists', () => {
      const sample = {
        category: 'DOCUMENT',
        decisionSummary: 'Notification CAF',
        summary: 'Résumé du document'
      };
      const parsed = DOCUMENT_RESPONSE_SCHEMA.parse(sample);
      expect(parsed.humanActionRequired).toBe(true);
      expect(parsed.isLegalAdjacent).toBe(false); // default
    });

    it('response schema validates correct sample', () => {
      const sample = {
        category: 'DOCUMENT',
        decisionSummary: 'Analyse du courrier',
        summary: 'Ce document est une notification de la CAF concernant vos droits.',
        keyInformation: [{ field: 'Montant', value: '150€' }],
        suggestedActions: ['Vérifier vos droits sur caf.fr'],
        isLegalAdjacent: true,
        humanActionRequired: true
      };
      const parsed = DOCUMENT_RESPONSE_SCHEMA.parse(sample);
      expect(parsed.isLegalAdjacent).toBe(true);
    });

    it('response schema rejects invalid data', () => {
      expect(DOCUMENT_RESPONSE_SCHEMA.safeParse({ wrong: true }).success).toBe(false);
    });

    it('registration works', () => {
      registerDocument();
      expect(hasComponent('document')).toBe(true);
    });
  });

  // ─── FalcSpecialist ───────────────────────────
  describe('FalcSpecialist', () => {
    it('definition name is "falc"', () => {
      expect(FALC_DEFINITION.name).toBe('falc');
    });

    it('systemPrompt > 100 chars', () => {
      expect(FALC_DEFINITION.systemPrompt.length).toBeGreaterThan(100);
    });

    it('no tools', () => {
      expect(FALC_DEFINITION.tools).toHaveLength(0);
    });

    it('falcReviewStatus is always PENDING, humanActionRequired always true', () => {
      const sample = {
        category: 'FALC',
        simplifiedTitle: 'Aide au logement',
        simplifiedText: 'Vous pouvez avoir une aide pour payer votre loyer.',
        keyActions: ['Aller sur caf.fr']
      };
      const parsed = FALC_RESPONSE_SCHEMA.parse(sample);
      expect(parsed.falcReviewStatus).toBe('PENDING');
      expect(parsed.humanActionRequired).toBe(true);
    });

    it('response schema validates correct sample', () => {
      const sample = {
        category: 'FALC',
        simplifiedTitle: 'Aide au logement',
        simplifiedText: 'Vous pouvez avoir une aide pour payer votre loyer.',
        targetAudience: 'Locataires',
        keyActions: ['Aller sur caf.fr', 'Remplir le formulaire']
      };
      const parsed = FALC_RESPONSE_SCHEMA.parse(sample);
      expect(parsed.category).toBe('FALC');
    });

    it('response schema rejects invalid data', () => {
      expect(FALC_RESPONSE_SCHEMA.safeParse({ wrong: true }).success).toBe(false);
    });

    it('registration works', () => {
      registerFalc();
      expect(hasComponent('falc')).toBe(true);
    });
  });
});
